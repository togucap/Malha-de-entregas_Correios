/**
 * Cruzamentos da aba base (CONFIG.PLANILHA.ABA) com relatórios em pastas do Drive.
 * Para um novo cruzamento, acrescente um item em CRUZAMENTOS; o botão do menu executa todos, na ordem da lista.
 *
 * Cada item:
 *   id                 nome interno (usado por ignorarLinhasDe)
 *   pasta, arquivo, aba  ID da pasta no Drive, nome do arquivo (com ou sem extensão), aba (vazio = primeira)
 *   chaveBase / chaveRelatorio  colunas comparadas
 *   rastreioRelatorio  (opcional) coluna do relatório com o código de rastreio: a chave passa a ser
 *                      pedido + rastreio, comparando com os códigos da linha da base ("Código convertido"
 *                      e o código da própria coluna "Autorização Postagem")
 *   ignorarLinhasDe    (opcional) id de um cruzamento anterior: as linhas que tiveram correspondência
 *                      nele não são cruzadas aqui (a coluna fica vazia)
 *   colunas            gravadas na base, de dois tipos:
 *     { relatorio: 'Coluna do relatório', base: 'Coluna da base' } -> traz o valor da coluna
 *     { base: 'Coluna da base', presenca: true }                    -> "Sim" / "Não" se a chave consta no relatório
 *
 * Regras:
 * - A chave é comparada como texto, sem espaços nas pontas e sem diferenciar maiúsculas.
 * - Valor trazido: vale a primeira linha do relatório com a coluna preenchida; linha sem
 *   correspondência mantém o valor que já estava na base.
 * - Presença: toda linha com chave recebe "Sim" ou "Não" (reflete o relatório atual); linha sem chave fica vazia.
 * - Um cruzamento com erro (arquivo ou coluna não encontrada) não impede os demais; quem depende
 *   dele (ignorarLinhasDe) não é executado.
 *
 * Execução em etapas (um clique basta): cada execução vai até ~TEMPO_MAXIMO_MS. Se o tempo acabar
 * no meio de um CSV, a leitura para numa quebra de linha e o progresso fica salvo (posição no arquivo
 * em CRUZ_ESTADO e as linhas já encontradas em mapas de bits CRUZ_BITS_*); um gatilho de uso único
 * (continuarCruzamentos) segue dali em ~1 min, até o último cruzamento. O resultado final vai para o
 * registro de execuções e para a nota do cabeçalho da coluna da chave (ex.: "Pedido").
 */

const CRUZAMENTOS = [
  {
    id: 'parceiros',
    pasta: '1Zk2F78ImtNqEDF_pULHe-74qwxaMH2xe',
    arquivo: 'Consolidado_Parceiros_Out.xlsx', // "_Out" = parceiros externos
    aba: '',
    chaveBase: 'Pedido',
    chaveRelatorio: 'pedido_codigo',
    colunas: [{ relatorio: 'Parceiro', base: 'Parceiro_Nome' }]
  },
  {
    id: 'ordemServico',
    pasta: '15e1QbjoUii-tvNa180pwRcAKJTyxQlkP',
    arquivo: 'Relatorio Ordem de Serviço - Consolidado',
    aba: '',
    chaveBase: 'Pedido',
    chaveRelatorio: 'Número do Pedido',
    rastreioRelatorio: 'Código do Rastreio da Postagem',
    colunas: [{ relatorio: 'Nome da Assistência Técnica', base: 'Assistencia_Tecnica' }]
  },
  {
    id: 'listaMspc',
    pasta: '12d0yusktFNnojVKtxlLHGXGUiE-7ivNc',
    arquivo: 'Lista MSPC', // entradas de produtos no estoque
    aba: '',
    chaveBase: 'Pedido',
    chaveRelatorio: 'Num do pedido',
    ignorarLinhasDe: 'ordemServico', // linha com Ordem de Serviço (pedido + rastreio) não é cruzada aqui
    colunas: [{ base: 'Entrada_Lista', presenca: true }]
  }
];

const PRESENCA_SIM = 'Sim';
const PRESENCA_NAO = 'Não';
const CRUZ_ESTADO_PROP = 'CRUZ_ESTADO';
const CRUZ_BITS_PREFIXO = 'CRUZ_BITS_';
const FUNCAO_CONTINUAR_CRUZAMENTOS = 'continuarCruzamentos';

function menuCruzarRelatorios() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Cruzando a base com os relatórios do Drive...', 'Correios', 10);
  try {
    ss.toast(cruzarRelatorios(), 'Correios', 60);
  } catch (e) {
    ss.toast(String(e && e.message ? e.message : e), 'Correios – erro', 60);
  }
}

// Começa os cruzamentos do primeiro item (descarta uma rodada anterior não concluída)
function cruzarRelatorios() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 'Há uma atualização em andamento. Tente novamente em alguns minutos.';
  try {
    limparEstadoCruzamentos_();
    return executarCruzamentos_({ etapa: 0, resultados: [], csv: null });
  } finally {
    lock.releaseLock();
  }
}

// Disparada pelos gatilhos de uso único agendados por executarCruzamentos_
function continuarCruzamentos(e) {
  removerGatilhos_(FUNCAO_CONTINUAR_CRUZAMENTOS, e && e.triggerUid);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { // outra execução em andamento: tenta de novo depois
    agendarGatilho_(FUNCAO_CONTINUAR_CRUZAMENTOS, CONFIG.PLANILHA.ESPERA_CONTINUACAO_MS);
    return;
  }
  try {
    const texto = PropertiesService.getScriptProperties().getProperty(CRUZ_ESTADO_PROP);
    if (!texto) return;
    console.log(executarCruzamentos_(JSON.parse(texto)));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Executa os cruzamentos a partir de estado.etapa até acabar o tempo desta execução.
 * estado = { etapa, resultados: [mensagens], csv: retomada do CSV em leitura ou null }.
 */
function executarCruzamentos_(estado) {
  const cfg = CONFIG.PLANILHA;
  const inicio = Date.now();
  const prazo = inicio + cfg.TEMPO_MAXIMO_MS;
  const aba = obterAba_();
  // execuções seguidas sem avanço (ex.: encerradas à força pelo Apps Script) param a rodada
  estado.semAvanco = (estado.semAvanco || 0) + 1;
  if (estado.semAvanco > cfg.MAX_FALHAS) {
    limparEstadoCruzamentos_();
    throw new Error('Cruzamentos interrompidos: ' + cfg.MAX_FALHAS + ' execuções seguidas sem avanço em "' +
      (CRUZAMENTOS[estado.etapa] || {}).arquivo + '". Resultados até aqui: ' + (estado.resultados.join(' | ') || 'nenhum'));
  }
  // rede de segurança: se o Apps Script encerrar esta execução à força, retoma do último ponto salvo
  salvarEstadoCruzamentos_(estado);
  agendarGatilho_(FUNCAO_CONTINUAR_CRUZAMENTOS, cfg.ESPERA_SEGURANCA_MS);

  while (estado.etapa < CRUZAMENTOS.length) {
    const c = CRUZAMENTOS[estado.etapa];
    let r;
    try {
      r = executarEtapaCruzamento_(aba, c, prazo, estado.csv);
    } catch (e) {
      apagarBits_(c.id);
      r = { concluida: true, msg: c.arquivo + ': ERRO – ' + (e && e.message ? e.message : e) };
    }

    estado.semAvanco = 0;
    if (!r.concluida) {
      estado.csv = r.retomada;
      salvarEstadoCruzamentos_(estado);
      agendarGatilho_(FUNCAO_CONTINUAR_CRUZAMENTOS, cfg.ESPERA_CONTINUACAO_MS);
      return estado.resultados.concat(c.arquivo + ': ' + r.progresso + '% lido').join(' | ') +
        ' | Continua sozinho em ~1 min; o resultado final fica na nota do cabeçalho "' + c.chaveBase + '".';
    }

    estado.resultados.push(r.msg);
    estado.csv = null;
    estado.etapa++;
    // próximo relatório só nesta execução se ainda sobrar bastante tempo (xlsx/planilha não podem ser pausados)
    if (estado.etapa < CRUZAMENTOS.length && Date.now() - inicio > cfg.TEMPO_MAXIMO_MS / 3) {
      salvarEstadoCruzamentos_(estado);
      agendarGatilho_(FUNCAO_CONTINUAR_CRUZAMENTOS, cfg.ESPERA_CONTINUACAO_MS);
      return estado.resultados.join(' | ') + ' | Continua sozinho em ~1 min com "' + CRUZAMENTOS[estado.etapa].arquivo + '".';
    }
  }

  const msg = estado.resultados.join(' | ');
  registrarResultadoCruzamentos_(aba, msg);
  limparEstadoCruzamentos_();
  return msg;
}

/**
 * Executa (ou continua) um cruzamento. Devolve { concluida: true, msg } ao terminar, ou
 * { concluida: false, retomada, progresso } se o CSV parou pelo prazo.
 */
function executarEtapaCruzamento_(aba, c, prazo, retomada) {
  const cab = CONFIG.PLANILHA.LINHA_CABECALHO;
  const colChave = indiceColuna_(aba, c.chaveBase);
  if (!colChave) throw new Error('coluna "' + c.chaveBase + '" não encontrada na aba "' + aba.getName() + '"');
  const total = aba.getLastRow() - cab;
  if (total <= 0) return { concluida: true, msg: c.arquivo + ': nenhuma linha na base.' };

  let ignorar = null;
  if (c.ignorarLinhasDe) {
    ignorar = lerBits_(c.ignorarLinhasDe, 0, total);
    if (!ignorar) {
      return { concluida: true, msg: c.arquivo + ': não executado (depende do cruzamento "' + c.ignorarLinhasDe + '", que não foi concluído)' };
    }
  }

  // chaves de cada linha da base: pedido, ou pedido|rastreio para cada código de rastreio da linha
  const pedidos = aba.getRange(cab + 1, colChave, total, 1).getValues();
  const rastreios = c.rastreioRelatorio ? codigosRastreioDaBase_(aba, total) : null;
  const linhasPorChave = Object.create(null); // só as chaves da base são guardadas durante a leitura
  pedidos.forEach(function (r, i) {
    const pedido = chaveCruzamento_(r[0]);
    if (!pedido || (ignorar && ignorar[i])) return;
    const chaves = rastreios ? rastreios[i].map(function (cod) { return pedido + '|' + cod; }) : [pedido];
    chaves.forEach(function (k) { (linhasPorChave[k] = linhasPorChave[k] || []).push(i); });
  });

  // bits[0][i]: linha i teve correspondência; bits[k + 1][i]: coluna trazida k já recebeu valor nesta rodada
  const trazidas = c.colunas.filter(function (col) { return !col.presenca; });
  let bits = retomada ? lerListaBits_(c.id, trazidas.length + 1, total) : null;
  if (!bits) bits = Array.from({ length: trazidas.length + 1 }, function () { return novoBits_(total); });
  const novosValores = trazidas.map(function () { return {}; }); // linha -> valor a gravar
  const deslocamento = c.rastreioRelatorio ? 2 : 1;
  const colunasLidas = [c.chaveRelatorio]
    .concat(c.rastreioRelatorio ? [c.rastreioRelatorio] : [])
    .concat(trazidas.map(function (col) { return col.relatorio; }));

  const rel = percorrerRelatorio_(c.pasta, c.arquivo, c.aba, colunasLidas, function (v) {
    const pedido = chaveCruzamento_(v[0]);
    if (!pedido) return;
    const linhas = linhasPorChave[c.rastreioRelatorio ? pedido + '|' + chaveCruzamento_(normalizarCodigo_(v[1])) : pedido];
    if (!linhas) return;
    for (let j = 0; j < linhas.length; j++) {
      const i = linhas[j];
      bits[0][i] = true;
      for (let k = 0; k < trazidas.length; k++) {
        const x = v[k + deslocamento];
        if (x !== '' && x != null && !bits[k + 1][i]) { bits[k + 1][i] = true; novosValores[k][i] = x; }
      }
    }
  }, prazo, retomada);

  // colunas trazidas: grava só as linhas que ganharam valor nesta parte
  trazidas.forEach(function (col, k) {
    const linhas = Object.keys(novosValores[k]);
    if (!linhas.length) return;
    const rng = aba.getRange(cab + 1, garantirColuna_(aba, col.base), total, 1);
    const valores = rng.getValues();
    linhas.forEach(function (i) { valores[i][0] = novosValores[k][i]; });
    rng.setValues(valores);
  });

  if (rel.retomada) {
    salvarListaBits_(c.id, bits);
    return { concluida: false, retomada: rel.retomada, progresso: Math.floor(100 * rel.retomada.posicao / rel.retomada.tamanho) };
  }

  // fim do relatório: colunas de presença e contagem
  let encontrados = 0, semCorrespondencia = 0, ignorados = 0;
  pedidos.forEach(function (r, i) {
    if (!chaveCruzamento_(r[0])) return;
    if (ignorar && ignorar[i]) ignorados++;
    else if (bits[0][i]) encontrados++;
    else semCorrespondencia++;
  });
  c.colunas.filter(function (col) { return col.presenca; }).forEach(function (col) {
    const rng = aba.getRange(cab + 1, garantirColuna_(aba, col.base), total, 1);
    const valores = rng.getValues();
    for (let i = 0; i < total; i++) {
      if (!chaveCruzamento_(pedidos[i][0])) continue;
      valores[i][0] = ignorar && ignorar[i] ? '' : bits[0][i] ? PRESENCA_SIM : PRESENCA_NAO;
    }
    rng.setValues(valores);
  });
  salvarListaBits_(c.id, [bits[0]]); // linhas com correspondência, para quem depende deste cruzamento

  return {
    concluida: true,
    msg: rel.nome + ' (' + rel.linhas + ' linhas): ' + encontrados + ' encontrado(s), ' + semCorrespondencia +
      ' não encontrado(s)' + (ignorados ? ', ' + ignorados + ' ignorado(s) por ' + c.ignorarLinhasDe : '') +
      ' (' + c.colunas.map(function (col) { return col.base; }).join(', ') + ').'
  };
}

/**
 * Códigos de rastreio de cada linha da base, já no formato da chave: os do "Código convertido"
 * e o código da própria coluna "Autorização Postagem" (rastreio de 13, Jadlog etc.).
 */
function codigosRastreioDaBase_(aba, total) {
  const cfg = CONFIG.PLANILHA;
  const convertidos = lerColunaOpcional_(aba, cfg.COL_CONVERTIDO, total);
  const codigos = lerColunaOpcional_(aba, cfg.COL_CODIGO, total);
  const linhas = [];
  for (let i = 0; i < total; i++) {
    const lista = [];
    const incluir = function (c) { const k = chaveCruzamento_(c); if (k && lista.indexOf(k) < 0) lista.push(k); };
    if (convertidos) codigosDaCelula_(convertidos[i][0]).forEach(incluir);
    if (codigos) incluir(normalizarCodigo_(codigos[i][0]));
    linhas.push(lista);
  }
  return linhas;
}

// Número inteiro vira texto sem casas decimais (o Excel pode trazer 12345 como número)
function chaveCruzamento_(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).trim();
  return String(v).trim().toUpperCase();
}

/* ---------- Estado entre execuções ---------- */

function salvarEstadoCruzamentos_(estado) {
  PropertiesService.getScriptProperties().setProperty(CRUZ_ESTADO_PROP, JSON.stringify(estado));
}

// Fim da rodada (ou cancelamento): apaga estado, mapas de bits e gatilho pendente
function limparEstadoCruzamentos_() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k === CRUZ_ESTADO_PROP || k.indexOf(CRUZ_BITS_PREFIXO) === 0) props.deleteProperty(k);
  });
  removerGatilhos_(FUNCAO_CONTINUAR_CRUZAMENTOS);
}

// Resultado da última rodada como nota no cabeçalho da coluna da chave (fica visível na planilha)
function registrarResultadoCruzamentos_(aba, msg) {
  const col = indiceColuna_(aba, CRUZAMENTOS[0].chaveBase);
  if (!col) return;
  const quando = Utilities.formatDate(new Date(), aba.getParent().getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm');
  aba.getRange(CONFIG.PLANILHA.LINHA_CABECALHO, col).setNote('Último cruzamento com relatórios (' + quando + '):\n' + msg.split(' | ').join('\n'));
}

/* ---------- Mapas de bits (uma linha da base por bit), guardados nas Propriedades do script ---------- */

function novoBits_(total) {
  const b = new Array(total);
  for (let i = 0; i < total; i++) b[i] = false;
  return b;
}

function salvarListaBits_(id, lista) {
  apagarBits_(id);
  const props = {};
  lista.forEach(function (bits, n) {
    codificarBits_(bits).forEach(function (pedaco, p) { props[CRUZ_BITS_PREFIXO + id + '_' + n + '_' + p] = pedaco; });
  });
  PropertiesService.getScriptProperties().setProperties(props);
}

function lerListaBits_(id, quantidade, total) {
  const lista = [];
  for (let n = 0; n < quantidade; n++) {
    const bits = lerBits_(id, n, total);
    if (!bits) return null;
    lista.push(bits);
  }
  return lista;
}

// Mapa n do cruzamento `id`, ou null se não houver
function lerBits_(id, n, total) {
  const props = PropertiesService.getScriptProperties();
  let texto = '';
  for (let p = 0; ; p++) {
    const pedaco = props.getProperty(CRUZ_BITS_PREFIXO + id + '_' + n + '_' + p);
    if (pedaco === null) break;
    texto += pedaco;
  }
  if (!texto) return null;
  const bytes = Utilities.base64Decode(texto);
  const bits = novoBits_(total);
  for (let i = 0; i < total; i++) bits[i] = !!((bytes[i >> 3] & 0xFF) & (1 << (i & 7)));
  return bits;
}

function apagarBits_(id) {
  const props = PropertiesService.getScriptProperties();
  Object.keys(props.getProperties()).forEach(function (k) {
    if (k.indexOf(CRUZ_BITS_PREFIXO + id + '_') === 0) props.deleteProperty(k);
  });
}

// base64 em pedaços de 8000 caracteres (limite de 9 KB por propriedade)
function codificarBits_(bits) {
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8 && i + j < bits.length; j++) if (bits[i + j]) b |= 1 << j;
    bytes.push(b > 127 ? b - 256 : b);
  }
  const texto = Utilities.base64Encode(bytes);
  const pedacos = [];
  for (let p = 0; p < texto.length; p += 8000) pedacos.push(texto.slice(p, p + 8000));
  return pedacos.length ? pedacos : [''];
}

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
 * - Valor trazido: chave repetida usa a primeira linha com a coluna preenchida; linha sem
 *   correspondência mantém o valor que já estava na base.
 * - Presença: toda linha com chave recebe "Sim" ou "Não" (reflete o relatório atual); linha sem chave fica vazia.
 * - Um cruzamento com erro (arquivo ou coluna não encontrada) não impede os demais; quem depende
 *   dele (ignorarLinhasDe) não é executado.
 * - Só as chaves que existem na base são guardadas durante a leitura; a execução para antes do
 *   limite de tempo do Apps Script (os cruzamentos que não couberem avisam para executar de novo).
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

function menuCruzarRelatorios() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Cruzando a base com os relatórios do Drive...', 'Correios', 10);
  try {
    ss.toast(cruzarRelatorios(), 'Correios', 60);
  } catch (e) {
    ss.toast(String(e && e.message ? e.message : e), 'Correios – erro', 60);
  }
}

// Executa todos os cruzamentos de CRUZAMENTOS na aba base, na ordem; devolve um resumo de cada um
function cruzarRelatorios() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 'Há uma atualização em andamento. Tente novamente em alguns minutos.';
  try {
    const aba = obterAba_();
    const prazo = Date.now() + CONFIG.PLANILHA.TEMPO_MAXIMO_MS; // antes do limite de 6 min do Apps Script
    const correspondidas = {}; // id do cruzamento -> { índice da linha: true } das linhas com correspondência
    const msg = CRUZAMENTOS.map(function (c) {
      if (Date.now() > prazo) return c.arquivo + ': não executado (tempo esgotado; execute de novo)';
      if (c.ignorarLinhasDe && !correspondidas[c.ignorarLinhasDe]) {
        return c.arquivo + ': não executado (depende do cruzamento "' + c.ignorarLinhasDe + '", que não foi concluído)';
      }
      try {
        const r = executarCruzamento_(aba, c, prazo, c.ignorarLinhasDe ? correspondidas[c.ignorarLinhasDe] : null);
        correspondidas[c.id] = r.correspondidas;
        return r.msg;
      } catch (e) {
        return c.arquivo + ': ERRO – ' + (e && e.message ? e.message : e);
      }
    }).join(' | ');
    console.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Executa um cruzamento; `ignorar` = { índice da linha: true } das linhas que não devem ser cruzadas.
 * Devolve { msg, correspondidas } (índices das linhas com correspondência).
 */
function executarCruzamento_(aba, c, prazo, ignorar) {
  const cab = CONFIG.PLANILHA.LINHA_CABECALHO;
  const colChave = indiceColuna_(aba, c.chaveBase);
  if (!colChave) throw new Error('coluna "' + c.chaveBase + '" não encontrada na aba "' + aba.getName() + '"');
  const total = aba.getLastRow() - cab;
  if (total <= 0) return { msg: c.arquivo + ': nenhuma linha na base.', correspondidas: {} };

  // chaves de cada linha da base: pedido, ou pedido|rastreio para cada código de rastreio da linha
  const pedidos = aba.getRange(cab + 1, colChave, total, 1).getValues();
  const rastreios = c.rastreioRelatorio ? codigosRastreioDaBase_(aba, total) : null;
  const chavesLinha = pedidos.map(function (r, i) {
    const pedido = chaveCruzamento_(r[0]);
    if (!pedido || (ignorar && ignorar[i])) return [];
    return rastreios ? rastreios[i].map(function (cod) { return pedido + '|' + cod; }) : [pedido];
  });
  const naBase = Object.create(null); // só as chaves da base são guardadas durante a leitura (memória)
  chavesLinha.forEach(function (ks) { ks.forEach(function (k) { naBase[k] = true; }); });

  const trazidas = c.colunas.filter(function (col) { return !col.presenca; });
  const presentes = Object.create(null);
  const mapas = trazidas.map(function () { return Object.create(null); }); // chave -> primeiro valor preenchido
  const colunasLidas = [c.chaveRelatorio]
    .concat(c.rastreioRelatorio ? [c.rastreioRelatorio] : [])
    .concat(trazidas.map(function (col) { return col.relatorio; }));
  const deslocamento = c.rastreioRelatorio ? 2 : 1;

  const rel = percorrerRelatorio_(c.pasta, c.arquivo, c.aba, colunasLidas, function (v) {
    const pedido = chaveCruzamento_(v[0]);
    if (!pedido) return;
    const chave = c.rastreioRelatorio ? pedido + '|' + chaveCruzamento_(normalizarCodigo_(v[1])) : pedido;
    if (!naBase[chave]) return;
    presentes[chave] = true;
    for (let k = 0; k < trazidas.length; k++) {
      const x = v[k + deslocamento];
      if (x !== '' && x != null && !(chave in mapas[k])) mapas[k][chave] = x;
    }
  }, prazo);

  // chave da linha que teve correspondência (a primeira, se a linha tiver mais de um código de rastreio)
  const chaveEncontrada = chavesLinha.map(function (ks) {
    for (let j = 0; j < ks.length; j++) if (presentes[ks[j]]) return ks[j];
    return null;
  });
  const correspondidas = {};
  let encontrados = 0, semCorrespondencia = 0, ignorados = 0;
  pedidos.forEach(function (r, i) {
    if (!chaveCruzamento_(r[0])) return;
    if (ignorar && ignorar[i]) { ignorados++; return; }
    if (chaveEncontrada[i]) { correspondidas[i] = true; encontrados++; } else semCorrespondencia++;
  });

  c.colunas.forEach(function (col) {
    const rng = aba.getRange(cab + 1, garantirColuna_(aba, col.base), total, 1);
    const valores = rng.getValues();
    const mapa = col.presenca ? null : mapas[trazidas.indexOf(col)];
    for (let i = 0; i < total; i++) {
      if (!chaveCruzamento_(pedidos[i][0])) continue;
      if (ignorar && ignorar[i]) { if (col.presenca) valores[i][0] = ''; continue; }
      const chave = chaveEncontrada[i];
      if (col.presenca) valores[i][0] = chave ? PRESENCA_SIM : PRESENCA_NAO;
      else if (chave && chave in mapa) valores[i][0] = mapa[chave];
    }
    rng.setValues(valores);
  });

  return {
    msg: rel.nome + ' (' + rel.linhas + ' linhas): ' + encontrados + ' encontrado(s), ' + semCorrespondencia +
      ' não encontrado(s)' + (ignorados ? ', ' + ignorados + ' ignorado(s) por ' + c.ignorarLinhasDe : '') +
      ' (' + c.colunas.map(function (col) { return col.base; }).join(', ') + ').',
    correspondidas: correspondidas
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

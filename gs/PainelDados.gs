/**
 * Dados do painel (telas Acompanhamento - OUT e Shopee) acoplados à planilha:
 *
 *   Painel_JSON (aba oculta)          A1 = meta { versao, geradoEm, ultimoNum, pedacos, tamanho, ... };
 *                                     A2… = o JSON das telas, comprimido (gzip) em base64, em pedaços
 *                                     ("P" + até 45 mil caracteres; o "P" evita que o Sheets leia "=…" como fórmula).
 *   Registro_Alteracoes (aba oculta)  uma linha por alteração depois do JSON: nº, quando, conjunto (base|retorno|manual),
 *                                     ação (gravar|remover), chave (Protocolo / Pedido_Shopee), dados (registro
 *                                     completo da linha, em JSON), origem (tracking|edicao).
 *
 * Quem grava:
 * - lote do tracking e edição manual (onEdit) -> Registro_Alteracoes (chega aos painéis em até 30 s);
 * - importação de protocolos, Retorno_Extensão, cruzamentos e fim de cada execução do tracking ->
 *   regerarPainelDados_ (lê a base uma vez, grava o JSON novo e limpa o registro já incluído);
 * - acionador manterPainelDados (a cada 30 min): regera se houver alterações pendentes.
 * Quem lê: painelDadosSincronizar (navegador, a cada 30 s; js/DadosPainel). A versão do JSON e o último nº do
 * registro ficam nas Propriedades do script: a conferência "mudou algo?" não lê a planilha.
 *
 * Conteúdo do JSON: linhas da aba base com Parceiro_Nome (as colunas da tela Acompanhamento - OUT, já em texto;
 * Assistencia_Tecnica como Sim/Não), menos os finalizados com Data Ocorrencia de mais de 25 dias (contados em
 * totais), exceto Shopee ainda sem "Sim" na Entrada_Lista (pendência do operacional); e a aba Retorno_Extensão.
 * As regras de tela (status finais, colunas do quadro Shopee...) vão em config; a tela aplica.
 * Travas: quem regera ou grava a base segura a trava do script (minutos); gravar no registro e nas abas
 * das ações manuais usa a trava curta do documento (comTravaRegistro_), para o painel funcionar durante
 * a atualização.
 */

const PAINEL_DADOS = {
  ABA_JSON: 'Painel_JSON',
  ABA_REGISTRO: 'Registro_Alteracoes',
  CABECALHO_REGISTRO: ['nº', 'quando', 'conjunto', 'ação', 'chave', 'dados', 'origem'],
  DIAS_FINALIZADOS: 25,
  PARCEIROS_SEM_CORTE: ['SHOPEE'], // finalizados sem "Sim" na Entrada_Lista continuam (pendência do operacional)
  COLUNAS_RETORNO: ['Pedido_Shopee', 'Pedido', 'situacao', 'prazo', 'origem', 'statusSolicitacao', 'contestacao', 'link'],
  PEDACO: 45000,              // caracteres por célula (limite do Sheets: 50 mil)
  MAX_LINHAS_EDICAO: 300,     // edição maior que isso (ex.: colar um bloco) pede regeneração em vez de registrar linha a linha
  VERSAO_PROP: 'PAINEL_JSON_VERSAO',
  INCLUIDO_PROP: 'PAINEL_JSON_ULTIMO_NUM', // último nº do registro já dentro do JSON
  SEQ_PROP: 'PAINEL_REG_SEQ',              // último nº usado no registro (nunca volta)
  PENDENTE_PROP: 'PAINEL_JSON_PENDENTE',   // mudança que não entrou no registro: regerar na manutenção
  MANUTENCAO: 'manterPainelDados',
  MANUTENCAO_MIN: 30,
  CACHE_TTL_S: 6 * 60 * 60,
  FORMATO: 1
};

/* ---------- Chamadas do painel (google.script.run) ---------- */

/**
 * Conferência do navegador (a cada 30 s ou no botão Atualizar). Devolve JSON em texto:
 *   { tipo: 'nada', versao, ultimoNum }
 *   { tipo: 'alteracoes', versao, ultimoNum, alteracoes: [[nº, conjunto, ação, chave, dados], …] }
 *   { tipo: 'completo', versao, ultimoNum, meta, dados (base64 gzip), alteracoes }
 */
function painelDadosSincronizar(versaoCliente, ultimoNumCliente) {
  const props = PropertiesService.getScriptProperties();
  let versao = props.getProperty(PAINEL_DADOS.VERSAO_PROP);
  if (!versao) { // primeira vez: monta o JSON agora
    regerarPainelDadosComTrava_('primeiro acesso', 30000);
    versao = props.getProperty(PAINEL_DADOS.VERSAO_PROP);
    if (!versao) throw new Error('Os dados do painel ainda estão sendo preparados. Tente de novo em instantes.');
  }
  const seq = Number(props.getProperty(PAINEL_DADOS.SEQ_PROP) || 0);

  if (String(versaoCliente || '') !== versao) {
    const snap = lerJsonPainel_(versao);
    return JSON.stringify({
      tipo: 'completo', versao: snap.meta.versao, ultimoNum: seq, meta: snap.meta, dados: snap.dados,
      alteracoes: lerAlteracoesPainel_(snap.meta.ultimoNum)
    });
  }
  if (Number(ultimoNumCliente || 0) < seq) {
    return JSON.stringify({ tipo: 'alteracoes', versao: versao, ultimoNum: seq, alteracoes: lerAlteracoesPainel_(Number(ultimoNumCliente || 0)) });
  }
  return JSON.stringify({ tipo: 'nada', versao: versao, ultimoNum: seq });
}

// Navegador sem DecompressionStream: o servidor devolve o JSON já descomprimido
function painelDadosTexto() {
  const versao = PropertiesService.getScriptProperties().getProperty(PAINEL_DADOS.VERSAO_PROP);
  if (!versao) throw new Error('Os dados do painel ainda não foram gerados.');
  const snap = lerJsonPainel_(versao);
  return Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(snap.dados), 'application/x-gzip')).getDataAsString('UTF-8');
}

/* ---------- Menu e acionador ---------- */

function menuRegerarPainelDados() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Regerando os dados do painel...', 'Correios', 10);
  try {
    ss.toast(regerarPainelDadosComTrava_('menu', 30000), 'Correios', 20);
  } catch (e) {
    ss.toast(mensagemErro_(e), 'Correios – erro', 30);
  }
}

// Acionador a cada 30 min (criado sozinho na primeira regeneração): regera só se houver o que incluir
function manterPainelDados() {
  const props = PropertiesService.getScriptProperties();
  const seq = Number(props.getProperty(PAINEL_DADOS.SEQ_PROP) || 0);
  const incluido = Number(props.getProperty(PAINEL_DADOS.INCLUIDO_PROP) || 0);
  if (props.getProperty(PAINEL_DADOS.VERSAO_PROP) && seq <= incluido && !props.getProperty(PAINEL_DADOS.PENDENTE_PROP)) return;
  try {
    console.log(regerarPainelDadosComTrava_('manutenção', 1000));
  } catch (e) {
    console.warn('Manutenção dos dados do painel: ' + mensagemErro_(e)); // ocupado: fica para a próxima
  }
}

function regerarPainelDadosComTrava_(motivo, esperaMs) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(esperaMs)) throw new Error(MSG_OCUPADO);
  try {
    return regerarPainelDados_(motivo);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Regeneração do JSON ---------- */

// Para quem já grava na planilha: falha aqui nunca interrompe quem chamou (fica pendente para a manutenção)
function regerarPainelDadosSeguro_(motivo) {
  try {
    const msg = regerarPainelDados_(motivo);
    console.log(msg);
    return msg;
  } catch (e) {
    console.warn('Painel_JSON não regerado (' + motivo + '): ' + mensagemErro_(e));
    marcarPainelPendente_();
    return null;
  }
}

/** Monta e grava o JSON das telas. Quem chama já tem a trava do script. Devolve o resumo. */
function regerarPainelDados_(motivo) {
  const inicio = Date.now();
  const props = PropertiesService.getScriptProperties();
  const seq = Number(props.getProperty(PAINEL_DADOS.SEQ_PROP) || 0); // com a trava, ninguém registra durante a montagem

  const dados = montarJsonPainel_();
  const texto = JSON.stringify(dados);
  const b64 = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(texto, 'application/json')).getBytes());
  const pedacos = [];
  for (let i = 0; i < b64.length; i += PAINEL_DADOS.PEDACO) pedacos.push(b64.slice(i, i + PAINEL_DADOS.PEDACO));
  const meta = {
    versao: String(Date.now()), geradoEm: dados.geradoEm, ultimoNum: seq, pedacos: pedacos.length, tamanho: b64.length,
    bytesJson: texto.length, linhasBase: dados.base.linhas.length, linhasRetorno: dados.retorno.linhas.length, motivo: motivo || ''
  };

  // grava o bloco novo por cima e só depois limpa o que sobrou (quem lê no meio vê o bloco antigo ou o novo)
  const aba = obterAbaPainel_(PAINEL_DADOS.ABA_JSON, null);
  const bloco = [[JSON.stringify(meta)]].concat(pedacos.map(function (p) { return ['P' + p]; }));
  garantirLinhas_(aba, bloco.length);
  aba.getRange(1, 1, bloco.length, 1).setValues(bloco);
  if (aba.getLastRow() > bloco.length) aba.getRange(bloco.length + 1, 1, aba.getLastRow() - bloco.length, 1).clearContent();

  // tira do registro o que já entrou (falhar aqui não atrapalha: o navegador só aplica nº acima do JSON)
  try {
    comTravaRegistro_(20000, function () { limparRegistroPainel_(seq); });
  } catch (e) {
    console.warn('Registro_Alteracoes não limpo: ' + mensagemErro_(e));
  }
  guardarJsonNoCache_(meta, pedacos);
  props.setProperties({ [PAINEL_DADOS.VERSAO_PROP]: meta.versao, [PAINEL_DADOS.INCLUIDO_PROP]: String(seq) });
  props.deleteProperty(PAINEL_DADOS.PENDENTE_PROP);
  try { garantirManutencaoPainel_(); } catch (e) { console.warn('Acionador manterPainelDados não criado: ' + mensagemErro_(e)); }

  return 'Painel_JSON regerado (' + (motivo || '-') + '): ' + meta.linhasBase + ' linha(s) da base + ' + meta.linhasRetorno +
    ' da Retorno_Extensão, ' + Math.round(b64.length / 1024) + ' KB em ' + pedacos.length + ' célula(s), ' +
    dados.totais.finalizadosFora + ' finalizado(s) antigo(s) só no total, em ' + ((Date.now() - inicio) / 1000).toFixed(1) + ' s.';
}

/** O JSON das telas (lê a base e a Retorno_Extensão uma vez). */
function montarJsonPainel_() {
  const aba = obterAba_();
  const fuso = aba.getParent().getSpreadsheetTimeZone();
  const ctx = contextoBasePainel_(aba);
  const limite = Date.now() - PAINEL_DADOS.DIAS_FINALIZADOS * 864e5;
  const linhas = [];
  const foraPorParceiro = {};
  let fora = 0;
  // duplicidade: mesmo Pedido em outro protocolo já resolvido (entregue com "Sim" na Entrada_Lista, ou finalizado manualmente)
  const resolvidoPorPedido = {};
  const candidatos = [];
  if (ctx.total) {
    aba.getRange(2, 1, ctx.total, ctx.largura).getValues().forEach(function (r) {
      const s = situacaoNoPainel_(r, ctx, limite);
      const chave = ctx.iChave < 0 ? '' : chavePainel_(r[ctx.iChave], fuso);
      const pedido = ctx.iPedido < 0 ? '' : chavePainel_(r[ctx.iPedido], fuso);
      const resolvido = !!(chave && ctx.manual[chave]) ||
        (ctx.iStatus >= 0 && ctx.iLista >= 0 && normalizarTexto_(r[ctx.iLista]) === 'sim' && statusFinalizado_(r[ctx.iStatus]));
      if (resolvido && chave && pedido && !resolvidoPorPedido[pedido]) resolvidoPorPedido[pedido] = chave;
      if (s === 'incluir') {
        linhas.push(registroBasePainel_(r, ctx, fuso));
        if (!resolvido && chave && pedido) candidatos.push([chave, pedido]);
      } else if (s === 'antigo') {
        fora++;
        const p = String(r[ctx.iParceiro]).trim();
        foraPorParceiro[p] = (foraPorParceiro[p] || 0) + 1;
      }
    });
  }

  const duplicidades = {};
  candidatos.forEach(function (c) {
    const outro = resolvidoPorPedido[c[1]];
    if (outro && outro !== c[0]) duplicidades[c[0]] = outro;
  });
  const manual = {};
  Object.keys(ctx.manual).forEach(function (k) { manual[k] = publicoManual_(ctx.manual[k]); });

  const abaRet = obterAbaRetornoExtensao_(true);
  const ret = abaRet ? contextoRetornoPainel_(abaRet) : null;
  const linhasRet = [];
  if (ret && ret.total) {
    abaRet.getRange(2, 1, ret.total, ret.largura).getValues().forEach(function (r) {
      if (ret.pos[0] >= 0 && String(r[ret.pos[0]]).trim()) linhasRet.push(registroRetornoPainel_(r, ret, fuso));
    });
  }

  return {
    formato: PAINEL_DADOS.FORMATO,
    geradoEm: Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm'),
    diasFinalizados: PAINEL_DADOS.DIAS_FINALIZADOS,
    config: {
      finais: STATUS_FINAIS,
      marcaExpirado: MARCA_RASTREIO_EXPIRADO,
      rotulos: ROTULOS_ACOMPANHAMENTO_OUT,
      kanban: KANBAN_SHOPEE,
      pendente: REGRA_PENDENTE_SHOPEE,
      parceiroShopee: PARCEIRO_SHOPEE
    },
    base: { colunas: COLUNAS_ACOMPANHAMENTO_OUT, chave: 'Protocolo', linhas: linhas },
    retorno: { existe: !!abaRet, colunas: PAINEL_DADOS.COLUNAS_RETORNO, chave: 'Pedido_Shopee', linhas: linhasRet },
    manual: manual,             // { PROTOCOLO: { situacao, por, em } } (gs/EstadoManual)
    duplicidades: duplicidades, // { PROTOCOLO: outro protocolo do mesmo Pedido já resolvido }
    totais: { finalizadosFora: fora, finalizadosForaPorParceiro: foraPorParceiro },
    faltando: {
      base: COLUNAS_ACOMPANHAMENTO_OUT.filter(function (_, k) { return ctx.pos[k] < 0; }),
      retorno: abaRet ? PAINEL_DADOS.COLUNAS_RETORNO.filter(function (_, k) { return ret.pos[k] < 0; }) : PAINEL_DADOS.COLUNAS_RETORNO.slice()
    }
  };
}

/* ---------- Linhas: escopo e registro em texto ---------- */

function contextoBasePainel_(aba) {
  const largura = aba.getLastColumn();
  const cabecalho = largura ? aba.getRange(1, 1, 1, largura).getValues()[0].map(normalizarTexto_) : [];
  const indice = function (nome) { return cabecalho.indexOf(normalizarTexto_(nome)); };
  const nomes = COLUNAS_ACOMPANHAMENTO_OUT;
  return {
    largura: largura,
    total: Math.max(0, aba.getLastRow() - 1),
    pos: nomes.map(indice),
    simNao: nomes.map(function (n) { return SIM_NAO_ACOMPANHAMENTO_OUT.indexOf(n) >= 0; }),
    soData: nomes.map(function (n) { return SO_DATA_ACOMPANHAMENTO_OUT.indexOf(n) >= 0; }),
    fuso: aba.getParent().getSpreadsheetTimeZone(),
    manual: lerEstadoManual_().mapa, // finalizados manualmente (gs/EstadoManual)
    iChave: indice('Protocolo'),
    iPedido: indice('Pedido'),
    iParceiro: indice(FILTRO_ACOMPANHAMENTO_OUT),
    iStatus: indice('Status tracking'),
    iData: indice('Data Ocorrencia'),
    iLista: indice('Entrada_Lista'),
    semCorte: PAINEL_DADOS.PARCEIROS_SEM_CORTE.map(normalizarTexto_)
  };
}

function contextoRetornoPainel_(aba) {
  const largura = aba.getLastColumn();
  const cabecalho = largura ? aba.getRange(1, 1, 1, largura).getValues()[0].map(normalizarTexto_) : [];
  return {
    largura: largura,
    total: Math.max(0, aba.getLastRow() - 1),
    pos: PAINEL_DADOS.COLUNAS_RETORNO.map(function (n) { return cabecalho.indexOf(normalizarTexto_(n)); })
  };
}

/** 'fora' (sem parceiro), 'antigo' (finalizado há mais de 25 dias: só no total) ou 'incluir'. */
function situacaoNoPainel_(r, ctx, limite) {
  if (ctx.iParceiro < 0) return 'fora';
  const parceiro = String(r[ctx.iParceiro] == null ? '' : r[ctx.iParceiro]).trim();
  if (!parceiro) return 'fora';
  // finalizado manualmente: conta como finalizado; o corte de 25 dias vale a partir da data da ação
  const manual = ctx.iChave < 0 ? null : ctx.manual[chavePainel_(r[ctx.iChave], ctx.fuso)];
  if (manual) return manual.emMs && manual.emMs < limite ? 'antigo' : 'incluir';
  if (ctx.iStatus < 0 || !statusFinalizado_(r[ctx.iStatus])) return 'incluir';
  if (ctx.semCorte.indexOf(normalizarTexto_(parceiro)) >= 0 && (ctx.iLista < 0 || normalizarTexto_(r[ctx.iLista]) !== 'sim')) return 'incluir';
  const data = ctx.iData < 0 ? null : dataDoPainel_(r[ctx.iData]);
  return data && data.getTime() < limite ? 'antigo' : 'incluir';
}

function registroBasePainel_(r, ctx, fuso) {
  return ctx.pos.map(function (i, k) {
    if (i < 0) return '';
    if (ctx.simNao[k]) return String(r[i] == null ? '' : r[i]).trim() ? 'Sim' : 'Não';
    return valorParaTela_(r[i], fuso, ctx.soData[k]);
  });
}

function registroRetornoPainel_(r, ctx, fuso) {
  return ctx.pos.map(function (i) { return i < 0 ? '' : valorParaTela_(r[i], fuso, false); });
}

// Chave do registro: o mesmo texto que a tela lê na coluna (Protocolo / Pedido_Shopee), em maiúsculas
function chavePainel_(v, fuso) {
  return String(valorParaTela_(v, fuso, false)).trim().toUpperCase();
}

// Data da planilha (Date ou texto dd/MM/aaaa [HH:mm[:ss]])
function dataDoPainel_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
  const m = String(v == null ? '' : v).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)) : null;
}

/* ---------- Registro de alterações ---------- */

/**
 * Registra as linhas [primeira, primeira + qtd) da aba base. comRemocao: linha que saiu do painel (sem
 * parceiro / finalizado antigo) vira "remover" (edição manual); no tracking só entram as linhas do painel.
 */
function registrarLinhasBase_(aba, primeira, qtd, origem, comRemocao) {
  if (qtd <= 0) return [];
  const fuso = aba.getParent().getSpreadsheetTimeZone();
  const ctx = contextoBasePainel_(aba);
  if (ctx.iChave < 0) return [];
  const limite = Date.now() - PAINEL_DADOS.DIAS_FINALIZADOS * 864e5;
  const entradas = [];
  aba.getRange(primeira, 1, qtd, ctx.largura).getValues().forEach(function (r) {
    const chave = chavePainel_(r[ctx.iChave], fuso);
    if (!chave) return;
    if (situacaoNoPainel_(r, ctx, limite) === 'incluir') entradas.push(['base', 'gravar', chave, registroBasePainel_(r, ctx, fuso)]);
    else if (comRemocao) entradas.push(['base', 'remover', chave, null]);
  });
  return registrarAlteracoes_(entradas, origem);
}

function registrarLinhasRetorno_(aba, primeira, qtd, origem) {
  if (qtd <= 0) return [];
  const fuso = aba.getParent().getSpreadsheetTimeZone();
  const ctx = contextoRetornoPainel_(aba);
  if (ctx.pos[0] < 0) return [];
  const entradas = [];
  aba.getRange(primeira, 1, qtd, ctx.largura).getValues().forEach(function (r) {
    const chave = chavePainel_(r[ctx.pos[0]], fuso);
    if (chave) entradas.push(['retorno', 'gravar', chave, registroRetornoPainel_(r, ctx, fuso)]);
  });
  return registrarAlteracoes_(entradas, origem);
}

// Para o tracking: falha no registro nunca interrompe o lote (fica pendente para a manutenção)
function registrarLinhasBaseSeguro_(aba, primeira, qtd, origem) {
  try {
    comTravaRegistro_(10000, function () { registrarLinhasBase_(aba, primeira, qtd, origem, false); });
  } catch (e) {
    console.warn('Registro_Alteracoes não gravado: ' + mensagemErro_(e));
    marcarPainelPendente_();
  }
}

/**
 * entradas: [[conjunto (base|retorno|manual), ação, chave, registro|null], …]. Grava as linhas e só depois
 * avança o nº. Devolve as entradas gravadas ([nº, conjunto, ação, chave, dados]).
 */
function registrarAlteracoes_(entradas, origem) {
  if (!entradas.length) return [];
  const props = PropertiesService.getScriptProperties();
  let seq = Number(props.getProperty(PAINEL_DADOS.SEQ_PROP) || 0);
  const agora = new Date();
  const linhas = entradas.map(function (e) {
    return [++seq, agora, e[0], e[1], e[2], e[3] ? JSON.stringify(e[3]) : '', origem || ''];
  });
  const aba = obterAbaPainel_(PAINEL_DADOS.ABA_REGISTRO, PAINEL_DADOS.CABECALHO_REGISTRO);
  const inicio = aba.getLastRow() + 1;
  garantirLinhas_(aba, inicio + linhas.length - 1);
  aba.getRange(inicio, 1, linhas.length, linhas[0].length).setValues(linhas);
  props.setProperty(PAINEL_DADOS.SEQ_PROP, String(seq));
  return linhas.map(function (l) { return [l[0], l[2], l[3], l[4], l[5]]; }); // formato de lerAlteracoesPainel_
}

// [[nº, conjunto, ação, chave, dados], …] com nº > desde, em ordem
function lerAlteracoesPainel_(desde) {
  const aba = obterAbaPainel_(PAINEL_DADOS.ABA_REGISTRO, PAINEL_DADOS.CABECALHO_REGISTRO);
  const total = aba.getLastRow() - 1;
  if (total <= 0) return [];
  return aba.getRange(2, 1, total, 6).getValues()
    .filter(function (r) { return Number(r[0]) > desde; })
    .sort(function (a, b) { return Number(a[0]) - Number(b[0]); })
    .map(function (r) { return [Number(r[0]), String(r[2]), String(r[3]), String(r[4]), String(r[5] || '')]; });
}

// Depois de regerar: tira do registro o que já está no JSON (nº <= ate)
function limparRegistroPainel_(ate) {
  const aba = obterAbaPainel_(PAINEL_DADOS.ABA_REGISTRO, PAINEL_DADOS.CABECALHO_REGISTRO);
  const total = aba.getLastRow() - 1;
  if (total <= 0) return;
  const largura = PAINEL_DADOS.CABECALHO_REGISTRO.length;
  const ficam = aba.getRange(2, 1, total, largura).getValues().filter(function (r) { return Number(r[0]) > ate; });
  aba.getRange(2, 1, total, largura).clearContent();
  if (ficam.length) aba.getRange(2, 1, ficam.length, largura).setValues(ficam);
}

/**
 * Trava curta do registro de alterações e das ações do painel (LockService do documento), separada da
 * trava do script, que o tracking/cruzamentos/importação seguram por minutos. Assim uma ação no painel
 * (ex.: forçar finalizado) funciona durante a atualização: as duas só disputam o instante de gravar no
 * registro. Quem segura a trava do script também pode pegar esta (ordem fixa: script -> documento).
 */
const MSG_REGISTRO_OCUPADO = 'Outra alteração está sendo salva agora. Tente de novo em instantes.';
function comTravaRegistro_(esperaMs, fn) {
  const lock = LockService.getDocumentLock() || LockService.getScriptLock(); // documento: script ligado à planilha
  if (!lock.tryLock(esperaMs)) throw new Error(MSG_REGISTRO_OCUPADO);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function marcarPainelPendente_() {
  try { PropertiesService.getScriptProperties().setProperty(PAINEL_DADOS.PENDENTE_PROP, String(Date.now())); } catch (e) { /* sem saída */ }
}

/* ---------- Edição manual (gatilho simples) ---------- */

/**
 * Edição manual na aba base ou na Retorno_Extensão: registra as linhas editadas (chegam aos painéis em até 30 s).
 * Cabeçalho editado, bloco grande ou trava ocupada: marca pendente e a manutenção regera o JSON.
 * (Gravações feitas pelo próprio script não disparam onEdit; elas registram ou regeram direto.)
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const aba = e.range.getSheet();
    const nome = normalizarTexto_(aba.getName());
    const ehBase = nome === normalizarTexto_(CONFIG.PLANILHA.ABA);
    const ehRetorno = nome === normalizarTexto_(RETORNO_EXTENSAO.aba);
    if (!ehBase && !ehRetorno) return;

    const primeira = Math.max(2, e.range.getRow());
    const qtd = e.range.getLastRow() - primeira + 1;
    if (e.range.getRow() === 1) marcarPainelPendente_(); // cabeçalho mudou: a manutenção regera
    if (qtd <= 0) return;
    if (qtd > PAINEL_DADOS.MAX_LINHAS_EDICAO) { marcarPainelPendente_(); return; }

    // trava curta do registro (não a do script): edição durante o tracking também é registrada
    comTravaRegistro_(3000, function () {
      if (ehBase) registrarLinhasBase_(aba, primeira, qtd, 'edicao', true);
      else registrarLinhasRetorno_(aba, primeira, qtd, 'edicao');
    });
  } catch (erro) {
    marcarPainelPendente_(); // gatilho simples: nunca interrompe a edição
  }
}

/* ---------- Leitura do JSON (cache do servidor ou aba) ---------- */

function lerJsonPainel_(versao) {
  const cache = CacheService.getScriptCache();
  try {
    const metaTexto = cache.get('PAINEL_JSON_' + versao + '_meta');
    if (metaTexto) {
      const meta = JSON.parse(metaTexto);
      const chaves = [];
      for (let i = 0; i < meta.pedacos; i++) chaves.push('PAINEL_JSON_' + versao + '_' + i);
      const partes = cache.getAll(chaves);
      if (chaves.every(function (k) { return partes[k] != null; })) {
        return { meta: meta, dados: chaves.map(function (k) { return partes[k]; }).join('') };
      }
    }
  } catch (e) {
    console.warn('Cache do Painel_JSON ilegível: ' + mensagemErro_(e));
  }

  const aba = obterAbaPainel_(PAINEL_DADOS.ABA_JSON, null);
  const total = aba.getLastRow();
  if (!total) throw new Error('Os dados do painel ainda não foram gerados.');
  const valores = aba.getRange(1, 1, total, 1).getValues();
  const meta = JSON.parse(String(valores[0][0]));
  const pedacos = valores.slice(1, 1 + meta.pedacos).map(function (r) { return String(r[0]).slice(1); });
  const dados = pedacos.join('');
  if (pedacos.length !== meta.pedacos || dados.length !== meta.tamanho) {
    throw new Error('Os dados do painel estão sendo regerados. Tente de novo em instantes.');
  }
  guardarJsonNoCache_(meta, pedacos);
  return { meta: meta, dados: dados };
}

function guardarJsonNoCache_(meta, pedacos) {
  try {
    const valores = {};
    pedacos.forEach(function (p, i) { valores['PAINEL_JSON_' + meta.versao + '_' + i] = p; });
    const cache = CacheService.getScriptCache();
    cache.putAll(valores, PAINEL_DADOS.CACHE_TTL_S);
    cache.put('PAINEL_JSON_' + meta.versao + '_meta', JSON.stringify(meta), PAINEL_DADOS.CACHE_TTL_S); // por último
  } catch (e) {
    console.warn('Painel_JSON não guardado no cache: ' + mensagemErro_(e));
  }
}

/* ---------- Abas ocultas e acionador ---------- */

// Aba oculta do painel (criada se faltar: texto puro, protegida com aviso, oculta)
function obterAbaPainel_(nome, cabecalho) {
  const ss = CONFIG.PLANILHA.ID ? SpreadsheetApp.openById(CONFIG.PLANILHA.ID) : SpreadsheetApp.getActiveSpreadsheet();
  let aba = ss.getSheetByName(nome);
  if (aba) return aba;
  aba = ss.insertSheet(nome);
  aba.getRange(1, 1, aba.getMaxRows(), aba.getMaxColumns()).setNumberFormat('@');
  if (cabecalho) {
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
    aba.setFrozenRows(1);
  }
  try { aba.protect().setDescription('Gerada pelo script (dados do painel). Não editar.').setWarningOnly(true); } catch (e) { /* sem permissão */ }
  aba.hideSheet();
  return aba;
}

function garantirLinhas_(aba, ultimaLinha) {
  const faltam = ultimaLinha - aba.getMaxRows();
  if (faltam > 0) aba.insertRowsAfter(aba.getMaxRows(), faltam);
}

function garantirManutencaoPainel_() {
  const existe = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === PAINEL_DADOS.MANUTENCAO; });
  if (!existe) ScriptApp.newTrigger(PAINEL_DADOS.MANUTENCAO).timeBased().everyMinutes(PAINEL_DADOS.MANUTENCAO_MIN).create();
}

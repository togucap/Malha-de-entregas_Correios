/**
 * Integração com a planilha base: menu, leitura da coluna "Autorização Postagem"
 * e gravação das colunas "Código convertido" e "Status tracking".
 *
 * Por enquanto só as autorizações de postagem (10 dígitos) são consultadas;
 * Jadlog e códigos de rastreio são identificados (Classificador.gs) e deixados como estão.
 */

const CURSOR_PROP = 'REVERSA_PROXIMA_LINHA';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Correios')
    .addItem('Atualizar autorizações de postagem', 'menuAtualizarAutorizacoes')
    .addItem('Reprocessar todas (inclusive finalizadas)', 'menuReprocessarAutorizacoes')
    .addSeparator()
    .addItem('Tela de teste das APIs', 'abrirTeste')
    .addToUi();
}

function menuAtualizarAutorizacoes() { executarPeloMenu_(false); }
function menuReprocessarAutorizacoes() { executarPeloMenu_(true); }

function executarPeloMenu_(reprocessar) {
  const ui = SpreadsheetApp.getUi();
  try {
    ui.alert('Correios', atualizarAutorizacoes(reprocessar), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Correios – erro', String(e && e.message ? e.message : e), ui.ButtonSet.OK);
  }
}

/**
 * Consulta no Web Service de Logística Reversa as linhas cuja coluna "Autorização Postagem"
 * contém uma autorização e grava o código de rastreio e o status atual.
 * Linhas já finalizadas (entregue, cancelada, expirada) são puladas, salvo reprocessar = true.
 * Se o tempo acabar, guarda a próxima linha e continua dali na execução seguinte.
 * Pode ser chamada por gatilho de tempo (o objeto do evento é ignorado).
 */
function atualizarAutorizacoes(reprocessar) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 'Já existe uma atualização em andamento.';
  try {
    return atualizar_(reprocessar === true);
  } finally {
    lock.releaseLock();
  }
}

function atualizar_(reprocessar) {
  const inicio = Date.now();
  const cfg = CONFIG.PLANILHA;
  credenciais_(); // falha antes de qualquer consulta se faltar configuração

  const aba = obterAba_();
  const cab = cfg.LINHA_CABECALHO;
  const colCodigo = indiceColuna_(aba, cfg.COL_CODIGO);
  if (!colCodigo) throw new Error('Coluna "' + cfg.COL_CODIGO + '" não encontrada na aba "' + aba.getName() + '".');
  const colConvertido = garantirColuna_(aba, cfg.COL_CONVERTIDO);
  const colStatus = garantirColuna_(aba, cfg.COL_STATUS);

  const total = aba.getLastRow() - cab;
  if (total <= 0) return 'Nenhuma linha para processar.';

  const codigos = aba.getRange(cab + 1, colCodigo, total, 1).getValues();
  const rngConvertido = aba.getRange(cab + 1, colConvertido, total, 1);
  const rngStatus = aba.getRange(cab + 1, colStatus, total, 1);
  const convertidos = rngConvertido.getValues();
  const status = rngStatus.getValues();

  const props = PropertiesService.getScriptProperties();
  const primeiro = Math.max(0, Number(props.getProperty(CURSOR_PROP) || 0) - (cab + 1));

  const pendentes = [];
  for (let i = primeiro; i < total; i++) {
    if (classificarCodigo_(codigos[i][0]) !== TIPO_CODIGO.AUTORIZACAO) continue;
    if (!reprocessar && statusFinalizado_(status[i][0])) continue;
    pendentes.push(i);
  }

  let proxima = null; // índice da primeira linha ainda não consultada
  let feitas = 0;
  try {
    for (let p = 0; p < pendentes.length; p += cfg.LOTE) {
      const lote = pendentes.slice(p, p + cfg.LOTE);
      proxima = lote[0];
      if (Date.now() - inicio > cfg.TEMPO_MAXIMO_MS) break;

      const numeros = lote.map(function (i) { return normalizarCodigo_(codigos[i][0]); });
      consultarReversaLote_(numeros, 'A').forEach(function (resp, k) {
        const i = lote[k];
        const res = resultadoAutorizacao_(numeros[k], resp);
        if (res.codigo !== undefined) convertidos[i][0] = res.codigo;
        status[i][0] = res.status;
      });
      feitas += lote.length;
      proxima = null;
    }
  } finally {
    rngConvertido.setValues(convertidos);
    rngStatus.setValues(status);
    if (proxima === null) props.deleteProperty(CURSOR_PROP);
    else props.setProperty(CURSOR_PROP, String(cab + 1 + proxima));
  }

  let msg = feitas + ' autorização(ões) consultada(s) na aba "' + aba.getName() + '".';
  if (proxima !== null) {
    msg += ' Tempo limite atingido: execute novamente para continuar a partir da linha ' + (cab + 1 + proxima) + '.';
  }
  return msg;
}

// Converte a resposta do Web Service em { codigo, status } para a planilha
function resultadoAutorizacao_(numero, resp) {
  const r = interpretarReversa_(resp.body);
  if (resp.status !== 200) return { status: 'Erro HTTP ' + resp.status + (r.erro ? ': ' + r.erro : '') };

  const semZeros = function (n) { return String(n).replace(/^0+/, ''); };
  const aut = r.autorizacoes.filter(function (a) { return semZeros(a.numero) === semZeros(numero); })[0] ||
    (r.autorizacoes.length === 1 ? r.autorizacoes[0] : null);
  if (!aut) return { status: r.erro ? 'Erro: ' + r.erro : 'Autorização não encontrada' };

  const atual = statusAtual_(aut);
  return { codigo: codigosRastreio_(aut), status: atual ? atual.descricao : '' };
}

// Entregue, cancelada ou prazo expirado: não muda mais, não precisa consultar de novo
function statusFinalizado_(texto) {
  return /entregue|cancelad|expirad/.test(normalizarTexto_(texto));
}

/* ---------- Auxiliares da planilha ---------- */

function obterAba_() {
  const cfg = CONFIG.PLANILHA;
  const ss = cfg.ID ? SpreadsheetApp.openById(cfg.ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Planilha não encontrada: preencha CONFIG.PLANILHA.ID ou vincule o script à planilha.');

  if (cfg.ABA) {
    const aba = ss.getSheetByName(cfg.ABA);
    if (!aba) throw new Error('Aba "' + cfg.ABA + '" não encontrada.');
    return aba;
  }
  const aba = ss.getSheets().filter(function (a) { return indiceColuna_(a, cfg.COL_CODIGO); })[0];
  if (!aba) throw new Error('Nenhuma aba tem a coluna "' + cfg.COL_CODIGO + '" no cabeçalho.');
  return aba;
}

// Número (1-based) da coluna cujo cabeçalho é `nome`, ignorando maiúsculas, acentos e espaços extras; 0 se não houver
function indiceColuna_(aba, nome) {
  const ultima = aba.getLastColumn();
  if (!ultima) return 0;
  const alvo = normalizarTexto_(nome);
  const cab = aba.getRange(CONFIG.PLANILHA.LINHA_CABECALHO, 1, 1, ultima).getValues()[0];
  return cab.map(normalizarTexto_).indexOf(alvo) + 1;
}

// Garante a coluna no fim do cabeçalho (copiando a formatação do cabeçalho vizinho)
function garantirColuna_(aba, nome) {
  const existente = indiceColuna_(aba, nome);
  if (existente) return existente;

  const linha = CONFIG.PLANILHA.LINHA_CABECALHO;
  const col = aba.getLastColumn() + 1;
  if (col > aba.getMaxColumns()) aba.insertColumnAfter(aba.getMaxColumns());
  if (col > 1) aba.getRange(linha, col - 1).copyFormatToRange(aba, col, col, linha, linha);
  aba.getRange(linha, col).setValue(nome);
  return col;
}

function normalizarTexto_(v) {
  return String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

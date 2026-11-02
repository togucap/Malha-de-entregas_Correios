/**
 * Integração com a planilha base: menu, leitura da coluna "Autorização Postagem"
 * e gravação das colunas "Código convertido" e "Status tracking".
 *
 * Por enquanto só as autorizações de postagem (10 dígitos) são consultadas;
 * Jadlog e códigos de rastreio são identificados (Classificador.gs) e deixados como estão.
 */

const CURSOR_PROP = 'REVERSA_PROXIMA_LINHA';
const REPROCESSAR_PROP = 'REVERSA_REPROCESSAR';
const FALHAS_PROP = 'REVERSA_FALHAS';
const FUNCAO_CONTINUACAO = 'continuarAtualizacao';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Correios')
    .addItem('Atualizar autorizações de postagem', 'menuAtualizarAutorizacoes')
    .addItem('Reprocessar todas (inclusive finalizadas)', 'menuReprocessarAutorizacoes')
    .addItem('Cancelar continuação automática', 'menuCancelarContinuacao')
    .addSeparator()
    .addItem('Tela de teste das APIs', 'abrirTeste')
    .addToUi();
}

function menuAtualizarAutorizacoes() { executarPeloMenu_(false); }
function menuReprocessarAutorizacoes() { executarPeloMenu_(true); }

// Avisos por toast (canto da planilha): não bloqueiam a execução nem pedem clique
function executarPeloMenu_(reprocessar) {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Consultando autorizações. Se o tempo limite for atingido, a atualização continua sozinha.', 'Correios', 10);
  try {
    ss.toast(atualizarAutorizacoes(reprocessar), 'Correios', 30);
  } catch (e) {
    ss.toast(String(e && e.message ? e.message : e), 'Correios – erro', 60);
  }
}

function menuCancelarContinuacao() {
  const ss = SpreadsheetApp.getActive();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    ss.toast('Há uma atualização em andamento. Tente cancelar novamente em alguns minutos.', 'Correios', 15);
    return;
  }
  try {
    encerrarCiclo_();
  } finally {
    lock.releaseLock();
  }
  ss.toast('Continuação automática cancelada. A próxima atualização começa do início da planilha.', 'Correios', 15);
}

/**
 * Consulta no Web Service de Logística Reversa as linhas cuja coluna "Autorização Postagem"
 * contém uma autorização e grava o código de rastreio e o status atual.
 * Linhas já finalizadas (entregue, cancelada, expirada) são puladas, salvo reprocessar = true.
 * Se o tempo acabar, guarda a próxima linha e agenda continuarAtualizacao(), que segue dali
 * sozinha até o fim da planilha.
 * Pode ser chamada por gatilho de tempo (o objeto do evento é ignorado).
 */
function atualizarAutorizacoes(reprocessar) {
  return executarComLock_(reprocessar === true, false);
}

// Disparada pelos gatilhos de uso único agendados por atualizar_
function continuarAtualizacao(e) {
  // gatilhos de uso único continuam listados depois de disparar; apaga só o que disparou
  removerContinuacao_(e && e.triggerUid);
  const reprocessar = PropertiesService.getScriptProperties().getProperty(REPROCESSAR_PROP) === 'S';
  console.log(executarComLock_(reprocessar, true));
}

function executarComLock_(reprocessar, automatico) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 'Já existe uma atualização em andamento.';
  try {
    return atualizar_(reprocessar, automatico);
  } finally {
    lock.releaseLock();
  }
}

function atualizar_(reprocessar, automatico) {
  const inicio = Date.now();
  const cfg = CONFIG.PLANILHA;
  const props = PropertiesService.getScriptProperties();
  credenciais_(); // falha antes de qualquer consulta se faltar configuração

  // Execuções automáticas seguidas sem gravar nenhum lote (erro ou "Tempo máximo de execução
  // excedido") param o ciclo; o cursor fica para a próxima execução pelo menu.
  const falhas = automatico ? Number(props.getProperty(FALHAS_PROP) || 0) : 0;
  if (falhas >= cfg.MAX_FALHAS) {
    removerContinuacao_();
    props.deleteProperty(FALHAS_PROP);
    const cursor = props.getProperty(CURSOR_PROP);
    throw new Error('Continuação automática interrompida após ' + falhas +
      ' execução(ões) seguida(s) sem avanço. Execute pelo menu para ' +
      (cursor ? 'retomar da linha ' + cursor : 'recomeçar') + '.');
  }

  const aba = obterAba_();
  const cab = cfg.LINHA_CABECALHO;
  const colCodigo = indiceColuna_(aba, cfg.COL_CODIGO);
  if (!colCodigo) throw new Error('Coluna "' + cfg.COL_CODIGO + '" não encontrada na aba "' + aba.getName() + '".');
  const colConvertido = garantirColuna_(aba, cfg.COL_CONVERTIDO);
  const colStatus = garantirColuna_(aba, cfg.COL_STATUS);

  const total = aba.getLastRow() - cab;
  if (total <= 0) {
    encerrarCiclo_();
    return 'Nenhuma linha para processar.';
  }

  const codigos = aba.getRange(cab + 1, colCodigo, total, 1).getValues();
  const convertidos = aba.getRange(cab + 1, colConvertido, total, 1).getValues();
  const status = aba.getRange(cab + 1, colStatus, total, 1).getValues();

  const primeiro = Math.max(0, Number(props.getProperty(CURSOR_PROP) || 0) - (cab + 1));
  const pendentes = [];
  for (let i = primeiro; i < total; i++) {
    if (classificarCodigo_(codigos[i][0]) !== TIPO_CODIGO.AUTORIZACAO) continue;
    if (!reprocessar && statusFinalizado_(status[i][0])) continue;
    pendentes.push(i);
  }

  // Rede de segurança: se o Apps Script encerrar esta execução à força, este gatilho
  // retoma do último lote gravado. É substituído no fim normal da execução.
  props.setProperty(FALHAS_PROP, String(falhas + 1)); // volta a 0 quando um lote é gravado
  agendarContinuacao_(reprocessar, cfg.ESPERA_SEGURANCA_MS);

  let proxima = null; // índice da primeira linha ainda não consultada
  let feitas = 0;
  let maiorLote = 0;  // duração do lote mais demorado, usada para prever o próximo
  let erro = null;
  for (let p = 0; p < pendentes.length; p += cfg.LOTE) {
    const lote = pendentes.slice(p, p + cfg.LOTE);
    proxima = lote[0];
    if (Date.now() - inicio + maiorLote > cfg.TEMPO_MAXIMO_MS) break;

    const t0 = Date.now();
    try {
      const numeros = lote.map(function (i) { return normalizarCodigo_(codigos[i][0]); });
      consultarReversaLote_(numeros, 'A').forEach(function (resp, k) {
        const i = lote[k];
        const res = resultadoAutorizacao_(numeros[k], resp);
        if (res.codigo !== undefined) convertidos[i][0] = res.codigo;
        status[i][0] = res.status;
      });

      // grava a faixa do lote na hora, para não perder nada se a execução for encerrada
      const de = lote[0], ate = lote[lote.length - 1];
      aba.getRange(cab + 1 + de, colConvertido, ate - de + 1, 1).setValues(convertidos.slice(de, ate + 1));
      aba.getRange(cab + 1 + de, colStatus, ate - de + 1, 1).setValues(status.slice(de, ate + 1));
    } catch (e) {
      erro = e;
      break;
    }

    maiorLote = Math.max(maiorLote, Date.now() - t0);
    feitas += lote.length;
    proxima = p + cfg.LOTE < pendentes.length ? pendentes[p + cfg.LOTE] : null;
    if (proxima !== null) props.setProperty(CURSOR_PROP, String(cab + 1 + proxima));
    if (feitas === lote.length) props.setProperty(FALHAS_PROP, '0');
  }

  let msg = feitas + ' autorização(ões) consultada(s) na aba "' + aba.getName() + '".';
  if (proxima === null) {
    encerrarCiclo_();
    return msg;
  }

  const linha = cab + 1 + proxima;
  props.setProperty(CURSOR_PROP, String(linha));
  agendarContinuacao_(reprocessar, cfg.ESPERA_CONTINUACAO_MS);
  const espera = Math.round(cfg.ESPERA_CONTINUACAO_MS / 60000) + ' min';

  if (erro) {
    const texto = erro && erro.message ? erro.message : erro;
    console.warn('Falha na linha ' + linha + ': ' + texto);
    return msg + ' Falha de comunicação na linha ' + linha + ' (' + texto + '); nova tentativa automática em ~' + espera + '.';
  }
  return msg + ' Tempo limite atingido: a atualização continua sozinha em ~' + espera + ' a partir da linha ' + linha + '.';
}

/* ---------- Continuação automática (gatilho de tempo de uso único) ---------- */

function agendarContinuacao_(reprocessar, esperaMs) {
  removerContinuacao_();
  PropertiesService.getScriptProperties().setProperty(REPROCESSAR_PROP, reprocessar ? 'S' : 'N');
  ScriptApp.newTrigger(FUNCAO_CONTINUACAO).timeBased().after(esperaMs).create();
}

// Sem uid, apaga todos os gatilhos de continuação; com uid, só o que disparou
function removerContinuacao_(uid) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() !== FUNCAO_CONTINUACAO) return;
    if (uid && t.getUniqueId() !== uid) return;
    ScriptApp.deleteTrigger(t);
  });
}

// Fim da planilha (ou cancelamento): limpa cursor, modo, contador de falhas e gatilho pendente
function encerrarCiclo_() {
  const props = PropertiesService.getScriptProperties();
  [CURSOR_PROP, REPROCESSAR_PROP, FALHAS_PROP].forEach(function (k) { props.deleteProperty(k); });
  removerContinuacao_();
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

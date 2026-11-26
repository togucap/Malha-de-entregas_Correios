/**
 * Cruzamento manual da aba "Retorno_Extensão" com o relatório Consolidado_Anymarket_OUT do Drive:
 * Pedido_Shopee (pedido da Shopee) × parceiro_pedido -> grava pedido_codigo na coluna "Pedido"
 * (criada se não existir, como texto). Por enquanto só pelo menu Correios › "Cruzar Retorno_Extensão
 * com Anymarket (Pedido)"; não faz parte da cadeia.
 *
 * Usa o mesmo motor dos cruzamentos da base (executarEtapaCruzamento_): primeiro valor preenchido do
 * relatório para cada Pedido_Shopee; sem correspondência, a célula fica como estava. O CSV é lido em
 * partes; se o tempo acabar, a posição fica em CRUZ_SHOPEE_ESTADO e o gatilho de uso único
 * continuarCruzamentoShopee segue em ~1 min (com gatilho de segurança, como nos demais).
 * A importação da aba Retorno_Extensão e "Cancelar continuação automática" cancelam uma rodada em andamento.
 */

const CRUZAMENTO_SHOPEE = {
  id: 'pedidoShopee', // mapas de bits em CRUZ_BITS_pedidoShopee_* (não colide com os de CRUZAMENTOS)
  rotulo: 'Pedido Shopee',
  pasta: '1Zk2F78ImtNqEDF_pULHe-74qwxaMH2xe',
  arquivo: 'Consolidado_Anymarket_OUT',
  aba: '',
  chaveBase: 'Pedido_Shopee',
  chaveRelatorio: 'parceiro_pedido',
  colunas: [{ relatorio: 'pedido_codigo', base: 'Pedido', texto: true }]
};
const CRUZ_SHOPEE_ESTADO_PROP = 'CRUZ_SHOPEE_ESTADO';
const FUNCAO_CONTINUAR_CRUZ_SHOPEE = 'continuarCruzamentoShopee';

function menuCruzarPedidoShopee() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Cruzando a aba Retorno_Extensão com o Consolidado_Anymarket_OUT...', 'Correios', 10);
  try {
    ss.toast(iniciarCruzamentoShopee_(), 'Correios', 60);
  } catch (e) {
    ss.toast(mensagemErro_(e), 'Correios – erro', 60);
  }
}

// Para o editor
function cruzarPedidoShopee() {
  return iniciarCruzamentoShopee_();
}

function iniciarCruzamentoShopee_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return MSG_OCUPADO;
  try {
    limparCruzamentoShopee_();
    return executarCruzamentoShopee_({ csv: null, semAvanco: 0 });
  } finally {
    lock.releaseLock();
  }
}

// Gatilho de uso único (continuação ou segurança)
function continuarCruzamentoShopee(e) {
  removerGatilhos_(FUNCAO_CONTINUAR_CRUZ_SHOPEE, e && e.triggerUid);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { // outra execução em andamento: tenta de novo depois
    agendarGatilho_(FUNCAO_CONTINUAR_CRUZ_SHOPEE, CONFIG.PLANILHA.ESPERA_CONTINUACAO_MS);
    return;
  }
  try {
    const texto = PropertiesService.getScriptProperties().getProperty(CRUZ_SHOPEE_ESTADO_PROP);
    if (!texto) return;
    console.log(executarCruzamentoShopee_(JSON.parse(texto)));
  } finally {
    lock.releaseLock();
  }
}

/** estado = { csv: retomada do CSV ou null, semAvanco, linhas: última linha da aba no início }. */
function executarCruzamentoShopee_(estado) {
  const cfg = CONFIG.PLANILHA;
  const c = CRUZAMENTO_SHOPEE;
  const aba = obterAbaRetornoExtensao_(true);
  const fim = function (msg, erro) {
    limparCruzamentoShopee_();
    if (aba) registrarCruzamentoShopee_(aba, msg);
    (erro ? console.warn : console.log)(msg);
    return msg;
  };
  if (!aba) return fim('Pedido (Shopee): aba "' + RETORNO_EXTENSAO.aba + '" não encontrada; importe o Retorno_Extensão primeiro.', true);

  estado.semAvanco = (estado.semAvanco || 0) + 1;
  if (estado.semAvanco > cfg.MAX_FALHAS) {
    return fim('Pedido (Shopee): interrompido após ' + cfg.MAX_FALHAS + ' execuções seguidas sem avanço. Rode de novo pelo menu.', true);
  }
  // as posições das linhas são guardadas entre as partes: se a aba mudou, a rodada não vale mais
  if (estado.csv && estado.linhas !== aba.getLastRow()) {
    return fim('Pedido (Shopee): a aba Retorno_Extensão mudou durante o cruzamento; rode de novo pelo menu.', true);
  }
  estado.linhas = aba.getLastRow();
  // rede de segurança: se o Apps Script encerrar esta execução à força, retoma do último ponto salvo
  salvarEstadoCruzamentoShopee_(estado);
  agendarGatilho_(FUNCAO_CONTINUAR_CRUZ_SHOPEE, cfg.ESPERA_SEGURANCA_MS);

  let r;
  try {
    r = executarEtapaCruzamento_(aba, c, Date.now() + cfg.TEMPO_MAXIMO_MS, estado.csv);
  } catch (e) {
    return fim('Pedido (Shopee): ERRO – ' + mensagemErro_(e), true);
  }
  if (!r.concluida) {
    estado.csv = r.retomada;
    estado.semAvanco = 0;
    salvarEstadoCruzamentoShopee_(estado);
    agendarGatilho_(FUNCAO_CONTINUAR_CRUZ_SHOPEE, cfg.ESPERA_CONTINUACAO_MS);
    return 'Pedido (Shopee): ' + r.progresso + '% do ' + c.arquivo + ' lido. Continua sozinho em ~1 min; o resultado fica na nota do cabeçalho "' + c.colunas[0].base + '".';
  }
  return fim('Pedido (Shopee): ' + r.msg);
}

function salvarEstadoCruzamentoShopee_(estado) {
  PropertiesService.getScriptProperties().setProperty(CRUZ_SHOPEE_ESTADO_PROP, JSON.stringify(estado));
}

// Fim, erro ou cancelamento: apaga estado, mapas de bits e gatilho pendente
function limparCruzamentoShopee_() {
  PropertiesService.getScriptProperties().deleteProperty(CRUZ_SHOPEE_ESTADO_PROP);
  apagarBits_(CRUZAMENTO_SHOPEE.id);
  removerGatilhos_(FUNCAO_CONTINUAR_CRUZ_SHOPEE);
}

// Cancela uma rodada em andamento; devolve true se havia uma
function cancelarCruzamentoShopee_() {
  const havia = !!PropertiesService.getScriptProperties().getProperty(CRUZ_SHOPEE_ESTADO_PROP);
  if (havia) limparCruzamentoShopee_();
  return havia;
}

// Resultado como nota no cabeçalho da coluna "Pedido" (a nota de Pedido_Shopee é da importação)
function registrarCruzamentoShopee_(aba, msg) {
  const col = indiceColuna_(aba, CRUZAMENTO_SHOPEE.colunas[0].base);
  if (!col) return;
  const quando = Utilities.formatDate(new Date(), aba.getParent().getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm');
  aba.getRange(CONFIG.PLANILHA.LINHA_CABECALHO, col)
    .setNote('Último cruzamento com o ' + CRUZAMENTO_SHOPEE.arquivo + ' (' + quando + '):\n' + msg);
}

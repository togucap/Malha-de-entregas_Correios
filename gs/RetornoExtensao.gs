/**
 * Aba "Retorno_Extensão": abastecida com o arquivo JSON "Retorno_Extensao_Shopee" do Drive
 * (gerado pela extensão de retornos da Shopee). Para cada pedido grava pedido, situacao, prazo e origem.
 *
 * Formato do arquivo (confirmado, versao 1):
 *   { versao, atualizadoEm, totalPedidos, pedidos: { "<pedido>": { pedido, primeiroEnvio, situacao,
 *     statusSolicitacao, prazo, venceAprox, origem, ultimoEnvio, enviadoPor } } }
 * Só os 4 campos pedidos são lidos; os demais (inclusive quem enviou) não são gravados.
 *
 * A aba é regravada inteira a cada importação (o arquivo é a fonte; pedido que sai do arquivo sai da aba).
 * Entradas: menu Correios › "Importar Retorno_Extensão (Shopee)", dentro da cadeia (logo após a
 * importação dos protocolos) e importarRetornoExtensao() para acionador/editor.
 */

const RETORNO_EXTENSAO = {
  pasta: '1Zk2F78ImtNqEDF_pULHe-74qwxaMH2xe', // drive compartilhado (a mesma do Consolidado_Anymarket_OUT)
  arquivo: 'Retorno_Extensao_Shopee',         // achado com ou sem ".json"
  aba: 'Retorno_Extensão',                    // localizada sem diferenciar acento/maiúsculas; criada se não existir
  campos: ['pedido', 'situacao', 'prazo', 'origem'] // também são os títulos das colunas
};

function menuImportarRetornoExtensao() {
  const ss = SpreadsheetApp.getActive();
  const r = importarRetornoExtensao_();
  ss.toast(r.msg, r.ok ? 'Correios' : 'Correios – erro', 30);
}

// Para acionador ou editor
function importarRetornoExtensao() {
  return importarRetornoExtensao_().msg;
}

/** Lê o JSON e regrava a aba. Devolve { ok, msg, linhas }; erro não lança (a aba fica como estava). */
function importarRetornoExtensao_() {
  const cfg = RETORNO_EXTENSAO;
  try {
    const arquivo = acharArquivoRelatorio_(cfg.pasta, cfg.arquivo);
    let dados;
    try {
      dados = JSON.parse(arquivo.getBlob().getDataAsString('UTF-8').replace(/^﻿/, ''));
    } catch (e) {
      throw new Error('"' + arquivo.getName() + '" não é um JSON válido (' + mensagemErro_(e) + ')');
    }

    // "pedidos" como objeto { pedido: {...} } (formato atual) ou lista [{...}]
    const pedidos = dados && dados.pedidos;
    if (!pedidos || typeof pedidos !== 'object') throw new Error('"' + arquivo.getName() + '" não tem a lista "pedidos"');
    const registros = Array.isArray(pedidos) ? pedidos : Object.keys(pedidos).map(function (k) {
      const r = pedidos[k] || {};
      return r.pedido ? r : Object.assign({ pedido: k }, r);
    });

    const linhas = registros
      .map(function (r) { return cfg.campos.map(function (c) { return r[c] == null ? '' : String(r[c]).trim(); }); })
      .filter(function (l) { return l[0] !== ''; });

    const aba = obterAbaRetornoExtensao_();
    aba.clearContents();
    aba.getRange(1, 1, 1, cfg.campos.length).setValues([cfg.campos]).setFontWeight('bold');
    if (linhas.length) {
      // pedido como texto: códigos só com dígitos não viram número nem perdem zeros
      aba.getRange(2, 1, linhas.length, 1).setNumberFormat('@');
      aba.getRange(2, 1, linhas.length, cfg.campos.length).setValues(linhas);
    }
    aba.setFrozenRows(1);

    const fuso = aba.getParent().getSpreadsheetTimeZone();
    const agora = Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm');
    aba.getRange(1, 1).setNote('Importado de "' + arquivo.getName() + '" em ' + agora +
      (dados.atualizadoEm ? ' (arquivo atualizado em ' + dados.atualizadoEm + ')' : '') + '. A aba é regravada a cada importação.');

    const msg = 'Retorno_Extensão: ' + linhas.length + ' pedido(s) gravado(s) de "' + arquivo.getName() + '"' +
      (dados.totalPedidos != null && Number(dados.totalPedidos) !== linhas.length ? ' (o arquivo informa ' + dados.totalPedidos + ')' : '') + '.';
    console.log(msg);
    return { ok: true, msg: msg, linhas: linhas.length };
  } catch (e) {
    const msg = 'Retorno_Extensão não atualizada: ' + mensagemErro_(e) + '.';
    console.warn(msg);
    return { ok: false, msg: msg, linhas: 0 };
  }
}

// Aba pelo nome sem diferenciar acentos/maiúsculas ("Retorno_Extensão" = "retorno_extensao"); cria se faltar
function obterAbaRetornoExtensao_() {
  const ss = CONFIG.PLANILHA.ID ? SpreadsheetApp.openById(CONFIG.PLANILHA.ID) : SpreadsheetApp.getActiveSpreadsheet();
  const alvo = normalizarTexto_(RETORNO_EXTENSAO.aba);
  const existente = ss.getSheets().filter(function (a) { return normalizarTexto_(a.getName()) === alvo; })[0];
  return existente || ss.insertSheet(RETORNO_EXTENSAO.aba);
}

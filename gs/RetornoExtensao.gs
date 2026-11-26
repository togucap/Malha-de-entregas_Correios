/**
 * Aba "Retorno_Extensão": abastecida com o arquivo JSON "Retorno_Extensao_Shopee" do Drive
 * (gerado pela extensão de retornos da Shopee). Para cada pedido grava Pedido_Shopee, situacao, prazo, origem e
 * statusSolicitacao.
 *
 * Formato do arquivo (confirmado, versao 1):
 *   { versao, atualizadoEm, totalPedidos, pedidos: { "<pedido>": { pedido, primeiroEnvio, situacao,
 *     statusSolicitacao, prazo, venceAprox, origem, ultimoEnvio, enviadoPor } } }
 * Só os campos de RETORNO_EXTENSAO.colunas são lidos; os demais (inclusive quem enviou) não são gravados.
 *
 * As linhas são regravadas a cada importação (o arquivo é a fonte; pedido que sai do arquivo sai da aba).
 * Colunas que não vêm do arquivo (ex.: "Pedido", preenchida pelo cruzamento de CruzamentoShopee.gs) são
 * mantidas: o valor acompanha o Pedido_Shopee da linha. A ordem das colunas na aba é preservada.
 * Entradas: menu Correios › "Importar Retorno_Extensão (Shopee)", dentro da cadeia (logo após a
 * importação dos protocolos) e importarRetornoExtensao() para acionador/editor.
 */

const RETORNO_EXTENSAO = {
  pasta: '1Zk2F78ImtNqEDF_pULHe-74qwxaMH2xe', // drive compartilhado (a mesma do Consolidado_Anymarket_OUT)
  arquivo: 'Retorno_Extensao_Shopee',         // achado com ou sem ".json"
  aba: 'Retorno_Extensão',                    // localizada sem diferenciar acento/maiúsculas; criada se não existir
  // campo do JSON -> título da coluna na aba (a primeira é a chave da linha)
  colunas: [
    { campo: 'pedido', titulo: 'Pedido_Shopee', tituloAntigo: 'pedido' }, // "pedido" = título até nov/2026
    { campo: 'situacao', titulo: 'situacao' },
    { campo: 'prazo', titulo: 'prazo' },
    { campo: 'origem', titulo: 'origem' },
    { campo: 'statusSolicitacao', titulo: 'statusSolicitacao' } // nov/2026: entra no fim das abas que já existiam
  ]
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

/** Lê o JSON e regrava as linhas da aba. Devolve { ok, msg, linhas }; erro não lança (a aba fica como estava). */
function importarRetornoExtensao_() {
  const cfg = RETORNO_EXTENSAO;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, msg: 'Retorno_Extensão não atualizada: ' + MSG_OCUPADO, linhas: 0 };
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
    const chave = cfg.colunas[0].campo;
    const registros = Array.isArray(pedidos) ? pedidos : Object.keys(pedidos).map(function (k) {
      const r = pedidos[k] || {};
      if (r[chave]) return r;
      const comChave = Object.assign({}, r);
      comChave[chave] = k;
      return comChave;
    });
    const texto = function (v) { return v == null ? '' : String(v).trim(); };
    const novos = registros.filter(function (r) { return texto(r[chave]) !== ''; });

    const aba = obterAbaRetornoExtensao_();
    const anterior = lerRetornoExtensao_(aba);
    const cabecalho = anterior.cabecalho;
    const posCampo = cfg.colunas.map(function (c) { return cabecalho.map(normalizarTexto_).indexOf(normalizarTexto_(c.titulo)); });
    const iChave = posCampo[0];
    const extras = [];
    cabecalho.forEach(function (_, i) { if (posCampo.indexOf(i) < 0) extras.push(i); });

    // colunas extras: valor da importação anterior, pelo Pedido_Shopee (antes de limpar a aba)
    const extrasPorChave = Object.create(null);
    anterior.linhas.forEach(function (l) {
      const k = chaveCruzamento_(l[iChave]);
      if (k && !extrasPorChave[k]) extrasPorChave[k] = l;
    });
    const extrasTexto = extras.filter(function (i) {
      return anterior.linhas.length && aba.getRange(2, i + 1).getNumberFormat() === '@';
    });

    const linhas = novos.map(function (r) {
      const antiga = extrasPorChave[chaveCruzamento_(texto(r[chave]))];
      return cabecalho.map(function (_, i) {
        const k = posCampo.indexOf(i);
        if (k >= 0) return texto(r[cfg.colunas[k].campo]);
        return antiga ? antiga[i] : '';
      });
    });

    if (aba.getLastRow() > 1) aba.getRange(2, 1, aba.getLastRow() - 1, Math.max(aba.getLastColumn(), cabecalho.length)).clearContent();
    aba.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
    posCampo.forEach(function (i) { aba.getRange(1, i + 1).setFontWeight('bold'); });
    if (linhas.length) {
      // Pedido_Shopee (e extras que já eram texto, como "Pedido") como texto: códigos só com dígitos não viram número
      [iChave].concat(extrasTexto).forEach(function (i) { aba.getRange(2, i + 1, linhas.length, 1).setNumberFormat('@'); });
      aba.getRange(2, 1, linhas.length, cabecalho.length).setValues(linhas);
    }
    aba.setFrozenRows(1);
    invalidarDadosPainel_();

    const fuso = aba.getParent().getSpreadsheetTimeZone();
    const agora = Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm');
    aba.getRange(1, iChave + 1).setNote('Importado de "' + arquivo.getName() + '" em ' + agora +
      (dados.atualizadoEm ? ' (arquivo atualizado em ' + dados.atualizadoEm + ')' : '') +
      '. As linhas são regravadas a cada importação; colunas que não vêm do arquivo acompanham o Pedido_Shopee.');

    // as linhas mudaram de posição: um cruzamento do "Pedido" pela metade não vale mais
    const cancelado = cancelarCruzamentoShopee_();
    const nomesExtras = extras.map(function (i) { return cabecalho[i]; }).filter(String);
    const msg = 'Retorno_Extensão: ' + linhas.length + ' pedido(s) gravado(s) de "' + arquivo.getName() + '"' +
      (dados.totalPedidos != null && Number(dados.totalPedidos) !== linhas.length ? ' (o arquivo informa ' + dados.totalPedidos + ')' : '') +
      (nomesExtras.length ? '; coluna(s) mantida(s) pelo Pedido_Shopee: ' + nomesExtras.join(', ') : '') + '.' +
      (cancelado ? ' O cruzamento do "Pedido" em andamento foi cancelado (as linhas mudaram); rode de novo pelo menu.' : '');
    console.log(msg);
    return { ok: true, msg: msg, linhas: linhas.length };
  } catch (e) {
    const msg = 'Retorno_Extensão não atualizada: ' + mensagemErro_(e) + '.';
    console.warn(msg);
    return { ok: false, msg: msg, linhas: 0 };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Cabeçalho e linhas atuais da aba. O cabeçalho mantém a ordem e os títulos existentes; as colunas do
 * arquivo que faltam entram no fim. "pedido" (título antigo da chave) vira "Pedido_Shopee".
 */
function lerRetornoExtensao_(aba) {
  const largura = aba.getLastColumn();
  const altura = aba.getLastRow();
  let cabecalho = largura ? aba.getRange(1, 1, 1, largura).getValues()[0].map(function (v) { return String(v == null ? '' : v).trim(); }) : [];
  while (cabecalho.length && cabecalho[cabecalho.length - 1] === '') cabecalho.pop();
  const linhas = altura > 1 && cabecalho.length ? aba.getRange(2, 1, altura - 1, cabecalho.length).getValues() : [];

  const norm = cabecalho.map(normalizarTexto_);
  const chave = RETORNO_EXTENSAO.colunas[0];
  if (norm.indexOf(normalizarTexto_(chave.titulo)) < 0) {
    const antigo = norm.indexOf(normalizarTexto_(chave.tituloAntigo));
    if (antigo >= 0) cabecalho[antigo] = chave.titulo;
  }
  RETORNO_EXTENSAO.colunas.forEach(function (c) {
    if (cabecalho.map(normalizarTexto_).indexOf(normalizarTexto_(c.titulo)) < 0) cabecalho.push(c.titulo);
  });
  return { cabecalho: cabecalho, linhas: linhas };
}

// Aba pelo nome sem diferenciar acentos/maiúsculas ("Retorno_Extensão" = "retorno_extensao"); cria se faltar
function obterAbaRetornoExtensao_(naoCriar) {
  const ss = CONFIG.PLANILHA.ID ? SpreadsheetApp.openById(CONFIG.PLANILHA.ID) : SpreadsheetApp.getActiveSpreadsheet();
  const alvo = normalizarTexto_(RETORNO_EXTENSAO.aba);
  const existente = ss.getSheets().filter(function (a) { return normalizarTexto_(a.getName()) === alvo; })[0];
  if (existente || naoCriar) return existente || null;
  return ss.insertSheet(RETORNO_EXTENSAO.aba);
}

/**
 * Consulta Jadlog via Intelipost, pelo Web App proxy corporativo.
 * - URL do proxy na Propriedade do script INTELIPOST_PROXY_URL (endereço interno, fora do repositório).
 * - Autenticação: token OAuth de quem executa (ScriptApp.getOAuthToken); o proxy só aceita
 *   contas com acesso ao Web App no domínio corporativo.
 * - Código consultado: "Protocolo" da linha + "RE" (ex.: 4293792261107 -> 4293792261107RE),
 *   só para linhas cuja "Autorização Postagem" é Jadlog (14 dígitos).
 * - Requisição: POST { pedidos: [...] }; resposta: { sucesso, dados, erro }.
 * Por enquanto só há a consulta crua (tela de teste), para conhecer o formato de `dados`.
 */

const PROP_INTELIPOST_URL = 'INTELIPOST_PROXY_URL';
const HOST_INTELIPOST = 'https://script.google.com/';

function urlIntelipost_() {
  const url = String(PropertiesService.getScriptProperties().getProperty(PROP_INTELIPOST_URL) || '').trim();
  if (!url) throw new Error('Cadastre nas Propriedades do script: ' + PROP_INTELIPOST_URL + ' (URL do Web App proxy da Intelipost).');
  if (url.indexOf(HOST_INTELIPOST) !== 0) throw new Error(PROP_INTELIPOST_URL + ' deve começar com ' + HOST_INTELIPOST);
  return url;
}

// "4293792261107" -> "4293792261107RE" (não duplica o sufixo)
function codigoIntelipost_(protocolo) {
  const p = normalizarCodigo_(protocolo);
  if (!p) return '';
  return /RE$/.test(p) ? p : p + 'RE';
}

/**
 * Tela de teste: req = { codigos: texto com códigos separados por vírgula, espaço ou linha }.
 * Devolve a resposta crua { etapa, url, status, body }.
 */
function consultarIntelipost(req) {
  const codigos = String(req && req.codigos || '').split(/[\s,;]+/).map(codigoIntelipost_).filter(Boolean);
  if (!codigos.length) return { etapa: 'Validação', url: '', status: 0, body: 'Informe ao menos um protocolo.' };

  const url = urlIntelipost_();
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ pedidos: codigos }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  return { etapa: 'Intelipost (' + codigos.join(', ') + ')', url: url, status: resp.getResponseCode(), body: resp.getContentText() };
}

// Tela de teste: protocolos (já com "RE") das primeiras `quantidade` linhas Jadlog da aba base
function amostraJadlog(quantidade) {
  const aba = obterAba_();
  const cab = CONFIG.PLANILHA.LINHA_CABECALHO;
  const colCodigo = indiceColuna_(aba, CONFIG.PLANILHA.COL_CODIGO);
  const colProtocolo = indiceColuna_(aba, CONFIG.PLANILHA.COL_PROTOCOLO);
  if (!colCodigo || !colProtocolo) {
    throw new Error('Colunas "' + CONFIG.PLANILHA.COL_CODIGO + '" e "' + CONFIG.PLANILHA.COL_PROTOCOLO + '" são necessárias na aba "' + aba.getName() + '".');
  }
  const total = aba.getLastRow() - cab;
  if (total <= 0) return [];

  const codigos = aba.getRange(cab + 1, colCodigo, total, 1).getValues();
  const protocolos = aba.getRange(cab + 1, colProtocolo, total, 1).getValues();
  const amostra = [];
  for (let i = 0; i < total && amostra.length < (quantidade || 3); i++) {
    if (classificarCodigo_(codigos[i][0]) !== TIPO_CODIGO.JADLOG) continue;
    const c = codigoIntelipost_(protocolos[i][0]);
    if (c && amostra.indexOf(c) < 0) amostra.push(c);
  }
  return amostra;
}

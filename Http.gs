/**
 * UrlFetchApp.fetchAll com limite de requisições simultâneas e novas tentativas para falhas
 * temporárias do gateway dos Correios (ex.: 504 "GTW-005: Tempo limite esgotado (timeout)").
 * Os pedidos devem ter muteHttpExceptions: true. Devolve os HTTPResponse na mesma ordem.
 */

const HTTP_TEMPORARIOS = [429, 502, 503, 504];

function buscarTodos_(reqs) {
  const cfg = CONFIG.HTTP;
  const resps = new Array(reqs.length);
  let pendentes = reqs.map(function (_, i) { return i; });

  for (let tentativa = 0; pendentes.length; tentativa++) {
    if (tentativa > 0) Utilities.sleep(cfg.ESPERA_RETENTATIVA_MS * tentativa);
    for (let p = 0; p < pendentes.length; p += cfg.SIMULTANEAS) {
      const grupo = pendentes.slice(p, p + cfg.SIMULTANEAS);
      UrlFetchApp.fetchAll(grupo.map(function (i) { return reqs[i]; }))
        .forEach(function (r, k) { resps[grupo[k]] = r; });
    }
    if (tentativa >= cfg.RETENTATIVAS) break;
    pendentes = pendentes.filter(function (i) { return HTTP_TEMPORARIOS.indexOf(resps[i].getResponseCode()) >= 0; });
  }
  return resps;
}

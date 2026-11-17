/**
 * API Rastro (REST): consulta de objetos por código de rastreio.
 * GET {RASTREIO}/{codigoObjeto}?resultado=T (todos os eventos) | U (último evento)
 * A interpretação do JSON de resposta fica em RastroParser.gs.
 */

function urlRastro_(codigo, resultado) {
  return CONFIG.ENDPOINTS.RASTREIO + '/' + encodeURIComponent(normalizarCodigo_(codigo)) +
    '?resultado=' + (resultado === 'U' ? 'U' : 'T');
}

// Tela de teste: req = { codigo, resultado: 'T'|'U' }. Devolve a resposta JSON crua.
function consultarRastro(req) {
  const codigo = normalizarCodigo_(req && req.codigo);
  if (!codigo) return { etapa: 'Validação', url: CONFIG.ENDPOINTS.RASTREIO, status: 0, body: 'Informe o código de rastreio.' };
  const resp = getAutenticado_(urlRastro_(codigo, req.resultado));
  if (resp.etapa === 'Consulta') resp.etapa = 'Rastro';
  return resp;
}

/**
 * Consulta vários códigos em paralelo (buscarTodos_, com novas tentativas), só o último evento.
 * Se algum vier 401, renova o token e repete esses. Devolve um array de
 * { etapa, url, status, body } na mesma ordem de `codigos`.
 */
function consultarRastroLote_(codigos) {
  const urls = codigos.map(function (c) { return urlRastro_(c, 'U'); });

  let t = obterToken_(false);
  if (t.erro) return urls.map(function () { return t.erro; });
  const resps = buscarRastro_(urls, t.token);

  const negados = [];
  resps.forEach(function (r, i) { if (r.status === 401) negados.push(i); });
  if (negados.length) {
    t = obterToken_(true);
    if (t.erro) return urls.map(function () { return t.erro; });
    buscarRastro_(negados.map(function (i) { return urls[i]; }), t.token)
      .forEach(function (r, k) { resps[negados[k]] = r; });
  }
  return resps;
}

function buscarRastro_(urls, token) {
  const reqs = urls.map(function (url) {
    return {
      url: url,
      method: 'get',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    };
  });
  return buscarTodos_(reqs).map(function (resp, i) {
    return { etapa: 'Rastro', url: urls[i], status: resp.getResponseCode(), body: resp.getContentText() };
  });
}

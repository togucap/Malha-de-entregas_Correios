/**
 * Autenticação na API Token dos Correios (REST) e GET autenticado.
 */

const CACHE_KEY = 'correios_token';

function autenticar_() {
  const resp = UrlFetchApp.fetch(CONFIG.ENDPOINTS.AUTH, {
    method: 'post',
    contentType: 'application/json',
    headers: { Accept: 'application/json', Authorization: basicAuth_() },
    payload: JSON.stringify({ numero: credenciais_().CARTAO }),
    muteHttpExceptions: true
  });
  return { etapa: 'Autenticação', url: CONFIG.ENDPOINTS.AUTH, status: resp.getResponseCode(), body: resp.getContentText() };
}

function obterToken_(forcarNovo) {
  const cache = CacheService.getScriptCache();
  if (!forcarNovo) {
    const salvo = cache.get(CACHE_KEY);
    if (salvo) return { token: salvo };
  }
  const auth = autenticar_();
  if (auth.status !== 200 && auth.status !== 201) return { erro: auth };

  let token;
  try { token = JSON.parse(auth.body).token; } catch (e) { /* corpo não-JSON */ }
  if (!token) return { erro: auth };

  cache.put(CACHE_KEY, token, 3600); // reaproveita por 1 hora
  return { token: token };
}

// Botão "Testar autenticação": devolve a resposta crua da API Token
function testarAutenticacao() {
  CacheService.getScriptCache().remove(CACHE_KEY);
  return autenticar_();
}

// GET com token Bearer; se vier 401 (token expirado/inválido), renova e tenta 1x
function getAutenticado_(url) {
  let t = obterToken_(false);
  if (t.erro) return t.erro;

  let resp = chamarGet_(url, t.token);
  if (resp.status === 401) {
    t = obterToken_(true);
    if (t.erro) return t.erro;
    resp = chamarGet_(url, t.token);
  }
  return resp;
}

function chamarGet_(url, token) {
  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  return { etapa: 'Consulta', url: url, status: resp.getResponseCode(), body: resp.getContentText() };
}

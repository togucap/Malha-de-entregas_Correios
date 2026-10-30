/**
 * Teste da API de Pré-Postagem dos Correios (Google Apps Script)
 * Arquivos do projeto: Code.gs + Index.html
 */

const CONFIG = {
  USER: '*******',      // usuário do Meu Correios / idCorreios
  API_KEY: '********',  // código de acesso à API (senha do componente)
  CARTAO: '********',   // número do cartão de postagem
  COD_ADMINISTRATIVO: '********', // código administrativo do contrato (8 dígitos) – Logística Reversa
  ENDPOINTS: {
    AUTH: 'https://api.correios.com.br/token/v1/autentica/cartaopostagem',
    RASTREIO: 'https://api.correios.com.br/srorastro/v1/objetos',
    PREPOSTAGEM: 'https://api.correios.com.br/prepostagem/v2/prepostagens',
    // Web Service SOAP de Logística Reversa (produção). Se não responder, teste:
    // https://cws.correios.com.br/logisticaReversaWS/logisticaReversaService/logisticaReversaWS
    REVERSA: 'https://apps.correios.com.br/logisticaReversaWS/logisticaReversaService/logisticaReversaWS'
  }
};

const BASE_PERMITIDA = 'https://api.correios.com.br/';
const CACHE_KEY = 'correios_token';

/* ---------- Interface ---------- */

// Publicar como App da Web (Implantar > Nova implantação > App da Web)
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Teste API Pré-Postagem')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Alternativa: abrir como janela dentro de uma Planilha Google
function abrirTeste() {
  const html = HtmlService.createHtmlOutputFromFile('Index').setWidth(900).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, 'Teste API Pré-Postagem');
}

function getConfigPublica() {
  return { urlPadrao: CONFIG.ENDPOINTS.PREPOSTAGEM, urlReversa: CONFIG.ENDPOINTS.REVERSA };
}

/* ---------- Autenticação ---------- */

function autenticar_() {
  const resp = UrlFetchApp.fetch(CONFIG.ENDPOINTS.AUTH, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic ' + Utilities.base64Encode(
        CONFIG.USER + ':' + CONFIG.API_KEY, Utilities.Charset.UTF_8)
    },
    payload: JSON.stringify({ numero: CONFIG.CARTAO }),
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

/* ---------- Consulta Pré-Postagem ---------- */

/**
 * req = { url: string, params: [{ k: 'nome', v: 'valor' }, ...] }
 */
function consultarPrePostagens(req) {
  const base = String(req.url || CONFIG.ENDPOINTS.PREPOSTAGEM).trim();
  if (base.indexOf(BASE_PERMITIDA) !== 0) {
    return { etapa: 'Validação', url: base, status: 0, body: 'URL bloqueada: use apenas endereços de ' + BASE_PERMITIDA };
  }

  const query = (req.params || [])
    .filter(function (p) { return p.k && String(p.k).trim() && String(p.v).trim() !== ''; })
    .map(function (p) { return encodeURIComponent(String(p.k).trim()) + '=' + encodeURIComponent(String(p.v).trim()); })
    .join('&');
  const url = query ? base + (base.indexOf('?') >= 0 ? '&' : '?') + query : base;

  let t = obterToken_(false);
  if (t.erro) return t.erro;

  let resp = chamarGet_(url, t.token);
  if (resp.status === 401) {            // token expirado/inválido: renova e tenta 1x
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

/* ---------- Diagnóstico: parâmetros aceitos pela consulta ---------- */

/**
 * Lê a documentação OpenAPI da Pré-Postagem e lista, no Registro de execução,
 * os parâmetros aceitos por GET /v2/prepostagens e GET /v1/prepostagens.
 * Rode pelo editor: selecione "listarParametrosConsulta" e clique em Executar.
 */
function listarParametrosConsulta() {
  const fontes = [
    'https://api.correios.com.br/prepostagem/v3/api-docs',
    'https://apihom.correios.com.br/prepostagem/v3/api-docs'
  ];

  for (const url of fontes) {
    const r = UrlFetchApp.fetch(url, { headers: { Accept: 'application/json' }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) {
      Logger.log(url + ' -> HTTP ' + r.getResponseCode());
      continue;
    }

    let spec;
    try { spec = JSON.parse(r.getContentText()); } catch (e) {
      Logger.log(url + ' -> resposta não é JSON');
      continue;
    }

    const resolver = function (ref) {
      return ref.replace(/^#\//, '').split('/').reduce(function (o, k) { return o ? o[k] : undefined; }, spec);
    };

    Logger.log('Fonte: ' + url);
    ['/v2/prepostagens', '/v1/prepostagens'].forEach(function (caminho) {
      const op = spec.paths && spec.paths[caminho] && spec.paths[caminho].get;
      if (!op) { Logger.log('GET ' + caminho + ': não encontrado'); return; }

      Logger.log('\nGET ' + caminho + (op.summary ? ' — ' + op.summary : ''));
      if (op.description) Logger.log(op.description);
      (op.parameters || []).forEach(function (p) {
        const prm = p.$ref ? resolver(p.$ref) : p;
        if (!prm) return;
        const sch = prm.schema && prm.schema.$ref ? resolver(prm.schema.$ref) : (prm.schema || {});
        Logger.log('  - ' + prm.name + ' [' + prm.in + (prm.required ? ', obrigatório' : '') + ']' +
          (sch.type ? ' ' + sch.type : '') +
          (sch.enum ? ' (' + sch.enum.join(' | ') + ')' : '') +
          (prm.description ? ': ' + prm.description : ''));
      });
    });
    return;
  }
  Logger.log('Não foi possível ler a documentação em nenhuma das fontes.');
}

/* ---------- Logística Reversa (Web Service SOAP) ---------- */

const HOSTS_REVERSA = [
  'https://apps.correios.com.br/',
  'https://cws.correios.com.br/',
  'https://apphom.correios.com.br/'
];

function xml_(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * req = { url, modo: 'numero' | 'data', numero, data (AAAA-MM-DD), tipoBusca: 'H'|'U', tipoSolicitacao: 'A'|'C' }
 * Devolve a resposta XML crua do Web Service.
 */
function consultarReversa(req) {
  const url = String(req.url || CONFIG.ENDPOINTS.REVERSA).trim().replace(/\?wsdl$/i, '');
  if (!HOSTS_REVERSA.some(function (h) { return url.indexOf(h) === 0; })) {
    return { etapa: 'Validação', url: url, status: 0, body: 'URL bloqueada: use apenas endereços do Web Service de Logística Reversa dos Correios.' };
  }

  const tipoSolicitacao = req.tipoSolicitacao === 'C' ? 'C' : 'A';
  let corpo;

  if (req.modo === 'data') {
    const m = String(req.data || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { etapa: 'Validação', url: url, status: 0, body: 'Informe uma data válida.' };
    corpo =
      '<ser:acompanharPedidoPorData>' +
        '<codAdministrativo>' + xml_(CONFIG.COD_ADMINISTRATIVO) + '</codAdministrativo>' +
        '<tipoSolicitacao>' + tipoSolicitacao + '</tipoSolicitacao>' +
        '<data>' + m[3] + '/' + m[2] + '/' + m[1] + '</data>' +
      '</ser:acompanharPedidoPorData>';
  } else {
    const numero = String(req.numero || '').replace(/\D/g, '');
    if (!numero) return { etapa: 'Validação', url: url, status: 0, body: 'Informe o número da autorização (somente dígitos).' };
    corpo =
      '<ser:acompanharPedido>' +
        '<codAdministrativo>' + xml_(CONFIG.COD_ADMINISTRATIVO) + '</codAdministrativo>' +
        '<tipoBusca>' + (req.tipoBusca === 'U' ? 'U' : 'H') + '</tipoBusca>' +
        '<tipoSolicitacao>' + tipoSolicitacao + '</tipoSolicitacao>' +
        '<numeroPedido>' + numero + '</numeroPedido>' +
      '</ser:acompanharPedido>';
  }

  const envelope =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:ser="http://service.logisticareversa.correios.com.br/">' +
    '<soapenv:Header/><soapenv:Body>' + corpo + '</soapenv:Body></soapenv:Envelope>';

  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'text/xml; charset=utf-8',
    headers: {
      SOAPAction: '""',
      Authorization: 'Basic ' + Utilities.base64Encode(
        CONFIG.USER + ':' + CONFIG.API_KEY, Utilities.Charset.UTF_8)
    },
    payload: envelope,
    muteHttpExceptions: true
  });
  return { etapa: 'Logística Reversa', url: url, status: resp.getResponseCode(), body: resp.getContentText() };
}

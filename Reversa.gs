/**
 * Web Service SOAP de Logística Reversa: montagem e envio das requisições.
 * A interpretação do XML de resposta fica em ReversaParser.gs.
 */

function xml_(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * req = { url, modo: 'numero' | 'data', numero, data (AAAA-MM-DD), tipoBusca: 'H'|'U', tipoSolicitacao: 'A'|'C' }
 * Devolve { url, params } pronto para o UrlFetchApp, ou { erro: { etapa, url, status, body } }.
 */
function montarRequisicaoReversa_(req) {
  const url = String(req.url || CONFIG.ENDPOINTS.REVERSA).trim().replace(/\?wsdl$/i, '');
  if (!HOSTS_REVERSA.some(function (h) { return url.indexOf(h) === 0; })) {
    return { erro: { etapa: 'Validação', url: url, status: 0, body: 'URL bloqueada: use apenas endereços do Web Service de Logística Reversa dos Correios.' } };
  }

  const codAdministrativo = credenciais_().COD_ADMINISTRATIVO;
  const tipoSolicitacao = req.tipoSolicitacao === 'C' ? 'C' : 'A';
  let corpo;

  if (req.modo === 'data') {
    const m = String(req.data || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { erro: { etapa: 'Validação', url: url, status: 0, body: 'Informe uma data válida.' } };
    corpo =
      '<ser:acompanharPedidoPorData>' +
        '<codAdministrativo>' + xml_(codAdministrativo) + '</codAdministrativo>' +
        '<tipoSolicitacao>' + tipoSolicitacao + '</tipoSolicitacao>' +
        '<data>' + m[3] + '/' + m[2] + '/' + m[1] + '</data>' +
      '</ser:acompanharPedidoPorData>';
  } else {
    const numero = String(req.numero || '').replace(/\D/g, '');
    if (!numero) return { erro: { etapa: 'Validação', url: url, status: 0, body: 'Informe o número da autorização (somente dígitos).' } };
    corpo =
      '<ser:acompanharPedido>' +
        '<codAdministrativo>' + xml_(codAdministrativo) + '</codAdministrativo>' +
        '<tipoBusca>' + (req.tipoBusca === 'U' ? 'U' : 'H') + '</tipoBusca>' +
        '<tipoSolicitacao>' + tipoSolicitacao + '</tipoSolicitacao>' +
        '<numeroPedido>' + numero + '</numeroPedido>' +
      '</ser:acompanharPedido>';
  }

  const envelope =
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:ser="http://service.logisticareversa.correios.com.br/">' +
    '<soapenv:Header/><soapenv:Body>' + corpo + '</soapenv:Body></soapenv:Envelope>';

  return {
    url: url,
    params: {
      method: 'post',
      contentType: 'text/xml; charset=utf-8',
      headers: { SOAPAction: '""', Authorization: basicAuth_() },
      payload: envelope,
      muteHttpExceptions: true
    }
  };
}

function respostaReversa_(url, resp) {
  return { etapa: 'Logística Reversa', url: url, status: resp.getResponseCode(), body: resp.getContentText() };
}

/**
 * Tela de teste: WSDL do Web Service + esquemas XSD importados por ele, para conferir as operações
 * disponíveis (ex.: solicitarPostagemReversa) e os campos de cada uma. Só leitura.
 */
function descreverReversa(req) {
  const url = String((req && req.url) || CONFIG.ENDPOINTS.REVERSA).trim().replace(/\?wsdl$/i, '');
  const permitido = function (u) { return HOSTS_REVERSA.some(function (h) { return u.indexOf(h) === 0; }); };
  if (!permitido(url)) {
    return { etapa: 'Validação', url: url, status: 0, body: 'URL bloqueada: use apenas endereços do Web Service de Logística Reversa dos Correios.' };
  }
  const params = { headers: { Authorization: basicAuth_() }, muteHttpExceptions: true };
  const resp = UrlFetchApp.fetch(url + '?wsdl', params);
  let body = resp.getContentText();

  const xsds = [];
  body.replace(/schemaLocation="([^"]+)"/g, function (_, loc) { if (xsds.indexOf(loc) < 0) xsds.push(loc); });
  xsds.forEach(function (loc) {
    const abs = /^https?:/.test(loc) ? loc : url + loc.replace(/^[^?]*/, '');
    if (!permitido(abs)) { body += '\n\n<!-- esquema ignorado (host não permitido): ' + abs + ' -->'; return; }
    const x = UrlFetchApp.fetch(abs, params);
    body += '\n\n<!-- ==== ' + abs + ' (HTTP ' + x.getResponseCode() + ') ==== -->\n' + x.getContentText();
  });

  const operacoes = [];
  body.replace(/<(?:\w+:)?operation\s+name="([^"]+)"/g, function (_, nome) { if (operacoes.indexOf(nome) < 0) operacoes.push(nome); });
  return {
    etapa: 'WSDL Logística Reversa' + (operacoes.length ? ' – operações: ' + operacoes.join(', ') : ''),
    url: url + '?wsdl', status: resp.getResponseCode(), body: body
  };
}

// Tela de teste: devolve a resposta XML crua do Web Service
function consultarReversa(req) {
  const r = montarRequisicaoReversa_(req);
  if (r.erro) return r.erro;
  return respostaReversa_(r.url, UrlFetchApp.fetch(r.url, r.params));
}

/**
 * Consulta várias autorizações em paralelo (buscarTodos_, com novas tentativas), histórico completo.
 * Devolve um array de { etapa, url, status, body } na mesma ordem de `numeros`.
 */
function consultarReversaLote_(numeros, tipoSolicitacao) {
  const reqs = numeros.map(function (numero) {
    const r = montarRequisicaoReversa_({ modo: 'numero', numero: numero, tipoBusca: 'H', tipoSolicitacao: tipoSolicitacao });
    if (r.erro) throw new Error(r.erro.body);
    return Object.assign({ url: r.url }, r.params);
  });
  return buscarTodos_(reqs).map(function (resp, i) { return respostaReversa_(reqs[i].url, resp); });
}

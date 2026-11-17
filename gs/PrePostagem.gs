/**
 * API de Pré-Postagem (REST) – consulta e diagnóstico.
 * Obs.: as autorizações de logística reversa da empresa NÃO estão aqui (ver Reversa.gs).
 */

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

  return getAutenticado_(url);
}

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

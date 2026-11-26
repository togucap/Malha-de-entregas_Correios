/**
 * Cache dos dados das telas do painel (Acompanhamento - OUT e Shopee), para abrir rápido.
 *
 * Ler a aba base inteira e montar a resposta é o que mais demora; o resultado (JSON em texto) fica no
 * CacheService em pedaços e é devolvido como texto (google.script.run transporta uma string bem mais
 * rápido que milhares de listas). A tela faz JSON.parse.
 *
 * Validade: a versão PAINEL_DADOS_VERSAO (Propriedades do script) muda sempre que o script grava nas
 * abas (lote do tracking, importação, cruzamentos, Retorno_Extensão) ou alguém edita a base/Retorno_Extensão
 * à mão (onEdit); a chave do cache leva a versão, então o cache antigo deixa de ser usado na hora.
 * Mesmo sem mudança, expira em CACHE_DADOS.TTL_S. O botão "Atualizar" das telas sempre relê as abas.
 */

const CACHE_DADOS = {
  VERSAO_PROP: 'PAINEL_DADOS_VERSAO',
  TTL_S: 60 * 60,   // 1 h (máximo do CacheService: 6 h)
  PEDACO: 45000,    // caracteres por chave (limite de 100 KB por valor; acentos ocupam 2 bytes)
  MAX_PEDACOS: 120  // acima disso (~5 MB), não guarda: só devolve
};

// Os dados das abas mudaram: o cache das telas deixa de valer
function invalidarDadosPainel_() {
  try {
    PropertiesService.getScriptProperties().setProperty(CACHE_DADOS.VERSAO_PROP, String(Date.now()));
  } catch (e) {
    console.warn('Cache do painel não invalidado: ' + mensagemErro_(e));
  }
}

/**
 * JSON (texto) de `nome`: do cache, se houver e forcar for falso; senão monta com montar() e guarda.
 * Falha do cache nunca impede a resposta.
 */
function dadosEmCache_(nome, forcar, montar) {
  const cache = CacheService.getScriptCache();
  const versao = PropertiesService.getScriptProperties().getProperty(CACHE_DADOS.VERSAO_PROP) || '0';
  const prefixo = 'PAINEL_' + nome + '_' + versao + '_';

  if (!forcar) {
    try {
      const n = Number(cache.get(prefixo + 'n'));
      if (n) {
        const chaves = [];
        for (let i = 0; i < n; i++) chaves.push(prefixo + i);
        const partes = cache.getAll(chaves);
        if (chaves.every(function (k) { return partes[k] != null; })) return chaves.map(function (k) { return partes[k]; }).join('');
      }
    } catch (e) {
      console.warn('Cache do painel (' + nome + ') ilegível: ' + mensagemErro_(e));
    }
  }

  const texto = JSON.stringify(montar());
  const total = Math.ceil(texto.length / CACHE_DADOS.PEDACO);
  if (total && total <= CACHE_DADOS.MAX_PEDACOS) {
    try {
      const valores = {};
      for (let i = 0; i < total; i++) valores[prefixo + i] = texto.slice(i * CACHE_DADOS.PEDACO, (i + 1) * CACHE_DADOS.PEDACO);
      cache.putAll(valores, CACHE_DADOS.TTL_S);
      cache.put(prefixo + 'n', String(total), CACHE_DADOS.TTL_S); // por último: só vale com todos os pedaços gravados
    } catch (e) {
      console.warn('Cache do painel (' + nome + ') não gravado: ' + mensagemErro_(e));
    }
  }
  return texto;
}

/* ---------- Chamadas do painel (google.script.run): devolvem o JSON em texto ---------- */

function dadosAcompanhamentoOutJson(forcar) {
  return dadosEmCache_('acompanhamento', forcar, dadosAcompanhamentoOut);
}

function dadosShopeeJson(forcar) {
  return dadosEmCache_('shopee', forcar, dadosShopee);
}

/**
 * Gatilho simples: edição manual na aba base ou na Retorno_Extensão invalida o cache das telas.
 * (Gravações feitas pelo script não disparam onEdit; elas chamam invalidarDadosPainel_ direto.)
 */
function onEdit(e) {
  try {
    const nome = normalizarTexto_(e && e.range ? e.range.getSheet().getName() : '');
    if (nome === normalizarTexto_(CONFIG.PLANILHA.ABA) || nome === normalizarTexto_(RETORNO_EXTENSAO.aba)) invalidarDadosPainel_();
  } catch (erro) {
    // gatilho simples: não interrompe a edição
  }
}

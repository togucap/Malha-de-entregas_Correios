/**
 * Interpretação da resposta do proxy da Intelipost.
 *
 * Formato (resumido; os dados do cliente em `endereco`/`detalhes` não são lidos):
 *   { sucesso, total, erro?, dados: [{ pedido, ultimaOcorrencia, detalhes: { historico: [{
 *       shipment_order_volume_state,              // estado geral: NEW, IN_TRANSIT, DELIVERED...
 *       shipment_volume_micro_state: { default_name, description },  // "EM TRANSFERENCIA" + texto do evento
 *       event_date (ms), event_date_iso,
 *       location: { city, state_code } }] } }] }
 *
 * Devolve { erro: string | null, pedidos: { CODIGO: { ultimaOcorrencia, eventos, ultimo, cidade, previsao } } }
 * previsao = data prevista de entrega (Date) se o proxy enviar (ver CAMPOS_PREVISAO_INTELIPOST), senão null.
 * com os eventos do mais antigo para o mais recente; `cidade` é a do evento mais recente que tiver cidade.
 */
function interpretarIntelipost_(resp) {
  let j = null;
  try { j = JSON.parse(resp.body); } catch (e) { /* corpo não-JSON (ex.: página de login do Google) */ }

  if (resp.status !== 200) return { erro: 'HTTP ' + resp.status + (j && j.erro ? ': ' + j.erro : ''), pedidos: {} };
  if (!j) return { erro: 'resposta não é JSON (sem acesso ao proxy?)', pedidos: {} };
  if (!j.sucesso) return { erro: String(j.erro || 'proxy respondeu sem sucesso'), pedidos: {} };

  const pedidos = {};
  (j.dados || []).forEach(function (d) {
    const historico = (d.detalhes && d.detalhes.historico) || [];
    const eventos = historico.map(function (h) {
      const micro = h.shipment_volume_micro_state || {};
      const local = h.location || {};
      const ms = Number(h.event_date || h.created);
      return {
        estado: h.shipment_order_volume_state || micro.shipment_volume_state || '',
        nome: micro.default_name || micro.name || h.shipment_order_volume_state_localized || '',
        // para o histórico (gs/Historico): texto do evento e estado geral traduzido
        descricao: micro.description || h.esprinter_message || '',
        estadoTraduzido: micro.shipment_volume_state_localized || h.shipment_order_volume_state_localized || '',
        data: isFinite(ms) && ms > 0 ? new Date(ms) : null,
        cidade: local.city || '',
        uf: local.state_code || ''
      };
    }).sort(function (a, b) { return (a.data ? a.data.getTime() : 0) - (b.data ? b.data.getTime() : 0); });

    const comCidade = eventos.filter(function (e) { return e.cidade; });
    pedidos[normalizarCodigo_(d.pedido)] = {
      ultimaOcorrencia: d.ultimaOcorrencia || '',
      eventos: eventos,
      ultimo: eventos[eventos.length - 1] || null,
      cidade: comCidade.length ? comCidade[comCidade.length - 1].cidade.toUpperCase() : '',
      previsao: previsaoIntelipost_(d)
    };
  });
  return { erro: null, pedidos: pedidos };
}

/**
 * Previsão de entrega do pedido. O proxy atual NÃO envia esse dado (só histórico e dados do cliente);
 * se passar a enviar (ex.: o estimated_delivery_date do pedido na Intelipost), basta usar um destes nomes,
 * no pedido ou em `detalhes`. Aceita milissegundos, ISO (AAAA-MM-DD...) ou DD/MM/AAAA.
 */
const CAMPOS_PREVISAO_INTELIPOST = ['dataPrevista', 'previsaoEntrega', 'estimated_delivery_date', 'estimated_delivery_date_iso'];

function previsaoIntelipost_(d) {
  const fontes = [d, d.detalhes || {}];
  for (let f = 0; f < fontes.length; f++) {
    for (let k = 0; k < CAMPOS_PREVISAO_INTELIPOST.length; k++) {
      const v = fontes[f][CAMPOS_PREVISAO_INTELIPOST[k]];
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'number' || /^\d{10,}$/.test(String(v))) return new Date(Number(v));
      const iso = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      const br = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    }
  }
  return null;
}

// Texto do "Status tracking": estado geral conhecido (ESTADOS_INTELIPOST) ou nome do último evento resumido
function statusIntelipost_(pedido) {
  const u = pedido.ultimo;
  if (ESTADOS_INTELIPOST[u.estado]) return ESTADOS_INTELIPOST[u.estado];
  return resumirStatus_(u.nome || pedido.ultimaOcorrencia);
}

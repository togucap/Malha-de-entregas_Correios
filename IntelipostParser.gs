/**
 * Interpretação da resposta do proxy da Intelipost.
 *
 * Formato (resumido; os dados do cliente em `endereco`/`detalhes` não são lidos):
 *   { sucesso, total, erro?, dados: [{ pedido, ultimaOcorrencia, detalhes: { historico: [{
 *       shipment_order_volume_state,              // estado geral: NEW, IN_TRANSIT, DELIVERED...
 *       shipment_volume_micro_state: { default_name },  // nome do evento: "EM TRANSFERENCIA"
 *       event_date (ms), event_date_iso,
 *       location: { city, state_code } }] } }] }
 *
 * Devolve { erro: string | null, pedidos: { CODIGO: { ultimaOcorrencia, eventos, ultimo, cidade } } }
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
      cidade: comCidade.length ? comCidade[comCidade.length - 1].cidade.toUpperCase() : ''
    };
  });
  return { erro: null, pedidos: pedidos };
}

// Texto do "Status tracking": estado geral conhecido (ESTADOS_INTELIPOST) ou nome do último evento resumido
function statusIntelipost_(pedido) {
  const u = pedido.ultimo;
  if (ESTADOS_INTELIPOST[u.estado]) return ESTADOS_INTELIPOST[u.estado];
  return resumirStatus_(u.nome || pedido.ultimaOcorrencia);
}

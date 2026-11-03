/**
 * Interpretação da resposta JSON da API Rastro.
 *
 * Formato esperado (resumido):
 *   { objetos: [{ codObjeto, mensagem?, eventos: [{ codigo, tipo, dtHrCriado, descricao, detalhe? }] }] }
 * Sem eventos, o objeto traz `mensagem` (ex.: "SRO-020: Objeto não encontrado na base de dados dos Correios").
 *
 * Devolve { erro: string | null, codigo, eventos: [...] (mais recente primeiro), ultimo: evento | null }
 */
function interpretarRastro_(resp) {
  let j = null;
  try { j = JSON.parse(resp.body); } catch (e) { /* corpo não-JSON */ }

  if (resp.status !== 200) {
    return { erro: 'HTTP ' + resp.status + (mensagemRastro_(j) ? ': ' + mensagemRastro_(j) : ''), codigo: '', eventos: [], ultimo: null };
  }
  if (!j) return { erro: 'resposta não é JSON', codigo: '', eventos: [], ultimo: null };

  const obj = (j.objetos || [])[0];
  if (!obj) return { erro: mensagemRastro_(j) || 'resposta sem objetos', codigo: '', eventos: [], ultimo: null };

  const eventos = (obj.eventos || []).map(function (e) {
    return {
      codigo: e.codigo || '',
      tipo: e.tipo || '',
      dataHora: e.dtHrCriado || '',   // AAAA-MM-DDTHH:MM:SS (ordenável como texto)
      descricao: e.descricao || '',
      detalhe: e.detalhe || ''
    };
  }).sort(function (a, b) { return a.dataHora < b.dataHora ? 1 : a.dataHora > b.dataHora ? -1 : 0; });

  return {
    erro: eventos.length ? null : (obj.mensagem || 'objeto sem eventos'),
    codigo: obj.codObjeto || '',
    eventos: eventos,
    ultimo: eventos[0] || null
  };
}

// Mensagem de erro em qualquer um dos formatos conhecidos ({ msgs: [...] }, { mensagem }, objetos[0].mensagem)
function mensagemRastro_(j) {
  if (!j) return '';
  if (j.msgs) return [].concat(j.msgs).join('; ');
  if (j.mensagem) return String(j.mensagem);
  const obj = (j.objetos || [])[0];
  return obj && obj.mensagem ? String(obj.mensagem) : '';
}

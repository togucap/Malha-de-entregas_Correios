/**
 * Texto resumido do "Status tracking" e status finalizadores (que não são mais consultados).
 * Edite as listas para ajustar os textos ou incluir novos casos.
 * A comparação ignora acentos e maiúsculas e procura o trecho em qualquer parte da descrição.
 */

// [trecho da descrição original, texto gravado na planilha]; vale o primeiro que casar
const RESUMOS_STATUS = [
  ['nao entregue', 'Não entregue'],
  ['entregue ao remetente', 'Entregue ao remetente'],
  ['entregue', 'Entregue'],
  ['saiu para entrega', 'Saiu para entrega'],
  ['em transferencia', 'Objeto em transferência'],
  ['em transito', 'Objeto em transferência'],
  ['aguardando retirada', 'Aguardando retirada'],
  ['ainda nao chegou a unidade', 'Ainda não chegou à unidade'],
  ['devolvido ao remetente', 'Em devolução'],
  ['devolucao', 'Em devolução'],
  ['postado', 'Postado']
];

// Estado geral da Intelipost (shipment_order_volume_state) que já define o texto, antes do resumo
const ESTADOS_INTELIPOST = {
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
  TO_BE_DELIVERED: 'Saiu para entrega',
  DELIVERY_FAILED: 'Não entregue'
};

// Trechos que indicam status final; "não entregue" nunca é final.
// "expirad" também cobre a marca de rastreio expirado (SRO-012), gravada por Planilha.gs.
const STATUS_FINAIS = ['entregue', 'desistencia', 'expirad', 'cancelad'];

// Rastro SRO-012: objeto postado há mais de 180 dias, não pode mais ser consultado
const MARCA_RASTREIO_EXPIRADO = 'rastreio expirado';

/**
 * Resumo da descrição; sem regra na lista, usa o texto antes de " - "
 * (ex.: "Objeto em transferência - por favor aguarde" -> "Objeto em transferência"; texto todo em
 * maiúsculas fica só com a primeira letra maiúscula).
 */
function resumirStatus_(descricao) {
  const original = String(descricao == null ? '' : descricao).trim();
  const t = normalizarTexto_(original);
  for (let k = 0; k < RESUMOS_STATUS.length; k++) {
    if (t.indexOf(RESUMOS_STATUS[k][0]) >= 0) return RESUMOS_STATUS[k][1];
  }
  const curto = original.split(' - ')[0].replace(/\.$/, '').trim();
  // texto todo em maiúsculas (ex.: Intelipost "COLETA REALIZADA") -> "Coleta realizada"
  return curto === curto.toUpperCase() ? curto.charAt(0) + curto.slice(1).toLowerCase() : curto;
}

// Entregue, desistência, prazo expirado, cancelada: não muda mais, não precisa consultar de novo
function statusFinalizado_(texto) {
  const t = normalizarTexto_(texto);
  if (t.indexOf(MARCA_RASTREIO_EXPIRADO) >= 0) return true; // vale mesmo para "Não entregue (rastreio expirado)"
  if (!t || /^erro/.test(t) || t.indexOf('nao entregue') >= 0) return false;
  return STATUS_FINAIS.some(function (f) { return t.indexOf(f) >= 0; });
}

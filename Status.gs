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

// Trechos que indicam status final; "não entregue" nunca é final
const STATUS_FINAIS = ['entregue', 'desistencia', 'expirad', 'cancelad'];

/**
 * Resumo da descrição; sem regra na lista, usa o texto antes de " - "
 * (ex.: "Objeto em transferência - por favor aguarde" -> "Objeto em transferência").
 */
function resumirStatus_(descricao) {
  const original = String(descricao == null ? '' : descricao).trim();
  const t = normalizarTexto_(original);
  for (let k = 0; k < RESUMOS_STATUS.length; k++) {
    if (t.indexOf(RESUMOS_STATUS[k][0]) >= 0) return RESUMOS_STATUS[k][1];
  }
  return original.split(' - ')[0].replace(/\.$/, '').trim();
}

// Entregue, desistência, prazo expirado, cancelada: não muda mais, não precisa consultar de novo
function statusFinalizado_(texto) {
  const t = normalizarTexto_(texto);
  if (!t || /^erro/.test(t) || t.indexOf('nao entregue') >= 0) return false;
  return STATUS_FINAIS.some(function (f) { return t.indexOf(f) >= 0; });
}

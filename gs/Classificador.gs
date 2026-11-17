/**
 * Identifica o tipo de código da coluna "Autorização Postagem" pela quantidade de caracteres:
 *   10 dígitos              -> AUTORIZACAO  autorização de postagem (Logística Reversa)  ex.: 4549402622
 *   13 (AA + 9 dígitos + AA) -> RASTREIO     código de rastreio dos Correios              ex.: AP145660448BR
 *   14 dígitos              -> JADLOG                                                    ex.: 13777800000271
 */

const TIPO_CODIGO = {
  AUTORIZACAO: 'AUTORIZACAO',
  RASTREIO: 'RASTREIO',
  JADLOG: 'JADLOG',
  VAZIO: 'VAZIO',
  DESCONHECIDO: 'DESCONHECIDO'
};

// Remove espaços e padroniza maiúsculas (a célula pode vir como número)
function normalizarCodigo_(valor) {
  return String(valor == null ? '' : valor).replace(/\s+/g, '').toUpperCase();
}

function classificarCodigo_(valor) {
  const c = normalizarCodigo_(valor);
  if (!c) return TIPO_CODIGO.VAZIO;
  if (/^\d{10}$/.test(c)) return TIPO_CODIGO.AUTORIZACAO;
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(c)) return TIPO_CODIGO.RASTREIO;
  if (/^\d{14}$/.test(c)) return TIPO_CODIGO.JADLOG;
  return TIPO_CODIGO.DESCONHECIDO;
}

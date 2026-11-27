/**
 * Colunas e títulos da tela "Acompanhamento - OUT" do painel: linhas da aba base (CONFIG.PLANILHA.ABA) que têm
 * "Parceiro_Nome" preenchido. Os dados vêm do Painel_JSON (gs/PainelDados monta as linhas com estas colunas,
 * já em texto); a pesquisa, os filtros e a visão "Em aberto"/"Finalizado" são feitos no navegador
 * (js/DadosPainel + js/TelaAcompanhamento).
 */

// nomes das colunas na aba base, na ordem da tela
const COLUNAS_ACOMPANHAMENTO_OUT = [
  'Protocolo', 'Pedido', 'Dt. autorização', 'Dt. postagem', 'Autorização Postagem', 'Código convertido',
  'Status tracking', 'Data Ocorrencia', 'cidade ultima interação', 'Data Prevista Entrega', 'Parceiro_Nome', 'Entrada_Lista',
  'Assistencia_Tecnica', 'Pedido_Parceiro'
];
// título mostrado no cabeçalho da tabela quando difere do nome na base (só no painel; a base não muda)
const ROTULOS_ACOMPANHAMENTO_OUT = {
  'Data Ocorrencia': 'Data ultima Ocorrencia',
  'cidade ultima interação': 'Cidade ultima Ocorrencia',
  'Assistencia_Tecnica': 'Assistência Técnica'
};
// colunas mostradas como "Sim" (preenchida na base) / "Não" (vazia), como Entrada_Lista
const SIM_NAO_ACOMPANHAMENTO_OUT = ['Assistencia_Tecnica'];
// colunas mostradas só com a data (a previsão do Rastro vem com hora 23:59:59, que não interessa na tela)
const SO_DATA_ACOMPANHAMENTO_OUT = ['Data Prevista Entrega'];
const FILTRO_ACOMPANHAMENTO_OUT = 'Parceiro_Nome'; // só linhas com esta coluna preenchida

// Valor da planilha -> texto para a tela (google.script.run não transporta Date); soData = sem a hora
function valorParaTela_(v, fuso, soData) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (soData) return Utilities.formatDate(v, fuso, 'dd/MM/yyyy');
    const hora = Utilities.formatDate(v, fuso, 'HH:mm');
    return Utilities.formatDate(v, fuso, 'dd/MM/yyyy') + (hora === '00:00' ? '' : ' ' + hora);
  }
  if (typeof v === 'number') return numeroComoTexto_(v);
  return v == null ? '' : String(v).trim();
}

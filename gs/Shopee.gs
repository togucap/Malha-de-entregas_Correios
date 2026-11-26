/**
 * Dados da vista "Shopee" do painel: quadro kanban com os pedidos da aba "Retorno_Extensão"
 * (JSON da extensão de retornos da Shopee, ver RetornoExtensao.gs; "Pedido" vem do CruzamentoShopee.gs).
 *
 * Colunas do quadro em KANBAN_SHOPEE; a regra que põe cada pedido numa coluna fica em
 * colunaKanbanShopee_() e ainda será definida: por enquanto nenhum pedido entra em coluna, e a tela
 * avisa quantos aguardam a regra. A pesquisa é feita no navegador (js/TelaShopee).
 */

const KANBAN_SHOPEE = [
  { id: 'pendente', titulo: 'Pendente de atendimento' },
  { id: 'transporte', titulo: 'Em transporte' },
  { id: 'entregue', titulo: 'Entregue' },
  { id: 'finalizados', titulo: 'Finalizados' }
];

// colunas da aba Retorno_Extensão lidas para os cartões (nome na aba -> campo enviado à tela)
const CAMPOS_SHOPEE = { shopee: 'Pedido_Shopee', pedido: 'Pedido', situacao: 'situacao', prazo: 'prazo', origem: 'origem' };

/**
 * Coluna do quadro de um pedido: id de KANBAN_SHOPEE ou '' (ainda sem coluna).
 * p = { shopee, pedido, situacao, prazo, origem } (textos). REGRAS A DEFINIR.
 */
function colunaKanbanShopee_(p) {
  return '';
}

/**
 * Chamada pelo painel (google.script.run). Devolve
 * { colunas: [{ id, titulo }], pedidos: [{ shopee, pedido, situacao, prazo, origem, coluna }],
 *   faltando: [colunas não encontradas na aba], abaEncontrada, atualizadoEm }.
 */
function dadosShopee() {
  const aba = obterAbaRetornoExtensao_(true);
  const ss = aba ? aba.getParent() : SpreadsheetApp.getActiveSpreadsheet();
  const fuso = ss.getSpreadsheetTimeZone();
  const nomes = Object.keys(CAMPOS_SHOPEE);
  const resposta = {
    colunas: KANBAN_SHOPEE.map(function (c) { return { id: c.id, titulo: c.titulo }; }),
    pedidos: [],
    faltando: [],
    abaEncontrada: !!aba,
    atualizadoEm: Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm')
  };
  if (!aba || !aba.getLastColumn()) {
    resposta.faltando = nomes.map(function (k) { return CAMPOS_SHOPEE[k]; });
    return resposta;
  }

  const largura = aba.getLastColumn();
  const total = Math.max(0, aba.getLastRow() - 1);
  const cabecalho = aba.getRange(1, 1, 1, largura).getValues()[0].map(normalizarTexto_);
  const pos = nomes.map(function (k) { return cabecalho.indexOf(normalizarTexto_(CAMPOS_SHOPEE[k])); });
  resposta.faltando = nomes.filter(function (_, i) { return pos[i] < 0; }).map(function (k) { return CAMPOS_SHOPEE[k]; });
  if (pos[0] < 0 || !total) return resposta;

  const ids = KANBAN_SHOPEE.map(function (c) { return c.id; });
  aba.getRange(2, 1, total, largura).getValues().forEach(function (r) {
    const p = {};
    nomes.forEach(function (k, i) { p[k] = pos[i] < 0 ? '' : valorParaTela_(r[pos[i]], fuso, false); });
    if (!p.shopee) return;
    const coluna = colunaKanbanShopee_(p);
    p.coluna = ids.indexOf(coluna) >= 0 ? coluna : '';
    resposta.pedidos.push(p);
  });
  return resposta;
}

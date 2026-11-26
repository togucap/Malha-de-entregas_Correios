/**
 * Dados da vista "Shopee" do painel: quadro kanban que junta duas abas.
 *   - "Pendente de atendimento": aba Retorno_Extensão (JSON da extensão Shopee, RetornoExtensao.gs) com
 *     origem "shopee-retornos" e situacao "Não encontrado" (REGRA_PENDENTE_SHOPEE).
 *   - Aba base (Base_Dados) com Parceiro_Nome "SHOPEE", pelo Status tracking (statusFinalizado_, a mesma regra
 *     da atualização de status) e pela Entrada_Lista (colunaBaseShopee_):
 *       "Em transporte" = status não finalizador;
 *       "Entregue"      = status finalizador e Entrada_Lista diferente de "Sim" (ainda não entrou no estoque);
 *       "Finalizados"   = status finalizador e Entrada_Lista "Sim".
 * Cada cartão leva também os dados de tracking da linha da base (janela de detalhes da tela). O cartão
 * pendente acha a linha da base pelo Pedido_Shopee = Pedido_Parceiro ou, sem ela, pelo Pedido.
 * Pesquisa no navegador (js/TelaShopee). Comparações de texto sem acento/maiúsculas.
 */

const KANBAN_SHOPEE = [
  { id: 'pendente', titulo: 'Pendente de atendimento', definida: true },
  { id: 'transporte', titulo: 'Em transporte', definida: true },
  { id: 'entregue', titulo: 'Entregue', definida: true },
  { id: 'finalizados', titulo: 'Finalizados', definida: true }
];

const REGRA_PENDENTE_SHOPEE = { origem: 'shopee-retornos', situacao: 'Não encontrado' };
const PARCEIRO_SHOPEE = 'SHOPEE';

// Coluna do quadro de uma linha SHOPEE da base (l: textos da linha)
function colunaBaseShopee_(l) {
  if (!statusFinalizado_(l.status)) return 'transporte';
  return normalizarTexto_(l.entradaLista) === 'sim' ? 'finalizados' : 'entregue';
}

// colunas da aba Retorno_Extensão (campo -> nome na aba)
const CAMPOS_RETORNO_SHOPEE = {
  shopee: 'Pedido_Shopee', pedido: 'Pedido', situacao: 'situacao', prazo: 'prazo', origem: 'origem',
  statusSolicitacao: 'statusSolicitacao'
};
// colunas da aba base (campo -> nome na aba)
const CAMPOS_BASE_SHOPEE = {
  protocolo: 'Protocolo', pedido: 'Pedido', autorizacao: 'Autorização Postagem', convertido: 'Código convertido',
  status: 'Status tracking', dataOcorrencia: 'Data Ocorrencia', cidade: 'cidade ultima interação',
  previsao: 'Data Prevista Entrega', parceiro: 'Parceiro_Nome', entradaLista: 'Entrada_Lista',
  assistencia: 'Assistencia_Tecnica', pedidoParceiro: 'Pedido_Parceiro'
};

/**
 * Chamada pelo painel (google.script.run). Devolve só textos:
 * { colunas: [{ id, titulo, definida }],
 *   cartoes: retorno = { coluna, tipo: 'retorno', titulo, pedido, prazo, statusSolicitacao, situacao, tracking }
 *            base    = { coluna, tipo: 'base', titulo, pedido, status, assistencia (Sim/Não), entradaLista,
 *                        protocolo, autorizacao, codigo, dataOcorrencia, cidade, previsao } (o próprio cartão é o tracking),
 *   foraDoQuadro (linhas da Retorno_Extensão que não entram na regra), faltando: ['Aba: coluna'],
 *   abaRetorno (encontrada), atualizadoEm }.
 * tracking = { status, dataOcorrencia, cidade, previsao, codigo, autorizacao, protocolo, pedido } ou null.
 */
function dadosShopee() {
  const base = lerAbaShopee_(obterAba_(), CAMPOS_BASE_SHOPEE, { dataOcorrencia: 'data', previsao: 'soData' });
  const abaRet = obterAbaRetornoExtensao_(true);
  const ret = abaRet ? lerAbaShopee_(abaRet, CAMPOS_RETORNO_SHOPEE, {}) : { linhas: [], faltando: Object.keys(CAMPOS_RETORNO_SHOPEE).map(function (k) { return CAMPOS_RETORNO_SHOPEE[k]; }) };
  const fuso = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();

  const resposta = {
    colunas: KANBAN_SHOPEE.map(function (c) { return { id: c.id, titulo: c.titulo, definida: c.definida }; }),
    cartoes: [],
    foraDoQuadro: 0,
    faltando: base.faltando.map(function (c) { return CONFIG.PLANILHA.ABA + ': ' + c; })
      .concat(ret.faltando.map(function (c) { return RETORNO_EXTENSAO.aba + ': ' + c; })),
    abaRetorno: !!abaRet,
    atualizadoEm: Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm')
  };

  // linhas da base por Pedido_Parceiro e por Pedido (para o tracking dos cartões pendentes)
  const porParceiro = Object.create(null), porPedido = Object.create(null);
  base.linhas.forEach(function (l) {
    [[porParceiro, l.pedidoParceiro], [porPedido, l.pedido]].forEach(function (par) {
      const k = chaveCruzamento_(par[1]);
      if (!k) return;
      const atual = par[0][k];
      if (!atual || l.ordemData >= atual.ordemData) par[0][k] = l; // mais recente (Data Ocorrencia); empate: mais abaixo
    });
  });

  const origem = normalizarTexto_(REGRA_PENDENTE_SHOPEE.origem), situacao = normalizarTexto_(REGRA_PENDENTE_SHOPEE.situacao);
  ret.linhas.forEach(function (l) {
    if (!l.shopee) return;
    if (normalizarTexto_(l.origem) !== origem || normalizarTexto_(l.situacao) !== situacao) { resposta.foraDoQuadro++; return; }
    const b = porParceiro[chaveCruzamento_(l.shopee)] || porPedido[chaveCruzamento_(l.pedido)] || null;
    resposta.cartoes.push({
      coluna: 'pendente', tipo: 'retorno', titulo: l.shopee, pedido: l.pedido, prazo: l.prazo,
      statusSolicitacao: l.statusSolicitacao, situacao: l.situacao, tracking: trackingShopee_(b)
    });
  });

  const parceiro = normalizarTexto_(PARCEIRO_SHOPEE);
  base.linhas.forEach(function (l) {
    if (normalizarTexto_(l.parceiro) !== parceiro) return;
    resposta.cartoes.push({
      coluna: colunaBaseShopee_(l), tipo: 'base', titulo: l.pedidoParceiro || l.pedido,
      pedido: l.pedido, status: l.status, assistencia: l.assistencia ? 'Sim' : 'Não', entradaLista: l.entradaLista,
      protocolo: l.protocolo, autorizacao: l.autorizacao, codigo: l.convertido || l.autorizacao,
      dataOcorrencia: l.dataOcorrencia, cidade: l.cidade, previsao: l.previsao
    });
  });
  return resposta;
}

/**
 * Lê as colunas `campos` de uma aba (cabeçalho na linha 1) como objetos de texto.
 * formatos: { campo: 'data' | 'soData' } para datas (ordemData guarda o instante da coluna 'data').
 */
function lerAbaShopee_(aba, campos, formatos) {
  const nomes = Object.keys(campos);
  const largura = aba.getLastColumn();
  const total = Math.max(0, aba.getLastRow() - 1);
  if (!largura) return { linhas: [], faltando: nomes.map(function (k) { return campos[k]; }) };
  const fuso = aba.getParent().getSpreadsheetTimeZone();
  const cab = aba.getRange(1, 1, 1, largura).getValues()[0].map(normalizarTexto_);
  const pos = nomes.map(function (k) { return cab.indexOf(normalizarTexto_(campos[k])); });
  const faltando = nomes.filter(function (_, i) { return pos[i] < 0; }).map(function (k) { return campos[k]; });
  if (!total) return { linhas: [], faltando: faltando };

  const linhas = aba.getRange(2, 1, total, largura).getValues().map(function (r) {
    const o = { ordemData: 0 };
    nomes.forEach(function (k, i) {
      const v = pos[i] < 0 ? '' : r[pos[i]];
      if (formatos[k] === 'data' && Object.prototype.toString.call(v) === '[object Date]') o.ordemData = v.getTime();
      o[k] = valorParaTela_(v, fuso, formatos[k] === 'soData');
    });
    return o;
  });
  return { linhas: linhas, faltando: faltando };
}

// Tracking da linha da base para a janela de detalhes de um cartão pendente (null = sem linha na base)
function trackingShopee_(l) {
  if (!l) return null;
  return {
    status: l.status, dataOcorrencia: l.dataOcorrencia, cidade: l.cidade, previsao: l.previsao,
    codigo: l.convertido || l.autorizacao, autorizacao: l.autorizacao, protocolo: l.protocolo, pedido: l.pedido
  };
}

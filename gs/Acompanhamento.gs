/**
 * Dados da tela "Acompanhamento - OUT" do painel: linhas da aba base (CONFIG.PLANILHA.ABA) que têm
 * "Parceiro_Nome" preenchido, só com as colunas da tela. A pesquisa e os filtros são feitos no
 * navegador (js/TelaAcompanhamento).
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

/**
 * Chamada pelo painel (google.script.run). Devolve
 * { colunas (nomes na base), rotulos (títulos da tela), linhas: [[texto, …]], finalizadas: [bool por linha], faltando: [colunas não encontradas na aba],
 *   totalBase, atualizadoEm }.
 * finalizadas usa a mesma regra da atualização de status (statusFinalizado_): false = "Em aberto",
 * ainda consultado pelas APIs.
 * Valores já em texto: datas "dd/MM/yyyy" (com hora quando houver), números com todos os dígitos.
 */
function dadosAcompanhamentoOut() {
  const aba = obterAba_();
  const cab = CONFIG.PLANILHA.LINHA_CABECALHO;
  const fuso = aba.getParent().getSpreadsheetTimeZone();
  const largura = aba.getLastColumn();
  const total = Math.max(0, aba.getLastRow() - cab);
  const resposta = {
    colunas: COLUNAS_ACOMPANHAMENTO_OUT,
    rotulos: COLUNAS_ACOMPANHAMENTO_OUT.map(function (c) { return ROTULOS_ACOMPANHAMENTO_OUT[c] || c; }),
    linhas: [],
    finalizadas: [],
    faltando: [],
    totalBase: total,
    atualizadoEm: Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm')
  };
  if (!largura) return resposta;

  const cabecalho = aba.getRange(cab, 1, 1, largura).getValues()[0].map(normalizarTexto_);
  const pos = COLUNAS_ACOMPANHAMENTO_OUT.map(function (nome) { return cabecalho.indexOf(normalizarTexto_(nome)); });
  resposta.faltando = COLUNAS_ACOMPANHAMENTO_OUT.filter(function (_, k) { return pos[k] < 0; });

  const iFiltro = pos[COLUNAS_ACOMPANHAMENTO_OUT.indexOf(FILTRO_ACOMPANHAMENTO_OUT)];
  const iStatus = pos[COLUNAS_ACOMPANHAMENTO_OUT.indexOf('Status tracking')];
  const soData = COLUNAS_ACOMPANHAMENTO_OUT.map(function (nome) { return SO_DATA_ACOMPANHAMENTO_OUT.indexOf(nome) >= 0; });
  const simNao = COLUNAS_ACOMPANHAMENTO_OUT.map(function (nome) { return SIM_NAO_ACOMPANHAMENTO_OUT.indexOf(nome) >= 0; });
  if (iFiltro < 0 || !total) return resposta;

  aba.getRange(cab + 1, 1, total, largura).getValues().forEach(function (r) {
    if (String(r[iFiltro] == null ? '' : r[iFiltro]).trim() === '') return;
    resposta.linhas.push(pos.map(function (i, k) {
      if (i < 0) return '';
      if (simNao[k]) return String(r[i] == null ? '' : r[i]).trim() ? 'Sim' : 'Não';
      return valorParaTela_(r[i], fuso, soData[k]);
    }));
    resposta.finalizadas.push(iStatus >= 0 && statusFinalizado_(r[iStatus]));
  });
  return resposta;
}

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

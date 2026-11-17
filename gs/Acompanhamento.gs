/**
 * Dados da tela "Acompanhamento - OUT" do painel: linhas da aba base (CONFIG.PLANILHA.ABA) que têm
 * "Parceiro_Nome" preenchido, só com as colunas da tela. A pesquisa e os filtros são feitos no
 * navegador (js/TelaAcompanhamento).
 */

const COLUNAS_ACOMPANHAMENTO_OUT = [
  'Protocolo', 'Pedido', 'Dt. autorização', 'Dt. postagem', 'Autorização Postagem', 'Código convertido',
  'Status tracking', 'Data Ocorrencia', 'cidade ultima interação', 'Parceiro_Nome', 'Entrada_Lista', 'Pedido_Parceiro'
];
const FILTRO_ACOMPANHAMENTO_OUT = 'Parceiro_Nome'; // só linhas com esta coluna preenchida

/**
 * Chamada pelo painel (google.script.run). Devolve
 * { colunas, linhas: [[texto, …]], finalizadas: [bool por linha], faltando: [colunas não encontradas na aba],
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
  if (iFiltro < 0 || !total) return resposta;

  aba.getRange(cab + 1, 1, total, largura).getValues().forEach(function (r) {
    if (String(r[iFiltro] == null ? '' : r[iFiltro]).trim() === '') return;
    resposta.linhas.push(pos.map(function (i) { return i < 0 ? '' : valorParaTela_(r[i], fuso); }));
    resposta.finalizadas.push(iStatus >= 0 && statusFinalizado_(r[iStatus]));
  });
  return resposta;
}

// Valor da planilha -> texto para a tela (google.script.run não transporta Date)
function valorParaTela_(v, fuso) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    const hora = Utilities.formatDate(v, fuso, 'HH:mm');
    return Utilities.formatDate(v, fuso, 'dd/MM/yyyy') + (hora === '00:00' ? '' : ' ' + hora);
  }
  if (typeof v === 'number') return numeroComoTexto_(v);
  return v == null ? '' : String(v).trim();
}

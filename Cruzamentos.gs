/**
 * Cruzamentos da aba base (CONFIG.PLANILHA.ABA) com relatórios em pastas do Drive.
 * Para um novo cruzamento, acrescente um item em CRUZAMENTOS; o botão do menu executa todos.
 *
 * Cada item: pasta (ID da pasta no Drive), arquivo (nome, com ou sem extensão), aba (vazio = primeira),
 * chaveBase / chaveRelatorio (colunas comparadas) e colunas gravadas na base, de dois tipos:
 *   { relatorio: 'Coluna do relatório', base: 'Coluna da base' } -> traz o valor da coluna
 *   { base: 'Coluna da base', presenca: true }                    -> "Sim" / "Não" se a chave consta no relatório
 *
 * Regras:
 * - A chave é comparada como texto, sem espaços nas pontas e sem diferenciar maiúsculas.
 * - Valor trazido: chave repetida usa a primeira linha com a coluna preenchida; pedido sem
 *   correspondência mantém o valor que já estava na base.
 * - Presença: toda linha com chave recebe "Sim" ou "Não" (reflete o relatório atual); linha sem chave fica vazia.
 * - Um cruzamento com erro (arquivo ou coluna não encontrada) não impede os demais.
 * - Só os pedidos que existem na base são guardados durante a leitura; a execução para antes do
 *   limite de tempo do Apps Script (os cruzamentos que não couberem avisam para executar de novo).
 */

const CRUZAMENTOS = [
  {
    pasta: '1Zk2F78ImtNqEDF_pULHe-74qwxaMH2xe',
    arquivo: 'Consolidado_Parceiros_Out.xlsx', // "_Out" = parceiros externos
    aba: '',
    chaveBase: 'Pedido',
    chaveRelatorio: 'pedido_codigo',
    colunas: [{ relatorio: 'Parceiro', base: 'Parceiro_Nome' }]
  },
  {
    pasta: '12d0yusktFNnojVKtxlLHGXGUiE-7ivNc',
    arquivo: 'Lista MSPC', // entradas de produtos no estoque
    aba: '',
    chaveBase: 'Pedido',
    chaveRelatorio: 'Num do pedido',
    colunas: [{ base: 'Entrada_Lista', presenca: true }]
  },
  {
    pasta: '15e1QbjoUii-tvNa180pwRcAKJTyxQlkP',
    arquivo: 'Relatorio Ordem de Serviço - Consolidado',
    aba: '',
    chaveBase: 'Pedido',
    chaveRelatorio: 'Número do Pedido',
    colunas: [{ relatorio: 'Nome da Assistência Técnica', base: 'Assistencia_Tecnica' }]
  }
];

const PRESENCA_SIM = 'Sim';
const PRESENCA_NAO = 'Não';

function menuCruzarRelatorios() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Cruzando a base com os relatórios do Drive...', 'Correios', 10);
  try {
    ss.toast(cruzarRelatorios(), 'Correios', 60);
  } catch (e) {
    ss.toast(String(e && e.message ? e.message : e), 'Correios – erro', 60);
  }
}

// Executa todos os cruzamentos de CRUZAMENTOS na aba base; devolve um resumo de cada um
function cruzarRelatorios() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 'Há uma atualização em andamento. Tente novamente em alguns minutos.';
  try {
    const aba = obterAba_();
    const prazo = Date.now() + CONFIG.PLANILHA.TEMPO_MAXIMO_MS; // antes do limite de 6 min do Apps Script
    const msg = CRUZAMENTOS.map(function (c) {
      if (Date.now() > prazo) return c.arquivo + ': não executado (tempo esgotado; execute de novo)';
      try {
        return executarCruzamento_(aba, c, prazo);
      } catch (e) {
        return c.arquivo + ': ERRO – ' + (e && e.message ? e.message : e);
      }
    }).join(' | ');
    console.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

function executarCruzamento_(aba, c, prazo) {
  const cab = CONFIG.PLANILHA.LINHA_CABECALHO;
  const colChave = indiceColuna_(aba, c.chaveBase);
  if (!colChave) throw new Error('coluna "' + c.chaveBase + '" não encontrada na aba "' + aba.getName() + '"');
  const total = aba.getLastRow() - cab;
  if (total <= 0) return c.arquivo + ': nenhuma linha na base.';

  // só as chaves que existem na base são guardadas (relatórios grandes não estouram a memória)
  const chaves = aba.getRange(cab + 1, colChave, total, 1).getValues().map(function (r) { return chaveCruzamento_(r[0]); });
  const naBase = Object.create(null);
  chaves.forEach(function (k) { if (k) naBase[k] = true; });

  const trazidas = c.colunas.filter(function (col) { return !col.presenca; });
  const presentes = Object.create(null);
  const mapas = trazidas.map(function () { return Object.create(null); }); // chave -> primeiro valor preenchido
  const colunasLidas = [c.chaveRelatorio].concat(trazidas.map(function (col) { return col.relatorio; }));

  const rel = percorrerRelatorio_(c.pasta, c.arquivo, c.aba, colunasLidas, function (v) {
    const chave = chaveCruzamento_(v[0]);
    if (!chave || !naBase[chave]) return;
    presentes[chave] = true;
    for (let k = 0; k < trazidas.length; k++) {
      const x = v[k + 1];
      if (x !== '' && x != null && !(chave in mapas[k])) mapas[k][chave] = x;
    }
  }, prazo);

  let encontrados = 0, semCorrespondencia = 0;
  chaves.forEach(function (k) { if (k) presentes[k] ? encontrados++ : semCorrespondencia++; });

  c.colunas.forEach(function (col) {
    const rng = aba.getRange(cab + 1, garantirColuna_(aba, col.base), total, 1);
    const valores = rng.getValues();
    const mapa = col.presenca ? null : mapas[trazidas.indexOf(col)];
    for (let i = 0; i < total; i++) {
      const chave = chaves[i];
      if (!chave) continue;
      if (col.presenca) valores[i][0] = presentes[chave] ? PRESENCA_SIM : PRESENCA_NAO;
      else if (chave in mapa) valores[i][0] = mapa[chave];
    }
    rng.setValues(valores);
  });

  return rel.nome + ' (' + rel.linhas + ' linhas): ' + encontrados + ' pedido(s) encontrado(s), ' +
    semCorrespondencia + ' não encontrado(s) (' + c.colunas.map(function (col) { return col.base; }).join(', ') + ').';
}

// Número inteiro vira texto sem casas decimais (o Excel pode trazer 12345 como número)
function chaveCruzamento_(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).trim();
  return String(v).trim().toUpperCase();
}

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
    const msg = CRUZAMENTOS.map(function (c) {
      try {
        return executarCruzamento_(aba, c);
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

function executarCruzamento_(aba, c) {
  const cab = CONFIG.PLANILHA.LINHA_CABECALHO;
  const colChave = indiceColuna_(aba, c.chaveBase);
  if (!colChave) throw new Error('coluna "' + c.chaveBase + '" não encontrada na aba "' + aba.getName() + '"');

  const rel = lerRelatorio_(c.pasta, c.arquivo, c.aba);
  const iChave = rel.indice(c.chaveRelatorio);
  if (iChave < 0) throw new Error('coluna "' + c.chaveRelatorio + '" não encontrada em "' + rel.nome + '"');
  const iColunas = c.colunas.map(function (col) {
    if (col.presenca) return -1;
    const i = rel.indice(col.relatorio);
    if (i < 0) throw new Error('coluna "' + col.relatorio + '" não encontrada em "' + rel.nome + '"');
    return i;
  });

  // chaves presentes no relatório e, para cada coluna trazida, chave -> primeiro valor preenchido
  const presentes = {};
  const mapas = c.colunas.map(function () { return {}; });
  for (let r = 1; r < rel.valores.length; r++) {
    const chave = chaveCruzamento_(rel.valores[r][iChave]);
    if (!chave) continue;
    presentes[chave] = true;
    iColunas.forEach(function (iCol, k) {
      if (iCol < 0) return;
      const v = rel.valores[r][iCol];
      if (v !== '' && v != null && !(chave in mapas[k])) mapas[k][chave] = v;
    });
  }

  const colDestino = c.colunas.map(function (col) { return garantirColuna_(aba, col.base); });
  const total = aba.getLastRow() - cab;
  if (total <= 0) return rel.nome + ': nenhuma linha na base.';
  const chaves = aba.getRange(cab + 1, colChave, total, 1).getValues();

  let encontrados = 0, semCorrespondencia = 0;
  c.colunas.forEach(function (col, k) {
    const rng = aba.getRange(cab + 1, colDestino[k], total, 1);
    const valores = rng.getValues();
    for (let i = 0; i < total; i++) {
      const chave = chaveCruzamento_(chaves[i][0]);
      if (!chave) continue;
      const achou = col.presenca ? !!presentes[chave] : chave in mapas[k];
      if (col.presenca) valores[i][0] = achou ? PRESENCA_SIM : PRESENCA_NAO;
      else if (achou) valores[i][0] = mapas[k][chave];
      if (k === 0) achou ? encontrados++ : semCorrespondencia++;
    }
    rng.setValues(valores);
  });

  return rel.nome + ': ' + encontrados + ' pedido(s) encontrado(s), ' + semCorrespondencia +
    ' não encontrado(s) (' + c.colunas.map(function (col) { return col.base; }).join(', ') + ').';
}

// Número inteiro vira texto sem casas decimais (o Excel pode trazer 12345 como número)
function chaveCruzamento_(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).trim();
  return String(v).trim().toUpperCase();
}

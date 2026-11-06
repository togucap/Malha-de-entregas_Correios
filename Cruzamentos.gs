/**
 * Cruzamentos da aba base (CONFIG.PLANILHA.ABA) com relatórios da pasta do Drive.
 * Para um novo cruzamento, acrescente um item em CRUZAMENTOS; o botão do menu executa todos.
 *
 * Regras:
 * - A chave é comparada como texto, sem espaços nas pontas e sem diferenciar maiúsculas.
 * - Chave repetida no relatório: vale a primeira linha em que a coluna trazida está preenchida.
 * - Pedido sem correspondência mantém o valor que já estava na base (um relatório de outro
 *   período não apaga o que já foi cruzado).
 */

const CRUZAMENTOS = [
  {
    arquivo: 'Consolidado_Parceiros_Out.xlsx',
    aba: '',                       // aba do relatório; vazio = primeira aba
    chaveBase: 'Pedido',           // coluna da aba base
    chaveRelatorio: 'pedido_codigo',
    colunas: [
      { relatorio: 'Parceiro', base: 'Parceiro_Nome' } // coluna trazida -> coluna gravada (criada se não existir)
    ]
  }
];

function menuCruzarRelatorios() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Cruzando a base com os relatórios do Drive...', 'Correios', 10);
  try {
    ss.toast(cruzarRelatorios(), 'Correios', 30);
  } catch (e) {
    ss.toast(String(e && e.message ? e.message : e), 'Correios – erro', 60);
  }
}

// Executa todos os cruzamentos de CRUZAMENTOS na aba base
function cruzarRelatorios() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 'Há uma atualização em andamento. Tente novamente em alguns minutos.';
  try {
    const aba = obterAba_();
    const msg = CRUZAMENTOS.map(function (c) { return executarCruzamento_(aba, c); }).join(' ');
    console.log(msg);
    return msg;
  } finally {
    lock.releaseLock();
  }
}

function executarCruzamento_(aba, c) {
  const cab = CONFIG.PLANILHA.LINHA_CABECALHO;
  const colChave = indiceColuna_(aba, c.chaveBase);
  if (!colChave) throw new Error('Coluna "' + c.chaveBase + '" não encontrada na aba "' + aba.getName() + '".');

  const rel = lerRelatorio_(c.arquivo, c.aba);
  const iChave = rel.indice(c.chaveRelatorio);
  if (iChave < 0) throw new Error('Coluna "' + c.chaveRelatorio + '" não encontrada em "' + rel.nome + '".');
  const iColunas = c.colunas.map(function (col) {
    const i = rel.indice(col.relatorio);
    if (i < 0) throw new Error('Coluna "' + col.relatorio + '" não encontrada em "' + rel.nome + '".');
    return i;
  });

  // chave -> valor de cada coluna trazida (primeiro valor preenchido)
  const mapas = c.colunas.map(function () { return {}; });
  for (let r = 1; r < rel.valores.length; r++) {
    const chave = chaveCruzamento_(rel.valores[r][iChave]);
    if (!chave) continue;
    iColunas.forEach(function (iCol, k) {
      const v = rel.valores[r][iCol];
      if (v !== '' && v != null && !(chave in mapas[k])) mapas[k][chave] = v;
    });
  }

  const colDestino = c.colunas.map(function (col) { return garantirColuna_(aba, col.base); });
  const total = aba.getLastRow() - cab;
  if (total <= 0) return c.arquivo + ': nenhuma linha na base.';
  const chaves = aba.getRange(cab + 1, colChave, total, 1).getValues();

  let encontrados = 0, semCorrespondencia = 0;
  c.colunas.forEach(function (col, k) {
    const rng = aba.getRange(cab + 1, colDestino[k], total, 1);
    const valores = rng.getValues();
    for (let i = 0; i < total; i++) {
      const chave = chaveCruzamento_(chaves[i][0]);
      if (!chave) continue;
      if (chave in mapas[k]) {
        valores[i][0] = mapas[k][chave];
        if (k === 0) encontrados++;
      } else if (k === 0) {
        semCorrespondencia++;
      }
    }
    rng.setValues(valores);
  });

  return rel.nome + ': ' + encontrados + ' pedido(s) cruzado(s), ' + semCorrespondencia +
    ' sem correspondência (' + c.colunas.map(function (col) { return col.base; }).join(', ') + ').';
}

// Número inteiro vira texto sem casas decimais (o Excel pode trazer 12345 como número)
function chaveCruzamento_(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v).trim();
  return String(v).trim().toUpperCase();
}

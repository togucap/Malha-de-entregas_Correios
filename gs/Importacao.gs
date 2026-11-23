/**
 * Alimenta a aba base (CONFIG.PLANILHA.ABA) com o relatório consolidado de protocolos do Drive.
 * Botão de menu "Importar protocolos do Drive". Ordem:
 *   1) lê o relatório (se falhar, a base não é alterada);
 *   2) na base, remove linhas sem "Autorização Postagem" e protocolos duplicados (fica a primeira ocorrência);
 *   3) acrescenta no fim os protocolos do relatório que ainda não estão na base e têm "Autorização Postagem"
 *      (protocolo que já existe é ignorado; repetido no relatório entra uma vez só), só com as colunas da base.
 * Antes de gravar, guarda uma cópia oculta da aba ("<aba>_backup", substitui a anterior).
 * A chave (Protocolo) é comparada como nos cruzamentos (chaveCruzamento_).
 */

const IMPORTACAO_PROTOCOLOS = {
  pasta: '1ToW75FtXeEYTDGD7261WAuze8Af-t3rB', // ID da pasta (ou do próprio arquivo) no Drive
  arquivo: 'Consolidado_Protocolos',          // .xlsx; achado com ou sem extensão
  aba: '',                                    // aba do relatório; vazio = primeira
  chave: 'Protocolo',
  obrigatoria: 'Autorização Postagem',        // linha sem esta informação não fica na base
  // colunas copiadas do relatório para a base (o relatório tem mais; as demais são ignoradas)
  colunas: ['Protocolo', 'Pedido', 'Cliente Prime', 'Dt. autorização', 'Dt. postagem',
    'Autorização Postagem', 'Tipo da Solicitação', 'Tipo abertura']
};

// Menu: importa e dispara a cadeia (relatórios do Drive -> tracking -> Payload_Tracking), ver Cadeia.gs
function menuImportarProtocolos() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('Importando protocolos do relatório consolidado...', 'Correios', 10);
  try {
    ss.toast(executarCadeiaCompleta('menu'), 'Correios', 60);
  } catch (e) {
    ss.toast(mensagemErro_(e), 'Correios – erro', 60);
  }
}

// Só a importação, sem a cadeia (para uso no editor)
function importarProtocolos() {
  return executarImportacao_('editor').msg;
}

/**
 * Importação com lock e registro no painel de execuções. Devolve { ok, msg };
 * ok = false quando não rodou (lock ocupado, cruzamentos em andamento) ou deu erro (base não mudou).
 */
function executarImportacao_(origem) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: false, msg: MSG_OCUPADO };
  try {
    // as linhas mudam de posição: não dá para importar no meio de uma rodada de cruzamentos (que guarda posições)
    if (PropertiesService.getScriptProperties().getProperty(CRUZ_ESTADO_PROP)) {
      return { ok: false, msg: 'Há uma rodada de cruzamentos em andamento. Aguarde terminar ou use "Cancelar continuação automática".' };
    }
    gravarStatus_('importacao', { estado: 'executando', inicio: Date.now(), fim: null, origem: origem, mensagem: 'Lendo ' + IMPORTACAO_PROTOCOLOS.arquivo + '.' });
    try {
      const msg = importar_();
      gravarStatus_('importacao', { estado: 'ok', fim: Date.now(), mensagem: msg });
      return { ok: true, msg: msg };
    } catch (e) {
      gravarStatus_('importacao', { estado: 'erro', fim: Date.now(), mensagem: mensagemErro_(e) });
      return { ok: false, msg: 'Erro: ' + mensagemErro_(e) };
    }
  } finally {
    lock.releaseLock();
  }
}

function importar_() {
  const imp = IMPORTACAO_PROTOCOLOS;
  const cab = CONFIG.PLANILHA.LINHA_CABECALHO;
  const aba = obterAba_();
  const vazio = function (v) { return v === '' || v == null || String(v).trim() === ''; };

  // posição (0-based) de cada coluna importada na base
  const posBase = imp.colunas.map(function (nome) {
    const c = indiceColuna_(aba, nome);
    if (!c) throw new Error('coluna "' + nome + '" não encontrada na aba "' + aba.getName() + '"');
    return c - 1;
  });
  const jChave = imp.colunas.indexOf(imp.chave);
  const jObrig = imp.colunas.indexOf(imp.obrigatoria);

  // 1) relatório: candidatos com autorização, uma vez por protocolo
  const candidatos = [];
  const noRelatorio = Object.create(null);
  let relSemAutorizacao = 0, relRepetidos = 0;
  const rel = percorrerRelatorio_(imp.pasta, imp.arquivo, imp.aba, imp.colunas, function (v) {
    const chave = chaveCruzamento_(v[jChave]);
    if (!chave) return;
    if (vazio(v[jObrig])) { relSemAutorizacao++; return; }
    if (noRelatorio[chave]) { relRepetidos++; return; }
    noRelatorio[chave] = true;
    candidatos.push({ chave: chave, valores: v });
  });

  // 2) base: remove linhas sem autorização e protocolos duplicados
  const largura = aba.getLastColumn();
  const totalAntes = Math.max(0, aba.getLastRow() - cab);
  const linhas = totalAntes ? aba.getRange(cab + 1, 1, totalAntes, largura).getValues() : [];
  const naBase = Object.create(null);
  const final = [];
  let semAutorizacao = 0, duplicados = 0, vazias = 0;
  linhas.forEach(function (r) {
    if (vazio(r[posBase[jObrig]])) {
      if (r.every(vazio)) vazias++; else semAutorizacao++;
      return;
    }
    const chave = chaveCruzamento_(r[posBase[jChave]]);
    if (chave && naBase[chave]) { duplicados++; return; }
    if (chave) naBase[chave] = true;
    final.push(r);
  });

  // 3) protocolos novos do relatório, no fim
  let adicionados = 0, jaExistiam = 0;
  candidatos.forEach(function (c) {
    if (naBase[c.chave]) { jaExistiam++; return; }
    naBase[c.chave] = true;
    const linha = [];
    for (let k = 0; k < largura; k++) linha.push('');
    posBase.forEach(function (pos, j) { linha[pos] = c.valores[j]; });
    final.push(linha);
    adicionados++;
  });

  const resumo = rel.nome + ' (' + rel.linhas + ' linhas): ' + adicionados + ' protocolo(s) novo(s) adicionado(s), ' +
    jaExistiam + ' já existiam' +
    (relSemAutorizacao ? ', ' + relSemAutorizacao + ' sem autorização ignorado(s)' : '') +
    (relRepetidos ? ', ' + relRepetidos + ' repetido(s) no relatório' : '') +
    '. Base: ' + duplicados + ' duplicado(s) removido(s), ' + semAutorizacao + ' sem autorização removido(s)' +
    '. Total na base: ' + final.length + '.';
  if (!adicionados && !duplicados && !semAutorizacao && !vazias) return resumo + ' Nada a alterar.';

  // 4) grava: cópia de segurança, bloco novo por cima e limpa as linhas que sobraram no fim
  fazerBackupAba_(aba);
  const faltam = cab + final.length - aba.getMaxRows();
  if (faltam > 0) aba.insertRowsAfter(aba.getMaxRows(), faltam);
  if (final.length) aba.getRange(cab + 1, 1, final.length, largura).setValues(final);
  if (totalAntes > final.length) aba.getRange(cab + 1 + final.length, 1, totalAntes - final.length, largura).clearContent();

  // as linhas mudaram de posição: a atualização de status em andamento recomeça do início da planilha
  const props = PropertiesService.getScriptProperties();
  [CURSOR_PROP, CURSOR_ABA_PROP].forEach(function (k) { props.deleteProperty(k); });

  console.log(resumo);
  return resumo + ' Cópia anterior na aba oculta "' + aba.getName() + '_backup".';
}

// Cópia oculta da aba antes de uma alteração em massa (substitui a cópia anterior)
function fazerBackupAba_(aba) {
  const ss = aba.getParent();
  const nome = aba.getName() + '_backup';
  const anterior = ss.getSheetByName(nome);
  if (anterior) ss.deleteSheet(anterior);
  aba.copyTo(ss).setName(nome).hideSheet();
}

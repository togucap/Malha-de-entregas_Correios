/**
 * Leitura de relatórios da pasta do Drive (CONFIG.DRIVE.PASTA_ID), inclusive em drive compartilhado.
 * Formatos: planilha Google (lida direto), .xlsx/.xls (convertidos numa cópia temporária no
 * Meu Drive, enviada para a lixeira logo depois) e .csv.
 * A conversão do Excel usa o serviço avançado "Drive API" (v3), que precisa estar ativado no projeto.
 */

/**
 * Devolve { nome, atualizado, valores, indice(nomeColuna) } — `valores` é a matriz da aba
 * (linha 0 = cabeçalho); `indice` acha a coluna pelo nome (sem acentos/maiúsculas), -1 se não houver.
 * nomeAba vazio = primeira aba do arquivo.
 */
function lerRelatorio_(nomeArquivo, nomeAba) {
  const arquivo = acharArquivoRelatorio_(nomeArquivo);
  const tipo = arquivo.getMimeType();
  let valores;

  if (tipo === MimeType.GOOGLE_SHEETS) {
    valores = valoresDaPlanilha_(arquivo.getId(), nomeAba, nomeArquivo);
  } else if (tipo === MimeType.MICROSOFT_EXCEL || tipo === MimeType.MICROSOFT_EXCEL_LEGACY) {
    const idCopia = converterParaPlanilha_(arquivo);
    try {
      valores = valoresDaPlanilha_(idCopia, nomeAba, nomeArquivo);
    } finally {
      DriveApp.getFileById(idCopia).setTrashed(true);
    }
  } else if (tipo === MimeType.CSV || /\.csv$/i.test(nomeArquivo)) {
    valores = Utilities.parseCsv(arquivo.getBlob().getDataAsString('UTF-8'));
  } else {
    throw new Error('Formato do arquivo "' + nomeArquivo + '" não suportado (' + tipo + ').');
  }

  const cabecalho = (valores[0] || []).map(normalizarTexto_);
  return {
    nome: arquivo.getName(),
    atualizado: arquivo.getLastUpdated(),
    valores: valores,
    indice: function (nomeColuna) { return cabecalho.indexOf(normalizarTexto_(nomeColuna)); }
  };
}

// Se houver mais de um arquivo com o mesmo nome na pasta, usa o atualizado mais recentemente
function acharArquivoRelatorio_(nome) {
  const pasta = DriveApp.getFolderById(CONFIG.DRIVE.PASTA_ID);
  const arquivos = pasta.getFilesByName(nome);
  let escolhido = null;
  while (arquivos.hasNext()) {
    const f = arquivos.next();
    if (!escolhido || f.getLastUpdated() > escolhido.getLastUpdated()) escolhido = f;
  }
  if (!escolhido) throw new Error('Arquivo "' + nome + '" não encontrado na pasta do Drive "' + pasta.getName() + '".');
  return escolhido;
}

// Cópia convertida em planilha Google no Meu Drive; devolve o id
function converterParaPlanilha_(arquivo) {
  if (typeof Drive === 'undefined') {
    throw new Error('Ative o serviço avançado "Drive API" (v3): editor do Apps Script > Serviços > + > Drive API.');
  }
  const copia = Drive.Files.copy(
    { name: 'tmp_' + arquivo.getName(), mimeType: MimeType.GOOGLE_SHEETS, parents: [DriveApp.getRootFolder().getId()] },
    arquivo.getId(),
    { supportsAllDrives: true }
  );
  return copia.id;
}

function valoresDaPlanilha_(id, nomeAba, nomeArquivo) {
  const ss = SpreadsheetApp.openById(id);
  const aba = nomeAba ? ss.getSheetByName(nomeAba) : ss.getSheets()[0];
  if (!aba) throw new Error('Aba "' + nomeAba + '" não encontrada em "' + nomeArquivo + '".');
  return aba.getDataRange().getValues();
}

/**
 * Leitura de relatórios em pastas do Drive (inclusive drive compartilhado); a pasta de cada
 * relatório é definida no cruzamento (Cruzamentos.gs).
 * Formatos:
 * - planilha Google: lida direto;
 * - .xlsx/.xls: convertidos numa cópia temporária no Meu Drive (serviço avançado "Drive API" v3,
 *   que precisa estar ativado no projeto), enviada para a lixeira logo depois;
 * - .csv: baixado em partes (Range da Drive API), linha a linha, sem o limite de 50 MB do
 *   getBlob; separador (; , tab) e codificação (UTF-8 ou ISO-8859-1, comum no Excel) detectados.
 */

const URL_DOWNLOAD_DRIVE = 'https://www.googleapis.com/drive/v3/files/';
const CSV_PARTE_BYTES = 4 * 1024 * 1024;

/**
 * Percorre as linhas de dados do relatório chamando aoLer(valores) com os valores das `colunas`
 * pedidas (nomes do cabeçalho, sem diferenciar acentos/maiúsculas), na mesma ordem.
 * Lança erro se alguma coluna não existir ou se passar do `prazo` (Date.now() em ms).
 * nomeAba vazio = primeira aba (não se aplica a CSV). Devolve { nome, linhas }.
 */
function percorrerRelatorio_(pastaId, nomeArquivo, nomeAba, colunas, aoLer, prazo) {
  const arquivo = acharArquivoRelatorio_(pastaId, nomeArquivo);
  const tipo = arquivo.getMimeType();
  const nome = arquivo.getName();

  if (tipo === MimeType.CSV || /\.csv$/i.test(nome)) {
    return { nome: nome, linhas: percorrerCsv_(arquivo, colunas, aoLer, prazo) };
  }

  let valores;
  if (tipo === MimeType.GOOGLE_SHEETS) {
    valores = valoresDaPlanilha_(arquivo.getId(), nomeAba, nome);
  } else if (tipo === MimeType.MICROSOFT_EXCEL || tipo === MimeType.MICROSOFT_EXCEL_LEGACY) {
    const idCopia = converterParaPlanilha_(arquivo);
    try {
      valores = valoresDaPlanilha_(idCopia, nomeAba, nome);
    } finally {
      DriveApp.getFileById(idCopia).setTrashed(true);
    }
  } else {
    throw new Error('formato do arquivo "' + nome + '" não suportado (' + tipo + ')');
  }

  const idx = indicesColunas_(valores[0] || [], colunas, nome);
  for (let r = 1; r < valores.length; r++) {
    const linha = valores[r];
    aoLer(idx.map(function (i) { return linha[i]; }));
  }
  return { nome: nome, linhas: Math.max(0, valores.length - 1) };
}

// Posição de cada coluna pedida no cabeçalho; o erro lista as colunas encontradas, para diagnóstico
function indicesColunas_(cabecalho, colunas, nome) {
  const norm = cabecalho.map(function (c) { return normalizarTexto_(String(c).replace(/^\uFEFF/, '')); });
  return colunas.map(function (col) {
    const i = norm.indexOf(normalizarTexto_(col));
    if (i < 0) {
      throw new Error('coluna "' + col + '" não encontrada em "' + nome + '" (colunas lidas: ' +
        cabecalho.slice(0, 15).join('; ') + (cabecalho.length > 15 ? '; …' : '') + ')');
    }
    return i;
  });
}

/* ---------- CSV em partes ---------- */

function percorrerCsv_(arquivo, colunas, aoLer, prazo) {
  const nome = arquivo.getName();
  const tamanho = arquivo.getSize();
  const url = URL_DOWNLOAD_DRIVE + arquivo.getId() + '?alt=media&supportsAllDrives=true';
  const token = ScriptApp.getOAuthToken();

  let resto = [];        // bytes depois da última quebra de linha da parte anterior
  let charset = null;
  let delim = null;
  let idx = null;
  let pendente = null;   // registro com quebra de linha dentro de aspas, ainda incompleto
  let linhas = 0;

  const lerLinha = function (linha) {
    if (linha.charCodeAt(linha.length - 1) === 13) linha = linha.slice(0, -1); // \r do CRLF
    const texto = pendente === null ? linha : pendente + '\n' + linha;
    if (pendente === null && texto === '') return;
    if (!delim) delim = detectarDelimitador_(texto);
    const campos = camposCsv_(texto, delim);
    if (!campos) { pendente = texto; return; }
    pendente = null;
    if (!idx) { idx = indicesColunas_(campos, colunas, nome); return; }
    linhas++;
    aoLer(idx.map(function (i) { return campos[i] === undefined ? '' : campos[i]; }));
  };

  for (let inicio = 0; inicio < tamanho; inicio += CSV_PARTE_BYTES) {
    if (prazo && Date.now() > prazo) {
      throw new Error('tempo esgotado lendo "' + nome + '" (' + Math.round(100 * inicio / tamanho) + '% lido)');
    }
    const fim = Math.min(tamanho, inicio + CSV_PARTE_BYTES) - 1;
    const resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Range: 'bytes=' + inicio + '-' + fim },
      muteHttpExceptions: true
    });
    const status = resp.getResponseCode();
    if (status !== 206 && status !== 200) {
      throw new Error('download de "' + nome + '" falhou (HTTP ' + status + ')');
    }
    const completo = status === 200 || fim >= tamanho - 1; // 200 = arquivo inteiro de uma vez
    let bytes = resp.getContent();
    if (resto.length) bytes = resto.concat(bytes);

    // corta na última quebra de linha (byte 10) para não partir um caractere nem uma linha
    const corte = completo ? bytes.length : bytes.lastIndexOf(10) + 1;
    resto = bytes.slice(corte);
    if (corte > 0) {
      const parte = corte === bytes.length ? bytes : bytes.slice(0, corte);
      if (!charset) charset = utf8Valido_(parte) ? 'UTF-8' : 'ISO-8859-1';
      let texto = Utilities.newBlob(parte).getDataAsString(charset);
      if (inicio === 0) texto = texto.replace(/^\uFEFF/, '');
      const partes = texto.split('\n');
      if (!completo) partes.pop(); // vazio: o texto termina em \n
      partes.forEach(lerLinha);
    }
    if (status === 200) break;
  }
  if (!idx) throw new Error('"' + nome + '" está vazio');
  return linhas;
}

// Separador mais frequente na linha de cabeçalho
function detectarDelimitador_(linha) {
  const contar = function (d) { return linha.split(d).length - 1; };
  return [';', ',', '\t'].reduce(function (melhor, d) { return contar(d) > contar(melhor) ? d : melhor; }, ',');
}

// Campos de um registro CSV (aspas duplas, "" escapado); null se terminar dentro de aspas
function camposCsv_(linha, d) {
  if (linha.indexOf('"') < 0) return linha.split(d);
  const campos = [];
  let campo = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha.charAt(i);
    if (aspas) {
      if (ch === '"') {
        if (linha.charAt(i + 1) === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === d) { campos.push(campo); campo = ''; }
    else campo += ch;
  }
  if (aspas) return null;
  campos.push(campo);
  return campos;
}

// Bytes (com sinal, como vêm do getContent) formam UTF-8 válido? Sequência cortada no fim conta como válida
function utf8Valido_(bytes) {
  const n = Math.min(bytes.length, 1024 * 1024);
  for (let i = 0; i < n; i++) {
    const b = bytes[i] & 0xFF;
    if (b < 0x80) continue;
    const extras = b >= 0xF0 && b <= 0xF4 ? 3 : b >= 0xE0 ? 2 : b >= 0xC2 && b < 0xE0 ? 1 : -1;
    if (extras < 0) return false;
    for (let k = 1; k <= extras; k++) {
      if (i + k >= n) return true;
      if (((bytes[i + k] & 0xFF) & 0xC0) !== 0x80) return false;
    }
    i += extras;
  }
  return true;
}

/* ---------- Arquivos e planilhas ---------- */

/**
 * Acha o arquivo pelo nome, com ou sem extensão ("Lista MSPC" acha "Lista MSPC" e "Lista MSPC.xlsx").
 * Se houver mais de um, usa o atualizado mais recentemente.
 */
function acharArquivoRelatorio_(pastaId, nome) {
  const pasta = DriveApp.getFolderById(pastaId);
  const alvo = String(nome).trim().toLowerCase();
  const semExtensao = function (n) { return n.replace(/\.(xlsx|xls|csv)$/i, ''); };
  const arquivos = pasta.searchFiles('title contains "' + semExtensao(nome).replace(/(["\\])/g, '\\$1') + '" and trashed = false');
  let escolhido = null;
  while (arquivos.hasNext()) {
    const f = arquivos.next();
    const n = f.getName().toLowerCase();
    if (n !== alvo && semExtensao(n) !== semExtensao(alvo)) continue;
    if (!escolhido || f.getLastUpdated() > escolhido.getLastUpdated()) escolhido = f;
  }
  if (!escolhido) throw new Error('arquivo "' + nome + '" não encontrado na pasta do Drive "' + pasta.getName() + '"');
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
  if (!aba) throw new Error('aba "' + nomeAba + '" não encontrada em "' + nomeArquivo + '"');
  return aba.getDataRange().getValues();
}

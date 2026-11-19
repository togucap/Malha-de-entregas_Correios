/**
 * Exportação "Payload_Tracking": arquivo JSON numa pasta do Drive com informações selecionadas da
 * aba base, para uso em outro projeto. O arquivo é sobrescrito a cada geração (mesmo ID no Drive).
 *
 * Gerado pelo menu Correios › "Gerar Payload_Tracking (JSON)" e, automaticamente, no fim de cada
 * ciclo completo da atualização de status (Planilha.gs).
 *
 * Formato:
 * {
 *   "versao": 1,
 *   "geradoEm": "2026-11-19T14:00:00-03:00",
 *   "totalPedidos": 2,
 *   "pedidos": {
 *     "<Pedido_Parceiro>": { status, dataOcorrencia, cidade, dataPrevista, autorizacao, assistencia, parceiro }
 *   }
 * }
 * - Chave = Pedido_Parceiro; linhas sem Pedido_Parceiro ficam de fora.
 * - Datas "dd/MM/yyyy"; vazio = "" (nunca null).
 * - assistencia = "Sim" se Assistencia_Tecnica estiver preenchida na base, senão "Não" (o nome não vai).
 * - Pedido_Parceiro repetido na base: fica a linha com a Data Ocorrencia mais recente
 *   (sem data nas duas, a que está mais abaixo na base, a mais nova).
 */

const PAYLOAD_TRACKING = {
  PASTA: '1Zk2F78ImtNqEDF_pULHe-74qwxaMH2xe', // drive compartilhado
  ARQUIVO: 'Payload_Tracking',
  VERSAO: 1,
  CHAVE: 'Pedido_Parceiro',
  // campo do JSON -> coluna da aba base
  CAMPOS: {
    status: 'Status tracking',
    dataOcorrencia: 'Data Ocorrencia',
    cidade: 'cidade ultima interação',
    dataPrevista: 'Data Prevista Entrega',
    autorizacao: 'Autorização Postagem',
    assistencia: 'Assistencia_Tecnica',
    parceiro: 'Parceiro_Nome'
  },
  SIM_NAO: ['assistencia'],                      // vai "Sim"/"Não" em vez do valor
  DATAS: ['dataOcorrencia', 'dataPrevista']      // vão como "dd/MM/yyyy"
};

function menuGerarPayloadTracking() {
  const ss = SpreadsheetApp.getActive();
  try {
    ss.toast(gerarPayloadTracking(), 'Correios', 20);
  } catch (e) {
    ss.toast(String(e && e.message ? e.message : e), 'Correios – erro', 60);
  }
}

/**
 * Lê a aba base, monta o JSON e sobrescreve o arquivo na pasta (cria se não existir).
 * Devolve o resumo para o toast/registro.
 */
function gerarPayloadTracking() {
  const cfg = PAYLOAD_TRACKING;
  const aba = obterAba_();
  const fuso = aba.getParent().getSpreadsheetTimeZone();
  const cab = CONFIG.PLANILHA.LINHA_CABECALHO;
  const total = Math.max(0, aba.getLastRow() - cab);
  const largura = aba.getLastColumn();

  const cabecalho = aba.getRange(cab, 1, 1, largura).getValues()[0].map(normalizarTexto_);
  const indice = function (nome) { return cabecalho.indexOf(normalizarTexto_(nome)); };
  const iChave = indice(cfg.CHAVE);
  if (iChave < 0) throw new Error('Payload_Tracking: coluna "' + cfg.CHAVE + '" não encontrada na aba "' + aba.getName() + '".');

  const campos = Object.keys(cfg.CAMPOS);
  const pos = {};
  const faltando = [];
  campos.forEach(function (c) {
    pos[c] = indice(cfg.CAMPOS[c]);
    if (pos[c] < 0) faltando.push(cfg.CAMPOS[c]);
  });
  const iData = pos.dataOcorrencia;

  const pedidos = {};
  const ordemData = {}; // chave -> ms da Data Ocorrencia da linha escolhida
  let repetidos = 0;
  const linhas = total ? aba.getRange(cab + 1, 1, total, largura).getValues() : [];
  linhas.forEach(function (r) {
    const chave = textoPayload_(r[iChave]);
    if (!chave) return;

    const ms = iData >= 0 && ehData_(r[iData]) ? r[iData].getTime() : -1;
    if (pedidos[chave]) {
      repetidos++;
      if (ms < ordemData[chave]) return; // a já escolhida tem data mais recente
    }

    const item = {};
    campos.forEach(function (c) {
      const v = pos[c] < 0 ? '' : r[pos[c]];
      if (cfg.SIM_NAO.indexOf(c) >= 0) item[c] = textoPayload_(v) ? 'Sim' : 'Não';
      else if (cfg.DATAS.indexOf(c) >= 0) item[c] = ehData_(v) ? Utilities.formatDate(v, fuso, 'dd/MM/yyyy') : textoPayload_(v);
      else item[c] = textoPayload_(v);
    });
    pedidos[chave] = item;
    ordemData[chave] = ms;
  });

  const quantidade = Object.keys(pedidos).length;
  const json = JSON.stringify({
    versao: cfg.VERSAO,
    geradoEm: Utilities.formatDate(new Date(), fuso, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    totalPedidos: quantidade,
    pedidos: pedidos
  }, null, 2);

  const arquivo = gravarArquivoJson_(cfg.PASTA, cfg.ARQUIVO, json);
  const msg = 'Payload_Tracking: ' + quantidade + ' pedido(s) gravado(s) em "' + arquivo.getName() + '"' +
    (repetidos ? ' (' + repetidos + ' linha(s) com Pedido_Parceiro repetido; ficou a mais recente)' : '') +
    (faltando.length ? '. Colunas não encontradas (vão vazias): ' + faltando.join(', ') : '') + '.';
  console.log(msg);
  return msg;
}

// Sobrescreve o arquivo de mesmo nome na pasta (mantém o ID); se não existir, cria
function gravarArquivoJson_(pastaId, nome, conteudo) {
  const pasta = DriveApp.getFolderById(pastaId);
  const it = pasta.getFilesByName(nome);
  let arquivo = null;
  while (it.hasNext()) { // mais de um com o mesmo nome: usa o atualizado mais recentemente
    const f = it.next();
    if (!arquivo || f.getLastUpdated() > arquivo.getLastUpdated()) arquivo = f;
  }
  if (!arquivo) return pasta.createFile(nome, conteudo, 'application/json');

  if (conteudo.length < 9 * 1024 * 1024) {
    arquivo.setContent(conteudo); // setContent aceita até 10 MB
  } else {
    // arquivo grande: atualiza pelo serviço avançado Drive API v3 (já usado pelos cruzamentos)
    Drive.Files.update({}, arquivo.getId(), Utilities.newBlob(conteudo, 'application/json', nome), { supportsAllDrives: true });
  }
  return arquivo;
}

// Valor da célula como texto: números com todos os dígitos, sem espaços nas pontas
function textoPayload_(v) {
  if (v === null || v === undefined) return '';
  if (ehData_(v)) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  return String(numeroComoTexto_(v)).trim();
}

function ehData_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

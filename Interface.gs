/**
 * Tela de teste das APIs (Index.html).
 */

// Publicar como App da Web (Implantar > Nova implantação > App da Web)
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Teste API Pré-Postagem')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Alternativa: abrir como janela dentro da Planilha Google (menu Correios)
function abrirTeste() {
  const html = HtmlService.createHtmlOutputFromFile('Index').setWidth(900).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, 'Teste API Pré-Postagem');
}

function getConfigPublica() {
  return { urlPadrao: CONFIG.ENDPOINTS.PREPOSTAGEM, urlReversa: CONFIG.ENDPOINTS.REVERSA };
}

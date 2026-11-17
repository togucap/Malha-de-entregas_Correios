/**
 * Páginas HTML do projeto (HtmlService).
 * - Painel (html/Painel): interface principal, montada com include() a partir de css/ e js/.
 * - Tela de teste das APIs (html/Index): resposta crua das APIs.
 * No GAS não há pastas: cada arquivo usa só o nome base (css/Tokens.html -> arquivo HTML "Tokens").
 */

// App da Web (Implantar > Nova implantação > App da Web): painel; "?pagina=teste" abre a tela de teste
function doGet(e) {
  if (e && e.parameter && e.parameter.pagina === 'teste') {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Teste API Pré-Postagem')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return paginaPainel_();
}

// Menu Correios > Abrir painel (janela grande dentro da planilha)
function abrirPainel() {
  SpreadsheetApp.getUi().showModelessDialog(paginaPainel_().setWidth(1280).setHeight(800), 'Malha de Entregas');
}

// Alternativa: abrir como janela dentro da Planilha Google (menu Correios)
function abrirTeste() {
  const html = HtmlService.createHtmlOutputFromFile('Index').setWidth(900).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, 'Teste API Pré-Postagem');
}

function paginaPainel_() {
  return HtmlService.createTemplateFromFile('Painel').evaluate()
    .setTitle('Malha de Entregas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Usado nos modelos HTML: <?!= include('Tokens'); ?> insere o conteúdo de outro arquivo HTML do projeto
function include(nome) {
  return HtmlService.createHtmlOutputFromFile(nome).getContent();
}

function getConfigPublica() {
  return { urlPadrao: CONFIG.ENDPOINTS.PREPOSTAGEM, urlReversa: CONFIG.ENDPOINTS.REVERSA };
}

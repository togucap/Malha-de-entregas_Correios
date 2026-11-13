/**
 * Solicitação de autorização de postagem (Web Service SOAP de Logística Reversa), conforme o WSDL:
 * - validarPostagemReversa:   confere os dados SEM criar autorização (usar para testar);
 * - solicitarPostagemReversa: cria a autorização de verdade (resposta: resultado_solicitacao.numero_coleta);
 * - cancelarPedido:           cancela uma autorização (numeroPedido + tipo A).
 *
 * A requisição chega como objeto (JSON da tela de teste) e é convertida em XML na ordem exata do
 * xs:sequence de cada tipo (ESQUEMA_REVERSA). codAdministrativo e cartao vêm das Propriedades do
 * script quando não informados. Os dados de cliente não são registrados em log.
 */

// Campos de cada tipo, na ordem do WSDL: [nome, tipo filho (ou null), repete?]
const ESQUEMA_REVERSA = {
  solicitarPostagemReversa: [['codAdministrativo'], ['codigo_servico'], ['cartao'], ['destinatario', 'destinatario'],
    ['coletas_solicitadas', 'coletaReversa', true]],
  validarPostagemReversa: [['codAdministrativo'], ['codigo_servico'], ['cartao'], ['cep_destinatario'], ['coleta', 'coletaReversa']],
  destinatario: [['nome'], ['logradouro'], ['numero'], ['complemento'], ['bairro'], ['referencia'], ['cidade'], ['uf'], ['cep'],
    ['ddd'], ['telefone'], ['ddd_celular'], ['celular'], ['email'], ['identificacao'], ['ciencia_conteudo_proibido']],
  // coleta (base) + coletaReversa (extensão)
  coletaReversa: [['tipo'], ['id_cliente'], ['valor_declarado'], ['descricao'], ['cklist'], ['documento', null, true],
    ['remetente', 'remetente'], ['produto', 'produto', true],
    ['numero'], ['ag'], ['cartao'], ['servico_adicional'], ['ar'], ['obj_col', 'objeto', true]],
  // pessoa (base) + remetente (extensão)
  remetente: [['nome'], ['logradouro'], ['numero'], ['complemento'], ['bairro'], ['referencia'], ['cidade'], ['uf'], ['cep'],
    ['ddd'], ['telefone'], ['email'], ['ciencia_conteudo_proibido'],
    ['identificacao'], ['ddd_celular'], ['celular'], ['sms'], ['restricao_anac'], ['documento_estrangeiro']],
  produto: [['codigo'], ['tipo'], ['qtd']],
  objeto: [['item'], ['desc'], ['entrega'], ['num'], ['id']]
};

// Modelo para a tela de teste (sem dados reais): preencha e valide antes de solicitar
function modeloSolicitacaoReversa() {
  return {
    codigo_servico: 'CÓDIGO DO SERVIÇO REVERSO DO CONTRATO',
    destinatario: { nome: 'CD / empresa que recebe', logradouro: '', numero: '', complemento: '', bairro: '',
      cidade: '', uf: 'SP', cep: '00000000', ddd: '', telefone: '', email: '' },
    coletas_solicitadas: [{
      tipo: 'A',
      id_cliente: 'PROTOCOLO OU PEDIDO',
      valor_declarado: '0',
      descricao: '',
      remetente: { nome: 'Cliente que vai postar', logradouro: '', numero: '', complemento: '', bairro: '',
        cidade: '', uf: 'SP', cep: '00000000', email: '', identificacao: 'CPF/CNPJ', ddd_celular: '', celular: '', sms: 'N' },
      ag: '10',
      ar: 0,
      obj_col: [{ item: '1', desc: 'Produto devolvido', id: '' }]
    }]
  };
}

/**
 * Tela de teste. req = { acao: 'validar' | 'solicitar' | 'cancelar', dados: objeto ou texto JSON, numero, url }.
 * Devolve a resposta crua { etapa, url, status, body }.
 */
function solicitacaoReversa(req) {
  const url = String((req && req.url) || CONFIG.ENDPOINTS.REVERSA).trim().replace(/\?wsdl$/i, '');
  if (!HOSTS_REVERSA.some(function (h) { return url.indexOf(h) === 0; })) {
    return { etapa: 'Validação', url: url, status: 0, body: 'URL bloqueada: use apenas endereços do Web Service de Logística Reversa dos Correios.' };
  }
  const cred = credenciais_();
  let operacao, corpo;

  if (req.acao === 'cancelar') {
    const numero = String(req.numero || '').replace(/\D/g, '');
    if (!numero) return { etapa: 'Validação', url: url, status: 0, body: 'Informe o número da autorização a cancelar.' };
    operacao = 'cancelarPedido';
    corpo = '<codAdministrativo>' + xml_(cred.COD_ADMINISTRATIVO) + '</codAdministrativo>' +
      '<numeroPedido>' + numero + '</numeroPedido><tipo>A</tipo>';
  } else {
    let dados;
    try {
      dados = typeof req.dados === 'string' ? JSON.parse(req.dados) : req.dados;
    } catch (e) {
      return { etapa: 'Validação', url: url, status: 0, body: 'JSON inválido: ' + e.message };
    }
    dados = Object.assign({ codAdministrativo: cred.COD_ADMINISTRATIVO, cartao: cred.CARTAO }, dados);
    const coletas = [].concat(dados.coletas_solicitadas || []);
    if (!coletas.length) return { etapa: 'Validação', url: url, status: 0, body: 'Informe ao menos uma coleta em coletas_solicitadas.' };

    if (req.acao === 'solicitar') {
      operacao = 'solicitarPostagemReversa';
      corpo = xmlReversa_(dados, ESQUEMA_REVERSA.solicitarPostagemReversa);
    } else {
      // valida a primeira coleta (o validar recebe uma só)
      operacao = 'validarPostagemReversa';
      corpo = xmlReversa_({
        codAdministrativo: dados.codAdministrativo,
        codigo_servico: dados.codigo_servico,
        cartao: dados.cartao,
        cep_destinatario: dados.destinatario && dados.destinatario.cep,
        coleta: coletas[0]
      }, ESQUEMA_REVERSA.validarPostagemReversa);
    }
  }

  const resp = UrlFetchApp.fetch(url, paramsSoapReversa_('<ser:' + operacao + '>' + corpo + '</ser:' + operacao + '>'));
  return { etapa: 'Logística Reversa – ' + operacao, url: url, status: resp.getResponseCode(), body: resp.getContentText() };
}

// Objeto -> XML na ordem de `campos`; campos vazios/ausentes são omitidos (todos são minOccurs="0")
function xmlReversa_(obj, campos) {
  return campos.map(function (c) {
    const nome = c[0], tipo = c[1], repete = c[2];
    const valor = obj ? obj[nome] : undefined;
    if (valor === undefined || valor === null || valor === '') return '';
    const itens = repete ? [].concat(valor) : [valor];
    return itens.map(function (v) {
      const conteudo = tipo ? xmlReversa_(v, ESQUEMA_REVERSA[tipo]) : xml_(v);
      return '<' + nome + '>' + conteudo + '</' + nome + '>';
    }).join('');
  }).join('');
}

/**
 * Configuração do projeto.
 *
 * As credenciais NÃO ficam no código: cadastre em
 * Configurações do projeto > Propriedades do script:
 *   CORREIOS_USER               usuário do Meu Correios / idCorreios
 *   CORREIOS_API_KEY            código de acesso à API (senha do componente)
 *   CORREIOS_CARTAO             número do cartão de postagem
 *   CORREIOS_COD_ADMINISTRATIVO código administrativo do contrato (8 dígitos) – Logística Reversa
 */

const CONFIG = {
  ENDPOINTS: {
    AUTH: 'https://api.correios.com.br/token/v1/autentica/cartaopostagem',
    RASTREIO: 'https://api.correios.com.br/srorastro/v1/objetos',
    PREPOSTAGEM: 'https://api.correios.com.br/prepostagem/v2/prepostagens',
    // Web Service SOAP de Logística Reversa (produção). Se não responder, teste:
    // https://cws.correios.com.br/logisticaReversaWS/logisticaReversaService/logisticaReversaWS
    REVERSA: 'https://apps.correios.com.br/logisticaReversaWS/logisticaReversaService/logisticaReversaWS'
  },
  PLANILHA: {
    ID: '',                 // vazio = planilha à qual o script está vinculado
    ABA: '',                // vazio = primeira aba que tiver a coluna COL_CODIGO no cabeçalho
    LINHA_CABECALHO: 1,
    COL_CODIGO: 'Autorização Postagem',
    COL_CONVERTIDO: 'Código convertido',
    COL_STATUS: 'Status tracking',
    LOTE: 10,                         // requisições simultâneas ao Web Service
    TEMPO_MAXIMO_MS: 4.5 * 60 * 1000, // para antes do limite de 6 min do Apps Script
    ESPERA_CONTINUACAO_MS: 60 * 1000, // intervalo até a continuação automática
    MAX_FALHAS: 3                     // execuções seguidas com erro e sem avanço antes de desistir
  }
};

const BASE_PERMITIDA = 'https://api.correios.com.br/';

const HOSTS_REVERSA = [
  'https://apps.correios.com.br/',
  'https://cws.correios.com.br/',
  'https://apphom.correios.com.br/'
];

const PROP_CREDENCIAIS = {
  USER: 'CORREIOS_USER',
  API_KEY: 'CORREIOS_API_KEY',
  CARTAO: 'CORREIOS_CARTAO',
  COD_ADMINISTRATIVO: 'CORREIOS_COD_ADMINISTRATIVO'
};

let credenciaisCache_ = null;

function credenciais_() {
  if (credenciaisCache_) return credenciaisCache_;
  const props = PropertiesService.getScriptProperties().getProperties();
  const faltando = [];
  const c = {};
  Object.keys(PROP_CREDENCIAIS).forEach(function (k) {
    c[k] = String(props[PROP_CREDENCIAIS[k]] || '').trim();
    if (!c[k]) faltando.push(PROP_CREDENCIAIS[k]);
  });
  if (faltando.length) {
    throw new Error('Cadastre nas Propriedades do script: ' + faltando.join(', '));
  }
  credenciaisCache_ = c;
  return c;
}

function basicAuth_() {
  const c = credenciais_();
  return 'Basic ' + Utilities.base64Encode(c.USER + ':' + c.API_KEY, Utilities.Charset.UTF_8);
}

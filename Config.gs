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
    ABA: 'Base_Dados',      // aba consultada; vazio = primeira aba que tiver a coluna COL_CODIGO no cabeçalho
    LINHA_CABECALHO: 1,
    COL_CODIGO: 'Autorização Postagem',
    COL_CONVERTIDO: 'Código convertido',
    COL_STATUS: 'Status tracking',
    COL_DATA: 'Data Ocorrencia',
    COL_CIDADE: 'cidade ultima interação',
    LOTE: 10,                         // linhas por lote (gravadas juntas na planilha)
    TEMPO_MAXIMO_MS: 4.5 * 60 * 1000,   // não inicia lote que possa passar disso (limite do Apps Script: 6 min)
    ESPERA_CONTINUACAO_MS: 60 * 1000,   // intervalo até a continuação automática
    ESPERA_SEGURANCA_MS: 7 * 60 * 1000, // retomada se a execução for encerrada à força pelo Apps Script
    ESPERA_SOBRECARGA_MS: 5 * 60 * 1000, // pausa quando o Rastro recusa o lote inteiro (429/5xx)
    MAX_FALHAS: 3                       // execuções automáticas seguidas sem gravar nenhum lote antes de desistir
  },
  HTTP: {
    SIMULTANEAS: 5,              // requisições em paralelo por vez (muitas juntas causam 504 no gateway)
    RETENTATIVAS: 2,             // novas tentativas para 429/502/503/504
    ESPERA_RETENTATIVA_MS: 2000, // espera antes da 1ª nova tentativa (2ª espera o dobro)
    ESPERA_MAXIMA_MS: 30000      // teto da espera, mesmo que o Retry-After peça mais
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

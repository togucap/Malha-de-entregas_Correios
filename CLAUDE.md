# Integração Correios – Autorizações de Postagem (Logística Reversa)

Projeto em **Google Apps Script (GAS)** para consultar autorizações de postagem (e-tickets) de logística reversa e o rastreio dos objetos, usando o contrato da empresa com os Correios. O GAS será o ambiente onde ficam as bases de consulta (planilhas Google).

## Arquivos

- `Code.gs` — lado servidor: autenticação, chamadas às APIs, funções expostas à interface.
- `Index.html` — interface de teste (HtmlService). Mostra a resposta crua das APIs, sem tratamento.
- Publicação: App da Web (`doGet`) ou janela em planilha (`abrirTeste`).

## Regras do projeto

- **Nunca** versionar credenciais. `USER`, `API_KEY`, `CARTAO` e `COD_ADMINISTRATIVO` hoje estão como placeholders no `CONFIG`; migrar para `PropertiesService.getScriptProperties()`.
- Não registrar tokens, CNPJ, contrato ou dados de destinatários em logs, commits ou arquivos de exemplo.
- Toda chamada HTTP usa `UrlFetchApp.fetch` com `muteHttpExceptions: true` e devolve `{ etapa, url, status, body }`.
- Requisições REST só para `https://api.correios.com.br/`; SOAP só para os hosts em `HOSTS_REVERSA`.

## O que já foi validado (out/2026)

### 1. API Token (REST) — funciona
- `POST https://api.correios.com.br/token/v1/autentica/cartaopostagem`
- Basic Auth (`USER:API_KEY`) + corpo `{"numero": "<cartão>"}`.
- Retorna HTTP 201, ambiente `PRODUCAO`, token Bearer válido por ~24 h (cache de 1 h no script, renova em 401).
- O campo `cartaoPostagem.api` lista os IDs de APIs liberadas. Mapeamento conhecido pela comunidade: 34 Preço, 35 Prazo, 41 CEP, 87 Rastro.

### 2. API Rastro (REST)
- `GET https://api.correios.com.br/srorastro/v1/objetos/{codigoObjeto}?resultado=T`
- Consulta **somente por código de objeto** (ex.: `AP584526429BR`), não por autorização.
- Só rastreia objetos vinculados ao contrato do remetente.

### 3. API Pré-Postagem (REST) — acesso OK, mas NÃO contém as autorizações da empresa
- `GET /prepostagem/v1/prepostagens` → 405 (v1 só aceita POST, que cria pré-postagem).
- `GET /prepostagem/v2/prepostagens` → endpoint correto de consulta.
- Parâmetro de autorização: **`eTicket`** (T maiúsculo). Outros: `id`, `codigoObjeto`, `codigoEstampa2D`, `numeroColeta`, `status`, `logisticaReversa` (S/N), `tipoObjeto`, `modalidadePagamento`, `dataInicialCriacaoPrePostagem`, `dataFinalCriacaoPrePostagem` (AAAA-MM-DD), `page`, `size`.
- Regras: só pré-postagens dos últimos 120 dias; intervalo de datas ≤ 30 dias; datas obrigatórias para status diferente de PREPOSTADO/PREATENDIDO.
- Resultado nos testes: `400 Filtro insuficiente` sem parâmetros; `404 PPN-344` (não existem pré-postagens) para o e-ticket e para a listagem de reversas do período. Conclusão: as autorizações da empresa são emitidas pelo sistema legado de Logística Reversa, não pela Pré-Postagem.
- Documentação OpenAPI: `https://api.correios.com.br/prepostagem/v3/api-docs` (função `listarParametrosConsulta()` lê e loga os parâmetros).

### 4. Web Service SOAP de Logística Reversa — FUNCIONA (fonte das autorizações)
- Endpoint de produção usado: `https://apps.correios.com.br/logisticaReversaWS/logisticaReversaService/logisticaReversaWS`
  (alternativa documentada: `https://cws.correios.com.br/logisticaReversaWS/logisticaReversaService/logisticaReversaWS`)
- Auth: HTTP Basic com as mesmas credenciais (`USER:API_KEY`). Namespace: `http://service.logisticareversa.correios.com.br/`.
- Método `acompanharPedido`: `codAdministrativo` (8 dígitos), `tipoBusca` (`H` histórico / `U` último), `tipoSolicitacao` (`A` autorização / `C` coleta), `numeroPedido`.
  - O número da autorização foi aceito com **10 dígitos** (formato usado pela empresa).
- Método `acompanharPedidoPorData`: `codAdministrativo`, `tipoSolicitacao`, `data` (**DD/MM/AAAA** na requisição).

#### Estrutura da resposta (`acompanharPedido`)
```
acompanharPedido
  codigo_administrativo, tipo_solicitacao
  coleta (repete UMA VEZ POR EVENTO do histórico)
    numero_pedido, controle_cliente
    historico: status, descricao_status, data_atualizacao (DD-MM-AAAA), hora_atualizacao, observacao
    objeto: numero_etiqueta (código de rastreio), controle_objeto_cliente, ultimo_status,
            descricao_status, data_ultima_atualizacao, hora_ultima_atualizacao, peso_real (g), valor_postagem
```
- **Atenção:** cada `<coleta>` traz um evento diferente em `historico`, mas o mesmo `objeto`. Agrupar por `numero_pedido` e juntar os eventos; não tratar cada bloco como autorização distinta.
- `numero_etiqueta` só vem preenchido depois da postagem.
- Datas: requisição em DD/MM/AAAA, resposta em DD-MM-AAAA.

#### Status observados / documentados
- 55 Aguardando objeto na agência
- 57 Prazo de utilização expirado
- 68 Autorização de postagem cancelada
- 6 Coletado (objeto postado)
- 7 Entregue (em `objeto.ultimo_status`)

## Fluxo validado

Número da autorização → `acompanharPedido` (SOAP) → `numero_etiqueta` → API Rastro (REST) para eventos detalhados.

## Próximos passos

1. Mover credenciais para Script Properties.
2. Criar parser do XML (`XmlService`) que devolva um objeto por autorização, com histórico agrupado.
3. Consulta em lote a partir de uma planilha: ler números de autorização e gravar status, data do status, código de rastreio, data de entrega, peso e valor.
4. Opcional: enriquecer com a API Rastro e agendar atualização (gatilho de tempo), respeitando cotas do `UrlFetchApp`.

## Referências

- Manual de integração Correios API: https://www.correios.com.br/atendimento/developers/arquivos/manual-para-integracao-correios-api
- Manual do Web Service de Logística Reversa: https://www.correios.com.br/atendimento/developers/arquivos/manual-de-implementacao-do-web-service-logistica-reversa.pdf
- Catálogo CWS (Swagger, requer login): https://cws.correios.com.br/

# Integração Correios – Autorizações de Postagem (Logística Reversa)

Projeto em **Google Apps Script (GAS)** para consultar autorizações de postagem (e-tickets) de logística reversa e o rastreio dos objetos, usando o contrato da empresa com os Correios. O GAS será o ambiente onde ficam as bases de consulta (planilhas Google).

## Arquivos

Os nomes no GitHub são os mesmos do editor do GAS (ex.: `Planilha.gs` ↔ arquivo `Planilha`). Todos os `.gs` compartilham o escopo global; não usar, no nível superior de um arquivo, constantes de outro arquivo (a ordem de carga não é garantida).

- `Config.gs` — `CONFIG` (endpoints, nomes de colunas, lote/tempo), hosts permitidos e leitura das credenciais nas Propriedades do script.
- `Auth.gs` — API Token (REST), cache do token e GET autenticado com renovação em 401.
- `PrePostagem.gs` — consulta da Pré-Postagem e diagnóstico do OpenAPI (`listarParametrosConsulta`).
- `Reversa.gs` — montagem/envio do SOAP de Logística Reversa (individual e em lote com `fetchAll`).
- `ReversaParser.gs` — parser do XML (`XmlService`): uma entrada por autorização, histórico agrupado, status atual.
- `Classificador.gs` — tipo do código pela quantidade de caracteres: 10 dígitos autorização, 13 (`AA999999999AA`) rastreio, 14 dígitos Jadlog.
- `Planilha.gs` — menu **Correios** (`onOpen`) e atualização da aba base: lê `Autorização Postagem`, grava `Código convertido` e `Status tracking`.
- `Interface.gs` + `Index.html` — interface de teste (HtmlService) com a resposta crua das APIs; App da Web (`doGet`) ou janela na planilha (`abrirTeste`).

## Configuração

Propriedades do script (Configurações do projeto > Propriedades do script): `CORREIOS_USER`, `CORREIOS_API_KEY`, `CORREIOS_CARTAO`, `CORREIOS_COD_ADMINISTRATIVO`.

## Planilha base

Colunas da aba: Protocolo, Pedido, Cliente Prime, Dt. autorização, Dt. postagem, Autorização Postagem, Tipo da Solicitação, Tipo abertura (+ `Código convertido` e `Status tracking`, criadas pelo script se não existirem). Colunas são localizadas pelo nome do cabeçalho (sem diferenciar acentos/maiúsculas).

- Só autorizações (10 dígitos) são consultadas por enquanto; Jadlog e rastreio ficam intactos.
- `Status tracking` = descrição mais recente entre o `objeto` e o último evento do `historico`.
- Linhas com status final (entregue, cancelada, expirada) são puladas, salvo no "Reprocessar todas".
- Execução limitada a ~4,5 min; se o tempo acabar, a próxima linha fica em `REVERSA_PROXIMA_LINHA` (Propriedades do script) e um gatilho de tempo de uso único (`continuarAtualizacao`, ~1 min) segue dali sozinho até o fim; o gatilho é apagado ao disparar e ao terminar o ciclo.
- O Apps Script pode encerrar à força ("Tempo máximo de execução excedido") se um lote demorar; por isso: cada lote é gravado na planilha e o cursor atualizado logo após a consulta; o próximo lote só começa se couber no tempo (estimado pelo lote mais demorado); e no início de cada execução é agendado um gatilho de segurança (`ESPERA_SEGURANCA_MS`, 7 min) que retoma do cursor se a execução morrer.
- Erro de comunicação também agenda nova tentativa; após `MAX_FALHAS` execuções automáticas seguidas sem gravar nenhum lote o ciclo para (cursor mantido; o menu zera a contagem).
- Menu "Cancelar continuação automática" apaga o gatilho pendente e o cursor.
- Mensagens do menu usam `toast` (não bloqueia); não usar `ui.alert`, que trava a execução até alguém clicar em OK.
- Conta Gmail comum: gatilhos somam no máx. 90 min/dia de execução e 20 mil chamadas `UrlFetchApp`/dia (Workspace: 6 h e 100 mil).

## Regras do projeto

- **Nunca** versionar credenciais: ficam só nas Propriedades do script (ver Configuração).
- Não registrar tokens, CNPJ, contrato ou dados de destinatários em logs, commits ou arquivos de exemplo.
- Toda chamada HTTP usa `UrlFetchApp.fetch` (ou `fetchAll` em lote) com `muteHttpExceptions: true` e devolve `{ etapa, url, status, body }`.
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

1. ~~Mover credenciais para Script Properties.~~ (feito)
2. ~~Parser do XML com histórico agrupado.~~ (feito — `ReversaParser.gs`)
3. ~~Consulta em lote a partir da planilha (código de rastreio e status).~~ (feito — `Planilha.gs`); avaliar colunas extras: data do status, data de entrega, peso e valor.
4. Consultar os códigos de rastreio (13) na API Rastro e definir a integração Jadlog (14).
5. Agendar atualização periódica (gatilho recorrente em `atualizarAutorizacoes`), respeitando cotas do `UrlFetchApp`.

## Referências

- Manual de integração Correios API: https://www.correios.com.br/atendimento/developers/arquivos/manual-para-integracao-correios-api
- Manual do Web Service de Logística Reversa: https://www.correios.com.br/atendimento/developers/arquivos/manual-de-implementacao-do-web-service-logistica-reversa.pdf
- Catálogo CWS (Swagger, requer login): https://cws.correios.com.br/

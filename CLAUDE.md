# Integração Correios – Autorizações de Postagem (Logística Reversa)

Projeto em **Google Apps Script (GAS)** para consultar autorizações de postagem (e-tickets) de logística reversa e o rastreio dos objetos, usando o contrato da empresa com os Correios. O GAS será o ambiente onde ficam as bases de consulta (planilhas Google).

## Arquivos

Pastas no GitHub: `gs/` (servidor), `html/` (páginas), `css/` e `js/` (estilos e scripts do painel). O GAS não tem pastas e só aceita arquivos de script e HTML: **o nome no GAS é o nome do arquivo sem a pasta e sem a extensão** (`gs/Planilha.gs` ↔ script `Planilha`; `css/Tokens.html` ↔ HTML `Tokens`). Por isso CSS e JS ficam em `.html` com `<style>`/`<script>` e entram no painel por `<?!= include('Nome'); ?>`. Nomes não podem se repetir entre pastas. Todos os `.gs` compartilham o escopo global; não usar, no nível superior de um arquivo, constantes de outro arquivo (a ordem de carga não é garantida).

- `Config.gs` — `CONFIG` (endpoints, nomes de colunas, lote/tempo), hosts permitidos e leitura das credenciais nas Propriedades do script.
- `Http.gs` — `buscarTodos_`: `fetchAll` em grupos de `CONFIG.HTTP.SIMULTANEAS` com novas tentativas para 429/502/503/504 (usado por Reversa e Rastro em lote).
- `Auth.gs` — API Token (REST), cache do token e GET autenticado com renovação em 401.
- `PrePostagem.gs` — consulta da Pré-Postagem e diagnóstico do OpenAPI (`listarParametrosConsulta`).
- `Reversa.gs` — montagem/envio do SOAP de Logística Reversa (individual e em lote com `fetchAll`) e leitura do WSDL/XSD para a tela de teste (`descreverReversa`).
- `ReversaSolicitacao.gs` — solicitação de autorização (tela de teste): validar (`validarPostagemReversa`, não cria), solicitar (`solicitarPostagemReversa`) e cancelar (`cancelarPedido`), JSON → XML na ordem do WSDL.
- `ReversaParser.gs` — parser do XML (`XmlService`): uma entrada por autorização, histórico agrupado, status atual.
- `Rastro.gs` — API Rastro (REST): consulta individual (tela de teste) e em lote com `fetchAll` (`consultarRastroLote_(codigos, resultado)`, padrão `U`; o histórico usa `T`), renovando o token em 401.
- `RastroParser.gs` — parser do JSON do Rastro: eventos (mais recente primeiro; com `unidade`/`destino` em texto "Tipo - CIDADE / UF"), último evento, `dtPrevista` do objeto, mensagem de erro (ex.: SRO-020).
- `Status.gs` — resumo do `Status tracking` (`RESUMOS_STATUS`) e status finalizadores (`STATUS_FINAIS`); listas editáveis.
- `Classificador.gs` — tipo do código pela quantidade de caracteres: 10 dígitos autorização, 13 (`AA999999999AA`) rastreio, 14 dígitos Jadlog.
- `Planilha.gs` — menu **Correios** (`onOpen`) e atualização da aba base: lê `Autorização Postagem`, grava `Código convertido`, `Status tracking`, `Data Ocorrencia`, `cidade ultima interação` e `Data Prevista Entrega` (Reversa → Rastro).
- `Relatorios.gs` — percorre relatórios em pastas do Drive (pasta definida em cada cruzamento; drive compartilhado), achando o arquivo pelo nome com ou sem extensão: planilha Google, `.xlsx`/`.xls` (cópia convertida temporária via serviço avançado Drive API v3, enviada à lixeira) e `.csv` (baixado em partes, linha a linha).
- `Importacao.gs` — botão "Importar protocolos do Drive": alimenta a aba base com o relatório `Consolidado_Protocolos` (remove duplicados e linhas sem autorização, acrescenta protocolos novos; cópia oculta `<aba>_backup` antes de gravar).
- `Cruzamentos.gs` — lista `CRUZAMENTOS` (id, pasta, arquivo, chave da base, chave do relatório, chave composta com rastreio, exclusão de linhas de outro cruzamento, colunas trazidas ou de presença Sim/Não) e o botão de menu "Cruzar com relatórios do Drive", que executa todos na ordem da lista.
- `Intelipost.gs` — consulta Jadlog via Web App proxy corporativo da Intelipost: lote (uma chamada por lote), consulta crua da tela de teste e amostra de protocolos da base.
- `IntelipostParser.gs` — interpreta `{ sucesso, dados }` do proxy: eventos do `detalhes.historico` por pedido (com `descricao` e `estadoTraduzido`), último evento, cidade, previsão de entrega se o proxy enviar (`CAMPOS_PREVISAO_INTELIPOST`); `statusIntelipost_`.
- `StatusExecucoes.gs` — registro do estado de cada processo para o painel de execuções (`gravarStatus_`/`lerStatus_`, `PAINEL_STATUS_<processo>`), progresso do tracking, `statusExecucoes()` (leitura do painel), `MSG_OCUPADO`.
- `Cadeia.gs` — cadeia protocolos → relatórios → tracking → JSON (`executarCadeiaCompleta`, `continuarCadeia`, `avancarCadeia_`, `cancelarCadeia_`) e ações do painel (`acaoPainel`, `painelIniciar*`).
- `PayloadTracking.gs` — exportação JSON `Payload_Tracking` para outro projeto (ver seção própria): `gerarPayloadTracking`, menu "Gerar Payload_Tracking (JSON)".
- `Historico.gs` — `historicoTracking({ codigo, autorizacao, protocolo })`: histórico completo de um objeto, consulta pontual da janela "Histórico" (ver seção própria).
- `gs/Interface.gs` — páginas HtmlService: `doGet` (App da Web: painel; `?pagina=teste` = tela de teste), `abrirPainel` / `abrirTeste` (menu Correios), `include(nome)` para os modelos.
- `gs/Acompanhamento.gs` — `dadosAcompanhamentoOut()` para a tela "Acompanhamento - OUT": linhas da aba base com `Parceiro_Nome` preenchido, 14 colunas, valores já em texto (datas `dd/MM/yyyy[ HH:mm]`; `Data Prevista Entrega` só `dd/MM/yyyy`; `Assistencia_Tecnica` como Sim/Não; números com todos os dígitos) e títulos da tela em `rotulos`.
- `html/Index.html` — tela de teste das APIs (resposta crua).
- `html/VistaAcompanhamento.html` + `css/EstiloAcompanhamento.html` + `js/TelaAcompanhamento.html` — tela "Acompanhamento - OUT" (estrutura, estilo, lógica).
- `html/ModalHistorico.html` + `css/EstiloHistorico.html` + `js/HistoricoTracking.html` — janela "Histórico de rastreio" (`window.HistoricoTracking.abrir`).
- `html/VistaCruzamentos.html` + `css/EstiloCruzamentos.html` + `js/TelaCruzamentos.html` — vista "Cruzamentos" = painel de execuções com luzes (ver seção própria).
- `js/Agencia.html` + `css/EstiloAgencia.html` — agência de triagem animada (canvas, pixel art isométrica) da vista Cruzamentos, com a equipe, a ficha e o rastreamento dos malotes (`window.Agencia.atualizar(dados)`).
- `js/StatusVisual.html` — `window.classeStatus(status)`: cor do chip de status, usada pela tabela e pela janela de histórico.
- `js/FiltroMultiplo.html` + `css/EstiloFiltroMultiplo.html` — componente reutilizável de filtro em dropdown com seleção múltipla (`window.FiltroMultiplo`: `preencher`, `selecionados`, `limpar`).
- `html/Painel.html` — painel (interface principal), modelo que inclui `Tokens`, `Base`, `Componentes`, `Tema`, `Navegacao`, as telas (`Vista…`, `Estilo…`, `Tela…`) e a janela de histórico (`ModalHistorico`, `EstiloHistorico`, `HistoricoTracking`, `StatusVisual` antes dos scripts que o usam).
- `css/Tokens.html` — tokens de cor dos temas escuro (padrão) e claro (inclui os da agência de triagem: `--ag-*`). `css/Base.html` — tipografia, layout, scrollbar, responsivo. `css/Componentes.html` — cartões, KPI, botões, campos, chips, tabelas, resultado, avisos, progresso, segmentado, modal, estado vazio.
- `js/Tema.html` — troca de tema (`data-theme` no `<html>`, escolha no localStorage). `js/Navegacao.html` — troca de vistas pela barra lateral (`data-vista`), título do cabeçalho e `#vista` no endereço.

## Padrão visual (painel)

- Padrão "Controle de Insucessos": painel sóbrio estilo GitHub, laranja como marca, **tema escuro padrão** + tema claro (`data-theme`). Fontes IBM Plex Sans (texto) e IBM Plex Mono 600 (códigos/identificadores).
- CSS dos componentes usa **só** `var(--…)` de `css/Tokens` (nenhuma cor fixa). Raios: 8 controles, 9 segmentado, 12 cartões, 999 pílulas. Sem sombra em cartões (só `--shadow-pop` em modais/menus); sem gradientes.
- Cores semânticas: laranja = ação principal/ativo/foco/progresso (nunca erro); verde = sucesso; vermelho = erro/bloqueio (`.btn-perigo` só para destrutivo); violeta = fora do padrão; azul = informação; neutro = pendente/sem dados. Indicador com 0 fica neutro. Estado na tabela por chip ou barra de 4 px, nunca pintando a linha.
- Responsivo: ≤ 900 px a barra lateral vira só ícones; funciona a 360 px sem rolagem horizontal.
- Vistas: Visão geral, **Acompanhamento - OUT**, Protocolos, Rastreio, **Cruzamentos** (painel de execuções), Configurações (as demais vazias por enquanto). Tela nova = arquivo `html/Vista<Nome>` com a `<section class="vista" data-vista="…">` (incluído no Painel), `css/Estilo<Nome>` e `js/Tela<Nome>`; a navegação dispara o evento `vistamostrada` (detail = vista) para a tela carregar seus dados na primeira abertura.
- `[hidden]` esconde sempre (`display: none !important` no Base), inclusive componentes com `display` próprio.

### Tela "Acompanhamento - OUT"
- Dados: `dadosAcompanhamentoOut()` lê a aba base inteira uma vez; só linhas com `Parceiro_Nome`. Colunas (nome na base → título na tela, quando muda; `ROTULOS_ACOMPANHAMENTO_OUT`): Protocolo, Pedido, Dt. autorização, Dt. postagem, Autorização Postagem, Código convertido, Status tracking, Data Ocorrencia → "Data ultima Ocorrencia", cidade ultima interação → "Cidade ultima Ocorrencia", Data Prevista Entrega (só a data, sem a hora 23:59:59 do Rastro), Parceiro_Nome, Entrada_Lista, Assistencia_Tecnica → "Assistência Técnica" (**só na tela** vira Sim = preenchida / Não = vazia, `SIM_NAO_ACOMPANHAMENTO_OUT`; a base guarda o nome da assistência), Pedido_Parceiro. Os títulos mudam só no painel; a tela acha as colunas pelo nome da base. Colunas ausentes na base vêm vazias e são avisadas.
- Visão (controle segmentado): **"Em aberto"** (padrão) = status ainda consultado pelas APIs; **"Finalizado"** = status final. A classificação vem do servidor (`finalizadas[]` em `dadosAcompanhamentoOut`, mesma regra `statusFinalizado_` da atualização). Cada botão mostra quantas linhas passam na pesquisa e nos filtros atuais; sem resultado na visão aberta, o vazio avisa quantos há na outra.
- Pesquisa (no navegador, sem acento/maiúsculas, parte do texto): Pedido, Autorização Postagem, Código convertido, Parceiro_Nome, Pedido_Parceiro (Protocolo não entra). **Com termo na pesquisa, a tabela mostra os resultados das duas visões juntos** (em aberto e finalizados, independente do botão de visão); o texto do resumo diz "N protocolo(s) na pesquisa (x em aberto, y finalizado(s))". Filtros `FiltroMultiplo` (opções = valores distintos da visão atual — com pesquisa, das duas —, com contagem; inclui "(vazio)"): Status tracking, Parceiro_Nome, Entrada_Lista. Botões Limpar (pesquisa + filtros) e Atualizar (relê a base).
- `FiltroMultiplo`: checkboxes (nenhum marcado = todos); "Somente" aparece no hover/foco da linha (sempre visível em toque) e deixa só aquele marcado; busca interna esconde os `<li>` que não contêm o termo; "Selecionar todos" marca só os visíveis; "Limpar" desmarca todos; título "Rótulo (Todos)" / "Rótulo (N selec.)"; sem botão Aplicar — toda mudança chama a função global de `data-ao-mudar` (padrão `aplicarFiltrosGlobais`); eventos por delegação no `document` (click/change/input/Escape); clique fora ou em outro filtro fecha o menu.
- Tabela: 500 linhas por vez ("Mostrar mais"), cabeçalho fixo, códigos em Plex Mono. Última coluna "Histórico" (presa à direita na rolagem horizontal): botão que abre a janela de histórico com o `Código convertido` ou, se vazio, a `Autorização Postagem` da linha (linha sem nenhum dos dois fica sem botão). Status em chip: entregue = verde; não entregue/cancelado/expirado/desistência/erro = vermelho; rastreio expirado/aguardando/vazio = neutro; demais (em andamento) = laranja. Entrada_Lista e Assistência Técnica: Sim = verde, Não = neutro.

### Janela "Histórico de rastreio"
- Consulta **pontual** (só ao clicar; nada é gravado na planilha). A atualização da planilha continua buscando só o último evento.
- Servidor `historicoTracking` (`gs/Historico.gs`), fonte pelo código:
  - rastreio de 13 (o `Código convertido` ou o próprio código da coluna) → API Rastro `resultado=T`; se o Rastro não tiver o objeto (SRO-012/020…) e a linha tiver autorização de 10 dígitos, mostra o histórico da autorização (Logística Reversa) com aviso;
  - autorização de 10 → `acompanharPedido` (histórico); com `numero_etiqueta` → Rastro; sem etiqueta ou Rastro indisponível → eventos da reversa (histórico + situação do objeto, sem repetir);
  - Jadlog de 14 → a janela já põe `Protocolo + "RE"` no campo → proxy Intelipost (`consultarIntelipostLote_`); dados de cliente não são lidos.
  - Célula com vários códigos: consulta o primeiro e avisa os outros.
- Resposta só com texto: `{ codigo, fonte, status (resumido como na planilha), atualizadoEm, eventos [{ titulo, detalhe, de, para, local, dataHora "dd/MM/yyyy, HH:mm:ss" }] (mais recente primeiro), previsao ("dd/MM/yyyy" ou ''), avisos, erro }`; a previsão aparece no cartão ("Previsão de entrega").
- Tela (estrutura da referência): campo "Consultar objeto" + botão "Rastrear" (consulta outro código; a autorização da linha só vai junto enquanto o código for o da linha), nota de atenção, cartão com rótulo (Código de rastreio / Autorização de postagem / Pedido Jadlog), código grande em mono, chip de status e "Última atualização"; "Histórico de movimentação" em linha do tempo vertical (ícone por tipo de evento; o mais recente na cor do status), linhas "De:"/"Para:" (Rastro com `unidadeDestino`) ou o local, data em mono. Fecha com ×, clique fora ou Esc (foco volta ao botão da linha); resposta atrasada de consulta anterior é descartada.

### Painel de execuções (vista "Cruzamentos")
- Estado de cada processo nas Propriedades do script `PAINEL_STATUS_cadeia|importacao|cruzamentos|tracking|json` (JSON; `gravarStatus_` mescla e grava, falha de gravação não interrompe o processo). Estados → luz: `''`/`parado` apagada, `agendado` azul, `executando` laranja pulsando, `aguardando` (ciclo esperando a continuação) laranja, `ok` verde, `alerta` violeta (parcial / nova tentativa / sem sinal), `erro` vermelho.
- Quem grava: tracking (`atualizar_`: início com ciclo `{inicio, feitas, origem}`, progresso a cada lote no máx. a cada 5 s, fim `ok`/`aguardando`/`alerta`, erro em `executarComLock_`/`continuarAtualizacao`; `ultimaConclusao` = fim do último ciclo completo); relatórios (`iniciarCruzamentos_`/`executarCruzamentos_`: rodada + cada relatório em `relatorios[id]`, com % do CSV); importação (`executarImportacao_`); JSON (`gerarPayloadTracking(origem)`); cadeia (`Cadeia.gs`).
- "Sem sinal": processo ativo sem gravar há mais de 12 min e sem gatilho de continuação na fila (`processoVivo_`, `GATILHOS_DO_PROCESSO`; a cadeia vive enquanto a etapa atual viver) aparece como alerta e não bloqueia os botões.
- Tela, de cima para baixo: luz geral (erro > em andamento > atenção > ok) + "Tracking atualizado em … (há …)" e os botões; cartão **"Agência de triagem"** (cena animada, chip e resumo da cadeia; ver seção própria); **"Rastreamento dos malotes"** (tabela: uma linha por etapa e por relatório); **Equipe** (um cartão por funcionário: estado, tarefa, barra de progresso) + **ficha** do selecionado (responsável por, estado, progresso, etapa, atualizado, última mensagem completa); grade com o cartão do tracking (barra = linhas consultadas no ciclo / pendentes do ciclo, última conclusão, ciclo, execução, próxima continuação, mensagem) e o cartão de legenda + acionadores do projeto (`ScriptApp.getProjectTriggers`, só os da conta que abriu). Relê sozinho a cada 10 s com algo em andamento, senão 60 s, só com a vista aberta e a aba visível.
- Botões (`acaoPainel`): "Executar cadeia completa", "Atualizar tracking", "Cruzar relatórios" entram na fila por gatilho de uso único (`painelIniciarCadeia|Tracking|Cruzamentos`, começam em ~1 min; a tela não fica presa); "Gerar JSON" roda na hora. Recusa se o processo já estiver vivo.
- Luz com brilho (`box-shadow` colorido) é exceção consciente à regra "sem sombra": só na lâmpada; `prefers-reduced-motion` desliga o pulso.

### Agência de triagem (`js/Agencia`, `css/EstiloAgencia`)
- Tema escolhido entre os modelos (galpão, torre, missão, agência): a cadeia como uma agência postal **genérica** (sem logotipo nem cores de marca), em pixel art isométrica num `<canvas>` (820×500 lógicos; rola na horizontal dentro do cartão em telas estreitas, mín. 640 px). Fonte pixelada **Silkscreen** (Google Fonts, no `Painel`). Cores: tokens `--ag-*` de `css/Tokens` (relidos ao trocar o tema) + cores de estado do painel.
- Um funcionário por tarefa, cada um com crachá, **luz de estado sobre a cabeça** e **balão** com o que está fazendo (só em quem trabalha, aguarda, tem problema ou está selecionado; ✓ concluído, "z" parado):
  - **Íris (balcão)** = importação: envelopes caem da fenda "DRIVE" na bandeja; fala com os protocolos novos (lidos da mensagem).
  - **Triagem** = um separador por item de `CRUZAMENTOS` (até 4; nomes Davi, Lia, Caio, Tina; seção da estante com o `rotulo`): 12 escaninhos acendem com o % lido (`progresso` do CSV; xlsx sem % = meia estante); envelopes voam da mesa para a estante; erro = estante vermelha.
  - **Carteiros Beto/Nina/Rui** = tracking (Reversa, Rastro, Jadlog; o status é um só, as falas mudam: linhas do ciclo, "Rastro: …"/"Intelipost: …" tirados da mensagem de conclusão); alfinete de cada rota no **mapa de rotas** = linhas consultadas / pendentes; carrinhos de correspondência na faixa do piso.
  - **Gabi (expedição)** = Payload JSON; o **furgão** sai da doca até ~15 s depois de o arquivo ser gerado; placa "Última saída".
  - **Sr. Elias (chefe da agência)** = cadeia ("Etapa: …", "Concluída com alerta"…; sem cadeia, diz o que está em andamento).
- Movimento só em `executando`; `aguardando` = parado com luz laranja e "Continua às HH:mm"; alerta/erro = braço levantado e balão com a borda na cor. Caixas, envelopes e carrinhos são efeito visual, não linhas reais.
- **Rastreamento dos malotes**: objeto `MP 000 00n BR` por etapa; situação no vocabulário do rastreio — Postado (na fila), Em triagem / Em trânsito / Saiu para entrega (em execução), Aguardando na unidade (aguardando continuação), Entregue (ok), Tentativa de entrega (alerta), Devolvido ao remetente (erro); detalhe = fala (mensagem completa na dica), atualizado = fim.
- Clique numa pessoa (na cena ou na lista) seleciona e mostra a ficha. `Agencia.atualizar(dados)` é chamado por `js/TelaCruzamentos` a cada leitura; animação (requestAnimationFrame) só com a vista aberta e a aba visível; com `prefers-reduced-motion` a cena fica parada mostrando o estado.

### Cadeia de atualização (`Cadeia.gs`)
- Importação de protocolos → relatórios do Drive → tracking → Payload_Tracking (gerado no fim do tracking). Entradas: menu Correios › "Importar protocolos e atualizar tudo (relatórios → tracking → JSON)" (`menuImportarProtocolos`), acionador de tempo em `executarCadeiaCompleta`, botão do painel. `importarProtocolos()` (editor) importa sem a cadeia.
- Cada etapa roda com as próprias continuações; ao terminar chama `avancarCadeia_(etapa, alerta)`, que agenda `continuarCadeia` (~1 min) para a próxima. Lock ocupado (`MSG_OCUPADO`) → reagenda. Importação com erro para a cadeia (base não mudou); erro em relatório não impede o tracking (cadeia termina como alerta); tracking/JSON avulsos durante a cadeia não a avançam fora de ordem (só avança se a etapa atual for a que terminou).
- "Cancelar continuação automática" também cancela a cadeia e os pedidos do painel (`cancelarCadeia_`: processos ativos → `parado`).
- Acionadores sugeridos (Apps Script › Acionadores): `atualizarAutorizacoes` (tracking + JSON; recebe o evento, não reprocessa) várias vezes ao dia e/ou `executarCadeiaCompleta` (tudo). Atenção à cota diária de execução e de `UrlFetchApp`.

## Exportação `Payload_Tracking` (JSON para outro projeto)

- `gs/PayloadTracking.gs` (`PAYLOAD_TRACKING`): arquivo `Payload_Tracking` (sem extensão, tipo `application/json`) na pasta `1Zk2F78…` do Drive (drive compartilhado, a mesma do `Consolidado_Anymarket_OUT`). **Sobrescrito** a cada geração (`setContent`, mesmo ID); se não existir, é criado; com mais de um de mesmo nome, usa o atualizado mais recentemente. Acima de ~9 MB grava pelo serviço avançado Drive API v3.
- Gerado pelo menu "Gerar Payload_Tracking (JSON)", pelo painel e no fim de cada ciclo **completo** da atualização de status (não nas execuções parciais); falha na geração não desfaz a atualização, só aparece no resumo.
- Formato: `{ versao: 1, geradoEm: "AAAA-MM-DDTHH:mm:ss-03:00", totalPedidos, pedidos: { "<Pedido_Parceiro>": { status, dataOcorrencia, cidade, dataPrevista, autorizacao, assistencia, parceiro } } }`.
  - Campos ← colunas: `status` ← Status tracking; `dataOcorrencia` ← Data Ocorrencia; `cidade` ← cidade ultima interação (só a cidade, a base não guarda a UF); `dataPrevista` ← Data Prevista Entrega; `autorizacao` ← Autorização Postagem; `assistencia` ← Assistencia_Tecnica como **"Sim"/"Não"** (o nome da assistência não vai); `parceiro` ← Parceiro_Nome.
  - Datas `dd/MM/yyyy`; números como texto com todos os dígitos; vazio = `""` (nunca null).
  - Só linhas com `Pedido_Parceiro`; Pedido_Parceiro repetido → fica a linha com a `Data Ocorrencia` mais recente (sem data nas duas, a mais abaixo na base). Coluna ausente vai vazia e é avisada no resumo.

## Configuração

Propriedades do script (Configurações do projeto > Propriedades do script): `CORREIOS_USER`, `CORREIOS_API_KEY`, `CORREIOS_CARTAO`, `CORREIOS_COD_ADMINISTRATIVO`, `INTELIPOST_PROXY_URL` (URL interna do Web App proxy; não versionar).

## Importação de protocolos (`Importacao.gs`)

- Fonte: `Consolidado_Protocolos` (.xlsx) na pasta `1ToW75Ft…` do Drive (`IMPORTACAO_PROTOCOLOS`; o ID também pode ser do próprio arquivo). Colunas do relatório: Protocolo, Pedido, Cliente Prime, Valor Venda, CEP do Pedido, Dt. abertura SAC, Dt. abertura RMA, Dt. autorização, Dt. postagem, Autorização Postagem, Tipo da Solicitação, Status RMA, Tipo abertura. Só as 8 da base são copiadas: Protocolo, Pedido, Cliente Prime, Dt. autorização, Dt. postagem, Autorização Postagem, Tipo da Solicitação, Tipo abertura.
- Ordem: (1) lê o relatório (se falhar, a base não muda); (2) na base, remove linhas sem `Autorização Postagem` e protocolos duplicados — fica a primeira ocorrência, com as colunas calculadas que já tinha; (3) acrescenta no fim os protocolos do relatório que não estão na base e têm `Autorização Postagem` (os que já existem são ignorados, sem atualizar nada; repetidos no relatório entram uma vez).
- Grava o bloco inteiro de uma vez por cima e limpa as linhas que sobraram no fim; antes, copia a aba para a aba oculta `<aba>_backup` (substitui a anterior). Apaga o cursor da atualização de status (linhas mudaram de posição). Recusa rodar com uma rodada de cruzamentos em andamento (os cruzamentos guardam posições de linha).
- Execução única (sem continuação automática); resumo no toast.

## Cruzamentos com relatórios do Drive

- Cada item de `CRUZAMENTOS` tem a sua pasta (`pasta`, ID no Drive, drive compartilhado). Requer o serviço avançado **Drive API (v3)** ativado no projeto (Serviços > + > Drive API, identificador `Drive`) para converter `.xlsx`.
- Arquivo achado pelo nome com ou sem extensão (`"Lista MSPC"` acha `Lista MSPC` e `Lista MSPC.xlsx`, não `Lista MSPC - antiga.xlsx`); se houver mais de um, usa o atualizado mais recentemente. Cabeçalho na linha 1; colunas achadas pelo nome (sem acentos/maiúsculas).
- CSV: baixado em partes de 4 MB (`Range` em `https://www.googleapis.com/drive/v3/files/{id}?alt=media`, token de `ScriptApp.getOAuthToken()`), sem o limite de 50 MB do `getBlob` ("excede o tamanho de arquivo máximo"). Separador detectado no cabeçalho (`;` do Excel brasileiro, `,` ou tab); codificação UTF-8 ou ISO-8859-1 (Excel), BOM removido; aspas e quebras de linha dentro de aspas tratadas.
- Só as chaves que existem na base são guardadas durante a leitura (memória).
- **Um clique basta**: a rodada é feita em etapas. Cada execução vai até `TEMPO_MAXIMO_MS`; um CSV para numa quebra de linha e salva a posição (`CRUZ_ESTADO` nas Propriedades do script) e as linhas já encontradas (mapas de bits base64 em `CRUZ_BITS_<id>_<n>_<pedaço>`); o gatilho de uso único `continuarCruzamentos` segue em ~1 min. Um relatório que não é CSV (xlsx/planilha) não pode ser pausado: só começa numa execução se ainda não passou 1/3 do tempo. Gatilho de segurança de 7 min no início de cada execução; `MAX_FALHAS` execuções seguidas sem avanço param a rodada. Se o lock estiver ocupado (ex.: atualização de status rodando), a continuação se reagenda.
- Valor trazido em CSV retomado: "primeiro valor preenchido" vale por linha da base durante a rodada inteira (mapa de bits por coluna trazida). Presença (Sim/Não) só é gravada no fim do relatório.
- Resultado da rodada: toast (se terminar na mesma execução), registro de execuções e **nota no cabeçalho da coluna `Pedido`** ("Último cruzamento com relatórios (data): …"). "Cancelar continuação automática" também cancela uma rodada de cruzamentos em andamento.
- Coluna não encontrada: o erro lista as colunas lidas do cabeçalho (diagnóstico de separador/codificação).
- Chave comparada como texto (trim, maiúsculas; número inteiro sem casas decimais).
- Coluna trazida (`{ relatorio, base }`): chave repetida no relatório usa a primeira linha com o valor preenchido; sem correspondência mantém o valor que já estava na base. Com `texto: true`, a coluna é formatada como texto (`@`) antes de gravar e todo número da coluna (inclusive os já gravados) vira texto com todos os dígitos (`numeroComoTexto_`), evitando a notação científica do Sheets em códigos longos.
- Coluna de presença (`{ base, presenca: true }`): toda linha com chave recebe "Sim" ou "Não" conforme o relatório atual; linha sem chave fica vazia.
- Chave composta (`rastreioRelatorio`): pedido + código de rastreio. Do lado da base, os códigos da linha são os do `Código convertido` e o código da própria `Autorização Postagem` (rastreio de 13, Jadlog…); casa se qualquer um deles bater. Rastreio normalizado (sem espaços, maiúsculas).
- `ignorarLinhasDe: '<id>'`: as linhas que tiveram correspondência no cruzamento indicado (executado antes, na mesma rodada) não são cruzadas; coluna de presença fica vazia. Se o cruzamento de que depende falhar, este não é executado.
- Um cruzamento com erro (arquivo/coluna não encontrada) não impede os demais; o toast lista o resultado de cada um.
- Atuais (todos com `Base_Dados.Pedido`):
  - `Consolidado_Anymarket_OUT` (**`.csv`** desde nov/2026, lido em partes e retomável como os demais CSV; antes `.xlsx` e `Consolidado_Parceiros_Out.xlsx`; pasta `1Zk2F78…`; com o `.xlsx` antigo na pasta, vale o atualizado mais recentemente — o tipo é decidido pela extensão, mesmo que o Drive marque o CSV como planilha do Excel) `pedido_codigo` → `Parceiro` em `Parceiro_Nome` e `parceiro_pedido` em `Pedido_Parceiro` (como texto, `texto: true`) (cada coluna pega o primeiro valor preenchido do pedido, de forma independente). O sufixo `_OUT` indica parceiros externos (não é mês); o nome do arquivo é fixo.
  - `Relatorio Ordem de Serviço - Consolidado` (id `ordemServico`, pasta `15e1Qbj…`): chave `Número do Pedido` + `Código do Rastreio da Postagem` → `Nome da Assistência Técnica` em `Assistencia_Tecnica`.
  - `Lista MSPC` (id `listaMspc`, entradas no estoque, pasta `12d0yus…`) `Num do pedido` → presença em `Entrada_Lista` (Sim/Não), **exceto** as linhas que casaram na Ordem de Serviço (pedido + rastreio), que ficam vazias.
- Novos cruzamentos: acrescentar itens em `CRUZAMENTOS`; não criar botões separados.

## Jadlog (Intelipost)

- Linhas com `Autorização Postagem` de 14 dígitos (Jadlog). Código consultado: `Protocolo` + `RE` (ex.: `4293792261107` → `4293792261107RE`); linha sem protocolo é ignorada.
- Web App proxy (`INTELIPOST_PROXY_URL`, host `script.google.com`): `POST { pedidos: [...] }` com `Authorization: Bearer ScriptApp.getOAuthToken()`, um POST por lote. O proxy é restrito ao domínio corporativo: a conta que executa o script precisa ter acesso a ele. Sem a propriedade configurada, as linhas Jadlog são puladas e o resumo avisa.
- Resposta: `{ sucesso, total, dados: [{ pedido, ultimaOcorrencia, endereco, detalhes: { clienteNome, endereço..., historico: [...] } }] }`. **Dados do cliente (`endereco`, `detalhes.clienteNome`, logradouro etc.) não são lidos, gravados nem registrados.**
- Evento (`detalhes.historico[]`): `shipment_order_volume_state` (estado geral: NEW, CREATED_AT_LOGISTIC_PROVIDER, IN_TRANSIT, DELIVERED…), `shipment_volume_micro_state.default_name` (ex.: "EM TRANSFERENCIA", "COLETA REALIZADA"), `event_date` (ms) / `event_date_iso`, `location.city`/`state_code` (nulos nos eventos iniciais).
- Previsão de entrega: **o proxy atual não envia** (não há data prevista no payload). `previsaoIntelipost_` já lê, no pedido ou em `detalhes`, os campos `dataPrevista`, `previsaoEntrega`, `estimated_delivery_date` ou `estimated_delivery_date_iso` (ms, ISO ou DD/MM/AAAA): se o proxy passar a enviar um deles, `Data Prevista Entrega` é preenchida sem mudar o script; sem o campo, a célula fica como está.
- Gravação: `Status tracking` = `ESTADOS_INTELIPOST[estado]` (DELIVERED → Entregue, CANCELLED → Cancelado, TO_BE_DELIVERED → Saiu para entrega, DELIVERY_FAILED → Não entregue) ou o nome do último evento resumido por `RESUMOS_STATUS` (texto todo em maiúsculas vira "Primeira maiúscula"); `Data Ocorrencia` = `event_date` do último evento; `cidade ultima interação` = cidade do evento mais recente que tiver cidade, em maiúsculas.
- Pedido ausente em `dados` ou erro do proxy: grava `Erro intelipost: ...` só se a linha não tiver status anterior válido. Resumo "Intelipost: x ok, y sem resposta (...)" no toast/registro.

## Planilha base

Aba consultada: **`Base_Dados`** (`CONFIG.PLANILHA.ABA`); a planilha terá outras abas. Colunas da aba: Protocolo, Pedido, Cliente Prime, Dt. autorização, Dt. postagem, Autorização Postagem, Tipo da Solicitação, Tipo abertura (+ `Código convertido`, `Status tracking`, `Data Ocorrencia`, `cidade ultima interação` e `Data Prevista Entrega`, criadas pelo script se não existirem). Colunas são localizadas pelo nome do cabeçalho (sem diferenciar acentos/maiúsculas).

- Fluxo por lote: (1) autorizações (10) sem `Código convertido` → Logística Reversa (código + status); (2) Jadlog (14) → Intelipost (ver seção acima); (3) todo código de rastreio disponível — `Código convertido` ou o próprio código (13) da coluna — → API Rastro (`resultado=U`).
- Veredito do `Status tracking`: último evento do Rastro, **resumido** (ex.: "Objeto saiu para entrega ao destinatário" → "Saiu para entrega"; "Objeto em transferência - por favor aguarde" → "Objeto em transferência"; "Objeto entregue ao destinatário" → "Entregue"). Sem regra em `RESUMOS_STATUS`, usa o texto antes de " - ". Se o Rastro falhar, fica o status da reversa (descrição mais recente entre `objeto` e `historico`); para códigos de rastreio diretos, grava `Erro rastro: ...`.
- `Data Ocorrencia`: data/hora do evento usado no status (`dtHrCriado` do Rastro ou data+hora da reversa), gravada como data no fuso da planilha (formato `dd/mm/yyyy` ao criar a coluna).
- `cidade ultima interação`: `unidade.endereco.cidade` do último evento do Rastro (sem UF). Só vem do Rastro; se o Rastro falhar ou o evento não trouxer cidade, a célula fica como está. Para preencher linhas já finalizadas, usar "Reprocessar todas".
- `Data Prevista Entrega` (`CONFIG.PLANILHA.COL_PREVISAO`, formato `dd/mm/yyyy` ao criar): `dtPrevista` do objeto no Rastro (ex.: `2026-11-17T23:59:59`), para todo código de rastreio (o `Código convertido` e o código de 13 da coluna); vários códigos na linha → o do evento mais recente. Sempre substituída pela mais atual (os Correios podem reprogramar); sem previsão ou com o Rastro falhando, a célula fica como está. Jadlog: ver seção Jadlog. Linhas finalizadas só são preenchidas com "Reprocessar todas".
- `Código convertido` fica vazio quando a coluna já traz o código de rastreio (decisão do usuário).
- Motivo: a reversa às vezes fica em "Coletado" quando o objeto já foi entregue; o Rastro é a fonte confiável depois da postagem.
- Autorização que já tem `Código convertido` só consulta o Rastro, também no "Reprocessar todas" (o código não muda depois de emitido; refazer a reversa só dobrava as chamadas).
- Só vão para as APIs as linhas cujo `Status tracking` não é final. Finais (`STATUS_FINAIS`): entregue, desistência (ex.: "Desistência do Cliente ECT"), prazo expirado, rastreio expirado (SRO-012), cancelada; "não entregue" e "Erro…" nunca são finais. "Reprocessar todas" ignora essa regra.
- Execução limitada a ~4,5 min; se o tempo acabar, a próxima linha fica em `REVERSA_PROXIMA_LINHA` (Propriedades do script, válida só para a aba gravada em `REVERSA_ABA`) e um gatilho de tempo de uso único (`continuarAtualizacao`, ~1 min) segue dali sozinho até o fim; o gatilho é apagado ao disparar e ao terminar o ciclo.
- O Apps Script pode encerrar à força ("Tempo máximo de execução excedido") se um lote demorar; por isso: cada lote é gravado na planilha e o cursor atualizado logo após a consulta; o próximo lote só começa se couber no tempo (estimado pelo lote mais demorado); e no início de cada execução é agendado um gatilho de segurança (`ESPERA_SEGURANCA_MS`, 7 min) que retoma do cursor se a execução morrer.
- Falhas temporárias do gateway (ex.: `504 GTW-005: Tempo limite esgotado`, `429`) são repetidas na hora (`CONFIG.HTTP.RETENTATIVAS`, espera 2 s/4 s ou o `Retry-After`, até 30 s); se persistirem, o erro só é gravado no `Status tracking` quando não há status anterior válido — senão o status anterior fica e a linha volta a ser consultada na próxima execução.
- Se o Rastro recusar o lote inteiro com erro temporário, a execução para nesse lote e agenda nova tentativa em `ESPERA_SOBRECARGA_MS` (5 min), em vez de seguir disparando requisições que falham; conta como execução sem avanço para `MAX_FALHAS`.
- Toda execução termina com um resumo do Rastro no toast e no registro de execuções (ex.: "Rastro: 5 ok, 45 sem resposta (HTTP 429: … ×45)"); falhas do Rastro em linhas de autorização não aparecem na planilha, então o diagnóstico é por esse resumo.
- Erro de comunicação também agenda nova tentativa; após `MAX_FALHAS` execuções automáticas seguidas sem gravar nenhum lote o ciclo para (cursor mantido; o menu zera a contagem).
- Menu "Cancelar continuação automática" apaga o gatilho pendente e o cursor.
- "Reprocessar todas" pelo menu apaga o cursor e sempre começa da primeira linha de dados (as continuações automáticas dele seguem do cursor normalmente).
- Mensagens do menu usam `toast` (não bloqueia); não usar `ui.alert`, que trava a execução até alguém clicar em OK.
- Conta Gmail comum: gatilhos somam no máx. 90 min/dia de execução e 20 mil chamadas `UrlFetchApp`/dia (Workspace: 6 h e 100 mil).

## Regras do projeto

- **Nunca** versionar credenciais: ficam só nas Propriedades do script (ver Configuração).
- Não registrar tokens, CNPJ, contrato ou dados de destinatários em logs, commits ou arquivos de exemplo.
- Toda chamada HTTP usa `UrlFetchApp.fetch` (ou `buscarTodos_` em lote) com `muteHttpExceptions: true` e devolve `{ etapa, url, status, body }`.
- Requisições REST só para `https://api.correios.com.br/`; SOAP só para os hosts em `HOSTS_REVERSA`; Intelipost só pelo proxy em `https://script.google.com/` (`INTELIPOST_PROXY_URL`); download de relatórios CSV só em `https://www.googleapis.com/drive/v3/files/`.

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
- Resposta (confirmada, versão 3.8.3): `objetos[0]` com `codObjeto`, `tipoPostal`, `dtPrevista` (previsão de entrega, ex.: `2026-11-17T23:59:59`; gravada em `Data Prevista Entrega`), dimensões/peso e `eventos[]` (mais recente primeiro) com `codigo` (ex.: BDE, OEC, RO, BDR, PO), `tipo`, `dtHrCriado` (AAAA-MM-DDTHH:MM:SS), `descricao`, `detalhe`, `unidade`/`unidadeDestino`. Sem eventos vem `mensagem` (ex.: `SRO-020` objeto não encontrado). O mesmo `codigo` (ex.: BDR) tem significados diferentes conforme o `tipo`, por isso o resumo usa a `descricao`.

- Objetos postados há mais de 180 dias não são consultáveis: `SRO-012: Objeto postado há mais de 180 dias. O prazo para consulta expirou` (HTTP 200, sem eventos). Para esses, só vale o status da reversa, gravado com a marca "(rastreio expirado)" — ou "Rastreio expirado" se não houver status — e tratado como final.

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

#### Solicitação de autorização de postagem (WSDL confirmado, nov/2026)
- Mesmo Web Service SOAP (mesmo endpoint, Basic Auth). Operações do WSDL: `solicitarPostagemReversa`, **`validarPostagemReversa`** (confere os dados sem criar), `solicitarPostagemSimultanea`/`validarPostagemSimultanea`, `cancelarPedido` (`codAdministrativo`, `numeroPedido`, `tipo`), `revalidarPrazoAutorizacaoPostagem` (`numeroPedido`, `qtdeDias`), `solicitarRange` (`tipo`, `servico`, `quantidade` → `faixa_inicial`/`faixa_final`), `calcularDigitoVerificador`, `consultarResumoColeta` (`codigoObjeto`), `sobreWebService`, `acompanharPedido`/`acompanharPedidoPorData`. Leitura do WSDL: botão "Ver operações (WSDL)" (`descreverReversa`).
- `solicitarPostagemReversa` (xs:sequence, ordem obrigatória): `codAdministrativo`, `codigo_servico`, `cartao`, `destinatario` (nome, logradouro, numero, complemento, bairro, referencia, cidade, uf, cep, ddd, telefone, ddd_celular, celular, email, identificacao, ciencia_conteudo_proibido), `coletas_solicitadas`* = coletaReversa: [coleta] tipo, id_cliente, valor_declarado, descricao, cklist, documento*, remetente (nome … email, ciencia_conteudo_proibido, identificacao, ddd_celular, celular, sms, restricao_anac, documento_estrangeiro), produto* (codigo, tipo, qtd); [extensão] numero, ag, cartao, servico_adicional, ar, obj_col* (item, desc, entrega, num, id).
- `validarPostagemReversa`: `codAdministrativo`, `codigo_servico`, `cartao`, `cep_destinatario`, `coleta` (uma coletaReversa) → `cod_erro`/`msg_erro`.
- Resposta `retornoPostagem`: status_processamento, data/hora_processamento, cod_erro, msg_erro, `resultado_solicitacao`* (tipo, id_cliente, **numero_coleta** = número da autorização, numero_etiqueta, id_obj, status_objeto, prazo, data/hora_solicitacao, codigo_erro, descricao_erro).
- Implementado só na tela de teste (`ReversaSolicitacao.gs`, cartão "Solicitar autorização de postagem"): JSON → XML na ordem do WSDL (`ESQUEMA_REVERSA`), campos vazios omitidos; "Validar" usa `validarPostagemReversa` (primeira coleta); "Solicitar" e "Cancelar" exigem marcar a confirmação. **Em produção, solicitar cria uma autorização real** (pode notificar o cliente e gerar custo quando postada): validar antes e cancelar autorizações de teste.
- Pendentes: `codigo_servico` reverso do contrato, endereço do CD (destinatario), origem dos dados do remetente (cliente), significado de `tipo`/`servico_adicional`/`ar`/`ag` nos valores do contrato.

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
4. ~~Consultar os códigos de rastreio na API Rastro.~~ (feito — `Rastro.gs`); ~~integração Jadlog (14)~~ (feito — `Intelipost.gs`).
5. Agendar atualização periódica (gatilho recorrente em `atualizarAutorizacoes`), respeitando cotas do `UrlFetchApp`.

## Referências

- Manual de integração Correios API: https://www.correios.com.br/atendimento/developers/arquivos/manual-para-integracao-correios-api
- Manual do Web Service de Logística Reversa: https://www.correios.com.br/atendimento/developers/arquivos/manual-de-implementacao-do-web-service-logistica-reversa.pdf
- Catálogo CWS (Swagger, requer login): https://cws.correios.com.br/

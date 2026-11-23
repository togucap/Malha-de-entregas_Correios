/**
 * Registro do estado de cada processo para o painel de execuções (vista "Cruzamentos" do painel).
 * Cada processo grava o seu estado numa Propriedade do script (PAINEL_STATUS_<processo>, JSON);
 * o painel lê tudo por statusExecucoes() (ver Cadeia.gs para a cadeia e as ações do painel).
 *
 * Estados (cor da luz no painel):
 *   ''          sem registro (apagada)
 *   agendado    na fila, começa em ~1 min (azul)
 *   executando  rodando agora (laranja pulsando)
 *   aguardando  ciclo em andamento, esperando a continuação automática (laranja)
 *   ok          concluído (verde)
 *   alerta      concluído ou continuando com problema parcial (violeta)
 *   erro        parou com erro (vermelho)
 *   parado      cancelado pelo menu (apagada)
 * Horários em milissegundos (Date.now()); o painel formata.
 */

const STATUS_PREFIXO = 'PAINEL_STATUS_';
// resposta de quem não conseguiu o lock (outra execução em andamento); comparada pela cadeia
const MSG_OCUPADO = 'Há outra execução em andamento (atualização, relatórios ou importação). Tente novamente em alguns minutos.';
const PROCESSOS_PAINEL = ['cadeia', 'importacao', 'cruzamentos', 'tracking', 'json'];
const STATUS_MSG_MAX = 1500;            // tamanho máximo da mensagem guardada (limite das Propriedades: 9 KB por valor)
const STATUS_INTERVALO_PROGRESSO = 5000; // no máximo uma gravação de progresso a cada 5 s

function lerStatus_(processo) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(STATUS_PREFIXO + processo) || '{}') || {};
  } catch (e) {
    return {};
  }
}

// Mescla `mudancas` no estado atual do processo e grava; devolve o estado gravado.
// Falha ao gravar (cota das Propriedades) não interrompe o processo.
function gravarStatus_(processo, mudancas) {
  const s = lerStatus_(processo);
  Object.keys(mudancas).forEach(function (k) { s[k] = mudancas[k]; });
  if (typeof s.mensagem === 'string' && s.mensagem.length > STATUS_MSG_MAX) s.mensagem = s.mensagem.slice(0, STATUS_MSG_MAX) + '…';
  s.atualizadoEm = Date.now();
  try {
    PropertiesService.getScriptProperties().setProperty(STATUS_PREFIXO + processo, JSON.stringify(s));
  } catch (e) {
    console.warn('Status do painel não gravado (' + processo + '): ' + (e && e.message ? e.message : e));
  }
  return s;
}

const ESTADOS_ATIVOS = ['agendado', 'executando', 'aguardando'];
const SEM_SINAL_MS = 12 * 60 * 1000; // ativo sem gravar nada há mais tempo que isso e sem gatilho na fila = parou
// gatilhos que mantêm cada processo vivo entre execuções
const GATILHOS_DO_PROCESSO = {
  cadeia: ['continuarCadeia', 'painelIniciarCadeia'],
  cruzamentos: ['continuarCruzamentos', 'painelIniciarCruzamentos'],
  tracking: ['continuarAtualizacao', 'painelIniciarTracking'],
  importacao: [],
  json: []
};

/**
 * O processo está de fato em andamento? Estado ativo e (sinal recente ou gatilho na fila).
 * A cadeia também está viva enquanto a etapa atual estiver. `nomesGatilhos` = funções com gatilho no projeto.
 */
function processoVivo_(processo, s, nomesGatilhos, todos) {
  if (ESTADOS_ATIVOS.indexOf(s.estado) < 0) return false;
  if (s.atualizadoEm && Date.now() - s.atualizadoEm <= SEM_SINAL_MS) return true;
  if ((GATILHOS_DO_PROCESSO[processo] || []).some(function (f) { return nomesGatilhos.indexOf(f) >= 0; })) return true;
  if (processo === 'cadeia' && todos && todos[s.etapa]) return processoVivo_(s.etapa, todos[s.etapa], nomesGatilhos);
  return false;
}

function nomesGatilhos_() {
  return ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
}

function mensagemErro_(e) {
  return String(e && e.message ? e.message : e);
}

/* ---------- Tracking (chamadas por atualizar_, em Planilha.gs) ---------- */

let statusTrackingExec_ = null; // estado desta execução: { ciclo, ultimaGravacao }

/**
 * Início de uma execução da atualização. novoCiclo = começa da primeira linha (sem cursor).
 * pendentes = linhas que ainda serão consultadas no ciclo (a partir do cursor).
 */
function statusTrackingInicio_(novoCiclo, pendentes, reprocessar, origem) {
  const anterior = lerStatus_('tracking');
  const ciclo = novoCiclo || !anterior.ciclo
    ? { inicio: Date.now(), feitas: 0, reprocessar: !!reprocessar, origem: origem || 'menu' }
    : anterior.ciclo;
  statusTrackingExec_ = { ciclo: ciclo, ultimaGravacao: Date.now() };
  gravarStatus_('tracking', {
    estado: 'executando',
    ciclo: ciclo,
    execucaoInicio: Date.now(),
    proxima: null,
    progresso: { feitas: ciclo.feitas, restantes: pendentes },
    mensagem: (novoCiclo ? 'Ciclo iniciado' : 'Continuando o ciclo') + ': ' + pendentes + ' linha(s) a consultar.'
  });
}

// Depois de cada lote gravado (com intervalo mínimo entre gravações, salvo `forcar`)
function statusTrackingProgresso_(feitasExecucao, restantes, forcar) {
  const ex = statusTrackingExec_;
  if (!ex) return;
  if (!forcar && Date.now() - ex.ultimaGravacao < STATUS_INTERVALO_PROGRESSO) return;
  ex.ultimaGravacao = Date.now();
  gravarStatus_('tracking', { progresso: { feitas: ex.ciclo.feitas + feitasExecucao, restantes: restantes } });
}

/**
 * Fim de uma execução. estado: 'ok' (ciclo completo), 'aguardando' (continua sozinho),
 * 'alerta' (Rastro recusou ou falha de comunicação; nova tentativa agendada).
 */
function statusTrackingFim_(estado, mensagem, feitasExecucao, restantes, esperaMs) {
  const ex = statusTrackingExec_ || { ciclo: lerStatus_('tracking').ciclo || { inicio: Date.now(), feitas: 0 } };
  ex.ciclo.feitas += feitasExecucao;
  const agora = Date.now();
  const mudancas = {
    estado: estado,
    ciclo: ex.ciclo,
    execucaoFim: agora,
    progresso: { feitas: ex.ciclo.feitas, restantes: restantes },
    proxima: esperaMs ? agora + esperaMs : null,
    mensagem: mensagem
  };
  if (estado === 'ok') {
    mudancas.ultimaConclusao = agora;
    mudancas.ultimaConclusaoMensagem = mensagem;
  }
  gravarStatus_('tracking', mudancas);
  statusTrackingExec_ = null;
}

/* ---------- Leitura para o painel ---------- */

/**
 * Chamada pelo painel (google.script.run). Tudo já pronto para a tela; horários em ms
 * e também em texto "dd/MM/yyyy HH:mm" (fuso do script).
 */
function statusExecucoes() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const fuso = Session.getScriptTimeZone();
  const agora = Date.now();
  const texto = function (ms) { return ms ? Utilities.formatDate(new Date(ms), fuso, 'dd/MM/yyyy HH:mm') : ''; };

  const processos = {};
  PROCESSOS_PAINEL.forEach(function (p) {
    let s = {};
    try { s = JSON.parse(props[STATUS_PREFIXO + p] || '{}') || {}; } catch (e) { /* registro corrompido: sem dados */ }
    ['inicio', 'fim', 'execucaoInicio', 'execucaoFim', 'ultimaConclusao', 'proxima', 'atualizadoEm'].forEach(function (k) {
      if (s[k]) s[k + 'Texto'] = texto(s[k]);
    });
    if (s.ciclo && s.ciclo.inicio) s.ciclo.inicioTexto = texto(s.ciclo.inicio);
    processos[p] = s;
  });

  // relatórios do Drive na ordem de CRUZAMENTOS (com os que nunca rodaram)
  const reg = processos.cruzamentos.relatorios || {};
  processos.cruzamentos.lista = CRUZAMENTOS.map(function (c) {
    const r = reg[c.id] || {};
    return { id: c.id, arquivo: c.arquivo, rotulo: c.rotulo || c.arquivo, estado: r.estado || '', mensagem: r.mensagem || '', progresso: r.progresso,
      fimTexto: texto(r.fim), fim: r.fim || null };
  });
  processos.importacao.arquivo = IMPORTACAO_PROTOCOLOS.arquivo;
  processos.json.arquivo = PAYLOAD_TRACKING.ARQUIVO;

  // gatilhos do projeto (os de uso único mostram o que está na fila)
  const contagem = {};
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const f = t.getHandlerFunction();
    const tipo = String(t.getEventType());
    const chave = f + '|' + tipo;
    contagem[chave] = contagem[chave] || { funcao: f, tipo: tipo, rotulo: ROTULOS_GATILHOS[f] || f, qtd: 0 };
    contagem[chave].qtd++;
  });
  const acionadores = Object.keys(contagem).map(function (k) { return contagem[k]; });
  const nomes = acionadores.map(function (a) { return a.funcao; });

  // execução que parou de dar sinal (encerrada à força, sem gatilho de retomada): vira alerta
  const vivos = {};
  PROCESSOS_PAINEL.forEach(function (p) { vivos[p] = processoVivo_(p, processos[p], nomes, processos); });
  PROCESSOS_PAINEL.forEach(function (p) {
    const s = processos[p];
    if (ESTADOS_ATIVOS.indexOf(s.estado) < 0 || vivos[p]) return;
    s.semSinal = true;
    s.estadoOriginal = s.estado;
    s.estado = 'alerta';
    s.mensagem = 'Sem sinal desde ' + texto(s.atualizadoEm) + ' e nenhuma continuação agendada. ' + (s.mensagem || '');
  });

  return {
    agora: agora,
    agoraTexto: Utilities.formatDate(new Date(agora), fuso, 'dd/MM/yyyy HH:mm:ss'),
    processos: processos,
    acionadores: acionadores,
    emAndamento: PROCESSOS_PAINEL.some(function (p) { return vivos[p]; })
  };
}

// Nome amigável dos gatilhos na lista "Acionadores" do painel
const ROTULOS_GATILHOS = {
  atualizarAutorizacoes: 'Atualização de tracking (+ JSON)',
  executarCadeiaCompleta: 'Cadeia completa (protocolos → relatórios → tracking → JSON)',
  continuarAtualizacao: 'Continuação do tracking (uso único)',
  continuarCruzamentos: 'Continuação dos relatórios (uso único)',
  continuarCadeia: 'Próxima etapa da cadeia (uso único)',
  painelIniciarCadeia: 'Cadeia pedida pelo painel (uso único)',
  painelIniciarTracking: 'Tracking pedido pelo painel (uso único)',
  painelIniciarCruzamentos: 'Relatórios pedidos pelo painel (uso único)',
  gerarPayloadTracking: 'Geração do Payload_Tracking'
};

/**
 * Cadeia de atualização: importa os protocolos (e a aba Retorno_Extensão) e, em seguida, dispara sozinha
 *   1) relatórios do Drive (cruzamentos) -> 2) tracking -> 3) Payload_Tracking (gerado no fim do tracking).
 * Cada etapa roda nas suas próprias execuções (com as continuações automáticas de sempre); quando
 * uma termina, chama avancarCadeia_() e a próxima começa ~1 min depois (gatilho continuarCadeia).
 *
 * Entradas:
 * - menu Correios › "Importar protocolos e atualizar tudo" (menuImportarProtocolos, Importacao.gs);
 * - gatilho de tempo criado no Apps Script para executarCadeiaCompleta (ex.: todo dia às 7h);
 * - botões do painel (acaoPainel).
 * Estado da cadeia em PAINEL_STATUS_cadeia: { estado, etapa: importacao|cruzamentos|tracking|concluida,
 *   inicio, fim, origem, alertas: [texto] }.
 * Importação com erro para a cadeia (a base não mudou); erro nos relatórios não impede o tracking
 * (a cadeia termina como "alerta").
 */

const FUNCAO_CONTINUAR_CADEIA = 'continuarCadeia';
const PROXIMA_ETAPA_CADEIA = { importacao: 'cruzamentos', cruzamentos: 'tracking', tracking: null };

// Gatilho de tempo (o objeto do evento identifica a origem) ou chamada direta com origem em texto
function executarCadeiaCompleta(e) {
  const origem = typeof e === 'string' ? e : 'gatilho';
  const atual = lerStatus_('cadeia');
  const todos = {};
  PROCESSOS_PAINEL.forEach(function (p) { todos[p] = lerStatus_(p); });
  // o próprio gatilho do painel que disparou esta execução já foi apagado; só barra se a cadeia estiver mesmo viva
  if (atual.estado === 'executando' && processoVivo_('cadeia', atual, nomesGatilhos_(), todos)) {
    return 'Já existe uma cadeia em andamento (etapa: ' + atual.etapa + ').';
  }

  removerGatilhos_(FUNCAO_CONTINUAR_CADEIA);
  gravarStatus_('cadeia', {
    estado: 'executando', etapa: 'importacao', inicio: Date.now(), fim: null, origem: origem, alertas: [],
    mensagem: 'Importando protocolos.'
  });

  const imp = executarImportacao_(origem === 'gatilho' ? 'cadeia (gatilho)' : 'cadeia');
  if (!imp.ok) {
    gravarStatus_('cadeia', { estado: 'erro', fim: Date.now(), mensagem: 'Parou na importação: ' + imp.msg });
    return 'Importação: ' + comPonto_(imp.msg) + ' A cadeia parou (relatórios e tracking não foram iniciados).';
  }
  // aba Retorno_Extensão (JSON da extensão Shopee): rápida; erro vira alerta e a cadeia segue
  const ret = importarRetornoExtensao_();
  avancarCadeia_('importacao', ret.ok ? null : ret.msg);
  return 'Importação: ' + imp.msg + ' ' + ret.msg + ' Em seguida, sozinho: relatórios do Drive → tracking → Payload_Tracking (acompanhe no painel, vista Cruzamentos).';
}

/**
 * Uma etapa terminou: agenda a próxima (ou encerra a cadeia). Ignora se não há cadeia nessa etapa
 * (ex.: tracking terminado por um gatilho avulso enquanto a cadeia ainda está nos relatórios).
 * alerta = texto do problema parcial da etapa (a cadeia segue, mas termina como "alerta").
 */
function avancarCadeia_(etapa, alerta) {
  const c = lerStatus_('cadeia');
  if (c.estado !== 'executando' || c.etapa !== etapa) return;
  const alertas = (c.alertas || []).concat(alerta ? [alerta] : []);
  const proxima = PROXIMA_ETAPA_CADEIA[etapa];
  if (!proxima) {
    gravarStatus_('cadeia', {
      estado: alertas.length ? 'alerta' : 'ok', etapa: 'concluida', fim: Date.now(), alertas: alertas,
      mensagem: alertas.length ? 'Concluída com alerta: ' + alertas.join(' | ') : 'Cadeia concluída: protocolos, relatórios, tracking e Payload_Tracking atualizados.'
    });
    removerGatilhos_(FUNCAO_CONTINUAR_CADEIA);
    return;
  }
  gravarStatus_('cadeia', {
    etapa: proxima, alertas: alertas,
    mensagem: 'Próxima etapa: ' + (proxima === 'cruzamentos' ? 'relatórios do Drive' : 'tracking') + ' (começa em ~1 min).'
  });
  agendarGatilho_(FUNCAO_CONTINUAR_CADEIA, CONFIG.PLANILHA.ESPERA_CONTINUACAO_MS);
}

// Gatilho de uso único: começa a etapa atual da cadeia
function continuarCadeia(e) {
  removerGatilhos_(FUNCAO_CONTINUAR_CADEIA, e && e.triggerUid);
  const c = lerStatus_('cadeia');
  if (c.estado !== 'executando') return;

  let msg;
  if (c.etapa === 'cruzamentos') {
    msg = iniciarCruzamentos_('cadeia');
  } else if (c.etapa === 'tracking') {
    msg = executarComLock_(false, false, 'cadeia');
  } else {
    return;
  }
  // lock ocupado (outra execução em andamento): tenta de novo depois
  if (msg === MSG_OCUPADO) {
    gravarStatus_('cadeia', { mensagem: 'Aguardando outra execução terminar para começar: ' + c.etapa + '.' });
    agendarGatilho_(FUNCAO_CONTINUAR_CADEIA, CONFIG.PLANILHA.ESPERA_CONTINUACAO_MS);
  }
  console.log('Cadeia (' + c.etapa + '): ' + msg);
}

// Cancelamento pelo menu ("Cancelar continuação automática")
function cancelarCadeia_() {
  removerGatilhos_(FUNCAO_CONTINUAR_CADEIA);
  ['painelIniciarCadeia', 'painelIniciarTracking', 'painelIniciarCruzamentos'].forEach(function (f) { removerGatilhos_(f); });
  const agora = Date.now();
  PROCESSOS_PAINEL.forEach(function (p) {
    const s = lerStatus_(p);
    const mudancas = {};
    if (ESTADOS_ATIVOS.indexOf(s.estado) >= 0) {
      mudancas.estado = 'parado';
      mudancas.fim = agora;
      mudancas.proxima = null;
      mudancas.mensagem = 'Cancelado pelo menu "Cancelar continuação automática".';
    }
    // relatórios da rodada que ainda não tinham terminado
    if (s.relatorios) {
      Object.keys(s.relatorios).forEach(function (id) {
        const r = s.relatorios[id];
        if (ESTADOS_ATIVOS.indexOf(r.estado) >= 0) { r.estado = 'parado'; r.progresso = null; r.mensagem = 'Cancelado antes de terminar.'; mudancas.relatorios = s.relatorios; }
      });
    }
    if (Object.keys(mudancas).length) gravarStatus_(p, mudancas);
  });
}

/* ---------- Ações do painel ---------- */

/**
 * Botões do painel (google.script.run). As execuções longas não rodam aqui: ficam num gatilho de
 * uso único que começa em ~1 min, para a tela não ficar presa esperando. O JSON é gerado na hora.
 * acao: 'cadeia' | 'tracking' | 'cruzamentos' | 'json'. Devolve o texto para o aviso da tela.
 */
function acaoPainel(acao) {
  if (acao === 'json') return gerarPayloadTracking('painel');

  const mapa = {
    cadeia: { processo: 'cadeia', funcao: 'painelIniciarCadeia', nome: 'Cadeia completa' },
    tracking: { processo: 'tracking', funcao: 'painelIniciarTracking', nome: 'Atualização de tracking' },
    cruzamentos: { processo: 'cruzamentos', funcao: 'painelIniciarCruzamentos', nome: 'Relatórios do Drive' }
  };
  const a = mapa[acao];
  if (!a) throw new Error('Ação desconhecida: ' + acao);

  const s = lerStatus_(a.processo);
  const todos = {};
  PROCESSOS_PAINEL.forEach(function (p) { todos[p] = lerStatus_(p); });
  if (processoVivo_(a.processo, s, nomesGatilhos_(), todos)) {
    return a.nome + ' já está ' + (s.estado === 'agendado' ? 'na fila' : 'em andamento') + '.';
  }
  agendarGatilho_(a.funcao, 1000);
  gravarStatus_(a.processo, { estado: 'agendado', mensagem: 'Pedido pelo painel; começa em até ~1 min.', proxima: Date.now() + 60000 });
  return a.nome + ' agendado(a): começa em até ~1 min.';
}

function painelIniciarCadeia(e) {
  removerGatilhos_('painelIniciarCadeia', e && e.triggerUid);
  console.log(executarCadeiaCompleta('painel'));
}

function painelIniciarTracking(e) {
  removerGatilhos_('painelIniciarTracking', e && e.triggerUid);
  const msg = executarComLock_(false, false, 'painel');
  if (msg === MSG_OCUPADO) gravarStatus_('tracking', { estado: 'alerta', mensagem: 'Não iniciado: ' + msg });
  console.log(msg);
}

function painelIniciarCruzamentos(e) {
  removerGatilhos_('painelIniciarCruzamentos', e && e.triggerUid);
  console.log(iniciarCruzamentos_('painel'));
}

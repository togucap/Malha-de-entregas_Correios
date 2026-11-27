/**
 * Ações das pessoas no painel, guardadas fora da Base_Dados (a importação e os cruzamentos regravam a base;
 * a ação fica pelo Protocolo, nunca pela posição da linha):
 *
 *   Estado_Manual (aba oculta)  uma linha por protocolo com situação manual vigente: Protocolo, Situação, Por, Em.
 *   Eventos (aba oculta)        histórico de toda ação (só acrescenta): Quando, Protocolo, Pedido, Ação, Por, Origem.
 *
 * Ação atual: "Finalizado manualmente" (forçar finalizado / desfazer), pela janela do cartão na vista Shopee.
 * Efeitos do protocolo finalizado manualmente:
 *   - sai do tracking (atualizar_ pula; também no "Reprocessar todas");
 *   - conta como finalizado nas telas (Shopee: coluna Finalizados; Acompanhamento - OUT: visão "Finalizado"),
 *     com a marca "Finalizado manualmente"; o corte de 25 dias do painel conta da data da ação.
 * Trava: só a curta do registro (comTravaRegistro_), então funciona com a atualização de status rodando;
 * o tracking lê o Estado_Manual no início de cada execução (forçado no meio vale da execução seguinte).
 * Quem fez: e-mail da conta Google de quem usa o painel (Session.getActiveUser). Ele só vem quando o painel
 * roda com a conta de quem acessa (menu Correios › Abrir painel, ou App da Web implantado como "Usuário que
 * acessa o app da Web"); senão fica "(não identificado)".
 * A mudança chega aos outros painéis pelo Registro_Alteracoes (conjunto "manual"), em até 30 s.
 */

const ESTADO_MANUAL = {
  ABA_ESTADO: 'Estado_Manual',
  CABECALHO_ESTADO: ['Protocolo', 'Situação', 'Por', 'Em'],
  ABA_EVENTOS: 'Eventos',
  CABECALHO_EVENTOS: ['Quando', 'Protocolo', 'Pedido', 'Ação', 'Por', 'Origem'],
  FINALIZADO: 'Finalizado manualmente',
  SEM_USUARIO: '(não identificado)',
  ACOES: { finalizar: 'Forçar finalizado', desfazer: 'Desfazer finalização' }
};

/**
 * Chamada pelo painel (google.script.run): acao = 'finalizar' | 'desfazer'. Devolve JSON em texto
 * { ok, msg, manual: { situacao, por, em } | null } (manual = situação depois da ação).
 */
function painelAcaoManual(protocolo, acao) {
  const chave = String(protocolo == null ? '' : protocolo).trim().toUpperCase();
  if (!chave) throw new Error('Protocolo não informado.');
  if (!ESTADO_MANUAL.ACOES[acao]) throw new Error('Ação desconhecida: ' + acao);
  const usuario = usuarioAtual_();

  // trava curta do registro (não a do script): funciona durante o tracking, os cruzamentos e a importação
  return comTravaRegistro_(15000, function () {
    const aba = obterAba_();
    const fuso = aba.getParent().getSpreadsheetTimeZone();
    const linha = localizarProtocoloBase_(aba, chave, fuso);
    if (!linha) throw new Error('Protocolo ' + chave + ' não encontrado na ' + aba.getName() + '.');

    const estado = lerEstadoManual_();
    const atual = estado.mapa[chave];
    const quando = Utilities.formatDate(new Date(), fuso, 'dd/MM/yyyy HH:mm');

    if (acao === 'finalizar') {
      if (atual) return JSON.stringify({ ok: true, msg: 'Já estava finalizado manualmente (' + atual.por + ', ' + atual.em + ').', manual: publicoManual_(atual) });
      const abaEstado = estado.aba;
      const nova = abaEstado.getLastRow() + 1;
      garantirLinhas_(abaEstado, nova);
      abaEstado.getRange(nova, 1, 1, 4).setValues([[chave, ESTADO_MANUAL.FINALIZADO, usuario, quando]]); // aba em texto puro
      const manual = { situacao: ESTADO_MANUAL.FINALIZADO, por: usuario, em: quando };
      registrarEvento_(chave, linha.pedido, ESTADO_MANUAL.ACOES.finalizar, usuario, 'painel');
      registrarAlteracoes_([['manual', 'gravar', chave, manual]], 'painel');
      return JSON.stringify({ ok: true, msg: 'Protocolo ' + chave + ' finalizado manualmente.', manual: manual });
    }

    if (!atual) return JSON.stringify({ ok: true, msg: 'O protocolo ' + chave + ' não estava finalizado manualmente.', manual: null });
    estado.aba.deleteRow(atual.linha);
    registrarEvento_(chave, linha.pedido, ESTADO_MANUAL.ACOES.desfazer, usuario, 'painel');
    registrarAlteracoes_([['manual', 'remover', chave, null]], 'painel');
    return JSON.stringify({ ok: true, msg: 'Finalização manual desfeita: o protocolo ' + chave + ' volta para o tracking.', manual: null });
  });
}

/**
 * Situação manual vigente: { aba, mapa: { PROTOCOLO: { situacao, por, em (texto), emMs, linha } } }.
 * Usado pelo tracking (pular), pelo Painel_JSON e pela ação do painel.
 */
function lerEstadoManual_() {
  const aba = obterAbaPainel_(ESTADO_MANUAL.ABA_ESTADO, ESTADO_MANUAL.CABECALHO_ESTADO);
  const mapa = {};
  const total = aba.getLastRow() - 1;
  if (total > 0) {
    const fuso = aba.getParent().getSpreadsheetTimeZone();
    aba.getRange(2, 1, total, 4).getValues().forEach(function (r, i) {
      const chave = String(r[0] == null ? '' : r[0]).trim().toUpperCase();
      if (!chave) return;
      const em = Object.prototype.toString.call(r[3]) === '[object Date]' ? r[3] : dataDoPainel_(r[3]);
      mapa[chave] = {
        situacao: String(r[1] || ESTADO_MANUAL.FINALIZADO), por: String(r[2] || ESTADO_MANUAL.SEM_USUARIO),
        em: em ? Utilities.formatDate(em, fuso, 'dd/MM/yyyy HH:mm') : String(r[3] || ''), emMs: em ? em.getTime() : 0, linha: i + 2
      };
    });
  }
  return { aba: aba, mapa: mapa };
}

// Protocolos finalizados manualmente (para o tracking pular): { PROTOCOLO: true }
function protocolosFinalizadosManualmente_() {
  const mapa = lerEstadoManual_().mapa;
  const fora = {};
  Object.keys(mapa).forEach(function (k) { fora[k] = true; });
  return fora;
}

function publicoManual_(m) {
  return m ? { situacao: m.situacao, por: m.por, em: m.em } : null;
}

function registrarEvento_(protocolo, pedido, acao, usuario, origem) {
  const aba = obterAbaPainel_(ESTADO_MANUAL.ABA_EVENTOS, ESTADO_MANUAL.CABECALHO_EVENTOS);
  const linha = aba.getLastRow() + 1;
  garantirLinhas_(aba, linha);
  const quando = Utilities.formatDate(new Date(), aba.getParent().getSpreadsheetTimeZone(), 'dd/MM/yyyy HH:mm:ss');
  aba.getRange(linha, 1, 1, 6).setValues([[quando, protocolo, pedido || '', acao, usuario, origem || '']]);
}

// Linha da base com o protocolo: { linha, pedido } ou null
function localizarProtocoloBase_(aba, chave, fuso) {
  const colProt = indiceColuna_(aba, CONFIG.PLANILHA.COL_PROTOCOLO);
  if (!colProt) throw new Error('Coluna "' + CONFIG.PLANILHA.COL_PROTOCOLO + '" não encontrada na ' + aba.getName() + '.');
  const total = aba.getLastRow() - 1;
  if (total <= 0) return null;
  const protocolos = aba.getRange(2, colProt, total, 1).getValues();
  for (let i = 0; i < total; i++) {
    if (chavePainel_(protocolos[i][0], fuso) !== chave) continue;
    const colPedido = indiceColuna_(aba, 'Pedido');
    return { linha: i + 2, pedido: colPedido ? valorParaTela_(aba.getRange(i + 2, colPedido).getValue(), fuso, false) : '' };
  }
  return null;
}

function usuarioAtual_() {
  try {
    return Session.getActiveUser().getEmail() || ESTADO_MANUAL.SEM_USUARIO;
  } catch (e) {
    return ESTADO_MANUAL.SEM_USUARIO;
  }
}

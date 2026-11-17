/**
 * Histórico completo de movimentação de um objeto (consulta pontual, janela "Histórico" do painel).
 * A atualização da planilha (Planilha.gs) só busca o último evento; aqui vêm todos os eventos.
 *
 * historicoTracking({ codigo, protocolo, autorizacao }) escolhe a fonte pelo tipo do código:
 * - Código de rastreio (13, ex.: o "Código convertido") -> API Rastro (resultado=T); se o Rastro não
 *   tiver o objeto (ex.: SRO-012, mais de 180 dias) e vier `autorizacao` (10 dígitos, da mesma linha),
 *   mostra o histórico da autorização (Logística Reversa).
 * - Autorização (10 dígitos) -> Logística Reversa (SOAP); se já tiver código de rastreio, o histórico
 *   vem do Rastro; sem código (ainda não postado) ou com o Rastro indisponível, fica o da reversa.
 * - Jadlog (14 dígitos) -> Intelipost pelo proxy, com Protocolo + "RE" (ex.: 4293792261107RE);
 *   também aceita o código já com "RE".
 *
 * Devolve (só texto, nada de Date, para o google.script.run):
 *   { codigo, fonte, status, atualizadoEm, previsao ("dd/MM/yyyy" ou ''), eventos: [{ titulo, detalhe, de, para, local, dataHora }],
 *     avisos: [texto], erro: texto | null }
 * eventos do mais recente para o mais antigo; dataHora "dd/MM/yyyy, HH:mm:ss".
 * Dados de cliente (endereço, nome) da Intelipost não são lidos.
 */

const FONTE_HISTORICO = {
  RASTRO: 'Correios · Rastro',
  REVERSA: 'Correios · Logística Reversa',
  INTELIPOST: 'Jadlog · Intelipost'
};

function historicoTracking(req) {
  const protocolo = normalizarCodigo_(req && req.protocolo);
  // a célula pode trazer mais de um código ("AA…BR, BB…BR"): consulta o primeiro, avisa os outros
  const partes = String(req && req.codigo || '').toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const codigo = partes[0] || '';
  const avisos = partes.length > 1 ? ['A célula tem ' + partes.length + ' códigos; mostrando o primeiro (' + codigo + '). Outros: ' + partes.slice(1).join(', ') + '.'] : [];

  let r;
  try {
    if (!codigo) {
      r = historicoErro_('', 'Informe o código de rastreio, a autorização ou o protocolo Jadlog + RE.');
    } else if (/^\d+RE$/.test(codigo)) {
      r = historicoIntelipost_(codigo);
    } else {
      switch (classificarCodigo_(codigo)) {
        case TIPO_CODIGO.RASTREIO: {
          r = historicoRastro_(codigo);
          const autorizacao = normalizarCodigo_(req && req.autorizacao);
          if (r.erro && classificarCodigo_(autorizacao) === TIPO_CODIGO.AUTORIZACAO) r = historicoAutorizacao_(autorizacao, r.erro);
          break;
        }
        case TIPO_CODIGO.AUTORIZACAO: r = historicoAutorizacao_(codigo); break;
        case TIPO_CODIGO.JADLOG:
          r = protocolo
            ? historicoIntelipost_(codigoIntelipost_(protocolo))
            : historicoErro_(codigo, 'Código Jadlog: a consulta é feita pelo Protocolo + "RE" (ex.: 4293792261107RE). Digite assim no campo.');
          break;
        default:
          r = historicoErro_(codigo, 'Código não reconhecido. Use código de rastreio (AA123456789BR), autorização (10 dígitos) ou protocolo Jadlog + RE.');
      }
    }
  } catch (e) {
    r = historicoErro_(codigo, e && e.message ? e.message : String(e));
  }
  r.avisos = avisos.concat(r.avisos || []);
  return r;
}

/* ---------- Rastro (Correios) ---------- */

function historicoRastro_(codigo) {
  const rastro = interpretarRastro_(consultarRastroLote_([codigo], 'T')[0]);
  if (rastro.erro && !rastro.eventos.length) {
    const r = historicoErro_(codigo, 'Rastro: ' + rastro.erro);
    r.fonte = FONTE_HISTORICO.RASTRO;
    return r;
  }
  return {
    codigo: rastro.codigo || codigo,
    fonte: FONTE_HISTORICO.RASTRO,
    status: resumirStatus_(rastro.ultimo.descricao),
    atualizadoEm: dataHoraRastro_(rastro.ultimo.dataHora),
    previsao: dataHoraRastro_(rastro.dtPrevista).split(',')[0],
    eventos: rastro.eventos.map(function (e) {
      return {
        titulo: e.descricao,
        detalhe: e.detalhe,
        de: e.destino ? e.unidade : '',
        para: e.destino,
        local: e.destino ? '' : e.unidade,
        dataHora: dataHoraRastro_(e.dataHora)
      };
    }),
    avisos: [],
    erro: null
  };
}

// "2026-11-17T09:47:09" -> "17/11/2026, 09:47:09" (texto da API, sem conversão de fuso)
function dataHoraRastro_(t) {
  const m = String(t || '').match(/^(\d{4})-(\d{2})-(\d{2})T?(\d{2}:\d{2}(?::\d{2})?)?/);
  if (!m) return String(t || '');
  return m[3] + '/' + m[2] + '/' + m[1] + (m[4] ? ', ' + (m[4].length === 5 ? m[4] + ':00' : m[4]) : '');
}

/* ---------- Autorização (Logística Reversa -> Rastro) ---------- */

// erroRastro: o Rastro já foi tentado (pelo código convertido) e falhou; não repete a consulta
function historicoAutorizacao_(numero, erroRastro) {
  const resp = consultarReversaLote_([numero], 'A')[0];
  const rev = interpretarReversa_(resp.body);
  const aut = rev.autorizacoes[0];
  if (!aut) {
    const r = historicoErro_(numero, 'Logística Reversa: ' + (rev.erro || (resp.status !== 200 ? 'HTTP ' + resp.status : 'autorização não encontrada')));
    r.fonte = FONTE_HISTORICO.REVERSA;
    return r;
  }

  const codigoRastreio = (aut.objetos.filter(function (o) { return o.codigo; })[0] || {}).codigo;
  let aviso;
  if (erroRastro) {
    aviso = comPonto_(erroRastro) + ' Mostrando o histórico da autorização ' + numero + ' (Logística Reversa).';
  } else if (codigoRastreio) {
    const r = historicoRastro_(codigoRastreio);
    if (!r.erro) {
      r.avisos.push('Autorização ' + numero + ' → código de rastreio ' + codigoRastreio + '.');
      return r;
    }
    aviso = comPonto_(r.erro) + ' Mostrando o histórico da autorização (Logística Reversa).';
  } else {
    aviso = 'Objeto ainda sem código de rastreio: histórico da autorização (Logística Reversa).';
  }

  const r = historicoReversa_(aut);
  r.avisos.push(aviso);
  return r;
}

function historicoReversa_(aut) {
  // eventos do histórico + situação de cada objeto (ex.: "Entregue"), sem repetir o mesmo evento
  const vistos = {};
  const todos = [];
  aut.eventos.map(function (e) { return { titulo: e.descricao, detalhe: e.observacao, data: e.data, hora: e.hora }; })
    .concat(aut.objetos.filter(function (o) { return o.descricao; }).map(function (o) {
      return { titulo: o.descricao, detalhe: o.codigo ? 'Objeto ' + o.codigo : '', data: o.data, hora: o.hora };
    }))
    .forEach(function (e) {
      const chave = normalizarTexto_(e.titulo) + '|' + e.data + '|' + e.hora;
      if (vistos[chave]) return;
      vistos[chave] = true;
      todos.push(e);
    });
  todos.sort(function (a, b) {
    const ka = chaveData_(a.data, a.hora), kb = chaveData_(b.data, b.hora);
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });

  const atual = statusAtual_(aut);
  return {
    codigo: aut.numero,
    fonte: FONTE_HISTORICO.REVERSA,
    status: atual ? resumirStatus_(atual.descricao) : '',
    atualizadoEm: todos.length ? dataHoraReversa_(todos[0].data, todos[0].hora) : '',
    eventos: todos.map(function (e) {
      return { titulo: e.titulo, detalhe: e.detalhe, de: '', para: '', local: '', dataHora: dataHoraReversa_(e.data, e.hora) };
    }),
    avisos: [],
    erro: null
  };
}

// "17-11-2026", "09:47" -> "17/11/2026, 09:47:00"
function dataHoraReversa_(data, hora) {
  const d = String(data || '').replace(/-/g, '/');
  const h = String(hora || '').trim();
  return d + (h ? ', ' + (/^\d{2}:\d{2}$/.test(h) ? h + ':00' : h) : '');
}

/* ---------- Jadlog (Intelipost) ---------- */

function historicoIntelipost_(codigo) {
  if (!intelipostConfigurado_()) {
    const r = historicoErro_(codigo, 'Intelipost não configurada: cadastre ' + PROP_INTELIPOST_URL + ' nas Propriedades do script.');
    r.fonte = FONTE_HISTORICO.INTELIPOST;
    return r;
  }
  const ip = interpretarIntelipost_(consultarIntelipostLote_([codigo]));
  const pedido = ip.pedidos[codigo];
  if (ip.erro || !pedido || !pedido.eventos.length) {
    const r = historicoErro_(codigo, 'Intelipost: ' + (ip.erro || (pedido ? 'pedido sem eventos' : 'pedido não encontrado')));
    r.fonte = FONTE_HISTORICO.INTELIPOST;
    return r;
  }

  const fuso = Session.getScriptTimeZone();
  const quando = function (d) { return d ? Utilities.formatDate(d, fuso, 'dd/MM/yyyy, HH:mm:ss') : ''; };
  return {
    codigo: codigo,
    fonte: FONTE_HISTORICO.INTELIPOST,
    status: statusIntelipost_(pedido),
    atualizadoEm: quando(pedido.ultimo.data),
    previsao: pedido.previsao ? Utilities.formatDate(pedido.previsao, fuso, 'dd/MM/yyyy') : '',
    // o parser entrega do mais antigo para o mais recente
    eventos: pedido.eventos.slice().reverse().map(function (e) {
      const titulo = frase_(e.nome || e.estadoTraduzido);
      return {
        titulo: titulo,
        detalhe: e.descricao && normalizarTexto_(e.descricao) !== normalizarTexto_(titulo) ? e.descricao : '',
        de: '',
        para: '',
        local: [e.cidade && e.cidade.toUpperCase(), e.uf].filter(Boolean).join(' / '),
        dataHora: quando(e.data)
      };
    }),
    avisos: [],
    erro: null
  };
}

// "EM TRANSFERENCIA" -> "Em transferencia" (texto que não está todo em maiúsculas fica igual)
function frase_(t) {
  const s = String(t || '').trim();
  return s && s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

function comPonto_(t) {
  const s = String(t || '').trim();
  return /[.!?]$/.test(s) ? s : s + '.';
}

function historicoErro_(codigo, mensagem) {
  return { codigo: codigo, fonte: '', status: '', atualizadoEm: '', eventos: [], avisos: [], erro: mensagem };
}

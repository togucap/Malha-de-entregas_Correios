/**
 * Interpretação da resposta XML do Web Service de Logística Reversa
 * (acompanharPedido / acompanharPedidoPorData).
 *
 * Cada <coleta> traz UM evento em <historico> e repete o mesmo <objeto>;
 * os blocos são agrupados por numero_pedido (uma entrada por autorização).
 *
 * Devolve {
 *   erro: string | null,
 *   autorizacoes: [{
 *     numero, controleCliente,
 *     eventos: [{ status, descricao, data, hora, observacao }],   // em ordem cronológica
 *     objetos: [{ codigo, controleCliente, status, descricao, data, hora, pesoGramas, valor }]
 *   }]
 * }
 */
function interpretarReversa_(xmlTexto) {
  let raiz;
  try {
    raiz = XmlService.parse(String(xmlTexto || '')).getRootElement();
  } catch (e) {
    return { erro: 'resposta não é XML válido', autorizacoes: [] };
  }

  const fault = descendentes_(raiz, 'Fault')[0];
  if (fault) return { erro: textoFilho_(fault, 'faultstring') || 'SOAP Fault', autorizacoes: [] };

  const mapa = {};
  const autorizacoes = [];
  descendentes_(raiz, 'coleta').forEach(function (coleta) {
    const numero = textoFilho_(coleta, 'numero_pedido');
    let aut = mapa[numero];
    if (!aut) {
      aut = mapa[numero] = { numero: numero, controleCliente: textoFilho_(coleta, 'controle_cliente'), eventos: [], objetos: [] };
      autorizacoes.push(aut);
    }

    filhos_(coleta, 'historico').forEach(function (h) {
      aut.eventos.push({
        status: textoFilho_(h, 'status'),
        descricao: textoFilho_(h, 'descricao_status'),
        data: textoFilho_(h, 'data_atualizacao'),
        hora: textoFilho_(h, 'hora_atualizacao'),
        observacao: textoFilho_(h, 'observacao')
      });
    });

    filhos_(coleta, 'objeto').forEach(function (o) {
      const codigo = textoFilho_(o, 'numero_etiqueta');
      if (aut.objetos.some(function (x) { return x.codigo === codigo; })) return;
      aut.objetos.push({
        codigo: codigo,
        controleCliente: textoFilho_(o, 'controle_objeto_cliente'),
        status: textoFilho_(o, 'ultimo_status'),
        descricao: textoFilho_(o, 'descricao_status'),
        data: textoFilho_(o, 'data_ultima_atualizacao'),
        hora: textoFilho_(o, 'hora_ultima_atualizacao'),
        pesoGramas: textoFilho_(o, 'peso_real'),
        valor: textoFilho_(o, 'valor_postagem')
      });
    });
  });

  autorizacoes.forEach(function (a) {
    a.eventos.sort(function (x, y) {
      const kx = chaveData_(x.data, x.hora), ky = chaveData_(y.data, y.hora);
      return kx < ky ? -1 : kx > ky ? 1 : 0;
    });
  });

  const codErro = textoDescendente_(raiz, 'cod_erro');
  const msgErro = textoDescendente_(raiz, 'msg_erro');
  const erro = msgErro || (codErro && codErro !== '0' ? 'código ' + codErro : '');
  return { erro: erro || null, autorizacoes: autorizacoes };
}

/**
 * Status mais recente da autorização: compara o status do objeto (preenchido após a
 * postagem) com o último evento do histórico; em caso de empate, vale o do objeto.
 * Devolve { status, descricao, data, hora } ou null.
 */
function statusAtual_(aut) {
  const candidatos = aut.objetos
    .filter(function (o) { return o.descricao; })
    .concat(aut.eventos.length ? [aut.eventos[aut.eventos.length - 1]] : []);
  return candidatos.reduce(function (atual, c) {
    return !atual || chaveData_(c.data, c.hora) > chaveData_(atual.data, atual.hora) ? c : atual;
  }, null);
}

// Códigos de rastreio (numero_etiqueta) da autorização; vazio antes da postagem
function codigosRastreio_(aut) {
  return aut.objetos.map(function (o) { return o.codigo; }).filter(Boolean).join(', ');
}

/* ---------- Auxiliares de XML (comparam pelo nome local, ignorando namespace) ---------- */

function filhos_(el, nome) {
  return el.getChildren().filter(function (c) { return c.getName() === nome; });
}

function textoFilho_(el, nome) {
  const f = filhos_(el, nome)[0];
  return f ? f.getText().trim() : '';
}

function descendentes_(el, nome) {
  let achados = [];
  el.getChildren().forEach(function (c) {
    if (c.getName() === nome) achados.push(c);
    achados = achados.concat(descendentes_(c, nome));
  });
  return achados;
}

function textoDescendente_(el, nome) {
  const d = descendentes_(el, nome)[0];
  return d ? d.getText().trim() : '';
}

// 'DD-MM-AAAA' + 'HH:MM:SS' -> 'AAAAMMDDHHMMSS' (ordenável como texto)
function chaveData_(data, hora) {
  const m = String(data || '').match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
  if (!m) return '';
  return m[3] + m[2] + m[1] + String(hora || '').replace(/\D/g, '');
}

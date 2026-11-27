/**
 * Regras da vista "Shopee" do painel (quadro kanban). Os dados vêm do Painel_JSON (gs/PainelDados) e a tela
 * aplica estas regras no navegador (js/DadosPainel, telaShopee); elas vão dentro do JSON em `config`.
 *   - "Pendente de atendimento": aba Retorno_Extensão com origem e situacao de REGRA_PENDENTE_SHOPEE.
 *   - Aba base com Parceiro_Nome = PARCEIRO_SHOPEE, pelo Status tracking (STATUS_FINAIS, a mesma regra da
 *     atualização de status) e pela Entrada_Lista:
 *       "Em transporte" = status não finalizador;
 *       "Entregue"      = status finalizador e Entrada_Lista diferente de "Sim" (ainda não entrou no estoque);
 *       "Finalizados"   = status finalizador e Entrada_Lista "Sim" (no quadro só os de até 25 dias; o total
 *                         dos mais antigos vem em totais).
 * O cartão pendente mostra o tracking da linha da base com Pedido_Parceiro = Pedido_Shopee ou, sem ela, Pedido = Pedido.
 * Comparações de texto sem acento/maiúsculas. Mudou uma regra aqui: regerar o JSON (menu "Regerar dados do painel").
 */

const KANBAN_SHOPEE = [
  { id: 'pendente', titulo: 'Pendente de atendimento', definida: true },
  { id: 'transporte', titulo: 'Em transporte', definida: true },
  { id: 'entregue', titulo: 'Entregue', definida: true },
  { id: 'finalizados', titulo: 'Finalizados', definida: true }
];

const REGRA_PENDENTE_SHOPEE = { origem: 'shopee-retornos', situacao: 'Não encontrado' };
const PARCEIRO_SHOPEE = 'SHOPEE';

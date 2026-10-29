// Historial de monedas del jugador: saldo diario, resultado por juego y últimos movimientos.
import { h, fmt, act } from '../core.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids.filter((k) => k != null));
  return el;
};

export const REASONS = {
  gacha: '✨ Gacha', dust: '✦ Cambio de polvo', daily: '🎁 Recompensa diaria', explore: '🧭 Exploración', heal: '💗 Enfermera Joy', buddy: '🎒 Hallazgo del compañero', expedition: '🧭 Expedición', daycare: '🥚 Criadero', gift_in: '🎁 Regalo recibido',
  gift_out: '🎁 Regalo enviado', admin: '🛠️ Ajuste del anfitrión', shop: '🛒 Tienda', market_sale: '🏪 Venta en el Mercado',
  market_buy: '🏪 Compra en el Mercado', market_fee: '🏪 Comisión de anuncio', market_refund: '🏪 Pedido devuelto', level: '⭐ Subida de nivel',
  reward: '🏆 Misión o medalla', refund: '↩️ Devolución', poker_in: "🃏 Fichas de Hold'em", poker_out: "🃏 Levantarse de Hold'em", event: '🎉 Evento', npc_fund: '🏦 Fondo NPC',
};
const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const when = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));

// Línea del saldo al cierre de cada día, con cruz y globo al pasar el dedo o el ratón.
export function balanceChart(days) {
  // En el móvil se dibuja con otra proporción para que el texto de los ejes se lea.
  const narrow = window.innerWidth < 600;
  const W = narrow ? 320 : 640, H = narrow ? 190 : 200, L = 8, R = 8, T = 14, B = 26;
  if (days.length < 2) return h('p', { class: 'muted small' }, 'La gráfica aparece cuando lleves al menos dos días jugando.');
  const vals = days.map((d) => d.c);
  let lo = Math.min(...days.map((d) => d.lo ?? d.c)), hi = Math.max(...days.map((d) => d.hi ?? d.c));
  if (hi === lo) { hi += 1; lo = Math.max(0, lo - 1); }
  const x = (i) => L + (i * (W - L - R)) / (days.length - 1);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${path}L${x(days.length - 1)},${H - B}L${x(0)},${H - B}Z`;
  const grid = [hi, (hi + lo) / 2, lo].map((v) => svg('g', {},
    svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'hc-grid' })));
  const step = Math.ceil(days.length / (narrow ? 3 : 6));
  const labels = days.map((d, i) => (i % step === 0 || i === days.length - 1) && !(i !== days.length - 1 && days.length - 1 - i < step / 2)
    ? svg('text', { x: x(i), y: H - 8, class: 'hc-axis', 'text-anchor': i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle' }, day(d.date)) : null);
  const cross = svg('line', { y1: T, y2: H - B, class: 'hc-cross', visibility: 'hidden' });
  const dot = svg('circle', { r: 5, class: 'hc-dot', visibility: 'hidden' });
  const last = svg('circle', { r: 4, cx: x(days.length - 1), cy: y(vals[vals.length - 1]), class: 'hc-dot' });
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'hc-svg', role: 'img', 'aria-label': `Saldo diario: de ${fmt(vals[0])} a ${fmt(vals[vals.length - 1])} monedas` },
    ...grid, svg('path', { d: area, class: 'hc-area' }), svg('path', { d: path, class: 'hc-line' }), ...labels, cross, last, dot);
  const tip = h('div', { class: 'hc-tip hidden' });
  const wrap = h('div', { class: 'hc-wrap' }, h('div', { class: 'hc-scale muted small' }, h('span', {}, fmt(hi)), h('span', {}, fmt(lo))), chart, tip);
  const move = (e) => {
    const r = chart.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(days.length - 1, Math.round(((px - L) / (W - L - R)) * (days.length - 1))));
    const d = days[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(d.c)); dot.setAttribute('visibility', 'visible');
    const net = i ? d.c - days[i - 1].c : null;
    tip.replaceChildren(h('b', {}, day(d.date)), h('div', {}, `Saldo: ${fmt(d.c)}`),
      net === null ? '' : h('div', { class: net >= 0 ? 'good' : 'bad' }, `Día: ${signed(net)}`),
      d.hi != null ? h('div', { class: 'muted' }, `Máx ${fmt(d.hi)} · mín ${fmt(d.lo)}`) : '');
    tip.classList.remove('hidden');
    const left = (x(i) / W) * r.width;
    tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px';
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.classList.add('hidden'); };
  chart.addEventListener('pointermove', move);
  chart.addEventListener('pointerdown', move);
  chart.addEventListener('pointerleave', leave);
  return wrap;
}

// Resultado neto por juego: barras divergentes desde el cero, con la cifra siempre escrita.
function gamesChart(games, names) {
  const rows = Object.entries(games).map(([id, g]) => ({ id, net: g.won - g.bet, ...g })).filter((g) => g.n > 0).sort((a, b) => b.net - a.net);
  if (!rows.length) return h('p', { class: 'muted small' }, 'Aún no has jugado a nada. ¡El casino te espera!');
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.net)));
  return h('div', { class: 'hg-list' }, rows.map((r) => h('div', { class: 'hg-row', title: `${names[r.id] || r.id}: apostado ${fmt(r.bet)}, cobrado ${fmt(r.won)} en ${fmt(r.n)} partidas` },
    h('span', { class: 'hg-name' }, names[r.id] || r.id),
    h('div', { class: 'hg-track' },
      h('i', { class: 'hg-zero' }),
      h('b', { class: 'hg-bar ' + (r.net >= 0 ? 'pos' : 'neg'), style: { width: (Math.abs(r.net) / max) * 50 + '%' } })),
    h('span', { class: 'hg-val ' + (r.net >= 0 ? 'good' : 'bad') }, signed(r.net)),
    h('span', { class: 'hg-n muted small' }, `${fmt(r.n)} p.`))));
}

export async function historyCard() {
  const box = h('div', { class: 'card stack history' }, h('p', { class: 'muted small' }, 'Cargando historial…'));
  const res = await act('me:history', {});
  if (!res) { box.replaceChildren(h('p', { class: 'muted small' }, 'No se pudo cargar el historial.')); return box; }
  const { days, games, log, names } = res.history;
  let tab = 'balance';
  const tabs = h('div', { class: 'seg' });
  const pane = h('div', {});
  const totalNet = Object.values(games).reduce((s, g) => s + g.won - g.bet, 0);
  const paint = () => {
    tabs.replaceChildren(...[['balance', '📈 Saldo'], ['games', '🎰 Por juego'], ['log', '🧾 Movimientos']].map(([id, l]) =>
      h('button', { class: 'btn small' + (tab === id ? ' primary' : ''), onclick: () => { tab = id; paint(); } }, l)));
    if (tab === 'balance') pane.replaceChildren(balanceChart(days));
    else if (tab === 'games') pane.replaceChildren(h('p', { class: 'small muted' }, 'Lo cobrado menos lo apostado en cada juego, desde que existe el historial. Total: ',
      h('b', { class: totalNet >= 0 ? 'good' : 'bad' }, signed(totalNet))), gamesChart(games, names));
    else pane.replaceChildren(log.length ? h('div', { class: 'hl-list' }, [...log].reverse().map((m) => h('div', { class: 'hl-row' },
      h('span', {}, REASONS[m.r] || m.r, m.l ? h('span', { class: 'muted small' }, ' · ' + m.l) : null),
      h('span', { class: 'muted small' }, when(m.t)),
      h('b', { class: m.d >= 0 ? 'good' : 'bad' }, signed(m.d))))) : h('p', { class: 'muted small' }, 'Sin movimientos todavía (las partidas se resumen en «Por juego»).'));
  };
  paint();
  box.replaceChildren(h('h3', {}, '📊 Mis monedas'), tabs, pane);
  return box;
}

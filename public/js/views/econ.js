// Economía del casino para el anfitrión: cuántas monedas hay, de dónde salen y a dónde van.
import { h, fmt, act } from '../core.js';
import { REASONS } from './history.js';

const sum = (o) => Object.values(o || {}).reduce((s, v) => s + v, 0);
const merge = (days, key) => days.reduce((acc, d) => { for (const [k, v] of Object.entries(d[key] || {})) acc[k] = (acc[k] || 0) + v; return acc; }, {});
const pct = (x) => (x * 100).toFixed(1).replace('.', ',') + ' %';
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const day = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const ACTIONS = { coins: '±💰 Monedas', ban: '⛔ Suspendió', unban: '✅ Readmitió', reset: '🔑 Cambió contraseña', admin: '👑 Hizo anfitrión', unadmin: '👑 Quitó anfitrión', invite: '🎟️ Invitación' };
const tile = (label, value, note) => h('div', { class: 'stat' }, h('span', { class: 'muted small' }, label), h('b', {}, value), note ? h('span', { class: 'muted small' }, note) : null);

// Lista con barra proporcional (la cifra siempre escrita: la barra solo ayuda a comparar).
function bars(entries, label, cls) {
  const rows = entries.filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return h('p', { class: 'muted small' }, 'Nada en estos días.');
  const max = Math.max(...rows.map(([, v]) => v));
  return h('div', { class: 'eb-list' }, rows.map(([k, v]) => h('div', { class: 'eb-row' },
    h('span', {}, label(k)), h('div', { class: 'eb-track' }, h('i', { class: cls, style: { width: (v / max) * 100 + '%' } })), h('b', {}, fmt(v)))));
}

export async function economyPanel() {
  const r = await act('admin:economy');
  if (!r) return h('p', { class: 'muted' }, 'No se pudo cargar la economía.');
  const e = r.economy;
  const names = e.names;
  const last7 = e.days.slice(-7);
  const bet = merge(last7, 'bet');
  const paid = merge(last7, 'paid');
  const rounds = merge(last7, 'rounds');
  const houseEdge = sum(bet) - sum(paid);
  const games = Object.keys(bet).map((g) => ({ g, bet: bet[g], paid: paid[g] || 0, n: rounds[g] || 0 })).sort((a, b) => b.bet - a.bet);
  return h('div', { class: 'stack econ' },
    h('div', { class: 'card stack' }, h('h3', {}, '🏦 Monedas en circulación'),
      h('div', { class: 'stat-row' },
        tile('Total', fmt(e.total)), tile('En carteras', fmt(e.wallets)), tile('En el Mercado', fmt(e.market)), tile('En juego ahora', fmt(e.escrow)),
        tile('Saldo mediano', fmt(e.median)), tile('Del 10 % más rico', pct(e.top10share)), tile('Jugadores', `${e.players}`, `${e.active7} activos en 7 días`),
        e.npc ? tile('Tesorería NPC', fmt(e.npc.coins + e.npc.locked), `${fmt(e.npc.coins)} libres · ${fmt(e.npc.locked)} en pedidos · inicial ${fmt(e.npc.start)}`) : null)),
    h('div', { class: 'card stack' }, h('h3', {}, '📅 Últimos días'),
      h('p', { class: 'muted small' }, 'Creadas: recompensas, Enfermera Joy, polvo, ajustes… Destruidas: gacha, tienda, comisiones e impuestos del Mercado y lo que gana la casa en los juegos. Si «Neto» es positivo muchos días seguidos, hay inflación. La tesorería de los comerciantes NPC no cuenta en el total (el fondo inicial aparece una vez como «Fondo NPC»).'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'admin-table' },
        h('thead', {}, h('tr', {}, ['Día', 'Activos', 'Creadas', 'Destruidas', 'Neto', 'Apostado'].map((t) => h('th', {}, t)))),
        h('tbody', {}, [...e.days].reverse().slice(0, 14).map((d) => {
          const made = sum(d.src);
          const gone = sum(d.sink) + Math.max(0, sum(d.bet) - sum(d.paid));
          const won = Math.max(0, sum(d.paid) - sum(d.bet));
          const net = made + won - gone;
          return h('tr', {}, h('td', {}, day(d.date)), h('td', {}, d.active), h('td', {}, fmt(made + won)), h('td', {}, fmt(gone)),
            h('td', { class: net > 0 ? 'bad' : 'good' }, signed(net)), h('td', {}, fmt(sum(d.bet))));
        }))))),
    h('div', { class: 'cards2' },
      h('div', { class: 'card stack' }, h('h3', {}, '⬆️ De dónde salen (7 días)'), bars(Object.entries(merge(last7, 'src')), (k) => REASONS[k] || k, 'src')),
      h('div', { class: 'card stack' }, h('h3', {}, '⬇️ A dónde van (7 días)'), bars([...Object.entries(merge(last7, 'sink')), ['house', Math.max(0, houseEdge)]], (k) => (k === 'house' ? '🎰 Ventaja de la casa' : REASONS[k] || k), 'sink'))),
    h('div', { class: 'card stack' }, h('h3', {}, '🎰 Juegos (7 días)'),
      games.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'admin-table' },
        h('thead', {}, h('tr', {}, ['Juego', 'Partidas', 'Apostado', 'Pagado', 'Devuelto', 'Casa'].map((t) => h('th', {}, t)))),
        h('tbody', {}, games.map((g) => h('tr', {}, h('td', {}, names[g.g] || g.g), h('td', {}, fmt(g.n)), h('td', {}, fmt(g.bet)), h('td', {}, fmt(g.paid)),
          h('td', {}, g.bet ? pct(g.paid / g.bet) : '—'), h('td', { class: g.bet - g.paid >= 0 ? 'good' : 'bad' }, signed(g.bet - g.paid))))))) : h('p', { class: 'muted small' }, 'Sin partidas registradas todavía.'),
      h('p', { class: 'muted small' }, '«Devuelto» es el % de lo apostado que vuelve a los jugadores (incluye bonus de compañero). Con pocas partidas varía mucho.')),
    h('div', { class: 'card stack' }, h('h3', {}, '📝 Acciones de anfitriones'),
      e.log.length ? h('div', { class: 'hl-list' }, e.log.map((l) => h('div', { class: 'hl-row' },
        h('span', {}, h('b', {}, l.by), ' · ', ACTIONS[l.action] || l.action, l.target ? ` · ${l.target}` : '', l.detail ? h('span', { class: 'muted small' }, ' · ' + l.detail) : null),
        h('span', { class: 'muted small' }, new Date(l.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), h('span', {}))))
        : h('p', { class: 'muted small' }, 'Sin acciones registradas.')));
}

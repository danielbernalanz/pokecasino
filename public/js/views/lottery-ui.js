// Lotería ID (Mi Entrenador → Lotería): el ID de 5 dígitos del entrenador, el sorteo del día y los ID de tus Pokémon (ver server/lottery.js).
import { S, h, act, emit, sfx, toast, itemImg, bus } from '../core.js';
import { confetti, reduced } from '../fx.js';

const digits = (num, match) => h('div', { class: 'lot-digits', 'aria-label': `Número ${num}` }, [...num].map((d, i) => h('span', { class: 'lot-d' + (i >= num.length - match ? ' hit' : '') }, d)));

export async function lotteryPanel() {
  const box = h('div', { class: 'stack lot-panel', 'data-testid': 'lot-panel' }, h('p', { class: 'muted small' }, 'Cargando…'));
  let st = null;
  const hhmm = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

  function render() {
    const prizeRows = Object.entries(st.prizes).map(([k, p]) => h('li', { class: st.checked && st.match === Number(k) ? 'on' : '' },
      h('b', {}, `${k} cifras`), itemImg(p.item), h('span', {}, p.label), h('span', { class: 'muted small' }, ` · 1 de cada ${Math.round(1 / st.odds[k]).toLocaleString('es')}`)));
    const result = st.checked
      ? h('div', { class: 'lot-result' }, h('div', { class: 'small muted' }, `Número de hoy (UTC ${st.day})`), digits(st.number, st.match),
        st.prize ? h('div', { class: 'lot-win', 'data-testid': 'lot-win' }, `🎉 ¡${st.match} cifras! Has ganado `, itemImg(st.prize.item), ` ${st.prize.label}`)
          : h('div', { class: 'small muted', 'data-testid': 'lot-none' }, st.match ? 'Una cifra: ¡casi! Hacen falta al menos dos.' : 'Ninguna coincidencia. Vuelve mañana.'),
        h('div', { class: 'small muted' }, `Siguiente sorteo a las ${hhmm(st.next)} (hora de España).`))
      : h('div', { class: 'lot-result' }, h('div', { class: 'lot-digits hidden-n' }, [0, 1, 2, 3, 4].map(() => h('span', { class: 'lot-d' }, '?'))),
        h('button', { class: 'btn primary', type: 'button', 'data-testid': 'lot-check', onclick: async (e) => {
          const r = await act('lot:check', {}, e.currentTarget);
          if (!r) return;
          st = r; sfx(r.prize ? 'shiny' : 'click'); if (r.prize && !reduced()) confetti({ count: 40 });
          if (r.prize) toast(`🎟️ Lotería ID: ${r.prize.label}`, 'success');
          render();
        } }, '🎟️ Comprobar el número de hoy (gratis)'));
    box.replaceChildren(
      h('div', { class: 'lot-top' },
        h('div', { class: 'lot-card', 'data-testid': 'lot-tid' }, h('div', { class: 'small muted' }, 'ID de entrenador'), h('div', { class: 'lot-id' }, digits(st.tid, 0)), h('div', { class: 'small' }, S.me.username)),
        h('div', { class: 'card stack lot-draw' }, h('h3', {}, '🎟️ Lotería ID'), result)),
      h('div', { class: 'cards2 lot-info' },
        h('div', { class: 'card stack' }, h('h4', {}, 'Premios'), h('ul', { class: 'lot-prizes' }, prizeRows),
          h('p', { class: 'small muted' }, 'Como en los juegos: se comparan las cifras desde el final con el ID del entrenador original de cada uno de tus Pokémon y cuenta el mejor. Los Pokémon que te regalan conservan el ID del original. Solo cuentan los que tenías antes de las 00:00 UTC.')),
        h('div', { class: 'card stack' }, h('h4', {}, `Tus ID (${st.ids.length})`),
          h('div', { class: 'lot-ids' }, st.ids.map((o) => h('span', { class: 'lot-chip' + (o.ot === st.tid ? ' me' : ''), title: o.name ? `Entrenador original: ${o.name}` : 'Tus propios Pokémon' }, h('b', {}, o.ot), o.n ? ` ×${o.n}` : '', o.wait ? h('span', { class: 'muted small', title: 'Los Pokémon obtenidos hoy cuentan desde mañana' }, ` +${o.wait} desde mañana`) : null, o.name ? h('span', { class: 'muted small' }, ` ${o.name}`) : null))),
          h('p', { class: 'small muted' }, 'Cuantos más ID distintos tengas (te los regalan otros entrenadores), más posibilidades. Comprobaciones hechas: ' + st.stats.checks + '.'))));
  }
  try { st = await emit('lot:state'); render(); } catch (e) { box.replaceChildren(h('p', { class: 'error' }, e.message)); }
  return box;
}

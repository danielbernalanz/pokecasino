// Pestaña «Torre» de Combates: Torre Batalla con equipos de alquiler (elegir equipo, combatir, cambiar, récords).
import { S, h, act, toast, sfx, sprite, typeBadge, avatar, titleTag, rankBadge } from '../core.js';
import { loadNames, moveEs, abilityEs, itemEs } from '../battle-screen.js';
import { showPlayer } from '../social.js';

const FORMAT_ES = { singles: 'Individual', doubles: 'Dobles' };
let fmtPick = 'singles';
let boardFormat = 'singles';
const dexOf = (id) => S.dexById.get(id) || { name: '#' + id, types: [] };

function monCard(m, { sel = false, disabled = false, onclick = null, tag = null } = {}) {
  const d = dexOf(m.id);
  return h(onclick ? 'button' : 'div', { class: 'tw-mon' + (sel ? ' sel' : '') + (disabled ? ' dis' : ''), type: onclick ? 'button' : undefined, disabled: disabled || undefined, 'aria-pressed': onclick ? String(sel) : undefined, onclick },
    h('img', { class: 'pixel', src: sprite(m.id), alt: '', loading: 'lazy' }),
    h('div', { class: 'tw-info' },
      h('div', { class: 'tw-nm' }, h('b', {}, d.name), m.gender ? h('span', { class: m.gender === 'M' ? 'gm' : 'gf' }, m.gender === 'M' ? ' ♂' : ' ♀') : '', h('span', { class: 'types' }, ' ', d.types.map(typeBadge)), tag),
      h('div', { class: 'small muted' }, `${abilityEs(m.ability)}${m.item ? ' · 🎒 ' + itemEs(m.item) : ''}`),
      h('div', { class: 'small tw-mv' }, m.moves.map(moveEs).join(' · '))));
}

/** @param {{ openBattle: Function, refresh: Function }} o */
export function towerTab({ openBattle, refresh }) {
  const root = h('div', { class: 'stack tw-tab' }, h('p', { class: 'muted' }, 'Cargando la Torre…'));
  (async () => {
    await loadNames();
    const st = await act('tower:state');
    if (!st) { root.replaceChildren(h('p', { class: 'bad' }, 'No se pudo cargar la Torre.')); return; }
    const redraw = (r) => { if (r && r.tower) { Object.assign(st, r.tower); } draw(); };
    const head = h('div', { class: 'card tw-head' },
      h('div', { class: 'grow' }, h('h3', {}, '🗼 Torre Batalla'),
        h('p', { class: 'small muted' }, `Combates seguidos contra la CPU con Pokémon de alquiler (nivel 50): no necesitas buenos Pokémon. Cada ${st.rules.round} combates es una ronda y el ${st.rules.boss} te espera el Jefe de la Torre. Ganas PB (1 → 3 por victoria, +${st.rules.roundBonus} al cerrar cada ronda, máx. ${st.bpCap} al día), nunca monedas. Rachas de 21, 50 y 100 dan título.`)),
      h('div', { class: 'tw-stats' },
        h('div', {}, h('span', { class: 'small muted' }, 'Mejor racha'), h('b', {}, `${st.best.singles} · ${st.best.doubles}`), h('span', { class: 'small muted' }, 'Indiv. · Dobles')),
        h('div', {}, h('span', { class: 'small muted' }, 'PB hoy'), h('b', {}, `${st.bpToday}/${st.bpCap}`))));
    const draw = () => {
      const run = st.run;
      const body = [];
      if (!run) {
        body.push(h('div', { class: 'card stack' }, h('h3', {}, 'Nueva carrera'),
          h('div', { class: 'seg' }, Object.entries(FORMAT_ES).map(([k, l]) => h('button', { class: 'seg-b' + (fmtPick === k ? ' on' : ''), type: 'button', onclick: () => { fmtPick = k; draw(); } }, l))),
          h('p', { class: 'small muted' }, fmtPick === 'doubles' ? `Te ofrecemos ${st.rules.offer} Pokémon de alquiler: eliges ${st.rules.pick.doubles} y combatís 2 contra 2.` : `Te ofrecemos ${st.rules.offer} Pokémon de alquiler: eliges ${st.rules.pick.singles} y combatís 1 contra 1.`),
          h('button', { class: 'btn primary big', type: 'button', onclick: async (e) => { const r = await act('tower:start', { format: fmtPick }, e.currentTarget); if (r) { sfx('click'); redraw(r); } } }, '🗼 Empezar carrera')));
      } else if (run.phase === 'pick') {
        const chosen = [];
        const need = st.rules.pick[run.format];
        const grid = h('div', { class: 'tw-grid' });
        const ok = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: async (e) => { const r = await act('tower:pick', { picks: chosen.slice() }, e.currentTarget); if (r) { sfx('click'); redraw(r); } } }, 'Confirmar equipo');
        const drawGrid = () => {
          grid.replaceChildren(...run.offer.map((m, i) => monCard(m, { sel: chosen.includes(i), disabled: !chosen.includes(i) && chosen.length >= need, onclick: () => { const k = chosen.indexOf(i); if (k >= 0) chosen.splice(k, 1); else if (chosen.length < need) chosen.push(i); drawGrid(); } })));
          ok.disabled = chosen.length !== need;
          cnt.textContent = `${chosen.length}/${need} elegidos`;
        };
        const cnt = h('b', {});
        body.push(h('div', { class: 'card stack' }, h('h3', {}, `Elige ${need} de ${run.offer.length} Pokémon de alquiler (${FORMAT_ES[run.format]})`), grid,
          h('div', { class: 'row gap wrap' }, ok, cnt, h('button', { class: 'btn danger small', type: 'button', onclick: async (e) => { const r = await act('tower:abandon', {}, e.currentTarget); if (r) { st.run = null; draw(); } } }, 'Cancelar carrera'))));
        drawGrid();
      } else {
        const nx = run.next;
        const swapping = run.phase === 'swap';
        const inB = run.phase === 'battle';
        body.push(h('div', { class: 'card stack tw-run' },
          h('div', { class: 'row gap wrap' },
            h('div', { class: 'tw-streak' }, h('span', { class: 'small muted' }, 'Racha'), h('b', {}, String(run.streak))),
            h('div', { class: 'grow' }, h('h3', {}, nx.boss ? '👑 ¡Jefe de la Torre!' : `Batalla ${nx.n}`), h('div', { class: 'small muted' }, `${FORMAT_ES[run.format]} · ronda ${nx.round} (${nx.inRound}/${st.rules.round}) · si ganas: +${nx.bp} PB`)),
            inB ? h('button', { class: 'btn gold', type: 'button', onclick: async (e) => { const r = await act('battle:resume', {}, e.currentTarget); if (r && r.battle) await openBattle(r.battle); else { toast('El combate ya no está en curso.', 'info'); refresh(); } } }, '⚔️ Volver al combate')
              : h('button', { class: 'btn primary big', type: 'button', onclick: async (e) => { const r = await act('tower:fight', {}, e.currentTarget); if (r && r.battle) { sfx('click'); await openBattle(r.battle); } } }, swapping ? 'Seguir sin cambiar ⚔️' : '⚔️ Combatir')),
          h('div', { class: 'small muted' }, 'Tu equipo de alquiler:'),
          swapping ? swapBox(run, redraw) : h('div', { class: 'tw-grid' }, run.team.map((m) => monCard(m))),
          inB ? null : h('div', { class: 'row gap wrap' }, h('button', { class: 'btn danger small', type: 'button', onclick: async (e) => { if (!confirm('¿Abandonar la carrera? Se queda registrada tu racha actual.')) return; const r = await act('tower:abandon', {}, e.currentTarget); if (r) { st.run = null; draw(); toast(`Carrera terminada: racha de ${r.ended ? r.ended.streak : 0}.`, 'info'); } } }, 'Abandonar carrera'))));
      }
      const rows = (st.board[boardFormat] || []).map((r, i) => h('div', { class: 'rank-row' + (r.username === S.me.username ? ' me' : '') + (i < 3 ? ' top' + (i + 1) : ''), onclick: () => showPlayer(r.username) },
        h('span', { class: 'rank-pos' }, ['🥇', '🥈', '🥉'][i] || i + 1), avatar(r.buddy, r),
        h('b', { class: 'grow' }, r.username, ' ', rankBadge(r.rank, 'sm'), ' ', titleTag(r.title)), h('span', { class: 'rank-val' }, `🗼 ${r.value}`)));
      const medals = st.rules.medals.map((n) => h('span', { class: 'tw-medal' + (st.medals['torre-' + n] ? ' got' : '') }, `${st.medals['torre-' + n] ? '🏅' : '🔒'} Racha ${n}`));
      body.push(h('div', { class: 'card stack' },
        h('div', { class: 'row gap wrap' }, h('h3', { class: 'grow' }, '🏆 Mejor racha'), h('div', { class: 'seg' }, Object.entries(FORMAT_ES).map(([k, l]) => h('button', { class: 'seg-b' + (boardFormat === k ? ' on' : ''), type: 'button', onclick: () => { boardFormat = k; draw(); } }, l)))),
        h('div', { class: 'rank-list' }, rows.length ? rows : [h('p', { class: 'muted' }, 'Nadie ha completado ningún combate en la Torre todavía.')]),
        h('div', { class: 'row gap wrap tw-medals' }, medals)));
      root.replaceChildren(head, ...body);
    };
    draw();
  })();
  return root;
}

// Tras una victoria: cambiar uno de tus Pokémon por uno del rival derrotado (opcional).
function swapBox(run, redraw) {
  let out = -1, inn = -1;
  const mine = h('div', { class: 'tw-grid' });
  const theirs = h('div', { class: 'tw-grid' });
  const go = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: async (e) => { const r = await act('tower:swap', { out, in: inn }, e.currentTarget); if (r) { sfx('click'); redraw(r); } } }, 'Cambiar');
  const clash = (m) => { const o = run.team.find((x, i) => i !== out && x.id === m.id); return !!o; };
  const drawBoth = () => {
    mine.replaceChildren(...run.team.map((m, i) => monCard(m, { sel: out === i, onclick: () => { out = out === i ? -1 : i; drawBoth(); } })));
    theirs.replaceChildren(...run.swap.map((m, i) => monCard(m, { sel: inn === i, disabled: out >= 0 && clash(m), onclick: () => { inn = inn === i ? -1 : i; drawBoth(); } })));
    go.disabled = out < 0 || inn < 0 || (out >= 0 && clash(run.swap[inn]));
  };
  drawBoth();
  return h('div', { class: 'stack tw-swap' }, mine, h('div', { class: 'small muted' }, '¿Quieres quedarte con uno de los Pokémon del rival? Elige uno tuyo (arriba) y uno suyo (abajo), o sigue sin cambiar:'), theirs, h('div', { class: 'row gap' }, go));
}

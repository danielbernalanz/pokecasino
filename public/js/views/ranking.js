import { S, h, fmt, act, avatar, titleTag, fmtPlay, rankBadge } from '../core.js';
import { showPlayer } from '../social.js';

const CATS = [['coins', '💰 Monedas'], ['badges', '🏅 Medallas'], ['dex', '📕 Pokédex'], ['shinies', '✨ Variocolor'], ['biggestWin', '🏆 Mayor premio'], ['duels', '⚔️ Duelos ganados'], ['liga', '🎖️ Liga'], ['torre', '🗼 Torre'], ['playtime', '⏱️ Tiempo de juego']];
const FMT = { singles: 'Individual', doubles: 'Dobles' };
let fmtSel = 'singles';
let cat = 'coins';

export default {
  id: 'ranking', title: 'Ranking', icon: '🏆',
  async mount(root) {
    const tabs = h('div', { class: 'tabs' });
    const table = h('div', { class: 'rank-list' });
    const segBox = h('div', { class: 'rank-segbox' });
    let data = null;
    const render = () => {
      tabs.replaceChildren(...CATS.map(([k, l]) => h('button', { class: 'tab' + (k === cat ? ' active' : ''), onclick: () => { cat = k; render(); } }, l)));
      segBox.replaceChildren();
      if (!data) return;
      const sub = cat === 'liga' || cat === 'torre';
      const list = sub ? (data[cat] || {})[fmtSel] || [] : data[cat] || [];
      if (sub) segBox.append(h('div', { class: 'seg rank-seg' }, Object.entries(FMT).map(([k, l]) => h('button', { class: 'seg-b' + (fmtSel === k ? ' on' : ''), type: 'button', onclick: () => { fmtSel = k; render(); } }, l))));
      if (sub && !list.length) { table.replaceChildren(h('p', { class: 'muted' }, cat === 'liga' ? 'Nadie ha jugado la Clasificatoria esta temporada.' : 'Nadie ha completado combates en la Torre todavía.')); return; }
      if (cat === 'playtime' && !data[cat].length) { table.replaceChildren(h('p', { class: 'muted' }, 'Aún nadie tiene tiempo de juego público.')); return; }
      table.replaceChildren(...list.map((r, i) => h('div', { class: 'rank-row' + (r.username === S.me.username ? ' me' : '') + (i < 3 ? ' top' + (i + 1) : ''), onclick: () => showPlayer(r.username) },
        h('span', { class: 'rank-pos' }, ['🥇', '🥈', '🥉'][i] || i + 1),
        avatar(r.buddy, r),
        h('b', { class: 'grow' }, r.username, ' ', rankBadge(r.rank, 'sm'), ' ', titleTag(r.title), h('span', { class: 'muted small' }, ` Nv ${r.level}`)),
        h('span', { class: 'rank-val' }, cat === 'badges' ? `🏅${Math.floor(r.value / 1000)} · 📚${r.value % 1000}` : cat === 'playtime' ? fmtPlay(r.value) : cat === 'liga' ? `${r.value} · ${r.w}V ${r.l}D` : cat === 'torre' ? `🗼 ${r.value}` : fmt(r.value)))));
    };
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏆 Ranking de entrenadores')), tabs, segBox, table);
    render();
    const res = await act('leaderboard');
    if (res) { data = res; render(); }
  },
};

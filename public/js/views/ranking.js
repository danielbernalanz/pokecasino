import { S, h, fmt, act, avatar, titleTag } from '../core.js';
import { showPlayer } from '../social.js';

const CATS = [['coins', '💰 Monedas'], ['badges', '🏅 Medallas'], ['dex', '📕 Pokédex'], ['shinies', '✨ Variocolor'], ['biggestWin', '🏆 Mayor premio'], ['duels', '⚔️ Duelos ganados']];
let cat = 'coins';

export default {
  id: 'ranking', title: 'Ranking', icon: '🏆',
  async mount(root) {
    const tabs = h('div', { class: 'tabs' });
    const table = h('div', { class: 'rank-list' });
    let data = null;
    const render = () => {
      tabs.replaceChildren(...CATS.map(([k, l]) => h('button', { class: 'tab' + (k === cat ? ' active' : ''), onclick: () => { cat = k; render(); } }, l)));
      if (!data) return;
      table.replaceChildren(...data[cat].map((r, i) => h('div', { class: 'rank-row' + (r.username === S.me.username ? ' me' : '') + (i < 3 ? ' top' + (i + 1) : ''), onclick: () => showPlayer(r.username) },
        h('span', { class: 'rank-pos' }, ['🥇', '🥈', '🥉'][i] || i + 1),
        avatar(r.buddy, r),
        h('b', { class: 'grow' }, r.username, ' ', titleTag(r.title), h('span', { class: 'muted small' }, ` Nv ${r.level}`)),
        h('span', { class: 'rank-val' }, cat === 'badges' ? `🏅${Math.floor(r.value / 1000)} · 📚${r.value % 1000}` : fmt(r.value)))));
    };
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏆 Ranking de entrenadores')), tabs, table);
    render();
    const res = await act('leaderboard');
    if (res) { data = res; render(); }
  },
};

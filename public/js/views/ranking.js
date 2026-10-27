import { S, h, fmt, act, sprite } from '../core.js';
import { showPlayer } from '../social.js';

const CATS = [['coins', '💰 Monedas'], ['dex', '📕 Pokédex'], ['shinies', '✨ Variocolor'], ['biggestWin', '🏆 Mayor premio'], ['duels', '⚔️ Duelos ganados']];
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
        r.buddy ? h('img', { class: 'pixel', src: sprite(r.buddy.id, r.buddy.shiny), alt: '' }) : h('span', { class: 'mini' }),
        h('b', { class: 'grow' }, r.username, h('span', { class: 'muted small' }, ` Nv ${r.level}`)),
        h('span', { class: 'rank-val' }, fmt(r.value)))));
    };
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏆 Ranking de entrenadores')), tabs, table);
    render();
    const res = await act('leaderboard');
    if (res) { data = res; render(); }
  },
};

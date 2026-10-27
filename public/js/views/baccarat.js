import { S, h, fmt, emit, sfx, toast, playingCard, sleep, sprite } from '../core.js';

const LABEL = { player: 'Punto', banker: 'Banca', tie: 'Empate' };

export default {
  id: 'baccarat', title: 'Baccarat', icon: '🎴',
  mount(root) {
    let chip = 100;
    const bets = { player: 0, banker: 0, tie: 0 };
    const pBox = h('div', { class: 'cards-row' });
    const bBox = h('div', { class: 'cards-row' });
    const pScore = h('b', { class: 'bac-score' }, '–');
    const bScore = h('b', { class: 'bac-score' }, '–');
    const msg = h('div', { class: 'table-msg' }, 'Apuesta a Punto, Banca o Empate.');
    const amt = {};
    const spot = (k) => h('button', { class: `bac-spot bs-${k}`, onclick: () => { bets[k] += chip; sfx('click'); refresh(); }, oncontextmenu: (e) => { e.preventDefault(); bets[k] = 0; refresh(); } },
      h('b', {}, LABEL[k]), h('span', { class: 'muted small' }, `paga ×${S.data.baccaratPayout[k]}`), amt[k] = h('span', { class: 'bet-amt' }));
    function refresh() { for (const k of Object.keys(bets)) { amt[k].textContent = bets[k] ? fmt(bets[k]) : ''; amt[k].parentElement.classList.toggle('has', bets[k] > 0); } }
    const chipBtns = [10, 50, 100, 500, 1000, 5000].map((v) => h('button', { class: 'chip-btn' + (v === chip ? ' active' : ''), onclick: (e) => { chip = v; chipBtns.forEach((b) => b.classList.toggle('active', b === e.currentTarget)); } }, v >= 1000 ? v / 1000 + 'k' : v));
    const playBtn = h('button', { class: 'btn primary huge', onclick: play }, 'JUGAR');
    async function play() {
      if (!bets.player && !bets.banker && !bets.tie) return toast('Coloca fichas primero.', 'error');
      playBtn.disabled = true;
      try {
        const r = await emit('baccarat:play', { bets });
        pBox.replaceChildren(); bBox.replaceChildren(); pScore.textContent = '–'; bScore.textContent = '–';
        const order = [[pBox, r.player[0]], [bBox, r.banker[0]], [pBox, r.player[1]], [bBox, r.banker[1]]];
        if (r.player[2]) order.push([pBox, r.player[2]]);
        if (r.banker[2]) order.push([bBox, r.banker[2]]);
        for (const [box, c] of order) { box.append(playingCard(c, { cls: 'deal' })); sfx('flip'); await sleep(380); }
        pScore.textContent = r.ps; bScore.textContent = r.bs;
        msg.replaceChildren(h('b', {}, `Gana ${LABEL[r.winner]} (${r.ps} – ${r.bs}) `), r.paid ? h('b', { class: 'good' }, `+${fmt(r.paid)}`) : h('span', { class: 'muted' }, 'sin premio'));
        sfx(r.paid ? 'win' : 'lose');
      } catch (e) { toast(e.message, 'error'); }
      playBtn.disabled = false;
    }
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🎴 Baccarat de Mr. Mime'), h('p', { class: 'muted' }, 'Gana la mano más cercana a 9. Banca paga 0,95:1, Empate 8:1; en empate se devuelven Punto y Banca.')),
      h('div', { class: 'felt' },
        h('div', { class: 'bac-table' },
          h('div', { class: 'bac-side' }, h('div', { class: 'row gap' }, h('h3', {}, 'Punto'), pScore), pBox),
          h('img', { class: 'pixel dealer-mon', src: sprite(122), alt: 'Mr. Mime' }),
          h('div', { class: 'bac-side' }, h('div', { class: 'row gap' }, h('h3', {}, 'Banca'), bScore), bBox)),
        msg,
        h('div', { class: 'bac-spots' }, spot('player'), spot('tie'), spot('banker')),
        h('div', { class: 'row gap wrap center' }, h('div', { class: 'chips' }, chipBtns), h('button', { class: 'btn', onclick: () => { bets.player = bets.banker = bets.tie = 0; refresh(); } }, 'Limpiar'), playBtn)));
  },
};

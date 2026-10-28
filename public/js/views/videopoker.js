import { S, h, fmt, emit, sfx, toast, betInput, playingCard, confirmBet, confirmRisk } from '../core.js';
import { winFx, burstEl, floatText, flash, vibrate } from '../fx.js';

export default {
  id: 'videopoker', title: 'Video Póker', icon: '🂡',
  mount(root) {
    const bet = betInput(100, 'vp');
    let hand = null;
    let holds = [false, false, false, false, false];
    let phase = 'idle';
    let stake = 0;
    let dealHint = null;
    const cardsBox = h('div', { class: 'vp-cards' });
    const msg = h('div', { class: 'table-msg' }, 'Reparte, guarda las cartas que quieras y cambia el resto.');
    const rows = S.data.vpPaytable.map(([name, mult]) => h('tr', { 'data-name': name }, h('td', {}, name), h('td', {}, '×' + mult)));
    const mainBtn = h('button', { class: 'btn primary huge', onclick: () => (phase === 'hold' ? draw() : deal()) }, 'REPARTIR');

    function render(win) {
      cardsBox.replaceChildren(...(hand || [null, null, null, null, null]).map((c, i) => h('button', {
        class: 'vp-slot' + (holds[i] ? ' held' : ''), disabled: phase !== 'hold',
        onclick: () => { holds[i] = !holds[i]; sfx('click'); render(); },
      }, c ? playingCard(c, { cls: 'deal', delay: i * 80 }) : playingCard(null), h('span', { class: 'hold-tag' }, 'GUARDADA'))));
      rows.forEach((r) => r.classList.toggle('hit', r.dataset.name === win));
    }
    async function deal() {
      if (!(await confirmBet('videopoker', bet.value))) return;
      try {
        const r = await emit('vp:deal', { bet: bet.value });
        hand = r.hand; holds = [false, false, false, false, false]; phase = 'hold'; stake = bet.value; dealHint = r.hint || null;
        mainBtn.textContent = 'CAMBIAR';
        msg.textContent = r.hint ? `Ya tienes: ${r.hint}` : 'Elige qué cartas guardar.';
        sfx('flip'); render(r.hint);
      } catch (e) { toast(e.message, 'error'); sfx('error'); }
    }
    async function draw() {
      if (dealHint && !holds.some(Boolean)) {
        const pay = (S.data.vpPaytable.find(([n]) => n === dealHint) || [])[1];
        if (!(await confirmRisk('vp-discard-win', {
          title: 'Vas a cambiar las 5 cartas',
          text: `Ya tienes «${dealHint}»${pay ? ` (paga ×${pay}, es decir ${fmt(stake * pay)} monedas)` : ''}, pero no has guardado ninguna carta: al cambiar las cinco perderías ese premio.`,
          details: ['Pulsa sobre las cartas para guardarlas antes de cambiar.'], danger: 'Cambiar todas igualmente', safe: 'Volver y guardar' }))) return;
      }
      try {
        const r = await emit('vp:draw', { hold: holds });
        hand = r.hand; phase = 'idle'; mainBtn.textContent = 'REPARTIR';
        msg.replaceChildren(r.result ? h('b', { class: 'good' }, `${r.result} · +${fmt(r.paid)}`) : h('span', { class: 'muted' }, 'Sin premio.'));
        sfx(r.mult >= 25 ? 'big' : r.paid ? 'win' : 'lose');
        holds = [false, false, false, false, false];
        render(r.result);
        if (r.paid) {
          // Cada carta de la jugada ganadora destella; los premios altos escalan con el multiplicador.
          [...cardsBox.children].forEach((c, k) => setTimeout(() => burstEl(c, '#ffd54f', 6, { spread: 80, stars: 0.7 }), k * 70));
          floatText(r.result, cardsBox, { size: 26 });
          if (r.mult >= 25) { flash('#ffe08a', 450); vibrate([40, 30, 80]); }
          winFx(r.paid, stake, { el: cardsBox, title: r.mult >= 250 ? '¡ESCALERA REAL!' : '¡GRAN PREMIO!', icon: '🂡' });
        }
      } catch (e) { toast(e.message, 'error'); }
    }
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🂡 Video Póker'), h('p', { class: 'muted' }, 'Jacks or Better 9/6: el clásico de máquina con mejor RTP del casino.')),
      h('div', { class: 'vp-layout' },
        h('div', { class: 'felt' }, cardsBox, msg, h('div', { class: 'row gap wrap center' }, bet.el, mainBtn)),
        h('div', { class: 'card' }, h('h3', {}, 'Premios (× apuesta)'), h('table', { class: 'paytbl' }, h('tbody', {}, rows)))));
    render();
  },
};

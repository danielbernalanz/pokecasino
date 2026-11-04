import { S, h, fmt, emit, sfx, toast, betInput, playingCard, confirmBet, confirmRisk, holdCoins, releaseCoins } from '../core.js';
import { winFx, burstEl, floatText, flash, vibrate } from '../fx.js';
import { hotkey, viewAlive, tw } from '../gamekit.js';

export default {
  id: 'videopoker', title: 'Video Póker', icon: '🂡',
  mount(root) {
    const bet = betInput(100, 'vp');
    let hand = null;
    let holds = [false, false, false, false, false];
    let phase = 'idle';
    let stake = 0;
    let dealHint = null;
    let busy = false;
    let shownHand = []; // cartas ya pintadas: solo las nuevas se animan
    const cardsBox = h('div', { class: 'vp-cards' });
    const msg = h('div', { class: 'table-msg' }, 'Reparte, guarda las cartas que quieras y cambia el resto.');
    const rows = S.data.vpPaytable.map(([name, mult]) => h('tr', { 'data-name': name }, h('td', {}, name), h('td', {}, '×' + mult)));
    const mainBtn = h('button', { class: 'btn primary huge', type: 'button', title: 'Espacio o Intro', onclick: () => main() }, 'REPARTIR');
    const main = () => (phase === 'hold' ? draw() : deal());

    function render(win) {
      const prev = shownHand;
      shownHand = hand ? hand.slice() : [];
      cardsBox.replaceChildren(...(hand || [null, null, null, null, null]).map((c, i) => h('button', {
        class: 'vp-slot' + (holds[i] ? ' held' : ''), disabled: phase !== 'hold', title: phase === 'hold' ? `Guardar / soltar (tecla ${i + 1})` : '',
        // Solo se marca esa carta: volver a dibujar la mano repetía la animación de reparto y movía la pantalla.
        onclick: (e) => { holds[i] = !holds[i]; sfx('click'); e.currentTarget.classList.toggle('held', holds[i]); },
      }, c ? playingCard(c, { cls: prev[i] === c ? '' : 'deal', delay: i * 80 }) : playingCard(null), h('span', { class: 'hold-tag' }, 'GUARDADA'))));
      rows.forEach((r) => r.classList.toggle('hit', r.dataset.name === win));
    }
    async function deal() {
      if (busy || phase === 'hold') return;
      busy = true; mainBtn.disabled = true;
      try {
        const stake0 = bet.value;
        if (!(await confirmBet('videopoker', stake0))) return;
        shownHand = [];
        const r = await emit('vp:deal', { bet: stake0 });
        hand = r.hand; holds = [false, false, false, false, false]; phase = 'hold'; stake = stake0; dealHint = r.hint || null; bet.lock(true);
        mainBtn.textContent = 'CAMBIAR';
        msg.textContent = r.hint ? `Ya tienes: ${r.hint}. Pulsa las cartas (o 1-5) para guardarlas.` : 'Pulsa las cartas (o 1-5) que quieras guardar y cambia el resto.';
        sfx('flip'); render(r.hint);
      } catch (e) { toast(e.message, 'error'); sfx('error'); } finally { busy = false; mainBtn.disabled = false; }
    }
    async function draw() {
      if (busy || phase !== 'hold') return;
      busy = true; mainBtn.disabled = true;
      try { await draw1(); } finally { busy = false; mainBtn.disabled = false; }
    }
    async function draw1() {
      if (dealHint && !holds.some(Boolean)) {
        const pay = (S.data.vpPaytable.find(([n]) => n === dealHint) || [])[1];
        if (!(await confirmRisk('vp-discard-win', {
          title: 'Vas a cambiar las 5 cartas',
          text: `Ya tienes «${dealHint}»${pay ? ` (paga ×${pay}, es decir ${fmt(stake * pay)} monedas)` : ''}, pero no has guardado ninguna carta: al cambiar las cinco perderías ese premio.`,
          details: ['Pulsa sobre las cartas para guardarlas antes de cambiar.'], danger: 'Cambiar todas igualmente', safe: 'Volver y guardar' }))) return;
      }
      holdCoins(0, 2500);
      try {
        const r = await emit('vp:draw', { hold: holds });
        hand = r.hand; phase = 'idle'; bet.lock(false); mainBtn.textContent = 'REPARTIR';
        msg.replaceChildren(r.result ? h('b', { class: 'good' }, `${r.result} · +${fmt(r.paid)}`) : h('span', { class: 'muted' }, 'Sin premio.'));
        sfx(r.mult >= 25 ? 'big' : r.paid ? 'win' : 'lose');
        holds = [false, false, false, false, false];
        render(r.result);
        setTimeout(releaseCoins, tw(650)); // tras dar la vuelta a las cartas
        if (r.paid) {
          // Cada carta de la jugada ganadora destella; los premios altos escalan con el multiplicador.
          [...cardsBox.children].forEach((c, k) => setTimeout(() => burstEl(c, '#ffd54f', 6, { spread: 80, stars: 0.7 }), k * 70));
          floatText(r.result, cardsBox, { size: 26 });
          if (r.mult >= 25) { flash('#ffe08a', 450); vibrate([40, 30, 80]); }
          winFx(r.paid, stake, { el: cardsBox, title: r.mult >= 250 ? '¡ESCALERA REAL!' : '¡GRAN PREMIO!', icon: '🂡' });
        }
      } catch (e) { releaseCoins(); toast(e.message, 'error'); }
    }
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🂡 Video Póker'), h('p', { class: 'muted' }, 'Jacks or Better 9/6: el clásico de máquina con mejor RTP del casino.')),
      h('div', { class: 'vp-layout' },
        h('div', { class: 'felt' }, cardsBox, msg, h('div', { class: 'row gap wrap center' }, bet.el, mainBtn)),
        h('div', { class: 'card' }, h('h3', {}, 'Premios (× apuesta)'), h('table', { class: 'paytbl' }, h('tbody', {}, rows)))));
    // Espacio / Intro: repartir o cambiar. 1-5 guardan cartas.
    hotkey(root, main);
    const alive = viewAlive(root);
    const onNum = (e) => {
      if (!alive()) return document.removeEventListener('keydown', onNum);
      if (phase !== 'hold' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-wrap, .gx') || (e.target.closest && e.target.closest('input, textarea, select'))) return;
      const i = Number(e.key) - 1;
      if (i >= 0 && i < 5) { e.preventDefault(); cardsBox.children[i]?.click(); }
    };
    document.addEventListener('keydown', onNum);
    render();
    // Mano a medias (recarga o cambio de pantalla): se retoma donde se dejó.
    emit('vp:state').then((r) => {
      if (!r.hand || !root.isConnected || phase !== 'idle') return;
      hand = r.hand; holds = [false, false, false, false, false]; phase = 'hold'; stake = r.bet; dealHint = r.hint || null; bet.lock(true);
      mainBtn.textContent = 'CAMBIAR';
      msg.textContent = r.hint ? `Ya tienes: ${r.hint}` : 'Elige qué cartas guardar.';
      render(r.hint);
    }).catch(() => {});
  },
};

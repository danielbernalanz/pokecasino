import { S, h, fmt, emit, sfx, toast, betInput, playingCard, sprite, confirmBet, confirmRisk, holdCoins, releaseCoins } from '../core.js';
import { winFx, burstEl, flash, floatText, vibrate } from '../fx.js';
import { hotkey, viewAlive, tw } from '../gamekit.js';

const RESULT = { blackjack: '¡Blackjack!', win: 'Ganas', push: 'Empate', lose: 'Pierdes', bust: 'Te pasaste' };

export default {
  id: 'blackjack', title: 'Blackjack', icon: '🃏',
  async mount(root) {
    const bet = betInput(100, 'bj');
    const dealerBox = h('div', { class: 'cards-row' });
    const dealerTotal = h('span', { class: 'bj-total' });
    const handsBox = h('div', { class: 'bj-hands' });
    const msg = h('div', { class: 'table-msg' }, 'Haz tu apuesta y reparte.');
    const btn = (label, action, cls = '', key = '') => h('button', { class: 'btn big ' + cls, type: 'button', title: key ? `Tecla ${key}` : '', onclick: () => play(action) }, label);
    const dealBtn = h('button', { class: 'btn primary big', type: 'button', title: 'Espacio o Intro', onclick: () => deal() }, 'Repartir');
    let busy = false;
    const actions = { hit: btn('Pedir', 'hit', 'primary', 'P'), stand: btn('Plantarse', 'stand', '', 'S'), double: btn('Doblar', 'double', 'gold', 'D'), split: btn('Dividir', 'split', '', 'V') };
    // Cartas ya en mesa (clave por posición): solo las nuevas se animan; volver a pintar no reparte otra vez.
    let seen = new Set();
    let cur = null;
    const CV = { A: 11, K: 10, Q: 10, J: 10, T: 10 };
    // Total de una mano y si es blanda (con un As contando 11).
    function handTotal(cards) {
      let t = 0; let aces = 0;
      for (const c of cards) { const v = CV[c[0]] || Number(c[0]); t += v; if (c[0] === 'A') aces++; }
      while (t > 21 && aces) { t -= 10; aces--; }
      return { t, soft: aces > 0 };
    }

    function render(g, animate) {
      cur = g;
      if (!g) { dealerBox.replaceChildren(); handsBox.replaceChildren(); dealerTotal.textContent = ''; seen = new Set(); setButtons(null); return; }
      const fresh = (key, c) => { const k = key + ':' + c; const isNew = animate && !seen.has(k); seen.add(k); return isNew ? 'deal' : ''; };
      dealerBox.replaceChildren(...g.dealer.map((c, i) => playingCard(c, { cls: fresh('d' + i, c), delay: i * 120, back: S.me.equip.cardback })));
      dealerTotal.textContent = g.dealerTotal;
      handsBox.replaceChildren(...g.hands.map((hd, k) => h('div', { class: 'bj-hand' + (k === g.active && !g.done ? ' active' : '') + (hd.result ? ' r-' + hd.result : '') },
        h('div', { class: 'cards-row' }, hd.cards.map((c, i) => playingCard(c, { cls: fresh(`h${k}.${i}`, c), delay: i * 120 }))),
        h('div', { class: 'row gap' }, h('span', { class: 'bj-total' }, hd.total), h('span', { class: 'muted small' }, `Apuesta ${fmt(hd.bet)}`),
          hd.result ? h('b', { class: ['win', 'blackjack'].includes(hd.result) ? 'good' : hd.result === 'push' ? '' : 'bad' }, RESULT[hd.result]) : null))));
      setButtons(g);
      if (g.done) {
        msg.replaceChildren(g.paid ? h('b', { class: 'good' }, `+${fmt(g.paid)} monedas`) : h('span', { class: 'muted' }, 'La casa gana esta vez.'));
        const bj = g.hands.some((x) => x.result === 'blackjack');
        sfx(g.paid ? (bj ? 'big' : 'win') : 'lose');
        if (animate && g.paid) {
          const stake = g.hands.reduce((a, x) => a + x.bet, 0);
          if (bj) { flash('#ffe08a', 450); floatText('¡BLACKJACK!', handsBox, { size: 30 }); burstEl(handsBox, '#ffd54f', 36, { spread: 240, stars: 0.6 }); vibrate([40, 30, 80]); }
          winFx(g.paid, stake, { el: handsBox, icon: '🃏' });
        }
      } else {
        const hd = g.hands[g.active];
        const n = g.hands.length;
        const which = n > 1 ? `Mano ${g.active + 1} de ${n}: ` : '';
        msg.textContent = hd && hd.aceSplit
          ? `${which}otro As. ¿Lo vuelves a dividir o te plantas?`
          : `${which}¿Pides carta o te plantas?`;
      }
    }
    function setButtons(g) {
      const playing = g && !g.done;
      dealBtn.classList.toggle('hidden', !!playing);
      bet.lock(!!playing);
      actions.hit.classList.toggle('hidden', !playing || g.canHit === false);
      actions.stand.classList.toggle('hidden', !playing);
      actions.double.classList.toggle('hidden', !playing || !g.canDouble);
      actions.split.classList.toggle('hidden', !playing || !g.canSplit);
    }
    async function deal() {
      if (busy || (cur && !cur.done)) return;
      busy = true; dealBtn.disabled = true;
      try {
        const stake = bet.value;
        if (!(await confirmBet('blackjack', stake))) return;
        holdCoins(stake, 3000);
        try { const r = await emit('bj:deal', { bet: stake }); seen = new Set(); sfx('flip'); render(r.game, true); setTimeout(releaseCoins, tw(700)); } catch (e) { releaseCoins(); toast(e.message, 'error'); sfx('error'); }
      } finally { busy = false; dealBtn.disabled = false; }
    }
    async function play(action) {
      if (busy) return;
      const hd = cur && !cur.done && cur.hands[cur.active];
      if (hd) {
        const { t, soft } = handTotal(hd.cards);
        const bad = !soft && ((action === 'double' && t >= 12) || (action === 'hit' && t >= 17));
        if (bad && !(await confirmRisk('bj-bad-move', {
          title: action === 'double' ? 'Doblar con una mano alta' : 'Pedir carta con una mano alta',
          text: action === 'double'
            ? `Tienes un ${t} duro. Doblar solo compensa con 9, 10 u 11: con ${t} es muy probable pasarte y perder el doble de apuesta (${fmt(hd.bet * 2)}). La estrategia básica recomienda plantarse o pedir sin doblar.`
            : `Tienes un ${t} duro y pedir carta te hace pasarte con mucha probabilidad (${Math.round((t - 8) / 13 * 100)} %). La estrategia básica recomienda plantarse.`,
          danger: action === 'double' ? 'Doblar igualmente' : 'Pedir igualmente', safe: 'Plantarme / volver' }))) return;
        if ((action === 'double' || action === 'split') && !(await confirmBet('blackjack', hd.bet, { what: action === 'double' ? 'doblar con' : 'añadir' }))) return;
      }
      busy = true;
      Object.values(actions).forEach((b) => { b.disabled = true; });
      holdCoins(0, 3000);
      try { const r = await emit('bj:act', { action }); sfx('flip'); render(r.game, true); setTimeout(releaseCoins, tw(700)); } catch (e) { releaseCoins(); toast(e.message, 'error'); } finally { busy = false; Object.values(actions).forEach((b) => { b.disabled = false; }); }
    }
    // Espacio / Intro: repartir de nuevo con la misma apuesta. Durante la mano: P pedir, S plantarse, D doblar, V dividir.
    const playing = () => cur && !cur.done;
    hotkey(root, () => { if (!playing()) deal(); });
    const alive = viewAlive(root);
    const onLetter = (e) => {
      if (!alive()) return document.removeEventListener('keydown', onLetter);
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || document.querySelector('.modal-wrap, .gx') || (e.target.closest && e.target.closest('input, textarea, select'))) return;
      const map = { p: 'hit', s: 'stand', d: 'double', v: 'split' };
      const a = map[e.key.toLowerCase()];
      if (a && playing() && !actions[a].classList.contains('hidden')) { e.preventDefault(); play(a); }
    };
    document.addEventListener('keydown', onLetter);

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🃏 Blackjack de Snorlax'), h('p', { class: 'muted' }, 'Blackjack paga 3:2 · El crupier se planta en 17 · Doblar con 2 cartas (también tras dividir) · Dividir hasta 4 manos, Ases incluidos (un As dividido recibe una carta; si es otro As, puedes volver a dividir)')),
      h('div', { class: 'felt' },
        h('div', { class: 'dealer-area' }, h('img', { class: 'pixel dealer-mon', src: sprite(143), alt: 'Snorlax' }), h('div', {}, h('div', { class: 'muted small' }, 'Crupier ', dealerTotal), dealerBox)),
        handsBox, msg,
        h('div', { class: 'row gap wrap center bj-controls' }, bet.el, dealBtn, ...Object.values(actions))));
    try { const r = await emit('bj:state'); render(r.game); } catch { render(null); }
  },
};

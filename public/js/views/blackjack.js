import { S, h, fmt, emit, sfx, toast, betInput, playingCard, sprite, confirmBet, confirmRisk } from '../core.js';
import { winFx, burstEl, flash, floatText, vibrate } from '../fx.js';

const RESULT = { blackjack: '¡Blackjack!', win: 'Ganas', push: 'Empate', lose: 'Pierdes', bust: 'Te pasaste' };

export default {
  id: 'blackjack', title: 'Blackjack', icon: '🃏',
  async mount(root) {
    const bet = betInput(100, 'bj');
    const dealerBox = h('div', { class: 'cards-row' });
    const dealerTotal = h('span', { class: 'bj-total' });
    const handsBox = h('div', { class: 'bj-hands' });
    const msg = h('div', { class: 'table-msg' }, 'Haz tu apuesta y reparte.');
    const btn = (label, action, cls = '') => h('button', { class: 'btn big ' + cls, onclick: () => play(action) }, label);
    const dealBtn = h('button', { class: 'btn primary big', onclick: () => deal() }, 'Repartir');
    const actions = { hit: btn('Pedir', 'hit', 'primary'), stand: btn('Plantarse', 'stand'), double: btn('Doblar', 'double', 'gold'), split: btn('Dividir', 'split') };
    let shown = 0;
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
      if (!g) { dealerBox.replaceChildren(); handsBox.replaceChildren(); dealerTotal.textContent = ''; setButtons(null); return; }
      dealerBox.replaceChildren(...g.dealer.map((c, i) => playingCard(c, { cls: animate ? 'deal' : '', delay: i * 120, back: S.me.equip.cardback })));
      dealerTotal.textContent = g.dealerTotal;
      handsBox.replaceChildren(...g.hands.map((hd, k) => h('div', { class: 'bj-hand' + (k === g.active && !g.done ? ' active' : '') + (hd.result ? ' r-' + hd.result : '') },
        h('div', { class: 'cards-row' }, hd.cards.map((c, i) => playingCard(c, { cls: animate && i >= shown ? 'deal' : '', delay: i * 120 }))),
        h('div', { class: 'row gap' }, h('span', { class: 'bj-total' }, hd.total), h('span', { class: 'muted small' }, `Apuesta ${fmt(hd.bet)}`),
          hd.result ? h('b', { class: ['win', 'blackjack'].includes(hd.result) ? 'good' : hd.result === 'push' ? '' : 'bad' }, RESULT[hd.result]) : null))));
      shown = Math.max(...g.hands.map((x) => x.cards.length));
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
      } else msg.textContent = '¿Pides carta o te plantas?';
    }
    function setButtons(g) {
      const playing = g && !g.done;
      dealBtn.classList.toggle('hidden', !!playing);
      bet.el.classList.toggle('hidden', !!playing);
      actions.hit.classList.toggle('hidden', !playing);
      actions.stand.classList.toggle('hidden', !playing);
      actions.double.classList.toggle('hidden', !playing || !g.canDouble);
      actions.split.classList.toggle('hidden', !playing || !g.canSplit);
    }
    async function deal() {
      shown = 0;
      if (!(await confirmBet('blackjack', bet.value))) return;
      try { const r = await emit('bj:deal', { bet: bet.value }); sfx('flip'); render(r.game, true); } catch (e) { toast(e.message, 'error'); sfx('error'); }
    }
    async function play(action) {
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
      try { const r = await emit('bj:act', { action }); sfx('flip'); render(r.game, true); } catch (e) { toast(e.message, 'error'); }
    }

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🃏 Blackjack de Snorlax'), h('p', { class: 'muted' }, 'Blackjack paga 3:2 · El crupier se planta en 17 · Doblar con 2 cartas · Dividir una vez')),
      h('div', { class: 'felt' },
        h('div', { class: 'dealer-area' }, h('img', { class: 'pixel dealer-mon', src: sprite(143), alt: 'Snorlax' }), h('div', {}, h('div', { class: 'muted small' }, 'Crupier ', dealerTotal), dealerBox)),
        handsBox, msg,
        h('div', { class: 'row gap wrap center' }, bet.el, dealBtn, ...Object.values(actions))));
    try { const r = await emit('bj:state'); render(r.game); } catch { render(null); }
  },
};

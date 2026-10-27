import { h, fmt, emit, sfx, toast, betInput, playingCard, sprite } from '../core.js';

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

    function render(g, animate) {
      if (!g) { dealerBox.replaceChildren(); handsBox.replaceChildren(); dealerTotal.textContent = ''; setButtons(null); return; }
      dealerBox.replaceChildren(...g.dealer.map((c, i) => playingCard(c, { cls: animate ? 'deal' : '', delay: i * 120 })));
      dealerTotal.textContent = g.dealerTotal;
      handsBox.replaceChildren(...g.hands.map((hd, k) => h('div', { class: 'bj-hand' + (k === g.active && !g.done ? ' active' : '') + (hd.result ? ' r-' + hd.result : '') },
        h('div', { class: 'cards-row' }, hd.cards.map((c, i) => playingCard(c, { cls: animate && i >= shown ? 'deal' : '', delay: i * 120 }))),
        h('div', { class: 'row gap' }, h('span', { class: 'bj-total' }, hd.total), h('span', { class: 'muted small' }, `Apuesta ${fmt(hd.bet)}`),
          hd.result ? h('b', { class: ['win', 'blackjack'].includes(hd.result) ? 'good' : hd.result === 'push' ? '' : 'bad' }, RESULT[hd.result]) : null))));
      shown = Math.max(...g.hands.map((x) => x.cards.length));
      setButtons(g);
      if (g.done) {
        msg.replaceChildren(g.paid ? h('b', { class: 'good' }, `+${fmt(g.paid)} monedas`) : h('span', { class: 'muted' }, 'La casa gana esta vez.'));
        sfx(g.paid ? (g.hands.some((x) => x.result === 'blackjack') ? 'big' : 'win') : 'lose');
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
      try { const r = await emit('bj:deal', { bet: bet.value }); sfx('flip'); render(r.game, true); } catch (e) { toast(e.message, 'error'); sfx('error'); }
    }
    async function play(action) {
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

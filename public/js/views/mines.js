import { h, fmt, emit, sfx, toast, betInput, item, sprite } from '../core.js';

export default {
  id: 'mines', title: 'Minas Geodude', icon: '💣',
  async mount(root) {
    const bet = betInput(100, 'mines');
    const minesSel = h('select', {}, [1, 2, 3, 5, 8, 10, 15, 20, 24].map((n) => h('option', { value: n, selected: n === 3 }, `${n} Geodude`)));
    const grid = h('div', { class: 'mines-grid' });
    const info = h('div', { class: 'table-msg' }, 'Elige cuántos Geodude esconder y empieza.');
    const startBtn = h('button', { class: 'btn primary big', onclick: start }, 'Empezar');
    const cashBtn = h('button', { class: 'btn gold big hidden', onclick: cashout }, 'Retirarse');
    let game = null;

    function render(boom) {
      const g = game;
      grid.replaceChildren(...Array.from({ length: 25 }, (_, i) => {
        const open = g && g.revealed.includes(i);
        const mine = g && g.board && g.board[i] === 1;
        const shown = open || (g && g.board);
        return h('button', {
          class: 'mine-cell' + (open ? ' safe' : '') + (g && g.board && mine ? ' mine' : '') + (boom === i ? ' boom' : '') + (shown && !open && !mine ? ' dim' : ''),
          disabled: !g || g.done || open, onclick: () => pick(i),
        }, shown ? h('img', { class: 'pixel', src: mine ? sprite(74) : item('star-piece'), alt: '' }) : '');
      }));
      const playing = g && !g.done;
      startBtn.classList.toggle('hidden', !!playing);
      bet.el.classList.toggle('hidden', !!playing);
      minesSel.disabled = !!playing;
      cashBtn.classList.toggle('hidden', !playing || !g.revealed.length);
      if (playing) {
        cashBtn.textContent = `Retirarse · ${fmt(g.bet * g.mult)}`;
        info.replaceChildren(`Multiplicador actual `, h('b', { class: 'good' }, '×' + g.mult), ` · siguiente acierto `, h('b', {}, '×' + g.next));
      }
    }
    async function start() {
      try { const r = await emit('mines:start', { bet: bet.value, mines: Number(minesSel.value) }); game = r.game; sfx('click'); render(); } catch (e) { toast(e.message, 'error'); sfx('error'); }
    }
    async function pick(i) {
      try {
        const r = await emit('mines:pick', { index: i });
        game = r.game;
        if (r.boom !== undefined) { sfx('boom'); grid.classList.add('shake'); setTimeout(() => grid.classList.remove('shake'), 600); info.replaceChildren(h('b', { class: 'bad' }, '💥 ¡Un Geodude! Pierdes la apuesta.')); render(r.boom); return; }
        if (r.paid) return finish(r);
        sfx('flip'); render();
      } catch (e) { toast(e.message, 'error'); }
    }
    async function cashout() {
      try { finish(await emit('mines:cashout')); } catch (e) { toast(e.message, 'error'); }
    }
    function finish(r) {
      game = r.game;
      sfx('win');
      info.replaceChildren(h('b', { class: 'good' }, `💰 ×${r.mult} · +${fmt(r.paid)} monedas`));
      render();
    }
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '💣 Minas Geodude'), h('p', { class: 'muted' }, 'Descubre Trozos Estrella sin despertar a ningún Geodude. Más Geodude = más multiplicador.')),
      h('div', { class: 'vf-layout' },
        h('div', { class: 'mines-board' }, grid),
        h('div', { class: 'stack' }, info, h('div', { class: 'card stack' }, bet.el, h('label', {}, 'Geodude escondidos', minesSel), h('div', { class: 'row gap' }, startBtn, cashBtn)))));
    try { game = (await emit('mines:state')).game; } catch { /* sin partida */ }
    render();
  },
};

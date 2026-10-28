import { S, h, fmt, emit, act, sfx, toast, sprite, betInput, confirmBet } from '../core.js';
import { winFx, burstEl, flash, shake, vibrate, confetti } from '../fx.js';

export default {
  id: 'voltorb', title: 'Voltorb Flip', icon: '⚡',
  async mount(root) {
    const bet = betInput(100, 'voltorb');
    const memo = new Map(); // índice -> Set de notas
    let memoMode = null; // nota activa ('0'..'3') o null
    let state = null;
    const grid = h('div', { class: 'vf-grid' });
    const info = h('div', { class: 'vf-info' });
    const msg = h('div', { class: 'vf-msg' }, 'Gira cartas: ×1, ×2, ×3… ¡pero cuidado con Voltorb!');
    const startBtn = h('button', { class: 'btn primary big', onclick: async (e) => { if (!(await confirmBet('voltorb', bet.value))) return; const r = await act('voltorb:start', { bet: bet.value }, e.target); if (r) { memo.clear(); sfx('click'); render(r); } } }, 'Nueva partida');
    const cashBtn = h('button', { class: 'btn big gold', onclick: async (e) => { const r = await act('voltorb:cashout', {}, e.target); if (r) end(r); } }, 'Retirarse');
    const noteBtns = ['0', '1', '2', '3'].map((n) => h('button', { class: 'chip note-btn n' + n, title: 'Marcar notas', onclick: () => {
      memoMode = memoMode === n ? null : n;
      noteBtns.forEach((b, k) => b.classList.toggle('active', String(k) === memoMode));
    } }, n === '0' ? '●' : n));
    const memoBtn = h('div', { class: 'row gap memo' }, h('span', { class: 'muted small' }, '✎ Notas:'), noteBtns);

    function render(s, reveal) {
      state = s;
      const g = s.game;
      info.replaceChildren(
        h('div', { class: 'stat' }, h('span', { class: 'muted small' }, 'Nivel'), h('b', {}, g ? g.level : s.level)),
        h('div', { class: 'stat' }, h('span', { class: 'muted small' }, 'Puntos'), h('b', {}, g ? g.score : 0)),
        h('div', { class: 'stat' }, h('span', { class: 'muted small' }, 'Cobrarías'), h('b', { class: 'good' }, g ? fmt(g.cashout) : 0)),
        h('div', { class: 'stat' }, h('span', { class: 'muted small' }, 'Apuesta'), h('b', {}, g ? fmt(g.bet) : '—')));
      startBtn.classList.toggle('hidden', !!g && !reveal);
      bet.el.classList.toggle('hidden', !!g && !reveal);
      cashBtn.classList.toggle('hidden', !g || reveal || g.score === 0);
      memoBtn.classList.toggle('hidden', !g || reveal);
      if (!g) { grid.replaceChildren(...Array.from({ length: 36 }, (_, i) => (i % 6 === 5 || i >= 30) ? h('div', { class: 'vf-hint empty' }) : h('div', { class: 'vf-card back' }))); return; }
      const cells = [];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          const i = r * 5 + c;
          const v = g.cells[i];
          const notes = memo.get(i) || new Set();
          cells.push(h('button', {
            class: 'vf-card ' + (v === null ? 'back' : v === 0 ? 'volt' : 'v' + v),
            disabled: v !== null || reveal,
            onclick: () => onCell(i),
          }, v === null
            ? h('span', { class: 'notes' }, ['0', '1', '2', '3'].map((n) => h('i', { class: notes.has(n) ? 'on n' + n : 'n' + n }, n === '0' ? '●' : n)))
            : v === 0 ? h('img', { class: 'pixel', src: sprite(100), alt: 'Voltorb' }) : h('b', {}, v)));
        }
        const hr = g.hints.rows[r];
        cells.push(hint(hr, r));
      }
      g.hints.cols.forEach((hc, c) => cells.push(hint(hc, c)));
      cells.push(h('div', { class: 'vf-hint empty' }));
      grid.replaceChildren(...cells);
    }
    const hint = (x, k) => h('div', { class: 'vf-hint c' + k }, h('b', {}, String(x.sum).padStart(2, '0')), h('span', {}, h('img', { class: 'pixel', src: sprite(100), alt: '' }), x.volt));

    async function onCell(i) {
      if (memoMode) {
        const set = memo.get(i) || new Set();
        if (set.has(memoMode)) set.delete(memoMode); else set.add(memoMode);
        memo.set(i, set);
        sfx('click');
        render(state);
        return;
      }
      let r;
      try { r = await emit('voltorb:flip', { index: i }); } catch (e) { toast(e.message, 'error'); return; }
      if (r.outcome) return end(r, i);
      sfx('flip');
      render(r);
      const cell = cellEl(i);
      const v = r.game.cells[i];
      // Los ×2 y ×3 brillan más: lo bueno se siente.
      if (cell && v > 1) { burstEl(cell, v === 3 ? '#fb923c' : '#60a5fa', 10 + v * 6, { spread: 100, stars: 0.8 }); sfx('star', v); vibrate(v === 3 ? [20, 20, 30] : 15); }
      else if (cell) burstEl(cell, '#ffffff', 5, { spread: 50, stars: 0 });
    }

    // La cuadrícula intercala una pista tras cada fila: la carta i está en la posición fila*6 + columna.
    const cellEl = (i) => grid.children[Math.floor(i / 5) * 6 + (i % 5)];
    function end(r, i) {
      const stake = state && state.game ? state.game.bet : 0;
      render(r, true);
      startBtn.classList.remove('hidden');
      bet.el.classList.remove('hidden');
      if (r.outcome === 'boom') {
        sfx('boom'); grid.classList.add('shake'); setTimeout(() => grid.classList.remove('shake'), 600);
        flash('#ff4d4d', 420); shake(); vibrate([80, 40, 140]);
        if (i !== undefined && cellEl(i)) burstEl(cellEl(i), '#f97316', 30, { spread: 190, stars: 0.1 });
        msg.replaceChildren(h('b', { class: 'bad' }, '💥 ¡Voltorb explotó! '), `Pierdes la apuesta. Nivel → ${r.newLevel}.`);
      } else if (r.outcome === 'clear') {
        sfx('big'); msg.replaceChildren(h('b', { class: 'good' }, `🏆 ¡Tablero completo! +${fmt(r.paid)} `), `Subes a nivel ${r.newLevel}.`);
        confetti({ count: 45 }); winFx(r.paid, stake, { el: grid, title: '¡TABLERO COMPLETO!', icon: '⚡' });
      } else {
        sfx('win'); msg.replaceChildren(h('b', { class: 'good' }, `💰 Te retiras con ${fmt(r.paid)} monedas.`));
        winFx(r.paid, stake, { el: grid, icon: '⚡' });
      }
    }

    const mults = S.data.voltorbDivisors.map((d, i) => `Nv${i + 1}: ÷${d}`).join(' · ');
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '⚡ Voltorb Flip'), h('p', { class: 'muted' }, 'Los números de cada fila/columna indican la suma de puntos y cuántos Voltorb esconde.')),
      h('div', { class: 'vf-layout' },
        h('div', { class: 'vf-board' }, grid),
        h('div', { class: 'stack' },
          info, msg,
          h('div', { class: 'card stack' }, bet.el, h('div', { class: 'row gap wrap' }, startBtn, cashBtn, memoBtn)),
          h('details', { class: 'card rules' }, h('summary', {}, h('b', {}, 'Cómo se paga')),
            h('p', { class: 'small' }, 'Tus puntos se multiplican con cada carta (×2, ×3). Al retirarte o limpiar todos los ×2 y ×3 cobras: apuesta × puntos ÷ divisor del nivel.'),
            h('p', { class: 'muted small' }, mults),
            h('p', { class: 'muted small' }, 'Limpiar el tablero sube un nivel. Si explota un Voltorb bajas al nº de cartas que giraste.')))));
    try { render(await emit('voltorb:state')); } catch (e) { toast(e.message, 'error'); }
  },
};

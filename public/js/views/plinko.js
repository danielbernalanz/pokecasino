import { S, h, fmt, emit, sfx, toast, betInput, item, confirmBet } from '../core.js';
import { winFx, burstAt, burstEl, glow, vibrate } from '../fx.js';

const RISK = { low: 'Bajo', medium: 'Medio', high: 'Alto' };
let risk = 'medium';

export default {
  id: 'plinko', title: 'Plinko', icon: '🔻',
  mount(root) {
    const rows = S.data.plinko.rows;
    const bet = betInput(100, 'plinko');
    const board = h('div', { class: 'plinko-board' });
    const buckets = h('div', { class: 'plinko-buckets' });
    const last = h('div', { class: 'plinko-last' });
    // Coordenadas en % del tablero.
    const X = (pos, row) => 50 + (pos - row / 2) * (100 / (rows + 2));
    const Y = (row) => 6 + row * (84 / rows);

    function draw() {
      board.querySelectorAll('.peg').forEach((p) => p.remove());
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k <= r + 1; k++) {
          board.append(h('i', { class: 'peg', style: { left: X(k - 0.5, r) + '%', top: Y(r) + 2 + '%' } }));
        }
      }
      buckets.replaceChildren(...S.data.plinko.tables[risk].map((m, k) => h('div', { class: 'bucket ' + (m >= 10 ? 'hot' : m >= 2 ? 'warm' : m >= 1 ? 'ok' : 'cold'), 'data-k': k }, '×' + m)));
    }

    async function drop() {
      const stake = bet.value;
      if (!(await confirmBet('plinko', stake, { what: 'soltar una bola con' }))) return;
      let r;
      try { r = await emit('plinko:drop', { bet: bet.value, risk }); } catch (e) { toast(e.message, 'error'); sfx('error'); return; }
      const ball = h('img', { class: 'pixel plinko-ball', src: item('poke-ball'), alt: '' });
      board.append(ball);
      const frames = [{ left: X(0, 0) + '%', top: '0%' }];
      let pos = 0;
      r.path.forEach((step, row) => { pos += step; frames.push({ left: X(pos, row + 1) + '%', top: Y(row + 1) - 2 + '%' }); });
      frames.push({ left: X(r.bucket, rows) + '%', top: '96%' });
      const anim = ball.animate(frames, { duration: 1700, easing: 'cubic-bezier(.4,0,.8,1)' });
      const tick = setInterval(() => sfx('tick'), 140);
      // Chispas cada vez que la bola pasa una fila de clavos.
      let row = -1;
      let raf = requestAnimationFrame(function watch() {
        if (!ball.isConnected) return;
        const br = board.getBoundingClientRect();
        const bb = ball.getBoundingClientRect();
        const k = Math.floor((((bb.top + bb.height / 2 - br.top) / br.height) * 100 - 6) / (84 / rows));
        if (k > row && k >= 0 && k < rows) { row = k; burstAt(bb.left + bb.width / 2, bb.top + bb.height, '#ffffffcc', 4, { spread: 36, stars: 0 }); }
        raf = requestAnimationFrame(watch);
      });
      anim.onfinish = () => {
        clearInterval(tick);
        cancelAnimationFrame(raf);
        ball.remove();
        const b = buckets.children[r.bucket];
        b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
        last.prepend(h('span', { class: 'chip ' + (r.mult >= 1 ? 'good' : 'bad') }, `×${r.mult}${r.paid ? ' · +' + fmt(r.paid) : ''}`));
        while (last.children.length > 8) last.lastChild.remove();
        sfx(r.mult >= 10 ? 'big' : r.mult >= 1 ? 'win' : 'flip');
        if (r.mult >= 1) {
          glow(b, r.mult >= 10 ? '#ef4444' : '#facc15', 1000);
          burstEl(b, r.mult >= 10 ? '#ef4444' : '#facc15', r.mult >= 10 ? 26 : 12, { spread: r.mult >= 10 ? 220 : 110 });
          if (r.mult >= 10) vibrate([30, 30, 60]);
        }
        if (r.paid) winFx(r.paid, stake, { el: b, icon: '🔻' });
      };
    }

    const riskBtns = Object.entries(RISK).map(([k, l]) => h('button', { class: 'chip' + (k === risk ? ' active' : ''), onclick: (e) => { risk = k; riskBtns.forEach((b) => b.classList.toggle('active', b === e.currentTarget)); draw(); } }, l));
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🔻 Plinko de Poké Balls'), h('p', { class: 'muted' }, 'Suelta Poké Balls y mira dónde caen. Puedes lanzar varias a la vez.')),
      h('div', { class: 'plinko-layout' },
        h('div', { class: 'plinko-wrap' }, board, buckets),
        h('div', { class: 'card stack' }, bet.el, h('div', {}, h('div', { class: 'muted small' }, 'Riesgo'), h('div', { class: 'row gap' }, riskBtns)),
          h('button', { class: 'btn primary huge', onclick: drop }, 'SOLTAR'), last)));
    draw();
  },
};

import { S, h, fmt, act, sfx, bus, betInput, sprite, confirmBet, confirmRisk } from '../core.js';
import { winFx, burstEl, flash, shake, pop, vibrate } from '../fx.js';

export default {
  id: 'crash', title: 'Crash Rocket', icon: '🚀',
  mount(root) {
    const bet = betInput(100, 'crash');
    const auto = h('input', { type: 'number', min: 1.01, step: 0.01, placeholder: 'p. ej. 2.00', class: 'bet-input' });
    const canvas = h('canvas', { class: 'crash-canvas', width: 900, height: 420 });
    const big = h('div', { class: 'crash-mult' }, '×1.00');
    const status = h('div', { class: 'crash-status' });
    const rocket = h('img', { class: 'pixel crash-rocket', src: sprite(52), alt: 'Meowth' });
    const players = h('div', { class: 'crash-players' });
    const hist = h('div', { class: 'crash-hist' });
    const mainBtn = h('button', { class: 'btn primary huge', onclick: onMain }, 'APOSTAR');
    const ctx = canvas.getContext('2d');
    const G = S.data.crashGrowth;
    let st = null;
    let offset = 0;
    let raf = null;
    let milestone = 1;

    const mult = (ms) => Math.floor(Math.exp(G * (ms / 1000)) * 100) / 100;
    const mine = () => st && st.players.find((p) => p.username === S.me.username);

    async function onMain() {
      if (!st) return;
      if (st.phase === 'betting') {
        if (!(await confirmBet('crash', bet.value))) return;
        const au = auto.value ? Number(auto.value) : null;
        if (!au || au >= 10) {
          const pr = (x) => { const p = 97 / x; return p >= 10 ? Math.round(p) : p.toFixed(1).replace('.', ','); };
          const text = au
            ? `Tu retiro automático está en ×${au}. Con la ventaja de la casa (3 %), la probabilidad de llegar a ×${au} es de ~${pr(au)} %: solo ~${pr(au)} de cada 100 rondas llegan tan lejos, y en el resto pierdes la apuesta.`
            : `No has puesto retiro automático: dependes de pulsar «Retirar» a tiempo y el cohete puede explotar en cualquier momento (la mitad de las rondas acaban antes de ×2). Para llegar a ×10 solo ~10 de cada 100 rondas lo consiguen.`;
          if (!(await confirmRisk('crash-risky', { title: au ? 'Retiro automático muy alto' : 'Sin retiro automático', text, danger: 'Apostar igualmente', safe: 'Cancelar' }))) return;
        }
        if (st.phase !== 'betting') return;
        const r = await act('crash:bet', { amount: bet.value, auto: au }, mainBtn);
        if (r) sfx('click');
      } else if (st.phase === 'flying') {
        const r = await act('crash:cashout', {}, mainBtn);
        if (r) sfx('win');
      }
    }

    function drawGraph(ms, m, crashed) {
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const tMax = Math.max(10, ms / 1000 * 1.15);
      const mMax = Math.max(2, m * 1.2);
      const px = (t) => 40 + (t / tMax) * (W - 60);
      const py = (v) => H - 30 - ((v - 1) / (mMax - 1)) * (H - 60);
      ctx.strokeStyle = '#ffffff18';
      ctx.fillStyle = '#a49cc9';
      ctx.font = '14px Nunito';
      for (let k = 1; k <= 4; k++) {
        const v = 1 + ((mMax - 1) * k) / 4;
        ctx.beginPath(); ctx.moveTo(40, py(v)); ctx.lineTo(W, py(v)); ctx.stroke();
        ctx.fillText('×' + v.toFixed(2), 2, py(v) + 4);
      }
      ctx.beginPath();
      ctx.moveTo(px(0), py(1));
      const steps = 80;
      for (let k = 1; k <= steps; k++) { const t = (ms / 1000) * (k / steps); ctx.lineTo(px(t), py(Math.exp(G * t))); }
      ctx.strokeStyle = crashed ? '#ff4d6d' : '#ffcb05';
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.lineTo(px(ms / 1000), py(1));
      ctx.closePath();
      ctx.fillStyle = crashed ? '#ff4d6d22' : '#ffcb0522';
      ctx.fill();
      const x = px(ms / 1000) / W * 100;
      const y = py(Math.min(m, mMax)) / H * 100;
      rocket.style.left = `calc(${x}% - 30px)`;
      rocket.style.top = `calc(${y}% - 50px)`;
    }

    function loop() {
      cancelAnimationFrame(raf);
      if (!st) return;
      const now = Date.now() + offset;
      if (st.phase === 'betting') {
        drawGraph(0, 1, false);
        big.textContent = `${Math.max(0, (st.startsAt - now) / 1000).toFixed(1)} s`;
        big.className = 'crash-mult wait';
      } else if (st.phase === 'flying') {
        const ms = now - st.flyAt;
        const m = mult(ms);
        drawGraph(ms, m, false);
        big.textContent = '×' + m.toFixed(2);
        big.className = 'crash-mult fly' + (m >= 10 ? ' x10' : m >= 5 ? ' x5' : m >= 2 ? ' x2' : '');
        // Al cruzar ×2, ×5, ×10… el número rebota y suena una subida de tensión.
        const ms2 = m >= 10 ? 10 : m >= 5 ? 5 : m >= 2 ? 2 : 1;
        if (ms2 > milestone) { milestone = ms2; pop(big, 1.3); sfx('upgrade', ms2 >= 10 ? 2 : 0); if (mine() && !mine().cashedAt) vibrate(ms2 >= 10 ? [30, 30, 30] : 20); }
        const b = mine();
        if (b && !b.cashedAt) mainBtn.textContent = `RETIRAR ${fmt(b.amount * m)}`;
      } else {
        const ms = Math.log(st.crash) / G * 1000;
        drawGraph(ms, st.crash, true);
        big.textContent = '×' + st.crash.toFixed(2);
        big.className = 'crash-mult boom';
      }
      raf = requestAnimationFrame(loop);
    }

    function onState(s) {
      if (!s) return;
      const prevPhase = st && st.phase;
      st = s;
      offset = s.now - Date.now();
      rocket.classList.toggle('gone', s.phase === 'crashed');
      if (s.phase === 'betting') milestone = 1;
      if (s.phase === 'crashed' && prevPhase === 'flying') {
        const lost = mine() && !mine().cashedAt;
        sfx(lost ? 'boom' : 'flip');
        burstEl(rocket, lost ? '#ff4d6d' : '#ffffff88', lost ? 26 : 10, { spread: lost ? 180 : 100, stars: 0.1 });
        if (lost) { flash('#ff4d6d', 350); shake(canvas.parentElement, 400); vibrate([60, 40, 120]); }
      }
      status.textContent = s.phase === 'betting' ? 'Apuestas abiertas: ¡prepárate para el despegue!' : s.phase === 'flying' ? '¡Despegando!' : '¡El Team Rocket sale volando otra vez! 💥';
      const b = mine();
      if (s.phase === 'betting') { mainBtn.disabled = !!b; mainBtn.textContent = b ? 'APOSTADO ✓' : 'APOSTAR'; }
      else if (s.phase === 'flying') { mainBtn.disabled = !b || !!b.cashedAt; if (!b) mainBtn.textContent = 'ESPERA A LA SIGUIENTE'; else if (b.cashedAt) mainBtn.textContent = `RETIRADO ×${b.cashedAt}`; }
      else { mainBtn.disabled = true; mainBtn.textContent = 'NUEVA RONDA…'; }
      players.replaceChildren(...s.players.map((p) => h('div', { class: 'crash-player' + (p.cashedAt ? ' out' : '') + (s.phase === 'crashed' && !p.cashedAt ? ' lost' : '') },
        h('b', {}, p.username), h('span', {}, fmt(p.amount)), h('span', {}, p.cashedAt ? `×${p.cashedAt} · +${fmt(p.paid)}` : p.auto ? `auto ×${p.auto}` : '…'))));
      hist.replaceChildren(...s.history.map((x) => h('span', { class: 'chip ' + (x >= 2 ? 'good' : 'bad') }, '×' + x.toFixed(2))));
      loop();
    }

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🚀 Crash: ¡Team Rocket!'), hist),
      h('div', { class: 'crash-layout' },
        h('div', { class: 'crash-stage' }, canvas, rocket, big, status),
        h('div', { class: 'stack' },
          h('div', { class: 'card stack' }, bet.el, h('label', {}, 'Retiro automático (opcional)', auto), mainBtn,
            h('p', { class: 'muted small' }, 'Todos juegan la misma ronda. Retírate antes de que Meowth salga volando. Devuelve de media el 97 % en cualquier punto.')),
          h('div', { class: 'card' }, h('h3', {}, 'Entrenadores en esta ronda'), players))));
    this.offs = [bus.on('crash', onState), bus.on('crash:result', (r) => { if (r.paid) { sfx('win'); winFx(r.paid, r.at ? r.paid / r.at : 0, { el: big, icon: '🚀' }); } })];
    if (S.crash) onState(S.crash);
    this.stop = () => cancelAnimationFrame(raf);
  },
  unmount() { this.offs.forEach((f) => f()); this.stop(); },
};

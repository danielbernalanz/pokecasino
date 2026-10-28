import { S, h, fmt, act, sfx, bus, animImg, betInput } from '../core.js';
import { winFx, burstEl, confetti, flash } from '../fx.js';

export default {
  id: 'race', title: 'Gran Carrera', icon: '🏁',
  mount(root) {
    const bet = betInput(100, 'race');
    const timer = h('div', { class: 'race-timer' });
    const banner = h('div', { class: 'race-banner' });
    const track = h('div', { class: 'track' });
    const runnersBox = h('div', { class: 'runners' });
    const myBox = h('div', { class: 'my-bets' });
    let lanes = [];
    let raf = null;
    let offset = 0;
    let round = null;
    const celebrated = new Set();

    function build(r) {
      round = r.round;
      lanes = r.runners.map((x) => {
        const sprite = animImg(x.id, false, 'runner-sprite');
        const el = h('div', { class: 'lane' }, h('span', { class: 'lane-no' }, x.lane + 1), h('div', { class: 'runner' }, sprite), h('div', { class: 'finish-line' }));
        return { el, runner: el.querySelector('.runner') };
      });
      track.replaceChildren(...lanes.map((l) => l.el));
    }

    function renderRunners(r) {
      const mine = S.raceBets || [];
      runnersBox.replaceChildren(...r.runners.map((x) => {
        const p = S.dexById.get(x.id);
        const myAmt = mine.filter((b) => b.lane === x.lane).reduce((s, b) => s + b.amount, 0);
        const winner = r.phase === 'results' && r.result.order[0] === x.lane;
        return h('div', { class: 'runner-card' + (winner ? ' winner' : '') },
          animImg(x.id, false, 'rc-sprite'),
          h('div', { class: 'grow' }, h('b', {}, `${x.lane + 1}. ${p.name}`), h('div', { class: 'muted small' }, `Velocidad ${x.spe} · Bote ${fmt(r.pools[x.lane])}`),
            myAmt ? h('div', { class: 'small good' }, `Tu apuesta: ${fmt(myAmt)}`) : null),
          h('div', { class: 'odds' }, '×' + x.odds),
          h('button', { class: 'btn primary', disabled: r.phase !== 'betting', onclick: async (e) => {
            const res = await act('race:bet', { lane: x.lane, amount: bet.value }, e.target);
            if (res) { S.raceBets = res.myBets; sfx('click'); renderRunners(S.race); }
          } }, 'Apostar'));
      }));
      myBox.textContent = mine.length ? `Apuestas en esta carrera: ${fmt(mine.reduce((s, b) => s + b.amount, 0))} monedas` : '';
    }

    function animate() {
      cancelAnimationFrame(raf);
      const r = S.race;
      if (!r) return;
      const now = Date.now() + offset;
      if (r.phase === 'betting') {
        lanes.forEach((l) => { l.runner.style.left = '0%'; });
      } else {
        const start = r.phase === 'racing' ? r.endsAt - 11000 : 0;
        const t = r.phase === 'racing' ? (now - start) / 1000 : 99;
        lanes.forEach((l, lane) => {
          const fin = r.result.finish[lane];
          const base = Math.min(1, Math.max(0, t / fin));
          const wob = 0.05 * Math.sin(t * 2.1 + lane * 1.9 + (r.result.seed % 7)) * Math.sin(Math.PI * base);
          l.runner.style.left = `calc(${Math.min(1, Math.max(0, base + wob)) * 100}% - ${Math.min(1, base) * 56}px)`;
          l.el.classList.toggle('done', base >= 1);
        });
      }
      const left = Math.max(0, Math.ceil((r.endsAt - now) / 1000));
      timer.textContent = r.phase === 'betting' ? `Apuestas abiertas · ${left}s` : r.phase === 'racing' ? '¡Carrera en curso!' : `Siguiente carrera en ${left}s`;
      raf = requestAnimationFrame(animate);
    }

    function onState(r) {
      if (!r) return;
      offset = r.now - Date.now();
      if (r.round !== round) build(r);
      if (r.phase === 'racing') { banner.textContent = '🏁 ¡Arrancan!'; sfx('click'); }
      if (r.phase === 'results') {
        const w = r.runners[r.result.order[0]];
        banner.replaceChildren('🏆 Ganador: ', h('b', {}, S.dexById.get(w.id).name), ` (×${w.odds})`);
        // El ganador celebra en la meta; un favorito que sorprende (cuota alta) se nota más.
        const lane = lanes[r.result.order[0]];
        if (lane && !celebrated.has(r.round)) {
          celebrated.add(r.round);
          burstEl(lane.runner, '#ffd54f', w.odds >= 6 ? 40 : 22, { spread: 200, stars: 0.7 });
          if (w.odds >= 6) flash('#ffe08a', 400);
        }
      }
      if (r.phase === 'betting') banner.textContent = `Carrera #${r.round} · ${r.bettors} entrenador(es) apostando`;
      renderRunners(r);
      animate();
    }

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🏁 Gran Carrera Pokémon'), timer),
      banner,
      h('div', { class: 'track-wrap' }, track),
      h('div', { class: 'race-layout' },
        h('div', { class: 'card stack' }, bet.el, myBox,
          h('p', { class: 'muted small' }, 'Todos los jugadores ven la misma carrera. Las cuotas dependen de la velocidad: los lentos pagan mucho… si ocurre el milagro.')),
        runnersBox));
    this.offs = [
      bus.on('race', onState),
      bus.on('race:payout', (p) => {
        if (p.paid) { sfx('big'); banner.append(h('div', { class: 'good' }, `¡Ganaste ${fmt(p.paid)} monedas!`)); confetti({ count: 36 }); winFx(p.paid, p.stake, { el: banner, icon: '🏁' }); } else if (p.stake) sfx('lose');
      }),
    ];
    if (S.race) onState(S.race);
    this.stop = () => cancelAnimationFrame(raf);
  },
  unmount() { this.offs.forEach((f) => f()); this.stop(); },
};

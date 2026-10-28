import { S, h, fmt, emit, sfx, toast, bus, item, sprite, betInput, sleep } from '../core.js';
import { winFx, burstEl, glow, vibrate } from '../fx.js';

const ICON = {
  berry: item('oran-berry'), poke: item('poke-ball'), great: item('great-ball'), ultra: item('ultra-ball'),
  pika: sprite(25), ditto: sprite(132), master: item('master-ball'),
};
const NAMES = { berry: 'Baya Aranja', poke: 'Poké Ball', great: 'Super Ball', ultra: 'Ultra Ball', pika: 'Pikachu', ditto: 'Ditto (comodín)', master: 'Master Ball' };
const symImg = (s) => h('img', { class: 'pixel sym sym-' + s, src: ICON[s], alt: NAMES[s] });

export default {
  id: 'slots', title: 'Pika-Slots', icon: '🎰',
  mount(root) {
    const reels = S.data.slots.reels;
    const bet = betInput(100, 'slots');
    let spinning = false;
    let auto = false;
    const reelEls = [0, 1, 2].map(() => h('div', { class: 'reel' }, h('div', { class: 'reel-strip' })));
    const lineSvg = h('div', { class: 'lines' });
    const winBox = h('div', { class: 'slot-win' }, '¡Tira de la palanca!');
    const jack = h('b', {}, fmt(S.jackpot));
    const setGrid = (g) => reelEls.forEach((r, i) => r.firstChild.replaceChildren(...g[i].map(symImg)));
    setGrid(reels.map((r) => [r[0], r[1], r[2]]));

    const spinBtn = h('button', { class: 'btn primary huge', onclick: () => spin() }, 'GIRAR');
    const autoBtn = h('button', { class: 'btn', onclick: () => { auto = !auto; autoBtn.classList.toggle('active', auto); if (auto && !spinning) spin(); } }, 'Auto');

    async function spin() {
      if (spinning) return;
      spinning = true;
      spinBtn.disabled = true;
      lineSvg.replaceChildren();
      winBox.textContent = '…';
      winBox.className = 'slot-win';
      sfx('click');
      const stake = bet.value;
      // Animación: cada rodillo gira con símbolos aleatorios.
      const timers = reelEls.map((r, i) => {
        r.classList.add('spinning');
        return setInterval(() => {
          const strip = reels[i];
          const k = Math.floor(Math.random() * strip.length);
          r.firstChild.replaceChildren(...[0, 1, 2].map((d) => symImg(strip[(k + d) % strip.length])));
          sfx('tick');
        }, 70);
      });
      let res;
      try { res = await emit('slots:spin', { bet: bet.value }); } catch (e) {
        timers.forEach(clearInterval); reelEls.forEach((r) => r.classList.remove('spinning'));
        toast(e.message, 'error'); sfx('error'); spinning = false; spinBtn.disabled = false; auto = false; autoBtn.classList.remove('active'); return;
      }
      // ¿Los dos primeros rodillos ya forman pareja en alguna línea? Entonces el último frena con suspense.
      const pair = (a, b) => a === 'ditto' || b === 'ditto' || a === b;
      const near = S.data.slots.lines.some((ln) => {
        const a = res.grid[0][ln[0][1]];
        const b = res.grid[1][ln[1][1]];
        return pair(a, b) && !(a === 'berry' && b === 'berry') && (a !== 'ditto' || b !== 'ditto');
      });
      for (let i = 0; i < 3; i++) {
        if (i === 2 && near) {
          reelEls[2].classList.add('tense');
          sfx('charge', 0); vibrate([30, 40, 30]);
          // El último rodillo gira cada vez más despacio, con tics más graves.
          clearInterval(timers[2]);
          for (const d of [110, 150, 210, 290, 400]) {
            const strip = reels[2];
            const k = Math.floor(Math.random() * strip.length);
            reelEls[2].firstChild.replaceChildren(...[0, 1, 2].map((r) => symImg(strip[(k + r) % strip.length])));
            sfx('tick'); await sleep(d);
          }
          reelEls[2].classList.remove('tense');
        } else await sleep(300 + i * 250);
        clearInterval(timers[i]);
        reelEls[i].classList.remove('spinning');
        reelEls[i].firstChild.replaceChildren(...res.grid[i].map(symImg));
        sfx('flip');
        if (i < 2) glow(reelEls[i], '#ffffff', 350);
      }
      for (const w of res.wins) {
        lineSvg.append(h('div', { class: 'payline pl-' + w.line }));
        S.data.slots.lines[w.line].forEach(([r, row]) => {
          const cell = reelEls[r].firstChild.children[row];
          cell.classList.add('hit');
          if (res.paid > 0) burstEl(cell, '#ffd54f', 6, { spread: 70, stars: 0.6 });
        });
      }
      if (res.paid > 0) winFx(res.paid, stake, { el: winBox, jackpot: res.jackpotWon > 0, title: res.jackpotWon ? '¡BOTE!' : '¡GRAN PREMIO!', icon: res.jackpotWon ? '💥' : '🎰' });
      else if (near) sfx('lose');
      if (res.jackpotWon) {
        winBox.textContent = `💥 ¡BOTE! +${fmt(res.paid)}`; winBox.className = 'slot-win jackpot'; sfx('big');
      } else if (res.paid > 0) {
        const big = res.paid >= stake * 10;
        winBox.textContent = `${big ? '¡GRAN PREMIO! ' : ''}+${fmt(res.paid)}${res.bonus ? ` (compañero +${fmt(res.bonus)})` : ''}`;
        winBox.className = 'slot-win ' + (big ? 'big' : 'ok'); sfx(big ? 'big' : 'win');
      } else { winBox.textContent = 'Sin premio. ¡Otra vez!'; }
      spinning = false;
      spinBtn.disabled = false;
      if (auto) { await sleep(700); if (auto && document.contains(spinBtn)) spin(); }
    }

    const payRows = Object.entries(S.data.slots.symbols).reverse().map(([k, v]) => h('div', { class: 'pay-row' },
      symImg(k), symImg(k), symImg(k), h('b', {}, `×${v.pay}`), v.two ? h('span', { class: 'muted small' }, ` (2 seguidas ×${v.two})`) : null));

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🎰 Pika-Slots'), h('div', { class: 'jackpot-big' }, 'BOTE PROGRESIVO ', jack)),
      h('div', { class: 'slots-layout' },
        h('div', { class: 'machine' },
          h('div', { class: 'machine-top' }, h('img', { class: 'pixel', src: sprite(25), alt: '' }), 'PIKA·SLOTS', h('img', { class: 'pixel', src: sprite(132), alt: '' })),
          h('div', { class: 'reels' }, reelEls, lineSvg),
          winBox,
          h('div', { class: 'machine-controls' }, bet.el, h('div', { class: 'row gap' }, autoBtn, spinBtn))),
        h('div', { class: 'card paytable' },
          h('h3', {}, 'Tabla de premios'),
          h('p', { class: 'muted small' }, 'Pagos por línea (apuesta ÷ 5). 5 líneas: 3 horizontales y 2 diagonales. Ditto sustituye a todo menos a la Master Ball. Tres Master Ball en la línea central ganan el BOTE completo; el 2 % de cada apuesta lo alimenta.'),
          payRows)),
    );
    this.offs = [bus.on('jackpot', (j) => { jack.textContent = fmt(j); })];
    this.stop = () => { auto = false; };
  },
  unmount() { this.offs.forEach((f) => f()); this.stop(); },
};

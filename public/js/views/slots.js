import { S, h, fmt, emit, sfx, toast, bus, item, sprite, betInput, sleep, confirmBet, confirmRisk, holdCoins, releaseCoins } from '../core.js';
import { winFx, burstEl, glow, vibrate } from '../fx.js';
import { speedToggle, hotkey, wait, tw } from '../gamekit.js';

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
    const autoBtn = h('button', { class: 'btn', type: 'button', title: 'Tira sin parar hasta que lo pares o te quedes sin saldo', onclick: () => toggleAuto() }, 'Auto');
    const setAuto = (on) => { auto = on; autoBtn.classList.toggle('active', on); autoBtn.textContent = on ? '■ Parar' : 'Auto'; };

    async function toggleAuto() {
      if (auto) { setAuto(false); return; }
      if (spinning) return;
      // Modo Auto: se asume una serie de 10 tiradas para estimar el riesgo.
      const total = bet.value * 10;
      if (total >= S.me.coins * 0.5) {
        const ok = await confirmRisk('auto-series:slots', {
          title: 'Modo Auto con mucho en juego', danger: 'Activar Auto', safe: 'No activar',
          text: `El modo Auto tira sin parar. Con ${fmt(bet.value)} por tirada, 10 tiradas suman ${fmt(total)} monedas (${Math.round(total / Math.max(1, S.me.coins) * 100)} % de tus ${fmt(S.me.coins)}). Puedes pararlo pulsando Auto otra vez.` });
        if (!ok) return;
      }
      setAuto(true);
      if (!spinning) spin(true);
    }

    async function spin(fromAuto = false) {
      if (spinning) return;
      spinning = true;
      spinBtn.disabled = true;
      // En Auto el riesgo ya se confirmó al activarlo: no se pregunta en cada tirada.
      if (!fromAuto && !(await confirmBet('slots', bet.value))) { spinning = false; spinBtn.disabled = false; setAuto(false); return; }
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
      holdCoins(stake); // el premio se ve en el saldo cuando paran los rodillos
      try { res = await emit('slots:spin', { bet: bet.value }); } catch (e) {
        releaseCoins();
        timers.forEach(clearInterval); reelEls.forEach((r) => r.classList.remove('spinning'));
        toast(e.message, 'error'); sfx('error'); spinning = false; spinBtn.disabled = false; setAuto(false); return;
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
          for (const d of [110, 150, 210, 290, 400].map((x) => tw(x))) {
            const strip = reels[2];
            const k = Math.floor(Math.random() * strip.length);
            reelEls[2].firstChild.replaceChildren(...[0, 1, 2].map((r) => symImg(strip[(k + r) % strip.length])));
            sfx('tick'); await sleep(d);
          }
          reelEls[2].classList.remove('tense');
        } else await wait(300 + i * 250);
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
      releaseCoins();
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
      if (auto && S.me.coins < bet.value) { setAuto(false); toast('Auto parado: ya no te queda saldo para esa apuesta.', 'info'); }
      if (auto) { await wait(700); if (auto && document.contains(spinBtn)) spin(true); }
    }

    const payRows = Object.entries(S.data.slots.symbols).reverse().map(([k, v]) => h('div', { class: 'pay-row' },
      symImg(k), symImg(k), symImg(k), h('b', {}, `×${v.pay}`), v.two ? h('span', { class: 'muted small' }, ` (2 seguidas ×${v.two})`) : null));

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🎰 Pika-Slots'), speedToggle(), h('div', { class: 'jackpot-big' }, 'BOTE PROGRESIVO ', jack)),
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
    // Espacio / Intro: girar (o parar el Auto si está en marcha).
    const offKey = hotkey(root, () => { if (auto) setAuto(false); else spin(); });
    this.offs = [bus.on('jackpot', (j) => { jack.textContent = fmt(j); })];
    this.stop = () => { auto = false; offKey(); };
  },
  unmount() { this.offs.forEach((f) => f()); this.stop(); },
};

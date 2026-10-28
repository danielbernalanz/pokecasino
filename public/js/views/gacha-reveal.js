// Animación del Gacha: lanzamiento de la Poké Ball, sacudidas que la mejoran según la rareza,
// «¿Quién es ese Pokémon?» para lo bueno, explosiones de partículas, sonido y vibración.
import { S, h, sfx, art, pokeImg, rarityName, typeBadge, sleep, itemImg } from '../core.js';
import { burst, centerOf } from '../fx.js';

const RANK = { C: 0, U: 1, R: 2, E: 3, L: 4, M: 5 };
const BALL_OF = { C: 'poke', U: 'poke', R: 'great', E: 'ultra', L: 'master', M: 'master' };
const BALLS = ['poke', 'great', 'ultra', 'master'];
const COLOR = { C: 'var(--C)', U: 'var(--U)', R: 'var(--R)', E: 'var(--E)', L: 'var(--L)', M: 'var(--M)' };
const BALL_COLOR = { poke: '#ff5a36', great: '#4f8dff', ultra: '#f5c518', master: '#c084fc' };
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* sin vibración */ } };

// Poké Balls dibujadas en SVG (nítidas a cualquier tamaño). Son cadenas fijas: no llevan datos del usuario.
const BALL_SVG = {
  poke: '',
  great: '<path d="M14,34 Q20,16 36,9 L41,21 Q29,26 25,38Z M86,34 Q80,16 64,9 L59,21 Q71,26 75,38Z" fill="#e3350d"/>',
  ultra: '<path d="M22,13 h11 v15 h34 v-15 h11 v34 h-11 v-9 h-34 v9 h-11Z" fill="#f5c518"/>',
  master: '<circle cx="24" cy="31" r="8" fill="#e05aa6"/><circle cx="76" cy="31" r="8" fill="#e05aa6"/><text x="50" y="35" font-size="22" font-weight="900" font-family="Arial,sans-serif" text-anchor="middle" fill="#fff">M</text>',
};
const BALL_TOP = { poke: '#e3350d', great: '#2f6fe0', ultra: '#2a2a30', master: '#7b3fc4' };
function ballEl(kind, cls = '') {
  const el = h('div', { class: 'gx-ballsvg ' + cls });
  el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="46" fill="#f4f4f6"/>
    <path d="M4,50 A46,46 0 0 1 96,50Z" fill="${BALL_TOP[kind]}"/>${BALL_SVG[kind]}
    <ellipse cx="33" cy="22" rx="13" ry="7" fill="#fff" opacity=".35" transform="rotate(-25 33 22)"/>
    <rect x="4" y="45.5" width="92" height="9" fill="#141414"/>
    <circle cx="50" cy="50" r="46" fill="none" stroke="#141414" stroke-width="5"/>
    <circle cx="50" cy="50" r="13" fill="#f4f4f6" stroke="#141414" stroke-width="5"/>
    <circle class="gx-btn" cx="50" cy="50" r="6" fill="#fff" stroke="#c9c9cf" stroke-width="2"/></svg>`;
  return el;
}


function card(r, cls = '') {
  const p = S.dexById.get(r.id);
  return h('div', { class: `gx-card r-${r.rarity}${r.shiny ? ' shiny' : ''} ${cls}` },
    r.isNew ? h('span', { class: 'gx-tag' }, '¡NUEVO!') : null,
    r.newShiny ? h('span', { class: 'gx-tag shiny' }, '✨') : null,
    pokeImg(r.id, r.shiny, 'gx-card-art'),
    h('b', {}, p.name),
    h('span', { class: 'gx-stars' }, '★'.repeat(r.stars)),
    r.dust ? h('span', { class: 'gx-dust' }, `+${r.dust} ✦`) : null);
}

/**
 * Muestra el resultado de una tirada. Devuelve 1 o 10 si el jugador pide «otra vez», o null al cerrar.
 * @param {Array} results resultados del servidor
 * @param {{bonus?: string[], again?: (n:number)=>boolean, againLabel?: (n:number)=>string}} opts
 */
export function reveal(results, { bonus = [], again = () => false, againLabel = (n) => `Otra vez ×${n}` } = {}) {
  return new Promise((resolve) => {
    const top = results.reduce((m, r) => (RANK[r.rarity] > RANK[m] ? r.rarity : m), 'C');
    const multi = results.length > 1;
    let skip = false;
    let tapWaiter = null;

    const rays = h('div', { class: 'gx-rays' });
    const flash = h('div', { class: 'gx-flash' });
    const fx = h('div', { class: 'gx-fx' });
    const stage = h('div', { class: 'gx-stage' });
    const hint = h('div', { class: 'gx-hint' }, 'Toca para saltar');
    const ov = h('div', { class: 'gx', role: 'dialog', 'aria-label': 'Resultado de la tirada' }, rays, stage, fx, flash, hint);
    const tap = () => {
      if (tapWaiter) { const f = tapWaiter; tapWaiter = null; f(); } else skip = true;
    };
    ov.addEventListener('click', (e) => { if (!e.target.closest('button')) tap(); });
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); tap(); } };
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    document.body.classList.add('gx-open');

    const wait = (ms) => sleep(skip ? 0 : reduceMotion() ? Math.min(ms, 150) : ms);
    // Espera a que toquen la pantalla (o a que pase `ms`, si se indica).
    const waitTap = (ms) => new Promise((res) => { tapWaiter = res; if (ms) setTimeout(() => { if (tapWaiter === res) { tapWaiter = null; res(); } }, ms); });
    const level = (n) => { ov.dataset.lv = String(n); };
    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('gx-open');
      ov.classList.add('out');
      setTimeout(() => ov.remove(), 220);
      resolve(value);
    };

    // ---- 1. Lanzamiento y sacudidas: la Poké Ball «sube de categoría» al sacudirse ----
    async function throwBall() {
      const finalIdx = BALLS.indexOf(BALL_OF[top]);
      const shakes = RANK[top] >= 3 ? 3 : RANK[top] === 2 ? 2 : 1;
      let kind = 'poke';
      let ball = ballEl(kind, 'gx-ball throw');
      stage.replaceChildren(ball);
      level(0);
      sfx('throw');
      await wait(650);
      ball.classList.remove('throw');
      sfx('land'); buzz(20);
      burst(fx, ...centerOf(ball).map((v, i) => (i ? v + 50 : v)), '#ffffffaa', 10, { spread: 90, stars: 0 });
      for (let i = 1; i <= shakes && !skip; i++) {
        await wait(380);
        ball.classList.add('wobble');
        sfx('wobble', i); buzz(25);
        await wait(520);
        ball.classList.remove('wobble');
        const next = BALLS[Math.min(i, finalIdx)];
        if (next !== kind && !skip) {
          kind = next;
          const nb = ballEl(kind, 'gx-ball upg');
          ball.replaceWith(nb);
          ball = nb;
          level(i);
          flash.className = 'gx-flash soft go';
          sfx('upgrade', i); buzz([30, 40, 30]);
          burst(fx, ...centerOf(ball), BALL_COLOR[kind], 16 + i * 8, { spread: 160 + i * 40 });
        }
      }
      if (RANK[top] >= 4 && !skip) {
        // Legendaria o mítica: se apaga todo y la Master Ball se carga de energía.
        ov.classList.add('dark');
        ball.classList.add('charge');
        level(4);
        sfx('charge', RANK[top] - 4); buzz([60, 60, 60, 60, 120, 60, 200]);
        await wait(1500);
        ov.classList.add('quake');
      }
      // Se abre.
      const [x, y] = centerOf(ball);
      ball.classList.add('open');
      flash.className = 'gx-flash go r-' + top;
      ov.classList.remove('dark');
      level(Math.max(1, RANK[top]));
      sfx('burst');
      buzz(RANK[top] >= 4 ? [120, 50, 220] : RANK[top] >= 2 ? [60] : [25]);
      burst(fx, x, y, COLOR[top], [14, 20, 34, 50, 90, 110][RANK[top]], { spread: 220 + RANK[top] * 60, size: 1 + RANK[top] * 0.15 });
      if (RANK[top] >= 4) setTimeout(() => burst(fx, x, y, BALL_COLOR.ultra, 60, { spread: 520, stars: 0.8, size: 1.4 }), 220);
      await wait(RANK[top] >= 4 ? 650 : 380);
      ov.classList.remove('quake');
    }

    // ---- 2. Foco: «¿Quién es ese Pokémon?» y presentación a pantalla completa ----
    async function spotlight(r, { final = false } = {}) {
      const p = S.dexById.get(r.id);
      const big = RANK[r.rarity] >= 4;
      const img = h('img', { class: 'gx-art sil', src: art(r.id, r.shiny), alt: p.name });
      const name = h('h2', { class: 'gx-name' }, p.name, r.shiny ? ' ✨' : '');
      const stars = h('div', { class: 'gx-bigstars' }, Array.from({ length: 5 }, () => h('span', {}, '★')));
      const tags = h('div', { class: 'gx-tags' });
      const info = h('div', { class: 'gx-info' }, name,
        h('div', { class: 'gx-ribbon r-' + r.rarity }, rarityName(r.rarity), r.masterBall ? ' · Master Ball' : ''),
        h('div', { class: 'types' }, p.types.map(typeBadge)), stars, tags);
      const who = h('div', { class: 'gx-who' }, '¿Quién es ese Pokémon?');
      const spot = h('div', { class: `gx-spot r-${r.rarity}${r.shiny ? ' shiny' : ''}` }, h('div', { class: 'gx-halo' }), img, who, info);
      stage.replaceChildren(spot);
      level(Math.max(1, RANK[r.rarity]));
      await wait(big ? 1300 : RANK[r.rarity] >= 2 ? 750 : 380);
      // Revelación.
      img.classList.remove('sil');
      who.remove();
      spot.classList.add('shown');
      sfx(big ? 'fanfare' : RANK[r.rarity] >= 3 ? 'big' : RANK[r.rarity] >= 2 ? 'win' : 'reveal');
      buzz(big ? [80, 40, 80, 40, 200] : 30);
      burst(fx, ...centerOf(img), COLOR[r.rarity], big ? 80 : 18 + RANK[r.rarity] * 10, { spread: big ? 420 : 240 });
      if (r.shiny) {
        sfx('shiny');
        for (let k = 0; k < 3; k++) setTimeout(() => burst(fx, ...centerOf(img), '#fff7c2', 26, { spread: 300, stars: 1 }), 250 + k * 300);
      }
      await wait(350);
      for (let i = 0; i < r.stars; i++) {
        stars.children[i].classList.add('on');
        sfx('star', i);
        await wait(110);
      }
      if (r.isNew) tags.append(h('span', { class: 'gx-stamp' }, '¡NUEVO!'));
      if (r.newShiny) tags.append(h('span', { class: 'gx-stamp shiny' }, '✨ VARIOCOLOR NUEVO'));
      if (r.dust) tags.append(h('span', { class: 'gx-stamp dust' }, `+${r.dust} ✦ polvo`));
      if (!final) {
        hint.textContent = 'Toca para continuar';
        await waitTap(big ? 0 : 2600);
      }
    }

    // ---- 3. Sobre ×10: cada Poké Ball se abre por orden, de peor a mejor, con suspense creciente ----
    async function openPack() {
      const slots = results.map((r) => h('div', { class: 'gx-slot' }, ballEl(BALL_OF[r.rarity], 'gx-mini')));
      const counter = h('div', { class: 'gx-count' }, `0/${results.length}`);
      const grid = h('div', { class: 'gx-grid' }, slots);
      const pack = h('div', { class: 'gx-pack' }, counter, grid);
      stage.replaceChildren(pack);
      level(1);
      hint.textContent = 'Toca para abrirlas todas';
      await wait(500);
      // Orden de apertura: las mejores al final (variocolores después de todo), manteniendo su posición en la cuadrícula.
      const score = (r) => RANK[r.rarity] + (r.shiny ? 10 : 0);
      const order = results.map((_, i) => i).sort((a, b) => score(results[a]) - score(results[b]) || a - b);
      const pause = [450, 450, 900, 1400, 1400, 1400];
      let done = 0;
      for (const i of order) {
        const r = results[i];
        const rk = RANK[r.rarity];
        const ball = slots[i].firstChild;
        if ((rk >= 4 || r.newShiny) && !skip) {
          ball.classList.add('focus', 'wobble');
          sfx('charge', 0); buzz([40, 40, 40]);
          await wait(900);
          await spotlight(r);
          hint.textContent = 'Toca para abrirlas todas';
          stage.replaceChildren(pack);
        } else if (!skip) {
          // Se agranda y se sacude 1 (C/U), 2 (R) o 3 (E) veces antes de abrirse.
          ball.classList.add('focus');
          await wait(250);
          const shakes = rk >= 3 ? 3 : rk === 2 ? 2 : 1;
          for (let k = 1; k <= shakes && !skip; k++) {
            ball.classList.remove('wob'); void ball.offsetWidth; ball.classList.add('wob');
            sfx('wobble', k); buzz(25);
            await wait(460);
          }
        }
        slots[i].replaceChildren(card(r, 'flip'));
        counter.textContent = `${++done}/${results.length}`;
        if (!skip) {
          burst(fx, ...centerOf(slots[i]), COLOR[r.rarity], 10 + rk * 8, { spread: 90 + rk * 40 });
          sfx(rk >= 3 ? 'win' : rk === 2 ? 'reveal' : 'flip');
          if (rk >= 2) buzz(20);
          await wait(pause[rk]);
        }
      }
      return pack;
    }

    function summary() {
      hint.remove();
      const newOnes = results.filter((r) => r.isNew).length;
      const dust = results.reduce((s, r) => s + r.dust, 0);
      const btns = h('div', { class: 'gx-actions' },
        [1, 10].filter((n) => again(n)).map((n) => h('button', { class: 'btn big ' + (n === 10 ? 'gold' : 'primary'), onclick: () => close(n) }, againLabel(n))),
        h('button', { class: 'btn big', onclick: () => close(null) }, 'Continuar'));
      const line = multi ? h('div', { class: 'gx-summary' },
        newOnes ? h('span', { class: 'good' }, `${newOnes} nuevo${newOnes > 1 ? 's' : ''} en tu Pokédex`) : h('span', { class: 'muted' }, 'Ninguno nuevo esta vez'),
        dust ? h('span', {}, ` · +${dust} ✦`) : '',
        ...bonus.map((it) => h('span', { class: 'gx-gift' }, itemImg(it), ` ¡Regalo: ${S.data.items[it].name}!`))) : '';
      stage.append(line, btns);
      if (bonus.length) { sfx('shiny'); buzz(40); }
    }

    (async () => {
      await throwBall();
      if (!multi) {
        skip = false; // tocar durante el lanzamiento no se salta la presentación
        await spotlight(results[0], { final: true });
        summary();
      } else {
        const grid = await openPack();
        stage.replaceChildren(grid);
        summary();
      }
    })();
  });
}

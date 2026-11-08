// Animación a pantalla completa de la MEGAEVOLUCIÓN: el Pokémon base, una hélice de ADN arcoíris que se enrolla,
// el símbolo Mega, destello blanco, revelación de la forma Mega con rayos, partículas, vibración y sonido.
// Toca para saltar al final; con «reducir movimiento» se muestra directamente la revelación.
import { S, h, sfx, pokeImg, typeBadge, sleep, fmt } from '../core.js';
import { burst, centerOf, vibrate, reduced, flash, confetti, shake } from '../fx.js';

const RAINBOW = ['#ff4d6d', '#ffb454', '#ffe14d', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6'];

// Símbolo Mega: anillo con una doble hélice y un diamante central.
export function megaSymbol(cls = '') {
  const el = h('div', { class: 'me-sym ' + cls });
  el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>
    <linearGradient id="mesg${cls.length}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4d6d"/><stop offset=".25" stop-color="#ffe14d"/><stop offset=".5" stop-color="#4ade80"/><stop offset=".75" stop-color="#38bdf8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>
    <circle cx="50" cy="50" r="44" fill="rgba(10,6,30,.55)" stroke="url(#mesg${cls.length})" stroke-width="5"/>
    <path d="M30 76 C30 28 70 72 70 24" fill="none" stroke="url(#mesg${cls.length})" stroke-width="6" stroke-linecap="round"/>
    <path d="M70 76 C70 28 30 72 30 24" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".9"/>
    <path d="M50 38 L58 50 L50 62 L42 50Z" fill="#fff"/></svg>`;
  return el;
}

function helix() {
  const el = h('div', { class: 'me-helix' });
  let rungs = '';
  for (let i = 0; i < 9; i++) rungs += `<line x1="${30 + 40 * Math.abs(Math.sin(i * 0.7))}" y1="${14 + i * 24}" x2="${70 - 40 * Math.abs(Math.sin(i * 0.7))}" y2="${14 + i * 24}" stroke="${RAINBOW[i % 7]}" stroke-width="3" opacity=".8"/>`;
  el.innerHTML = `<svg viewBox="0 0 100 220" preserveAspectRatio="none" aria-hidden="true">
    <path class="s1" d="M30 0 C30 55 70 55 70 110 C70 165 30 165 30 220" fill="none" stroke="#7df9ff" stroke-width="5" stroke-linecap="round"/>
    <path class="s2" d="M70 0 C70 55 30 55 30 110 C30 165 70 165 70 220" fill="none" stroke="#f472b6" stroke-width="5" stroke-linecap="round"/>${rungs}</svg>`;
  return el;
}

/**
 * @param {{id:number, shiny?:boolean, form:number}} o id de la especie base y formId de la Mega
 * @returns {Promise<void>} se resuelve al cerrar
 */
export function megaEvolve({ id, shiny = false, form }) {
  return new Promise((resolve) => {
    const f = S.megaById.get(form);
    const base = S.dexById.get(id);
    let skip = false;
    let tapWaiter = null;
    const rays = h('div', { class: 'gx-rays me-rays' });
    const fxl = h('div', { class: 'gx-fx' });
    const flashEl = h('div', { class: 'me-white' });
    const hint = h('div', { class: 'gx-hint' }, 'Toca para saltar');
    const stage = h('div', { class: 'gx-stage' });
    const ov = h('div', { class: 'gx me-ov', role: 'dialog', 'aria-label': 'Megaevolución' }, rays, stage, fxl, flashEl, hint);
    const tap = () => { if (tapWaiter) { const fn = tapWaiter; tapWaiter = null; fn(); } else skip = true; };
    ov.addEventListener('click', (e) => { if (!e.target.closest('button')) tap(); });
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); tap(); } };
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    document.body.classList.add('gx-open');
    const wait = (ms) => sleep(skip ? 0 : reduced() ? Math.min(ms, 80) : ms);
    const close = () => {
      document.removeEventListener('keydown', onKey);
      ov.classList.add('out');
      setTimeout(() => { ov.remove(); document.body.classList.remove('gx-open'); }, 220);
      resolve();
    };

    (async () => {
      const monBase = pokeImg(id, shiny, 'me-mon');
      const halo = h('div', { class: 'me-halo' });
      const orb = h('div', { class: 'me-orb' });
      const hx = helix();
      const sym = megaSymbol();
      const holder = h('div', { class: 'me-holder' }, halo, orb, hx, monBase, sym);
      stage.replaceChildren(h('div', { class: 'me-title' }, base.name), holder);
      ov.classList.add('s0');
      sfx('whoosh'); vibrate(20);
      await wait(900);

      if (!skip) {
        // 1. Carga: la hélice se enrolla, el Pokémon tiembla y la energía converge desde los bordes.
        ov.classList.add('charging');
        sfx('megacharge'); vibrate([30, 30, 30, 30, 60, 30, 90, 30, 140]);
        const t0 = performance.now();
        while (!skip && performance.now() - t0 < (reduced() ? 300 : 2400)) {
          const [cx, cy] = centerOf(holder);
          const a = Math.random() * Math.PI * 2;
          const r = 170 + Math.random() * 80;
          const p = h('i', { class: 'me-spark' });
          p.style.cssText = `left:${cx + Math.cos(a) * r}px;top:${cy + Math.sin(a) * r}px;background:${RAINBOW[Math.floor(Math.random() * 7)]}`;
          fxl.append(p);
          p.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: `translate(${-Math.cos(a) * r}px,${-Math.sin(a) * r}px) scale(.2)`, opacity: 0.2 }], { duration: 700, easing: 'ease-in' }).onfinish = () => p.remove();
          await sleep(55);
        }
      }

      // 2. El Pokémon se vuelve luz y aparece el símbolo Mega.
      ov.classList.add('orb');
      monBase.classList.add('white');
      sym.classList.add('show');
      sfx('sparkle'); vibrate([60, 40, 120]);
      await wait(1100);

      // 3. Destello.
      ov.classList.add('boom');
      flashEl.classList.add('go');
      sfx('megaboom'); vibrate([120, 50, 80, 50, 260]);
      shake(ov, 600);
      const [cx, cy] = centerOf(holder);
      burst(fxl, cx, cy, '#ffffff', 60, { spread: 520, stars: 0.8, size: 1.3 });
      RAINBOW.forEach((c, i) => setTimeout(() => burst(fxl, cx, cy, c, 22, { spread: 330 + i * 20, stars: 0.5 }), 80 + i * 70));
      await wait(380);

      // 4. Revelación de la forma Mega.
      const mon = pokeImg(id, shiny, 'me-mon shown', form);
      holder.replaceChildren(h('div', { class: 'me-halo on' }), mon);
      ov.classList.remove('charging', 'orb');
      ov.classList.add('revealed');
      stage.firstChild.textContent = '¡MEGAEVOLUCIÓN!';
      stage.firstChild.classList.add('slam');
      const gain = f.stats.reduce((a, b) => a + b, 0) - base.stats.reduce((a, b) => a + b, 0);
      const info = h('div', { class: 'me-info' },
        h('h2', { class: 'me-name' }, f.name),
        h('div', { class: 'row gap me-types' }, f.types.map(typeBadge)),
        h('div', { class: 'me-gain' }, `Estadísticas base ${gain >= 0 ? '+' : ''}${fmt(gain)}`),
        h('div', { class: 'me-stats' }, ['PS', 'Atq', 'Def', 'AtqEsp', 'DefEsp', 'Vel'].map((n, i) => h('span', {}, h('i', {}, n), h('b', {}, f.stats[i]), (f.stats[i] - base.stats[i]) > 0 ? h('em', {}, `+${f.stats[i] - base.stats[i]}`) : null))));
      stage.append(info);
      sfx('fanfare'); vibrate([80, 40, 80, 40, 220]);
      confetti({ count: 60, colors: RAINBOW });
      const [mx, my] = centerOf(mon);
      for (let k = 0; k < 4; k++) setTimeout(() => burst(fxl, mx, my, RAINBOW[(k * 2) % 7], 24, { spread: 300, stars: 1 }), 150 + k * 280);
      hint.remove();
      await wait(250);
      stage.append(h('div', { class: 'gx-actions' }, h('button', { class: 'btn big primary', onclick: close }, '¡Genial!')));
    })();
  });
}

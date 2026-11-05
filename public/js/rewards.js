// Recompensas con animación: eclosión del Huevo Misterioso, cofre de la recompensa diaria
// y pequeños efectos al usar objetos. Usa fx.js para partículas, destellos y monedas.
import { S, h, act, sfx, toast, sleep, avatar, titleTag, playingCard, itemImg, RAR_NAME } from './core.js';
import { burst, centerOf, flash, vibrate, reduced, coinRain, countUp, floatText, layer, pop } from './fx.js';

const RANK = { C: 0, U: 1, R: 2, E: 3, L: 4 };
const HEX = { C: '#9ca3af', U: '#4ade80', R: '#38bdf8', E: '#c084fc', L: '#fbbf24' };
const SLOT = { frame: 'Marco de avatar', cardback: 'Dorso de carta', title: 'Título' };

// Huevo dibujado en SVG: manchas, grietas (se van dibujando) y brillo que se escapa por ellas.
const EGG = 'M50,4 C78,4 94,52 94,82 C94,110 74,126 50,126 C26,126 6,110 6,82 C6,52 22,4 50,4Z';
const CRACKS = [
  'M52,16 L45,32 L57,44 L47,58',
  'M47,58 L61,67 L50,79 L65,90 M45,32 L33,38 L37,51',
  'M65,90 L56,102 L67,114 M50,79 L36,85 L40,99 M57,44 L72,48 L76,63',
];
function eggSvg(cracks = true) {
  const el = h('div', { class: 'fxe-svg' });
  el.innerHTML = `<svg viewBox="0 0 100 130" aria-hidden="true">
    <defs><radialGradient id="fxeg" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#fffdf2"/><stop offset=".6" stop-color="#f1e6c3"/><stop offset="1" stop-color="#cdb98a"/></radialGradient></defs>
    <path d="${EGG}" fill="url(#fxeg)" stroke="#8a7647" stroke-width="2.5"/>
    <g fill="#7c5cd6" opacity=".85"><circle cx="34" cy="40" r="7"/><circle cx="68" cy="30" r="5"/><circle cx="72" cy="74" r="8"/><circle cx="30" cy="88" r="6"/><circle cx="52" cy="108" r="5"/><circle cx="48" cy="66" r="4"/></g>
    <text x="50" y="82" font-size="30" font-weight="900" font-family="Arial,sans-serif" text-anchor="middle" fill="#6d4bd1" stroke="#fff" stroke-width="1.5" paint-order="stroke">?</text>
    <ellipse cx="32" cy="26" rx="10" ry="6" fill="#fff" opacity=".45" transform="rotate(-30 32 26)"/>
    ${cracks ? CRACKS.map((d, i) => `<g class="fxe-crack c${i + 1}"><path class="glow" pathLength="1" d="${d}"/><path class="line" pathLength="1" d="${d}"/></g>`).join('') : ''}
  </svg>`;
  return el;
}

function preview(id) {
  const c = S.data.cosmetics[id];
  if (c.slot === 'frame') return avatar(S.me.buddy || { id: 25 }, { frame: id }, 'xl fxe-av');
  if (c.slot === 'cardback') return h('div', { class: 'fxe-cards' }, playingCard(null, { back: id, cls: 'fxe-card' }), playingCard('Ah', { cls: 'fxe-card two' }));
  return h('div', { class: 'fxe-title' }, itemImg(id, 'fxe-ti'), titleTag(c.title));
}

/**
 * Secuencia de eclosión. Devuelve 'equip' | 'again' | null según el botón elegido.
 * Cuanto más rara es la recompensa, más se sacude el huevo, más grietas y más luz.
 */
export function hatch(id, { isNew = false, left = 0 } = {}) {
  return new Promise((resolve) => {
    const c = S.data.cosmetics[id];
    const rank = RANK[c.rarity] ?? 0;
    const color = HEX[c.rarity] || '#fff';
    let skip = false;
    let tapWaiter = null;
    const rays = h('div', { class: 'gx-rays' });
    const fxl = h('div', { class: 'gx-fx' });
    const flashEl = h('div', { class: 'gx-flash' });
    const hint = h('div', { class: 'gx-hint' }, 'Toca para saltar');
    const stage = h('div', { class: 'gx-stage' });
    const ov = h('div', { class: 'gx fxe', role: 'dialog', 'aria-label': 'Huevo Misterioso', style: { '--rc': color } }, rays, stage, fxl, flashEl, hint);
    const tap = () => { if (tapWaiter) { const f = tapWaiter; tapWaiter = null; f(); } else skip = true; };
    ov.addEventListener('click', (e) => { if (!e.target.closest('button')) tap(); });
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); tap(); } };
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    document.body.classList.add('gx-open');
    const wait = (ms) => sleep(skip ? 0 : reduced() ? Math.min(ms, 120) : ms);
    const lvl = (n) => { ov.dataset.lv = String(n); };
    const close = (v) => {
      document.removeEventListener('keydown', onKey);
      ov.classList.add('out');
      setTimeout(() => { ov.remove(); document.body.classList.remove('gx-open'); }, 220);
      resolve(v);
    };

    (async () => {
      // 1. El huevo aparece y se sacude con intensidad creciente.
      const egg = eggSvg();
      const wrap = h('div', { class: 'fxe-egg' }, egg, h('div', { class: 'fxe-shadow' }));
      stage.replaceChildren(wrap);
      lvl(1);
      sfx('land'); vibrate(20);
      await wait(550);
      const wobbles = 2 + rank;
      for (let i = 1; i <= wobbles && !skip; i++) {
        const amp = Math.min(30, 8 + i * 5);
        wrap.style.setProperty('--amp', amp);
        wrap.style.setProperty('--wd', Math.max(0.3, 0.55 - i * 0.04) + 's');
        wrap.classList.remove('wob'); void wrap.offsetWidth; wrap.classList.add('wob');
        sfx('wobble', i); vibrate(15 + i * 8);
        await wait(Math.max(300, 560 - i * 40));
        // Aparecen grietas a medida que avanza la sacudida.
        const stageNo = i === Math.ceil(wobbles / 3) ? 1 : i === Math.ceil((2 * wobbles) / 3) ? 2 : i === wobbles ? 3 : 0;
        if (stageNo && !skip) {
          wrap.classList.add('s' + stageNo);
          sfx('crack', stageNo); vibrate([30, 20, 30]);
          const [x, y] = centerOf(egg);
          burst(fxl, x, y, color, 6 + stageNo * 4, { spread: 90, stars: 0.2 });
          if (stageNo >= 2) lvl(Math.min(4, 1 + rank));
        }
        await wait(160);
      }
      if (rank >= 3 && !skip) {
        // Épico/legendario: se apaga todo y el huevo vibra a punto de abrirse.
        ov.classList.add('dark');
        wrap.classList.add('shiver');
        sfx('charge', rank - 3); vibrate([50, 40, 50, 40, 120, 40, 200]);
        await wait(1000);
        ov.classList.add('quake');
      } else if (!skip) {
        wrap.classList.add('shiver');
        await wait(350);
      }

      // 2. Eclosión: estallido de luz, cáscara que se parte y partículas del color de la rareza.
      const [x, y] = centerOf(egg);
      const top = eggSvg(false); top.classList.add('half', 'top');
      const bot = eggSvg(false); bot.classList.add('half', 'bot');
      wrap.replaceChildren(top, bot);
      wrap.className = 'fxe-egg open';
      ov.classList.remove('dark');
      lvl(Math.max(1, rank + 1));
      flashEl.className = 'gx-flash go' + (rank >= 4 ? ' r-L' : '');
      sfx('burst'); vibrate(rank >= 4 ? [120, 50, 220] : rank >= 2 ? [70] : [30]);
      burst(fxl, x, y, color, [20, 30, 44, 70, 110][rank], { spread: 230 + rank * 60, size: 1 + rank * 0.15 });
      if (rank >= 3) setTimeout(() => burst(fxl, x, y, '#ffffff', 40 + rank * 10, { spread: 480, stars: 0.8, size: 1.3 }), 200);
      await wait(rank >= 4 ? 700 : 450);
      ov.classList.remove('quake');

      // 3. Revelación del cosmético con la cinta de rareza y el sello de «¡NUEVO!».
      const tags = h('div', { class: 'gx-tags' });
      const prev = h('div', { class: 'fxe-prev' }, preview(id));
      const info = h('div', { class: 'gx-info' },
        h('h2', { class: 'gx-name' }, c.title ? `«${c.title}»` : c.name),
        h('div', { class: 'gx-ribbon' }, RAR_NAME[c.rarity]),
        h('div', { class: 'muted small' }, SLOT[c.slot]),
        tags);
      const spot = h('div', { class: `gx-spot shown r-${c.rarity}`, style: { '--rc': color } }, h('div', { class: 'gx-halo' }), prev, info);
      stage.replaceChildren(spot);
      sfx(rank >= 4 ? 'fanfare' : rank >= 3 ? 'big' : rank >= 2 ? 'win' : 'reveal');
      vibrate(rank >= 3 ? [80, 40, 80, 40, 200] : 30);
      burst(fxl, ...centerOf(prev), color, 20 + rank * 12, { spread: 240 + rank * 50 });
      if (rank >= 4) { sfx('shiny'); for (let k = 0; k < 3; k++) setTimeout(() => burst(fxl, ...centerOf(prev), '#fff7c2', 24, { spread: 320, stars: 1 }), 250 + k * 300); }
      await wait(350);
      tags.append(isNew ? h('span', { class: 'gx-stamp' }, '¡NUEVO!') : h('span', { class: 'gx-stamp dust' }, 'Repetido · véndelo en el Mercado'));
      if (isNew) sfx('star');
      hint.remove();
      const equipped = S.me.equip && S.me.equip[c.slot] === id;
      stage.append(h('div', { class: 'gx-actions' },
        left > 0 ? h('button', { class: 'btn big gold', onclick: () => close('again') }, `Abrir otro (${left})`) : null,
        !equipped ? h('button', { class: 'btn big primary', onclick: () => close('equip') }, 'Equipar ahora') : null,
        h('button', { class: 'btn big', onclick: () => close(null) }, 'Continuar')));
    })();
  });
}

// Abre huevos desde la Tienda/Mochila o «Mi Entrenador»; encadena otro si el jugador lo pide.
export async function openEgg(btn) {
  let b = btn;
  for (;;) {
    const had = new Set(Object.keys(S.me.items || {}));
    const r = await act('item:use', { itemId: 'mystery-egg' }, b);
    b = null;
    if (!r || !r.got) return;
    const c = S.data.cosmetics[r.got];
    const choice = await hatch(r.got, { isNew: !had.has(r.got), left: S.me.items['mystery-egg'] || 0 });
    if (choice === 'equip') { if (await act('equip', { slot: c.slot, id: r.got })) { sfx('click'); toast(`${c.name} equipado`, 'success'); } }
    if (choice !== 'again') return;
  }
}

// ---- Efectos pequeños al usar objetos ----
export function useFx(itemId, origin) {
  const at = origin instanceof Element && origin.isConnected ? centerOf(origin) : Array.isArray(origin) ? origin : [window.innerWidth / 2, window.innerHeight * 0.45];
  switch (itemId) {
    case 'rare-candy':
      burst(layer(), ...at, '#f472b6', 22, { spread: 150, stars: 0.9 });
      floatText('★ +1', at, { color: '#f9a8d4', size: 28 });
      [0, 1, 2].forEach((k) => setTimeout(() => sfx('star', k), k * 90));
      vibrate(30);
      break;
    case 'lucky-egg':
      flash('#fde68a', 450);
      burst(layer(), ...at, '#fde68a', 30, { spread: 200 });
      floatText('XP ×2 · 1 h', at, { color: '#fde68a', size: 22 });
      sfx('big'); vibrate([30, 30, 50]);
      break;
    case 'amulet-coin':
      coinRain(0, { from: at, count: 9, label: false });
      floatText('+10 % ganancias', at, { color: '#ffd54f', size: 20 });
      sfx('win'); vibrate(30);
      break;
    case 'shiny-charm':
      flash('#fff7c2', 500);
      ['#fff7c2', '#f9a8d4', '#7dd3fc', '#86efac'].forEach((col, k) => setTimeout(() => burst(layer(), ...at, col, 14, { spread: 190, stars: 1 }), k * 90));
      floatText('✨ Variocolor ×4', at, { color: '#fde68a', size: 22 });
      sfx('shiny'); vibrate([30, 30, 30, 30, 60]);
      break;
    case 'master-ball':
      flash('#c084fc', 500);
      burst(layer(), ...at, '#c084fc', 36, { spread: 240 });
      floatText('Master Ball lista', at, { color: '#e9d5ff', size: 22 });
      sfx('upgrade', 2); vibrate([40, 30, 80]);
      break;
    default:
      burst(layer(), ...at, '#ffd54f', 14, { spread: 120 });
      sfx('shiny');
  }
}

// ---- Cofre de la recompensa diaria ----
const BOX = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <rect x="12" y="44" width="76" height="46" rx="5" fill="#e3350d" stroke="#7f1d0b" stroke-width="3"/>
  <rect x="44" y="44" width="12" height="46" fill="#ffcb05"/>
  <g class="lid"><rect x="8" y="30" width="84" height="18" rx="5" fill="#f0502a" stroke="#7f1d0b" stroke-width="3"/><rect x="44" y="30" width="12" height="18" fill="#ffcb05"/>
  <path d="M50,30 C38,8 18,14 30,28 Z M50,30 C62,8 82,14 70,28 Z" fill="#ffcb05" stroke="#b8860b" stroke-width="2"/></g></svg>`;

/** Abre el regalo diario: sacudidas, tapa que salta, monedas hacia el contador y los días de racha encendiéndose. */
export function dailyChest({ reward, streak, charm = false }) {
  return new Promise((resolve) => {
    const days = Math.min(streak, 7);
    const box = h('div', { class: 'fxc-box' }); box.innerHTML = BOX;
    const amt = h('b', {}, '0');
    const reveal = h('div', { class: 'fxc-reveal' },
      h('div', { class: 'fxc-title' }, '¡Recompensa diaria!'),
      h('div', { class: 'fxc-amt' }, h('span', { class: 'coin-ico' }), amt),
      h('div', { class: 'fxc-items' }, h('span', { class: 'fxc-item' }, itemImg('ticket'), ' +1 Ticket Gacha'), charm ? h('span', { class: 'fxc-item charm' }, itemImg('shiny-charm'), ' +1 Amuleto Iris') : null),
      h('div', { class: 'fxc-days' }, [1, 2, 3, 4, 5, 6, 7].map((d) => h('span', { class: 'sday' }, d))),
      h('div', { class: 'muted small' }, `Racha de ${streak} día${streak > 1 ? 's' : ''}`));
    const rays = h('div', { class: 'gx-rays' });
    const fxl = h('div', { class: 'gx-fx' });
    const hint = h('div', { class: 'gx-hint' }, 'Toca para saltar');
    const ov = h('div', { class: 'gx fxc', 'data-lv': '2', role: 'dialog', 'aria-label': 'Recompensa diaria' }, rays, h('div', { class: 'gx-stage' }, box, reveal), fxl, hint);
    let skip = false;
    let opened = false;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      ov.classList.add('out');
      setTimeout(() => { ov.remove(); document.body.classList.remove('gx-open'); }, 220);
      resolve();
    };
    const tap = () => { if (opened) close(); else skip = true; };
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); tap(); } };
    ov.addEventListener('click', tap);
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    document.body.classList.add('gx-open');
    const wait = (ms) => sleep(skip ? 0 : reduced() ? Math.min(ms, 100) : ms);
    (async () => {
      await wait(350);
      for (let i = 1; i <= 3 && !skip; i++) {
        box.style.setProperty('--amp', 6 + i * 5);
        box.classList.remove('wob'); void box.offsetWidth; box.classList.add('wob');
        sfx('wobble', i); vibrate(20 + i * 10);
        await wait(520);
      }
      // Se abre.
      const [x, y] = centerOf(box);
      box.classList.add('open');
      ov.dataset.lv = '3';
      flash('#ffe08a', 500);
      sfx('burst'); sfx('win'); vibrate([60, 30, 120]);
      burst(fxl, x, y, '#ffd54f', 46, { spread: 300, stars: 0.5 });
      coinRain(reward, { from: [x, y], count: 16, label: false });
      opened = true;
      hint.textContent = 'Toca para continuar';
      reveal.classList.add('show');
      countUp(amt, 0, reward, 1100).then(() => pop(amt.parentElement));
      // Los días de la racha se van encendiendo uno a uno; el de hoy rebota.
      const els = [...reveal.querySelectorAll('.sday')];
      for (let d = 0; d < days; d++) {
        await wait(skip ? 0 : 130);
        els[d].classList.add('on');
        if (d === days - 1) { els[d].classList.add('today'); sfx('star', 2); burst(fxl, ...centerOf(els[d]), '#ffd54f', 12, { spread: 90, stars: 0.7 }); } else sfx('star', Math.min(d, 4));
      }
      if (charm) { sfx('shiny'); burst(fxl, ...centerOf(reveal.querySelector('.charm')), '#fff7c2', 20, { spread: 140, stars: 1 }); }
      setTimeout(close, 6000);
    })();
  });
}

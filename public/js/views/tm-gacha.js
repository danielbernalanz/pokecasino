// Gacha de MT (pestaña de la Tienda): tiradas con monedas, revelado con un disco que gira y brilla.
import { S, h, fmt, act, sfx, toast, itemImg, typeBadge, sleep, TYPE_ES, bus } from '../core.js';
import { burst, centerOf } from '../fx.js';
import { moveEs, loadNames } from '../battle-screen.js';

const TIER_ES = { basic: 'Básica', good: 'Buena', strong: 'Fuerte', top: 'Élite', apex: 'Suprema' };
const TIER_RANK = { basic: 0, good: 1, strong: 2, top: 3, apex: 4 };
const TIER_COLOR = ['#9aa7b8', '#5fd16a', '#4da3ff', '#b46bff', '#ffcf3a'];
const TYPE_COLOR = { normal: '#a8a77a', fire: '#ee8130', water: '#6390f0', electric: '#f7d02c', grass: '#7ac74c', ice: '#96d9d6', fighting: '#c22e28', poison: '#a33ea1', ground: '#e2bf65', flying: '#a98ff3', psychic: '#f95587', bug: '#a6b91a', rock: '#b6a136', ghost: '#735797', dragon: '#6f35fc', dark: '#705746', steel: '#b7b7ce', fairy: '#d685ad' };
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* sin vibración */ } };
const pct = (x) => String(parseFloat((x * 100).toFixed(2))).replace('.', ',') + ' %';

const disc = (type, tier, cls = '') => h('div', { class: 'tg-disc ' + cls, style: `--c:${TYPE_COLOR[type] || '#888'};--g:${TIER_COLOR[TIER_RANK[tier]]}` }, h('span', {}, 'MT'));

function tmCard(r, cls = '') {
  const it = S.data.items[r.id];
  return h('div', { class: `tg-card t${TIER_RANK[r.tier]} ${cls}`, style: `--c:${TYPE_COLOR[r.type]};--g:${TIER_COLOR[TIER_RANK[r.tier]]}` },
    h('div', { class: 'tg-card-disc' }, disc(r.type, r.tier, 'still')),
    h('b', { class: 'tg-card-name' }, it.name),
    h('div', { class: 'tg-card-meta' }, typeBadge(r.type), h('span', { class: 'tg-tier' }, TIER_ES[r.tier])),
    r.featured ? h('span', { class: 'tg-star', title: 'Tipo destacado' }, '⭐') : null);
}

/** Revelado de una tirada. Devuelve 1 o 10 si piden «otra vez», o null. */
function reveal(results, { again, againLabel }) {
  return new Promise((resolve) => {
    const multi = results.length > 1;
    let skip = false;
    let tapWaiter = null;
    const rays = h('div', { class: 'gx-rays' });
    const flash = h('div', { class: 'gx-flash' });
    const fx = h('div', { class: 'gx-fx' });
    const stage = h('div', { class: 'tg-stage' });
    const hint = h('div', { class: 'gx-hint' }, 'Toca para saltar');
    const ov = h('div', { class: 'gx tg-ov', role: 'dialog', 'aria-label': 'Resultado del Gacha de MT' }, rays, stage, fx, flash, hint);
    const tap = () => { if (tapWaiter) { const f = tapWaiter; tapWaiter = null; f(); } else skip = true; };
    ov.addEventListener('click', (e) => { if (!e.target.closest('button')) tap(); });
    const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); tap(); } };
    document.addEventListener('keydown', onKey);
    document.body.append(ov);
    document.body.classList.add('gx-open');
    const wait = (ms) => sleep(skip ? 0 : reduceMotion() ? Math.min(ms, 120) : ms);
    const waitTap = (ms) => new Promise((res) => { tapWaiter = res; if (ms) setTimeout(() => { if (tapWaiter === res) { tapWaiter = null; res(); } }, ms); });
    const close = (v) => { document.removeEventListener('keydown', onKey); document.body.classList.remove('gx-open'); ov.classList.add('out'); setTimeout(() => ov.remove(), 220); resolve(v); };
    const lv = (r) => { ov.dataset.lv = String(Math.max(1, TIER_RANK[r.tier] + (TIER_RANK[r.tier] >= 4 ? 1 : 0))); };
    const sound = (r) => sfx(TIER_RANK[r.tier] >= 4 ? 'fanfare' : TIER_RANK[r.tier] >= 3 ? 'big' : TIER_RANK[r.tier] >= 2 ? 'win' : 'reveal');

    // Un disco gira y parpadea con el color del tipo; al abrirse enseña la MT.
    async function spin(r, big) {
      const d = disc(r.type, r.tier, 'spin');
      const holder = h('div', { class: 'tg-holder' }, d);
      stage.replaceChildren(holder);
      ov.dataset.lv = '1';
      sfx('charge', 0); buzz(20);
      await wait(big ? 1100 : 800);
      d.classList.add('slow');
      await wait(big ? 700 : 450);
      flash.className = 'gx-flash soft go'; void flash.offsetWidth;
      lv(r); sound(r);
      const rk = TIER_RANK[r.tier];
      burst(fx, ...centerOf(d), r.tier === 'apex' ? '#ffcf3a' : TYPE_COLOR[r.type], 16 + rk * 18, { spread: 200 + rk * 70, size: 1 + rk * 0.15 });
      if (rk >= 4) setTimeout(() => burst(fx, ...centerOf(d), '#fff2a8', 60, { spread: 480, stars: 0.8, size: 1.3 }), 200);
      buzz(rk >= 3 ? [80, 40, 160] : 30);
      holder.replaceChildren(tmCard(r, 'pop big'));
    }

    async function single() {
      await spin(results[0], TIER_RANK[results[0].tier] >= 3);
      hint.remove();
    }

    async function pack() {
      const slots = results.map((r) => h('div', { class: 'tg-slot' }, disc(r.type, r.tier, 'mini')));
      const counter = h('div', { class: 'tg-count' }, `0/${results.length}`);
      const skipAll = h('button', { class: 'btn small gx-skipall', type: 'button', onclick: () => { skip = true; skipAll.remove(); } }, '⏭ Saltar todo');
      stage.replaceChildren(h('div', { class: 'tg-pack' }, counter, h('div', { class: 'tg-grid' }, slots)), skipAll);
      hint.textContent = 'Toca para saltar';
      ov.dataset.lv = '1';
      await wait(450);
      // De peor a mejor (en la cuadrícula conservan su sitio).
      const order = results.map((_, i) => i).sort((a, b) => TIER_RANK[results[a].tier] - TIER_RANK[results[b].tier] || a - b);
      let done = 0;
      for (const i of order) {
        const r = results[i];
        const rk = TIER_RANK[r.tier];
        const el = slots[i].firstChild;
        if (!skip) {
          el.classList.add('focus');
          sfx('charge', 0);
          await wait(rk >= 3 ? 900 : rk >= 2 ? 450 : 220);
        }
        slots[i].replaceChildren(tmCard(r, 'flip'));
        counter.textContent = `${++done}/${results.length}`;
        if (!skip) {
          lv(r);
          sound(r);
          burst(fx, ...centerOf(slots[i]), r.tier === 'apex' ? '#ffcf3a' : TYPE_COLOR[r.type], 8 + rk * 14, { spread: 90 + rk * 45 });
          if (rk >= 3) { flash.className = 'gx-flash soft go'; buzz(40); }
          await wait([260, 320, 520, 800, 1100][rk]);
        }
      }
      skipAll.remove();
      hint.remove();
    }

    function summary() {
      const best = results.reduce((m, r) => (TIER_RANK[r.tier] > TIER_RANK[m.tier] ? r : m), results[0]);
      const line = multi ? h('div', { class: 'tg-summary' }, `Mejor MT: ${S.data.items[best.id].name} (${TIER_ES[best.tier]})`) : null;
      const btns = h('div', { class: 'gx-actions' },
        [1, 10].filter(again).map((n) => h('button', { class: 'btn big ' + (n === 10 ? 'gold' : 'primary'), type: 'button', onclick: () => close(n) }, againLabel(n))),
        h('button', { class: 'btn big', type: 'button', onclick: () => close(null) }, 'Continuar'));
      stage.append(...(line ? [line] : []), btns);
    }

    (async () => {
      if (!multi) await single(); else await pack();
      summary();
    })();
  });
}

/** Pestaña «Gacha MT» de la Tienda. */
export function tmGachaTab() {
  let info = null;
  const stage = h('div', { class: 'stack' });
  const left = () => (info ? info.limit - info.used : 0);
  const canPull = (n) => info && S.me.coins >= info.cost[n] && left() >= n;

  async function pull(count, btn) {
    if (btn) btn.disabled = true;
    const r = await act('tm:gacha', { count });
    if (btn) btn.disabled = false;
    if (!r) return;
    info.used = info.limit - r.left;
    paint();
    const again = await reveal(r.results, { again: (n) => canPull(n), againLabel: (n) => `Otra vez ×${n} · ${fmt(info.cost[n])}` });
    paint();
    if (again && canPull(again)) pull(again, null);
  }

  function paint() {
    if (!info) return;
    const odds = Object.entries(info.odds);
    stage.replaceChildren(
      h('div', { class: 'card stack tg-hero' },
        h('div', { class: 'tg-hero-row' },
          h('div', { class: 'tg-demo' }, disc(info.featured, 'apex', 'demo')),
          h('div', { class: 'grow' },
            h('h3', {}, '🎰 Gacha de MT'),
            h('p', { class: 'small muted' }, 'La vía rápida y divertida: tira y recibe una MT al azar (se gasta al usarla y se puede comerciar en el Mercado). Fabricarlas en la Máquina MT sale más barato, pero necesita materiales.'),
            h('div', { class: 'tg-feat' }, '⭐ Semana de tipo ', typeBadge(info.featured), h('span', { class: 'small muted' }, ` · sus MT salen ×${info.featuredBoost} dentro de cada nivel · cambia el lunes`)))),
        h('div', { class: 'pull-row' },
          h('button', { class: 'btn big primary', type: 'button', disabled: !canPull(1), onclick: (e) => pull(1, e.currentTarget) }, h('span', { class: 'coin-ico' }), ` Tirada ×1 · ${fmt(info.cost[1])}`),
          h('button', { class: 'btn big gold', type: 'button', disabled: !canPull(10), onclick: (e) => pull(10, e.currentTarget) }, h('span', { class: 'coin-ico' }), ` Tirada ×10 · ${fmt(info.cost[10])}`)),
        h('div', { class: 'small muted' }, `Tiradas de hoy: ${info.used}/${info.limit}. Sin pity: cada tirada es independiente.`)),
      h('div', { class: 'card stack' }, h('h3', {}, 'Probabilidades'),
        h('div', { class: 'tg-odds' }, odds.map(([k, p]) => h('div', { class: 'tg-odd', style: `--g:${TIER_COLOR[TIER_RANK[k]]}` }, h('b', {}, TIER_ES[k]), h('span', {}, pct(p)), h('span', { class: 'small muted' }, `${info.tiers[k]} MT`)))),
        h('p', { class: 'small muted' }, 'Primero se sortea el nivel y luego la MT dentro de él. Nunca se garantiza ninguna: de media, una tirada vale menos monedas que su precio, así que si buscas una MT concreta lo eficiente es fabricarla.')));
  }

  const load = async () => {
    await loadNames();
    info = await act('tm:gachainfo', {});
    if (!info) { stage.replaceChildren(h('div', { class: 'card stack' }, h('p', { class: 'muted' }, 'No se pudo cargar el Gacha de MT.'), h('button', { class: 'btn', type: 'button', onclick: load }, 'Reintentar'))); return; }
    paint();
  };
  const ready = load();
  ready.catch(() => {});
  const root = h('div', { class: 'stack' }, stage);
  const off = bus.on('me', () => { if (!root.isConnected) { off(); return; } paint(); });
  return root;
}

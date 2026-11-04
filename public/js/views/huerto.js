// Huerto de bayas (fase B3) y utilidades de vínculo compartidas con la Caja PC y el Vestíbulo.
import { S, h, fmt, act, emit, sfx, toast, item, modal } from '../core.js';
import { burstEl, reduced } from '../fx.js';

// ---- Utilidades de amistad (mismos umbrales que server/bond.js y affection.js) ----
export const LOVE_MIN = 220;
export const hearts = (f) => (f >= LOVE_MIN ? 5 : Math.min(4, Math.floor(f / 50)));
// Niveles: el servidor manda la tabla (S.data.bondTiers); esta es la de reserva.
const TIERS = [[255, 'Vínculo máximo'], [220, 'Te adora'], [200, 'Compañero fiel'], [150, 'Muy amistoso'], [100, 'Amistoso'], [0, 'Indiferente']];
export const friendLabel = (f) => (TIERS.find(([min]) => f >= min) || TIERS[5])[1];
export const friendTier = (f) => {
  const list = (S.data && S.data.bondTiers) || [];
  return [...list].reverse().find((t) => f >= t.min) || { min: 0, label: friendLabel(f), survive: 0, evade: 0, cure: 0, crit: 0 };
};
// Potencia actual de Retribución / Frustración según la amistad (null si el movimiento no depende de ella).
export const movePower = (move, f) => (move === 'return' ? Math.floor(f * 10 / 25) || 1 : move === 'frustration' ? Math.floor((255 - f) * 10 / 25) || 1 : null);
// Corazones que suben desde un elemento (caricias, efectos de afecto).
export function heartBurst(el, n = 8) {
  if (!el || reduced()) return;
  burstEl(el, '#ff7aa8', n, { spread: 70, stars: 0 });
  const r = el.getBoundingClientRect();
  for (let i = 0; i < Math.min(4, n); i++) {
    const d = h('span', { class: 'bd-heartfx', 'aria-hidden': 'true', style: { left: (r.left + r.width / 2 + (i - 1.5) * 18) + 'px', top: (r.top + r.height / 3) + 'px', animationDelay: (i * 120) + 'ms' } }, '💖');
    document.body.append(d);
    setTimeout(() => d.remove(), 1500 + i * 120);
  }
}
export function heartsEl(f, cls = '') {
  const n = hearts(f);
  return h('span', { class: `bd-hearts ${f >= LOVE_MIN ? 'love' : ''} ${cls}`, title: `${friendLabel(f)} (${f}/255)`, role: 'img', 'aria-label': `Amistad: ${friendLabel(f)}` },
    Array.from({ length: 5 }, (_, i) => h('i', { class: i < n ? 'on' : '' }, i < n ? '♥' : '♡')));
}

// Botón «Acariciar»: una vez al día por ejemplar (+2 de amistad). `onDone(r)` recibe la respuesta del servidor.
export function petButton({ id, uid, name, petted, maxed, ctx = 'pc', onDone }) {
  return h('button', { class: 'btn bd-pet', type: 'button', disabled: !!petted || !!maxed, title: maxed ? 'Amistad al máximo' : petted ? 'Hoy ya le has hecho mimos' : 'Acariciar: +2 de amistad (una vez al día)', onclick: async (e) => {
    const btn = e.currentTarget;
    const r = await act('pc:pet', { id, uid, ctx }, btn);
    if (!r) return;
    sfx('shiny');
    heartBurst(btn);
    toast(`${name} disfruta de tus mimos: +${r.gain} de amistad`, 'success');
    if (onDone) onDone(r);
  } }, petted ? '💖 Ya acariciado hoy' : '🤚 Acariciar');
}

const berries = () => S.data.berries || {};
export const berryImg = (id, cls = '') => h('img', { class: 'pixel bd-berry ' + cls, src: item(berries()[id].sprite), alt: berries()[id].name });
export const berryCount = (id) => ((S.me && S.me.berries) || {})[id] || 0;
export const berryIds = () => Object.keys(berries());

// ---- Hallazgos del compañero ----
const hm = (ms) => {
  const m = Math.max(1, Math.ceil(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};
function findText(r) {
  const out = [];
  if (r.candy) out.push(`${r.candy}× ${S.data.items['exp-xs'].name}`);
  if (r.berry) out.push(`${berries()[r.berry].name} ×${r.berryN}`);
  if (r.dust) out.push(`✦ ${r.dust} de polvo`);
  if (r.ticket) out.push('🎟️ 1 Ticket Gacha');
  if (r.coins) out.push(`🪙 ${r.coins} monedas`);
  return out.join(' · ');
}
// Bloque autónomo: botón «Tu compañero encontró algo» o cuenta atrás. Se repinta solo al recoger.
export function buddyFindBlock() {
  const me = S.me;
  if (!me || !me.buddy) return null;
  const f = me.buddyFinds || { n: 0, max: 3, nextAt: null };
  const name = S.dexById.get(me.buddy.id).name;
  const box = h('div', { class: 'bd-find' + (f.n > 0 ? ' ready' : '') });
  if (f.n > 0) {
    box.append(h('button', { class: 'btn gold bd-find-btn', onclick: async (e) => {
      const r = await act('buddy:collect', {}, e.currentTarget);
      if (!r) return;
      sfx('shiny');
      toast(`${name} encontró: ${findText(r.found)}`, 'success', 6000);
      if (!box.isConnected) return;
      const nb = buddyFindBlock();
      box.replaceWith(nb);
      burstEl(nb.querySelector('button, .bd-find-wait') || nb, '#ffd54f', 18, { spread: 120, stars: 0.6 });
    } }, `🎒 Tu compañero encontró algo${f.n > 1 ? ` (×${f.n})` : ''}`));
  } else {
    box.append(h('span', { class: 'bd-find-wait small muted' }, `🎒 ${name} anda buscando… ${f.nextAt ? 'Volverá en ' + hm(f.nextAt - Date.now()) : ''}`));
  }
  return box;
}

// ---- Vista del Huerto ----
const HOUR = 3600 * 1000;
const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh} h ${String(mm).padStart(2, '0')} min` : mm ? `${mm} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};

export default {
  id: 'huerto', title: 'Huerto', icon: '🌱',
  async mount(root) {
    let g = null;
    let skew = 0;
    let tick = 0;
    const grid = h('div', { class: 'bd-plots' });
    const bag = h('div', { class: 'bd-bag' });
    const findSlot = h('div', {});
    const nowMs = () => Date.now() + skew;
    const live = []; // { fill, label, plot } de las parcelas en crecimiento

    function apply(r) {
      if (r.now) skew = r.now - Date.now();
      g = r;
      render();
    }
    async function call(ev, payload, btn) {
      const r = await act(ev, payload, btn);
      if (r) apply(r);
      return r;
    }

    function pickBerry(i) {
      const owned = berryIds().filter((id) => berryCount(id) > 0);
      const m = modal(h('div', { class: 'stack' },
        h('p', { class: 'small muted' }, 'La baya que plantes es la semilla: cada una da 2-4 bayas de su clase al madurar.'),
        owned.length ? h('div', { class: 'bd-pick' }, owned.map((id) => {
          const b = berries()[id];
          return h('button', { class: 'bd-pick-item', onclick: async (e) => {
            const r = await call('garden:plant', { plot: i, berry: id }, e.currentTarget);
            if (r) { sfx('click'); m.close(); toast(`Plantaste ${b.name}: estará lista en ${b.grow} h`, 'success'); }
          } }, berryImg(id), h('b', {}, b.name), h('span', { class: 'small muted' }, `${b.grow} h · +${b.friend} ♥ · tienes ${berryCount(id)}`));
        })) : h('p', { class: 'muted' }, 'No te quedan bayas. Tu compañero puede encontrar más.')), { title: `Parcela ${i + 1}: plantar` });
    }

    function plotCard(p, i) {
      if (!p) {
        return h('div', { class: 'bd-plot empty' },
          h('div', { class: 'bd-soil' }, h('span', { class: 'bd-sprout', 'aria-hidden': 'true' }, '🟫')),
          h('b', {}, `Parcela ${i + 1}`), h('span', { class: 'small muted' }, 'Vacía'),
          h('button', { class: 'btn primary', onclick: () => pickBerry(i) }, '🌱 Plantar'));
      }
      const b = berries()[p.berry];
      const total = b.grow * HOUR;
      const left = p.readyAt - nowMs();
      const ready = left <= 0;
      const fill = h('i', { style: { width: (ready ? 100 : Math.min(100, Math.max(0, (1 - left / (p.watered ? total * 0.75 : total)) * 100))) + '%' } });
      const label = h('span', { class: 'small bd-count' }, ready ? '¡Lista para cosechar!' : clock(left));
      if (!ready) live.push({ p, fill, label, total });
      const card = h('div', { class: 'bd-plot' + (ready ? ' ready' : '') },
        h('div', { class: 'bd-soil' }, berryImg(p.berry, ready ? 'bd-bounce' : 'bd-grow')),
        h('b', {}, b.name), h('div', { class: 'bd-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, fill), label,
        ready
          ? h('button', { class: 'btn gold', onclick: async (e) => {
            const btn = e.currentTarget;
            const r = await call('garden:harvest', { plot: i }, btn);
            if (!r) return;
            sfx('win');
            toast(`Cosechaste ${r.got.n} × ${berries()[r.got.berry].name}`, 'success');
            popBerries(grid.children[i], r.got);
          } }, '🧺 Cosechar')
          : h('button', { class: 'btn', disabled: p.watered, onclick: async (e) => { if (await call('garden:water', { plot: i }, e.currentTarget)) { sfx('click'); toast('Regada: crece un 25 % más rápido', 'success'); } } }, p.watered ? '💧 Regada' : '💧 Regar (−25 %)'));
      return card;
    }
    function popBerries(card, got) {
      if (!card) return;
      if (!reduced()) burstEl(card, '#7ee081', 20, { spread: 140, stars: 0.5 });
      const rect = card.getBoundingClientRect();
      for (let k = 0; k < got.n; k++) {
        const el = berryImg(got.berry, 'bd-pop');
        el.style.cssText = `left:${rect.left + rect.width / 2 - 16 + (k - (got.n - 1) / 2) * 30}px;top:${rect.top + rect.height / 2 - 16}px;animation-delay:${k * 90}ms`;
        document.body.append(el);
        setTimeout(() => el.remove(), 1400 + k * 90);
      }
    }

    function render() {
      live.length = 0;
      grid.replaceChildren(...g.plots.map(plotCard));
      bag.replaceChildren(...berryIds().map((id) => {
        const b = berries()[id];
        const n = berryCount(id);
        return h('div', { class: 'bd-chip' + (n ? '' : ' none') }, berryImg(id), h('div', { class: 'grow' }, h('b', {}, b.name), h('div', { class: 'small muted' }, `+${b.friend} ♥ · ${b.grow} h`)), h('b', { class: 'bd-n' }, '×' + n));
      }));
      findSlot.replaceChildren(...[buddyFindBlock()].filter(Boolean));
    }

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🌱 Huerto de bayas')),
      h('p', { class: 'muted small' }, 'Planta una baya y espera a que madure: da 2-4 bayas. Riégala una vez para acelerarla un 25 %. Dáselas a tus Pokémon en la Caja PC para subir su amistad: con 220 de amistad te adoran (+3 % en duelos) y algunos evolucionan.'),
      findSlot,
      h('h2', { class: 'section-title' }, 'Parcelas'), grid,
      h('h2', { class: 'section-title' }, 'Tus bayas'), bag,
      h('p', { class: 'small muted' }, 'Las bayas no se compran ni se venden: lo mejor es dárselas a tus Pokémon. Si te sobran, ', h('a', { href: '#/workshop/recycle' }, '♻️ recíclalas en el Taller'), ' (1 ✦ por baya, hasta 20 ✦ al día).'));
    try { apply(await emit('garden:view')); } catch (e) { toast(e.message, 'error'); return; }
    tick = setInterval(() => {
      if (!grid.isConnected) { clearInterval(tick); return; } // la pantalla ya no está: no se queda un temporizador huérfano
      let ready = false;
      for (const l of live) {
        const left = l.p.readyAt - nowMs();
        if (left <= 0) { ready = true; break; }
        l.label.textContent = clock(left);
        l.fill.style.width = Math.min(100, Math.max(0, (1 - left / (l.p.watered ? l.total * 0.75 : l.total)) * 100)) + '%';
      }
      if (ready) render();
    }, 1000);
    this.stop = () => clearInterval(tick);
  },
  unmount() { this.stop && this.stop(); },
};

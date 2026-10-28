// Huerto de bayas (fase B3) y utilidades de vínculo compartidas con la Caja PC y el Vestíbulo.
import { S, h, fmt, act, emit, sfx, toast, item, modal } from '../core.js';
import { burstEl, reduced } from '../fx.js';

// ---- Utilidades de amistad (mismos umbrales que server/bond.js) ----
export const LOVE_MIN = 220;
export const hearts = (f) => (f >= LOVE_MIN ? 5 : Math.min(4, Math.floor(f / 50)));
export const friendLabel = (f) => (f >= LOVE_MIN ? 'Te adora' : f >= 160 ? 'Muy amistoso' : f >= 100 ? 'Amistoso' : 'Indiferente');
export function heartsEl(f, cls = '') {
  const n = hearts(f);
  return h('span', { class: `bd-hearts ${f >= LOVE_MIN ? 'love' : ''} ${cls}`, title: `${friendLabel(f)} (${f}/255)`, role: 'img', 'aria-label': `Amistad: ${friendLabel(f)}` },
    Array.from({ length: 5 }, (_, i) => h('i', { class: i < n ? 'on' : '' }, i < n ? '♥' : '♡')));
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
  if (r.candy) out.push(`🍬 ${r.candy} caramelos`);
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
        return h('div', { class: 'bd-chip' + (n ? '' : ' none') }, berryImg(id), h('div', { class: 'grow' }, h('b', {}, b.name), h('div', { class: 'small muted' }, `+${b.friend} ♥ · ${b.grow} h`)), h('b', { class: 'bd-n' }, '×' + n),
          h('button', { class: 'btn bd-mini', disabled: n < 1, title: `Reciclar 1 baya: +${S.data.recycleBerry.dust} ✦ (máx. ${S.data.recycleBerry.daily} ✦ al día)`, onclick: async (e) => {
            const r = await act('shop:recycle', { item: id, qty: 1 }, e.currentTarget);
            if (r) { sfx('click'); toast(`Reciclada: +${r.dust} ✦`, 'success'); render(); }
          } }, '♻️'));
      }));
      findSlot.replaceChildren(...[buddyFindBlock()].filter(Boolean));
    }

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🌱 Huerto de bayas')),
      h('p', { class: 'muted small' }, 'Planta una baya y espera a que madure: da 2-4 bayas. Riégala una vez para acelerarla un 25 %. Dáselas a tus Pokémon en la Caja PC para subir su amistad: con 220 de amistad te adoran (+3 % en duelos) y algunos evolucionan.'),
      findSlot,
      h('h2', { class: 'section-title' }, 'Parcelas'), grid,
      h('h2', { class: 'section-title' }, 'Tus bayas'), bag,
      h('p', { class: 'small muted' }, 'Las bayas no se compran ni se venden. Reciclar da 1 ✦ por baya (hasta 20 ✦ al día): es mejor dárselas a tus Pokémon.'));
    try { apply(await emit('garden:view')); } catch (e) { toast(e.message, 'error'); return; }
    tick = setInterval(() => {
      if (!grid.isConnected) return;
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

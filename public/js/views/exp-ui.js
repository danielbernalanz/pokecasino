// Caramelos Exp. y Chapas desde la Mochila: elegir el ejemplar (con su nivel y su barra de EXP) y la cantidad.
// En la Caja PC → Datos → Entrenar están los mismos controles para el Pokémon abierto.
import { S, h, act, emit, fmt, sfx, toast, modal, sprite, itemImg } from '../core.js';
import { expBar, levelUpFx, askEvolution } from './pc-fx.js';
import { openSpecimen } from './pc.js';

const label = (m) => m.nick || S.dexById.get(m.id).name;

// Elige un ejemplar de la Caja. `filter(m)` decide cuáles se ofrecen; `note(m)` es una línea extra por ejemplar.
export async function pickSpecimen({ title, filter = () => true, note = () => '', empty = 'No tienes ningún Pokémon que pueda usarlo.' }) {
  const r = await act('pc:box', {});
  if (!r) return null;
  const all = r.mons.filter((m) => filter(m)).sort((a, b) => a.level - b.level || a.id - b.id);
  return new Promise((resolve) => {
    let q = '';
    const grid = h('div', { class: 'pick-grid exp-pick', 'data-testid': 'specimen-pick' });
    const search = h('input', { type: 'search', placeholder: 'Buscar nombre, mote o nº…', class: 'grow', 'aria-label': 'Buscar Pokémon', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } });
    const draw = () => {
      const list = all.filter((m) => !q || label(m).toLowerCase().includes(q) || S.dexById.get(m.id).name.toLowerCase().includes(q) || String(m.id) === q.replace('#', ''));
      grid.replaceChildren(...(list.length ? list.slice(0, 80).map((m) => h('button', { class: `pick r-${S.dexById.get(m.id).rarity}${m.shiny ? ' shiny' : ''}`, type: 'button', 'data-uid': m.uid, onclick: () => { resolve(m); box.close(); } },
        h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: '' }), h('b', {}, `${m.shiny ? '✨ ' : ''}${label(m)}`), h('span', { class: 'small muted' }, `Nv. ${m.level}`), expBar(m, { compact: true }), note(m) ? h('span', { class: 'small muted' }, note(m)) : null))
        : [h('p', { class: 'muted' }, all.length ? 'Ninguno coincide con la búsqueda.' : empty)]));
      if (list.length > 80) grid.append(h('p', { class: 'small muted' }, `Mostrando 80 de ${list.length}: usa la búsqueda.`));
    };
    const box = modal(h('div', { class: 'stack' }, search, grid), { title, wide: true, onClose: () => resolve(null) });
    draw();
  });
}

// Cuántos usar y a por ello.
export async function useExpCandyDialog(itemId) {
  const it = S.data.items[itemId];
  const m = await pickSpecimen({ title: `⭐ ${it.name}: ¿a quién?`, filter: (x) => x.level < 100 && !x.away, note: (x) => `Faltan ${fmt(x.expHi - x.exp)} EXP`, empty: 'Todos tus Pokémon están al Nv. 100 o fuera.' });
  if (!m) return;
  const have = () => S.me.items[itemId] || 0;
  const per = it.expCandy;
  let qty = 1;
  const need = Math.max(1, Math.ceil((m.expHi - m.exp) / per));
  const maxUse = Math.min(have(), Math.ceil((m.expMax - m.exp) / per));
  const input = h('input', { type: 'number', min: 1, max: Math.max(1, have()), value: 1, class: 'exp-qty', 'aria-label': 'Cantidad', 'data-testid': 'bag-exp-qty', oninput: (e) => set(Number(e.target.value)) });
  const info = h('div', { class: 'small muted' });
  const set = (n) => { qty = Math.max(1, Math.min(have() || 1, Math.floor(n) || 1)); input.value = qty; info.textContent = `+${fmt(qty * per)} EXP · ${need} para el siguiente nivel`; };
  set(1);
  const box = modal(h('div', { class: 'stack' },
    h('div', { class: 'row gap' }, h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: '' }), h('div', { class: 'grow' }, h('b', {}, `${label(m)} · Nv. ${m.level}`), expBar(m))),
    h('div', { class: 'row gap wrap' }, itemImg(itemId), h('b', {}, `${it.name} ×${have()}`),
      h('button', { class: 'btn small', type: 'button', 'aria-label': 'Menos', onclick: () => set(qty - 1) }, '−'), input,
      h('button', { class: 'btn small', type: 'button', 'aria-label': 'Más', onclick: () => set(qty + 1) }, '+'),
      h('button', { class: 'btn small', type: 'button', onclick: () => set(need) }, 'Hasta el siguiente nivel'),
      h('button', { class: 'btn small', type: 'button', onclick: () => set(maxUse) }, 'Todos')),
    info,
    h('button', { class: 'btn primary', type: 'button', 'data-testid': 'bag-exp-use', onclick: async (e) => {
      const r = await act('pc:expcandy', { id: m.id, uid: m.uid, itemId, qty }, e.target);
      if (!r) return;
      box.close();
      sfx('click');
      if (!(r.evo && r.evo.length)) toast(`${label(m)}: +${fmt(r.exp)} EXP${r.to > r.from ? ` · ¡Nv. ${r.to}!` : ''}`, 'success'); // con aviso de evolución, el aviso flotante de nivel basta (no tapa los botones)
      if (r.to > r.from) levelUpFx({ id: m.id, shiny: m.shiny, name: label(m), from: r.from, to: r.to, learned: r.learned, pending: r.pending });
      if (r.evo && r.evo.length) await askEvolution({ id: m.id, uid: m.uid, shiny: m.shiny, name: label(m), to: r.evo });
    } }, 'Usar')), { title: `⭐ ${it.name}` });
}

// Chapas: se eligen el ejemplar (Nv. 50+) y la estadística en la ficha «Entrenar» de la Caja PC.
export async function useHyperDialog(itemId) {
  const hy = S.data.hyper;
  const it = S.data.items[itemId];
  const m = await pickSpecimen({ title: `🏋️ ${it.name}: ¿a quién?`, filter: (x) => x.level >= hy.minLevel && !x.away && x.ivs.some((v, i) => v < 31 && !(x.hyper && x.hyper[i])),
    note: (x) => `${(x.hyper || []).filter(Boolean).length}/6 entrenadas`, empty: `Ninguno de tus Pokémon llega al nivel ${hy.minLevel} (o ya tienen todo a 31).` });
  if (m) openSpecimen(m.uid, 'menu');
}

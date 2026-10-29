// Piezas compartidas por Expediciones y Criadero (fases B5 y B6).
import { S, h, emit, sprite, typeBadge } from '../core.js';

export const HOUR = 3600 * 1000;
export const label = (m) => m.nick || S.dexById.get(m.id).name;
export const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh} h ${String(mm).padStart(2, '0')} min` : mm ? `${mm} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};

// Todos los ejemplares de la Caja PC (con la marca `away` si están fuera).
export async function loadMons() {
  const r = await emit('pc:box');
  return r.mons;
}

// Ficha pequeña de un ejemplar: sprite, nombre, nivel y tipos.
export function monTile(m, { cls = '', mark = '' } = {}) {
  const p = S.dexById.get(m.id);
  return h('div', { class: 'afk-tile ' + cls },
    h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: '', loading: 'lazy', draggable: 'false' }),
    h('div', { class: 'afk-tile-txt' }, h('b', {}, `${m.shiny ? '✨ ' : ''}${label(m)}`), h('span', { class: 'small muted' }, `Nv. ${m.level} · #${String(m.id).padStart(3, '0')}`),
      h('span', { class: 'types' }, p.types.map(typeBadge))),
    mark ? h('span', { class: 'afk-mark' }, mark) : null);
}

/**
 * Selector de ejemplares de la Caja con búsqueda. `can(m)` → null (elegible) o motivo (deshabilitado).
 * `selected`: Set de uid. Devuelve { el, get() }.
 */
export function monPicker(mons, { max = 3, can = () => null, selected = new Set(), onChange = () => {}, mark = () => '' } = {}) {
  const list = h('div', { class: 'afk-pick' });
  const search = h('input', { type: 'search', placeholder: 'Buscar nombre, mote o nº…', 'aria-label': 'Buscar Pokémon', oninput: draw });
  function draw() {
    const q = search.value.trim().toLowerCase();
    const rows = mons.filter((m) => {
      if (selected.has(m.uid)) return true;
      const p = S.dexById.get(m.id);
      return !q || p.name.toLowerCase().includes(q) || (m.nick || '').toLowerCase().includes(q) || String(m.id) === q.replace('#', '');
    }).sort((a, b) => (selected.has(b.uid) - selected.has(a.uid)) || b.level - a.level || a.id - b.id).slice(0, 60);
    list.replaceChildren(...rows.map((m) => {
      const why = can(m);
      const on = selected.has(m.uid);
      return h('button', { type: 'button', class: 'afk-pick-item' + (on ? ' on' : ''), disabled: !!why && !on, 'aria-pressed': on ? 'true' : 'false', title: why || '',
        onclick: () => {
          if (on) selected.delete(m.uid);
          else if (selected.size < max) selected.add(m.uid);
          else return;
          onChange(); draw();
        } }, monTile(m, { mark: why && !on ? why : (on ? '✔' : mark(m)) }));
    }));
    if (!rows.length) list.append(h('p', { class: 'muted small' }, 'No hay Pokémon que coincidan.'));
  }
  draw();
  return { el: h('div', { class: 'stack' }, search, list), get: () => mons.filter((m) => selected.has(m.uid)), redraw: draw };
}

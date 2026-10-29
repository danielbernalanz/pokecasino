// Tienda de Combate (Puntos de Batalla) y la página «Objeto y habilidad» de la ficha de un Pokémon.
import { S, h, fmt, act, toast, sfx, itemImg } from '../core.js';
import { loadNames } from '../battle-screen.js';

const nameOfHold = (hold) => { const it = S.data.items['hi-' + hold]; if (it) return it.name; const b = Object.values(S.data.berries).find((x) => x.hold === hold); return b ? b.name : hold; };
const stock = (hold) => (S.me.items['hi-' + hold] || 0) + (S.data.berries ? Object.entries(S.data.berries).filter(([, b]) => b.hold === hold).reduce((a, [id]) => a + ((S.me.berries || {})[id] || 0), 0) : 0);

/** Pestaña de la Tienda. */
export function bpTab() {
  const bp = S.me.bp || 0;
  const entries = Object.entries(S.data.items).filter(([, it]) => it.bp);
  const group = (title, pred) => {
    const list = entries.filter(([, it]) => pred(it));
    return h('div', { class: 'stack' }, h('h3', {}, title), h('div', { class: 'shop-grid wide' }, list.map(([id, it]) => h('div', { class: 'shop-item item-card' }, itemImg(id, 'big'),
      h('div', { class: 'grow' }, h('b', {}, it.name), h('div', { class: 'small muted' }, it.desc), h('div', { class: 'small' }, `En tu mochila: ${S.me.items[id] || 0}`)),
      h('div', { class: 'stack' }, h('div', { class: 'mk-price' }, `🎖️ ${it.bp} PB`),
        h('button', { class: 'btn primary', disabled: bp < it.bp, onclick: async (e) => { const r = await act('bp:buy', { itemId: id }, e.target); if (r) { sfx('win'); toast(`Compraste ${it.name} (−${r.cost} PB)`, 'success'); } } }, 'Comprar'))))));
  };
  return h('div', { class: 'stack' },
    h('div', { class: 'card' }, h('h3', {}, `🎖️ Tienda de Combate · ${fmt(bp)} PB`),
      h('p', { class: 'small muted' }, 'Los Puntos de Batalla (PB) solo se ganan combatiendo: victorias contra la CPU (1–3 PB, máx. 30 al día) y combates contra jugadores (3 si ganas, 1 si pierdes, máx. 20 al día). No se pueden regalar, vender ni cambiar por monedas. Aquí se gastan en objetos para llevar en combate, mentas y habilidades. Se equipan desde Caja PC → Datos → Objeto.')),
    group('Objetos para llevar', (it) => it.held), group('Mentas (cambian el efecto de la naturaleza)', (it) => it.mint), group('Habilidades', (it) => it.capsule || it.patch));
}

/** Página «Objeto» de la ficha: objeto equipado, habilidad, mentas. `m` viene de pc:box. */
export async function gearPage(m, onChange) {
  await loadNames();
  const run = async (action, payload, msg, btn) => { const r = await act(action, { id: m.id, uid: m.uid, ...payload }, btn); if (r) { sfx('click'); if (msg) toast(msg(r), 'success'); onChange(); } };
  const holds = [...new Set([...Object.keys(S.me.items).filter((k) => k.startsWith('hi-')).map((k) => k.slice(3)),
    ...Object.entries(S.data.berries).filter(([id]) => (S.me.berries || {})[id] > 0).map(([, b]) => b.hold)])].filter((x) => stock(x) > 0 && x !== m.item);
  const owned = (pred) => Object.entries(S.me.items).filter(([id, n]) => n > 0 && S.data.items[id] && pred(S.data.items[id]));
  return h('div', { class: 'stack' },
    h('div', { class: 'pc-box' }, h('h4', {}, '🎒 Objeto equipado'),
      h('div', {}, m.item ? h('b', {}, nameOfHold(m.item)) : h('span', { class: 'muted' }, 'Ninguno')),
      m.item ? h('button', { class: 'btn small', type: 'button', onclick: (e) => run('pc:item', { item: '' }, () => 'Objeto guardado en la mochila', e.currentTarget) }, 'Quitar') : null,
      holds.length ? h('div', { class: 'row gap wrap' }, holds.map((x) => h('button', { class: 'btn small', type: 'button', onclick: (e) => run('pc:item', { item: x }, () => `${nameOfHold(x)} equipado`, e.currentTarget) }, `${nameOfHold(x)} ×${stock(x)}`)))
        : h('p', { class: 'small muted' }, 'No tienes objetos libres. Cómpralos en la Tienda de Combate (PB) o planta bayas en el Huerto.'),
      h('p', { class: 'small muted' }, 'Un objeto por Pokémon. En combates contra jugadores no se pueden repetir objetos en el equipo.')),
    h('div', { class: 'pc-box' }, h('h4', {}, `✨ Habilidad: ${m.ability}${m.ha ? ' (oculta)' : ''}`),
      h('div', { class: 'row gap wrap' }, owned((it) => it.capsule || it.patch).map(([id, n]) => h('button', { class: 'btn small', type: 'button', onclick: (e) => run('pc:use', { itemId: id }, (r) => `Ahora tiene ${r.name}`, e.currentTarget) }, `${S.data.items[id].name} ×${n}`)),
        owned((it) => it.capsule || it.patch).length ? null : h('span', { class: 'small muted' }, 'Cápsula (otra habilidad normal) y Parche (oculta) se compran con PB.'))),
    h('div', { class: 'pc-box' }, h('h4', {}, `🌿 Naturaleza ${m.nature}${m.mint ? ` · efecto de ${m.mint}` : ''}`),
      h('div', { class: 'row gap wrap' }, owned((it) => it.mint).map(([id, n]) => h('button', { class: 'btn small', type: 'button', onclick: (e) => run('pc:use', { itemId: id }, () => 'Efecto de naturaleza cambiado', e.currentTarget) }, `${S.data.items[id].name} ×${n}`)),
        owned((it) => it.mint).length ? null : h('span', { class: 'small muted' }, 'Las mentas se compran con PB.'))));
}

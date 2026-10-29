// Máquina MT (pestaña de la Tienda) y uso de MT: fabricar con monedas + materiales, enseñar a un Pokémon compatible.
import { S, h, fmt, act, emit, toast, sfx, modal, sprite, TYPE_ES, itemImg, typeBadge, bus } from '../core.js';
import { loadNames, moveEs, moveMeta, CAT } from '../battle-screen.js';
import { pickPokemon } from '../picker.js';
import { swapDialog } from './moves-ui.js';

const TIER_ES = { basic: 'Básica', good: 'Buena', strong: 'Fuerte', top: 'Élite', apex: 'Suprema' };
const norm = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tmItems = () => Object.entries(S.data.items).filter(([, it]) => it.tm).sort((a, b) => a[1].num - b[1].num);
const matIds = () => Object.entries(S.data.items).filter(([, it]) => it.material).map(([id]) => id);
const have = (id) => (S.me.items && S.me.items[id]) || 0;
const filter = { q: '', type: '', tier: '', show: 'all', compat: null, compatName: '' };

// Chip «material ×N».
export const matChip = (id, need) => h('span', { class: 'tm-mat' + (need !== undefined && have(id) < need ? ' lack' : ''), title: S.data.items[id].name },
  itemImg(id, 'tm-mat-img'), need !== undefined ? `${have(id)}/${need}` : `×${have(id)}`);

function statLine(move) {
  const m = moveMeta(move) || { cat: 'x', bp: 0, acc: 0, pp: 0 };
  return `${CAT[m.cat][0]} · ${m.bp ? 'Pot. ' + m.bp : 'Pot. —'} · ${m.acc ? 'Prec. ' + m.acc : 'Prec. —'} · PP ${m.pp}`;
}

/** Elige a quién enseñar una MT (solo ejemplares compatibles). `onDone` se llama al terminar. */
export async function useTmDialog(itemId, onDone) {
  await loadNames();
  const it = S.data.items[itemId];
  const r = await act('tm:targets', { itemId });
  if (!r) return;
  const rows = r.targets.map((t) => ({ ...t, p: S.dexById.get(t.id) })).sort((a, b) => Number(a.known) - Number(b.known) || a.id - b.id);
  const box = modal(h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, `${it.name} · ${statLine(it.tm)}. Se gasta al usarla. Solo aparecen los Pokémon que pueden aprenderla.`),
    rows.length ? h('div', { class: 'tm-targets' }, rows.map((t) => h('button', { class: 'pick' + (t.known ? ' known' : ''), type: 'button', disabled: t.known, onclick: async (ev) => {
      const res = await act('tm:use', { itemId, id: t.id, uid: t.uid }, ev.currentTarget);
      if (!res) return;
      sfx('win'); box.close();
      toast(res.how === 'equipped' ? `¡${t.p.name} aprendió ${moveEs(res.move)}!` : `${t.p.name} aprendió ${moveEs(res.move)} (queda guardado: equípalo en sus Movimientos).`, 'success');
      if (res.how !== 'equipped') await offerSwap(t.id, t.uid);
      if (onDone) onDone();
    } }, h('img', { class: 'pixel', src: sprite(t.id), alt: '' }), h('b', {}, t.p.name), h('span', { class: 'small muted' }, t.known ? 'Ya la conoce' : 'Puede aprenderla')))) : h('p', { class: 'muted' }, 'Ninguno de tus Pokémon puede aprender esta MT.')), { title: `💿 ${it.name}`, wide: true });
}
async function offerSwap(id, uid) {
  const r = await emit('pc:box');
  const m = r.mons.find((x) => x.uid === uid);
  if (m) swapDialog(m, null);
}

/** Desde la ficha de un ejemplar: sus MT utilizables de la mochila. */
export async function pcTmDialog(m, onChange) {
  await loadNames();
  const r = await act('tm:owned', { id: m.id, uid: m.uid });
  if (!r) return;
  const box = modal(h('div', { class: 'stack' },
    r.tms.length ? r.tms.map((t) => {
      const it = S.data.items[t.itemId];
      return h('div', { class: 'tm-row-use' }, itemImg(t.itemId), h('div', { class: 'grow' }, h('b', {}, `${it.name} ×${t.qty}`), h('div', { class: 'small muted' }, statLine(it.tm))),
        h('button', { class: 'btn primary', type: 'button', disabled: t.known, onclick: async (ev) => {
          const res = await act('tm:use', { itemId: t.itemId, id: m.id, uid: m.uid }, ev.currentTarget);
          if (!res) return;
          sfx('win'); box.close();
          m.eq = res.eq; m.learned = res.learned;
          toast(`¡${m.nick || S.dexById.get(m.id).name} aprendió ${moveEs(res.move)}!`, 'success');
          if (res.how !== 'equipped') await swapDialog(m, onChange); else if (onChange) onChange();
        } }, t.known ? 'Ya la conoce' : 'Enseñar'));
    }) : [h('p', { class: 'muted' }, 'No tienes MT que este Pokémon pueda aprender. Fabrícalas en la Máquina MT (Tienda) o consíguelas en el Mercado.'),
      h('a', { class: 'btn', href: '#/shop', onclick: () => box.close() }, 'Ir a la Máquina MT')]), { title: '💿 MT para ' + (m.nick || S.dexById.get(m.id).name) });
}

/** Pestaña «Máquina MT» de la Tienda. `redraw`: vuelve a pintar la vista al cambiar el inventario. */
export function machineTab() {
  const f = filter;
  const list = h('div', { class: 'tm-grid' });
  const count = h('div', { class: 'small muted' });
  let shown = 60;
  const matRow = h('div', { class: 'tm-mats' });
  const drawMats = () => matRow.replaceChildren(...matIds().map((id) => h('span', { class: 'tm-mat big' }, itemImg(id, 'tm-mat-img'), h('span', {}, S.data.items[id].name), h('b', {}, `×${have(id)}`))));
  const can = ([id, it]) => { const [coins, mats] = it.craft; return S.me.coins >= coins && Object.entries(mats).every(([m, n]) => have(m) >= n); };
  const card = ([id, it]) => {
    const [coins, mats] = it.craft;
    const n = have(id);
    return h('div', { class: 'tm-card' },
      itemImg(id, 'big'),
      h('div', { class: 'grow' },
        h('b', {}, it.name), h('div', { class: 'types' }, typeBadge(it.type), h('span', { class: 'small muted' }, ` ${TIER_ES[it.tier]}`)),
        h('div', { class: 'small muted' }, statLine(it.tm)),
        h('div', { class: 'tm-cost' }, h('span', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(coins)), Object.entries(mats).map(([m, q]) => matChip(m, q))),
        n ? h('div', { class: 'small good' }, `En tu mochila: ${n}`) : null),
      h('div', { class: 'stack tm-btns2' },
        h('button', { class: 'btn primary', type: 'button', disabled: !can([id, it]), onclick: async (ev) => {
          const r = await act('tm:craft', { move: it.tm }, ev.currentTarget);
          if (r) { sfx('win'); toast(`Fabricaste ${it.name}`, 'success'); draw(); drawMats(); }
        } }, 'Fabricar'),
        n ? h('button', { class: 'btn', type: 'button', onclick: () => useTmDialog(id, () => { draw(); drawMats(); }) }, 'Usar') : null));
  };
  const draw = () => {
    const q = norm(f.q.trim());
    const rows = tmItems().filter(([id, it]) => {
      if (f.type && it.type !== f.type) return false;
      if (f.tier && it.tier !== f.tier) return false;
      if (f.show === 'craft' && !can([id, it])) return false;
      if (f.show === 'owned' && !have(id)) return false;
      if (f.compat && !f.compat.has(it.tm)) return false;
      if (q && !(norm(it.name).includes(q) || norm(moveEs(it.tm)).includes(q) || String(it.num) === q.replace(/^(mt)?0*/, ''))) return false;
      return true;
    });
    count.textContent = `${fmt(rows.length)} MT`;
    list.replaceChildren(...(rows.length ? rows.slice(0, shown).map(card) : [h('p', { class: 'muted' }, 'Ninguna MT coincide con los filtros.')]));
    if (rows.length > shown) list.append(h('button', { class: 'btn', type: 'button', onclick: () => { shown += 60; draw(); } }, `Mostrar más (${rows.length - shown})`));
  };
  let timer = null;
  const search = h('input', { type: 'search', placeholder: 'Buscar movimiento o nº de MT…', value: f.q, autocomplete: 'off', oninput: (e) => { f.q = e.target.value; shown = 60; clearTimeout(timer); timer = setTimeout(draw, 150); } });
  const sel = (key, opts) => h('select', { onchange: (e) => { f[key] = e.target.value; shown = 60; draw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
  const compatChip = h('span', {});
  const drawCompat = () => compatChip.replaceChildren(f.compat
    ? h('button', { class: 'chip active', type: 'button', onclick: () => { f.compat = null; f.compatName = ''; drawCompat(); draw(); } }, `Compatible con ${f.compatName} ✕`)
    : h('button', { class: 'chip', type: 'button', onclick: async () => {
      const p = await pickPokemon({ title: '¿Compatible con qué Pokémon?' });
      if (!p) return;
      const r = await act('tm:compat', { id: p.id });
      if (!r) return;
      f.compat = new Set(r.moves); f.compatName = S.dexById.get(p.id).name; shown = 60; drawCompat(); draw();
    } }, '🔎 Compatible con…'));
  const ready = loadNames().then(() => { drawMats(); draw(); });
  drawCompat();
  const root = h('div', { class: 'stack' },
    h('div', { class: 'card stack' }, h('h3', {}, '💿 Máquina MT'),
      h('p', { class: 'small muted' }, 'Como en Escarlata/Púrpura: cada MT se fabrica con monedas y materiales de su tipo, se gasta al usarla y también puedes comprarlas y venderlas en el Mercado. Los materiales caen en las Expediciones y al ganar combates; algunas MT son premio raro (Expediciones largas y líderes de gimnasio).'),
      matRow),
    h('div', { class: 'filters' }, search,
      sel('type', [['', 'Cualquier tipo'], ...S.data.types.map((t) => [t, TYPE_ES[t]])]),
      sel('tier', [['', 'Cualquier precio'], ...Object.entries(TIER_ES)]),
      sel('show', [['all', 'Todas'], ['craft', 'Puedo fabricarlas'], ['owned', 'Las tengo']]), compatChip),
    count, list);
  ready.catch(() => {});
  // Se refresca con el inventario (monedas, materiales); se desuscribe solo cuando la pestaña deja de estar en pantalla.
  const off = bus.on('me', () => { if (!root.isConnected) { off(); return; } drawMats(); draw(); });
  return root;
}

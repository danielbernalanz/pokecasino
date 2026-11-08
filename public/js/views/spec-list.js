// Pokémon «de combate» y lista de ejemplares concretos (Mercado, regalos, liberar, transferir, GTS, intercambio).
// La definición de «de combate» es del servidor (server/protect.js): aquí solo se muestra y se pide confirmación.
import { S, h, act, emit, modal, sprite, typeBadge, itemImg, sfx } from '../core.js';

const label = (m) => m.nick || S.dexById.get(m.id).name;
const genderTag = (g) => (g === 'M' ? '♂' : g === 'F' ? '♀' : '');

// Distintivo «⚔️ Combate» con las razones en el tooltip. `b`: { protected, reasons }.
export function combatBadge(b, cls = '') {
  if (!b || !b.protected) return null;
  return h('span', { class: 'cmb-badge ' + cls, title: b.reasons.join('\n'), 'data-testid': 'combat-badge' }, '⚔️ Combate');
}

// Clave del objeto de la mochila de un objeto equipado (hold) y su icono.
const heldKey = (hold) => (S.data.items['hi-' + hold] ? 'hi-' + hold : Object.keys(S.data.items).find((k) => S.data.items[k].holdId === hold));
function heldIcon(hold) {
  const k = heldKey(hold);
  return k ? itemImg(k, 'cmb-item-ico') : null;
}

// Aviso para un ejemplar de combate. `verb`: «vender», «transferir»… Devuelve 'go' (confirmado), 'unteam' (quitar del equipo y seguir) o false.
// No se puede silenciar ni recordar: cada vez que se toca un ejemplar de combate hay que confirmarlo.
export function protectDialog({ items, verb = 'vender', go }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const teams = items.filter((x) => x.teams && x.teams.length);
    const many = items.length > 1;
    const body = h('div', { class: 'risk-box cmb-warn', role: 'alertdialog', 'aria-label': 'Pokémon de combate' },
      h('div', { class: 'risk-ico', 'aria-hidden': 'true' }, '⚔️'),
      h('h3', { class: 'risk-title' }, many ? `Vas a ${verb} ${items.length} Pokémon de combate` : `Este Pokémon es de combate`),
      h('p', { class: 'risk-text' }, `Lo has preparado para combatir y no se puede deshacer. ${many ? 'Son estos' : 'Es'}:`),
      h('ul', { class: 'risk-details cmb-list' }, items.slice(0, 8).map((x) => h('li', {}, h('b', {}, `${label(x)} Nv. ${x.level}`), ': ', x.reasons.join(' · ')))),
      items.length > 8 ? h('p', { class: 'small muted' }, `…y ${items.length - 8} más.`) : null,
      h('div', { class: 'risk-actions cmb-actions' },
        h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'combat-cancel', onclick: () => finish(false) }, 'Conservarlo'),
        teams.length ? h('button', { class: 'btn', type: 'button', 'data-testid': 'combat-unteam', onclick: () => finish('unteam') }, `Quitar del equipo y ${verb}`) : null,
        h('button', { class: 'btn risk-go', type: 'button', 'data-testid': 'combat-go', onclick: () => finish('go') }, go || `Sí, ${verb} ${many ? 'estos Pokémon de combate' : 'este Pokémon de combate'}`)));
    const m = modal(body, { title: '', onClose: () => finish(false) });
    m.el.classList.add('risk-wrap');
  });
}

// Quita un ejemplar de todos los equipos guardados de Combates.
export const removeFromTeams = (uids, btn) => act('protect:unteam', { uids }, btn);

// Tras el aviso: si eligió «quitar del equipo», lo quita; devuelve true si se puede seguir.
export async function resolveProtect(items, verb, btn) {
  const prot = items.filter((x) => x && x.battle ? x.battle.protected : x && x.protected);
  if (!prot.length) return { ok: true, confirmUids: [] };
  const flat = prot.map((x) => (x.battle ? { ...x, reasons: x.battle.reasons, teams: x.battle.teams || [], level: x.level, id: x.id, nick: x.nick } : x));
  const r = await protectDialog({ items: flat, verb });
  if (!r) return { ok: false, confirmUids: [] };
  if (r === 'unteam' && !(await removeFromTeams(prot.map((x) => x.uid), btn))) return { ok: false, confirmUids: [] };
  return { ok: true, confirmUids: prot.map((x) => x.uid) };
}

const BAR = (v, max, cls = '') => h('span', { class: 'cmb-bar ' + cls }, h('i', { style: { width: Math.min(100, (v / max) * 100) + '%' } }));

// Lista de los ejemplares de una especie con casillas: el jugador marca exactamente cuáles saca.
// opts: { id, shiny, count, onChange(n), itemNote }. itemNote: texto sobre el objeto equipado («vuelve a tu mochila» o «viaja con el Pokémon»).
export function specList({ id, shiny = false, count = 1, onChange = () => {}, itemNote = 'vuelve a tu mochila', preselect = null, single = false } = {}) {
  const wrap = h('div', { class: 'cmb-list-wrap', 'data-testid': 'spec-list' });
  const list = h('div', { class: 'cmb-rows' });
  const head = h('div', { class: 'cmb-head small muted' });
  wrap.append(head, list);
  let rows = [];
  const chosen = new Set();
  let ready = false;
  const free = () => rows.filter((r) => !r.blocked);
  const defaults = (n) => {
    chosen.clear();
    if (preselect) { for (const r of free().filter((x) => preselect.includes(x.uid) && !x.protected)) chosen.add(r.uid); return; }
    for (const r of free().filter((x) => !x.protected).slice(0, n)) chosen.add(r.uid);
  };
  function paintHead() {
    const prot = rows.filter((r) => chosen.has(r.uid) && r.protected).length;
    head.replaceChildren(`Marcados: ${chosen.size} de ${rows.length}`, prot ? h('b', { class: 'cmb-warn-txt' }, ` · ⚠ ${prot} de combate`) : '');
  }
  function row(r) {
    const on = chosen.has(r.uid);
    const chk = h('input', { type: 'checkbox', checked: on, disabled: !!r.blocked, 'aria-label': `Marcar ${label(r)} Nv. ${r.level}`, 'data-uid': r.uid,
      onchange: () => { if (chk.checked) { if (single) chosen.clear(); chosen.add(r.uid); } else chosen.delete(r.uid); paint(); onChange(chosen.size); } });
    const iv = r.ivTotal;
    return h('div', { class: 'cmb-row' + (on ? ' on' : '') + (r.protected ? ' prot' : '') + (r.blocked ? ' blocked' : ''), 'data-uid': r.uid, 'data-testid': 'spec-row' },
      h('label', { class: 'cmb-check' }, chk),
      h('img', { class: 'pixel cmb-spr', src: sprite(r.id, r.shiny), alt: '', loading: 'lazy' }),
      h('div', { class: 'cmb-main' },
        h('div', { class: 'cmb-title' }, h('b', {}, `${r.shiny ? '✨ ' : ''}${label(r)}`), ` ${genderTag(r.gender)} `, h('span', { class: 'cmb-lv' }, `Nv. ${r.level}`), combatBadge(r)),
        h('div', { class: 'small muted' }, `${r.nature} · ${r.ability}`),
        r.item ? h('div', { class: 'small cmb-item' }, heldIcon(r.item), h('span', {}, `Lleva ${r.itemName}: ${itemNote}`)) : null,
        h('div', { class: 'cmb-moves' }, r.moves.map((mv) => h('span', { class: `type t-${mv.type} cmb-mv`, title: mv.name }, mv.name))),
        h('div', { class: 'cmb-stats small' },
          h('span', { title: 'Suma de IV (máx. 186)' }, `IV ${iv}`), BAR(iv, 186, 'iv'),
          h('span', { title: 'Suma de EV (máx. 510)' }, `EV ${r.evTotal}`), BAR(r.evTotal, 510, 'ev')),
        r.protected ? h('div', { class: 'small cmb-why' }, r.reasons.join(' · ')) : null,
        r.blocked ? h('div', { class: 'small bad' }, r.blocked) : null),
      h('button', { class: 'btn small', type: 'button', onclick: async () => { const pc = await import('./pc.js'); pc.openSpecimen(r.uid); } }, '📋 Ver ficha'));
  }
  function paint() { list.replaceChildren(...rows.map(row)); paintHead(); }
  const loaded = emit('protect:list', { id, shiny }).then((r) => {
    rows = r.list;
    defaults(count);
    ready = true;
    paint();
    onChange(chosen.size);
  }).catch((e) => { list.replaceChildren(h('p', { class: 'bad small' }, e.message)); });
  return {
    el: wrap, loaded,
    get ready() { return ready; },
    get total() { return free().length; },
    rows: () => rows,
    uids: () => rows.filter((r) => chosen.has(r.uid)).map((r) => r.uid),
    protectedChosen: () => rows.filter((r) => chosen.has(r.uid) && r.protected),
    // El campo de cantidad cambia: se recoloca la elección (primero quita los de combate, después los últimos marcados).
    setCount(n) {
      if (!ready) { count = n; return; }
      if (n === chosen.size) return;
      if (n < chosen.size) {
        const order = rows.filter((r) => chosen.has(r.uid)).sort((a, b) => Number(b.protected) - Number(a.protected));
        for (const r of order.slice(0, chosen.size - n)) chosen.delete(r.uid);
      } else {
        for (const r of free().filter((x) => !x.protected && !chosen.has(x.uid))) { if (chosen.size >= n) break; chosen.add(r.uid); }
      }
      paint();
    },
  };
}

// Diálogo con la lista de ejemplares de una especie para elegir cuáles salen (regalar, liberar, transferir repetidos…).
// → Promise<{ uids, confirmUids } | null>. `shiny`: true/false/null (null = todas las versiones).
export function pickSpecimens({ id, shiny = false, count = 1, preselect = null, title, verb = 'vender', action, itemNote = 'vuelve a tu mochila', extra = null, exact = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const go = h('button', { class: 'btn primary big', type: 'button', disabled: true, 'data-testid': 'pick-go', onclick: async (e) => {
      const uids = spec.uids();
      const rows = spec.protectedChosen();
      const res = await resolveProtect(rows, verb, e.currentTarget);
      if (!res.ok) return;
      finish({ uids, confirmUids: res.confirmUids });
    } }, action || 'Confirmar');
    const spec = specList({ id, shiny, count, preselect, itemNote, single: exact && count === 1, onChange: (n) => { go.disabled = exact ? n !== count : n < 1; go.textContent = `${action || 'Confirmar'} (${n})`; } });
    const m = modal(h('div', { class: 'stack cmb-dlg' }, extra, h('p', { class: 'small muted' }, 'Marca exactamente qué ejemplares salen. Los de combate (⚔️) nunca vienen marcados.'), spec.el, h('div', { class: 'row gap wrap' }, go, h('button', { class: 'btn', type: 'button', onclick: () => finish(null) }, 'Cancelar'))), { title: title || 'Elige los ejemplares', wide: true, onClose: () => finish(null) });
  });
}

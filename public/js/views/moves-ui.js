// Movimientos de un ejemplar (Caja PC): los 4 equipados, cambiarlos entre los aprendidos y aprender los nuevos al subir de nivel.
import { S, h, act, modal, sfx, toast, TYPE_ES } from '../core.js';
import { loadNames, moveEs, moveMeta, CAT } from '../battle-screen.js';

const nameOf = (m) => m.nick || (S.dexById.get(m.id) || {}).name || '#' + m.id;

/** Fila de un movimiento: tipo, categoría, potencia, precisión y PP. */
export function moveRow(id, { sel = false, onclick = null, tag = null } = {}) {
  const mt = moveMeta(id) || { type: 'normal', cat: 'x', bp: 0, acc: 0, pp: 0 };
  const attrs = { class: 'mvrow t-' + mt.type + (sel ? ' sel' : '') + (onclick ? '' : ' static'), type: 'button' };
  if (onclick) attrs.onclick = onclick; else attrs.tabindex = -1;
  return h('button', attrs, h('b', {}, moveEs(id), tag ? h('span', { class: 'mv-tag' }, tag) : null), h('span', { class: 'mvr-ty' }, TYPE_ES[mt.type]), h('span', { title: CAT[mt.cat][0] }, CAT[mt.cat][1]),
    h('span', {}, mt.bp ? `Pot. ${mt.bp}` : '—'), h('span', {}, mt.acc ? `Prec. ${mt.acc}` : 'Prec. —'), h('span', { class: 'muted' }, `PP ${mt.pp}`));
}

/** Pantalla «Cambiar»: elige de 1 a 4 entre todos los movimientos aprendidos. */
export async function swapDialog(m, onChange) {
  await loadNames();
  let eq = [...m.eq];
  const filter = h('input', { type: 'search', placeholder: 'Buscar movimiento o tipo…', class: 'grow' });
  const cur = h('div', { class: 'mv-cur one' });
  const list = h('div', { class: 'mv-list' });
  const draw = () => {
    cur.replaceChildren(...[0, 1, 2, 3].map((i) => {
      const id = eq[i];
      return id ? moveRow(id, { sel: true, onclick: () => { if (eq.length < 2) { toast('Necesita al menos un movimiento.', 'error'); return; } eq = eq.filter((x) => x !== id); draw(); } }) : h('div', { class: 'mvrow empty' }, '— hueco libre —');
    }));
    const t = filter.value.trim().toLowerCase();
    const rest = m.learned.filter((x) => !eq.includes(x)).filter((x) => !t || moveEs(x).toLowerCase().includes(t) || (TYPE_ES[(moveMeta(x) || {}).type] || '').toLowerCase().includes(t))
      .sort((a, b) => ((moveMeta(b) || {}).bp || 0) - ((moveMeta(a) || {}).bp || 0) || moveEs(a).localeCompare(moveEs(b), 'es'));
    list.replaceChildren(...(rest.length ? rest.map((x) => moveRow(x, { onclick: () => {
      if (eq.length >= 4) { toast('Ya lleva 4 movimientos: quita uno primero.', 'error'); return; }
      eq.push(x); draw();
    } })) : [h('p', { class: 'muted small' }, 'No hay más movimientos aprendidos.')]));
  };
  filter.addEventListener('input', draw);
  const box = modal(h('div', { class: 'stack' },
    h('div', { class: 'small muted' }, `Movimientos de ${nameOf(m)} (de 1 a 4). Toca uno de arriba para quitarlo y uno de abajo para añadirlo. Solo puede llevar los que ya ha aprendido; los demás se quedan guardados.`),
    cur, h('h4', {}, `Aprendidos (${m.learned.length})`), h('div', { class: 'row gap' }, filter), list,
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn primary', type: 'button', onclick: async (ev) => {
        const r = await act('pc:moves', { id: m.id, uid: m.uid, moves: eq }, ev.currentTarget);
        if (r) { sfx('click'); m.eq = r.eq; box.close(); toast('Movimientos guardados.', 'success'); if (onChange) onChange(); }
      } }, 'Guardar'), h('button', { class: 'btn', type: 'button', onclick: () => box.close() }, 'Cancelar'))), { title: `⚙️ ${nameOf(m)}`, wide: true });
  draw();
}

/** Página «Movimientos» de la ficha. */
export function movesPage(m, onChange) {
  const eq = m.eq || [];
  return h('div', { class: 'stack' },
    m.pending && m.pending.length ? h('div', { class: 'pc-learn-note' }, `🆕 ¡${nameOf(m)} quiere aprender ${m.pending.length === 1 ? moveEs(m.pending[0]) : m.pending.length + ' movimientos'}!`,
      h('button', { class: 'btn primary small', type: 'button', onclick: () => learnPrompt(m, onChange) }, 'Decidir')) : null,
    h('div', { class: 'mv-cur one' }, eq.map((id) => moveRow(id))),
    h('div', { class: 'row gap wrap' }, h('button', { class: 'btn', type: 'button', onclick: () => swapDialog(m, onChange) }, '🔁 Cambiar movimientos'),
      h('button', { class: 'btn', type: 'button', onclick: () => tutorDialog(m, onChange) }, '🎓 Tutor'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { const { pcTmDialog } = await import('./tm-ui.js'); pcTmDialog(m, onChange); } }, '💿 Usar MT'),
      h('span', { class: 'small muted' }, `${m.learned.length} aprendidos · se cambian libremente fuera de combate.`)));
}

/** «¡X quiere aprender Y!»: olvida uno de los 4 o «No aprender» (se queda guardado para equiparlo luego). Resuelve cuando no queda nada pendiente. */
export async function learnPrompt(m, onChange) {
  await loadNames();
  const queue = [...(m.pending || [])];
  const next = () => {
    const mv = queue.shift();
    if (!mv) { if (onChange) onChange(); return; }
    const done = async (replace, btn, equip = false) => {
      const r = await act('pc:learn', { id: m.id, uid: m.uid, move: mv, replace: replace || '', equip }, btn);
      if (!r) return;
      m.eq = r.eq; m.learned = r.learned; m.pending = r.pending;
      sfx(replace ? 'win' : 'click');
      box.close();
      toast(replace ? `${nameOf(m)} olvidó ${moveEs(replace)} y aprendió ${moveEs(mv)}.` : equip ? `${nameOf(m)} aprendió ${moveEs(mv)}.` : `${nameOf(m)} no aprendió ${moveEs(mv)} (queda guardado: puedes equiparlo luego).`, 'success');
      next();
    };
    const box = modal(h('div', { class: 'stack' },
      h('p', {}, `¡${nameOf(m)} quiere aprender `, h('b', {}, moveEs(mv)), m.eq.length >= 4 ? '! Pero ya conoce 4 movimientos. ¿Cuál olvida?' : '!'),
      moveRow(mv, { tag: 'nuevo' }),
      m.eq.length < 4 ? h('button', { class: 'btn primary', type: 'button', onclick: (ev) => done('', ev.currentTarget, true) }, 'Aprender') : null,
      h('div', { class: 'mv-cur one' }, m.eq.map((id) => moveRow(id, { onclick: m.eq.length >= 4 ? (ev) => done(id, ev.currentTarget) : null }))),
      h('button', { class: 'btn', type: 'button', onclick: (ev) => done('', ev.currentTarget) }, 'No aprender (se guarda para luego)')), { title: '🆕 Nuevo movimiento' });
  };
  next();
}

/** Tutor de movimientos: movimientos de tutor a cambio de Fragmentos de expedición. */
export async function tutorDialog(m, onChange) {
  await loadNames();
  const r = await act('tutor:list', { id: m.id, uid: m.uid });
  if (!r) return;
  const have = (c) => S.me.items[c] || 0;
  const box = modal(h('div', { class: 'stack' },
    h('p', { class: 'small muted' }, 'El Tutor enseña estos movimientos por 4 Fragmentos del color de su tipo (Rojo, Azul, Amarillo o Verde). Los fragmentos caen, de uno en uno, en las Expediciones largas (máx. 3 al día).'),
    r.moves.length ? r.moves.map((x) => h('div', { class: 'tm-row-use' }, h('div', { class: 'grow' }, moveRow(x.move)),
      h('button', { class: 'btn primary', type: 'button', disabled: x.known || have(x.color) < x.cost, onclick: async (ev) => {
        const res = await act('tutor:learn', { id: m.id, uid: m.uid, move: x.move }, ev.currentTarget);
        if (!res) return;
        sfx('win'); box.close(); m.eq = res.eq; m.learned = res.learned;
        toast(`¡${nameOf(m)} aprendió ${moveEs(x.move)}!`, 'success');
        if (res.how !== 'equipped') await swapDialog(m, onChange); else if (onChange) onChange();
      } }, x.known ? 'Ya lo sabe' : `${x.cost} × ${(S.data.items[x.color] || {}).name || x.color} (tienes ${have(x.color)})`))) : [h('p', { class: 'muted' }, 'Este Pokémon no aprende nada del Tutor.')]), { title: '🎓 Tutor de movimientos', wide: true });
}

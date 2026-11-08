// Intercambio directo entre dos jugadores conectados (server/trade.js): invitación, cada uno elige un ejemplar, ve el del otro y los dos confirman.
import { S, h, act, emit, bus, sfx, toast, modal, sprite, typeBadge, itemName, TYPE_ES, loader } from '../core.js';
import { monPicker, loadMons } from './afk-common.js';
import { resolveProtect } from './spec-list.js';

const dex = (id) => S.dexById.get(Number(id));
const sexTag = (g) => (g === 'M' ? '♂' : g === 'F' ? '♀' : '');
const ballName = (b) => (b && S.data.items[b] ? S.data.items[b].name : b || 'Poké Ball');

// Resumen de solo lectura de un ejemplar (lo que se enseña al otro antes de confirmar).
export function tradeCard(s, who) {
  if (!s) return h('div', { class: 'trd-card empty' }, h('p', { class: 'muted' }, 'Aún no ha elegido ningún Pokémon.'));
  const p = dex(s.id);
  const rows = [['Naturaleza', s.nature], ['Habilidad', s.ability || '—'], ['Ball', ballName(s.ball)], ['Entrenador original', `${s.otn} · ID ${s.ot}`], ['Objeto', s.item ? itemName(s.item) : '—'], ['Teratipo', s.tera ? TYPE_ES[s.tera] : '—'], ['IV (suma)', `${s.ivSum}/186`]];
  return h('div', { class: 'trd-card' },
    h('div', { class: 'trd-top' },
      h('img', { class: 'pixel', src: sprite(s.id, s.shiny), alt: '' }),
      h('div', { class: 'grow' }, h('b', {}, `${s.shiny ? '✨ ' : ''}${s.nick || p.name} ${sexTag(s.gender)}`), h('div', { class: 'small muted' }, `Nv. ${s.level}${s.nick ? ` · ${p.name}` : ''}`), h('div', { class: 'types' }, p.types.map(typeBadge)))),
    h('dl', { class: 'trd-dl' }, rows.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]).flat()),
    s.moves.length ? h('div', { class: 'trd-moves small' }, s.moves.map((m) => h('span', { class: 'trn-chip' }, m))) : null);
}

export default {
  id: 'trade', title: 'Intercambio', icon: '🔁',
  async mount(root) {
    let st = null;
    let alive = true;
    const body = h('div', { class: 'trd-body' }, loader());
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🔁 Intercambio'), h('p', { class: 'muted' }, 'Cambia un Pokémon con otro entrenador conectado, como en el intercambio en línea de los juegos. Sin comisión.')), body);

    const apply = (r) => { if (r && alive) { st = { ...(st || {}), ...r }; draw(); } };
    async function load() { try { apply(await emit('trade:state')); } catch (e) { toast(e.message, 'error'); } }

    function inviteCard() {
      const sel = h('select', { 'aria-label': 'Jugador' }, (S.online || []).filter((u) => u.username !== S.me.username && !u.npc).map((u) => h('option', { value: u.username }, u.username)));
      const name = h('input', { list: 'trd-online', placeholder: 'Nombre del jugador conectado', 'aria-label': 'Jugador' });
      return h('form', { class: 'card stack', onsubmit: async (e) => { e.preventDefault(); const to = name.value.trim() || sel.value; if (!to) return; const r = await act('trade:invite', { to }, e.submitter); if (r) { sfx('click'); apply(r); } } },
        h('h3', {}, '🤝 Invitar a un jugador'),
        h('p', { class: 'small muted' }, 'Los dos tenéis que estar conectados. Cada uno elige un Pokémon de su Caja; os los enseñáis y, si los dos confirmáis, se intercambian al momento con todos sus rasgos (IV, naturaleza, Ball, entrenador original, nivel, objeto y movimientos; no EVs ni amistad).'),
        h('div', { class: 'row gap wrap' }, name, h('datalist', { id: 'trd-online' }, (S.online || []).filter((u) => u.username !== S.me.username && !u.npc).map((u) => h('option', { value: u.username }))), h('button', { class: 'btn primary' }, 'Invitar')),
        st.blocked ? h('p', { class: 'small bad' }, st.blocked) : h('p', { class: 'small muted' }, `Intercambios de hoy: te quedan ${st.left}/${st.max} (se comparten con la GTS). Mismos topes que los regalos: 10 Pokémon y 2 legendarios o míticos recibidos al día.`));
    }

    async function choose() {
      const mons = await loadMons();
      const sel = new Set();
      let m = null;
      const go = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: async (e) => { if (!m) return; const cb = await resolveProtect([m], 'intercambiar', e.currentTarget); if (!cb.ok) return; const r = await act('trade:offer', { id: m.id, uid: m.uid, confirmUids: cb.confirmUids }, e.currentTarget); if (r) { sfx('click'); mdl.close(); apply(r); } } }, 'Ofrecer este Pokémon');
      const pk = monPicker(mons, { max: 1, selected: sel, combat: true, onChange: () => { m = pk.get()[0] || null; go.disabled = !m; }, rank: (x) => x.level,
        can: (x) => (x.away ? (x.away === 'care' ? 'En el Criadero' : 'De expedición') : x.buddy ? 'Compañero' : null) });
      const mdl = modal(h('div', { class: 'stack' }, pk.el, go), { title: 'Elige el Pokémon que ofreces' });
    }

    function roomCard(r) {
      if (r.state === 'invited') {
        return h('div', { class: 'card stack trd-wait' },
          h('h3', {}, r.inviter ? `Esperando a que ${r.with} acepte…` : `${r.with} te invita a intercambiar`),
          r.inviter ? h('p', { class: 'muted small' }, 'La invitación caduca a los 2 minutos.') : h('p', { class: 'muted small' }, 'Si aceptas, os pondréis a elegir un Pokémon cada uno. No se mueve nada hasta que los dos confirméis.'),
          h('div', { class: 'row gap' },
            r.inviter ? null : h('button', { class: 'btn primary', type: 'button', onclick: async (e) => { const x = await act('trade:accept', { id: r.id }, e.currentTarget); if (x) { sfx('click'); apply(x); } } }, 'Aceptar'),
            h('button', { class: 'btn', type: 'button', onclick: async (e) => { const x = await act('trade:leave', {}, e.currentTarget); if (x) apply(x); } }, r.inviter ? 'Retirar invitación' : 'Rechazar')));
      }
      const both = !!(r.mine.offer && r.theirs.offer);
      const side = (title, content, extra) => h('section', { class: 'trd-side' }, h('h3', {}, title), content, extra);
      const confirmBtn = r.mine.confirmed
        ? h('button', { class: 'btn', type: 'button', onclick: async (e) => { const x = await act('trade:unconfirm', {}, e.currentTarget); if (x) apply(x); } }, '↩️ Quitar mi confirmación')
        : h('button', { class: 'btn primary big', type: 'button', disabled: !both, onclick: async (e) => {
          const x = await act('trade:confirm', {}, e.currentTarget);
          if (!x) { await load(); return; }
          if (x.done) { sfx('win'); toast(`¡Intercambio hecho! Recibes ${dex(x.done.got).name}.`, 'success'); }
          apply(x);
        } }, '✅ Confirmar intercambio');
      return h('div', { class: 'stack' },
        h('div', { class: 'trd-grid' },
          side('Tu oferta', tradeCard(r.mine.offer), h('div', { class: 'row gap wrap' }, h('button', { class: 'btn', type: 'button', onclick: choose }, r.mine.offer ? '🔄 Cambiar Pokémon' : '➕ Elegir Pokémon'),
            r.mine.offer ? h('button', { class: 'btn small', type: 'button', onclick: async (e) => { const x = await act('trade:offer', { uid: '' }, e.currentTarget); if (x) apply(x); } }, 'Quitar') : null), ),
          h('div', { class: 'trd-arrow', 'aria-hidden': 'true' }, '⇄'),
          side(`Oferta de ${r.with}`, tradeCard(r.theirs.offer), h('div', { class: 'small ' + (r.theirs.confirmed ? 'good' : 'muted') }, r.theirs.confirmed ? '✅ Ha confirmado' : both ? 'Aún no ha confirmado' : 'Esperando su oferta…'))),
        h('div', { class: 'card row gap wrap between' },
          h('span', { class: 'small muted' }, r.mine.confirmed ? `✅ Has confirmado: esperando a ${r.with}.` : 'Cualquier cambio de oferta anula las confirmaciones. Revisa bien lo que recibes: no hay vuelta atrás.'),
          h('div', { class: 'row gap' }, confirmBtn, h('button', { class: 'btn danger', type: 'button', onclick: async (e) => { const x = await act('trade:leave', {}, e.currentTarget); if (x) { toast('Has cancelado el intercambio: no se ha movido nada.', 'info'); apply(x); } } }, 'Cancelar'))));
    }

    function draw() {
      if (!st) return;
      body.replaceChildren(st.room ? roomCard(st.room) : inviteCard());
    }
    const offs = [
      bus.on('trade:room', (p) => { if (alive && p && p.room) apply({ room: p.room }); }),
      bus.on('trade:closed', (p) => { if (!alive) return; toast(p && p.reason ? p.reason : 'La sala de intercambio se ha cerrado.', 'info', 5000); load(); }),
      bus.on('trade:done', () => { if (alive) load(); }),
    ];
    this.cleanup = () => { alive = false; offs.forEach((f) => f && f()); };
    await load();
  },
  unmount() { if (this.cleanup) this.cleanup(); },
};

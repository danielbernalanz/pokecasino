// Teratipo de un ejemplar (ficha de la Caja PC) y cambio con Teralitos (ver server/tera.js).
import { S, h, act, sfx, toast, modal, typeBadge, itemImg, TYPE_ES } from '../core.js';

export const TYPE_COLOR = { normal: '#c9c5b8', fire: '#ff7a2f', water: '#4fa3ff', electric: '#ffe03a', grass: '#6fd45a', ice: '#9be9f5', fighting: '#d9553a', poison: '#b45fd1', ground: '#d6b25c', flying: '#a9b8ff', psychic: '#ff6fa8', bug: '#a8c534', rock: '#b9a45e', ghost: '#7d62b8', dragon: '#6a5cff', dark: '#6b574a', steel: '#b8c2d1', fairy: '#ffadd6' };
const cfg = () => S.data.tera;
const shards = (t) => (S.me.items || {})[`tera-shard-${t}`] || 0;

export function teraRow(m, onDone) {
  const cur = m.tera;
  const openChange = () => {
    const wrap = h('div', { class: 'stack tera-pick' });
    const mdl = modal(wrap, { title: '💎 Cambiar el Teratipo' });
    wrap.append(h('p', { class: 'small muted' }, `Con ${cfg().per} Teralitos de un tipo, el Teratipo de este Pokémon pasa a ser ese tipo. Los Teralitos caen de las Teraincursiones.`),
      h('div', { class: 'tera-types' }, cfg().types.map((t) => {
        const n = shards(t);
        const ok = n >= cfg().per && t !== cur;
        return h('button', { class: `tera-type t-${t}` + (t === cur ? ' cur' : ''), type: 'button', disabled: !ok, 'data-type': t, title: t === cur ? 'Es su Teratipo actual' : n >= cfg().per ? `Cambiar a ${TYPE_ES[t]}` : `Te faltan ${cfg().per - n} Teralitos`, onclick: async (e) => {
          const r = await act('tera:set', { id: m.id, uid: m.uid, type: t }, e.currentTarget);
          if (!r) return;
          sfx('shiny'); toast(`Teratipo cambiado a ${TYPE_ES[t]}`, 'success');
          mdl.close();
          m.tera = r.tera;
          if (onDone) onDone();
        } }, itemImg(`tera-shard-${t}`, 'tera-shard-img'), h('b', {}, TYPE_ES[t]), h('small', {}, `${n}/${cfg().per}`));
      })));
  };
  return h('div', { class: 'small row gap wrap tera-row', 'data-testid': 'pc-tera' },
    h('b', {}, '💎 Teratipo: '), typeBadge(cur),
    h('button', { class: 'btn small', type: 'button', 'data-testid': 'tera-change', title: 'Cambiar con Teralitos', onclick: openChange }, 'Cambiar'));
}

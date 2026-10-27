import { S, h, fmt, act, sfx, toast, sprite, art, modal, typeBadge, rarityName, TYPE_ES, bus } from '../core.js';

let filter = { q: '', show: 'all', rarity: '', type: '' };

export function openDetail(id) {
  const p = S.dexById.get(id);
  const c = S.me.collection[id];
  let shiny = false;
  const big = h('img', { class: 'detail-art' + (c ? '' : ' silhouette'), src: art(id), alt: p.name });
  const toggle = c && c.s > 0 ? h('button', { class: 'btn', onclick: () => { shiny = !shiny; big.src = art(id, shiny); toggle.textContent = shiny ? 'Ver normal' : 'Ver variocolor ✨'; } }, 'Ver variocolor ✨') : null;
  const r = S.data.rarity[p.rarity];
  const giftTo = h('input', { list: 'gift-users', placeholder: 'Entrenador' });
  const actions = c ? h('div', { class: 'stack' },
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn primary', onclick: async (e) => { if (await act('buddy:set', { id, shiny: false }, e.target)) { toast(`${p.name} es tu compañero`, 'success'); sfx('win'); } } }, '🤝 Compañero'),
      c.s > 0 ? h('button', { class: 'btn gold', onclick: async (e) => { if (await act('buddy:set', { id, shiny: true }, e.target)) { toast(`${p.name} ✨ es tu compañero`, 'success'); sfx('shiny'); } } }, '✨ Compañero variocolor') : null,
      c.n > 1 ? h('button', { class: 'btn', onclick: async (e) => { if (await act('shop:release', { id, count: 1 }, e.target)) { toast(`Liberaste una copia: +${r.dust} ✦`, 'success'); m.close(); openDetail(id); } } }, `Liberar 1 copia (+${r.dust} ✦)`) : null),
    h('div', { class: 'row gap wrap' }, giftTo,
      h('datalist', { id: 'gift-users' }, S.online.filter((u) => u.username !== S.me.username).map((u) => h('option', { value: u.username }))),
      h('button', { class: 'btn', onclick: async (e) => {
        const to = giftTo.value.trim();
        if (!to) return toast('Escribe el nombre del entrenador.', 'error');
        if (!confirm(`¿Regalar ${p.name} a ${to}? Perderás una copia.`)) return;
        if (await act('gift:poke', { to, id, shiny: false }, e.target)) { toast('¡Regalo enviado!', 'success'); m.close(); }
      } }, '🎁 Regalar copia'))) : h('div', { class: 'stack' },
    h('p', { class: 'muted' }, '¿Quién es ese Pokémon? Aún no lo has atrapado.'),
    h('a', { class: 'btn', href: '#/shop', onclick: () => m.close() }, `Fabricar por ${fmt(r.craft)} ✦`));
  const m = modal(h('div', { class: 'detail' },
    h('div', { class: 'detail-left r-' + p.rarity }, big, toggle),
    h('div', { class: 'stack' },
      h('h2', {}, `#${String(id).padStart(3, '0')} ${p.name}`),
      h('div', { class: 'types' }, p.types.map(typeBadge)),
      h('div', {}, h('span', { class: 'rar r-' + p.rarity }, rarityName(p.rarity))),
      c ? h('div', {}, h('span', { class: 'stars big' }, '★'.repeat(Math.min(5, c.n)) + '☆'.repeat(5 - Math.min(5, c.n))), h('span', { class: 'muted' }, ` · ${c.n} copia(s)${c.s ? ` · ${c.s} variocolor` : ''}`)) : null,
      h('p', { class: 'small muted' }, `Como compañero: +${(r.bonus * 100).toFixed(0)} % base, +0,5 % por estrella extra, +2 % si es variocolor.`),
      actions)), { title: 'Pokédex', wide: true });
}

export default {
  id: 'pokedex', title: 'Pokédex', icon: '📕',
  mount(root) {
    const grid = h('div', { class: 'dex-grid' });
    const counter = h('div', { class: 'dex-count' });
    const search = h('input', { placeholder: 'Buscar por nombre…', value: filter.q, oninput: (e) => { filter.q = e.target.value; render(); } });
    const sel = (key, opts) => {
      const s = h('select', { onchange: (e) => { filter[key] = e.target.value; render(); } }, opts.map(([v, l]) => h('option', { value: v, selected: filter[key] === v }, l)));
      return s;
    };
    function render() {
      const col = S.me.collection;
      const owned = Object.keys(col).length;
      const shinies = Object.values(col).filter((c) => c.s > 0).length;
      counter.replaceChildren(h('b', {}, `${owned}/${S.data.dex.length}`), ' atrapados · ', h('b', {}, shinies), ' variocolor',
        h('div', { class: 'pity-bar' }, h('i', { style: { width: (owned / S.data.dex.length) * 100 + '%' } })));
      const q = filter.q.trim().toLowerCase();
      const list = S.data.dex.filter((p) => {
        const c = col[p.id];
        if (filter.show === 'owned' && !c) return false;
        if (filter.show === 'missing' && c) return false;
        if (filter.show === 'shiny' && !(c && c.s)) return false;
        if (filter.rarity && p.rarity !== filter.rarity) return false;
        if (filter.type && !p.types.includes(filter.type)) return false;
        if (q && !(c ? p.name.toLowerCase().includes(q) : String(p.id).includes(q))) return false;
        return true;
      });
      grid.replaceChildren(...list.map((p) => {
        const c = col[p.id];
        const isBuddy = S.me.buddy && S.me.buddy.id === p.id;
        return h('button', { class: `dex-card r-${p.rarity}${c ? '' : ' missing'}${c && c.s ? ' shiny' : ''}${isBuddy ? ' buddy' : ''}`, onclick: () => openDetail(p.id) },
          h('span', { class: 'dex-no' }, '#' + String(p.id).padStart(3, '0')),
          h('img', { class: 'pixel', src: sprite(p.id, !!(c && c.s)), alt: c ? p.name : '?', loading: 'lazy' }),
          h('b', {}, c ? p.name : '???'),
          c ? h('span', { class: 'stars' }, '★'.repeat(Math.min(5, c.n))) : h('span', { class: 'stars dim' }, '—'),
          isBuddy ? h('span', { class: 'buddy-tag' }, '🤝') : null);
      }));
    }
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '📕 Pokédex'), counter),
      h('div', { class: 'filters' }, search,
        sel('show', [['all', 'Todos'], ['owned', 'Atrapados'], ['missing', 'Faltan'], ['shiny', 'Variocolor']]),
        sel('rarity', [['', 'Cualquier rareza'], ...['M', 'L', 'E', 'R', 'U', 'C'].map((r) => [r, rarityName(r)])]),
        sel('type', [['', 'Cualquier tipo'], ...S.data.types.map((t) => [t, TYPE_ES[t]])])),
      grid);
    render();
    this.off = bus.on('me', render);
  },
  unmount() { this.off(); },
};

import { S, h, fmt, act, sfx, toast, sprite, rarityName, bus, RARITY_ORDER } from '../core.js';
import { openDetail } from './pokedex.js';

export default {
  id: 'shop', title: 'Tienda Estelar', icon: '✦',
  mount(root) {
    const list = h('div', { class: 'shop-grid' });
    const dustInfo = h('b', {});
    const amount = h('input', { type: 'number', min: 1, value: 100 });
    let onlyMissing = true;
    function render() {
      dustInfo.textContent = fmt(S.me.dust) + ' ✦';
      const items = S.data.dex.filter((p) => !onlyMissing || !S.me.collection[p.id])
        .sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || a.id - b.id);
      list.replaceChildren(...items.map((p) => {
        const cost = S.data.rarity[p.rarity].craft;
        const c = S.me.collection[p.id];
        return h('div', { class: `shop-item r-${p.rarity}` },
          h('img', { class: 'pixel' + (c ? '' : ' silhouette'), src: sprite(p.id), alt: '', loading: 'lazy', onclick: () => openDetail(p.id) }),
          h('div', { class: 'grow' }, h('b', {}, c ? p.name : '???'), h('div', { class: 'small muted' }, rarityName(p.rarity) + (c ? ` · ${'★'.repeat(Math.min(5, c.n))}` : ''))),
          h('button', { class: 'btn', disabled: S.me.dust < cost || (c && c.n >= 5), onclick: async (e) => {
            const r = await act('shop:craft', { id: p.id }, e.target);
            if (r) { sfx('win'); toast(`¡Fabricaste ${r.name}!`, 'success'); }
          } }, `${fmt(cost)} ✦`));
      }));
    }
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '✦ Tienda Estelar'), h('div', { class: 'pill dust' }, 'Tienes ', dustInfo)),
      h('div', { class: 'cards3' },
        h('div', { class: 'card stack' }, h('h3', {}, '💱 Cambiar polvo por monedas'),
          h('p', { class: 'muted small' }, `1 ✦ = ${S.data.dustRate} monedas.`),
          h('div', { class: 'row gap' }, amount, h('button', { class: 'btn primary', onclick: async (e) => {
            const r = await act('shop:exchange', { amount: Number(amount.value) }, e.target);
            if (r) { sfx('win'); toast(`+${fmt(r.coins)} monedas`, 'success'); }
          } }, 'Cambiar'))),
        h('div', { class: 'card' }, h('h3', {}, '✦ ¿Cómo consigo polvo?'),
          h('p', { class: 'small' }, 'Los duplicados más allá de la 5ª copia y los variocolor repetidos se convierten en polvo estelar. También puedes liberar copias desde la Pokédex.'))),
      h('div', { class: 'row between' }, h('h2', { class: 'section-title' }, 'Fabricar Pokémon'),
        h('label', { class: 'row gap' }, h('input', { type: 'checkbox', checked: onlyMissing, onchange: (e) => { onlyMissing = e.target.checked; render(); } }), 'Solo los que me faltan')),
      list);
    render();
    this.off = bus.on('me', render);
  },
  unmount() { this.off(); },
};

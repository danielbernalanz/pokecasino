// Tienda Poké: compra objetos y bayas. (La Mochila, el Taller, el Gacha MT y la Tienda de Combate tienen ahora su propio sitio.)
import { S, h, bus, fmt, act, sfx, toast, itemImg, say, MON } from '../core.js';
import { openItem } from './market.js';

export default {
  id: 'shop', title: 'Tienda', icon: '🏬',
  mount(root) {
    const body = h('div', {});
    const SECTIONS = [['', '🎒 Objetos'], ['vitamin', '💊 Vitaminas (+10 EV)'], ['evberry', '🍓 Bayas de EVs (−10 EV)'], ['evo', '🔮 Evolución: piedras y objetos especiales'], ['ball', '⚪ Poké Balls (para la Captura)']];
    function itemCard(id, it) {
      const qty = h('input', { type: 'number', min: 1, max: 99, value: 1, class: 'qty' });
      return h('div', { class: 'shop-item item-card', 'data-item': id },
        itemImg(id, 'big'),
        h('div', { class: 'grow' }, h('b', {}, it.name), h('div', { class: 'small muted' }, it.desc), h('div', { class: 'small' }, `En tu mochila: ${S.me.items[id] || 0}`)),
        it.price
          ? h('div', { class: 'stack' }, h('div', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(it.price)), h('div', { class: 'row gap' }, qty,
            h('button', { class: 'btn primary', onclick: async (e) => { const r = await act('item:buy', { itemId: id, qty: Number(qty.value) }, e.target); if (r) { sfx('win'); toast(`Compraste ${r.qty}× ${it.name}`, 'success'); } } }, 'Comprar')))
          : h('button', { class: 'btn', onclick: () => openItem({ kind: 'item', itemId: id }) }, 'Buscar en el Mercado'));
    }
    function itemsTab() {
      const list = Object.entries(S.data.items).filter(([id, it]) => !S.data.cosmetics[id] && !it.tm && !it.material && !it.bp && !it.shard);
      return h('div', { class: 'stack' }, SECTIONS.map(([cat, title]) => {
        const part = list.filter(([, it]) => (it.cat || '') === cat);
        return part.length ? h('div', { class: 'stack' }, cat ? h('h3', {}, title) : null, h('div', { class: 'shop-grid wide' }, part.map(([id, it]) => itemCard(id, it)))) : null;
      }));
    }

    const render = () => body.replaceChildren(itemsTab());
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏬 Tienda Poké'), h('div', { class: 'row gap wrap' },
      h('a', { class: 'btn small', href: '#/bag' }, '🎒 Mochila'), h('a', { class: 'btn small', href: '#/workshop' }, '🔨 Taller'), h('a', { class: 'btn small', href: '#/market' }, '← Mercado'))),
    say({ mon: MON.kecleon, who: 'Kecleon', text: '¡Bienvenido! Mira sin miedo… aunque no me veas.', cls: 'compact' }), body);
    render();
    this.off = bus.on('me', () => { if (!document.activeElement || document.activeElement.tagName !== 'INPUT') render(); });
  },
  unmount() { if (this.off) this.off(); },
};

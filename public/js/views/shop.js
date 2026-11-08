// Tienda Poké: compra objetos y bayas. (La Mochila, el Taller, el Gacha MT y la Tienda de Combate tienen ahora su propio sitio.)
import { S, h, bus, fmt, act, sfx, toast, itemImg, say, MON, multiSelect } from '../core.js';
import { openItem } from './market.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const KEY = 'pc.shopFilters';
const BLANK = { q: '', cats: [], afford: false, sort: '' };
let FILT = null; // se recuerda en la sesión (módulo) y en localStorage
function loadF() {
  if (FILT) return FILT;
  let o = {};
  try { o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* sin almacenamiento */ }
  FILT = { ...BLANK, ...o, cats: Array.isArray(o.cats) ? o.cats.map(String) : [] };
  return FILT;
}
function saveF() { try { localStorage.setItem(KEY, JSON.stringify(FILT)); } catch { /* sin almacenamiento */ } }

export default {
  id: 'shop', title: 'Tienda', icon: '🏬',
  mount(root) {
    const body = h('div', {});
    const SECTIONS = [['', '🎒 Objetos'], ['vitamin', '💊 Vitaminas (+10 EV)'], ['evberry', '🍓 Bayas de EVs (−10 EV)'], ['evo', '🔮 Evolución: piedras y objetos especiales'], ['ball', '⚪ Poké Balls (para la Captura)'], ['expcandy', '🍬 Caramelos de Exp.']];
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
    const F = loadF();
    const all = () => Object.entries(S.data.items).filter(([id, it]) => !S.data.cosmetics[id] && !it.tm && !it.material && !it.bp && !it.shard);
    const nActive = () => (F.q.trim() ? 1 : 0) + (F.cats.length ? 1 : 0) + (F.afford ? 1 : 0) + (F.sort ? 1 : 0);
    const sorters = { 'price-asc': (x, y) => (x[1].price || 1e12) - (y[1].price || 1e12), 'price-desc': (x, y) => (y[1].price || -1) - (x[1].price || -1), name: (x, y) => x[1].name.localeCompare(y[1].name, 'es') };
    const count = h('div', { class: 'small muted mkf-count', 'aria-live': 'polite' });
    function itemsTab() {
      const q = norm(F.q);
      const list = all();
      const m = list.filter(([, it]) => (!q || norm(it.name).includes(q) || norm(it.desc).includes(q))
        && (!F.cats.length || F.cats.includes(it.cat || 'obj'))
        && (!F.afford || (it.price && it.price <= S.me.coins)));
      if (F.sort) m.sort(sorters[F.sort]);
      count.textContent = `${m.length} de ${list.length} artículos`;
      clear.classList.toggle('dim', !nActive());
      if (!m.length) return h('div', { class: 'mkf-empty muted' }, h('div', { class: 'mkf-empty-ico' }, '🔍'), h('p', {}, 'Ningún artículo coincide con esos filtros.'), h('button', { class: 'btn small', onclick: () => reset() }, 'Limpiar filtros'));
      if (F.sort) return h('div', { class: 'shop-grid wide' }, m.map(([id, it]) => itemCard(id, it)));
      return h('div', { class: 'stack' }, SECTIONS.map(([c, title]) => {
        const part = m.filter(([, it]) => (it.cat || '') === c);
        return part.length ? h('div', { class: 'stack' }, h('h3', {}, title), h('div', { class: 'shop-grid wide' }, part.map(([id, it]) => itemCard(id, it)))) : null;
      }).filter(Boolean));
    }
    const search = h('input', { type: 'search', class: 'mkf-q', placeholder: 'Buscar por nombre o efecto…', 'aria-label': 'Buscar artículo', autocomplete: 'off', oninput: (e) => { F.q = e.target.value; saveF(); render(); } });
    search.value = F.q;
    const cat = multiSelect({ label: 'Categoría', options: SECTIONS.map(([c, t]) => [c || 'obj', t.replace(/^\S+\s/, '')]), value: F.cats, allLabel: 'Todas', showLabel: false, plural: 'categorías',
      onChange: (v) => { F.cats = v; saveF(); render(); } });
    const sort = h('select', { 'aria-label': 'Ordenar', onchange: (e) => { F.sort = e.target.value; saveF(); render(); } },
      [['', 'Orden de la tienda'], ['price-asc', 'Precio: menor a mayor'], ['price-desc', 'Precio: mayor a menor'], ['name', 'Nombre (A-Z)']].map(([v, l]) => h('option', { value: v }, l)));
    sort.value = F.sort;
    const aff = h('button', { class: 'chip mkf-chk' + (F.afford ? ' active' : ''), type: 'button', 'aria-pressed': String(F.afford), onclick: () => { F.afford = !F.afford; aff.classList.toggle('active', F.afford); aff.setAttribute('aria-pressed', String(F.afford)); saveF(); render(); } }, '💰 Solo lo que puedo pagar');
    const clear = h('button', { class: 'btn small mkf-reset', type: 'button', title: 'Limpiar filtros', 'aria-label': 'Limpiar filtros', onclick: () => reset() }, '✕ Limpiar filtros');
    function reset() {
      Object.assign(F, BLANK, { cats: [] }); saveF();
      search.value = ''; sort.value = ''; cat.set([]); aff.classList.remove('active'); aff.setAttribute('aria-pressed', 'false');
      render();
    }
    const bar = h('div', { class: 'mkf shop-filters' }, h('div', { class: 'mkf-row' }, search, h('label', { class: 'mkf-f' }, h('span', {}, 'Categoría'), cat.el), h('label', { class: 'mkf-f' }, h('span', {}, 'Orden'), sort), aff, clear), count);

    const render = () => body.replaceChildren(itemsTab());
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏬 Tienda Poké'), h('div', { class: 'row gap wrap' },
      h('a', { class: 'btn small', href: '#/bag' }, '🎒 Mochila'), h('a', { class: 'btn small', href: '#/workshop' }, '🔨 Taller'), h('a', { class: 'btn small', href: '#/market' }, '← Mercado'))),
    say({ mon: MON.kecleon, who: 'Kecleon', text: '¡Bienvenido! Mira sin miedo… aunque no me veas.', cls: 'compact' }), bar, body);
    render();
    this.off = bus.on('me', () => { if (!document.activeElement || document.activeElement.tagName !== 'INPUT') render(); });
  },
  unmount() { if (this.off) this.off(); },
};

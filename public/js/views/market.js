import { S, h, fmt, act, sfx, toast, bus, sprite, typeBadge, rarityName, itemImg, itemName, RARITY_ORDER } from '../core.js';
import { pickPokemon } from '../picker.js';

let tab = 'browse';
let filter = { kind: '', q: '' };

const refKey = (l) => (l.kind === 'poke' ? `poke:${l.pokeId}:${l.shiny ? 1 : 0}` : l.kind === 'item' ? `item:${l.itemId}` : 'dust');
function thumb(l) {
  if (l.kind === 'poke') return h('img', { class: 'pixel mk-img', src: sprite(l.pokeId, l.shiny), alt: '' });
  if (l.kind === 'item') return itemImg(l.itemId, 'mk-img');
  return h('span', { class: 'mk-img dust-big' }, '✦');
}
function title(l) {
  if (l.kind === 'poke') { const p = S.dexById.get(l.pokeId); return `${p.name}${l.shiny ? ' ✨' : ''}`; }
  if (l.kind === 'item') return `${l.qty}× ${itemName(l.itemId)}`;
  return `${fmt(l.qty)} polvo estelar`;
}

export default {
  id: 'market', title: 'Mercado', icon: '🏪',
  async mount(root) {
    let state = null;
    const body = h('div', {});
    const tabs = h('div', { class: 'tabs' });

    function renderTabs() {
      tabs.replaceChildren(...[['browse', '🛒 Comprar'], ['sell', '💰 Vender'], ['mine', '📋 Mis anuncios'], ['history', '📈 Ventas']].map(([k, l]) =>
        h('button', { class: 'tab' + (tab === k ? ' active' : ''), onclick: () => { tab = k; renderTabs(); render(); } }, l)));
    }

    function stat(l) {
      const s = state.stats[refKey(l)];
      if (!s) return h('span', { class: 'muted small' }, 'Sin ventas previas');
      const unit = l.kind === 'poke' ? l.price : l.price / l.qty;
      const cls = unit <= s.avg * 0.9 ? 'good' : unit >= s.avg * 1.25 ? 'bad' : 'muted';
      return h('span', { class: 'small ' + cls }, `Media: ${fmt(s.avg)}${l.kind !== 'poke' ? '/u' : ''} (${s.n} ventas)`);
    }

    function listingCard(l, own) {
      const p = l.kind === 'poke' ? S.dexById.get(l.pokeId) : null;
      const owned = p && S.me.collection[p.id];
      return h('div', { class: 'mk-card' + (p ? ' r-' + p.rarity : '') + (l.shiny ? ' shiny' : '') },
        thumb(l),
        h('div', { class: 'grow' },
          h('b', {}, title(l)),
          p ? h('div', { class: 'row gap wrap' }, h('span', { class: 'rar r-' + p.rarity }, rarityName(p.rarity)), ...p.types.map(typeBadge)) : null,
          p && !owned ? h('div', { class: 'small good' }, '¡Te falta en la Pokédex!') : null,
          p && owned && owned.n >= 5 ? h('div', { class: 'small bad' }, 'Ya tienes 5★: se convertiría en polvo') : null,
          h('div', { class: 'muted small' }, `Vende ${l.seller} · ${new Date(l.createdAt).toLocaleDateString('es-ES')}`),
          stat(l)),
        h('div', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(l.price)),
        own || l.seller === S.me.username
          ? h('button', { class: 'btn danger', onclick: async (e) => { if (await act('market:cancel', { id: l.id }, e.target)) toast('Anuncio retirado: el objeto ha vuelto a tu inventario.', 'success'); } }, 'Retirar')
          : h('button', { class: 'btn primary', disabled: S.me.coins < l.price, onclick: async (e) => {
            if (!confirm(`¿Comprar ${title(l)} por ${fmt(l.price)} monedas?`)) return;
            const r = await act('market:buy', { id: l.id, price: l.price }, e.target);
            if (r) { sfx('win'); toast(`¡Compraste ${title(l)}!${r.dustFromDup ? ` (+${r.dustFromDup} ✦ por duplicado)` : ''}`, 'success'); }
          } }, 'Comprar'));
    }

    function browse() {
      const q = h('input', { placeholder: 'Buscar Pokémon u objeto…', value: filter.q, oninput: (e) => { filter.q = e.target.value; draw(); } });
      const kind = h('select', { onchange: (e) => { filter.kind = e.target.value; draw(); } },
        [['', 'Todo'], ['poke', 'Pokémon'], ['shiny', 'Variocolor'], ['item', 'Objetos'], ['dust', 'Polvo estelar'], ['missing', 'Me faltan']].map(([v, l]) => h('option', { value: v, selected: filter.kind === v }, l)));
      const sort = h('select', { onchange: draw }, [['new', 'Más recientes'], ['cheap', 'Más baratos'], ['rare', 'Más raros']].map(([v, l]) => h('option', { value: v }, l)));
      const list = h('div', { class: 'mk-list' });
      function draw() {
        const qq = filter.q.trim().toLowerCase();
        let items = state.listings.filter((l) => l.seller !== S.me.username).filter((l) => {
          if (filter.kind === 'poke' && l.kind !== 'poke') return false;
          if (filter.kind === 'shiny' && !l.shiny) return false;
          if (filter.kind === 'item' && l.kind !== 'item') return false;
          if (filter.kind === 'dust' && l.kind !== 'dust') return false;
          if (filter.kind === 'missing' && !(l.kind === 'poke' && !S.me.collection[l.pokeId])) return false;
          return !qq || title(l).toLowerCase().includes(qq);
        });
        if (sort.value === 'cheap') items.sort((a, b) => a.price - b.price);
        else if (sort.value === 'rare') items.sort((a, b) => RARITY_ORDER.indexOf(a.rarity || 'C') - RARITY_ORDER.indexOf(b.rarity || 'C') || b.shiny - a.shiny);
        else items.sort((a, b) => b.createdAt - a.createdAt);
        list.replaceChildren(...(items.length ? items.map((l) => listingCard(l)) : [h('p', { class: 'muted' }, 'No hay anuncios que coincidan. ¡Pon tú algo a la venta!')]));
      }
      draw();
      return h('div', { class: 'stack' }, h('div', { class: 'filters' }, q, kind, sort), list);
    }

    function sell() {
      let sel = null;
      const preview = h('div', { class: 'chosen' }, h('span', { class: 'muted' }, 'Elige qué vender'));
      const qty = h('input', { type: 'number', min: 1, value: 1 });
      const price = h('input', { type: 'number', min: 1, placeholder: 'Precio total en monedas' });
      const hint = h('div', { class: 'small muted' });
      const qtyLabel = h('label', { class: 'hidden' }, 'Cantidad', qty);
      const setSel = (x) => {
        sel = x;
        qtyLabel.classList.toggle('hidden', x.kind === 'poke');
        qty.value = x.kind === 'dust' ? Math.min(100, S.me.dust) : 1;
        const l = { ...x, qty: Number(qty.value) };
        const st = state.stats[refKey(l)];
        hint.textContent = st ? `Precio medio reciente: ${fmt(st.avg)}${x.kind !== 'poke' ? ' por unidad' : ''} · última venta ${fmt(st.last)}` : 'Aún no hay ventas de esto: ¡tú pones el precio!';
        preview.replaceChildren(thumb(l), h('b', {}, x.kind === 'poke' ? title(l) : x.kind === 'item' ? itemName(x.itemId) : 'Polvo estelar'));
      };
      const itemsOwned = Object.entries(S.me.items || {}).filter(([, n]) => n > 0);
      const fee = Math.round(S.data.marketFee * 100);
      return h('div', { class: 'cards3' },
        h('div', { class: 'card stack' },
          h('h3', {}, '1. ¿Qué vendes?'),
          h('button', { class: 'btn', onclick: async () => { const p = await pickPokemon({ title: 'Pokémon a vender' }); if (p) setSel({ kind: 'poke', pokeId: p.id, shiny: p.shiny }); } }, '📕 Un Pokémon'),
          h('div', { class: 'row gap wrap' }, itemsOwned.map(([id, n]) => h('button', { class: 'btn small', onclick: () => setSel({ kind: 'item', itemId: id }) }, itemImg(id), `${itemName(id)} ×${n}`))),
          S.me.dust >= 10 ? h('button', { class: 'btn', onclick: () => setSel({ kind: 'dust' }) }, `✦ Polvo estelar (${fmt(S.me.dust)})`) : null),
        h('div', { class: 'card stack' },
          h('h3', {}, '2. Precio'),
          preview, qtyLabel, h('label', {}, 'Precio total', price), hint,
          h('p', { class: 'small muted' }, `Comisión del mercado: ${fee} % al vender. Lo que publiques queda en depósito hasta que se venda, lo retires o pasen 7 días.`),
          h('button', { class: 'btn primary big', onclick: async (e) => {
            if (!sel) return toast('Elige qué vender.', 'error');
            const r = await act('market:create', { ...sel, qty: Number(qty.value), price: Number(price.value) }, e.target);
            if (r) { sfx('click'); toast('¡Anuncio publicado!', 'success'); tab = 'mine'; renderTabs(); render(); }
          } }, 'Publicar anuncio')));
    }

    function mine() {
      const own = state.listings.filter((l) => l.seller === S.me.username);
      return h('div', { class: 'mk-list' }, own.length ? own.map((l) => listingCard(l, true)) : [h('p', { class: 'muted' }, 'No tienes anuncios activos.')]);
    }

    function history() {
      return h('div', { class: 'mk-list' }, state.sales.length ? state.sales.map((s) => h('div', { class: 'mk-card small' }, thumb(s),
        h('div', { class: 'grow' }, h('b', {}, title(s)), h('div', { class: 'muted small' }, `${s.seller} → ${s.buyer} · ${new Date(s.at).toLocaleString('es-ES')}`)),
        h('div', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(s.price)))) : [h('p', { class: 'muted' }, 'Todavía no hay ventas.')]);
    }

    function render() {
      if (!state) return;
      body.replaceChildren(tab === 'browse' ? browse() : tab === 'sell' ? sell() : tab === 'mine' ? mine() : history());
    }

    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏪 Mercado'), h('p', { class: 'muted' }, 'Compra y vende Pokémon, objetos y polvo estelar con otros entrenadores.')), tabs, body);
    renderTabs();
    this.offs = [bus.on('market', (s) => { state = s; if (tab !== 'sell') render(); })];
    const r = await act('market:state');
    if (r) { state = r; render(); }
  },
  unmount() { this.offs.forEach((f) => f()); },
};

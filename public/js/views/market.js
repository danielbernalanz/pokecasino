import { S, h, fmt, act, sfx, toast, bus, sprite, modal, typeBadge, rarityName, itemImg, itemName, RARITY_ORDER } from '../core.js';

// Mercado estilo Albion Online: libro de órdenes por artículo (ventas y pedidos de compra).
let tab = 'browse';
let filter = { cat: '', q: '' };
let state = null;

// ---- Artículos ----
const refOf = (a) => (a.kind === 'poke' ? `poke:${a.pokeId}:${a.shiny ? 1 : 0}` : a.kind === 'item' ? `item:${a.itemId}` : 'dust');
function parseRef(ref) {
  const [kind, x, y] = ref.split(':');
  if (kind === 'poke') return { kind, pokeId: Number(x), shiny: y === '1', ref };
  if (kind === 'item') return { kind, itemId: x, ref };
  return { kind: 'dust', ref: 'dust' };
}
const isCos = (a) => a.kind === 'item' && S.data.cosmetics[a.itemId];
function nameOf(a) {
  if (a.kind === 'poke') return S.dexById.get(a.pokeId).name + (a.shiny ? ' ✨' : '');
  if (a.kind === 'item') return itemName(a.itemId);
  return 'Polvo estelar';
}
function rarityOf(a) {
  if (a.kind === 'poke') return S.dexById.get(a.pokeId).rarity;
  if (isCos(a)) return S.data.cosmetics[a.itemId].rarity;
  return null;
}
function thumb(a, cls = 'mk-img') {
  if (a.kind === 'poke') return h('img', { class: 'pixel ' + cls, src: sprite(a.pokeId, a.shiny), alt: '' });
  if (a.kind === 'item') return itemImg(a.itemId, cls);
  return h('span', { class: cls + ' dust-big' }, '✦');
}
function owned(a) {
  const me = S.me;
  if (a.kind === 'poke') { const c = me.collection[a.pokeId]; return c ? (a.shiny ? c.s : c.n - c.s) : 0; }
  if (a.kind === 'item') return me.items[a.itemId] || 0;
  return me.dust;
}
function setsNeeding(a) {
  if (a.kind !== 'poke' || S.me.collection[a.pokeId]) return [];
  return S.me.progress.sets.filter((s) => !s.done && s.ids.includes(a.pokeId));
}

// ---- Libro de órdenes ----
function summary() {
  const by = new Map();
  for (const o of state.orders) {
    const r = by.get(o.ref) || { a: parseRef(o.ref), asks: [], bids: [] };
    (o.side === 'sell' ? r.asks : r.bids).push(o);
    by.set(o.ref, r);
  }
  for (const r of by.values()) {
    r.asks.sort((x, y) => x.price - y.price || x.createdAt - y.createdAt);
    r.bids.sort((x, y) => y.price - x.price || x.createdAt - y.createdAt);
  }
  return by;
}
const levels = (orders) => {
  const m = new Map();
  for (const o of orders) m.set(o.price, (m.get(o.price) || 0) + o.qty);
  return [...m.entries()];
};
// Recorre el libro para saber cuánto cuesta/rinde operar ya `qty` unidades.
function walk(orders, qty) {
  let left = qty;
  let total = 0;
  let worst = 0;
  for (const o of orders) {
    if (!left) break;
    if (o.username === S.me.username) continue;
    const q = Math.min(left, o.qty);
    total += q * o.price;
    worst = o.price;
    left -= q;
  }
  return { filled: qty - left, total, worst };
}
const feeOf = (total) => Math.max(1, Math.ceil(total * S.data.marketFee));
const taxOf = (total) => Math.floor(total * S.data.salesTax);

// ---- Gráfica de precios (SVG) ----
function chart(days) {
  if (!days.length) return h('div', { class: 'mk-chart empty muted small' }, 'Aún no hay ventas de este artículo.');
  const W = 420;
  const H = 120;
  const maxP = Math.max(...days.map((d) => d.max));
  const maxN = Math.max(...days.map((d) => d.n));
  const bw = W / Math.max(days.length, 7);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 20}`);
  svg.setAttribute('class', 'mk-chart');
  const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  let path = '';
  days.forEach((d, i) => {
    const x = i * bw + bw / 2;
    svg.append(el('rect', { x: i * bw + bw * 0.2, y: H - (d.n / maxN) * 40, width: bw * 0.6, height: (d.n / maxN) * 40, class: 'vol' }));
    svg.append(el('line', { x1: x, x2: x, y1: H - (d.max / maxP) * (H - 10), y2: H - (d.min / maxP) * (H - 10), class: 'range' }));
    const y = H - (d.avg / maxP) * (H - 10);
    path += `${i ? 'L' : 'M'}${x},${y}`;
    const t = el('circle', { cx: x, cy: y, r: 3, class: 'pt' });
    t.append(Object.assign(document.createElementNS(ns, 'title'), { textContent: `${d.day}: media ${d.avg} · ${d.n} uds` }));
    svg.append(t);
    if (i === 0 || i === days.length - 1) svg.append(Object.assign(el('text', { x, y: H + 15, class: 'lbl', 'text-anchor': 'middle' }), { textContent: d.day.slice(5) }));
  });
  svg.append(el('path', { d: path, class: 'line' }));
  return svg;
}

// ---- Ficha del artículo ----
export async function openItem(a, side = 'buy') {
  a = { ...a, ref: refOf(a) };
  if (!state) { const s = await act('market:state'); if (!s) return; state = s; }
  const body = h('div', { class: 'mk-detail' });
  const m = modal(body, { title: 'Mercado', wide: true });
  const histRes = await act('market:history', a);
  const render = () => {
    const r = summary().get(a.ref) || { a, asks: [], bids: [] };
    const have = owned(a);
    const rar = rarityOf(a);
    const p = a.kind === 'poke' ? S.dexById.get(a.pokeId) : null;
    const avg = state.stats[a.ref] ? state.stats[a.ref].avg : null;
    const bestAsk = r.asks.find((o) => o.username !== S.me.username);
    const bestBid = r.bids.find((o) => o.username !== S.me.username);

    // Panel de compra
    const bQty = h('input', { type: 'number', min: 1, value: 1 });
    const bPrice = h('input', { type: 'number', min: 1, value: bestBid ? bestBid.price + 1 : avg || (bestAsk ? Math.max(1, bestAsk.price - 1) : 100) });
    const bInfo = h('div', { class: 'small' });
    const bNow = h('button', { class: 'btn primary', onclick: async (e) => {
      const w = walk(r.asks, Number(bQty.value));
      if (!w.filled) return;
      const res = await act('market:buy', { ...a, qty: w.filled, price: w.worst, instant: true }, e.target);
      if (res) { sfx('win'); toast(`Compraste ${res.filled} por ${fmt(res.spent)} monedas`, 'success'); }
    } });
    const bOrder = h('button', { class: 'btn', onclick: async (e) => {
      const res = await act('market:buy', { ...a, qty: Number(bQty.value), price: Number(bPrice.value) }, e.target);
      if (res) { sfx('click'); toast(res.order ? `Pedido de compra publicado${res.filled ? ` (ya se llenaron ${res.filled})` : ''}` : `Compraste ${res.filled} al momento`, 'success'); }
    } });
    const updB = () => {
      const q = Math.max(1, Number(bQty.value) || 1);
      const w = walk(r.asks, q);
      bNow.disabled = !w.filled;
      bNow.textContent = w.filled ? `Comprar ya ${w.filled} por ${fmt(w.total)}` : 'No hay ofertas de venta';
      const total = q * (Number(bPrice.value) || 0);
      bOrder.textContent = `Crear pedido: ${q} × ${fmt(bPrice.value)}`;
      bInfo.textContent = `El pedido deja ${fmt(total)} monedas en depósito + ${fmt(feeOf(total))} de comisión de publicación.`;
    };
    bQty.oninput = updB; bPrice.oninput = updB; updB();

    // Panel de venta
    const sQty = h('input', { type: 'number', min: 1, max: have, value: Math.min(1, have) });
    const sPrice = h('input', { type: 'number', min: 1, value: bestAsk ? Math.max(1, bestAsk.price - 1) : avg || (bestBid ? bestBid.price + 1 : 100) });
    const sInfo = h('div', { class: 'small' });
    const sNow = h('button', { class: 'btn gold', onclick: async (e) => {
      const w = walk(r.bids, Number(sQty.value));
      if (!w.filled) return;
      const res = await act('market:sell', { ...a, qty: w.filled, price: w.worst, instant: true }, e.target);
      if (res) { sfx('win'); toast(`Vendiste ${res.filled} por ${fmt(res.earned)} (antes de impuestos)`, 'success'); }
    } });
    const sOrder = h('button', { class: 'btn', onclick: async (e) => {
      const res = await act('market:sell', { ...a, qty: Number(sQty.value), price: Number(sPrice.value) }, e.target);
      if (res) { sfx('click'); toast(res.order ? `Orden de venta publicada${res.filled ? ` (ya se vendieron ${res.filled})` : ''}` : `Vendiste ${res.filled} al momento`, 'success'); }
    } });
    const updS = () => {
      const q = Math.max(1, Number(sQty.value) || 1);
      const w = walk(r.bids, q);
      sNow.disabled = !w.filled || !have;
      sNow.textContent = w.filled ? `Vender ya ${w.filled} por ${fmt(w.total - taxOf(w.total))}` : 'No hay pedidos de compra';
      const total = q * (Number(sPrice.value) || 0);
      sOrder.disabled = !have;
      sOrder.textContent = `Crear orden: ${q} × ${fmt(sPrice.value)}`;
      sInfo.textContent = `Cobrarías ${fmt(total - taxOf(total))} tras el ${Math.round(S.data.salesTax * 100)} % de impuesto · comisión de publicación ${fmt(feeOf(total))}.`;
    };
    sQty.oninput = updS; sPrice.oninput = updS; updS();

    const bookCol = (title, list, cls) => h('div', { class: 'ob-col ' + cls },
      h('div', { class: 'ob-head' }, h('b', {}, title), h('span', { class: 'muted small' }, 'precio · uds')),
      list.length ? levels(list).slice(0, 8).map(([price, qty]) => h('div', { class: 'ob-row' }, h('span', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(price)), h('span', {}, fmt(qty))))
        : h('div', { class: 'muted small' }, 'Vacío'));

    body.replaceChildren(
      h('div', { class: 'mk-head' }, thumb(a, 'mk-big'),
        h('div', { class: 'grow' },
          h('h2', {}, nameOf(a)),
          h('div', { class: 'row gap wrap' }, rar ? h('span', { class: 'rar r-' + rar }, rarityName(rar)) : '', ...(p ? p.types.map(typeBadge) : [])),
          h('div', { class: 'small muted' }, `Tienes ${fmt(have)} · Media 30 días: ${avg ? fmt(avg) : '—'}`),
          ...setsNeeding(a).map((s) => h('div', { class: 'small gold-text' }, `📚 Te sirve para «${s.name}» (${s.have}/${s.ids.length})`)))),
      chart(histRes ? histRes.days : []),
      h('div', { class: 'orderbook' }, bookCol('Ofertas de venta', r.asks, 'asks'), bookCol('Pedidos de compra', r.bids, 'bids')),
      h('div', { class: 'cards3' },
        h('div', { class: 'card stack' }, h('h3', {}, '🛒 Comprar'), h('label', {}, 'Cantidad', bQty), bNow, h('label', {}, 'Precio por unidad (pedido)', bPrice), bOrder, bInfo),
        h('div', { class: 'card stack' + (have ? '' : ' disabled-card') }, h('h3', {}, '💰 Vender'), have ? '' : h('div', { class: 'small muted' }, 'No tienes este artículo.'),
          h('label', {}, `Cantidad (tienes ${have})`, sQty), sNow, h('label', {}, 'Precio por unidad (orden)', sPrice), sOrder, sInfo)));
    if (side === 'sell' && have) sPrice.focus();
  };
  render();
  const off = bus.on('market', () => { if (document.contains(body)) render(); else off(); });
  void m;
}

// ---- Vista principal ----
export default {
  id: 'market', title: 'Mercado', icon: '🏪',
  async mount(root) {
    if (S.marketQuery) { filter = { cat: '', q: S.marketQuery }; tab = 'browse'; S.marketQuery = null; }
    const tabs = h('div', { class: 'tabs' });
    const body = h('div', {});

    function renderTabs() {
      tabs.replaceChildren(...[['browse', '🛒 Mercado'], ['sell', '💰 Vender'], ['mine', '📋 Mis órdenes'], ['history', '📈 Historial']].map(([k, l]) =>
        h('button', { class: 'tab' + (tab === k ? ' active' : ''), onclick: () => { tab = k; renderTabs(); render(); } }, l)));
    }

    const row = (a, r, extra) => {
      const bestAsk = r && r.asks[0];
      const bestBid = r && r.bids[0];
      const askQty = r ? r.asks.reduce((s, o) => s + o.qty, 0) : 0;
      const bidQty = r ? r.bids.reduce((s, o) => s + o.qty, 0) : 0;
      const rar = rarityOf(a);
      return h('button', { class: 'mk-row' + (rar ? ' r-' + rar : '') + (a.shiny ? ' shiny' : ''), onclick: () => openItem(a, tab === 'sell' ? 'sell' : 'buy') },
        thumb(a),
        h('div', { class: 'grow' }, h('b', {}, nameOf(a)), extra || '',
          ...setsNeeding(a).slice(0, 1).map((s) => h('div', { class: 'small gold-text' }, `📚 Para «${s.name}»`))),
        h('div', { class: 'mk-quote ask' }, h('span', { class: 'muted small' }, 'Venta desde'), bestAsk ? h('b', {}, fmt(bestAsk.price)) : h('span', { class: 'muted' }, '—'), askQty ? h('span', { class: 'small muted' }, `${fmt(askQty)} uds`) : ''),
        h('div', { class: 'mk-quote bid' }, h('span', { class: 'muted small' }, 'Compra hasta'), bestBid ? h('b', {}, fmt(bestBid.price)) : h('span', { class: 'muted' }, '—'), bidQty ? h('span', { class: 'small muted' }, `${fmt(bidQty)} uds`) : ''));
    };

    // Todo lo que se puede buscar aunque no tenga órdenes (para crear pedidos de compra).
    function catalog(q) {
      const out = [];
      for (const p of S.data.dex) if (p.name.toLowerCase().includes(q)) out.push({ kind: 'poke', pokeId: p.id, shiny: false }, { kind: 'poke', pokeId: p.id, shiny: true });
      for (const id of Object.keys(S.data.items)) if (itemName(id).toLowerCase().includes(q)) out.push({ kind: 'item', itemId: id });
      if ('polvo estelar'.includes(q)) out.push({ kind: 'dust' });
      return out.slice(0, 40).map((a) => ({ ...a, ref: refOf(a) }));
    }

    function browse() {
      const q = h('input', { placeholder: 'Busca cualquier Pokémon u objeto…', value: filter.q, oninput: (e) => { filter.q = e.target.value; draw(); } });
      const cat = h('select', { onchange: (e) => { filter.cat = e.target.value; draw(); } },
        [['', 'Todo'], ['poke', 'Pokémon'], ['shiny', 'Variocolor'], ['item', 'Objetos'], ['cosmetic', 'Cosméticos'], ['dust', 'Polvo estelar'], ['sets', 'Para mis colecciones']].map(([v, l]) => h('option', { value: v, selected: filter.cat === v }, l)));
      const list = h('div', { class: 'mk-list' });
      function draw() {
        const sum = summary();
        const qq = filter.q.trim().toLowerCase();
        let refs = [...sum.values()].map((r) => r.a);
        if (qq.length >= 2) {
          const seen = new Set(refs.map((a) => a.ref));
          refs = refs.filter((a) => nameOf(a).toLowerCase().includes(qq));
          for (const a of catalog(qq)) if (!seen.has(a.ref)) refs.push(a);
        }
        refs = refs.filter((a) => {
          if (filter.cat === 'poke') return a.kind === 'poke';
          if (filter.cat === 'shiny') return a.kind === 'poke' && a.shiny;
          if (filter.cat === 'item') return a.kind === 'item' && !isCos(a);
          if (filter.cat === 'cosmetic') return isCos(a);
          if (filter.cat === 'dust') return a.kind === 'dust';
          if (filter.cat === 'sets') return setsNeeding(a).length > 0;
          return true;
        });
        refs.sort((x, y) => (sum.has(y.ref) - sum.has(x.ref)) || RARITY_ORDER.indexOf(rarityOf(x) || 'C') - RARITY_ORDER.indexOf(rarityOf(y) || 'C'));
        list.replaceChildren(...(refs.length ? refs.slice(0, 120).map((a) => row(a, sum.get(a.ref))) : [h('p', { class: 'muted' }, qq ? 'Nada coincide.' : 'El mercado está vacío. Busca cualquier Pokémon u objeto para publicar un pedido de compra, o vende algo desde «Vender».')]));
      }
      draw();
      return h('div', { class: 'stack' },
        h('div', { class: 'filters' }, q, cat),
        h('p', { class: 'small muted' }, 'Como en Albion: «Comprar ya» toma las ofertas más baratas y «Vender ya» llena los pedidos más altos. Si no te convence el precio, publica tu propia orden y espera a que alguien la acepte.'),
        list);
    }

    function sellTab() {
      const sum = summary();
      const goods = [];
      for (const [id, c] of Object.entries(S.me.collection)) {
        if (c.n - c.s > 0) goods.push({ a: { kind: 'poke', pokeId: Number(id), shiny: false }, n: c.n - c.s });
        if (c.s > 0) goods.push({ a: { kind: 'poke', pokeId: Number(id), shiny: true }, n: c.s });
      }
      for (const [id, n] of Object.entries(S.me.items)) if (n > 0) goods.push({ a: { kind: 'item', itemId: id }, n });
      if (S.me.dust > 0) goods.push({ a: { kind: 'dust' }, n: S.me.dust });
      for (const g of goods) g.a.ref = refOf(g.a);
      goods.sort((x, y) => (sum.has(y.a.ref) && sum.get(y.a.ref).bids.length) - (sum.has(x.a.ref) && sum.get(x.a.ref).bids.length) || RARITY_ORDER.indexOf(rarityOf(x.a) || 'C') - RARITY_ORDER.indexOf(rarityOf(y.a) || 'C'));
      return h('div', { class: 'stack' },
        h('p', { class: 'small muted' }, 'Tu inventario. Arriba lo que alguien quiere comprar ahora mismo.'),
        h('div', { class: 'mk-list' }, goods.length ? goods.map((g) => row(g.a, sum.get(g.a.ref), h('div', { class: 'small muted' }, `Tienes ${fmt(g.n)}`))) : [h('p', { class: 'muted' }, 'No tienes nada que vender todavía.')]));
    }

    function mine() {
      const list = state.orders.filter((o) => o.username === S.me.username).sort((x, y) => y.createdAt - x.createdAt);
      return h('div', { class: 'mk-list' }, list.length ? list.map((o) => {
        const a = parseRef(o.ref);
        return h('div', { class: 'mk-row static' },
          thumb(a),
          h('div', { class: 'grow' }, h('b', {}, nameOf(a)),
            h('div', { class: 'small' }, h('span', { class: o.side === 'sell' ? 'tag-sell' : 'tag-buy' }, o.side === 'sell' ? 'VENTA' : 'COMPRA'), ` ${fmt(o.qty0 - o.qty)}/${fmt(o.qty0)} llenado · ${new Date(o.createdAt).toLocaleDateString('es-ES')}`)),
          h('div', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(o.price), h('span', { class: 'muted small' }, '/ud')),
          h('button', { class: 'btn small', onclick: () => openItem(a, o.side === 'sell' ? 'sell' : 'buy') }, 'Ver'),
          h('button', { class: 'btn small danger', onclick: async (e) => { if (await act('market:cancel', { id: o.id }, e.target)) toast('Orden cancelada: se te devolvió lo que quedaba en depósito.', 'success'); } }, 'Cancelar'));
      }) : [h('p', { class: 'muted' }, 'No tienes órdenes activas.')]);
    }

    function historyTab() {
      const tr = state.trades;
      return h('div', { class: 'mk-list' }, tr.length ? tr.map((t) => {
        const a = parseRef(t.ref);
        const me = t.buyer === S.me.username ? 'compraste' : t.seller === S.me.username ? 'vendiste' : null;
        return h('button', { class: 'mk-row' + (me ? ' mine' : ''), onclick: () => openItem(a) }, thumb(a),
          h('div', { class: 'grow' }, h('b', {}, `${t.qty > 1 ? t.qty + '× ' : ''}${nameOf(a)}`),
            h('div', { class: 'muted small' }, `${t.seller} → ${t.buyer}${me ? ` (${me})` : ''} · ${new Date(t.at).toLocaleString('es-ES')}`)),
          h('div', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(t.price), h('span', { class: 'muted small' }, '/ud')));
      }) : [h('p', { class: 'muted' }, 'Todavía no hay ventas.')]);
    }

    function render() {
      if (!state) return;
      body.replaceChildren(tab === 'browse' ? browse() : tab === 'sell' ? sellTab() : tab === 'mine' ? mine() : historyTab());
    }
    const fee = Math.round(S.data.marketFee * 1000) / 10;
    const tax = Math.round(S.data.salesTax * 100);
    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🏪 Mercado'), h('p', { class: 'muted' }, `Órdenes de compra y venta entre entrenadores · comisión de publicación ${fee} % · impuesto de venta ${tax} %`)),
      tabs, body);
    renderTabs();
    this.offs = [bus.on('market', (s) => { state = s; if (!document.activeElement || document.activeElement.tagName !== 'INPUT') render(); })];
    const r = await act('market:state');
    if (r) { state = r; render(); }
  },
  unmount() { this.offs.forEach((f) => f()); },
};

// El estado del mercado se mantiene actualizado aunque no esté abierta la vista (para las fichas).
bus.on('market', (s) => { state = s; });

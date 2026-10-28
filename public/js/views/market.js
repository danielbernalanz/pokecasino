import { S, h, fmt, act, sfx, toast, bus, sprite, modal, typeBadge, TYPE_ES, rarityName, itemImg, itemName, RARITY_ORDER } from '../core.js';

// Mercado estilo Albion Online: libro de órdenes por artículo (ventas y pedidos de compra).
let tab = 'browse';
const REGIONS = ['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Teselia', 'Kalos', 'Alola', 'Galar', 'Paldea'];
// Filtros por pestaña: se conservan al cambiar de pestaña durante la sesión.
const DEF = {
  browse: { q: '', cat: '', rar: '', type: '', gen: '', min: '', max: '', side: '', sort: '' },
  sell: { q: '', cat: '', rar: '', dup: '', bids: '', sort: '' },
  mine: { q: '', sort: '' },
  history: { q: '', side: 'mine', range: '' },
};
const F = Object.fromEntries(Object.entries(DEF).map(([k, v]) => [k, { ...v }]));
let panelOpen = false; // panel de filtros desplegado (móvil)
// Minúsculas y sin acentos, para buscar con tolerancia.
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
// Etiqueta de los comerciantes NPC (sus órdenes y operaciones llevan `npc: true`).
const npcTag = (on) => (on ? h('span', { class: 'npc-tag', title: 'Comerciante NPC: compra y vende con límites diarios' }, 'NPC') : '');
const levels = (orders) => {
  const m = new Map();
  for (const o of orders) { const l = m.get(o.price) || [0, false]; l[0] += o.qty; l[1] ||= !!o.npc; m.set(o.price, l); }
  return [...m.entries()].map(([price, [qty, npc]]) => [price, qty, npc]);
};
// Recorre el libro para saber cuánto cuesta/rinde operar ya `qty` unidades.
function walk(orders, qty) {
  let left = qty;
  let total = 0;
  let worst = 0;
  let n = 0;
  for (const o of orders) {
    if (!left) break;
    if (o.username === S.me.username) continue;
    const q = Math.min(left, o.qty);
    total += q * o.price;
    worst = o.price;
    left -= q;
    n++;
  }
  return { filled: qty - left, total, worst, orders: n, avg: qty - left ? total / (qty - left) : 0 };
}
// Las tasas vienen con el estado del Mercado (cambian en el «Viernes de Mercado»).
const marketFee = () => (state && state.setupFee != null ? state.setupFee : S.data.marketFee);
const salesTax = () => (state && state.salesTax != null ? state.salesTax : S.data.salesTax);
const feeOf = (total) => Math.max(1, Math.ceil(total * marketFee()));
const taxOf = (total) => Math.floor(total * salesTax());

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

// ---- Utilidades de la interfaz ----
const MAXQ = { poke: 20, item: 999, dust: 1000000 };
const DURS = [1, 3, 7, 14];
let lastDays = 14; // la última duración elegida se recuerda durante la sesión
const isMine = (o) => o.username === S.me.username;
const others = (list) => list.filter((o) => !isMine(o));
const sumQty = (list) => list.reduce((s, o) => s + o.qty, 0);
const money = (n) => h('span', { class: 'mk-money' }, h('span', { class: 'coin-ico' }), fmt(n));
const pct = (x) => String(Math.round(x * 10000) / 100).replace('.', ',');
// Tiempo que le queda a una orden (las antiguas sin `expiresAt` caducan a los 14 días).
function expiryOf(o) { return o.expiresAt || o.createdAt + 14 * 86400000; }
function timeLeft(o) {
  const ms = expiryOf(o) - Date.now();
  if (ms <= 0) return 'Caducando…';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  if (d >= 1) return `${d} d ${Math.floor((m % 1440) / 60)} h`;
  const hh = Math.floor(m / 60);
  return hh ? `${hh} h ${m % 60} min` : `${Math.max(1, m)} min`;
}
const urgent = (o) => expiryOf(o) - Date.now() < 86400000;
const kv = (label, value, cls = '') => h('div', { class: 'mk-kv ' + cls }, h('span', {}, label), h('b', {}, value));
const kindLabel = (a) => (a.kind === 'poke' ? (a.shiny ? 'Variocolor' : 'Pokémon') : a.kind === 'dust' ? 'Recurso' : isCos(a) ? 'Cosmético' : 'Objeto');
function tags(a) {
  const rar = rarityOf(a);
  return h('span', { class: 'mk-tags' }, rar ? h('span', { class: 'rar r-' + rar }, rarityName(rar)) : '', h('span', { class: 'mk-kind' + (a.shiny ? ' shiny' : '') }, kindLabel(a)));
}
function who(o) {
  return h('span', { class: 'mk-who' }, isMine(o) ? h('span', { class: 'mk-me' }, 'Tú') : o.username, npcTag(o.npc));
}

// Cantidad: número + deslizador + «Máx».
function qtyField(max, init, onChange) {
  const clamp = (v) => Math.max(1, Math.min(max, Math.floor(Number(v)) || 1));
  const num = h('input', { type: 'number', class: 'mk-num', min: 1, max, value: clamp(init), inputmode: 'numeric', 'aria-label': 'Cantidad' });
  const rng = h('input', { type: 'range', class: 'mk-range', min: 1, max, value: clamp(init), 'aria-label': 'Cantidad (deslizador)' });
  num.addEventListener('input', () => { rng.value = clamp(num.value); onChange(); });
  num.addEventListener('change', () => { num.value = clamp(num.value); rng.value = num.value; onChange(); });
  rng.addEventListener('input', () => { num.value = rng.value; onChange(); });
  const set = (v) => { num.value = clamp(v); rng.value = num.value; onChange(); };
  return { el: h('div', { class: 'mk-qty' }, num, max > 1 ? rng : '', max > 1 ? h('button', { class: 'chip', type: 'button', onclick: () => set(max) }, 'Máx') : ''), get value() { return clamp(num.value); } };
}
const dlgHead = (a, sub) => h('div', { class: 'mk-dhead' }, thumb(a, 'mk-img'), h('div', { class: 'grow' }, h('b', {}, nameOf(a)), tags(a), sub ? h('div', { class: 'small muted' }, sub) : ''));

// ---- Diálogos de compra y venta ----
// Comprar de UNA orden concreta (botón «Comprar» de una oferta).
function buyFromOrder(a, o) {
  const max = Math.max(1, Math.min(o.qty, MAXQ[a.kind]));
  const info = h('div', { class: 'mk-sum' });
  const ok = h('button', { class: 'btn primary big mk-confirm', type: 'button' }, 'Comprar');
  const q = qtyField(max, 1, upd);
  const m = modal(h('div', { class: 'stack' }, dlgHead(a, h('span', {}, 'Vende ', who(o), ` · ${fmt(o.qty)} disponibles · caduca en ${timeLeft(o)}`)),
    h('label', {}, 'Cantidad', q.el), info, ok), { title: 'Comprar' });
  function upd() {
    const total = q.value * o.price;
    const after = S.me.coins - total;
    info.replaceChildren(kv('Precio por unidad', money(o.price)), kv('Total', money(total), 'strong'), kv('Tus monedas después', after >= 0 ? money(after) : 'No te llegan', after >= 0 ? '' : 'bad'));
    ok.disabled = after < 0;
    ok.textContent = `Comprar ${fmt(q.value)}`;
  }
  upd();
  ok.onclick = async (e) => {
    const res = await act('market:buy', { ...a, qty: q.value, price: o.price, orderId: o.id, instant: true }, e.target);
    if (res) { sfx('win'); toast(`Compraste ${fmt(res.filled)} por ${fmt(res.spent)} monedas`, 'success'); m.close(); }
  };
}
// Comprar ya: toma las ofertas más baratas.
function buyNow(a) {
  const asks = others(summary().get(a.ref)?.asks || []);
  if (!asks.length) { toast('No hay ofertas de otros jugadores.', 'error'); return; }
  const max = Math.max(1, Math.min(sumQty(asks), MAXQ[a.kind]));
  const info = h('div', { class: 'mk-sum' });
  const ok = h('button', { class: 'btn primary big mk-confirm', type: 'button' }, 'Comprar');
  const q = qtyField(max, 1, upd);
  const m = modal(h('div', { class: 'stack' }, dlgHead(a, `${fmt(sumQty(asks))} en venta en ${asks.length} ${asks.length === 1 ? 'orden' : 'órdenes'}`),
    h('p', { class: 'small muted' }, 'Compras al momento a las ofertas más baratas, de menor a mayor precio.'),
    h('label', {}, 'Cantidad', q.el), info, ok), { title: 'Comprar ya' });
  function upd() {
    const w = walk(asks, q.value);
    const after = S.me.coins - w.total;
    info.replaceChildren(kv('Órdenes que se tomarán', fmt(w.orders)), kv('Precio medio por unidad', money(Math.round(w.avg))), kv('Total', money(w.total), 'strong'),
      kv('Tus monedas después', after >= 0 ? money(after) : 'No te llegan', after >= 0 ? '' : 'bad'));
    ok.disabled = after < 0 || !w.filled;
    ok.textContent = `Comprar ${fmt(q.value)} por ${fmt(w.total)}`;
  }
  upd();
  ok.onclick = async (e) => {
    const w = walk(asks, q.value);
    const res = await act('market:buy', { ...a, qty: w.filled, price: w.worst, instant: true }, e.target);
    if (res) { sfx('win'); toast(`Compraste ${fmt(res.filled)} por ${fmt(res.spent)} monedas`, 'success'); m.close(); }
  };
}
// Vender al momento: a todos los pedidos (`bid` = uno concreto) o a los más altos.
function sellNow(a, bid) {
  const bids = bid ? [bid] : others(summary().get(a.ref)?.bids || []);
  const have = owned(a);
  if (!have) { toast('No tienes este artículo.', 'error'); return; }
  if (!bids.length) { toast('Nadie quiere comprar esto ahora mismo.', 'error'); return; }
  const max = Math.max(1, Math.min(have, sumQty(bids), MAXQ[a.kind]));
  const info = h('div', { class: 'mk-sum' });
  const ok = h('button', { class: 'btn gold big mk-confirm', type: 'button' }, 'Vender');
  const q = qtyField(max, 1, upd);
  const m = modal(h('div', { class: 'stack' }, dlgHead(a, bid ? h('span', {}, 'Pide ', who(bid), ` · ${fmt(bid.qty)} uds · ${fmt(bid.price)}/ud`) : `Tienes ${fmt(have)} · ${fmt(sumQty(bids))} uds en pedidos de compra`),
    h('p', { class: 'small muted' }, bid ? 'Vendes al momento a este pedido de compra.' : 'Vendes al momento a los pedidos de compra más altos.'),
    h('label', {}, 'Cantidad', q.el), info, ok), { title: bid ? 'Vender a este pedido' : 'Vender ya' });
  function upd() {
    const w = walk(bids, q.value);
    const tax = taxOf(w.total);
    info.replaceChildren(kv('Pedidos que se llenarán', fmt(w.orders)), kv('Precio medio por unidad', money(Math.round(w.avg))), kv('Total bruto', money(w.total)),
      kv(`− ${pct(salesTax())} % impuesto de venta`, '− ' + fmt(tax)), kv('Recibirás', money(w.total - tax), 'strong'));
    ok.disabled = !w.filled;
    ok.textContent = `Vender ${fmt(q.value)} y recibir ${fmt(w.total - tax)}`;
  }
  upd();
  ok.onclick = async (e) => {
    const w = walk(bids, q.value);
    const res = await act('market:sell', { ...a, qty: w.filled, price: w.worst, instant: true, ...(bid ? { orderId: bid.id } : {}) }, e.target);
    if (res) { sfx('win'); toast(`Vendiste ${fmt(res.filled)}: recibes ${fmt(res.earned - taxOf(res.earned))} monedas`, 'success'); m.close(); }
  };
}
// Orden de venta / pedido de compra: precio, cantidad y duración.
function orderDialog(a, side) {
  const sell = side === 'sell';
  const have = owned(a);
  if (sell && !have) { toast('No tienes este artículo.', 'error'); return; }
  const r = summary().get(a.ref) || { asks: [], bids: [] };
  const lowAsk = others(r.asks)[0];
  const topBid = others(r.bids)[0];
  const avg = state.stats[a.ref] && state.stats[a.ref].avg;
  const max = sell ? Math.max(1, Math.min(have, MAXQ[a.kind])) : MAXQ[a.kind];
  const start = sell ? (lowAsk ? Math.max(1, lowAsk.price - 1) : avg || (topBid ? topBid.price + 1 : 100)) : (topBid ? topBid.price + 1 : avg || (lowAsk ? Math.max(1, lowAsk.price - 1) : 100));
  const price = h('input', { type: 'number', class: 'mk-num', min: 1, inputmode: 'numeric', value: start, 'aria-label': 'Precio por unidad' });
  let days = lastDays;
  const dur = h('div', { class: 'seg mk-dur' });
  const paintDur = () => dur.replaceChildren(...DURS.map((d) => h('button', { type: 'button', class: 'chip' + (d === days ? ' active' : ''), onclick: () => { days = d; lastDays = d; paintDur(); upd(); } }, `${d} ${d === 1 ? 'día' : 'días'}`)));
  const info = h('div', { class: 'mk-sum' });
  const note = h('div', { class: 'small muted' });
  const ok = h('button', { class: 'btn big mk-confirm ' + (sell ? 'gold' : 'primary'), type: 'button' }, sell ? 'Publicar orden de venta' : 'Publicar pedido de compra');
  const q = qtyField(max, 1, upd);
  const quick = (label, v, tip) => h('button', { class: 'chip', type: 'button', disabled: v == null, title: tip || '', onclick: () => { price.value = Math.max(1, Math.round(v)); upd(); } }, label);
  const chips = sell
    ? [quick('Igualar más bajo', lowAsk && lowAsk.price), quick('−1 al más bajo', lowAsk && Math.max(1, lowAsk.price - 1)), quick('Precio medio', avg || null)]
    : [quick('Igualar mejor pedido', topBid && topBid.price), quick('+1 al mejor pedido', topBid && topBid.price + 1), quick('Precio medio', avg || null)];
  const mkt = h('div', { class: 'small muted' }, sell
    ? `Más bajo en venta: ${lowAsk ? fmt(lowAsk.price) : '—'} · Mejor pedido: ${topBid ? fmt(topBid.price) : '—'} · Medio 30 d: ${avg ? fmt(avg) : '—'}`
    : `Mejor pedido: ${topBid ? fmt(topBid.price) : '—'} · Más bajo en venta: ${lowAsk ? fmt(lowAsk.price) : '—'} · Medio 30 d: ${avg ? fmt(avg) : '—'}`);
  const m = modal(h('div', { class: 'stack' }, dlgHead(a, sell ? `Tienes ${fmt(have)}` : ''), mkt,
    h('label', {}, 'Precio por unidad', h('div', { class: 'mk-priceRow' }, h('span', { class: 'coin-ico' }), price)),
    h('div', { class: 'seg mk-quick' }, ...chips),
    h('label', {}, 'Cantidad', q.el),
    h('label', {}, 'Duración', dur), info, note, ok), { title: sell ? 'Orden de venta' : 'Pedido de compra' });
  function upd() {
    const p = Math.max(0, Math.floor(Number(price.value)) || 0);
    const total = q.value * p;
    const fee = feeOf(total);
    if (sell) {
      const tax = taxOf(total);
      info.replaceChildren(kv(`Comisión de publicación ${pct(marketFee())} % (no se devuelve)`, money(fee)), kv(`Impuesto de venta ${pct(salesTax())} % al vender`, money(tax)), kv('Recibirás si se vende todo', money(total - tax), 'strong'),
        kv('Tus monedas después de publicar', S.me.coins - fee >= 0 ? money(S.me.coins - fee) : 'No te llegan', S.me.coins - fee >= 0 ? '' : 'bad'));
      ok.disabled = !p || S.me.coins < fee;
      note.textContent = `Los artículos quedan en depósito hasta que se vendan, caduque la orden (${days} ${days === 1 ? 'día' : 'días'}) o la canceles; lo no vendido se te devuelve.`;
      if (topBid && p && p <= topBid.price) note.textContent += ' Con ese precio parte se venderá al momento a pedidos ya publicados.';
    } else {
      const cost = total + fee;
      info.replaceChildren(kv('Monedas apartadas', money(total)), kv(`Comisión ${pct(marketFee())} % (no se devuelve)`, money(fee)), kv('Total ahora', money(cost), 'strong'),
        kv('Tus monedas después', S.me.coins - cost >= 0 ? money(S.me.coins - cost) : 'No te llegan', S.me.coins - cost >= 0 ? '' : 'bad'));
      ok.disabled = !p || S.me.coins < cost;
      note.textContent = `Las monedas apartadas se devuelven si cancelas o caduca el pedido (${days} ${days === 1 ? 'día' : 'días'}); la comisión no.`;
      if (lowAsk && p && p >= lowAsk.price) note.textContent += ' Con ese precio parte se comprará al momento a ofertas ya publicadas.';
    }
  }
  price.oninput = upd;
  paintDur();
  upd();
  ok.onclick = async (e) => {
    const res = await act(sell ? 'market:sell' : 'market:buy', { ...a, qty: q.value, price: Math.floor(Number(price.value)), days }, e.target);
    if (!res) return;
    sfx('click');
    const f = res.filled ? ` (ya se ${sell ? 'vendieron' : 'compraron'} ${fmt(res.filled)})` : '';
    toast(res.order ? `${sell ? 'Orden de venta' : 'Pedido de compra'} publicado${f}` : `${sell ? 'Vendiste' : 'Compraste'} ${fmt(res.filled)} al momento`, 'success');
    m.close();
  };
}

// ---- Filas de artículo (acordeón) ----
const openRows = { buy: new Set(), sell: new Set() };
// Lista de órdenes individuales de un artículo. action 'buy' = botón Comprar; 'sell' = botón Vender a ese pedido.
function orderList(a, orders, action) {
  if (!orders.length) return h('div', { class: 'muted small mk-none' }, action === 'buy' ? 'Nadie vende este artículo ahora mismo.' : 'Nadie ha publicado pedidos de compra.');
  const have = owned(a);
  return h('div', { class: 'mk-olist' },
    h('div', { class: 'mk-ohead small muted' }, h('span', {}, action === 'buy' ? 'Vendedor' : 'Comprador'), h('span', {}, 'Cant.'), h('span', {}, 'Precio/ud'), h('span', {}, 'Caduca'), h('span', {})),
    ...orders.slice(0, 25).map((o) => h('div', { class: 'mk-ord' + (isMine(o) ? ' mine' : ''), 'data-order': o.id },
      who(o), h('span', {}, '×' + fmt(o.qty)), h('span', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(o.price)), h('span', { class: 'small muted' }, timeLeft(o)),
      isMine(o) ? h('span', { class: 'small muted' }, 'Tu orden')
        : action === 'buy' ? h('button', { class: 'btn small primary mk-order-buy', type: 'button', onclick: () => buyFromOrder(a, o) }, 'Comprar')
          : h('button', { class: 'btn small gold mk-order-sell', type: 'button', disabled: !have, title: have ? '' : 'No tienes este artículo', onclick: () => sellNow(a, o) }, 'Vender'))),
    orders.length > 25 ? h('div', { class: 'small muted' }, `… y ${orders.length - 25} órdenes más`) : '');
}
const quote = (label, value, cls = '') => h('div', { class: 'mk-q ' + cls }, h('span', { class: 'muted small' }, label), value);
// mode: 'buy' (pestaña Comprar) | 'sell' (pestaña Vender). `have` = unidades que tienes (modo sell).
function itemRow(a, r, mode, have) {
  r ||= { asks: [], bids: [] };
  const ref = a.ref;
  const open = openRows[mode].has(ref);
  const rar = rarityOf(a);
  const lowAsk = r.asks[0];
  const topBid = r.bids[0];
  const askOthers = others(r.asks);
  const bidOthers = others(r.bids);
  const price = (o) => (o ? h('b', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(o.price), npcTag(o.npc)) : h('b', { class: 'muted' }, '—'));
  const quotes = mode === 'buy'
    ? [quote('Precio más bajo', lowAsk ? price(lowAsk) : h('b', { class: 'muted' }, 'Sin ofertas'), 'ask'), quote('En venta', h('b', {}, lowAsk ? fmt(sumQty(r.asks)) : '—'))]
    : [quote('Tienes', h('b', {}, fmt(have))), quote('Mejor pedido', price(topBid), 'bid'), quote('Precio más bajo en venta', price(lowAsk), 'ask')];
  const sets = setsNeeding(a)[0];
  const el = h('div', { class: 'mk-item' + (open ? ' open' : '') + (rar ? ' r-' + rar : '') + (a.shiny ? ' shiny' : ''), 'data-ref': ref });
  const detail = h('div', { class: 'mk-orders' });
  const fill = () => detail.replaceChildren(orderList(a, mode === 'buy' ? r.asks : r.bids, mode === 'buy' ? 'buy' : 'sell'),
    h('button', { class: 'btn small mk-chartlink', type: 'button', onclick: () => openItem(a, mode) }, '📈 Ver historial de precios'));
  const expand = h('button', { class: 'mk-expand', type: 'button', 'aria-expanded': String(open), 'aria-label': `Ver órdenes de ${nameOf(a)}`, onclick: () => {
    const now = !openRows[mode].has(ref);
    openRows[mode][now ? 'add' : 'delete'](ref);
    el.classList.toggle('open', now);
    expand.setAttribute('aria-expanded', String(now));
    if (now) { fill(); el.append(detail); } else detail.remove();
  } },
  thumb(a), h('div', { class: 'mk-info' }, h('b', { class: 'mk-name' }, nameOf(a)), tags(a), sets ? h('div', { class: 'small gold-text' }, `📚 Para «${sets.name}»`) : ''),
  h('div', { class: 'mk-quotes' }, quotes), h('span', { class: 'mk-chev', 'aria-hidden': 'true' }, '▸'));
  const btns = mode === 'buy'
    ? [askOthers.length ? h('button', { class: 'btn primary mk-buy-now', type: 'button', onclick: () => buyNow(a) }, 'Comprar') : '',
      h('button', { class: 'btn mk-buy-order', type: 'button', onclick: () => orderDialog(a, 'buy') }, 'Pedido de compra')]
    : [h('button', { class: 'btn gold mk-sell-now', type: 'button', disabled: !bidOthers.length, title: bidOthers.length ? '' : 'Nadie quiere comprar esto ahora', onclick: () => sellNow(a) }, 'Vender'),
      h('button', { class: 'btn mk-sell-order', type: 'button', onclick: () => orderDialog(a, 'sell') }, 'Orden de venta')];
  el.append(h('div', { class: 'mk-line' }, expand, h('div', { class: 'mk-btns' }, btns)));
  if (open) { fill(); el.append(detail); }
  return el;
}

// ---- Ficha del artículo (la usan Pokédex, Tienda y el Historial) ----
export async function openItem(a, side = 'buy') {
  a = { ...a, ref: refOf(a) };
  if (!state) { const s = await act('market:state'); if (!s) return; state = s; }
  const body = h('div', { class: 'mk-detail' });
  const m = modal(body, { title: 'Mercado', wide: true });
  const histRes = await act('market:history', a);
  let range = 0;
  const render = () => {
    const r = summary().get(a.ref) || { a, asks: [], bids: [] };
    const have = owned(a);
    const rar = rarityOf(a);
    const p = a.kind === 'poke' ? S.dexById.get(a.pokeId) : null;
    const avg = state.stats[a.ref] ? state.stats[a.ref].avg : null;
    const days = histRes ? (range ? histRes.days.slice(-range) : histRes.days) : [];
    const chips = h('div', { class: 'seg mk-filt' }, ...[[0, 'Todo'], [7, '7 días'], [14, '14 días']].map(([v, l]) => h('button', { class: 'chip' + (range === v ? ' active' : ''), type: 'button', onclick: () => { range = v; render(); } }, l)));
    const buyBtns = [h('button', { class: 'btn primary mk-buy-now', type: 'button', disabled: !others(r.asks).length, onclick: () => buyNow(a) }, 'Comprar'), h('button', { class: 'btn mk-buy-order', type: 'button', onclick: () => orderDialog(a, 'buy') }, 'Pedido de compra')];
    const sellBtns = have ? [h('button', { class: 'btn gold mk-sell-now', type: 'button', disabled: !others(r.bids).length, onclick: () => sellNow(a) }, 'Vender'), h('button', { class: 'btn mk-sell-order', type: 'button', onclick: () => orderDialog(a, 'sell') }, 'Orden de venta')] : [];
    body.replaceChildren(
      h('div', { class: 'mk-head' }, thumb(a, 'mk-big'),
        h('div', { class: 'grow' },
          h('h2', {}, nameOf(a)),
          h('div', { class: 'row gap wrap' }, rar ? h('span', { class: 'rar r-' + rar }, rarityName(rar)) : '', ...(p ? p.types.map(typeBadge) : [])),
          h('div', { class: 'small muted' }, `Tienes ${fmt(have)} · Media 30 días: ${avg ? fmt(avg) : '—'}`),
          ...setsNeeding(a).map((s) => h('div', { class: 'small gold-text' }, `📚 Te sirve para «${s.name}» (${s.have}/${s.ids.length})`)))),
      h('div', { class: 'mk-btns mk-fichabtns' }, side === 'sell' ? [...sellBtns, ...buyBtns] : [...buyBtns, ...sellBtns]),
      chips, chart(days),
      h('div', { class: 'mk-twocol' },
        h('div', {}, h('h4', {}, `En venta (${fmt(sumQty(r.asks))})`), orderList(a, r.asks, 'buy')),
        h('div', {}, h('h4', {}, `Pedidos de compra (${fmt(sumQty(r.bids))})`), orderList(a, r.bids, 'sell'))));
  };
  render();
  const off = bus.on('market', () => { if (document.contains(body)) render(); else off(); });
  void m;
}

// ---- Vista principal ----
const TABS = [['browse', '🛒 Comprar'], ['sell', '💰 Vender'], ['mine', '📋 Mis órdenes'], ['history', '📈 Historial']];
function helpBox() {
  let open = !matchMedia('(max-width: 640px)').matches; // en móvil empieza plegada
  try { const v = localStorage.getItem('mk:help'); if (v) open = v === '1'; } catch { /* sin almacenamiento */ }
  const d = h('details', { class: 'mk-help' }, h('summary', {}, '¿Cómo funciona el Mercado?'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Comprar: '), 'al momento a las ofertas más baratas, o con un «Pedido de compra» a tu precio: esperas a que alguien te venda.'),
      h('li', {}, h('b', {}, 'Vender: '), 'al momento a los pedidos más altos, o con una «Orden de venta» a tu precio: queda publicada hasta que alguien la compre.'),
      h('li', {}, h('b', {}, 'Costes: '), 'comisión de publicación 1,5 % al crear una orden (no se devuelve) e impuesto de venta 3 % que paga quien vende. Comprar y vender al momento no lleva comisión.'),
      h('li', {}, h('b', {}, 'Caducidad: '), 'eliges 1, 3, 7 o 14 días. Si caduca o la cancelas, se te devuelve lo que quede en depósito (artículos o monedas apartadas).')));
  if (open) d.open = true;
  d.addEventListener('toggle', () => { try { localStorage.setItem('mk:help', d.open ? '1' : '0'); } catch { /* nada */ } });
  return d;
}
export default {
  id: 'market', title: 'Mercado', icon: '🏪',
  async mount(root) {
    if (S.marketQuery) { F.browse = { ...DEF.browse, q: S.marketQuery }; tab = 'browse'; S.marketQuery = null; }
    const tabs = h('div', { class: 'tabs mk-tabs', role: 'tablist' });
    const body = h('div', {});

    function renderTabs() {
      tabs.replaceChildren(...TABS.map(([k, l]) =>
        h('button', { class: 'tab' + (tab === k ? ' active' : ''), 'data-tab': k, role: 'tab', 'aria-selected': String(tab === k), onclick: () => { tab = k; renderTabs(); render(); } }, l)));
    }

    // ---- Barra de filtros compacta (búsqueda + filtros plegables en móvil) ----
    // defs: [{ k, t: 'sel'|'num'|'chk'|'seg', ph, opts, sort }]. Devuelve { el, reset }.
    function filterBar(st, def, defs, ph, onChange) {
      const el = h('div', { class: 'mkf' });
      const activeN = () => defs.filter((d) => !d.sort && String(st[d.k]) !== String(def[d.k])).length;
      let timer = null;
      const later = () => { clearTimeout(timer); timer = setTimeout(onChange, 150); };
      function reset() { Object.assign(st, def); build(); onChange(); }
      function build() {
        const toggle = h('button', { class: 'btn small mkf-toggle', type: 'button', 'aria-expanded': String(panelOpen), onclick: () => { panelOpen = !panelOpen; panel.classList.toggle('open', panelOpen); toggle.setAttribute('aria-expanded', String(panelOpen)); } });
        const clear = h('button', { class: 'btn small mkf-clear', type: 'button', onclick: reset }, 'Limpiar');
        const sync = () => { toggle.textContent = `⚙ Filtros (${activeN()})`; clear.classList.toggle('hidden', !activeN() && !st.q && !defs.some((d) => d.sort && st[d.k] !== def[d.k])); };
        const q = h('input', { type: 'search', class: 'mkf-q', placeholder: ph, 'aria-label': 'Buscar', autocomplete: 'off', oninput: (e) => { st.q = e.target.value; sync(); later(); } });
        q.value = st.q;
        const ctrl = (d) => {
          if (d.t === 'sel') {
            const s = h('select', { 'aria-label': d.ph, onchange: (e) => { st[d.k] = e.target.value; sync(); onChange(); } }, d.opts.map(([v, l]) => h('option', { value: v }, l)));
            s.value = st[d.k];
            return s;
          }
          if (d.t === 'num') {
            const i = h('input', { type: 'number', min: 0, inputmode: 'numeric', class: 'mkf-num', placeholder: d.ph, 'aria-label': d.ph, oninput: (e) => { st[d.k] = e.target.value; sync(); later(); } });
            i.value = st[d.k];
            return i;
          }
          if (d.t === 'chk') {
            const b = h('button', { class: 'chip' + (st[d.k] ? ' active' : ''), type: 'button', onclick: () => { st[d.k] = st[d.k] ? '' : '1'; b.classList.toggle('active', !!st[d.k]); sync(); onChange(); } }, d.ph);
            return b;
          }
          // seg: chips excluyentes (pulsar el activo lo desactiva)
          const wrap = h('div', { class: 'seg mkf-seg' });
          const paint = () => wrap.replaceChildren(...d.opts.map(([v, l]) => h('button', { class: 'chip' + (st[d.k] === v ? ' active' : ''), type: 'button', onclick: () => { st[d.k] = st[d.k] === v ? '' : v; paint(); sync(); onChange(); } }, l)));
          paint();
          return wrap;
        };
        const panel = h('div', { class: 'mkf-panel' + (panelOpen ? ' open' : '') }, defs.map(ctrl));
        sync();
        el.replaceChildren(h('div', { class: 'mkf-top' }, q, toggle, clear), panel);
      }
      build();
      return { el, reset, active: () => activeN() + (st.q ? 1 : 0) + defs.filter((d) => d.sort && st[d.k] !== def[d.k]).length };
    }

    // Pinta la lista, el contador y el estado vacío (no toca la barra: así no se pierde el foco al teclear).
    function paintList(list, count, items, mk, fb, emptyMsg, limit = 120) {
      const n = items.length;
      count.textContent = `${fmt(n)} resultado${n === 1 ? '' : 's'}${n > limit ? ` · mostrando ${limit}` : ''}`;
      list.replaceChildren(...(n ? items.slice(0, limit).map(mk) : [h('div', { class: 'mkf-empty' },
        h('div', { class: 'mkf-empty-ico' }, '🔍'), h('p', { class: 'muted' }, emptyMsg),
        fb.active() ? h('button', { class: 'btn small', onclick: fb.reset }, 'Limpiar filtros') : '')]));
    }
    const kindOf = (a) => (a.kind === 'poke' ? (a.shiny ? 'shiny' : 'poke') : a.kind === 'dust' ? 'dust' : isCos(a) ? 'cosmetic' : 'item');
    const KINDS = [['', 'Todo'], ['poke', 'Pokémon'], ['shiny', 'Variocolor'], ['item', 'Objetos'], ['cosmetic', 'Cosméticos'], ['dust', 'Polvo estelar']];
    const RARS = [['', 'Cualquier rareza'], ...RARITY_ORDER.map((r) => [r, rarityName(r)])];
    // Cumple tipo de artículo, rareza, tipo Pokémon y región (los dos últimos solo aplican a Pokémon).
    function passItem(a, st) {
      if (st.cat && st.cat !== 'sets' && kindOf(a) !== st.cat && !(st.cat === 'poke' && a.kind === 'poke')) return false;
      if (st.cat === 'sets' && !setsNeeding(a).length) return false;
      if (st.rar && rarityOf(a) !== st.rar) return false;
      if (st.type || st.gen) {
        if (a.kind !== 'poke') return false;
        const p = S.dexById.get(a.pokeId);
        if (st.type && !p.types.includes(st.type)) return false;
        if (st.gen && p.gen !== Number(st.gen)) return false;
      }
      return true;
    }
    const matchQ = (a, q) => !q || norm(nameOf(a)).includes(q);
    const byName = (x, y) => nameOf(x).localeCompare(nameOf(y), 'es');
    const rarIdx = (a) => RARITY_ORDER.indexOf(rarityOf(a) || 'C');

    // Todo lo que se puede buscar aunque no tenga órdenes (para crear pedidos de compra).
    function catalog(q) {
      const out = [];
      for (const p of S.data.dex) if (norm(p.name).includes(q)) out.push({ kind: 'poke', pokeId: p.id, shiny: false }, { kind: 'poke', pokeId: p.id, shiny: true });
      for (const id of Object.keys(S.data.items)) if (norm(itemName(id)).includes(q)) out.push({ kind: 'item', itemId: id });
      if ('polvo estelar'.includes(q)) out.push({ kind: 'dust' });
      return out.map((a) => ({ ...a, ref: refOf(a) }));
    }


    function browse() {
      const st = F.browse;
      const list = h('div', { class: 'mk-list' });
      const count = h('div', { class: 'small muted mkf-count' });
      function draw() {
        const sum = summary();
        const q = norm(st.q.trim());
        let refs = [...sum.values()].map((r) => r.a);
        if (q.length >= 2) {
          const seen = new Set(refs.map((a) => a.ref));
          for (const a of catalog(q)) if (!seen.has(a.ref)) refs.push(a);
        }
        const min = st.min === '' ? null : Number(st.min);
        const max = st.max === '' ? null : Number(st.max);
        const ask = (a) => { const r = sum.get(a.ref); return r && r.asks[0] ? r.asks[0].price : null; };
        refs = refs.filter((a) => {
          if (q && !matchQ(a, q)) return false;
          if (!passItem(a, st)) return false;
          const r = sum.get(a.ref);
          if (st.side === 'asks' && !(r && r.asks.length)) return false;
          if (st.side === 'bids' && !(r && r.bids.length)) return false;
          if (min != null || max != null) {
            const p = ask(a);
            if (p == null || (min != null && p < min) || (max != null && p > max)) return false;
          }
          return true;
        });
        const qty = (a, side) => { const r = sum.get(a.ref); return r ? sumQty(r[side]) : 0; };
        const cmp = {
          cheap: (x, y) => (ask(x) ?? Infinity) - (ask(y) ?? Infinity),
          exp: (x, y) => (ask(y) ?? -1) - (ask(x) ?? -1),
          offers: (x, y) => qty(y, 'asks') - qty(x, 'asks'),
          sold: (x, y) => ((state.stats[y.ref] || {}).n || 0) - ((state.stats[x.ref] || {}).n || 0),
          name: byName,
        }[st.sort];
        refs.sort((x, y) => (cmp && cmp(x, y)) || ((sum.has(y.ref) && sum.get(y.ref).asks.length > 0) - (sum.has(x.ref) && sum.get(x.ref).asks.length > 0)) || rarIdx(x) - rarIdx(y) || byName(x, y));
        paintList(list, count, refs, (a) => itemRow(a, sum.get(a.ref), 'buy'), fb,
          q || fb.active() ? 'Nada coincide con tu búsqueda. Prueba con otro nombre o quita algún filtro.' : 'El mercado está vacío. Busca cualquier Pokémon u objeto para publicar un pedido de compra, o vende algo desde «Vender».');
      }
      const def = DEF.browse;
      const fb = filterBar(st, def, [
        { k: 'cat', t: 'sel', ph: 'Tipo de artículo', opts: [...KINDS, ['sets', 'Para mis colecciones']] },
        { k: 'rar', t: 'sel', ph: 'Rareza', opts: RARS },
        { k: 'type', t: 'sel', ph: 'Tipo Pokémon', opts: [['', 'Cualquier tipo'], ...S.data.types.map((t) => [t, TYPE_ES[t]])] },
        { k: 'gen', t: 'sel', ph: 'Región', opts: [['', 'Todas las regiones'], ...REGIONS.map((r, i) => [String(i + 1), `${r} (gen. ${i + 1})`])] },
        { k: 'min', t: 'num', ph: 'Precio mín.' },
        { k: 'max', t: 'num', ph: 'Precio máx.' },
        { k: 'side', t: 'sel', ph: 'Órdenes', opts: [['', 'Con o sin órdenes'], ['asks', 'Solo con ofertas de venta'], ['bids', 'Solo con pedidos de compra']] },
        { k: 'sort', t: 'sel', sort: true, ph: 'Orden', opts: [['', 'Orden: relevancia'], ['cheap', 'Más barato'], ['exp', 'Más caro'], ['offers', 'Más ofertas'], ['sold', 'Más vendidos (30 días)'], ['name', 'Nombre']] },
      ], 'Busca cualquier Pokémon u objeto…', draw);
      draw();
      return {
        redraw: draw,
        el: h('div', { class: 'stack' }, fb.el, count,
          h('p', { class: 'small muted' }, 'Pulsa un artículo para ver sus ofertas una a una. El precio mín./máx. se aplica a la oferta más barata.'),
          list),
      };
    }

    function sellTab() {
      const st = F.sell;
      const list = h('div', { class: 'mk-list' });
      const count = h('div', { class: 'small muted mkf-count' });
      function draw() {
        const sum = summary();
        const q = norm(st.q.trim());
        let goods = [];
        for (const [id, c] of Object.entries(S.me.collection)) {
          if (c.n - c.s > 0) goods.push({ a: { kind: 'poke', pokeId: Number(id), shiny: false }, n: c.n - c.s });
          if (c.s > 0) goods.push({ a: { kind: 'poke', pokeId: Number(id), shiny: true }, n: c.s });
        }
        for (const [id, n] of Object.entries(S.me.items)) if (n > 0) goods.push({ a: { kind: 'item', itemId: id }, n });
        if (S.me.dust > 0) goods.push({ a: { kind: 'dust' }, n: S.me.dust });
        for (const g of goods) g.a.ref = refOf(g.a);
        const bid = (g) => { const r = sum.get(g.a.ref); return r && r.bids[0] ? r.bids[0].price : 0; };
        goods = goods.filter((g) => matchQ(g.a, q) && passItem(g.a, st) && (!st.dup || g.n >= 2) && (!st.bids || bid(g) > 0));
        const cmp = {
          name: (x, y) => byName(x.a, y.a),
          rar: (x, y) => rarIdx(x.a) - rarIdx(y.a),
          qty: (x, y) => y.n - x.n,
          bid: (x, y) => bid(y) - bid(x),
        }[st.sort];
        goods.sort((x, y) => (cmp && cmp(x, y)) || (!!bid(y) - !!bid(x)) || rarIdx(x.a) - rarIdx(y.a) || byName(x.a, y.a));
        paintList(list, count, goods, (g) => itemRow(g.a, sum.get(g.a.ref), 'sell', g.n), fb,
          fb.active() ? 'Ninguno de tus artículos coincide. Prueba con otro nombre o quita algún filtro.' : 'No tienes nada que vender todavía.');
      }
      const fb = filterBar(st, DEF.sell, [
        { k: 'cat', t: 'sel', ph: 'Tipo de artículo', opts: KINDS },
        { k: 'rar', t: 'sel', ph: 'Rareza', opts: RARS },
        { k: 'dup', t: 'chk', ph: 'Solo repetidos (2+)' },
        { k: 'bids', t: 'chk', ph: 'Con pedidos de compra' },
        { k: 'sort', t: 'sel', sort: true, ph: 'Orden', opts: [['', 'Orden: más demandado'], ['rar', 'Rareza'], ['qty', 'Más copias'], ['bid', 'Mejor pedido'], ['name', 'Nombre']] },
      ], 'Busca en tu inventario…', draw);
      draw();
      return { redraw: draw, el: h('div', { class: 'stack' }, fb.el, count, h('p', { class: 'small muted' }, 'Tu inventario. «Vender» llena los pedidos de compra más altos; «Orden de venta» publica tu precio. Pulsa un artículo para ver los pedidos de compra.'), list) };
    }

    function mine() {
      const st = F.mine;
      const sells = h('div', { class: 'mk-list' });
      const buys = h('div', { class: 'mk-list' });
      const hs = h('h3', {});
      const hb = h('h3', {});
      const count = h('div', { class: 'small muted mkf-count' });
      const card = (o) => {
        const a = parseRef(o.ref);
        const sell = o.side === 'sell';
        const done = o.qty0 - o.qty;
        return h('div', { class: 'mk-ocard', 'data-order': o.id },
          thumb(a),
          h('div', { class: 'mk-oinfo' }, h('b', {}, nameOf(a)),
            h('div', { class: 'small' }, `${fmt(done)}/${fmt(o.qty0)} ${sell ? 'vendidos' : 'comprados'}`),
            h('div', { class: 'mk-prog', role: 'progressbar', 'aria-valuenow': done, 'aria-valuemax': o.qty0 }, h('i', { style: { width: Math.round((done / o.qty0) * 100) + '%' } }))),
          h('div', { class: 'mk-ometa' },
            h('span', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(o.price), h('span', { class: 'muted small' }, '/ud')),
            h('span', { class: 'small ' + (urgent(o) ? 'bad' : 'muted') }, `Caduca en ${timeLeft(o)}`),
            sell ? '' : h('span', { class: 'small muted' }, `Apartadas: ${fmt(o.qty * o.price)}`)),
          h('button', { class: 'btn small danger mk-cancel', type: 'button', onclick: async (e) => { if (await act('market:cancel', { id: o.id }, e.target)) toast('Orden cancelada: se te devolvió lo que quedaba en depósito.', 'success'); } }, 'Cancelar'));
      };
      function draw() {
        const q = norm(st.q.trim());
        const cmp = { old: (x, y) => x.createdAt - y.createdAt, cheap: (x, y) => x.price - y.price, exp: (x, y) => y.price - x.price, soon: (x, y) => expiryOf(x) - expiryOf(y) }[st.sort] || ((x, y) => y.createdAt - x.createdAt);
        const all = state.orders.filter((o) => isMine(o) && matchQ(parseRef(o.ref), q)).sort(cmp);
        const sl = all.filter((o) => o.side === 'sell');
        const bl = all.filter((o) => o.side === 'buy');
        const none = (m) => h('div', { class: 'muted small mk-none' }, m);
        const empty = fb.active() ? 'Ninguna coincide con los filtros.' : null;
        hs.textContent = `Órdenes de venta (${sl.length})`;
        hb.textContent = `Pedidos de compra (${bl.length})`;
        count.replaceChildren(`Monedas apartadas en pedidos: `, h('b', {}, fmt(bl.reduce((s, o) => s + o.qty * o.price, 0))));
        sells.replaceChildren(...(sl.length ? sl.map(card) : [none(empty || 'No tienes órdenes de venta. Publícalas desde «Vender».')]));
        buys.replaceChildren(...(bl.length ? bl.map(card) : [none(empty || 'No tienes pedidos de compra. Créalos desde «Comprar».')]));
      }
      const fb = filterBar(st, DEF.mine, [
        { k: 'sort', t: 'sel', sort: true, ph: 'Orden', opts: [['', 'Más recientes'], ['old', 'Más antiguas'], ['soon', 'Caducan antes'], ['cheap', 'Precio: menor a mayor'], ['exp', 'Precio: mayor a menor']] },
      ], 'Busca por artículo…', draw);
      draw();
      return { redraw: draw, el: h('div', { class: 'stack' }, fb.el, count, hs, sells, hb, buys) };
    }

    function historyTab() {
      const st = F.history;
      const list = h('div', { class: 'mk-list' });
      const count = h('div', { class: 'small muted mkf-count' });
      function draw() {
        const q = norm(st.q.trim());
        const day = new Date(); day.setHours(0, 0, 0, 0);
        const since = st.range === 'today' ? day.getTime() : st.range ? Date.now() - Number(st.range) * 86400000 : 0;
        const me = S.me.username;
        const tr = state.trades.filter((t) => t.at >= since
          && (st.side !== 'mine' || t.buyer === me || t.seller === me)
          && (st.side !== 'buy' || t.buyer === me) && (st.side !== 'sell' || t.seller === me)
          && matchQ(parseRef(t.ref), q));
        paintList(list, count, tr, (t) => {
          const a = parseRef(t.ref);
          const bought = t.buyer === me;
          const sold = t.seller === me;
          const verb = bought ? 'Compra' : sold ? 'Venta' : 'Operación';
          return h('button', { class: 'mk-ocard mk-hist' + (bought ? ' bought' : sold ? ' sold' : ''), type: 'button', onclick: () => openItem(a) }, thumb(a),
            h('div', { class: 'mk-oinfo' }, h('b', {}, `${t.qty > 1 ? t.qty + '× ' : ''}${nameOf(a)}`),
              h('div', { class: 'small' }, h('span', { class: bought ? 'tag-buy' : sold ? 'tag-sell' : 'mk-kind' }, verb.toUpperCase()), ` ${t.seller}`, npcTag(t.sellerNpc), ` → ${t.buyer}`, npcTag(t.buyerNpc)),
              h('div', { class: 'small muted' }, new Date(t.at).toLocaleString('es-ES'))),
            h('div', { class: 'mk-ometa' }, h('span', { class: 'mk-price' }, h('span', { class: 'coin-ico' }), fmt(t.price), h('span', { class: 'muted small' }, '/ud')),
              t.qty > 1 ? h('span', { class: 'small muted' }, `Total ${fmt(t.qty * t.price)}`) : '', h('span', { class: 'small gold-text' }, '📈 Precios')));
        }, fb, fb.active() ? 'Ninguna operación coincide con los filtros.' : st.side === 'mine' ? 'Aún no has comprado ni vendido nada. Cuando lo hagas, aparecerá aquí.' : 'Todavía no hay ventas.');
      }
      const fb = filterBar(st, DEF.history, [
        { k: 'side', t: 'sel', ph: 'Operaciones', opts: [['mine', 'Mis operaciones'], ['', 'Todo el mercado'], ['buy', 'Solo mis compras'], ['sell', 'Solo mis ventas']] },
        { k: 'range', t: 'seg', ph: 'Fecha', opts: [['today', 'Hoy'], ['7', '7 días'], ['30', '30 días']] },
      ], 'Busca por artículo…', draw);
      draw();
      return { redraw: draw, el: h('div', { class: 'stack' }, fb.el, count, h('p', { class: 'small muted' }, 'Últimas operaciones del mercado. Pulsa una para ver la gráfica de precios del artículo.'), list) };
    }

    let cur = null; // pestaña activa: { el, redraw }
    function render() {
      if (!state) return;
      cur = (tab === 'browse' ? browse : tab === 'sell' ? sellTab : tab === 'mine' ? mine : historyTab)();
      body.replaceChildren(cur.el);
      paintRates();
    }
    const ratesLine = h('p', { class: 'muted' });
    const paintRates = () => {
      ratesLine.replaceChildren(`Entre entrenadores · comisión de publicación ${pct(marketFee())} % · impuesto de venta ${pct(salesTax())} %`,
        marketFee() < S.data.marketFee ? h('span', { class: 'event-pill' }, '🏪 Viernes de Mercado') : '');
    };
    paintRates();
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏪 Mercado'), ratesLine), helpBox(), tabs, body);
    renderTabs();
    let meTimer = null;
    this.offs = [bus.on('market', (s) => { state = s; if (cur) cur.redraw(); else render(); }),
      // Tu inventario cambia al comprar/vender: se repinta «Vender» con lo que realmente tienes.
      bus.on('me', () => { if (tab !== 'sell' || !cur || !state) return; clearTimeout(meTimer); meTimer = setTimeout(() => { if (cur && tab === 'sell') cur.redraw(); }, 120); })];
    const r = await act('market:state');
    if (r) { state = r; render(); }
  },
  unmount() { this.offs.forEach((f) => f()); },
};

// El estado del mercado se mantiene actualizado aunque no esté abierta la vista (para las fichas).
bus.on('market', (s) => { state = s; });

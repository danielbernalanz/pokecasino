'use strict';
// Mercado al estilo Albion Online: libro de órdenes por artículo con órdenes de venta y de compra.
// - Comprar ya: toma las órdenes de venta más baratas. Vender ya: llena los pedidos de compra más altos.
// - Las órdenes que no se llenan quedan publicadas (con comisión de publicación) y se llenan parcialmente.
// - Todo lo publicado queda en depósito: los artículos (venta) o las monedas (compra).
const db = require('./db');
const hub = require('./hub');
const gacha = require('./gacha');
const items = require('./items');
const { BY_ID } = require('./pokedex');

const SETUP_FEE = 0.015; // al publicar una orden (no se devuelve)
const SALES_TAX = 0.03; // al vendedor en cada venta
const DAY_MS = 24 * 3600 * 1000;
const EXPIRE_MS = 14 * DAY_MS;
const DURATIONS = [1, 3, 7, 14]; // días que puede durar una orden (por defecto 14)
const MAX_ORDERS = 30;
const MAX_PRICE = 10_000_000;
const MAX_QTY = { poke: 20, item: 999, dust: 1_000_000 };
const M = () => db.data.market;
// Comerciantes NPC (carga diferida: npc.js usa este módulo).
const npc = () => require('./npc');
const today = () => new Date().toISOString().slice(0, 10);

// ---- Artículos ----
function parseRef(o) {
  const kind = o.kind;
  if (kind === 'poke') {
    const pokeId = Number(o.pokeId);
    if (!BY_ID.has(pokeId)) throw new Error('Pokémon desconocido.');
    return { kind, pokeId, shiny: !!o.shiny, ref: `poke:${pokeId}:${o.shiny ? 1 : 0}` };
  }
  if (kind === 'item') {
    const itemId = String(o.itemId);
    if (!items.ITEMS[itemId]) throw new Error('Objeto desconocido.');
    return { kind, itemId, ref: `item:${itemId}` };
  }
  if (kind === 'dust') return { kind, ref: 'dust' };
  throw new Error('Artículo no válido.');
}
const refKey = (l) => parseRef(l).ref;

function describe(a, qty) {
  if (a.kind === 'poke') return `${qty > 1 ? qty + '× ' : ''}${BY_ID.get(a.pokeId).name}${a.shiny ? ' variocolor' : ''}`;
  if (a.kind === 'item') return `${qty}× ${items.ITEMS[a.itemId].name}`;
  return `${qty} ✦ polvo estelar`;
}

// Cuántas unidades de un artículo tiene un jugador disponibles para vender.
function owned(user, a) {
  if (a.kind === 'poke') {
    const c = user.collection[a.pokeId];
    if (!c) return 0;
    // Las estrellas de Caramelo Raro están ligadas: no se venden (y se conserva una copia real que las respalde).
    const busy = require('./specimen').busyCount(user, a.pokeId); // los ejemplares de expedición o criadero no se venden
    const free = (c.cn || 0) > 0 ? Math.min(a.shiny ? c.s : c.n - c.cn - c.s, gacha.spareCopies(c)) : a.shiny ? c.s : c.n - c.s;
    return Math.max(0, free - (a.shiny ? busy.shiny : busy.total - busy.shiny));
  }
  if (a.kind === 'item') return user.items[a.itemId] || 0;
  return user.dust;
}
function takeGoods(user, a, qty) {
  if (owned(user, a) < qty) throw new Error(`No tienes ${describe(a, qty)}.`);
  if (a.kind === 'poke') for (let i = 0; i < qty; i++) gacha.takePoke(user, a.pokeId, a.shiny);
  else if (a.kind === 'item') items.take(user, a.itemId, qty);
  else user.dust -= qty;
}
// Entrega artículos; devuelve el polvo extra si un Pokémon supera las 5 copias.
function giveGoods(user, a, qty) {
  let dust = 0;
  if (a.kind === 'poke') for (let i = 0; i < qty; i++) dust += gacha.grant(user, a.pokeId, a.shiny).dust;
  else if (a.kind === 'item') user.items[a.itemId] = (user.items[a.itemId] || 0) + qty;
  else user.dust += qty;
  return dust;
}

function validDays(payload) {
  if (payload.days == null || payload.days === '') return 14;
  const d = Number(payload.days);
  if (!DURATIONS.includes(d)) throw new Error('Duración no válida: 1, 3, 7 o 14 días.');
  return d;
}
function validQtyPrice(a, qty, price) {
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY[a.kind]) throw new Error(`Cantidad entre 1 y ${MAX_QTY[a.kind]}.`);
  if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) throw new Error('Precio por unidad entre 1 y 10.000.000.');
}
// El «Viernes de Mercado» quita el impuesto y deja la comisión a la mitad.
const marketDay = () => require('./events').has('market');
const setupFee = () => (marketDay() ? SETUP_FEE / 2 : SETUP_FEE);
const salesTax = () => (marketDay() ? 0 : SALES_TAX);
const fee = (total) => Math.max(1, Math.ceil(total * setupFee()));

// ---- Historial de precios ----
function record(a, qty, price, seller, buyer, npcFlags = {}) {
  const m = M();
  const t = { ref: a.ref, kind: a.kind, pokeId: a.pokeId, shiny: a.shiny, itemId: a.itemId, qty, price, seller, buyer, at: Date.now() };
  // Operaciones con un comerciante NPC: se marcan y no entran en las medias de precio de los jugadores.
  if (npcFlags.sellerNpc || npcFlags.buyerNpc) Object.assign(t, { npc: true, sellerNpc: !!npcFlags.sellerNpc, buyerNpc: !!npcFlags.buyerNpc });
  m.trades.push(t);
  if (m.trades.length > 500) m.trades.splice(0, m.trades.length - 500);
  if (!t.npc) {
    const day = ((m.history[a.ref] ||= {})[today()] ||= { n: 0, sum: 0, min: price, max: price });
    day.n += qty;
    day.sum += qty * price;
    day.min = Math.min(day.min, price);
    day.max = Math.max(day.max, price);
    // Solo se guardan 30 días por artículo.
    const days = Object.keys(m.history[a.ref]).sort();
    for (const d of days.slice(0, Math.max(0, days.length - 30))) delete m.history[a.ref][d];
  }
  // Los comerciantes NPC no llenan el feed con sus operaciones (solo anuncian encargos y ofertas, ver npc.js).
  if (!t.npc && (qty * price >= 10000 || (a.kind === 'poke' && (a.shiny || ['L', 'M'].includes(BY_ID.get(a.pokeId).rarity))))) {
    hub.feed('market', `🏪 ${buyer} compró ${describe(a, qty)} a ${seller} por ${(qty * price).toLocaleString('es')} monedas`, a.kind === 'poke' ? { pokeId: a.pokeId, shiny: a.shiny } : {});
  }
}

// Paga al vendedor (menos impuesto) y avisa a ambas partes.
function settle(a, qty, price, seller, buyer) {
  const gross = qty * price;
  const tax = Math.floor(gross * salesTax());
  seller.coins += gross - tax;
  hub.ledger(seller, gross, 'market_sale', `${qty} × ${a.ref}`);
  if (tax) hub.ledger(seller, -tax, 'market_tax', `${qty} × ${a.ref}`);
  seller.stats.sold = (seller.stats.sold || 0) + qty;
  buyer.stats.bought = (buyer.stats.bought || 0) + qty;
  const dust = giveGoods(buyer, a, qty);
  record(a, qty, price, seller.username, buyer.username, { sellerNpc: seller.npc, buyerNpc: buyer.npc });
  npc().note(seller, buyer, a, qty, price);
  hub.track(buyer, 'market_buy');
  hub.track(seller, 'market_sell');
  hub.emitUser(seller.id, 'toast', { kind: 'market', text: `🏪 Vendiste ${describe(a, qty)} a ${buyer.username}: +${(gross - tax).toLocaleString('es')} monedas` });
  hub.emitUser(buyer.id, 'toast', { kind: 'market', text: `🏪 Compraste ${describe(a, qty)} por ${gross.toLocaleString('es')} monedas${dust ? ` (+${dust} ✦ por copias de más)` : ''}` });
  hub.pushMe(seller);
  hub.pushMe(buyer);
}

// Se comprueba antes de operar para no dejar una operación a medias si luego falla.
function checkOrderLimit(user, instant) {
  if (!instant && M().orders.filter((o) => o.userId === user.id && o.qty > 0).length >= MAX_ORDERS) throw new Error(`Máximo ${MAX_ORDERS} órdenes activas.`);
}
// Monedas que un jugador tiene bloqueadas en pedidos de compra.
const lockedIn = (user) => M().orders.filter((o) => o.userId === user.id && o.side === 'buy').reduce((s, o) => s + o.qty * o.price, 0);

const book = (ref, side) => M().orders.filter((o) => o.ref === ref && o.side === side && o.qty > 0);
const removeEmpty = () => { M().orders = M().orders.filter((o) => o.qty > 0); };

// ---- Vender: llena pedidos de compra y publica el resto como orden de venta ----
function sell(user, payload) {
  const a = parseRef(payload);
  const qty = Number(payload.qty);
  const price = Number(payload.price);
  const onlyId = payload.orderId != null ? Number(payload.orderId) : null; // llenar solo esa orden concreta
  const instant = !!payload.instant || onlyId != null;
  const days = validDays(payload);
  validQtyPrice(a, qty, price);
  if (owned(user, a) < qty) throw new Error(`No tienes ${describe(a, qty)}.`);
  if (!instant && user.coins < fee(qty * price)) throw new Error('No tienes monedas para la comisión de publicación.');
  checkOrderLimit(user, instant);
  let left = qty;
  let earned = 0;
  const bids = book(a.ref, 'buy').filter((o) => o.price >= price && o.userId !== user.id && (onlyId == null || o.id === onlyId))
    .sort((x, y) => y.price - x.price || x.createdAt - y.createdAt);
  let why = null; // por qué un comerciante NPC no pudo llenar la orden
  for (const o of bids) {
    if (!left) break;
    const buyer = db.userById(o.userId);
    if (!buyer) continue;
    if (user.npc && buyer.npc) continue; // los NPC nunca operan entre ellos
    let q = Math.min(left, o.qty);
    if (user.npc || buyer.npc) {
      q = Math.min(q, npc().cap(user, buyer, a, o.price));
      if (q <= 0) { why ||= npc().whyBlocked(user, buyer, a); continue; }
    }
    takeGoods(user, a, q);
    o.qty -= q; // las monedas ya estaban en depósito en la orden de compra
    settle(a, q, o.price, user, buyer);
    earned += q * o.price;
    left -= q;
  }
  let order = null;
  if (left && !instant) {
    user.coins -= fee(left * price);
    hub.ledger(user, -fee(left * price), 'market_fee', a.ref);
    takeGoods(user, a, left);
    order = { id: M().nextId++, side: 'sell', ...a, userId: user.id, username: user.username, price, qty: left, qty0: left, createdAt: Date.now(), expiresAt: Date.now() + days * DAY_MS, ...(user.npc ? { npc: true } : {}) };
    M().orders.push(order);
    hub.track(user, 'market_list');
  }
  if (instant && left === qty) throw new Error(why || 'No hay pedidos de compra a ese precio.');
  removeEmpty();
  db.save();
  push();
  return { filled: qty - left, earned, order };
}

// ---- Comprar: toma órdenes de venta y publica el resto como pedido de compra ----
function buy(user, payload) {
  const a = parseRef(payload);
  const qty = Number(payload.qty);
  const price = Number(payload.price);
  const onlyId = payload.orderId != null ? Number(payload.orderId) : null; // llenar solo esa orden concreta
  const instant = !!payload.instant || onlyId != null;
  const days = validDays(payload);
  validQtyPrice(a, qty, price);
  const maxP = require('./transfer').maxBuyPrice(user, a);
  if (price > maxP) throw new Error(`Las cuentas nuevas (menos de nivel 3 o de 3 días) no pueden pagar más de ${maxP.toLocaleString('es')} por unidad de esto.`);
  const worst = qty * price + (instant ? 0 : fee(qty * price));
  if (user.coins < worst) throw new Error(`Necesitas hasta ${worst.toLocaleString('es')} monedas.`);
  checkOrderLimit(user, instant);
  let left = qty;
  let spent = 0;
  const asks = book(a.ref, 'sell').filter((o) => o.price <= price && o.userId !== user.id && (onlyId == null || o.id === onlyId))
    .sort((x, y) => x.price - y.price || x.createdAt - y.createdAt);
  let why = null;
  for (const o of asks) {
    if (!left) break;
    const seller = db.userById(o.userId);
    if (!seller) continue;
    if (user.npc && seller.npc) continue; // los NPC nunca operan entre ellos
    let q = Math.min(left, o.qty);
    if (user.npc || seller.npc) {
      q = Math.min(q, npc().cap(seller, user, a, o.price));
      if (q <= 0) { why ||= npc().whyBlocked(seller, user, a); continue; }
    }
    user.coins -= q * o.price;
    hub.ledger(user, -q * o.price, 'market_buy', `${q} × ${a.ref}`);
    o.qty -= q; // los artículos ya estaban en depósito en la orden de venta
    settle(a, q, o.price, seller, user);
    spent += q * o.price;
    left -= q;
  }
  let order = null;
  if (left && !instant) {
    user.coins -= left * price + fee(left * price);
    hub.ledger(user, -left * price, 'market_buy', `Pedido: ${left} × ${a.ref}`);
    hub.ledger(user, -fee(left * price), 'market_fee', a.ref);
    order = { id: M().nextId++, side: 'buy', ...a, userId: user.id, username: user.username, price, qty: left, qty0: left, createdAt: Date.now(), expiresAt: Date.now() + days * DAY_MS, ...(user.npc ? { npc: true } : {}) };
    M().orders.push(order);
    hub.track(user, 'market_list');
  }
  if (instant && left === qty) throw new Error(why || 'No hay ofertas de venta a ese precio.');
  removeEmpty();
  db.save();
  push();
  return { filled: qty - left, spent, order };
}

// Devuelve lo que queda en depósito de una orden.
function refundOrder(o) {
  const u = db.userById(o.userId);
  if (!u || o.qty <= 0) return;
  if (o.side === 'sell') giveGoods(u, o, o.qty);
  else { u.coins += o.qty * o.price; hub.ledger(u, o.qty * o.price, 'market_refund', `${o.qty} × ${o.ref}`); }
  hub.pushMe(u);
}

function cancel(user, { id }) {
  const o = M().orders.find((x) => x.id === Number(id));
  if (!o || (o.userId !== user.id && !user.isAdmin)) throw new Error('Orden no encontrada.');
  refundOrder(o);
  M().orders = M().orders.filter((x) => x !== o);
  db.save();
  push();
  return {};
}

function history(_user, payload) {
  const a = parseRef(payload);
  const h = M().history[a.ref] || {};
  return { ref: a.ref, days: Object.entries(h).sort(([x], [y]) => x.localeCompare(y)).map(([day, d]) => ({ day, ...d, avg: Math.round(d.sum / d.n) })) };
}

function state() {
  const m = M();
  const stats = {};
  for (const [ref, days] of Object.entries(m.history)) {
    const list = Object.values(days);
    const n = list.reduce((s, d) => s + d.n, 0);
    stats[ref] = { avg: n ? Math.round(list.reduce((s, d) => s + d.sum, 0) / n) : 0, n };
  }
  return {
    orders: m.orders.map(({ id, side, ref, kind, pokeId, shiny, itemId, username, price, qty, qty0, createdAt, expiresAt, npc, flash }) => ({ id, side, ref, kind, pokeId, shiny, itemId, username, price, qty, qty0, createdAt, expiresAt: expiresAt || createdAt + EXPIRE_MS, ...(npc ? { npc: true } : {}), ...(flash ? { flash } : {}) })),
    trades: m.trades.slice(-40).reverse(), stats, setupFee: setupFee(), salesTax: salesTax(), npcs: npc().publicState(),
  };
}
function push() { hub.broadcast('market', state()); }

// Caducidad de órdenes antiguas.
function sweep() {
  const now = Date.now();
  const old = M().orders.filter((o) => now > (o.expiresAt || o.createdAt + EXPIRE_MS));
  for (const o of old) {
    refundOrder(o);
    hub.emitUser(o.userId, 'toast', { kind: 'market', text: `🏪 Tu orden de ${o.side === 'sell' ? 'venta' : 'compra'} de ${describe(o, o.qty)} caducó y se te devolvió.` });
  }
  if (old.length) { M().orders = M().orders.filter((o) => !old.includes(o)); db.save(); push(); }
}

// Convierte los anuncios del mercado anterior (precio total fijo) en órdenes de venta.
function migrate() {
  const m = M();
  m.orders ||= [];
  m.trades ||= [];
  m.history ||= {};
  for (const l of m.listings || []) {
    const a = parseRef(l);
    const qty = l.qty || 1;
    m.orders.push({ id: l.id, side: 'sell', ...a, userId: l.sellerId, username: l.seller, price: Math.max(1, Math.round(l.price / qty)), qty, qty0: qty, createdAt: l.createdAt });
  }
  delete m.listings;
  delete m.sales;
}

function init() {
  migrate();
  sweep();
  setInterval(sweep, 10 * 60 * 1000).unref();
}

module.exports = { init, push, sell, buy, cancel, history, state, refKey, SETUP_FEE, SALES_TAX, owned, parseRef, lockedIn, describe, fee, DURATIONS, sweep };

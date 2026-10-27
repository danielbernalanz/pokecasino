'use strict';
// Mercado entre jugadores. Lo que se pone a la venta queda en depósito (escrow):
// sale del inventario del vendedor al publicar y vuelve si se cancela o caduca.
const db = require('./db');
const hub = require('./hub');
const gacha = require('./gacha');
const items = require('./items');
const { BY_ID } = require('./pokedex');

const FEE = 0.05;
const MAX_LISTINGS = 20;
const MAX_PRICE = 10_000_000;
const EXPIRE_MS = 7 * 24 * 3600 * 1000;
const M = () => db.data.market;

// Clave que identifica "lo mismo" para estadísticas de precio.
function refKey(l) {
  if (l.kind === 'poke') return `poke:${l.pokeId}:${l.shiny ? 1 : 0}`;
  if (l.kind === 'item') return `item:${l.itemId}`;
  return 'dust';
}

function describe(l) {
  if (l.kind === 'poke') return `${BY_ID.get(l.pokeId).name}${l.shiny ? ' variocolor' : ''}`;
  if (l.kind === 'item') return `${l.qty}× ${items.ITEMS[l.itemId].name}`;
  return `${l.qty} ✦ polvo estelar`;
}

// ---- Depósito ----
function escrowIn(user, l) {
  if (l.kind === 'poke') gacha.takePoke(user, l.pokeId, l.shiny);
  else if (l.kind === 'item') items.take(user, l.itemId, l.qty);
  else {
    if (user.dust < l.qty) throw new Error('No tienes tanto polvo estelar.');
    user.dust -= l.qty;
  }
}
function deliver(user, l) {
  if (l.kind === 'poke') return gacha.grant(user, l.pokeId, l.shiny);
  if (l.kind === 'item') { user.items[l.itemId] = (user.items[l.itemId] || 0) + l.qty; return {}; }
  user.dust += l.qty;
  return {};
}

function create(user, { kind, pokeId, shiny, itemId, qty, price }) {
  price = Number(price);
  if (!Number.isInteger(price) || price < 1 || price > MAX_PRICE) throw new Error('Precio no válido (1 – 10.000.000).');
  if (M().listings.filter((l) => l.sellerId === user.id).length >= MAX_LISTINGS) throw new Error(`Máximo ${MAX_LISTINGS} anuncios a la vez.`);
  const l = { id: M().nextId++, sellerId: user.id, seller: user.username, kind, price, createdAt: Date.now() };
  if (kind === 'poke') {
    l.pokeId = Number(pokeId);
    l.shiny = !!shiny;
    l.qty = 1;
    if (!BY_ID.has(l.pokeId)) throw new Error('Pokémon desconocido.');
    l.rarity = BY_ID.get(l.pokeId).rarity;
  } else if (kind === 'item') {
    l.itemId = String(itemId);
    l.qty = Number(qty);
    if (!items.ITEMS[l.itemId]) throw new Error('Objeto desconocido.');
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 99) throw new Error('Cantidad 1 – 99.');
  } else if (kind === 'dust') {
    l.qty = Number(qty);
    if (!Number.isInteger(l.qty) || l.qty < 10 || l.qty > 1_000_000) throw new Error('Vende al menos 10 de polvo.');
  } else {
    throw new Error('Tipo de anuncio no válido.');
  }
  escrowIn(user, l);
  M().listings.push(l);
  hub.track(user, 'market_list');
  db.save();
  push();
  if (l.kind === 'poke' && (l.shiny || ['L', 'M'].includes(l.rarity))) {
    hub.feed('market', `🏪 ${user.username} vende ${describe(l)} por ${price.toLocaleString('es')} monedas`, { pokeId: l.pokeId, shiny: l.shiny });
  }
  return { listing: l };
}

function remove(id) {
  const i = M().listings.findIndex((l) => l.id === Number(id));
  return i === -1 ? null : M().listings.splice(i, 1)[0];
}

function cancel(user, { id }) {
  const l = M().listings.find((x) => x.id === Number(id));
  if (!l || (l.sellerId !== user.id && !user.isAdmin)) throw new Error('Anuncio no encontrado.');
  remove(id);
  const seller = db.userById(l.sellerId);
  if (seller) { deliver(seller, l); hub.pushMe(seller); }
  db.save();
  push();
  return {};
}

function buy(user, { id, price }) {
  const l = M().listings.find((x) => x.id === Number(id));
  if (!l) throw new Error('Ese anuncio ya no está disponible.');
  if (l.sellerId === user.id) throw new Error('No puedes comprar tu propio anuncio.');
  // El cliente envía el precio que vio: si cambió, no se compra.
  if (price !== undefined && Number(price) !== l.price) throw new Error('El precio ha cambiado, revisa el anuncio.');
  if (user.coins < l.price) throw new Error('No tienes suficientes monedas.');
  const seller = db.userById(l.sellerId);
  remove(l.id);
  user.coins -= l.price;
  const fee = Math.floor(l.price * FEE);
  const got = deliver(user, l);
  if (seller) {
    seller.coins += l.price - fee;
    seller.stats.sold++;
    hub.emitUser(seller.id, 'toast', { kind: 'market', text: `🏪 ${user.username} compró tu ${describe(l)}: +${(l.price - fee).toLocaleString('es')} monedas` });
    hub.pushMe(seller);
  }
  user.stats.bought++;
  hub.track(user, 'market_buy');
  if (seller) hub.track(seller, 'market_sell');
  const sale = { id: l.id, ref: refKey(l), kind: l.kind, pokeId: l.pokeId, shiny: l.shiny, itemId: l.itemId, qty: l.qty, price: l.price, seller: l.seller, buyer: user.username, at: Date.now() };
  M().sales.push(sale);
  if (M().sales.length > 300) M().sales.splice(0, M().sales.length - 300);
  db.save();
  push();
  if (l.price >= 10000 || (l.kind === 'poke' && (l.shiny || ['L', 'M'].includes(l.rarity)))) {
    hub.feed('market', `🏪 ${user.username} compró ${describe(l)} a ${l.seller} por ${l.price.toLocaleString('es')} monedas`, l.kind === 'poke' ? { pokeId: l.pokeId, shiny: l.shiny } : {});
  }
  return { sale, dustFromDup: got && got.dust ? got.dust : 0 };
}

// Precio medio de las últimas ventas de cada referencia.
function priceStats() {
  const by = {};
  for (const s of M().sales) (by[s.ref] ||= []).push(s.qty > 1 && s.kind !== 'poke' ? s.price / s.qty : s.price);
  const out = {};
  for (const [k, arr] of Object.entries(by)) {
    const last = arr.slice(-10);
    out[k] = { last: Math.round(arr[arr.length - 1]), avg: Math.round(last.reduce((a, b) => a + b, 0) / last.length), n: arr.length };
  }
  return out;
}

function state() {
  return { listings: M().listings, sales: M().sales.slice(-30).reverse(), stats: priceStats(), fee: FEE };
}
function push() { hub.broadcast('market', state()); }

function sweep() {
  const now = Date.now();
  const expired = M().listings.filter((l) => now - l.createdAt > EXPIRE_MS);
  for (const l of expired) {
    remove(l.id);
    const seller = db.userById(l.sellerId);
    if (seller) {
      deliver(seller, l);
      hub.emitUser(seller.id, 'toast', { kind: 'market', text: `🏪 Tu anuncio de ${describe(l)} caducó y se te ha devuelto.` });
    }
  }
  if (expired.length) { db.save(); push(); }
}
setInterval(sweep, 10 * 60 * 1000).unref();
sweep();

module.exports = { create, cancel, buy, state, refKey, FEE };

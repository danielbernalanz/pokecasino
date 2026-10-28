'use strict';
// Comerciantes NPC del Mercado. Compran y venden como un jugador más (mismas funciones market.sell/market.buy:
// comisión, impuesto, depósito y libro de monedas), pero con salvaguardas para que NUNCA sean un grifo de
// monedas ni se puedan manipular:
//  1. PRECIOS ANCLADOS: cada artículo tiene un tope de compra (cap) y un suelo de venta (floor) fijos, calculados
//     a partir del valor de liberar un duplicado, del precio de la tienda o de tablas fijas. Los precios de los
//     jugadores solo mueven al NPC DENTRO de esos límites.
//  2. LÍMITES DIARIOS por jugador (monedas y unidades) y cuentas nuevas/novatas sin acceso a sus compras.
//  3. TESORERÍA FINITA: solo pujan con monedas que tienen; sin fondos solo venden.
//  4. STOCK PROPIO: solo venden lo que han comprado + un pequeño reabastecimiento diario de bienes baratos
//     (crea objetos, no monedas, y se vende por encima del suelo: es un sumidero).
// Los NPC nunca operan entre sí (lo garantiza market.js y el invariante cap < floor de cada artículo).
const db = require('./db');
const hub = require('./hub');
const market = require('./market');
const gacha = require('./gacha');
const items = require('./items');
const { BY_ID, BY_RARITY, RARITY } = require('./pokedex');
const { rand, randInt, pick, shuffle } = require('./rng');

const DUST_RATE = gacha.DUST_RATE;
const FAST = process.env.NPC_FAST === '1'; // solo para pruebas: actúan cada 3-5 s
const INTERVAL = FAST ? [3000, 5000] : [2 * 60 * 1000, 4 * 60 * 1000];

// ---- Límites (ver README) ----
const MIN_LEVEL = 3; // para venderles
const MIN_AGE = 24 * 3600 * 1000;
const SELL_COINS_BASE = 1500; // monedas brutas que un jugador puede cobrar de NPC al día: 1500 + 100 × nivel
const SELL_COINS_PER_LEVEL = 100;
const SELL_UNITS = { poke: 3, item: 3, dust: 100 }; // unidades por artículo y día que un jugador puede venderles
const BUY_UNITS = { poke: 5, item: 5, dust: 200 }; // y que puede comprarles (evita acaparar su stock)
const SPEND_DAILY = 0.15; // fracción de la tesorería que un NPC puede gastar al día
const LOW_FUNDS = 0.2; // por debajo del 20 % de la tesorería inicial dejan de pujar
const MAX_OPEN = 25; // órdenes abiertas por NPC
const STALE_MS = 12 * 3600 * 1000;
const DRIFT = 0.25; // se retira una orden si se aleja más de un 25 % del objetivo actual

// ---- Precios ancladas: tope de compra (cap) y suelo de venta (floor) ----
const POKE_FLOOR = { C: 150, U: 400, R: 1200, E: 4000, L: 15000, M: 30000 };
const BID_FRAC = 0.9; // compran a como mucho el 90 % de lo que da liberar un duplicado
// Objetos sin precio en la tienda y cosméticos: { cap, floor } fijos (floor ≥ 3 × cap).
const NOSHOP = {
  'master-ball': { cap: 2000, floor: 12000 },
  'shiny-charm': { cap: 500, floor: 3000 }, // 10 tiradas con ×4 de variocolor ≈ 0,5 variocolor de más: no vale 1.500
  'mystery-egg': { cap: 150, floor: 900 }, // > valor medio de un cosmético a precio de compra (≈370)
};
const COSMETIC = { // por rareza
  C: { cap: 60, floor: 250 }, U: { cap: 150, floor: 600 }, R: { cap: 400, floor: 1500 }, E: { cap: 1200, floor: 4500 }, L: { cap: 4000, floor: 15000 },
};
const ASK_MAX_MULT = 8; // el precio de venta nunca pasa de 8 × el suelo (si los jugadores comercian a precios absurdos)
const SHINY_ASK_DEFAULT = 3; // sin referencia de mercado, un variocolor se pide a 3 × su suelo

// Devuelve { cap, floor } del artículo, o null si los NPC no lo comercian.
function bounds(a) {
  if (a.kind === 'poke') {
    const r = BY_ID.get(a.pokeId).rarity;
    const cap = Math.max(1, Math.floor(BID_FRAC * RARITY[r].dust * DUST_RATE));
    const floor = Math.max(3 * cap, POKE_FLOOR[r]);
    if (!a.shiny) return { cap, floor };
    // Variocolor: compra ≤ 3 × la normal (liberar da el polvo ×3) y venta ≥ 4 × la normal.
    const scap = 3 * cap;
    return { cap: scap, floor: Math.max(4 * floor, 3 * scap) };
  }
  if (a.kind === 'dust') {
    const cap = Math.max(1, Math.floor(BID_FRAC * DUST_RATE));
    return { cap, floor: Math.max(3 * cap, 2 * DUST_RATE) };
  }
  const it = items.ITEMS[a.itemId];
  if (!it) return null;
  if (it.price) return { cap: Math.max(1, Math.floor(it.price / 2)), floor: it.price }; // nunca por debajo de la tienda
  if (NOSHOP[a.itemId]) return NOSHOP[a.itemId];
  if (it.cosmetic && COSMETIC[it.rarity]) return COSMETIC[it.rarity];
  return null;
}
// Precio de compra más alto posible por tipo de Pokémon normal (para las pruebas del gacha).
const maxBid = (rarity) => Math.max(1, Math.floor(BID_FRAC * RARITY[rarity].dust * DUST_RATE));

// ---- Comerciantes: datos de personalidad ----
// bidFrac: fracción del tope que ofrecen sin referencia de mercado · askMult: múltiplo del suelo que piden sin
// referencia · spread: margen sobre la mediana de los jugadores · jitter: ±% aleatorio de cada precio
// bids/asks: órdenes nuevas por visita · qty: unidades por orden · focus: qué comercian.
const NPCS = [
  { id: 'npc-kecleon', name: 'Kecleon', treasury: 60000, bidFrac: 0.85, askMult: 1.15, spread: 0.10, jitter: 0.05, bids: 3, asks: 2,
    focus: { poke: ['C', 'U'], shiny: false, items: 'shop', cosmetics: false, dust: true } },
  { id: 'npc-bill', name: 'ColeccionBill', treasury: 60000, bidFrac: 0.9, askMult: 1.5, spread: 0.18, jitter: 0.05, bids: 2, asks: 2, sets: true,
    focus: { poke: ['R', 'E'], shiny: false, items: 'none', cosmetics: false, dust: false } },
  { id: 'npc-ginger', name: 'MercaderGinger', treasury: 60000, bidFrac: 0.7, askMult: 1.25, spread: 0.12, jitter: 0.05, bids: 3, asks: 2,
    focus: { poke: [], shiny: false, items: 'noshop', cosmetics: true, dust: false } },
  { id: 'npc-dorado', name: 'TratanteDorado', treasury: 60000, bidFrac: 0.95, askMult: 1.8, spread: 0.25, jitter: 0.05, bids: 2, asks: 2,
    focus: { poke: ['L', 'M'], shiny: true, items: 'none', cosmetics: false, dust: false } },
];
const NAMES = new Set(NPCS.map((n) => n.name.toLowerCase()));
const isNpcName = (name) => NAMES.has(String(name || '').toLowerCase());
const isNpc = (u) => !!(u && u.npc);
const npcUsers = () => Object.values(db.data.users).filter((u) => u.npc);
const profile = (u) => NPCS.find((n) => n.id === u.id);

// ---- Estado persistente: db.data.npc ----
function N() {
  const n = (db.data.npc ||= {});
  n.daily ||= {}; // userId -> { day, got, sold: {ref: uds}, bought: {ref: uds} }
  n.spent ||= {}; // npcId -> { day, base, amt }
  n.lastAct ||= {};
  return n;
}
const today = () => hub.dayKey(); // día UTC, el mismo que usa la economía

// ---- Cuentas ----
function newNpcUser(p, name) {
  return {
    id: p.id, username: name, npc: true, isAdmin: false, banned: false, createdAt: Date.now(),
    coins: 0, dust: 0, xp: 0, level: 10, daily: { last: null, streak: 0, freePull: null }, lastHeal: 0,
    collection: {}, buddy: null, voltorb: { level: 1, game: null },
    stats: { wagered: 0, won: 0, pulls: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0, races: 0 },
    npcStart: p.treasury,
  };
}
// Crea las cuentas que falten (una sola vez) con su tesorería inicial apuntada en el libro de monedas.
// Si un jugador ya tenía ese nombre, el NPC usa otro (nombre corto + _NPC).
function ensure() {
  // Las cuentas que ya existían cuando llegaron los NPC no tienen que esperar 24 h para venderles.
  if (!N().launchedAt) N().launchedAt = Date.now();
  for (const p of NPCS) {
    if (db.userById(p.id)) continue;
    let name = p.name;
    if (db.userByName(name)) name = `${p.name.slice(0, 12)}_NPC`;
    const u = newNpcUser(p, name);
    db.addUser(u);
    u.coins += p.treasury;
    hub.ledger(u, p.treasury, 'npc_fund', 'Tesorería inicial');
  }
  db.save();
}
const treasury = () => {
  const us = npcUsers();
  const coins = us.reduce((s, u) => s + u.coins, 0);
  const locked = us.reduce((s, u) => s + market.lockedIn(u), 0);
  return { n: us.length, coins, locked, start: us.reduce((s, u) => s + (u.npcStart || 0), 0) };
};

// ---- Límites diarios ----
const oldEnough = (u) => u.createdAt == null || u.createdAt < (N().launchedAt || 0) || Date.now() - u.createdAt >= MIN_AGE;
const eligible = (u) => (u.level || 1) >= MIN_LEVEL && oldEnough(u);
const sellLimit = (u) => SELL_COINS_BASE + SELL_COINS_PER_LEVEL * (u.level || 1);
function dayRec(userId) {
  const n = N();
  let r = n.daily[userId];
  if (!r || r.day !== today()) r = n.daily[userId] = { day: today(), got: 0, sold: {}, bought: {} };
  return r;
}
function spendRec(npcUser) {
  const n = N();
  let r = n.spent[npcUser.id];
  if (!r || r.day !== today()) r = n.spent[npcUser.id] = { day: today(), base: npcUser.coins + market.lockedIn(npcUser), amt: 0 };
  return r;
}
const spendLeft = (u) => { const r = spendRec(u); return Math.max(0, Math.floor(SPEND_DAILY * r.base) - r.amt); };

// Unidades máximas que se pueden llenar de un cruce entre `seller` y `buyer` (Infinity si no hay NPC).
function cap(seller, buyer, a, price) {
  if (!seller.npc && !buyer.npc) return Infinity;
  if (seller.npc && buyer.npc) return 0;
  if (buyer.npc) { // un jugador vende a un NPC
    if (!eligible(seller)) return 0;
    const r = dayRec(seller.id);
    const units = SELL_UNITS[a.kind] - (r.sold[a.ref] || 0);
    const coins = Math.floor((sellLimit(seller) - r.got) / price);
    const spend = Math.floor(spendLeft(buyer) / price);
    return Math.max(0, Math.min(units, coins, spend));
  }
  // un NPC vende a un jugador
  return Math.max(0, BUY_UNITS[a.kind] - (dayRec(buyer.id).bought[a.ref] || 0));
}
// Motivo (para el mensaje al jugador) de que un cruce con NPC no se llene; null si es cosa del NPC.
function whyBlocked(seller, buyer, a) {
  if (buyer.npc) {
    if ((seller.level || 1) < MIN_LEVEL) return `Los comerciantes NPC solo compran a entrenadores de nivel ${MIN_LEVEL} o más (tienes nivel ${seller.level || 1}).`;
    if (!oldEnough(seller)) return `Los comerciantes NPC solo compran a cuentas con más de 24 h: podrás venderles dentro de ${Math.ceil((seller.createdAt + MIN_AGE - Date.now()) / 3600e3)} h.`;
    const r = dayRec(seller.id);
    if ((r.sold[a.ref] || 0) >= SELL_UNITS[a.kind] || r.got >= sellLimit(seller)) return 'Hoy ya no puedes vender más a los comerciantes NPC.';
    return null;
  }
  if (seller.npc && (dayRec(buyer.id).bought[a.ref] || 0) >= BUY_UNITS[a.kind]) return 'Hoy ya no puedes comprar más a los comerciantes NPC.';
  return null;
}
// Apunta un cruce ya liquidado (lo llama market.settle).
function note(seller, buyer, a, qty, price) {
  if (buyer.npc && !seller.npc) {
    const r = dayRec(seller.id);
    r.sold[a.ref] = (r.sold[a.ref] || 0) + qty;
    r.got += qty * price;
    spendRec(buyer).amt += qty * price;
  } else if (seller.npc && !buyer.npc) {
    const r = dayRec(buyer.id);
    r.bought[a.ref] = (r.bought[a.ref] || 0) + qty;
  }
}

// ---- Precio objetivo ----
// Mediana de las operaciones recientes ENTRE JUGADORES (sin NPC): al menos 3 operaciones de 2 vendedores distintos.
const REF_DAYS = 7;
function reference(refKey, now = Date.now()) {
  const trades = db.data.market.trades.filter((t) => t.ref === refKey && !t.npc && t.at > now - REF_DAYS * 864e5).slice(-15);
  if (trades.length < 3 || new Set(trades.map((t) => t.seller)).size < 2) return null;
  const ps = trades.map((t) => t.price).sort((x, y) => x - y);
  const mid = Math.floor(ps.length / 2);
  return ps.length % 2 ? ps[mid] : Math.round((ps[mid - 1] + ps[mid]) / 2);
}
const jit = (p) => 1 + (rand() * 2 - 1) * p.jitter;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Precio al que el NPC compra: nunca por encima del tope.
function bidPrice(a, p, med = reference(a.ref)) {
  const b = bounds(a);
  const base = med != null ? med * (1 - p.spread) : b.cap * p.bidFrac;
  return clamp(Math.round(base * jit(p)), 1, b.cap);
}
// Precio al que el NPC vende: nunca por debajo del suelo.
function askPrice(a, p, med = reference(a.ref)) {
  const b = bounds(a);
  const base = med != null ? med * (1 + p.spread) : b.floor * p.askMult * (a.kind === 'poke' && a.shiny ? SHINY_ASK_DEFAULT : 1);
  return clamp(Math.round(base * jit(p)), b.floor, b.floor * ASK_MAX_MULT);
}

// ---- Artículos que le interesan a cada NPC ----
const art = (a) => market.parseRef(a);
function inFocus(p, a) {
  const f = p.focus;
  if (!bounds(a)) return false;
  if (a.kind === 'poke') return a.shiny ? f.shiny : f.poke.includes(BY_ID.get(a.pokeId).rarity);
  if (a.kind === 'dust') return f.dust;
  const it = items.ITEMS[a.itemId];
  if (it.cosmetic) return f.cosmetics;
  if (it.price) return f.items === 'shop';
  return f.items === 'noshop';
}
// Pokémon de colecciones (Bill los busca para completarlas).
let setIds = null;
const inSets = () => (setIds ||= [...new Set(require('./progress').SETS.flatMap((s) => s.ids))]);
function randomArticle(p) {
  const f = p.focus;
  const kinds = [];
  if (f.poke.length) kinds.push('poke');
  if (f.shiny) kinds.push('shiny');
  if (f.items !== 'none') kinds.push('item');
  if (f.cosmetics) kinds.push('cosmetic');
  if (f.dust) kinds.push('dust');
  const kind = pick(kinds);
  let a;
  if (kind === 'poke' || kind === 'shiny') {
    // Los coleccionistas prefieren Pokémon que completan colecciones.
    const sets = kind === 'poke' && p.sets && rand() < 0.6 ? inSets().filter((id) => f.poke.includes(BY_ID.get(id).rarity)) : [];
    // Variocolores: de cualquier rareza (los de rareza baja se pagan al tope bajo y se piden al suelo alto).
    const pool = kind === 'shiny' ? Object.keys(RARITY) : f.poke;
    const id = sets.length ? pick(sets) : pick(BY_RARITY[pick(pool)]).id;
    a = { kind: 'poke', pokeId: id, shiny: kind === 'shiny' };
  } else if (kind === 'dust') a = { kind: 'dust' };
  else {
    const list = Object.keys(items.ITEMS).filter((id) => (kind === 'cosmetic') === !!items.ITEMS[id].cosmetic && inFocus(p, { kind: 'item', itemId: id }));
    a = list.length ? { kind: 'item', itemId: pick(list) } : { kind: 'dust' };
  }
  return art(a);
}

// Lo que el NPC tiene en inventario, como artículos con su cantidad.
function stock(u) {
  const out = [];
  for (const [id, c] of Object.entries(u.collection)) {
    if (c.n - c.s > 0) out.push({ a: art({ kind: 'poke', pokeId: Number(id), shiny: false }), n: c.n - c.s });
    if (c.s > 0) out.push({ a: art({ kind: 'poke', pokeId: Number(id), shiny: true }), n: c.s });
  }
  for (const [id, n] of Object.entries(u.items)) if (n > 0 && bounds({ kind: 'item', itemId: id })) out.push({ a: art({ kind: 'item', itemId: id }), n });
  if (u.dust > 0) out.push({ a: art({ kind: 'dust' }), n: u.dust });
  return out;
}
const orders = () => db.data.market.orders.filter((o) => o.qty > 0);
const openOrders = (u) => orders().filter((o) => o.userId === u.id);
// Cuántas unidades de Pokémon/objeto quiere tener como máximo (para no comprar sin freno).
const STOCK_MAX = { poke: 3, item: 6, dust: 400 };

// ---- Visita de un NPC: retira lo caduco o fuera de límites, publica pedidos y ofertas nuevos ----
function act(u, now = Date.now()) {
  const p = profile(u);
  if (!p) return { cancelled: 0, bids: 0, asks: 0 };
  const res = { cancelled: 0, bids: 0, asks: 0 };
  const low = u.coins < LOW_FUNDS * (u.npcStart || 0);

  // 1. Órdenes propias: fuera de límites, caducas, muy alejadas del objetivo, o pedidos sin fondos.
  for (const o of openOrders(u)) {
    const a = art(o);
    const b = bounds(a);
    const target = o.side === 'buy' ? bidPrice(a, { ...p, jitter: 0 }) : askPrice(a, { ...p, jitter: 0 });
    const bad = !b || (o.side === 'buy' ? o.price > b.cap : o.price < b.floor);
    const drift = Math.abs(o.price - target) / target > DRIFT;
    if (bad || drift || now - o.createdAt > STALE_MS || (o.side === 'buy' && low)) {
      market.cancel(u, { id: o.id });
      res.cancelled++;
    }
  }
  let open = openOrders(u);
  const has = (r, side) => open.some((o) => o.ref === r && o.side === side);

  // 2. Ofertas de venta de su stock (solo lo que tiene).
  for (const s of shuffle(stock(u)).slice(0, p.asks + 2)) {
    if (res.asks >= p.asks || open.length >= MAX_OPEN) break;
    if (has(s.a.ref, 'sell') || has(s.a.ref, 'buy')) continue;
    const listed = open.filter((o) => o.side === 'sell' && o.ref === s.a.ref).reduce((t, o) => t + o.qty, 0);
    const free = s.n - listed;
    if (free < 1) continue;
    const qty = s.a.kind === 'dust' ? Math.min(free, randInt(20, 100)) : Math.min(free, randInt(1, 3));
    const price = askPrice(s.a, p);
    if (u.coins < market.fee(qty * price)) continue;
    try { market.sell(u, { ...s.a, qty, price }); res.asks++; open = openOrders(u); } catch { /* sin comisión, etc. */ }
  }

  // 3. Pedidos de compra: artículos que los jugadores venden y otros al azar de su especialidad.
  if (!low) {
    const wanted = orders()
      .filter((o) => o.side === 'sell' && !o.npc && inFocus(p, art(o))).map((o) => art(o));
    const cands = [...shuffle(wanted).slice(0, p.bids), ...Array.from({ length: 3 }, () => randomArticle(p))];
    for (const a of cands) {
      if (res.bids >= p.bids || open.length >= MAX_OPEN) break;
      if (!inFocus(p, a) || has(a.ref, 'buy') || has(a.ref, 'sell')) continue;
      const have = market.owned(u, a);
      const room = STOCK_MAX[a.kind] - have;
      // Pokémon: más de 5 copias se convierten en polvo, así que no pujan por encima de su tope de stock.
      if (room < 1) continue;
      const qty = a.kind === 'dust' ? Math.min(room, randInt(20, 120)) : Math.min(room, randInt(1, 3));
      const price = bidPrice(a, p);
      const cost = qty * price + market.fee(qty * price);
      // Un pedido nunca supera el 5 % de la tesorería ni lo que queda de su gasto diario.
      if (cost > u.coins || qty * price > spendLeft(u) || qty * price > 0.05 * (u.npcStart || 1)) continue;
      try {
        market.buy(u, { ...a, qty, price });
        res.bids++;
        open = openOrders(u);
        const r = a.kind === 'poke' ? BY_ID.get(a.pokeId).rarity : null;
        if (r && 'REL'.includes(r) && rand() < 0.15) hub.feed('trade', `🧺 ${u.username} busca ${market.describe(a, 1)} (hasta ${price.toLocaleString('es')} monedas)`, { pokeId: a.pokeId, shiny: a.shiny });
      } catch { /* sin monedas */ }
    }
  }
  N().lastAct[u.id] = now;
  return res;
}

// ---- Reabastecimiento diario: crea artículos (no monedas) y se venden por encima del suelo ----
const RESTOCK = { poke: [5, 10], eggs: [1, 2], pokeCap: 40, eggCap: 4 };
function restock() {
  const n = N();
  if (n.restockDay === today()) return { poke: 0, eggs: 0 };
  n.restockDay = today();
  // Se limpian los contadores de jugadores de días anteriores.
  for (const [id, r] of Object.entries(n.daily)) if (r.day !== today()) delete n.daily[id];
  const us = npcUsers().map((u) => ({ u, p: profile(u) })).filter((x) => x.p);
  const done = { poke: 0, eggs: 0 };
  const pokeTotal = (u) => Object.values(u.collection).reduce((s, c) => s + c.n, 0);
  const pool = ['C', 'U'].flatMap((r) => BY_RARITY[r]);
  for (let i = randInt(RESTOCK.poke[0], RESTOCK.poke[1]); i > 0; i--) {
    const p = pick(pool);
    // Solo comunes y poco comunes, y al NPC que las comercia (nunca L/M ni variocolores).
    const who = us.filter((x) => x.p.focus.poke.includes(p.rarity) && pokeTotal(x.u) < RESTOCK.pokeCap);
    if (!who.length) continue;
    gacha.grant(pick(who).u, p.id, false);
    done.poke++;
  }
  for (let i = randInt(RESTOCK.eggs[0], RESTOCK.eggs[1]); i > 0; i--) {
    const who = us.filter((x) => x.p.focus.items === 'noshop' && (x.u.items['mystery-egg'] || 0) < RESTOCK.eggCap);
    if (!who.length) continue;
    const u = pick(who).u;
    u.items['mystery-egg'] = (u.items['mystery-egg'] || 0) + 1;
    done.eggs++;
  }
  db.save();
  return done;
}

// Un «turno»: reabastece si toca y hace actuar a uno o dos NPC.
function run(now = Date.now()) {
  restock();
  const us = shuffle(npcUsers());
  const out = [];
  for (const u of us.slice(0, rand() < 0.35 ? 2 : 1)) out.push({ npc: u.username, ...act(u, now) });
  db.save();
  return out;
}

// ---- Bucle: cada 2-4 minutos con variación (setTimeout encadenado) ----
let timer = null;
function schedule() {
  const [lo, hi] = INTERVAL;
  timer = setTimeout(() => {
    try { run(); } catch (e) { console.error('NPC:', e); }
    schedule();
  }, lo + rand() * (hi - lo));
  timer.unref();
}
function start() {
  ensure();
  N();
  if (!timer) schedule();
}

module.exports = {
  state: N, start, ensure, run, act, restock, isNpc, isNpcName, treasury, bounds, maxBid, reference, bidPrice, askPrice, eligible,
  cap, whyBlocked, note, sellLimit, NPCS, MIN_LEVEL, MIN_AGE, SELL_UNITS, BUY_UNITS, POKE_FLOOR, LOW_FUNDS, SPEND_DAILY,
};

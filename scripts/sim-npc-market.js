'use strict';
// Simulación del Mercado con comerciantes NPC y jugadores simulados (usa el código real del servidor con un reloj falso).
//   node scripts/sim-npc-market.js [días=30] [--quiet]
// Comprueba: tesorerías de los NPC estables, operaciones entre comerciantes > 0, cobertura de cotización y que ningún
// jugador gana monedas netas a costa de los NPC salvo dentro de los topes documentados (docs/BALANCE.md).
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-simnpc-'));
let T = Date.parse('2026-11-02T00:00:00Z');
Date.now = () => T;

const S = path.join(__dirname, '..', 'server');
const hub = require(S + '/hub');
const reasons = {}; // movimientos de los NPC por motivo
const orig = hub.ledger;
hub.ledger = (u, d, r, l) => { if (u && u.npc) { const k = u.username + ' ' + r; reasons[k] = (reasons[k] || 0) + Math.round(d); } return orig(u, d, r, l); };
const db = require(S + '/db');
const market = require(S + '/market');
const npc = require(S + '/npc');
const items = require(S + '/items');
const gacha = require(S + '/gacha');
const val = require(S + '/valuation');
const { DEX, RARITY } = require(S + '/pokedex');

const DAYS = Number(process.argv[2]) || 30;
const DAY = 864e5;
npc.ensure();
const npcs = () => Object.values(db.data.users).filter((u) => u.npc);
const equity = (u) => u.coins + market.lockedIn(u);
const start = Object.fromEntries(npcs().map((u) => [u.username, equity(u)]));
const minEq = Object.fromEntries(npcs().map((u) => [u.username, equity(u)]));

function player(name, extra = {}) {
  const u = { id: 'sim-' + name, username: name, coins: 200000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: {}, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 30, createdAt: T - 10 * DAY, ...extra };
  db.addUser(u);
  delete u.progress;
  return u;
}
const farmer = player('granjero', { coins: 0 });
const buyer = player('comprador', { coins: 300000 });
const arbA = player('arbitroA', { coins: 200000 });
const arbB = player('arbitroB', { coins: 200000 });
const mainP = player('principal', { coins: 100000 });
const alt = player('secundaria', { coins: 100000, level: 1, createdAt: T }); // cuenta nueva
const comp = player('complice', { coins: 20_000_000 }); // cuenta veterana compinchada con la principal
const start0 = Object.fromEntries([farmer, buyer, arbA, arbB, mainP, alt, comp].map((u) => [u.username, u.coins]));
const stipend = { buyer: 0 };
const stat = { farmer: { got: 0 }, buyer: { spent: 0, n: 0 }, arbA: { tries: 0, done: 0 }, arbB: { tries: 0, done: 0, dustBack: 0, paid: 0 }, collusion: { trades: 0, maxEst: 0 } };

const tms = Object.keys(items.ITEMS).filter((id) => items.ITEMS[id].tm);
const stones = Object.keys(items.ITEMS).filter((id) => /^stone-/.test(id));
const giveDaily = (d) => {
  const it = farmer.items;
  const add = (id, n) => { it[id] = (it[id] || 0) + n; };
  add('mat-escama', 15); add('mat-pluma', 12); add('shard-red', 3); add('tera-shard-fire', 3); add('exp-xs', 30); add(tms[d % tms.length], 1);
  if (d % 5 === 0) add(stones[d % stones.length], 1);
};
const orders = (ref, side) => db.data.market.orders.filter((o) => o.ref === ref && o.side === side && o.qty > 0 && o.npc);
const fromRef = (ref) => { const [k, x, y] = ref.split(':'); return market.parseRef(k === 'poke' ? { kind: 'poke', pokeId: Number(x), shiny: y === '1' } : k === 'item' ? { kind: 'item', itemId: x } : { kind: 'dust' }); };
const rnd = (n) => Math.floor(Math.random() * n);

function hourly(d) {
  // Granjero: vende al instante todo lo que farmea al mejor pedido de los comerciantes.
  for (const [id, n] of Object.entries(farmer.items)) {
    if (n < 1) continue;
    const c0 = farmer.coins;
    try { market.sell(farmer, { kind: 'item', itemId: id, qty: Math.min(n, 10), price: 1, instant: true }); } catch { /* sin pedido o sin cupo */ }
    stat.farmer.got += farmer.coins - c0;
  }
  // Comprador: compra algo a un NPC al azar.
  const asks = db.data.market.orders.filter((o) => o.side === 'sell' && o.npc && o.qty > 0);
  if (asks.length) {
    const o = asks[rnd(asks.length)];
    const c0 = buyer.coins;
    try { market.buy(buyer, { ...fromRef(o.ref), qty: 1, price: o.price, instant: true }); stat.buyer.n++; } catch { /* */ }
    stat.buyer.spent += c0 - buyer.coins;
  }
  // Arbitraje A: comprar a un NPC y venderle a OTRO (o al mismo) por más.
  for (const o of asks.slice(0, 40)) {
    const bids = orders(o.ref, 'buy').filter((b) => b.userId !== o.userId).sort((x, y) => y.price - x.price);
    if (!bids.length) continue;
    stat.arbA.tries++;
    if (bids[0].price <= o.price) continue; // no hay hueco (siempre: tope < suelo)
    stat.arbA.done++;
  }
  // Arbitraje B: comprar un Pokémon a un NPC y liberarlo (polvo × tipo de cambio).
  const pk = asks.filter((o) => o.kind === 'poke' && !o.shiny);
  if (pk.length) {
    const o = pk[rnd(pk.length)];
    const c0 = arbB.coins;
    try {
      market.buy(arbB, { ...fromRef(o.ref), qty: 1, price: o.price, instant: true });
      stat.arbB.tries++;
      stat.arbB.paid += c0 - arbB.coins;
      stat.arbB.dustBack += RARITY[DEX.find((p) => p.id === o.pokeId).rarity].dust * gacha.DUST_RATE;
      stat.arbB.done++;
    } catch { /* */ }
  }
  // Colusión: la cuenta nueva compra a la principal a precios absurdos para subir la referencia; la principal vende a los NPC.
  const id = 100 + (d % 40);
  mainP.collection[id] = { n: 5, s: 0 };
  alt.coins = Math.max(alt.coins, 1e6);
  try {
    market.sell(mainP, { kind: 'poke', pokeId: id, shiny: false, qty: 1, price: 900000 });
    market.buy(alt, { kind: 'poke', pokeId: id, shiny: false, qty: 1, price: 900000, instant: true });
    stat.collusion.trades++;
  } catch { /* tope de cuentas nuevas */ }
  // Y la veterana compinchada hace lo mismo con tres operaciones de dos vendedores (lo mínimo que exige la referencia).
  for (const seller of [mainP, comp, mainP]) {
    seller.collection[id] = { n: 5, s: 0 };
    const buyerAcc = seller === mainP ? comp : mainP;
    try { market.sell(seller, { kind: 'poke', pokeId: id, shiny: false, qty: 1, price: 900000 }); market.buy(buyerAcc, { kind: 'poke', pokeId: id, shiny: false, qty: 1, price: 900000, instant: true }); stat.collusion.trades++; } catch { /* */ }
  }
  try { market.sell(mainP, { kind: 'poke', pokeId: id, shiny: false, qty: 5, price: 1, instant: true }); } catch { /* */ }
  const est = val.estimate(`poke:${id}:0`);
  const bn = npc.bounds(market.parseRef({ kind: 'poke', pokeId: id, shiny: false }));
  if (est) stat.collusion.maxEst = Math.max(stat.collusion.maxEst, est.value / Math.ceil(val.BAND_UP * bn.floor) * val.BAND_UP);
}

const daily = [];
const allTrades = []; // el historial del Mercado solo guarda 500: se cuentan aparte
{ const arr = db.data.market.trades; const push = arr.push.bind(arr); arr.push = (...x) => { allTrades.push(...x); return push(...x); }; }
for (let d = 0; d < DAYS; d++) {
  const t0 = allTrades.length;
  giveDaily(d);
  buyer.coins += 10000; arbB.coins += 5000; stipend.buyer += 10000; // algo de ingreso diario para que sigan operando
  for (let i = 0; i < 480; i++) {
    T += 180000;
    market.sweep();
    npc.run(T);
    if (i % 20 === 10) hourly(d);
    for (const u of npcs()) minEq[u.username] = Math.min(minEq[u.username], equity(u));
  }
  const tr = allTrades.slice(t0);
  daily.push({ día: d + 1, opsNPCjugador: tr.filter((t) => t.npc && !t.npcInternal).length, opsEntreNPC: tr.filter((t) => t.npcInternal).length, tesoreríaNPC: npcs().reduce((s, u) => s + equity(u), 0) });
}

const all = [];
for (const p of DEX) all.push({ kind: 'poke', pokeId: p.id, shiny: false }, { kind: 'poke', pokeId: p.id, shiny: true });
for (const [id, it] of Object.entries(items.ITEMS)) if (!it.key) all.push({ kind: 'item', itemId: id });
all.push({ kind: 'dust' });
const covered = all.filter((a) => npc.NPCS.some((p) => npc.inFocus(p, market.parseRef(a)))).length;

console.log(`\n== Simulación ${DAYS} días ==`);
if (!process.argv.includes('--quiet')) console.table(daily.filter((_, i) => i % Math.max(1, Math.floor(DAYS / 10)) === 0 || i === DAYS - 1));
console.table(npcs().map((u) => ({ NPC: u.username, inicial: start[u.username], final: equity(u), mínima: minEq[u.username], beneficio: equity(u) - start[u.username] })));
const internal = daily.reduce((s, x) => s + x.opsEntreNPC, 0);
console.log('operaciones entre comerciantes en total:', internal, '· cobertura de cotización:', (100 * covered / all.length).toFixed(1) + ' %', `(${covered}/${all.length})`);
const net = (u) => u.coins - start0[u.username];
console.table([
  { jugador: 'granjero (vende lo que farmea)', neto: net(farmer), nota: `cobrado ${stat.farmer.got}; tope ${npc.FARM_DAY * DAYS} (FARM_DAY × días)` },
  { jugador: 'comprador', neto: net(buyer) - stipend.buyer, nota: `${stat.buyer.n} compras, gastó ${stat.buyer.spent}` },
  { jugador: 'arbitraje NPC→NPC', neto: 0, nota: `${stat.arbA.tries} pares con compra y venta; ${stat.arbA.done} con hueco positivo` },
  { jugador: 'arbitraje comprar y liberar', neto: stat.arbB.dustBack - stat.arbB.paid, nota: `${stat.arbB.done} compras; pagó ${stat.arbB.paid}, recuperó ${stat.arbB.dustBack} en polvo` },
  { jugador: 'colusión (principal + cuenta nueva)', neto: net(mainP) + net(alt) + net(comp), nota: `${stat.collusion.trades} operaciones a precio absurdo; valor estimado máx. ${stat.collusion.maxEst.toFixed(2)} × suelo (límite ${val.BAND_UP})` },
]);
const ok = {
  tesorerias: npcs().every((u) => equity(u) >= 0.35 * u.npcStart && u.coins <= 1.1 * npc.TREASURY_MAX * u.npcStart),
  entreNPC: internal > 0,
  cobertura: covered / all.length >= 0.95,
  granjero: stat.farmer.got <= npc.FARM_DAY * DAYS,
  arbitraje: stat.arbA.done === 0 && stat.arbB.dustBack - stat.arbB.paid < 0,
  colusion: stat.collusion.maxEst <= val.BAND_UP + 1e-9 && stat.collusion.trades > 0,
  npcBeneficio: npcs().reduce((s, u) => s + equity(u) - start[u.username], 0) >= -0.05 * npcs().reduce((s, u) => s + start[u.username], 0),
};
console.log(ok);
console.log('movimientos de los NPC por motivo:', reasons);
process.exit(Object.values(ok).every(Boolean) ? 0 : 1);

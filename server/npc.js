'use strict';
// Comerciantes NPC del Mercado. Compran y venden como un jugador más (mismas funciones market.sell/market.buy:
// comisión, impuesto, depósito y libro de monedas), pero con salvaguardas para que NUNCA sean un grifo de
// monedas ni se puedan manipular:
//  1. PRECIOS ANCLADOS: cada artículo tiene un tope de compra (cap) y un suelo de venta (floor) fijos, calculados
//     a partir del valor de liberar un duplicado, del precio de la tienda o de tablas fijas. Los precios de los
//     jugadores solo mueven al NPC DENTRO de esos límites.
//  2. LÍMITES DIARIOS por jugador (monedas y unidades) y cuentas nuevas/novatas sin acceso a sus compras.
//  3. TESORERÍA FINITA: solo pujan con monedas que tienen; sin fondos solo venden. No pagan comisión de publicación
//     (es un sumidero para jugadores); sí pagan el impuesto de venta, que retira monedas de lo que los jugadores les pagan.
//  4. STOCK PROPIO: solo venden lo que han comprado + un reabastecimiento diario de bienes (crea objetos, no
//     monedas, y se vende por encima del suelo: es un sumidero). Los precios suben y bajan con su stock.
//  5. ENCARGOS y OFERTAS FLASH: pedidos especiales con premio que no son monedas (más una prima de monedas
//     acotada: ≤ 50 % del precio, una vez por encargo y 2 al día por jugador) y rebajas que nunca bajan del 80 %
//     del suelo (siempre por encima de cualquier tope de compra). Nada de esto habla por el chat.
// 6. En el libro de órdenes los NPC nunca se cruzan entre sí (lo garantiza market.js y el invariante cap < floor).
//    Solo hay unas pocas OPERACIONES DIRECTAS al día entre ellos (internalTrade): suma cero, a un precio dentro de
//    [tope, suelo], marcadas `npcInternal`: salen en el historial, pero no cuentan para reference() ni para los topes
//    de transfer.js, y ninguna moneda llega a un jugador.
const db = require('./db');
const dexreg = require('./dexreg');
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
const SELL_COINS_BASE = 5000; // monedas brutas que un jugador puede cobrar de NPC al día: 5000 + 500 × nivel (casual: tope holgado)
const SELL_COINS_PER_LEVEL = 500;
const SELL_UNITS = { poke: 10, item: 10, dust: 500 }; // unidades por artículo y día que un jugador puede venderles
const BUY_UNITS = { poke: 20, item: 20, dust: 1000 }; // y que puede comprarles (evita acaparar su stock)
const SPEND_DAILY = 0.3; // fracción de la tesorería que un NPC puede gastar al día
const LOW_FUNDS = 0.2; // por debajo del 20 % de la tesorería inicial dejan de pujar
const MAX_OPEN = 25; // órdenes abiertas por NPC
const STALE_MS = 12 * 3600 * 1000;
const DRIFT = 0.25; // se retira una orden si se aleja más de un 25 % del objetivo actual

// ---- Precios anclados: tope de compra (cap) y suelo de venta (floor) ----
// Invariante: floor ≥ 2 × cap para TODO artículo (un NPC nunca vende a menos del doble de lo que paga).
const POKE_FLOOR = { C: 90, U: 200, R: 500, E: 1500, L: 9000, M: 18000 };
const BID_FRAC = 1; // compran a como mucho lo que da liberar un duplicado (el tope exacto; nunca por encima, salvo la prima de encargo)
const RECYCLE_BID = 0.4; // Balls y piedras: reciclar da el 40 % del precio, así que nunca se paga más
const SHOP_BID = 0.575; // objetos de tienda: tope = 57,5 % del precio (y el suelo sube a 2 × tope si hace falta: ≥ precio de tienda)
// Objetos sin precio en la tienda y cosméticos: { cap, floor } fijos (floor ≥ 2 × cap).
const NOSHOP = {
  'master-ball': { cap: 2300, floor: 9000 },
  'shiny-charm': { cap: 575, floor: 6000 }, // 10 tiradas con ×4 de variocolor ≈ 0,5 variocolor de más
  'mystery-egg': { cap: 172, floor: 600 }, // > valor medio de un cosmético a precio de compra
};
// Megapiedras: los NPC NO las compran ni las venden (inFocus las excluye). Los límites existen para que el
// invariante cap < floor valga para todos los objetos y por si algún día se activan.
Object.setPrototypeOf(NOSHOP, null);
const MEGASTONE = { cap: 300, floor: 9000 }; // se compran muy barato (≤ 25 % del valor de una Mega: salen de eventos y 💠 gratis) y se venden caras
const COSMETIC = { // por rareza
  C: { cap: 69, floor: 150 }, U: { cap: 172, floor: 350 }, R: { cap: 450, floor: 900 }, E: { cap: 1350, floor: 2700 }, L: { cap: 4500, floor: 9000 },
};
Object.setPrototypeOf(COSMETIC, null);
const MATERIAL = { cap: 10, floor: 60 };
const ASK_MAX_MULT = 8; // el precio de venta nunca pasa de 8 × el suelo (si los jugadores comercian a precios absurdos)
const SHINY_ASK_DEFAULT = 3; // sin referencia de mercado, un variocolor se pide a 3 × su suelo

// Devuelve { cap, floor } del artículo, o null si los NPC no lo comercian.
function bounds(a) {
  if (a.kind === 'poke') {
    const r = BY_ID.get(a.pokeId).rarity;
    const cap = Math.max(1, Math.floor(BID_FRAC * RARITY[r].dust * DUST_RATE));
    const floor = Math.max(2 * cap, POKE_FLOOR[r]);
    if (!a.shiny) return { cap, floor };
    // Variocolor: compra ≤ 3 × la normal (liberar da el polvo ×3) y venta ≥ 3 × la normal y ≥ 2,5 × su tope.
    const scap = 3 * cap;
    return { cap: scap, floor: Math.max(3 * floor, Math.ceil(2.5 * scap)) };
  }
  if (a.kind === 'dust') {
    const cap = Math.max(1, DUST_RATE - 1); // nunca el tipo de cambio exacto (sería un bucle con el cambio de polvo)
    return { cap, floor: Math.max(2 * cap, 2 * DUST_RATE) };
  }
  const it = typeof a.itemId === 'string' && Object.hasOwn(items.ITEMS, a.itemId) ? items.ITEMS[a.itemId] : null;
  if (!it) return null;
  // Poké Balls y objetos de evolución: se compran como mucho a lo que da reciclarlos (40 % del precio) y se venden a la tienda o más.
  if (it.price && (it.ball || it.evo)) { const cap = Math.max(1, Math.floor(it.price * RECYCLE_BID)); return { cap, floor: Math.max(it.price, 2 * cap) }; }
  if (it.price) { const cap = Math.max(1, Math.floor(it.price * SHOP_BID)); return { cap, floor: Math.max(it.price, 2 * cap) }; } // nunca por debajo de la tienda
  if (NOSHOP[a.itemId]) return NOSHOP[a.itemId];
  if (it.megaStone) return MEGASTONE;
  // MT: compran al 10 % de lo que cuesta fabricarla en monedas (también se obtienen de premio) y venden a su coste de fabricación
  // (monedas + materiales a su precio de venta).
  if (it.tm) { const cap = Math.max(1, Math.floor(it.craft[0] * 0.1)); const mats = Object.values(it.craft[1] || {}).reduce((t, n) => t + n * MATERIAL.floor, 0); return { cap, floor: Math.max(it.craft[0] + mats, 2 * cap) }; }
  if (it.material) return MATERIAL;
  if (it.shard) return { cap: 10, floor: 80 };
  if (it.teraShard) return { cap: 10, floor: 80 };
  if (it.key) return { cap: 10, floor: 80 }; // objetos clave: no se comercian (market.noKey); límites solo para el invariante
  // Objetos de la Tienda de Combate (se pagan con PB, no con monedas): inertes; el tope teórico sería muy bajo.
  if (it.expCandy && !it.bp) { const cap = Math.max(1, Math.floor(it.expCandy / 200)); return { cap, floor: 8 * cap }; } // Caramelos Exp.: inertes (no se compran con monedas)
  if (it.bp) { const cap = Math.max(1, Math.floor(it.bp / 2)); return { cap, floor: Math.max(4 * it.bp, 2 * cap) }; }
  if (it.cosmetic && COSMETIC[it.rarity]) return COSMETIC[it.rarity];
  return null;
}
// Precio de compra más alto posible por tipo de Pokémon normal (para las pruebas del gacha).
const maxBid = (rarity) => Math.max(1, Math.floor(BID_FRAC * RARITY[rarity].dust * DUST_RATE));

// ---- Comerciantes: datos de personalidad ----
// bidFrac: fracción del tope que ofrecen sin referencia de mercado · askMult: múltiplo del suelo que piden sin
// referencia · spread: margen sobre la mediana de los jugadores · jitter: ±% aleatorio de cada precio
// bids/asks: órdenes nuevas por visita · qty: unidades por orden · focus: qué comercian.
// art: Pokémon cuyo arte oficial es su avatar · title/bio/quotes (una al día)/seeks/sells: ficha del comerciante ·
// enc: qué encargos pide (poke: rarezas de Pokémon · cos: rarezas de cosméticos).
const NPCS = [
  { id: 'npc-kecleon', name: 'Kecleon', treasury: 60000, bidFrac: 0.85, askMult: 1.15, spread: 0.15, jitter: 0.05, bids: 3, asks: 2,
    focus: { poke: ['C', 'U'], shiny: false, cats: ['shop', 'ball', 'evo', 'tm', 'material', 'expcandy'], dust: true }, also: ['egg'], enc: { poke: ['R'] },
    art: 352, title: 'El camaleón del bazar',
    bio: 'Cambia de color según el cliente, pero no de palabra: precios justos y trato rápido. Lo compra todo lo cotidiano.',
    seeks: 'Comunes y poco comunes, objetos de la tienda, Poké Balls, piedras, MT, materiales, caramelos y polvo estelar. A veces un encargo de raras.',
    sells: 'Lo que ha ido comprando: Pokémon corrientes, tickets, caramelos y polvo.',
    quotes: ['Hoy me siento verde esperanza. ¿Y tú?', 'Si no lo ves, es que me lo he camuflado.', 'Un buen trato no necesita tinta.', 'Compro barato, vendo justo. Lo prometo.', 'Los tickets se agotan rápido, ¡avisado estás!', 'Cambio de color, no de precio.', 'Tráeme tus repetidos, que me cuadra el inventario.'] },
  { id: 'npc-bill', name: 'Bill', treasury: 60000, bidFrac: 0.9, askMult: 1.5, spread: 0.20, jitter: 0.05, bids: 2, asks: 2, sets: true,
    focus: { poke: ['R', 'E'], react: ['C', 'U'], shiny: false, cats: [], dust: false }, also: ['tm', 'material', 'expcandy'], enc: { poke: ['R', 'E'] },
    art: 133, title: 'El Pokémaníaco de Kanto',
    bio: 'El mayor Pokémaníaco de Kanto: ordena su colección por tipo, por región y por tipo otra vez. Siempre le falta uno.',
    seeks: 'Pokémon raros y épicos, sobre todo los que completan colecciones (y cualquier común o poco común si hace falta). Publica encargos con premio.',
    sells: 'Raros y épicos que le sobran de sus colecciones.',
    quotes: ['Me falta uno. Siempre me falta uno.', 'Una colección sin completar es una herida abierta.', 'Mi álbum huele a victoria.', 'Los repetidos son para quien no sabe colocarlos.', 'Hoy huelo un encargo gordo.', 'Ordenar por tipo… no, por región… no, por tipo.', 'Soy Bill. Sí, el del Sistema de Almacenamiento. No, no es una máquina del tiempo.'] },
  { id: 'npc-ginger', name: 'Lisia', treasury: 60000, bidFrac: 0.7, askMult: 1.25, spread: 0.25, jitter: 0.05, bids: 3, asks: 2,
    focus: { poke: [], shiny: false, cats: ['cosmetic', 'egg', 'mega', 'tera', 'shard'], dust: false }, also: ['rare', 'shop'], enc: { cos: ['R', 'E', 'L'] },
    art: 334, title: 'La Coordinadora estrella de Hoenn',
    bio: 'Coordinadora estrella de Hoenn, siempre con su Altaria. Vive para el estilo: marcos, dorsos y títulos para lucir en tu perfil.',
    seeks: 'Cosméticos (marcos, dorsos, títulos), Huevos Misteriosos, Megapiedras, Teralitos y Fragmentos del Tutor.',
    sells: 'Cosméticos y Huevos Misteriosos. A veces una oferta flash.',
    quotes: ['Un buen marco hace al entrenador.', 'Un Concurso se gana con estilo, no solo con fuerza.', 'Altaria y yo no regateamos: negociamos con gracia.', 'Lo bonito también cotiza.', 'Si brilla, lo quiero. Si brilla más, lo vendo.', 'Mi bolsa siempre tiene sitio para un dorso raro.', 'Mira, mira… ¡cómo combina!'] },
  { id: 'npc-dorado', name: 'Giovanni', treasury: 60000, bidFrac: 0.95, askMult: 1.8, spread: 0.35, jitter: 0.05, bids: 2, asks: 2,
    focus: { poke: ['L', 'M'], shiny: true, cats: ['rare', 'bp'], dust: false }, also: ['cosmetic', 'mega'], enc: { poke: ['L'] },
    art: 53, title: 'El jefe del Team Rocket',
    bio: 'Antiguo jefe del Team Rocket, siempre con su Persian a los pies. Trafica con legendarios, variocolores y objetos raros: es caro, y rara vez pregunta de dónde viene lo que le traes.',
    seeks: 'Legendarias, míticas y variocolores, Master Ball, Amuletos Iris y objetos de la Tienda de Combate. Algún encargo de legendarias con premio.',
    sells: 'Leyendas y variocolores que consigue de vez en cuando, a precio de coleccionista.',
    quotes: ['Lo raro tiene un precio. Lo legendario, otro más alto.', 'Persian y yo valoramos el género con una sola mirada.', 'Si es variocolor, hablamos. Si no, también, pero más bajo.', 'Dicen que soy caro. Dicen bien.', 'Un buen negocio se cierra sin preguntas.', 'Lo legendario no se regala; se negocia.', 'No pregunto de dónde viene. Tú tampoco.'] },
];
// Los nombres antiguos siguen reservados (nadie puede hacerse pasar por un comerciante de antes).
const LEGACY_NAMES = ['ColeccionBill', 'MercaderGinger', 'TratanteDorado', 'VendeMagikarp'];
const NAMES = new Set([...NPCS.map((n) => n.name.toLowerCase()), ...LEGACY_NAMES.map((n) => n.toLowerCase())]);
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
  n.enc ||= []; // encargos: { id, npc, ref, price, bonus, createdAt, expiresAt, done: {userId: 1}, orderId }
  n.flash ||= []; // ofertas flash: { id, npc, ref, price, normal, until, orderId }
  n.feed ||= { day: null, n: 0 };
  n.pool ||= { paid: 0, given: 0 }; // monedas que pagaron JUGADORES en comisiones/impuestos del Mercado y lo ya repartido a los NPC
  n.refill ||= {}; // npcId -> { day, amt }: relleno recibido hoy
  n.lastInternal ||= {}; // ref -> { to, at }: última operación directa (evita idas y vueltas)
  n.nextId ||= 1;
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

// ---- Relleno de tesorería ----
// Una parte de lo que el casino retira del Mercado a los JUGADORES (comisión de publicación e impuesto de venta; los NPC no
// pagan comisión y su impuesto no cuenta) vuelve a las tesorerías de los NPC, para que no se queden sin fondos. Nunca crea
// monedas de la nada: solo se reparte hasta REFILL.share de lo que la bolsa ha recogido (`pool.paid`), una tesorería nunca
// pasa de su inicial (`npcStart`) y cada NPC recibe como mucho REFILL.dailyFrac de su inicial al día.
const REFILL = { share: 0.5, dailyFrac: 0.05 };
const TREASURY_MAX = 2; // múltiplo de la tesorería inicial a partir del cual se destruye el excedente
const notePaid = (amount) => { if (Number.isFinite(amount) && amount > 0) N().pool.paid += Math.floor(amount); };
const poolLeft = () => Math.max(0, Math.floor(N().pool.paid * REFILL.share) - N().pool.given);
function refillTreasuries() {
  const n = N();
  const out = [];
  if (n.refillDay === today()) return out;
  n.refillDay = today();
  const us = npcUsers().filter((u) => u.npcStart).sort((x, y) => (x.coins + market.lockedIn(x)) / x.npcStart - (y.coins + market.lockedIn(y)) / y.npcStart);
  // Techo de beneficios: lo que pasa de TREASURY_MAX × la tesorería inicial se destruye (sumidero), no se acumula.
  for (const u of us) {
    const over = u.coins - Math.floor(TREASURY_MAX * u.npcStart);
    if (over > 0) { u.coins -= over; hub.ledger(u, -over, 'npc_burn', 'Beneficio por encima del techo'); out.push({ npc: u.username, burned: over }); }
  }
  for (const u of us) {
    let r = n.refill[u.id];
    if (!r || r.day !== today()) r = n.refill[u.id] = { day: today(), amt: 0 };
    const room = u.npcStart - (u.coins + market.lockedIn(u));
    const amt = Math.floor(Math.min(room, REFILL.dailyFrac * u.npcStart - r.amt, poolLeft()));
    if (amt <= 0) continue;
    u.coins += amt;
    r.amt += amt;
    n.pool.given += amt;
    hub.ledger(u, amt, 'npc_refill', 'Relleno con comisiones e impuestos de jugadores');
    out.push({ npc: u.username, amt });
  }
  if (out.length) db.save();
  return out;
}

// ---- Límites diarios ----
const oldEnough = (u) => u.createdAt == null || u.createdAt < (N().launchedAt || 0) || Date.now() - u.createdAt >= MIN_AGE;
const eligible = (u) => (u.level || 1) >= MIN_LEVEL && oldEnough(u);
const sellLimit = (u) => SELL_COINS_BASE + SELL_COINS_PER_LEVEL * (u.level || 1);
function dayRec(userId) {
  const n = N();
  let r = n.daily[userId];
  if (!r || r.day !== today()) r = n.daily[userId] = { day: today(), got: 0, sold: {}, bought: {}, enc: 0, farm: 0 };
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
    // Lo que sale de fuentes gratuitas con tope (MT, materiales, Teralitos, megapiedras…) tiene además un tope propio de monedas al día.
    const farm = FARM_CATS.has(categoryOf(a)) ? Math.floor((FARM_DAY - (r.farm || 0)) / price) : Infinity;
    return Math.max(0, Math.min(units, coins, spend, farm));
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
    if (FARM_CATS.has(categoryOf(a)) && (r.farm || 0) >= FARM_DAY - 1) return `Hoy ya has cobrado el máximo (${FARM_DAY.toLocaleString('es')} monedas) por este tipo de objetos a los comerciantes NPC.`;
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
    if (FARM_CATS.has(categoryOf(a))) r.farm = (r.farm || 0) + qty * price;
    spendRec(buyer).amt += qty * price;
    claim(seller, buyer, a, price);
  } else if (seller.npc && !buyer.npc) {
    const r = dayRec(buyer.id);
    r.bought[a.ref] = (r.bought[a.ref] || 0) + qty;
  }
}

// ---- Precio objetivo ----
// Mediana de las operaciones recientes ENTRE JUGADORES (sin NPC): al menos 3 operaciones de 2 vendedores distintos.
const REF_DAYS = 7;
function reference(refKey, now = Date.now()) {
  const trades = db.data.market.trades.filter((t) => t.ref === refKey && !t.npc && !t.young && t.at > now - REF_DAYS * 864e5).slice(-15);
  if (trades.length < 3 || new Set(trades.map((t) => t.seller)).size < 2) return null;
  const ps = trades.map((t) => t.price).sort((x, y) => x - y);
  const mid = Math.floor(ps.length / 2);
  return ps.length % 2 ? ps[mid] : Math.round((ps[mid - 1] + ps[mid]) / 2);
}
const jit = (p) => 1 + (rand() * 2 - 1) * p.jitter;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
// Precios según el stock del propio NPC (`ctx.have`: unidades que tiene) y la demanda (`ctx.demand`: hay jugadores
// vendiendo ese artículo). ctx.r (0-1) fija la variación para las pruebas.
// Compra: con demanda o poco stock (≤ 1) paga el 90-100 % del tope; si no, el 70-85 %, y menos cuanto más acumula.
const BID_HOT = [0.9, 1];
const BID_COLD = [0.7, 0.85];
const stockBid = (have) => clamp(1.05 - 0.05 * have, 0.8, 1.05); // con precio de referencia de jugadores
const stockAsk = (have) => clamp(1.15 - 0.1 * have, 0.8, 1.15); // más stock → más barato (hasta el suelo); menos → más caro
function bidPrice(a, p, med = reference(a.ref), ctx = {}) {
  const b = bounds(a);
  const have = ctx.have ?? 2;
  const r = ctx.r ?? rand();
  const hot = !!ctx.demand || have <= 1;
  let base;
  if (med != null) base = med * (1 - p.spread) * (hot ? 1 : stockBid(have)) * (1 + (r * 2 - 1) * p.jitter);
  else {
    const [lo, hi] = hot ? BID_HOT : BID_COLD;
    let frac = lo + (hi - lo) * r + (p.bidFrac - 0.85) * 0.2;
    if (!hot && have > 2) frac *= Math.max(0.85, 1 - 0.04 * (have - 2));
    base = b.cap * clamp(frac, 0.5, 1);
  }
  return clamp(Math.round(base), 1, b.cap);
}
// Precio al que el NPC vende: nunca por debajo del suelo.
function askPrice(a, p, med = reference(a.ref), ctx = {}) {
  const b = bounds(a);
  const sm = stockAsk(ctx.have ?? 2);
  const j = ctx.r != null ? 1 + (ctx.r * 2 - 1) * p.jitter : jit(p);
  const base = med != null ? med * (1 + p.spread) * sm : b.floor * p.askMult * sm * (a.kind === 'poke' && a.shiny ? SHINY_ASK_DEFAULT : 1);
  return clamp(Math.round(base * j), b.floor, b.floor * ASK_MAX_MULT);
}

// ---- Artículos que le interesan a cada NPC ----
const art = (a) => market.parseRef(a);
// Categoría de un artículo comerciable (null si no se comercia). Cada comerciante cotiza las categorías de su especialidad.
function categoryOf(a) {
  if (a.kind === 'poke') return a.shiny ? 'shiny' : 'poke';
  if (a.kind === 'dust') return 'dust';
  if (typeof a.itemId !== 'string' || !Object.hasOwn(items.ITEMS, a.itemId)) return null;
  const it = items.ITEMS[a.itemId];
  if (it.key) return null;
  if (it.cosmetic) return 'cosmetic';
  if (it.megaStone) return 'mega';
  if (it.tm) return 'tm';
  if (it.material) return 'material';
  if (it.shard) return 'shard';
  if (it.teraShard) return 'tera';
  if (it.bp) return 'bp'; // Tienda de Combate (incluye Chapas y Caramelos Exp. que se compran con PB)
  if (it.expCandy) return 'expcandy';
  if (it.ball) return 'ball';
  if (it.evo) return 'evo';
  if (it.price) return 'shop';
  if (a.itemId === 'mystery-egg') return 'egg';
  return 'rare'; // Master Ball, Amuleto Iris
}
// Categorías que salen de fuentes gratuitas con tope diario y no tienen precio en monedas: lo que un jugador cobra por ellas al día
// tiene un tope propio (FARM_DAY) además del tope general.
const FARM_CATS = new Set(['tm', 'material', 'shard', 'tera', 'bp', 'expcandy', 'mega', 'ball', 'evo']);
const FARM_DAY = 400;
function inFocus(p, a) {
  const f = p.focus;
  if (!bounds(a)) return false;
  if (a.kind === 'poke') { const r = BY_ID.get(a.pokeId).rarity; return a.shiny ? !!f.shiny : !!(f.poke || []).includes(r) || !!(f.react || []).includes(r); }
  if (a.kind === 'dust') return !!f.dust;
  const c = categoryOf(a);
  return !!c && (f.cats || []).includes(c);
}
// Pokémon de colecciones (Bill los busca para completarlas).
let setIds = null;
const inSets = () => (setIds ||= [...new Set(require('./progress').SETS.flatMap((s) => s.ids))]);
function randomArticle(p) {
  const f = p.focus;
  const kinds = [];
  if (f.poke.length) kinds.push('poke');
  if (f.shiny) kinds.push('shiny');
  for (const c of f.cats || []) kinds.push('cat:' + c);
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
    const cat = kind.slice(4);
    const list = Object.keys(items.ITEMS).filter((id) => categoryOf({ kind: 'item', itemId: id }) === cat && inFocus(p, { kind: 'item', itemId: id }));
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

// Unidades que tiene un NPC de un artículo (en inventario + en sus ofertas de venta).
const held = (u, a) => market.owned(u, a) + orders().filter((o) => o.userId === u.id && o.side === 'sell' && o.ref === a.ref).reduce((t, o) => t + o.qty, 0);
// Artículos que jugadores (no NPC) ofrecen ahora mismo: hay demanda de que alguien los compre.
const demandRefs = () => new Set(orders().filter((o) => o.side === 'sell' && !o.npc).map((o) => o.ref));

// ---- Presupuesto del feed «En vivo»: los NPC jamás escriben en el chat y casi no usan el feed ----
const FEED_DAILY = 4; // líneas al día entre todos los NPC (los encargos dejan hueco a las ofertas flash)
const FEED_ENC = 3;
function npcFeed(limit, text, extra) {
  const f = N().feed;
  if (f.day !== today()) { f.day = today(); f.n = 0; }
  if (f.n >= limit) return false;
  f.n++;
  hub.feed('trade', text, extra);
  return true;
}

// ---- Visita de un NPC: retira lo caduco o fuera de límites, publica pedidos y ofertas nuevos ----
function act(u, now = Date.now()) {
  const p = profile(u);
  if (!p) return { cancelled: 0, bids: 0, asks: 0 };
  const res = { cancelled: 0, bids: 0, asks: 0 };
  const low = u.coins < LOW_FUNDS * (u.npcStart || 0);
  const dem = demandRefs();

  // 1. Órdenes propias: fuera de límites, caducas, muy alejadas del objetivo, o pedidos sin fondos.
  for (const o of openOrders(u)) {
    const a = art(o);
    const b = bounds(a);
    const ctx = { have: held(u, a), demand: dem.has(a.ref), r: 0.5 };
    const target = o.side === 'buy' ? bidPrice(a, { ...p, jitter: 0 }, undefined, ctx) : askPrice(a, { ...p, jitter: 0 }, undefined, ctx);
    // Las ofertas flash pueden bajar hasta el 80 % del suelo y los encargos no se mueven con el stock.
    const bad = !b || (o.side === 'buy' ? o.price > b.cap : o.price < (o.flash ? Math.ceil(FLASH.min * b.floor) : b.floor));
    const drift = !o.flash && !o.enc && Math.abs(o.price - target) / target > DRIFT;
    if (bad || drift || now - o.createdAt > STALE_MS || (o.side === 'buy' && low && !o.enc)) {
      market.cancel(u, { id: o.id });
      res.cancelled++;
    }
  }
  let open = openOrders(u);
  const has = (r, side) => open.some((o) => o.ref === r && o.side === side);

  // 2. Ofertas de venta de su stock (solo lo que tiene): cuanto más tiene, más barato.
  for (const s of shuffle(stock(u)).slice(0, p.asks + 2)) {
    if (res.asks >= p.asks || open.length >= MAX_OPEN) break;
    if (has(s.a.ref, 'sell') || has(s.a.ref, 'buy')) continue;
    const listed = open.filter((o) => o.side === 'sell' && o.ref === s.a.ref).reduce((t, o) => t + o.qty, 0);
    const free = s.n - listed;
    if (free < 1) continue;
    const qty = s.a.kind === 'dust' ? Math.min(free, randInt(20, 100)) : Math.min(free, randInt(1, 3));
    const price = askPrice(s.a, p, undefined, { have: s.n });
    if (u.coins < market.fee(qty * price, u)) continue;
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
      const price = bidPrice(a, p, undefined, { have, demand: dem.has(a.ref) });
      const cost = qty * price + market.fee(qty * price, u);
      // Un pedido nunca supera el 5 % de la tesorería ni lo que queda de su gasto diario.
      if (cost > u.coins || qty * price > spendLeft(u) || qty * price > 0.05 * (u.npcStart || 1)) continue;
      try {
        market.buy(u, { ...a, qty, price });
        res.bids++;
        open = openOrders(u);
      } catch { /* sin monedas */ }
    }
  }
  N().lastAct[u.id] = now;
  return res;
}

// ---- Reabastecimiento diario: crea artículos (no monedas) y se venden por encima del suelo ----
// C/U (como antes) + 2-4 raras + 0-2 épicas (con preferencia por las de colecciones) y, casi cada 2 días, 1 legendaria
// NO destacada de banner. Nunca míticas, variocolores, Master Ball ni megapiedras.
const RESTOCK = { poke: [5, 10], eggs: [1, 2], rare: [2, 4], epic: [0, 2], legendChance: 0.5, pokeCap: 40, eggCap: 4 };
const featuredL = () => new Set(gacha.BANNERS.flatMap((b) => b.featuredL || []));
function pickSpecies(rarity) {
  const feat = rarity === 'L' ? featuredL() : new Set();
  const pool = BY_RARITY[rarity].filter((p) => !feat.has(p.id));
  const sets = new Set(inSets());
  const ws = pool.map((p) => (sets.has(p.id) ? 4 : 1));
  let x = rand() * ws.reduce((t, w) => t + w, 0);
  for (let i = 0; i < pool.length; i++) { x -= ws[i]; if (x <= 0) return pool[i]; }
  return pool[pool.length - 1];
}
function restock() {
  const n = N();
  if (n.restockDay === today()) return { poke: 0, eggs: 0, rare: 0, epic: 0, legend: 0 };
  n.restockDay = today();
  // Se limpian los contadores de jugadores de días anteriores.
  for (const [id, r] of Object.entries(n.daily)) if (r.day !== today()) delete n.daily[id];
  const us = npcUsers().map((u) => ({ u, p: profile(u) })).filter((x) => x.p);
  const done = { poke: 0, eggs: 0, rare: 0, epic: 0, legend: 0 };
  const pokeTotal = (u) => Object.values(u.collection).reduce((s, c) => s + c.n, 0);
  const give = (p) => {
    // Al NPC que comercia esa rareza (o que la pide en encargos); nunca L/M salvo la legendaria de Giovanni.
    const who = us.filter((x) => (x.p.focus.poke.includes(p.rarity) || (x.p.enc.poke || []).includes(p.rarity)) && pokeTotal(x.u) < RESTOCK.pokeCap);
    if (!who.length) return false;
    gacha.grant(pick(who).u, p.id, false);
    return true;
  };
  const pool = ['C', 'U'].flatMap((r) => BY_RARITY[r]);
  for (let i = randInt(RESTOCK.poke[0], RESTOCK.poke[1]); i > 0; i--) if (give(pick(pool))) done.poke++;
  for (let i = randInt(RESTOCK.rare[0], RESTOCK.rare[1]); i > 0; i--) if (give(pickSpecies('R'))) done.rare++;
  for (let i = randInt(RESTOCK.epic[0], RESTOCK.epic[1]); i > 0; i--) if (give(pickSpecies('E'))) done.epic++;
  if (rand() < RESTOCK.legendChance && give(pickSpecies('L'))) done.legend++;
  for (let i = randInt(RESTOCK.eggs[0], RESTOCK.eggs[1]); i > 0; i--) {
    const who = us.filter((x) => x.p.focus.cats.includes('egg') && (x.u.items['mystery-egg'] || 0) < RESTOCK.eggCap);
    if (!who.length) continue;
    const u = pick(who).u;
    u.items['mystery-egg'] = (u.items['mystery-egg'] || 0) + 1;
    done.eggs++;
  }
  db.save();
  return done;
}

// ---- Encargos: pedidos especiales de un artículo que los jugadores necesitan ----
// El NPC deja un pedido de compra al precio normal (≤ tope) durante 2-6 h. Quien le vende ese artículo cobra el
// precio normal MÁS un premio que no son monedas (Ticket Gacha, Huevo Misterioso o 💠 si el evento Mega está
// activo) y una prima de monedas del 50 % del precio cobrado: es lo único que un NPC paga por encima de su tope
// (≤ 1,5 × tope por unidad cobrada). Una vez por encargo y jugador y como mucho 2 encargos al día por jugador,
// así que la prima extra es ≤ 2 × 0,5 × tope del artículo al día (ver docs/BALANCE.md).
const ENC = { perDay: [3, 6], hours: [2, 6], maxActive: 2, perPlayerDay: 2, premium: 0.5, qty: 2, spendFrac: 0.1, maxAge: 3 * 3600e3 };
// Valor (en monedas de tienda) del premio, para el invariante «comprar y vender de vuelta siempre pierde».
const BONUS_VALUE = { ticket: 150, egg: 600, frag: 6 };
// Premios por rareza: [tipo, cantidad, peso]. El hueco suelo − tope siempre cubre el premio (ver test).
const BONUS = {
  R: [['ticket', 1, 6], ['frag', 8, 3]],
  E: [['ticket', 1, 3], ['egg', 1, 3], ['frag', 15, 3]],
  L: [['ticket', 2, 3], ['egg', 1, 4], ['frag', 25, 3]],
};
const BONUS_LABEL = { ticket: (n) => `${n}× Ticket Gacha`, egg: (n) => `${n}× Huevo Misterioso`, frag: (n) => `${n} 💠 Megafragmentos` };
const bonusValue = (b) => b.n * BONUS_VALUE[b.type];
function weightedPick(list, w) {
  let x = rand() * list.reduce((t, e, i) => t + w(e, i), 0);
  for (let i = 0; i < list.length; i++) { x -= w(list[i], i); if (x <= 0) return list[i]; }
  return list[list.length - 1];
}
const realPlayers = () => Object.values(db.data.users).filter((u) => !u.npc && !u.banned);
// Artículos que un NPC puede pedir como encargo (sin variocolores, míticos, polvo, tienda ni objetos de valor).
function encArticles(p) {
  const out = [];
  for (const r of (p.enc.poke || [])) for (const x of BY_RARITY[r]) out.push(art({ kind: 'poke', pokeId: x.id, shiny: false }));
  if (p.enc.cos) for (const [id, it] of Object.entries(items.ITEMS)) if (it.cosmetic && !it.event && p.enc.cos.includes(it.rarity)) out.push(art({ kind: 'item', itemId: id }));
  return out;
}
const rarityOfArt = (a) => (a.kind === 'poke' ? BY_ID.get(a.pokeId).rarity : items.ITEMS[a.itemId].rarity);
// Cuánta falta hace un artículo: jugadores a los que les falta, colecciones que completaría y ofertas recientes.
function needWeights(list, now) {
  const us = realPlayers();
  const sets = require('./progress').SETS;
  const recent = new Set([...orders().filter((o) => o.side === 'sell' && !o.npc && o.createdAt > now - 48 * 3600e3).map((o) => o.ref),
    ...db.data.market.trades.filter((t) => !t.npc && t.at > now - 48 * 3600e3).map((t) => t.ref)]);
  const setNeed = new Map(); // pokeId -> jugadores a los que les falta y está en una colección sin completar
  for (const u of us) for (const s of sets) if (s.ids.some((id) => !dexreg.caught(u, id))) for (const id of s.ids) if (!dexreg.caught(u, id)) setNeed.set(id, (setNeed.get(id) || 0) + 1);
  return new Map(list.map((a) => {
    const missing = us.filter((u) => (a.kind === 'poke' ? !dexreg.caught(u, a.pokeId) : !(u.items[a.itemId] > 0))).length;
    return [a.ref, 1 + missing + (a.kind === 'poke' ? 3 * (setNeed.get(a.pokeId) || 0) : 0) + (recent.has(a.ref) ? 5 : 0)];
  }));
}
const activeEnc = (now = Date.now()) => N().enc.filter((e) => e.expiresAt > now);
function newEncargo(now = Date.now()) {
  const n = N();
  const act0 = activeEnc(now);
  const npcs = shuffle(npcUsers()).filter((u) => profile(u) && profile(u).enc && act0.filter((e) => e.npc === u.id).length < ENC.maxActive && u.coins >= LOW_FUNDS * (u.npcStart || 0));
  for (const u of npcs) {
    const p = profile(u);
    const list = encArticles(p).filter((a) => !act0.some((e) => e.ref === a.ref) && !openOrders(u).some((o) => o.ref === a.ref));
    if (!list.length) continue;
    const w = needWeights(list, now);
    const a = weightedPick(list, (x) => w.get(x.ref));
    const r = rarityOfArt(a);
    const [type, amount] = (() => { const o = weightedPick(BONUS[r], (e) => e[2]); return [o[0], o[1]]; })();
    const price = bidPrice(a, p, null, { have: 0, demand: true, r: rand() });
    const qty = Math.min(ENC.qty, Math.floor((ENC.spendFrac * (u.npcStart || 1)) / price), Math.floor(spendLeft(u) / price));
    if (qty < 1 || qty * price + market.fee(qty * price, u) > u.coins) continue;
    let order;
    try { ({ order } = market.buy(u, { ...a, qty, price, days: 1 })); } catch { continue; }
    if (!order) continue; // se llenó al momento con ofertas de jugadores
    const hours = FAST ? 3 : randInt(ENC.hours[0] * 2, ENC.hours[1] * 2) / 2;
    const e = { id: n.nextId++, npc: u.id, ref: a.ref, price, bonus: { type, n: amount }, createdAt: now, expiresAt: now + hours * 3600e3, done: {}, orderId: order.id };
    if (type === 'frag') e.bonus.alt = r === 'L' ? 2 : 1; // si el evento Mega termina antes de cobrarlo: tickets
    order.enc = e.id;
    order.expiresAt = e.expiresAt;
    n.enc.push(e);
    npcFeed(FEED_ENC, `📜 ${u.username} tiene un encargo: ${market.describe(a, 1)} (${BONUS_LABEL[type](amount)} de premio)`, a.kind === 'poke' ? { pokeId: a.pokeId, shiny: false } : {});
    db.save();
    market.push();
    return e;
  }
  return null;
}
// Cobro del encargo (lo llama `note` tras cada venta de un jugador a un NPC).
function claim(seller, buyer, a, price, now = Date.now()) {
  const e = N().enc.find((x) => x.npc === buyer.id && x.ref === a.ref && x.expiresAt > now);
  if (!e || e.done[seller.id]) return null;
  const r = dayRec(seller.id);
  if ((r.enc || 0) >= ENC.perPlayerDay) {
    hub.emitUser(seller.id, 'toast', { kind: 'market', text: `📜 Ya cobraste ${ENC.perPlayerDay} premios de encargos hoy: esta venta no lleva premio.` });
    return null;
  }
  e.done[seller.id] = 1;
  r.enc = (r.enc || 0) + 1;
  // Prima de monedas: 50 % del precio cobrado (≤ 0,5 × tope), con las monedas libres del NPC.
  const prem = Math.max(0, Math.min(Math.floor(price * ENC.premium), buyer.coins, spendLeft(buyer)));
  if (prem > 0) {
    buyer.coins -= prem;
    seller.coins += prem;
    hub.ledger(buyer, -prem, 'market_buy', 'Prima de encargo');
    hub.ledger(seller, prem, 'market_sale', 'Prima de encargo');
    spendRec(buyer).amt += prem;
  }
  let { type, n: amount } = e.bonus;
  if (type === 'frag' && !require('./mega').giveFrags(seller, amount, now)) { type = 'ticket'; amount = e.bonus.alt || 1; }
  if (type === 'frag') { /* ya entregado */ } else items.give(seller, type === 'egg' ? 'mystery-egg' : 'ticket', amount);
  hub.emitUser(seller.id, 'toast', { kind: 'market', text: `📜 ¡Encargo de ${buyer.username} cumplido! ${prem ? `+${prem.toLocaleString('es')} monedas de prima y ` : ''}+${BONUS_LABEL[type](amount)}` });
  return { prem, bonus: { type, n: amount } };
}

// ---- Ofertas flash: una rebaja de −15/−25 % durante 1-2 h, nunca por debajo del 80 % del suelo ----
// Solo Pokémon C/U/R/E normales, Huevos Misteriosos y Amuletos Iris (no tienda, legendarias, míticas, variocolores ni cosméticos).
const FLASH = { perDay: [1, 2], discount: [0.15, 0.25], hours: [1, 2], min: 0.8, qty: 3 };
function flashEligible(a) {
  if (a.kind === 'poke') return !a.shiny && ['C', 'U', 'R', 'E'].includes(BY_ID.get(a.pokeId).rarity);
  return a.kind === 'item' && ['mystery-egg', 'shiny-charm'].includes(a.itemId);
}
const flashFloor = (a) => Math.ceil(FLASH.min * bounds(a).floor);
const activeFlash = (now = Date.now()) => N().flash.filter((f) => f.until > now);
function newFlash(now = Date.now()) {
  const n = N();
  if (activeFlash(now).length >= 2) return null;
  const cands = shuffle(npcUsers().filter((u) => profile(u))).flatMap((u) => shuffle(stock(u).filter((s) => flashEligible(s.a) && !activeFlash(now).some((f) => f.ref === s.a.ref))).slice(0, 2).map((s) => ({ u, s })));
  for (const { u, s } of cands) {
    const p = profile(u);
    const normal = askPrice(s.a, p, undefined, { have: s.n });
    const d = FLASH.discount[0] + rand() * (FLASH.discount[1] - FLASH.discount[0]);
    const price = Math.max(flashFloor(s.a), Math.round(normal * (1 - d)));
    if (price >= normal) continue;
    for (const o of openOrders(u).filter((x) => x.side === 'sell' && x.ref === s.a.ref)) market.cancel(u, { id: o.id });
    const qty = Math.min(held(u, s.a), FLASH.qty);
    if (qty < 1 || u.coins < market.fee(qty * price, u)) continue;
    let order;
    try { ({ order } = market.sell(u, { ...s.a, qty, price, days: 1 })); } catch { continue; }
    if (!order) continue;
    const hours = FAST ? 2 : randInt(FLASH.hours[0] * 2, FLASH.hours[1] * 2) / 2;
    const f = { id: n.nextId++, npc: u.id, ref: s.a.ref, price, normal, until: now + hours * 3600e3, orderId: order.id };
    order.flash = f.until;
    order.expiresAt = f.until;
    n.flash.push(f);
    npcFeed(FEED_DAILY, `🔥 ${u.username} pone en oferta ${market.describe(s.a, 1)}: ${price.toLocaleString('es')} monedas (−${Math.round((1 - price / normal) * 100)} %)`, s.a.kind === 'poke' ? { pokeId: s.a.pokeId, shiny: false } : {});
    db.save();
    market.push();
    return f;
  }
  return null;
}
// Retira encargos y ofertas flash caducados (y devuelve lo depositado).
function sweepSpecial(now = Date.now()) {
  const n = N();
  let changed = false;
  const drop = (list, orderOf) => list.filter((x) => {
    const live = x.expiresAt != null ? x.expiresAt > now : x.until > now;
    if (live) return true;
    const o = db.data.market.orders.find((y) => y.id === x.orderId && y.qty > 0);
    const u = db.userById(x.npc);
    if (o && u) market.cancel(u, { id: o.id });
    changed = true;
    return false;
  });
  n.enc = drop(n.enc);
  n.flash = drop(n.flash);
  if (changed) { db.save(); market.push(); }
}

// Plan del día: instantes al azar para los encargos (3-6) y las ofertas flash (1-2); NPC_FAST los pone en segundos.
function dayPlan(now = Date.now()) {
  const n = N();
  if (n.plan && n.plan.day === today()) { n.plan.int ||= Array.from({ length: randInt(INTERNAL.perDay[0], INTERNAL.perDay[1]) }, () => now + rand() * (Date.parse(today() + 'T00:00:00Z') + 864e5 - now)).sort((x, y) => x - y); return n.plan; }
  const end = Date.parse(today() + 'T00:00:00Z') + 864e5;
  const share = Math.max(0.15, Math.min(1, (end - now) / 864e5)); // si se arranca a mitad de día, menos encargos
  const times = (cnt) => Array.from({ length: cnt }, () => now + rand() * (end - now)).sort((x, y) => x - y);
  const ints = () => times(Math.max(1, Math.round(randInt(INTERNAL.perDay[0], INTERNAL.perDay[1]) * share)));
  n.plan = FAST
    ? { day: today(), enc: [4, 9, 14, 19, 24].map((s) => now + s * 1000), flash: [6, 20].map((s) => now + s * 1000), int: [8, 13, 18, 23, 28, 33].map((s) => now + s * 1000) }
    : { day: today(), enc: times(Math.max(1, Math.round(randInt(ENC.perDay[0], ENC.perDay[1]) * share))), flash: times(Math.max(1, Math.round(randInt(FLASH.perDay[0], FLASH.perDay[1]) * share))), int: ints() };
  return n.plan;
}
function special(now = Date.now()) {
  sweepSpecial(now);
  const plan = dayPlan(now);
  for (const key of ['enc', 'flash', 'int']) {
    while (plan[key].length && plan[key][0] <= now) {
      const at = plan[key].shift();
      if (FAST || now - at < ENC.maxAge) (key === 'enc' ? newEncargo : key === 'flash' ? newFlash : internalTrade)(now);
    }
  }
}

// Unidades de un artículo que tienen entre todos los comerciantes (escasez global).
const totalHeld = (a) => npcUsers().reduce((t, u) => t + held(u, a), 0);

// ---- Comercio entre comerciantes: unas pocas operaciones directas al día (4-10) para que el Mercado tenga vida ----
// Un NPC vende a otro algo que tiene de sobra y que el otro busca (su especialidad o sus encargos), a un precio dentro de
// [tope, suelo]: el punto medio desplazado por la escasez global (poco stock entre todos → hacia el suelo; mucho → hacia el
// tope) con algo de ruido. Respeta STOCK_MAX del comprador (así nunca pasa de 5 copias y no se convierte en polvo).
const DAY_MS = 24 * 3600 * 1000;
const INTERNAL = { perDay: [4, 10], qty: 2, maxFrac: 0.05, keepFrac: 0.4 };
const wantsRefs = (p) => new Set(encArticles(p).map((a) => a.ref));
// Un comerciante también compra a otro (al por mayor) lo de su especialidad, sus encargos y sus intereses secundarios (`also`).
const peerWants = (p, a, enc) => inFocus(p, a) || enc.has(a.ref) || (p.also || []).includes(categoryOf(a));
function internalPrice(a, total, r = rand()) {
  const b = bounds(a);
  const t = clamp(0.5 + 0.1 * (2 - total), 0.1, 0.9) + (r * 2 - 1) * 0.08;
  return clamp(Math.round(b.cap + t * (b.floor - b.cap)), b.cap, b.floor);
}
function internalTrade(now = Date.now()) {
  const us = npcUsers().filter((u) => profile(u));
  const totalHeld = (a) => us.reduce((t, u) => t + held(u, a), 0);
  const wants = new Map(us.map((u) => [u.id, wantsRefs(profile(u))]));
  const cands = [];
  for (const s of us) {
    const sp = profile(s);
    const flashRefs = new Set(activeFlash(now).filter((f) => f.npc === s.id).map((f) => f.ref));
    const refs = new Map(stock(s).map((x) => [x.a.ref, x.a]));
    for (const o of openOrders(s)) if (o.side === 'sell') refs.set(o.ref, art(o));
    for (const a of refs.values()) {
      if (!bounds(a) || flashRefs.has(a.ref)) continue;
      const keep = 0; // un comerciante puede vender su última unidad a otro que la valora más (solo si tiene más que él: nunca van y vienen)
      for (const b of us) {
        if (b.id === s.id) continue;
        const bp = profile(b);
        if (!peerWants(bp, a, wants.get(b.id))) continue;
        const last = N().lastInternal[a.ref];
        if (last && last.to === s.id && now - last.at < 3 * DAY_MS) continue; // sin ir y venir con el mismo artículo
        const mine = held(s, a);
        const room = STOCK_MAX[a.kind] - held(b, a);
        if (mine - keep < 1 || room < 1 || mine <= held(b, a)) continue;
        cands.push({ s, b, a, mine, room, keep });
      }
    }
  }
  for (const c of shuffle(cands)) {
    const { s, b, a } = c;
    const total = totalHeld(a);
    const qty = a.kind === 'dust' ? Math.min(c.mine - c.keep, c.room, randInt(20, 100)) : Math.min(c.mine - c.keep, c.room, randInt(1, INTERNAL.qty));
    if (qty < 1) continue;
    const price = internalPrice(a, total);
    const cost = qty * price;
    // El comprador gasta como mucho un 5 % de su tesorería inicial y se queda por encima del doble del umbral de fondos bajos.
    if (cost > INTERNAL.maxFrac * (b.npcStart || 1) || b.coins - cost < INTERNAL.keepFrac * (b.npcStart || 0)) continue;
    // Si lo que vende está en sus ofertas, se retiran antes (el depósito vuelve al inventario).
    if (market.owned(s, a) < qty) for (const o of openOrders(s).filter((x) => x.side === 'sell' && x.ref === a.ref)) market.cancel(s, { id: o.id });
    if (market.owned(s, a) < qty) continue;
    try { const t = market.npcTrade(s, b, { ...a, qty, price }); N().lastInternal[a.ref] = { to: b.id, at: now }; return t; } catch { /* sin monedas, etc. */ }
  }
  return null;
}

// ---- Estado público (mercado y fichas de los comerciantes; sin identificadores de jugadores) ----
function publicState(now = Date.now()) {
  const n = N();
  const live = (id) => db.data.market.orders.find((o) => o.id === id && o.qty > 0);
  const day = Math.floor(now / 864e5);
  const name = (id) => (db.userById(id) || {}).username;
  const user = (id) => db.userById(id);
  const encargos = n.enc.filter((e) => e.expiresAt > now && live(e.orderId)).map((e) => ({
    id: e.id, npc: name(e.npc), ref: e.ref, price: live(e.orderId).price, qty: live(e.orderId).qty, orderId: e.orderId, expiresAt: e.expiresAt,
    bonus: { type: e.bonus.type, n: e.bonus.n }, premium: Math.floor(live(e.orderId).price * ENC.premium), done: Object.keys(e.done).map((id) => (user(id) || {}).username).filter(Boolean),
  }));
  const flash = n.flash.filter((f) => f.until > now && live(f.orderId)).map((f) => ({ id: f.id, npc: name(f.npc), ref: f.ref, price: f.price, normal: f.normal, qty: live(f.orderId).qty, orderId: f.orderId, until: f.until }));
  const cards = NPCS.filter((p) => db.userById(p.id)).map((p) => ({ id: p.id, name: name(p.id), art: p.art, title: p.title, bio: p.bio, seeks: p.seeks, sells: p.sells, quote: p.quotes[day % p.quotes.length] }));
  return { encargos, flash, cards, limits: { perPlayerDay: ENC.perPlayerDay } };
}

// Un «turno»: reabastece si toca, publica encargos/ofertas si toca y hace actuar a uno o dos NPC.
function run(now = Date.now()) {
  restock();
  refillTreasuries();
  special(now);
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
  totalHeld, categoryOf, FARM_CATS, FARM_DAY, state: N, start, ensure, run, act, restock, isNpc, isNpcName, treasury, bounds, inFocus, maxBid, reference, bidPrice, askPrice, eligible,
  cap, whyBlocked, note, sellLimit, NPCS, MIN_LEVEL, MIN_AGE, SELL_UNITS, BUY_UNITS, POKE_FLOOR, LOW_FUNDS, SPEND_DAILY,
  // encargos y ofertas flash
  ENC, FLASH, BONUS, BONUS_VALUE, FEED_DAILY, flashEligible, flashFloor, encArticles, bonusValue, newEncargo, newFlash, notePaid, poolLeft, TREASURY_MAX, refillTreasuries, REFILL, internalTrade, internalPrice, INTERNAL, claim, special, sweepSpecial, publicState, npcFeed, dayPlan,
};

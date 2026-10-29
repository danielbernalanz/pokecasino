'use strict';
// Objetos: se compran en la Tienda Poké, caen como premio y se comercian en el Mercado.
const db = require('./db');
const hub = require('./hub');
const { BY_ID } = require('./pokedex');
const MEGA_FORMS = require('./megadata.json');
const tmdata = require('./tmdata');
const ES = require('./sd-es.json');

const ITEMS = {
  ticket: { name: 'Ticket Gacha', sprite: 'pass', price: 150, desc: 'Una tirada en cualquier banner.' },
  'rare-candy': { name: 'Caramelo Raro', sprite: 'rare-candy', price: 900, desc: 'Da una estrella a un Pokémon que ya tengas. Es una estrella "ligada": no se puede vender, regalar ni liberar.' },
  'lucky-egg': { name: 'Huevo Suerte', sprite: 'lucky-egg', price: 300, desc: 'Experiencia doble durante 1 hora.' },
  'amulet-coin': { name: 'Moneda Amuleto', sprite: 'amulet-coin', price: 400, desc: '+10 % sobre tus ganancias netas durante 1 hora y más margen de bonus (el tope sube del 30 % al 45 % de la ventaja de la casa de lo que apuestas).' },
  'shiny-charm': { name: 'Amuleto Iris', sprite: 'shiny-charm', price: null, desc: 'Las próximas 10 tiradas tienen 4 veces más probabilidad de variocolor. Solo como premio.' },
  'master-ball': { name: 'Master Ball', sprite: 'master-ball', price: null, desc: 'Tu próxima tirada es legendaria seguro y, si el banner tiene destacadas, una de ellas. Solo como premio o en el Mercado.' },
  'mystery-egg': { name: 'Huevo Misterioso', sprite: 'mystery-egg', price: null, desc: 'Ábrelo para obtener un cosmético al azar (marco, dorso de carta o título).' },
};

// Bayas (fase B3): salen del Huerto y de los hallazgos del compañero. Solo suben la amistad: sin precio de tienda y con un
// reciclaje simbólico (1 ✦, ver candy.js), para que no sirvan de fuente de monedas. Viven aparte de `ITEMS` (en `u.berries`):
// no se compran, no se venden en el Mercado ni los comercian los NPC. `grow`: horas hasta la cosecha.
const BERRIES = {
  'berry-aranja': { name: 'Baya Aranja', sprite: 'oran-berry', grow: 4, friend: 5 },
  'berry-zidra': { name: 'Baya Zidra', sprite: 'sitrus-berry', grow: 8, friend: 10 },
  'berry-frambu': { name: 'Baya Frambu', sprite: 'razz-berry', grow: 6, friend: 10 },
  'berry-latano': { name: 'Baya Latano', sprite: 'nanab-berry', grow: 10, friend: 15 },
  'berry-pinia': { name: 'Baya Pinia', sprite: 'pinap-berry', grow: 12, friend: 20 },
};
for (const b of Object.values(BERRIES)) b.desc = `Dásela a un Pokémon en la Caja PC: +${b.friend} de amistad. También es la semilla del Huerto (tarda ${b.grow} h en dar 2-4 bayas).`;

// Cosméticos: solo salen de Huevos Misteriosos. Se equipan, los ven los demás y se comercian.
const COSMETICS = {
  'frame-poke': { slot: 'frame', rarity: 'C', name: 'Marco Poké Ball', sprite: 'poke-ball' },
  'frame-great': { slot: 'frame', rarity: 'U', name: 'Marco Super Ball', sprite: 'great-ball' },
  'frame-ultra': { slot: 'frame', rarity: 'R', name: 'Marco Ultra Ball', sprite: 'ultra-ball' },
  'frame-master': { slot: 'frame', rarity: 'E', name: 'Marco Master Ball', sprite: 'master-ball' },
  'frame-rainbow': { slot: 'frame', rarity: 'L', name: 'Marco Arcoíris', sprite: 'rainbow-wing' },
  'frame-shiny': { slot: 'frame', rarity: 'L', name: 'Marco Destello', sprite: 'shiny-stone' },
  'back-pika': { slot: 'cardback', rarity: 'C', name: 'Dorso Pikachu', pokemon: 25 },
  'back-gengar': { slot: 'cardback', rarity: 'U', name: 'Dorso Gengar', pokemon: 94 },
  'back-rocket': { slot: 'cardback', rarity: 'R', name: 'Dorso Team Rocket', pokemon: 52 },
  'back-dragonite': { slot: 'cardback', rarity: 'E', name: 'Dorso Dragonite', pokemon: 149 },
  'back-mew': { slot: 'cardback', rarity: 'L', name: 'Dorso Mew', pokemon: 151 },
  'title-lucky': { slot: 'title', rarity: 'C', name: 'Título «Suertudo»', title: 'Suertudo', sprite: 'tm-normal' },
  'title-highroller': { slot: 'title', rarity: 'U', name: 'Título «Gran Apostador»', title: 'Gran Apostador', sprite: 'gold-bottle-cap' },
  'title-rocket': { slot: 'title', rarity: 'R', name: 'Título «Agente Rocket»', title: 'Agente Rocket', sprite: 'odd-keystone' },
  'title-shinyhunter': { slot: 'title', rarity: 'E', name: 'Título «Cazavariocolores»', title: 'Cazavariocolores', sprite: 'comet-shard' },
  'title-legend': { slot: 'title', rarity: 'L', name: 'Título «Leyenda de Kanto»', title: 'Leyenda de Kanto', sprite: 'silver-wing' },
  // Cosméticos del evento «Megaevolución»: no salen de los Huevos Misteriosos (`event`), solo del evento.
  'frame-mega': { slot: 'frame', rarity: 'L', name: 'Marco Mega', sprite: 'mega-ring', event: true },
  'back-megastone': { slot: 'cardback', rarity: 'E', name: 'Dorso Megapiedra', pokemon: 10034, event: true },
  'title-megaevolver': { slot: 'title', rarity: 'L', name: 'Título «Megaevolucionador»', title: 'Megaevolucionador', sprite: 'mega-bracelet', event: true },
};
const SLOT_NAMES = { frame: 'marco', cardback: 'dorso de carta', title: 'título' };
for (const [id, c] of Object.entries(COSMETICS)) {
  ITEMS[id] = { ...c, price: null, cosmetic: true, desc: `Cosmético (${SLOT_NAMES[c.slot]}). Equípalo en «Mi Entrenador»: los demás jugadores lo verán.` };
}
// Megapiedras (una por megaevolución, ver scripts/build-mega.js): se comercian en el Mercado y se usan desde la
// Mochila o la vista «Megaevolución» con un Pokémon de la especie base.
for (const f of MEGA_FORMS) {
  ITEMS[f.stone] = {
    name: f.stoneName, sprite: f.stone.replace(/^stone-/, ''), price: null, megaStone: f.formId, species: f.species,
    desc: `Úsala teniendo ${BY_ID.get(f.species).name} para desbloquear ${f.name}. Solo se consigue en el evento «Megaevolución» o en el Mercado.`,
  };
}
// Materiales de MT y las 229 MT de Escarlata/Púrpura (ver tmdata.js y tm.js): se fabrican en la Máquina MT, se consumen al usarlas
// y se comercian en el Mercado entre jugadores (los PNJ no las compran: sin precio de tienda ni valor en monedas).
for (const [id, m] of Object.entries(tmdata.MATERIALS)) ITEMS[id] = { name: m.name, sprite: m.sprite, price: null, material: true, types: m.types, desc: m.desc };
for (const t of tmdata.TMS) {
  ITEMS[t.id] = { name: t.name, sprite: 'tm-' + t.type, price: null, tm: t.move, num: t.num, type: t.type, tier: t.tier, craft: [t.coins, { [t.mat]: t.matN }],
    desc: `Enseña ${ES.moves[t.move]} a un Pokémon compatible. De un solo uso: se fabrica en la Máquina MT (Tienda) o cae como premio.` };
}
const EGG_WEIGHTS = { C: 40, U: 30, R: 18, E: 9, L: 3 };
const HOUR = 3600 * 1000;

function give(user, itemId, qty = 1, reason) {
  user.items[itemId] = (user.items[itemId] || 0) + qty;
  if (reason) hub.emitUser(user.id, 'toast', { kind: 'item', text: `🎒 ${reason}: +${qty} ${ITEMS[itemId].name}` });
  db.save();
}

function take(user, itemId, qty = 1) {
  if (!ITEMS[itemId]) throw new Error('Objeto desconocido.');
  if ((user.items[itemId] || 0) < qty) throw new Error(`No tienes suficientes ${ITEMS[itemId].name}.`);
  user.items[itemId] -= qty;
  if (!user.items[itemId]) {
    delete user.items[itemId];
    // Si vendes o usas tu último cosmético equipado, se desequipa.
    const c = COSMETICS[itemId];
    if (c && user.equip && user.equip[c.slot] === itemId) user.equip[c.slot] = null;
  }
}

function openEgg(user) {
  const { weighted, pick } = require('./rng');
  const rarity = weighted(Object.keys(EGG_WEIGHTS), (r) => EGG_WEIGHTS[r]);
  const id = pick(Object.keys(COSMETICS).filter((k) => COSMETICS[k].rarity === rarity && !COSMETICS[k].event));
  user.items[id] = (user.items[id] || 0) + 1;
  if (rarity === 'L' || rarity === 'E') hub.feed('egg', `🥚 ${user.username} abrió un Huevo Misterioso: ¡${COSMETICS[id].name}!`);
  return id;
}

// Equipar cosmético (o título ganado, que no es un objeto).
function equip(user, { slot, id }) {
  if (!['frame', 'cardback', 'title'].includes(slot)) throw new Error('Hueco no válido.');
  user.equip ||= { frame: null, cardback: null, title: null };
  if (!id) { user.equip[slot] = null; db.save(); return {}; }
  const c = COSMETICS[id];
  const earned = slot === 'title' && user.progress && user.progress.titles.includes(id);
  if (!earned) {
    if (!c || c.slot !== slot) throw new Error('Ese cosmético no va en ese hueco.');
    if (!user.items[id]) throw new Error('No tienes ese cosmético.');
  }
  user.equip[slot] = id;
  db.save();
  return {};
}

function buy(user, { itemId, qty }) {
  const it = ITEMS[itemId];
  qty = qty === undefined ? 1 : Number(qty);
  if (!it || !it.price) throw new Error('Ese objeto no está a la venta.');
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error('Cantidad no válida.');
  const cost = it.price * qty;
  if (user.coins < cost) throw new Error(`Necesitas ${cost} monedas.`);
  user.coins -= cost;
  hub.ledger(user, -cost, 'shop', `${qty} × ${it.name}`);
  give(user, itemId, qty);
  return { itemId, qty, cost };
}

function use(user, { itemId, pokeId }) {
  const now = Date.now();
  if (itemId === 'rare-candy') {
    const c = user.collection[Number(pokeId)];
    if (!BY_ID.has(Number(pokeId)) || !c) throw new Error('Elige un Pokémon que tengas.');
    if (c.n >= 5) throw new Error('Ese Pokémon ya tiene 5 estrellas.');
    take(user, itemId);
    c.n++;
    c.cn = (c.cn || 0) + 1; // estrella ligada: no cuenta como copia para vender, regalar o liberar
  } else if (itemId === 'lucky-egg') {
    take(user, itemId);
    user.buffs.luckyUntil = Math.max(now, user.buffs.luckyUntil) + HOUR;
  } else if (itemId === 'amulet-coin') {
    take(user, itemId);
    user.buffs.amuletUntil = Math.max(now, user.buffs.amuletUntil) + HOUR;
  } else if (itemId === 'shiny-charm') {
    take(user, itemId);
    user.buffs.shinyCharges += 10;
  } else if (itemId === 'mystery-egg') {
    take(user, itemId);
    const got = openEgg(user);
    hub.track(user, 'item_use', { itemId });
    db.save();
    return { used: itemId, got };
  } else if (itemId === 'master-ball') {
    if (user.buffs.masterBall) throw new Error('Ya tienes una Master Ball preparada.');
    take(user, itemId);
    user.buffs.masterBall = true;
  } else if (ITEMS[itemId] && ITEMS[itemId].megaStone) {
    return require('./mega').useStone(user, itemId);
  } else if (COSMETICS[itemId]) {
    return equip(user, { slot: COSMETICS[itemId].slot, id: itemId });
  } else if (ITEMS[itemId] && ITEMS[itemId].tm) {
    throw new Error('Una MT se usa desde la Máquina MT o desde los Movimientos de un Pokémon (Caja PC).');
  } else if (ITEMS[itemId] && ITEMS[itemId].material) {
    throw new Error('Los materiales se gastan fabricando MT en la Máquina MT.');
  } else {
    throw new Error('Ese objeto se usa desde el Gacha.');
  }
  hub.track(user, 'item_use', { itemId });
  db.save();
  return { used: itemId };
}

module.exports = { ITEMS, BERRIES, COSMETICS, give, take, buy, use, equip, openEgg };

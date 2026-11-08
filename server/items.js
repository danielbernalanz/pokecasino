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
  'lucky-egg': { name: 'Huevo Fortuna', sprite: 'lucky-egg', price: 300, desc: 'Experiencia de entrenador doble durante 1 hora (para tu nivel de entrenador, no para la EXP de tus Pokémon; esa la da el Huevo Suerte que se equipa).' },
  'amulet-coin': { name: 'Moneda de la Suerte', sprite: 'amulet-coin', price: 400, desc: '+10 % sobre tus ganancias netas durante 1 hora y más margen de bonus (el tope sube del 30 % al 45 % de la ventaja de la casa de lo que apuestas).' },
  'shiny-charm': { name: 'Amuleto Iris', sprite: 'shiny-charm', price: null, desc: 'Las próximas 10 tiradas tienen 4 veces más probabilidad de variocolor. Solo como premio.' },
  'master-ball': { name: 'Master Ball', sprite: 'master-ball', price: null, desc: 'Tu próxima tirada es legendaria seguro y, si el banner tiene destacadas, una de ellas. Solo como premio o en el Mercado. También es la Ball de la Captura: atrapa a cualquier Pokémon salvaje seguro.' },
  'mystery-egg': { name: 'Huevo Misterioso', sprite: 'mystery-egg', price: null, desc: 'Ábrelo para obtener un cosmético al azar (marco, dorso de carta o título).' },
};

// Bayas (fase B3): salen del Huerto y de los hallazgos del compañero. Solo suben la amistad: sin precio de tienda y con un
// reciclaje simbólico (1 ✦, ver candy.js), para que no sirvan de fuente de monedas. Viven aparte de `ITEMS` (en `u.berries`):
// no se compran, no se venden en el Mercado ni los comercian los NPC. `grow`: horas hasta la cosecha.
const BERRIES = {
  'berry-aranja': { name: 'Baya Aranja', sprite: 'oran-berry', grow: 4, friend: 5 },
  'berry-zidra': { name: 'Baya Zidra', sprite: 'sitrus-berry', grow: 8, friend: 10 },
  'berry-frambu': { name: 'Baya Ziuela', sprite: 'lum-berry', grow: 6, friend: 10 },
  'berry-latano': { name: 'Baya Atania', sprite: 'chesto-berry', grow: 10, friend: 15 },
  'berry-pinia': { name: 'Baya Zanama', sprite: 'leppa-berry', grow: 12, friend: 20 },
};
Object.setPrototypeOf(ITEMS, null); // sin prototipo: ITEMS['constructor'] / ['__proto__'] no existen (claves que manda el cliente)
Object.setPrototypeOf(BERRIES, null);
const BERRY_HOLD = require('./bpdata').BERRY_HOLD;
for (const [id, b] of Object.entries(BERRIES)) {
  b.hold = BERRY_HOLD[id]; // objeto de Showdown equivalente: también se lleva en combate
  b.desc = `Dásela a un Pokémon en la Caja PC: +${b.friend} de amistad. También es la semilla del Huerto (tarda ${b.grow} h en dar 2-4 bayas). Se puede llevar en combate: ${require('./bpdata').BERRY_DESC[b.hold]}`;
}

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
// Cosméticos de la Liga Pokémon (premios de temporada, ver league.js): tampoco salen de los Huevos Misteriosos.
Object.assign(COSMETICS, {
  'frame-liga-super': { slot: 'frame', rarity: 'U', name: 'Marco Liga Super', sprite: 'great-ball', event: true },
  'frame-liga-ultra': { slot: 'frame', rarity: 'R', name: 'Marco Liga Ultra', sprite: 'ultra-ball', event: true },
  'frame-liga-master': { slot: 'frame', rarity: 'E', name: 'Marco Liga Master', sprite: 'master-ball', event: true },
  'frame-liga-top': { slot: 'frame', rarity: 'L', name: 'Marco Liga Top 3', sprite: 'master-ball', event: true },
});
// Premio de los torneos entre amigos (tourney.js): tampoco sale de los Huevos Misteriosos.
for (const r of require('./regions').REGIONS) COSMETICS[r.frame] = { slot: 'frame', rarity: 'E', name: `Marco Diploma ${r.name}`, sprite: 'rare-candy', event: true }; // Diploma del Game Freak (regions.js)
COSMETICS['frame-torneo'] = { slot: 'frame', rarity: 'E', name: 'Marco Trofeo', sprite: 'rare-candy', event: true };
Object.setPrototypeOf(COSMETICS, null);
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
    desc: `Enseña ${ES.moves[t.move]} a un Pokémon compatible. De un solo uso: se fabrica en la Máquina MT (Taller) o cae como premio.` };
}
// Tienda de Combate (Puntos de Batalla): objetos equipables, mentas, Cápsula y Parche de Habilidad (ver bpdata.js y bp.js).
Object.assign(ITEMS, require('./bpdata').buildItems());
// Fragmentos del Tutor de movimientos (ver tutor.js): botín raro de Expediciones, comerciables entre jugadores.
for (const [id, sh] of Object.entries(require('./tutor').SHARDS)) ITEMS[id] = { name: sh.name, sprite: sh.sprite, price: null, shard: true, desc: 'Se gasta en el Tutor de movimientos (Caja PC → Movimientos). Cae, poco a poco, en las Expediciones largas.' };
// Vitaminas y bayas de EVs (ver evs.js): se compran con monedas en la Tienda Poké.
Object.assign(ITEMS, require('./evs').buildItems());
// Caramelos Exp. (ver exp.js) y Chapas del Entrenamiento Extremo (ver hyper.js).
Object.assign(ITEMS, require('./exp').buildItems(), require('./hyper').buildItems());
// Piedras, objetos de evolución y Cordón Unión (ver evoreq.js).
Object.assign(ITEMS, require('./evoreq').buildItems());
// Poké Balls de la Captura (ver balls.js y capture.js): se compran en la Tienda Poké.
Object.assign(ITEMS, require('./balls').buildItems());
// Orbe Teracristal (objeto clave) y Teralitos (ver tera.js).
Object.assign(ITEMS, require('./tera').buildItems());
const EGG_WEIGHTS = { C: 40, U: 30, R: 18, E: 9, L: 3 };
const HOUR = 3600 * 1000;

function give(user, itemId, qty = 1, reason) {
  user.items[itemId] = (user.items[itemId] || 0) + qty;
  if (reason) hub.emitUser(user.id, 'toast', { kind: 'item', text: `🎒 ${reason}: +${qty} ${ITEMS[itemId].name}` });
  db.save();
}

function take(user, itemId, qty = 1) {
  if (typeof itemId !== 'string' || !Object.hasOwn(ITEMS, itemId)) throw new Error('Objeto desconocido.');
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
  const c = typeof id === 'string' && Object.hasOwn(COSMETICS, id) ? COSMETICS[id] : null;
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
  const it = typeof itemId === 'string' && Object.hasOwn(ITEMS, itemId) ? ITEMS[itemId] : null;
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
  if (typeof itemId !== 'string' || !Object.hasOwn(ITEMS, itemId)) throw new Error('Objeto desconocido.');
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
  } else if (ITEMS[itemId] && (ITEMS[itemId].held || ITEMS[itemId].mint || ITEMS[itemId].capsule || ITEMS[itemId].patch)) {
    throw new Error('Este objeto se usa desde la Caja PC → Datos → Objeto y habilidad de un Pokémon.');
  } else if (ITEMS[itemId] && (ITEMS[itemId].expCandy || ITEMS[itemId].hyper)) {
    throw new Error('Esto se usa desde la Caja PC → Datos → Entrenar o desde la Mochila con «Usar».');
  } else if (ITEMS[itemId] && (ITEMS[itemId].ev || ITEMS[itemId].evo)) {
    throw new Error('Esto se usa desde la Caja PC → Datos → Entrenar.');
  } else if (ITEMS[itemId] && (ITEMS[itemId].key || ITEMS[itemId].teraShard)) {
    throw new Error(ITEMS[itemId].key ? 'El Orbe Teracristal se usa en combate (botón «Teracristalizar»).' : 'Los Teralitos se gastan en la Caja PC → Datos, cambiando el Teratipo de un Pokémon.');
  } else if (ITEMS[itemId] && ITEMS[itemId].shard) {
    throw new Error('Los fragmentos se gastan en el Tutor de movimientos (Caja PC → Movimientos).');
  } else if (ITEMS[itemId] && ITEMS[itemId].material) {
    throw new Error('Los materiales se gastan fabricando MT en la Máquina MT.');
  } else {
    throw new Error('Ese objeto se usa desde el Gacha.');
  }
  hub.track(user, 'item_use', { itemId });
  db.save();
  return { used: itemId };
}

module.exports = { ITEMS, BERRIES, COSMETICS, EGG_WEIGHTS, give, take, buy, use, equip, openEgg };

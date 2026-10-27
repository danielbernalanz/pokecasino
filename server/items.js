'use strict';
// Objetos: se compran en la Tienda Poké, caen como premio y se comercian en el Mercado.
const db = require('./db');
const hub = require('./hub');
const { BY_ID } = require('./pokedex');

const ITEMS = {
  ticket: { name: 'Ticket Gacha', sprite: 'pass', price: 150, desc: 'Una tirada en cualquier banner.' },
  'rare-candy': { name: 'Caramelo Raro', sprite: 'rare-candy', price: 900, desc: 'Da una estrella (+1 copia) a un Pokémon que ya tengas.' },
  'lucky-egg': { name: 'Huevo Suerte', sprite: 'lucky-egg', price: 1200, desc: 'Experiencia doble durante 1 hora.' },
  'amulet-coin': { name: 'Moneda Amuleto', sprite: 'amulet-coin', price: 2500, desc: '+10 % sobre tus ganancias netas durante 1 hora.' },
  'shiny-charm': { name: 'Amuleto Iris', sprite: 'shiny-charm', price: null, desc: 'Las próximas 10 tiradas tienen 4 veces más probabilidad de variocolor. Solo como premio.' },
  'master-ball': { name: 'Master Ball', sprite: 'master-ball', price: null, desc: 'Tu próxima tirada individual es legendaria seguro. Solo como premio.' },
};
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
  if (!user.items[itemId]) delete user.items[itemId];
}

function buy(user, { itemId, qty }) {
  const it = ITEMS[itemId];
  qty = Number(qty) || 1;
  if (!it || !it.price) throw new Error('Ese objeto no está a la venta.');
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error('Cantidad no válida.');
  const cost = it.price * qty;
  if (user.coins < cost) throw new Error(`Necesitas ${cost} monedas.`);
  user.coins -= cost;
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
  } else if (itemId === 'lucky-egg') {
    take(user, itemId);
    user.buffs.luckyUntil = Math.max(now, user.buffs.luckyUntil) + HOUR;
  } else if (itemId === 'amulet-coin') {
    take(user, itemId);
    user.buffs.amuletUntil = Math.max(now, user.buffs.amuletUntil) + HOUR;
  } else if (itemId === 'shiny-charm') {
    take(user, itemId);
    user.buffs.shinyCharges += 10;
  } else if (itemId === 'master-ball') {
    if (user.buffs.masterBall) throw new Error('Ya tienes una Master Ball preparada.');
    take(user, itemId);
    user.buffs.masterBall = true;
  } else {
    throw new Error('Ese objeto se usa desde el Gacha.');
  }
  db.save();
  return { used: itemId };
}

module.exports = { ITEMS, give, take, buy, use };

'use strict';
// Punto central para emitir eventos y gestionar la economía de cada jugador.
const db = require('./db');
const { BY_ID, RARITY } = require('./pokedex');
const { MIN_BET } = require('./config');

const GAME_NAMES = {
  slots: 'Pika-Slots', roulette: 'la Ruleta de Tipos', voltorb: 'Voltorb Flip', race: 'la Gran Carrera', duel: 'un duelo',
  blackjack: 'Blackjack', videopoker: 'Video Póker', baccarat: 'Baccarat', plinko: 'Plinko', mines: 'Minas Geodude',
  crash: 'Crash', poker: "Texas Hold'em",
};

// Las medallas suben el límite de apuesta: los novatos no pueden arruinarse de golpe.
const MAX_BET_BY_BADGES = [10000, 15000, 25000, 35000, 50000, 65000, 80000, 90000, 100000];
const badgeCount = (u) => (u.progress && u.progress.badges ? u.progress.badges.length : 0);
const maxBetFor = (u) => MAX_BET_BY_BADGES[Math.min(8, badgeCount(u))];

// Registro de eventos para misiones, medallas y colecciones (carga diferida para evitar ciclos).
const track = (user, event, data) => require('./progress').track(user, event, data || {});

let io = null;
const setIO = (server) => { io = server; };

const emitUser = (userId, ev, payload) => io && io.to('u:' + userId).emit(ev, payload);
const broadcast = (ev, payload) => io && io.emit(ev, payload);
const emitRoom = (room, ev, payload) => io && io.to(room).emit(ev, payload);

function feed(kind, text, extra = {}) {
  const item = { kind, text, at: Date.now(), ...extra };
  db.data.feed.push(item);
  if (db.data.feed.length > 60) db.data.feed.splice(0, db.data.feed.length - 60);
  db.save();
  broadcast('feed', item);
}

// ---- Nivel de entrenador ----
const xpForLevel = (lvl) => 100 * (lvl - 1) * (lvl - 1);

function addXp(user, amount) {
  if (user.buffs && user.buffs.luckyUntil > Date.now()) amount *= 2;
  user.xp += Math.max(0, Math.floor(amount));
  let leveled = false;
  while (user.xp >= xpForLevel(user.level + 1)) {
    user.level++;
    // ~2,5 % de lo apostado: el XP sale de apostar (10 %) y cada nivel cuesta 100·(2n−1) de XP.
    const reward = 50 * user.level;
    user.coins += reward;
    leveled = true;
    // Premios en objetos: Caramelo Raro cada nivel y Master Ball cada 5.
    const bonusItem = user.level % 5 === 0 ? 'master-ball' : 'rare-candy';
    user.items[bonusItem] = (user.items[bonusItem] || 0) + 1;
    emitUser(user.id, 'toast', { kind: 'level', text: `¡Subiste a nivel ${user.level}! +${reward} monedas y ${bonusItem === 'master-ball' ? 'una Master Ball' : 'un Caramelo Raro'}` });
    if (user.level % 5 === 0) feed('level', `${user.username} alcanzó el nivel de entrenador ${user.level}`);
  }
  if (leveled) track(user, 'level');
  return leveled;
}

// ---- Compañero y Moneda Amuleto ----
function buddyBonus(user) {
  const amulet = user.buffs && user.buffs.amuletUntil > Date.now() ? 0.1 : 0;
  const sets = require('./progress').setBonus(user);
  if (!user.buddy) return amulet + sets;
  const p = BY_ID.get(user.buddy.id);
  const owned = user.collection[user.buddy.id];
  if (!p || !owned) return amulet + sets;
  const stars = Math.min(5, owned.n);
  return amulet + sets + RARITY[p.rarity].bonus + (user.buddy.shiny ? 0.02 : 0) + (stars - 1) * 0.005;
}

// ---- Apuestas ----
function validAmount(n, user) {
  return Number.isInteger(n) && n >= MIN_BET && n <= (user ? maxBetFor(user) : MAX_BET_BY_BADGES[8]);
}

function takeBet(user, amount, game) {
  amount = Number(amount);
  if (!validAmount(amount, user)) {
    throw new Error(`La apuesta debe ser un entero entre ${MIN_BET} y ${maxBetFor(user).toLocaleString('es')}. Consigue medallas para subir el límite.`);
  }
  if (user.coins < amount) throw new Error('No tienes suficientes monedas.');
  user.coins -= amount;
  user.stats.wagered += amount;
  addXp(user, amount / 10);
  if (game) track(user, 'play', { game });
  db.save();
  return amount;
}

// Paga `amount` (incluye la apuesta devuelta). El compañero añade un % sobre la ganancia neta.
function pay(user, amount, stake, game) {
  amount = Math.floor(amount);
  const profit = amount - stake;
  const bonus = profit > 0 ? Math.floor(profit * buddyBonus(user)) : 0;
  const total = amount + bonus;
  user.coins += total;
  user.stats.won += total;
  if (total - stake > user.stats.biggestWin) user.stats.biggestWin = total - stake;
  if (profit >= 5000 || (stake > 0 && amount >= stake * 20 && profit >= 1000)) {
    feed('win', `${user.username} ganó ${total.toLocaleString('es')} monedas en ${GAME_NAMES[game] || game}`);
  }
  if (profit > 0) track(user, 'win', { game, mult: stake > 0 ? amount / stake : 0, profit });
  db.save();
  return { paid: total, bonus };
}

// Lo que los demás ven de tu aspecto: marco, dorso de carta y título.
function looks(u) {
  const e = u.equip || {};
  return { frame: e.frame || null, cardback: e.cardback || null, title: e.title ? require('./progress').titleText(e.title) : null, badges: badgeCount(u) };
}

function publicUser(u) {
  const owned = Object.keys(u.collection).length;
  return {
    ...looks(u),
    username: u.username, level: u.level, buddy: u.buddy, dex: owned,
    shinies: Object.values(u.collection).filter((c) => c.s > 0).length, isAdmin: u.isAdmin,
  };
}

function privateUser(u) {
  return {
    id: u.id, username: u.username, isAdmin: u.isAdmin, coins: u.coins, dust: u.dust,
    xp: u.xp, level: u.level, xpCur: xpForLevel(u.level), xpNext: xpForLevel(u.level + 1),
    daily: u.daily, lastHeal: u.lastHeal, collection: u.collection, buddy: u.buddy,
    buddyBonus: buddyBonus(u), pity: u.pity, stats: u.stats, voltorbLevel: u.voltorb.level,
    items: u.items, buffs: u.buffs, equip: u.equip, looks: looks(u), maxBet: maxBetFor(u),
    progress: require('./progress').view(u),
  };
}

const pushMe = (u) => emitUser(u.id, 'me', privateUser(u));

module.exports = { MAX_BET_BY_BADGES, looks, GAME_NAMES, maxBetFor, track, setIO, emitUser, emitRoom, broadcast, feed, addXp, takeBet, pay, buddyBonus, publicUser, privateUser, pushMe, validAmount };

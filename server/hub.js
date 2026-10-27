'use strict';
// Punto central para emitir eventos y gestionar la economía de cada jugador.
const db = require('./db');
const { BY_ID, RARITY } = require('./pokedex');
const { MIN_BET, MAX_BET } = require('./config');

let io = null;
const setIO = (server) => { io = server; };

const emitUser = (userId, ev, payload) => io && io.to('u:' + userId).emit(ev, payload);
const broadcast = (ev, payload) => io && io.emit(ev, payload);

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
  user.xp += Math.max(0, Math.floor(amount));
  let leveled = false;
  while (user.xp >= xpForLevel(user.level + 1)) {
    user.level++;
    const reward = 250 * user.level;
    user.coins += reward;
    leveled = true;
    emitUser(user.id, 'toast', { kind: 'level', text: `¡Subiste a nivel ${user.level}! +${reward} monedas` });
    if (user.level % 5 === 0) feed('level', `${user.username} alcanzó el nivel de entrenador ${user.level}`);
  }
  return leveled;
}

// ---- Compañero ----
function buddyBonus(user) {
  if (!user.buddy) return 0;
  const p = BY_ID.get(user.buddy.id);
  const owned = user.collection[user.buddy.id];
  if (!p || !owned) return 0;
  const stars = Math.min(5, owned.n);
  return RARITY[p.rarity].bonus + (user.buddy.shiny ? 0.02 : 0) + (stars - 1) * 0.005;
}

// ---- Apuestas ----
function validAmount(n) {
  return Number.isInteger(n) && n >= MIN_BET && n <= MAX_BET;
}

function takeBet(user, amount) {
  amount = Number(amount);
  if (!validAmount(amount)) throw new Error(`La apuesta debe ser un entero entre ${MIN_BET} y ${MAX_BET}.`);
  if (user.coins < amount) throw new Error('No tienes suficientes monedas.');
  user.coins -= amount;
  user.stats.wagered += amount;
  addXp(user, amount / 10);
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
    feed('win', `${user.username} ganó ${total.toLocaleString('es')} monedas en ${game}`);
  }
  db.save();
  return { paid: total, bonus };
}

function publicUser(u) {
  const owned = Object.keys(u.collection).length;
  return {
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
  };
}

const pushMe = (u) => emitUser(u.id, 'me', privateUser(u));

module.exports = { setIO, emitUser, broadcast, feed, addXp, takeBet, pay, buddyBonus, publicUser, privateUser, pushMe, validAmount };

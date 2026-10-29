'use strict';
// Punto central para emitir eventos y gestionar la economía de cada jugador.
const db = require('./db');
const { BY_ID, RARITY } = require('./pokedex');
const { MIN_BET } = require('./config');
const BAL = require('./balance');

const GAME_NAMES = {
  slots: 'Pika-Slots', roulette: 'la Ruleta de Tipos', voltorb: 'Voltorb Flip', race: 'la Gran Carrera', duel: 'un duelo',
  blackjack: 'Blackjack', videopoker: 'Video Póker', baccarat: 'Baccarat', plinko: 'Plinko', mines: 'Minas Geodude', quiz: 'el Desafío Pokémon',
  crash: 'Crash', poker: "Texas Hold'em", mega: 'la Máquina Mega',
};

// Las medallas suben el límite de apuesta: los novatos no pueden arruinarse de golpe.
const MAX_BET_BY_BADGES = [10000, 15000, 25000, 35000, 50000, 65000, 80000, 90000, 100000];
const badgeCount = (u) => (u.progress && u.progress.badges ? u.progress.badges.length : 0);
const maxBetFor = (u) => MAX_BET_BY_BADGES[Math.min(8, badgeCount(u))];

// Registro de eventos para misiones, medallas y colecciones (carga diferida para evitar ciclos).
// Los comerciantes NPC no tienen misiones ni medallas: así no cobran recompensas.
const track = (user, event, data) => (user.npc ? undefined : require('./progress').track(user, event, data || {}));

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

// ---- Historial de monedas (jugador) y estadísticas de economía (anfitrión) ----
// Cada movimiento que no es una partida queda en `user.hist.log` (últimos 100); las partidas se resumen
// por juego. `db.data.econ` suma por día lo que entra y sale de la economía para el panel del anfitrión.
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const HIST_DAYS = 60;
const ECON_DAYS = 45;
// Movimientos entre jugadores (no crean ni destruyen monedas).
const TRANSFERS = new Set(['gift_in', 'gift_out', 'market_sale', 'market_buy', 'market_refund', 'poker_in', 'poker_out', 'refund', 'mega_spin', 'mega_bote_out']);
function prune(obj, keep) {
  const keys = Object.keys(obj).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - keep))) delete obj[k];
}
function histOf(u) {
  if (!u.hist) u.hist = { days: {}, games: {}, log: [] };
  return u.hist;
}
function daySnap(u) {
  const hst = histOf(u);
  const k = dayKey();
  let d = hst.days[k];
  if (!d) { d = hst.days[k] = { c: u.coins, hi: u.coins, lo: u.coins }; prune(hst.days, HIST_DAYS); }
  d.c = u.coins;
  if (u.coins > d.hi) d.hi = u.coins;
  if (u.coins < d.lo) d.lo = u.coins;
}
function econDay() {
  const e = (db.data.econ ||= { days: {} });
  const k = dayKey();
  if (!e.days[k]) { e.days[k] = { src: {}, sink: {}, bet: {}, paid: {}, rounds: {}, active: [] }; prune(e.days, ECON_DAYS); }
  return e.days[k];
}
function econActive(u) {
  const d = econDay();
  if (!d.active.includes(u.id)) d.active.push(u.id);
}
// Seguimiento de ingresos por motivo (para detectar saldos sin origen): `hist.income[motivo]` acumula todo lo que entra
// y sale (las partidas, netas, bajo «games»), `hist.incomeBase` es el saldo antes del primer movimiento seguido
// y `hist.flow[día]` guarda lo ganado en neto y lo dado por anfitriones (14 días). Las cuentas antiguas solo
// quedan explicadas desde que empezó el seguimiento. Ver suspicious.js.
const FLOW_DAYS = 14;
function trackIncome(user, reason, delta) {
  if (!delta || user.npc) return;
  const hst = histOf(user);
  if (!hst.income) { hst.income = {}; hst.incomeBase = user.coins - delta; hst.incomeSince = Date.now(); hst.flow = {}; }
  hst.income[reason] = (hst.income[reason] || 0) + delta;
  const k = dayKey();
  const f = hst.flow[k] || (hst.flow[k] = { net: 0, admin: 0 });
  f.net += delta;
  if (reason === 'admin' && delta > 0) f.admin += delta;
  prune(hst.flow, FLOW_DAYS);
}
function ledger(user, delta, reason, label) {
  delta = Math.round(Number(delta) || 0);
  if (!user || !delta) return;
  trackIncome(user, reason, delta);
  const hst = histOf(user);
  hst.log.push(label ? { t: Date.now(), d: delta, r: reason, l: String(label).slice(0, 60) } : { t: Date.now(), d: delta, r: reason });
  if (hst.log.length > 100) hst.log.splice(0, hst.log.length - 100);
  daySnap(user);
  if (!TRANSFERS.has(reason)) {
    const d = econDay();
    const side = delta > 0 ? d.src : d.sink;
    side[reason] = (side[reason] || 0) + Math.abs(delta);
  }
}
// `round`: +1 una partida nueva, 0 apuesta extra (doblar, dividir), −1 apuesta devuelta.
function gameStat(user, game, bet, won, round = bet > 0 ? 1 : 0) {
  if (!game) return;
  const g = (histOf(user).games[game] ||= { bet: 0, won: 0, n: 0 });
  g.bet += bet; g.won += won; g.n = Math.max(0, g.n + round);
  trackIncome(user, 'games', won - bet);
  daySnap(user);
  const d = econDay();
  if (bet) { d.bet[game] = (d.bet[game] || 0) + bet; d.rounds[game] = Math.max(0, (d.rounds[game] || 0) + round); }
  if (won) d.paid[game] = (d.paid[game] || 0) + won;
  econActive(user);
}
function history(user) {
  const hst = histOf(user);
  daySnap(user);
  const days = Object.entries(hst.days).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, d]) => ({ date, ...d }));
  return { days, games: hst.games, log: hst.log, names: GAME_LABELS };
}
const GAME_LABELS = {
  slots: 'Pika-Slots', roulette: 'Ruleta', voltorb: 'Voltorb Flip', race: 'Carrera', duel: 'Duelos', blackjack: 'Blackjack',
  videopoker: 'Video Póker', baccarat: 'Baccarat', plinko: 'Plinko', mines: 'Minas', quiz: 'Desafío', crash: 'Crash', poker: "Hold'em", mega: 'Máquina Mega',
};

// ---- Nivel de entrenador ----
const xpForLevel = (lvl) => 100 * (lvl - 1) * (lvl - 1);

// `flat`: experiencia fija (duelos…) con tope diario. Los decimales sobrantes se acumulan en `xpFrac`.
function addXp(user, amount, { flat = false } = {}) {
  if (user.buffs && user.buffs.luckyUntil > Date.now()) amount *= 2;
  if (flat) {
    const b = bonusDayOf(user);
    amount = Math.max(0, Math.min(amount, BAL.FLAT_XP_DAILY - (b.flatXp || 0)));
    b.flatXp = (b.flatXp || 0) + amount;
  }
  const total = Math.max(0, amount) + (user.xpFrac || 0);
  const whole = Math.floor(total);
  user.xpFrac = total - whole;
  user.xp += whole;
  let leveled = false;
  while (user.xp >= xpForLevel(user.level + 1)) {
    user.level++;
    // Las recompensas por nivel salen de lo apostado (la XP es proporcional a la ventaja de la casa, ver
    // balance.js): su valor total queda en ≈15-20 % de esa ventaja, nunca más.
    const reward = BAL.levelCoins(user.level);
    user.coins += reward;
    ledger(user, reward, 'level', `Nivel ${user.level}`);
    leveled = true;
    const bonusItem = BAL.levelItem(user.level);
    if (bonusItem) user.items[bonusItem] = (user.items[bonusItem] || 0) + 1;
    const gift = bonusItem === 'master-ball' ? ' y una Master Ball' : bonusItem === 'rare-candy' ? ' y un Caramelo Raro' : '';
    emitUser(user.id, 'toast', { kind: 'level', text: `¡Subiste a nivel ${user.level}! +${reward} monedas${gift}` });
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
  // Compañero megaevolucionado: +1 % (dentro de los mismos topes diarios que el resto del bonus).
  const mega = require('./mega').buddyMegaOk(user) ? 0.01 : 0;
  return amulet + sets + RARITY[p.rarity].bonus + (user.buddy.shiny ? 0.02 : 0) + (stars - 1) * 0.005 + mega;
}

// ---- Apuestas ----
function validAmount(n, user) {
  return Number.isInteger(n) && n >= MIN_BET && n <= (user ? maxBetFor(user) : MAX_BET_BY_BADGES[8]);
}

// `extra`: apuesta añadida a una partida ya empezada (doblar o dividir en Blackjack); `quiet`: no cuenta como
// «partida jugada» para las misiones (los duelos tienen sus propios eventos).
function takeBet(user, amount, game, { extra = false, quiet = false, noXp = false } = {}) {
  amount = Number(amount);
  if (!validAmount(amount, user)) {
    throw new Error(`La apuesta debe ser un entero entre ${MIN_BET} y ${maxBetFor(user).toLocaleString('es')}. Consigue medallas para subir el límite.`);
  }
  if (user.coins < amount) throw new Error('No tienes suficientes monedas.');
  user.coins -= amount;
  user.stats.wagered += amount;
  require('./locked').accrue(user);
  gameStat(user, game, amount, 0, extra ? 0 : 1);
  if (!noXp) addXp(user, amount * BAL.xpRate(game));
  accrueBonus(user, amount, game);
  if (!user.npc) require('./bond').onBet(user, amount, game);
  if (!user.npc) require('./mega').onBet(user, amount, game, { play: !extra && !quiet });
  if (!user.npc) require('./daycare').onBet(user, amount, game);
  if (game && !extra && !quiet) track(user, 'play', { game });
  db.save();
  return amount;
}

// Paga `amount` (incluye la apuesta devuelta). El compañero añade un % sobre la ganancia neta.
// El bonus (compañero, colecciones, Moneda Amuleto) tiene dos topes diarios: el fijo (300 + 50 × nivel) y uno
// «de sala» que crece con lo apostado ese día y vale una fracción de la ventaja de la casa de cada juego
// (BONUS_SHARE). Sin el segundo, jugar a un juego de poca ventaja (Video Póker, Blackjack) con un compañero
// épico daría dinero seguro a la larga; sin el primero, también lo daría en los de mucha varianza.
const bonusCap = (user) => (300 + 50 * user.level) * (require('./events').has('buddy') ? 2 : 1);
function bonusDayOf(user) {
  const today = new Date().toISOString().slice(0, 10);
  if (!user.bonusDay || user.bonusDay.date !== today) user.bonusDay = { date: today, paid: 0, room: 0, flatXp: 0 };
  return user.bonusDay;
}
function accrueBonus(user, amount, game) {
  if (!game || game === 'duel') return;
  let share = user.buffs && user.buffs.amuletUntil > Date.now() ? BAL.BONUS_SHARE_AMULET : BAL.BONUS_SHARE;
  if (require('./events').has('buddy')) share *= BAL.BONUS_SHARE_EVENT;
  bonusDayOf(user).room += amount * share * BAL.edge(game);
}
function bonusLeft(user) {
  const b = bonusDayOf(user);
  return Math.max(0, Math.floor(Math.min(bonusCap(user), b.room || 0)) - b.paid);
}

function pay(user, amount, stake, game, { noBonus = false } = {}) {
  amount = Math.floor(amount);
  const profit = amount - stake;
  // En los duelos entre jugadores no hay bonus: crearía monedas de la nada entre dos amigos.
  const bonus = profit > 0 && !noBonus ? Math.min(Math.floor(profit * buddyBonus(user)), bonusLeft(user)) : 0;
  if (bonus) user.bonusDay.paid += bonus;
  const total = amount + bonus;
  user.coins += total;
  user.stats.won += total;
  gameStat(user, game, 0, total);
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
    shinies: Object.values(u.collection).filter((c) => c.s > 0).length, isAdmin: u.isAdmin, npc: !!u.npc,
  };
}

function privateUser(u) {
  return {
    id: u.id, username: u.username, isAdmin: u.isAdmin, playMs: u.playMs || 0, playPublic: u.playPublic !== false, coins: u.coins, dust: u.dust, bp: Math.max(0, Math.floor(u.bp || 0)),
    xp: u.xp, level: u.level, xpCur: xpForLevel(u.level), xpNext: xpForLevel(u.level + 1),
    daily: u.daily, lastHeal: u.lastHeal, collection: u.collection, buddy: u.buddy, candy: u.candy || {}, trades: u.tradeLog || [],
    buddyBonus: buddyBonus(u), stats: u.stats, voltorbLevel: u.voltorb.level,
    items: u.items, buffs: u.buffs, equip: u.equip, looks: looks(u), maxBet: maxBetFor(u),
    bonusLeft: bonusLeft(u), bonusCap: bonusCap(u), bonusPaid: bonusDayOf(u).paid, lockedCoins: lockedCoins(u), locked: lockedView(u).box, lockedProg: lockedView(u).prog,
    progress: require('./progress').view(u), mega: require('./mega').privateView(u), buddyFinds: require('./bond').findsView(u), berries: u.berries || {},
  };
}

// Monedas apartadas: pedidos de compra en el Mercado y lo que hay en juego (mesas, apuestas en curso).
function lockedCoins(u) {
  return require('./market').lockedIn(u) + Object.values(db.data.escrow).filter((e) => e.userId === u.id).reduce((s, e) => s + e.amount, 0);
}

const lockedView = (u) => require('./locked').view(u) || { box: {}, prog: null };

const pushMe = (u) => { if (u.npc) return; daySnap(u); emitUser(u.id, 'me', privateUser(u)); };

module.exports = { bonusDayOf, lockedCoins, ledger, gameStat, history, econDay, econActive, daySnap, GAME_LABELS, dayKey, MAX_BET_BY_BADGES, looks, GAME_NAMES, maxBetFor, track, setIO, emitUser, emitRoom, broadcast, feed, addXp, takeBet, pay, buddyBonus, publicUser, privateUser, pushMe, validAmount };

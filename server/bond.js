'use strict';
// Fase B3 «Personalidad y vínculo»: amistad de los ejemplares, hallazgos del compañero y Huerto de bayas.
// Nada de esto crea monedas salvo el hallazgo del compañero (tope 200 al día por jugador, motivo 'buddy' en el registro).
const db = require('./db');
const hub = require('./hub');
const items = require('./items');
const specimen = require('./specimen');
const { BY_ID } = require('./pokedex');
const { randInt, pick, weighted } = require('./rng');

// ---- Amistad ----
const FRIEND_MAX = 255;
const LOVE_MIN = 220; // «Te adora»: +3 % a todas las estadísticas en duelos y evolución por amistad
const LOVE_BONUS = 0.03;
const CAP = { buddy: 20, feed: 60, duel: 15 }; // por ejemplar y día (duel = 5 victorias × 3)
const BET_STEP = 1000; // monedas apostadas por +1 de amistad del compañero
const DUEL_WIN = 3;
const BERRY_CAP = 999;

// Evolución por amistad: destino → origen (números de Pokédex; se verifica en test/bond.test.js).
const FRIEND_EVO = new Map([
  [25, 172], [35, 173], [39, 174], [169, 42], [242, 113], [196, 133], [197, 133], [176, 175], [183, 298], [315, 406],
  [428, 427], [358, 433], [448, 447], [143, 446], [528, 527], [542, 541], [773, 772], [873, 872],
]);
// Eevee solo llega a Espeon y Umbreon por amistad; el resto admite también la vía normal (nivel + caramelos).
const FRIEND_ONLY = new Set([196, 197]);
const isFriendEvo = (from, to) => FRIEND_EVO.get(Number(to)) === Number(from);

const friendOf = (m) => (Number.isFinite(m && m.friendship) ? m.friendship : 70);
const loves = (friendship) => friendship >= LOVE_MIN;
const loveFactor = (friendship) => (loves(friendship) ? 1 + LOVE_BONUS : 1);
const hearts = (f) => (f >= LOVE_MIN ? 5 : Math.min(4, Math.floor(f / 50)));
const stageName = (f) => (f >= LOVE_MIN ? 'Te adora' : f >= 160 ? 'Muy amistoso' : f >= 100 ? 'Amistoso' : 'Indiferente');

function dayCounters(m) {
  const k = hub.dayKey();
  if (!m.fd || m.fd.day !== k) m.fd = { day: k, buddy: 0, feed: 0, duel: 0 };
  return m.fd;
}
// Suma amistad respetando el tope diario de esa fuente y el máximo 255. Devuelve lo que se sumó.
function addFriend(m, n, kind) {
  const d = dayCounters(m);
  if (!m.friendship && m.friendship !== 0) m.friendship = 70;
  const g = Math.max(0, Math.min(n, CAP[kind] - d[kind], FRIEND_MAX - m.friendship));
  if (g > 0) { m.friendship += g; d[kind] += g; }
  return g;
}

function buddySpecimen(u) {
  if (!u.buddy) return null;
  const id = u.buddy.id;
  if (!u.collection[id]) return null;
  if (u.buddy.uid) { const m = (u.mons && u.mons[id] || []).find((x) => x.uid === u.buddy.uid); if (m) return m; }
  return specimen.bestFor(u, id, !!u.buddy.shiny);
}

// Gancho de hub.takeBet: O(1) salvo cada 1.000 monedas apostadas.
function onBet(user, amount, game) {
  if (!user.buddy || user.npc || game === 'duel') return;
  const b = (user.bond ||= { wager: 0 });
  b.wager += amount;
  if (b.wager < BET_STEP) return;
  const steps = Math.floor(b.wager / BET_STEP);
  b.wager -= steps * BET_STEP;
  const m = buddySpecimen(user);
  if (m) addFriend(m, steps, 'buddy');
}

// Gancho de duel.js: el ejemplar ganador (por uid) sube +3 de amistad (5 victorias al día).
function onDuelWin(user, uid) {
  if (!uid || user.npc) return 0;
  for (const arr of Object.values(user.mons || {})) {
    const m = arr.find((x) => x.uid === uid);
    if (m) return addFriend(m, DUEL_WIN, 'duel');
  }
  return 0;
}

// ---- Dar bayas ----
const berriesOf = (u) => (u.berries ||= {});
function giveBerry(u, id, n) { const bs = berriesOf(u); bs[id] = Math.min(BERRY_CAP, (bs[id] || 0) + n); }
function takeBerry(u, id, n = 1) {
  const bs = berriesOf(u);
  if ((bs[id] || 0) < n) throw new Error(`No tienes ${items.BERRIES[id].name}.`);
  bs[id] -= n;
  if (!bs[id]) delete bs[id];
}
function feed(u, p) {
  const berry = String(p.berry);
  const b = items.BERRIES[berry];
  if (!b) throw new Error('Esa baya no existe.');
  const m = specimen.find(u, p);
  if ((berriesOf(u)[berry] || 0) < 1) throw new Error(`No tienes ${b.name}.`);
  const d = dayCounters(m);
  if (friendOf(m) >= FRIEND_MAX) throw new Error('Ya no puede quererte más: amistad al máximo.');
  if (d.feed >= CAP.feed) throw new Error(`Hoy ya ha comido bayas de sobra (+${CAP.feed} de amistad al día). ¡Vuelve mañana!`);
  takeBerry(u, berry);
  const gain = addFriend(m, b.friend, 'feed');
  db.save();
  return { gain, friendship: m.friendship, left: CAP.feed - d.feed };
}

// ---- Hallazgos del compañero ----
const FIND_MS = 4 * 3600 * 1000;
const FIND_MAX = 3;
const COIN_DAY_CAP = 200;
const DUST_DAY_CAP = 40;
const TICKET_DAY_CAP = 1;

function findState(u) {
  const now = Date.now();
  const f = (u.buddyFind ||= { at: now, n: 0, day: '', coins: 0, dust: 0, tickets: 0 });
  const k = hub.dayKey();
  if (f.day !== k) { f.day = k; f.coins = 0; f.dust = 0; f.tickets = 0; }
  if (!u.buddy || f.n >= FIND_MAX) { f.at = now; if (f.n >= FIND_MAX) f.n = FIND_MAX; return f; }
  const steps = Math.floor((now - f.at) / FIND_MS);
  if (steps > 0) {
    f.n = Math.min(FIND_MAX, f.n + steps);
    f.at += steps * FIND_MS;
    if (f.n >= FIND_MAX) f.at = now;
  }
  return f;
}
function findsView(u) {
  if (!u.buddy) return { n: 0, max: FIND_MAX, nextAt: null };
  const f = findState(u);
  return { n: f.n, max: FIND_MAX, nextAt: f.n >= FIND_MAX ? null : f.at + FIND_MS };
}

function buddyStatus(u) {
  const m = buddySpecimen(u);
  const f = m ? friendOf(m) : null;
  const left = u.buddy ? { coins: COIN_DAY_CAP - findState(u).coins } : null;
  return { ...findsView(u), friendship: f, stage: f === null ? null : stageName(f), uid: m ? m.uid : null, left, caps: { coins: COIN_DAY_CAP } };
}

function collect(u) {
  if (u.npc) throw new Error('Los comerciantes NPC no tienen compañero.');
  if (!u.buddy) throw new Error('Elige un compañero en tu Pokédex.');
  const f = findState(u);
  if (f.n < 1) throw new Error('Tu compañero aún no ha encontrado nada.');
  const m = buddySpecimen(u);
  const b = (m ? friendOf(m) : 70) / FRIEND_MAX; // más amistad, mejores probabilidades
  if (f.n >= FIND_MAX) f.at = Date.now();
  f.n--;
  const id = u.buddy.id;
  const out = { coins: 0 };
  let kind = weighted([['candy', 60], ['berry', 24 + 6 * b], ['dust', 8 + 4 * b], ['ticket', 2 + 3 * b]], (x) => x[1])[0];
  if (kind === 'ticket' && f.tickets >= TICKET_DAY_CAP) kind = 'candy';
  if (kind === 'dust' && f.dust >= DUST_DAY_CAP) kind = 'candy';
  if (kind === 'candy') {
    const n = randInt(2, 5);
    require('./candy').addCandy(u, id, n);
    out.candy = n;
  } else if (kind === 'berry') {
    const berry = pick(Object.keys(items.BERRIES));
    const n = randInt(1, 2);
    giveBerry(u, berry, n);
    out.berry = berry;
    out.berryN = n;
  } else if (kind === 'dust') {
    const n = Math.min(randInt(10, 40), DUST_DAY_CAP - f.dust);
    u.dust += n;
    f.dust += n;
    out.dust = n;
  } else {
    items.give(u, 'ticket', 1);
    f.tickets++;
    out.ticket = 1;
  }
  const coins = Math.min(randInt(20, 80), COIN_DAY_CAP - f.coins);
  if (coins > 0) {
    u.coins += coins;
    f.coins += coins;
    hub.ledger(u, coins, 'buddy', 'Hallazgo del compañero');
    out.coins = coins;
  }
  db.save();
  return { found: out, name: BY_ID.get(id).name, ...findsView(u) };
}

// ---- Huerto ----
const PLOTS = 4;
const WATER_SPEEDUP = 0.25; // del tiempo que falta
const HOUR = 3600 * 1000;
const YIELD = [2, 4];

function gardenOf(u) {
  const g = (u.garden ||= { plots: Array(PLOTS).fill(null), gift: false });
  while (g.plots.length < PLOTS) g.plots.push(null);
  if (!g.gift) { g.gift = true; giveBerry(u, 'berry-aranja', 3); }
  return g;
}
const plotView = (p, now) => (p ? { berry: p.berry, plantedAt: p.plantedAt, readyAt: p.readyAt, watered: !!p.watered, ready: now >= p.readyAt } : null);
function gardenView(u) {
  const g = gardenOf(u);
  const now = Date.now();
  db.save();
  return { plots: g.plots.map((p) => plotView(p, now)), berries: { ...berriesOf(u) }, now, yield: YIELD, speedup: WATER_SPEEDUP };
}
function plotIndex(p) {
  const i = Number(p.plot);
  if (!Number.isInteger(i) || i < 0 || i >= PLOTS) throw new Error('Parcela no válida.');
  return i;
}
function plant(u, p) {
  const g = gardenOf(u);
  const i = plotIndex(p);
  const berry = String(p.berry);
  const b = items.BERRIES[berry];
  if (!b) throw new Error('Esa baya no se puede plantar.');
  if (g.plots[i]) throw new Error('Esa parcela ya está ocupada.');
  takeBerry(u, berry);
  const now = Date.now();
  g.plots[i] = { berry, plantedAt: now, readyAt: now + b.grow * HOUR, watered: false };
  db.save();
  return gardenView(u);
}
function water(u, p) {
  const g = gardenOf(u);
  const i = plotIndex(p);
  const pl = g.plots[i];
  if (!pl) throw new Error('No hay nada plantado ahí.');
  const now = Date.now();
  if (now >= pl.readyAt) throw new Error('Ya está lista: ¡cosecha!');
  if (pl.watered) throw new Error('Ya la regaste (solo se puede una vez).');
  pl.readyAt = now + Math.ceil((pl.readyAt - now) * (1 - WATER_SPEEDUP));
  pl.watered = true;
  db.save();
  return gardenView(u);
}
function harvest(u, p) {
  const g = gardenOf(u);
  const i = plotIndex(p);
  const pl = g.plots[i];
  if (!pl) throw new Error('No hay nada plantado ahí.');
  if (Date.now() < pl.readyAt) throw new Error('Todavía no está lista.');
  const n = randInt(YIELD[0], YIELD[1]);
  giveBerry(u, pl.berry, n);
  g.plots[i] = null;
  db.save();
  return { ...gardenView(u), got: { berry: pl.berry, n } };
}

module.exports = {
  FRIEND_MAX, LOVE_MIN, LOVE_BONUS, CAP, BET_STEP, DUEL_WIN, FRIEND_EVO, FRIEND_ONLY, FIND_MS, FIND_MAX, COIN_DAY_CAP, DUST_DAY_CAP, TICKET_DAY_CAP, PLOTS, WATER_SPEEDUP, YIELD,
  BERRY_CAP, berriesOf, giveBerry, takeBerry, isFriendEvo, friendOf, loves, loveFactor, hearts, stageName, addFriend, dayCounters, buddySpecimen, onBet, onDuelWin, feed,
  findState, findsView, buddyStatus, collect, gardenOf, gardenView, plant, water, harvest,
};

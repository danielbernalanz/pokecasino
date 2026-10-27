'use strict';
// Gran Carrera Pokémon: rondas compartidas por todos los jugadores conectados.
const db = require('../db');
const hub = require('../hub');
const { rand, shuffle, weighted } = require('../rng');

const POOL = [
  { id: 78, spe: 105 }, { id: 85, spe: 110 }, { id: 135, spe: 130 }, { id: 59, spe: 95 },
  { id: 101, spe: 150 }, { id: 18, spe: 101 }, { id: 53, spe: 115 }, { id: 128, spe: 110 },
  { id: 142, spe: 130 }, { id: 51, spe: 120 }, { id: 26, spe: 110 }, { id: 22, spe: 100 },
  { id: 65, spe: 120 }, { id: 123, spe: 105 }, { id: 19, spe: 72 }, { id: 129, spe: 80 },
  { id: 143, spe: 30 }, { id: 79, spe: 15 }, { id: 25, spe: 90 }, { id: 245, spe: 85 },
];
const EDGE = 0.9;
const MAX_ODDS = 60;
const PHASES = { betting: 25000, racing: 11000, results: 7000 };
const MAX_PER_ROUND = 100000;

let race = null;
let roundNo = 0;

// Un fallo en una ronda no debe tumbar el servidor: se reintenta con una ronda nueva.
const safe = (fn) => () => {
  try { fn(); } catch (e) { console.error('Error en la carrera:', e); refundAll(); setTimeout(newRound, 5000); }
};

function newRound() {
  roundNo++;
  const runners = shuffle(POOL).slice(0, 6).map((r, lane) => ({ ...r, lane, w: Math.pow(r.spe, 2.2) }));
  const total = runners.reduce((s, r) => s + r.w, 0);
  for (const r of runners) {
    r.p = r.w / total;
    r.odds = Math.max(1.2, Math.min(MAX_ODDS, Math.floor((EDGE / r.p) * 10) / 10));
  }
  race = { round: roundNo, phase: 'betting', endsAt: Date.now() + PHASES.betting, runners, bets: {}, result: null };
  broadcastState();
  setTimeout(safe(startRace), PHASES.betting);
}

function startRace() {
  // Orden de llegada: muestreo ponderado sin reemplazo.
  const left = race.runners.slice();
  const order = [];
  while (left.length) {
    const r = weighted(left, (x) => x.w);
    order.push(r.lane);
    left.splice(left.indexOf(r), 1);
  }
  let t = 8 + rand() * 0.8;
  const finish = {};
  for (const lane of order) { finish[lane] = Number(t.toFixed(3)); t += 0.12 + rand() * 0.5; }
  race.phase = 'racing';
  race.endsAt = Date.now() + PHASES.racing;
  race.result = { order, finish, seed: Math.floor(rand() * 1e9) };
  broadcastState();
  setTimeout(safe(settle), PHASES.racing);
}

function settle() {
  const winner = race.result.order[0];
  const runner = race.runners[winner];
  for (const [uid, bets] of Object.entries(race.bets)) {
    db.escrowDel('race:' + uid);
    const user = db.userById(uid);
    if (!user) continue;
    user.stats.races++;
    const stake = bets.reduce((s, b) => s + b.amount, 0);
    const win = bets.filter((b) => b.lane === winner).reduce((s, b) => s + b.amount * runner.odds, 0);
    const res = win > 0 ? hub.pay(user, win, stake, 'race') : { paid: 0, bonus: 0 };
    hub.emitUser(uid, 'race:payout', { round: race.round, stake, ...res });
    hub.pushMe(user);
  }
  race.phase = 'results';
  race.endsAt = Date.now() + PHASES.results;
  broadcastState();
  setTimeout(safe(newRound), PHASES.results);
}

function publicState() {
  if (!race) return null;
  const pools = race.runners.map(() => 0);
  let bettors = 0;
  for (const bets of Object.values(race.bets)) {
    bettors++;
    for (const b of bets) pools[b.lane] += b.amount;
  }
  return {
    round: race.round, phase: race.phase, endsAt: race.endsAt, now: Date.now(),
    runners: race.runners.map(({ id, spe, lane, odds }) => ({ id, spe, lane, odds })),
    pools, bettors, result: race.phase === 'betting' ? null : race.result,
  };
}

function broadcastState() { hub.broadcast('race:state', publicState()); }

function placeBet(user, { lane, amount }) {
  if (!race || race.phase !== 'betting') throw new Error('Las apuestas están cerradas, espera a la siguiente carrera.');
  lane = Number(lane);
  if (!race.runners[lane]) throw new Error('Corredor no válido.');
  const mine = race.bets[user.id] || [];
  const already = mine.reduce((s, b) => s + b.amount, 0);
  if (already + Number(amount) > MAX_PER_ROUND) throw new Error('Límite de apuesta por carrera alcanzado.');
  const stake = hub.takeBet(user, amount, 'race');
  mine.push({ lane, amount: stake });
  race.bets[user.id] = mine;
  db.escrowSet('race:' + user.id, user.id, mine.reduce((s, b) => s + b.amount, 0));
  broadcastState();
  return { myBets: mine };
}

function myBets(user) { return race && race.bets[user.id] ? race.bets[user.id] : []; }

// Si el servidor se apaga a mitad de ronda devolvemos las apuestas pendientes.
function refundAll() {
  if (!race || race.phase === 'results') return;
  for (const [uid, bets] of Object.entries(race.bets)) {
    const u = db.userById(uid);
    const back = bets.reduce((s, b) => s + b.amount, 0);
    if (u) { u.coins += back; hub.gameStat(u, 'race', -back, 0, -bets.length); }
    db.escrowDel('race:' + uid);
  }
  race.bets = {};
}

module.exports = { start: newRound, placeBet, publicState, myBets, refundAll, POOL };

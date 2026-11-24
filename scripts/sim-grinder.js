#!/usr/bin/env node
'use strict';
// «Grinder» óptimo de 30 días con TODO a favor: compañero mítico variocolor a 5 estrellas, 8 colecciones, Moneda de la
// Suerte y Huevo Suerte siempre activos y el fin de semana del Compañero todos los días. Juega cada juego con la mejor
// estrategia del repositorio con el código REAL del servidor (hub, juegos, XP, niveles, bonus) y un reloj falso.
// Mide el balance neto (monedas + objetos de nivel a precio de PNJ) por moneda apostada y lo compara con el máximo
// teórico de server/balance.js (returnMax): el valor esperado debe ser NEGATIVO en todos los juegos.
//   node scripts/sim-grinder.js [--rounds 60000] [--players 12] [--days 30] [--bet 1000] [--games slots,roulette,...]
const os = require('os');
const path = require('path');
const fs = require('fs');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const ROUNDS = Number(opt('rounds', 60000)); // por jugador y juego, repartidas en los días
const PLAYERS = Number(opt('players', 12));
const DAYS = Number(opt('days', 30));
const BET = Number(opt('bet', 1000));
const ONLY = opt('games', null);
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-grind-'));

let clock = Date.parse('2026-10-26T09:00:00Z');
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(clock); else super(...a); }
  static now() { return clock; }
}
global.Date = FakeDate;
const DAY = 864e5;

const db = require('../server/db');
const hub = require('../server/hub');
const BAL = require('../server/balance');
const events = require('../server/events');
events.has = (id) => id === 'buddy' || false; // fin de semana del Compañero todos los días
const slots = require('../server/games/slots');
const roulette = require('../server/games/roulette');
const plinko = require('../server/games/plinko');
const mines = require('../server/games/mines');
const videopoker = require('../server/games/videopoker');
const blackjack = require('../server/games/blackjack');
const baccarat = require('../server/games/baccarat');
const voltorb = require('../server/games/voltorb');
const S = require('./strategies');
const { randInt, rand } = require('../server/rng');

const GAMES = {
  slots: (u, b) => slots.spin(u, { bet: b }),
  roulette: (u, b) => roulette.spin(u, { bets: [{ kind: 'type', value: 'fire', amount: b }] }), // todas las apuestas valen igual; el tipo exacto da más premios sueltos (más bonus)
  plinko: (u, b) => plinko.drop(u, { bet: b, risk: 'low' }),
  baccarat: (u, b) => baccarat.play(u, { bets: { banker: b } }),
  mines: (u, b) => {
    mines.start(u, { bet: b, mines: 3 });
    for (let i = 0; i < 25; i++) {
      const g = u.games.mines;
      if (g.done) return;
      if (g.revealed.length >= 4) return mines.cashout(u);
      let idx;
      do idx = randInt(0, 24); while (g.revealed.includes(idx));
      if (mines.pick(u, { index: idx }).boom !== undefined) return;
    }
  },
  videopoker: (u, b) => { const d = videopoker.deal(u, { bet: b }); return videopoker.draw(u, { hold: S.vpHold(d.hand) }); },
  blackjack: (u, b) => {
    let v = blackjack.deal(u, { bet: b });
    while (!v.game.done) {
      const g = v.game;
      v = blackjack.act(u, { action: S.bjAction(g.hands[g.active].cards, g.dealer[0], { canDouble: g.canDouble, canSplit: g.canSplit, canHit: g.canHit }) });
    }
  },
  // Voltorb con la heurística rápida (la inferencia exacta tarda 0,2 s por partida): aquí solo importa el rakeback y el bonus; su RTP con la mejor estrategia sale de scripts/calibrate-voltorb.js.
  voltorb: (u, b) => { if (u.voltorb.game) u.voltorb.game = null; S.voltorbPlay(voltorb, u, b, 0.25); },
};

let uid = 0;
function grinder(name) {
  const u = {
    id: 'g-' + (++uid), username: name + uid, isAdmin: false, banned: false, createdAt: clock, coins: 1e12, dust: 0, xp: 0, level: 1,
    daily: { last: null, streak: 0, freePull: null }, lastHeal: 0, collection: { 151: { n: 5, s: 1 } }, buddy: { id: 151, shiny: true }, voltorb: { level: 1, game: null },
    stats: { wagered: 0, won: 0, pulls: 0, biggestWin: 0 }, buffs: {}, items: {},
  };
  db.addUser(u);
  u.progress.sets = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  return u;
}

const rows = [];
for (const [name, fn] of Object.entries(GAMES)) {
  if (ONLY && !ONLY.split(',').includes(name)) continue;
  const per = [];
  let staked = 0;
  let net = 0;
  for (let p = 0; p < PLAYERS; p++) {
    const u = grinder(name);
    clock = Date.parse('2026-10-26T09:00:00Z');
    const start = u.coins;
    let bonus = 0;
    const b0 = u.stats.wagered;
    for (let d = 0; d < DAYS; d++) {
      u.buffs.amuletUntil = clock + DAY; // Moneda de la Suerte y Huevo Suerte siempre activos
      u.buffs.luckyUntil = clock + DAY;
      const today = Math.round(ROUNDS / DAYS);
      for (let i = 0; i < today; i++) fn(u, BET);
      clock += DAY;
    }
    void bonus;
    const items = Object.entries(u.items).reduce((s, [id, n]) => s + n * (BAL.LEVEL_CASH[id] || 0), 0);
    const st = u.stats.wagered - b0;
    const n = u.coins - start + items;
    per.push(n / st);
    staked += st;
    net += n;
  }
  const mean = per.reduce((a, b) => a + b, 0) / per.length;
  const se = Math.sqrt(per.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, per.length - 1) / per.length);
  rows.push({ game: name, staked, net, ret: 1 + mean, se, max: BAL.returnMax(name) });
}
console.log(`Grinder óptimo, ${DAYS} días, ${PLAYERS} jugadores, ${ROUNDS} partidas de ${BET} por jugador y juego (compañero mítico variocolor, 8 colecciones, Amuleto, Huevo Suerte y evento):`);
console.log('juego        apostado        neto (monedas)   retorno medido       máximo teórico   neto/apostado');
for (const r of rows) {
  console.log(`${r.game.padEnd(11)} ${String(Math.round(r.staked)).padStart(13)} ${String(Math.round(r.net)).padStart(16)}   ${(r.ret * 100).toFixed(2).padStart(6)} % ± ${(r.se * 196).toFixed(2)}   ${(r.max * 100).toFixed(2).padStart(6)} %   ${(((r.ret - 1)) * 100).toFixed(2)} %`);
}
process.exit(0);

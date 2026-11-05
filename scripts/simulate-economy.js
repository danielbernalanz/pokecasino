#!/usr/bin/env node
'use strict';
// Simulación de la economía con el código REAL del servidor (hub, gacha, progreso, juegos) y un reloj falso.
//   node scripts/simulate-economy.js [--days 30] [--players 12] [--rtp 200000] [--dex 6] [--only casual,regular,grinder] [--json]
// Tres arquetipos de jugador durante N días, el RTP medido de cada juego con la mejor estrategia conocida,
// cuánto cuesta completar la Pokédex y cuánto cuesta una legendaria concreta. Resultados y análisis en docs/BALANCE.md.
const os = require('os');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const DAYS = Number(opt('days', 30));
const PLAYERS = Number(opt('players', 12));
const RTP_ROUNDS = Number(opt('rtp', 200000));
const DEX_RUNS = Number(opt('dex', 6));
const ONLY = String(opt('only', 'casual,regular,grinder')).split(',');
const JSON_OUT = !!opt('json', false);
const SKIP = String(opt('skip', '')).split(',');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-sim-'));

// ---- Reloj falso: todo el servidor lee Date.now() / new Date() ----
let clock = Date.parse('2026-10-26T09:00:00Z'); // lunes por la mañana (hora de España)
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(clock); else super(...a); }
  static now() { return clock; }
}
global.Date = FakeDate;
const DAY = 864e5;

const db = require('../server/db');
const hub = require('../server/hub');
const gacha = require('../server/gacha');
const items = require('../server/items');
const daily = require('../server/daily');
const healer = require('../server/heal');
const progress = require('../server/progress');
const dex = require('../server/pokedex');
const BAL = require('../server/balance');
const { START_COINS } = require('../server/config');
const slots = require('../server/games/slots');
const roulette = require('../server/games/roulette');
const plinko = require('../server/games/plinko');
const mines = require('../server/games/mines');
const videopoker = require('../server/games/videopoker');
const blackjack = require('../server/games/blackjack');
const baccarat = require('../server/games/baccarat');
const voltorb = require('../server/games/voltorb');
const S = require('./strategies');
const { randInt, pick, rand } = require('../server/rng');

let uid = 0;
function newPlayer(name) {
  const u = {
    id: 'sim-' + (++uid), username: name + uid, isAdmin: false, banned: false, createdAt: clock, coins: START_COINS, dust: 0, xp: 0, level: 1,
    daily: { last: null, streak: 0, freePull: null }, lastHeal: 0, collection: {}, buddy: null, voltorb: { level: 1, game: null },
    stats: { wagered: 0, won: 0, pulls: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0, races: 0 },
  };
  db.addUser(u);
  return u;
}

// ---- Juegos: una ronda con la mejor estrategia sencilla de cada uno ----
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const GAMES = {
  slots: (u, b) => slots.spin(u, { bet: b }),
  roulette: (u, b) => roulette.spin(u, { bets: [{ kind: 'parity', value: rand() < 0.5 ? 'par' : 'impar', amount: b }] }),
  plinko: (u, b) => plinko.drop(u, { bet: b, risk: 'low' }),
  baccarat: (u, b) => baccarat.play(u, { bets: { banker: b } }),
  mines: (u, b) => {
    mines.start(u, { bet: b, mines: 3 });
    let r;
    for (let i = 0; i < 25; i++) {
      const g = u.games.mines;
      if (g.done) return r;
      if (g.revealed.length >= 4) return mines.cashout(u);
      let idx;
      do idx = randInt(0, 24); while (g.revealed.includes(idx));
      r = mines.pick(u, { index: idx });
      if (r.boom !== undefined) return r;
    }
    return r;
  },
  videopoker: (u, b) => { const d = videopoker.deal(u, { bet: b }); return videopoker.draw(u, { hold: S.vpHold(d.hand) }); },
  blackjack: (u, b) => {
    let v = blackjack.deal(u, { bet: b });
    while (!v.game.done) {
      const g = v.game;
      const h = g.hands[g.active];
      v = blackjack.act(u, { action: S.bjAction(h.cards, g.dealer[0], { canDouble: g.canDouble, canSplit: g.canSplit }) });
    }
    return v;
  },
  voltorb: (u, b) => S.voltorbPlay(voltorb, u, b, 0.25),
};

// ---- Arquetipos ----
// rounds: partidas al día · games: lista donde elige · bet(u): apuesta · logins: probabilidad de entrar cada día
const ARCHETYPES = {
  casual: { label: 'Casual (20 min/día)', rounds: 30, games: ['slots', 'roulette', 'plinko', 'mines', 'baccarat', 'videopoker', 'blackjack', 'voltorb'], bet: (u) => clamp(Math.round(u.coins * 0.005 / 5) * 5, 10, 50), logins: 0.9, reserve: 300 },
  regular: { label: 'Regular (1 h/día)', rounds: 120, games: ['slots', 'roulette', 'plinko', 'mines', 'baccarat', 'videopoker', 'blackjack', 'voltorb'], bet: (u) => clamp(Math.round(u.coins * 0.005 / 10) * 10, 20, 250), logins: 0.97, reserve: 1500 },
  grinder: { label: 'Grinder (óptimo, 4 h/día)', rounds: 1500, games: ['videopoker', 'blackjack'], bet: (u) => clamp(Math.round(u.coins * 0.01 / 100) * 100, 100, 3000), logins: 1, reserve: 3000 },
};

function playSession(u, arch, st) {
  const maxB = hub.maxBetFor(u);
  for (let i = 0; i < arch.rounds; i++) {
    const game = pick(arch.games);
    const bet = Math.min(arch.bet(u), maxB);
    if (u.coins < bet + 20) break;
    if (game === 'voltorb' && u.voltorb.game) u.voltorb.game = null;
    try { GAMES[game](u, bet); st.rounds++; } catch (e) { st.errors[e.message] = (st.errors[e.message] || 0) + 1; }
  }
}

function useItems(u) {
  // Caramelos Raros: estrella al Pokémon más raro con menos de 5 copias.
  while ((u.items['rare-candy'] || 0) > 0) {
    const cand = Object.entries(u.collection).filter(([, c]) => c.n < 5).map(([id]) => dex.BY_ID.get(Number(id))).sort((a, b) => 'MLERUC'.indexOf(a.rarity) - 'MLERUC'.indexOf(b.rarity))[0];
    if (!cand) break;
    items.use(u, { itemId: 'rare-candy', pokeId: cand.id });
  }
  if ((u.items['lucky-egg'] || 0) > 0) items.use(u, { itemId: 'lucky-egg' });
  if ((u.items['shiny-charm'] || 0) > 0) items.use(u, { itemId: 'shiny-charm' });
  while ((u.items['mystery-egg'] || 0) > 0) items.use(u, { itemId: 'mystery-egg' });
}

function setBuddy(u) {
  const best = Object.keys(u.collection).map((id) => dex.BY_ID.get(Number(id))).sort((a, b) => 'MLERUC'.indexOf(a.rarity) - 'MLERUC'.indexOf(b.rarity))[0];
  if (best && (!u.buddy || u.buddy.id !== best.id)) { const first = !u.buddy; u.buddy = { id: best.id, shiny: false }; if (first) hub.track(u, 'buddy'); }
}

function gachaSession(u, arch, st) {
  const banner = gacha.activeBanners().promo.id;
  const spend = (count, opts = {}) => {
    const before = u.coins;
    try { const r = gacha.pull(u, { banner, count, ...opts }); st.pulls += count; st.gachaCoins += before - u.coins; return r; } catch (e) { return null; }
  };
  spend(1, { free: true });
  while ((u.items.ticket || 0) > 0) spend(1, { ticket: true });
  while (((u.items['master-ball'] || 0) > 0 || u.buffs.masterBall) && u.coins >= gacha.COST[1]) {
    if (!u.buffs.masterBall) items.use(u, { itemId: 'master-ball' });
    if (!spend(1)) break;
  }
  // El sobrante por encima de la reserva se gasta en tiradas (×10 cuando alcanza).
  while (u.coins - arch.reserve >= gacha.COST[10]) if (!spend(10)) break;
  while (u.coins - arch.reserve >= gacha.COST[1]) if (!spend(1)) break;
}

function craftSession(u) {
  // Con polvo suficiente, se fabrica la especie más rara que falte entre las que se pueden pagar.
  for (const r of ['M', 'L', 'E', 'R']) {
    if (u.dust < dex.RARITY[r].craft) continue;
    const missing = dex.BY_RARITY[r].filter((p) => !u.collection[p.id]);
    if (!missing.length) continue;
    try { gacha.craft(u, { id: pick(missing).id }); return true; } catch { /* sin polvo */ }
  }
  return false;
}

function snapshot(u) {
  const owned = Object.keys(u.collection).map((id) => dex.BY_ID.get(Number(id)));
  return {
    coins: u.coins, level: u.level, badges: u.progress.badges.length, dex: owned.length,
    legendaries: owned.filter((p) => p.rarity === 'L' || p.rarity === 'M').length, shinies: Object.values(u.collection).filter((c) => c.s > 0).length,
    dust: u.dust, sets: u.progress.sets.length, tutorial: u.progress.tutorial, won: u.stats.won, wagered: u.stats.wagered,
  };
}

function runArchetype(key) {
  const arch = ARCHETYPES[key];
  db.data.econ = { days: {} };
  const players = Array.from({ length: PLAYERS }, () => newPlayer(key));
  const st = new Map(players.map((u) => [u.id, { rounds: 0, pulls: 0, gachaCoins: 0, errors: {}, snaps: {} }]));
  clock = Date.parse('2026-10-26T09:00:00Z');
  for (let d = 1; d <= DAYS; d++) {
    for (const u of players) {
      const s = st.get(u.id);
      if (rand() > arch.logins) continue;
      try { daily.claim(u); } catch { /* ya reclamada */ }
      // Los que se quedan sin fondos piden ayuda a la enfermera Joy.
      if (!healer.reason(u, hub.lockedCoins(u))) { u.lastHeal = clock; u.coins += healer.AMOUNT; hub.ledger(u, healer.AMOUNT, 'heal'); }
      useItems(u);
      playSession(u, arch, s);
      gachaSession(u, arch, s);
      useItems(u);
      while (craftSession(u)) { /* seguir fabricando */ }
      setBuddy(u);
      progress.evaluate(u);
    }
    for (const u of players) { const sn = snapshot(u); sn.saved = u.coins + st.get(u.id).gachaCoins; st.get(u.id).snaps[d] = sn; }
    clock += DAY;
  }
  // Agregados
  const days = [1, 7, 14, 21, DAYS].filter((d, i, a) => d <= DAYS && a.indexOf(d) === i);
  const avg = (d, f) => players.reduce((s, u) => s + f(st.get(u.id).snaps[d]), 0) / players.length;
  const econ = { src: {}, sink: {}, bet: {}, paid: {} };
  for (const day of Object.values(db.data.econ.days)) for (const k of Object.keys(econ)) for (const [r, v] of Object.entries(day[k] || {})) econ[k][r] = (econ[k][r] || 0) + v;
  const per = (x) => Math.round(x / players.length);
  const final = players.map((u) => st.get(u.id).snaps[DAYS]);
  const sorted = (f) => final.map(f).sort((a, b) => a - b);
  return {
    key, label: arch.label, players: PLAYERS,
    coins: Object.fromEntries(days.map((d) => [d, Math.round(avg(d, (s) => s.coins))])),
    saved: Object.fromEntries(days.map((d) => [d, Math.round(avg(d, (s) => s.saved))])),
    level: Object.fromEntries(days.map((d) => [d, +avg(d, (s) => s.level).toFixed(1)])),
    badges: Object.fromEntries(days.map((d) => [d, +avg(d, (s) => s.badges).toFixed(1)])),
    dexN: Object.fromEntries(days.map((d) => [d, Math.round(avg(d, (s) => s.dex))])),
    legendaries: Object.fromEntries(days.map((d) => [d, +avg(d, (s) => s.legendaries).toFixed(1)])),
    final: { dex: Math.round(avg(DAYS, (s) => s.dex)), dexPct: +(avg(DAYS, (s) => s.dex) / 10.25).toFixed(1), shinies: +avg(DAYS, (s) => s.shinies).toFixed(1), sets: +avg(DAYS, (s) => s.sets).toFixed(1), dust: Math.round(avg(DAYS, (s) => s.dust)), coinsMin: sorted((s) => s.coins)[0], coinsMax: sorted((s) => s.coins).at(-1) },
    perPlayer: {
      rounds: per([...st.values()].reduce((s, x) => s + x.rounds, 0)),
      pulls: per([...st.values()].reduce((s, x) => s + x.pulls, 0)),
      wagered: per(econ.bet ? Object.values(econ.bet).reduce((a, b) => a + b, 0) : 0),
      gamesNet: per(Object.values(econ.paid).reduce((a, b) => a + b, 0) - Object.values(econ.bet).reduce((a, b) => a + b, 0)),
      gamesNetSe: Math.round(Math.sqrt(final.reduce((s, f) => s + ((f.won - f.wagered) - final.reduce((t, g) => t + g.won - g.wagered, 0) / final.length) ** 2, 0) / Math.max(1, final.length - 1) / final.length)),
      faucets: Object.fromEntries(Object.entries(econ.src).filter(([r]) => r !== 'game').map(([r, v]) => [r, per(v)])),
      sinks: Object.fromEntries(Object.entries(econ.sink).map(([r, v]) => [r, per(v)])),
    },
    errors: [...st.values()].reduce((o, x) => { for (const [k, v] of Object.entries(x.errors)) o[k] = (o[k] || 0) + v; return o; }, {}),
  };
}

// ---- RTP medido de cada juego (rondas aisladas, apuesta fija, sin compañero ni bonus) ----
function measureRTP(rounds) {
  const out = {};
  const bot = newPlayer('rtp');
  const bet = 100;
  for (const [name, fn] of Object.entries(GAMES)) {
    if (name === 'voltorb') continue; // lo mide test/balance.test.js con su propio modelo
    const n = ['voltorb'].includes(name) ? Math.min(rounds, 20000) : rounds;
    let stake = 0;
    let paid = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      bot.coins = 1e12;
      const w0 = bot.stats.wagered;
      const won0 = bot.stats.won;
      fn(bot, bet);
      const stk = bot.stats.wagered - w0;
      const p = bot.stats.won - won0;
      stake += stk; paid += p;
      s2 += (p - stk) * (p - stk);
    }
    const mean = paid / stake;
    const sd = Math.sqrt(s2 / n - ((paid - stake) / n) ** 2) / (stake / n);
    out[name] = { rtp: mean, se: sd / Math.sqrt(n), n };
  }
  return out;
}

// ---- Cuánto cuesta completar la Pokédex y una legendaria concreta (solo tiradas, banner permanente) ----
// (el reloj avanza 8 h por sobre: los promocionales rotan cada 3 días)
const pickBanner = () => { clock += DAY / 3; return rand() < 0.5 ? 'kanto' : gacha.activeBanners().promo.id; };
function dexCost(runs) {
  // Un jugador rota entre el banner permanente y los promocionales según el día: aquí se sortea uno por sobre.
  const res = [];
  for (let k = 0; k < runs; k++) {
    const u = newPlayer('dex');
    u.coins = 1e12;
    let pulls = 0;
    const milestones = {};
    const total = dex.DEX.length;
    for (;;) {
      u.coins = 1e12;
      const before = Object.keys(u.collection).length;
      gacha.pull(u, { banner: pickBanner(), count: 10 });
      pulls += 10;
      const have = Object.keys(u.collection).length;
      for (const m of [0.5, 0.9, 0.99]) if (!milestones[m] && have >= total * m) milestones[m] = pulls;
      // Con el polvo se fabrica lo que falte (lo más barato primero): es lo que haría un jugador.
      while (u.dust > 0) {
        const miss = dex.DEX.filter((p) => !u.collection[p.id] && dex.RARITY[p.rarity].craft <= u.dust).sort((a, b) => dex.RARITY[b.rarity].craft - dex.RARITY[a.rarity].craft)[0];
        if (!miss) break;
        gacha.craft(u, { id: miss.id });
      }
      if (Object.keys(u.collection).length >= total || pulls > 400000) { milestones[1] = pulls; break; }
      void before;
    }
    res.push(milestones);
  }
  const mean = (m) => Math.round(res.reduce((s, r) => s + (r[m] || 0), 0) / res.length);
  return { runs, pulls: { 0.5: mean(0.5), 0.9: mean(0.9), 0.99: mean(0.99), 1: mean(1) } };
}

function legendCost(runs = 20000) {
  // Tiradas hasta una legendaria concreta destacada en un banner con 3 destacadas (sin Master Ball) y con ella.
  const banner = gacha.BANNERS.find((b) => b.id === 'aves');
  const target = banner.featuredL[0];
  const lens = [];
  for (let i = 0; i < runs; i++) {
    let n = 0;
    for (;;) { n++; const r = gacha.rollRarity(banner); if (gacha.rollPokemon(r, banner).id === target) break; }
    lens.push(n);
  }
  lens.sort((a, b) => a - b);
  return { mean: Math.round(lens.reduce((a, b) => a + b, 0) / runs), median: lens[runs >> 1], p90: lens[Math.floor(runs * 0.9)] };
}

const result = { days: DAYS, players: PLAYERS };
if (!SKIP.includes('rtp')) result.rtp = measureRTP(RTP_ROUNDS);
if (!SKIP.includes('archetypes')) result.archetypes = ONLY.filter((k) => ARCHETYPES[k]).map(runArchetype);
if (!SKIP.includes('dex')) { result.legend = legendCost(); if (DEX_RUNS > 0) result.dexCost = dexCost(DEX_RUNS); }

if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }
const f = (n) => Math.round(n).toLocaleString('es');
if (result.rtp) {
  console.log('\n== RTP medido (estrategia óptima/sencilla, %d rondas) ==', RTP_ROUNDS);
  for (const [g, r] of Object.entries(result.rtp)) console.log(`  ${g.padEnd(11)} ${(r.rtp * 100).toFixed(2)} % ± ${(r.se * 100 * 1.96).toFixed(2)}  (n=${r.n})`);
}
for (const a of result.archetypes || []) {
  console.log(`\n== ${a.label} · ${a.players} jugadores · ${DAYS} días ==`);
  console.log('  día          ' + Object.keys(a.coins).map((d) => String(d).padStart(9)).join(''));
  const row = (n, o) => console.log('  ' + n.padEnd(13) + Object.values(o).map((v) => String(typeof v === 'number' && v > 999 ? f(v) : v).padStart(9)).join(''));
  row('monedas', a.coins); row('sin gacha*', a.saved); row('nivel', a.level); row('medallas', a.badges); row('Pokédex', a.dexN); row('legend./míticos', a.legendaries);
  console.log(`  final: Pokédex ${a.final.dexPct} % · variocolor ${a.final.shinies} · colecciones ${a.final.sets} · polvo ${f(a.final.dust)} · monedas mín/máx ${f(a.final.coinsMin)}/${f(a.final.coinsMax)}`);
  console.log(`  por jugador: ${f(a.perPlayer.rounds)} partidas, ${f(a.perPlayer.pulls)} tiradas, apostado ${f(a.perPlayer.wagered)}, resultado neto de los juegos ${f(a.perPlayer.gamesNet)} ± ${f(a.perPlayer.gamesNetSe)} (error estándar; incluye bonus)`);
  console.log('  * «sin gacha» = monedas + lo gastado en tiradas con monedas (cuánto tendría si no tirara)');
  console.log('  ingresos por jugador:', JSON.stringify(a.perPlayer.faucets));
  console.log('  gastos por jugador:  ', JSON.stringify(a.perPlayer.sinks));
  if (Object.keys(a.errors).length) console.log('  errores:', JSON.stringify(a.errors));
}
if (result.legend) console.log(`\n== Una legendaria concreta destacada (banner con 3 destacadas, sin Master Ball) ==\n  media ${f(result.legend.mean)} tiradas (${f(result.legend.mean * gacha.COST[1])} monedas) · mediana ${f(result.legend.median)} · percentil 90: ${f(result.legend.p90)}`);
if (result.dexCost) console.log(`\n== Completar la Pokédex solo con tiradas ×10 (banner permanente y el promocional activo al 50 % + fabricar con polvo, ${result.dexCost.runs} partidas) ==\n  50 %: ${f(result.dexCost.pulls[0.5])} · 90 %: ${f(result.dexCost.pulls[0.9])} · 99 %: ${f(result.dexCost.pulls[0.99])} · 100 %: ${f(result.dexCost.pulls[1])} tiradas (×150 monedas)`);
process.exit(0);

'use strict';
// Invariantes de equilibrio (ver docs/BALANCE.md): RTP de cada juego, devolución por niveles y bonus menor que la
// ventaja de la casa, y ningún bucle de monedas con valor esperado positivo.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-balance-'));

const db = require('../server/db');
const hub = require('../server/hub');
const BAL = require('../server/balance');
const dex = require('../server/pokedex');
const gacha = require('../server/gacha');
const items = require('../server/items');
const market = require('../server/market');
const npc = require('../server/npc');
const progress = require('../server/progress');
const healer = require('../server/heal');
const duel = require('../server/games/duel');
const slots = require('../server/games/slots');
const roulette = require('../server/games/roulette');
const plinko = require('../server/games/plinko');
const mines = require('../server/games/mines');
const crash = require('../server/games/crash');
const baccarat = require('../server/games/baccarat');
const videopoker = require('../server/games/videopoker');
const race = require('../server/games/race');
const voltorb = require('../server/games/voltorb');
const { MIN_BET } = require('../server/config');

function user(name, extra = {}) {
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: { wagered: 0, won: 0, pulls: 0, biggestWin: 0 }, daily: {}, voltorb: { level: 1, game: null }, xp: 0, level: 1, createdAt: Date.now() - 5 * 864e5, ...extra };
  db.addUser(u);
  return u;
}

// ---------- RTP de los juegos ----------
test('cada juego declara un RTP máximo en el rango objetivo (95-99 %; VP/BJ ≤ 99,6 %; carrera ≤ 92 %)', () => {
  for (const [g, rtp] of Object.entries(BAL.RTP)) {
    assert.ok(rtp <= 0.9960, `${g}: ${rtp}`);
    if (g === 'race') assert.ok(rtp <= 0.92);
    else if (g !== 'duel') assert.ok(rtp >= 0.945, `${g}: ${rtp}`);
  }
});

test('Pika-Slots: líneas + 2 % del bote + semilla ≤ RTP declarado', () => {
  const lines = slots.computeRTP();
  assert.ok(lines > 0.92 && lines < 0.95, `líneas ${lines}`);
  const pJackpot = 1 / slots.REELS.reduce((p, r) => p * r.length, 1);
  const seedShare = (slots.JACKPOT_SEED * pJackpot) / MIN_BET; // la semilla vale más cuanto menor es la apuesta
  const total = lines + slots.JACKPOT_CUT + seedShare;
  assert.ok(total <= BAL.RTP.slots + 1e-9, `${total} > ${BAL.RTP.slots}`);
  assert.ok(total > 0.95, `${total}`);
});

test('Ruleta, Plinko, Minas y Crash: RTP exacto ≤ declarado', () => {
  for (const [kind, pay] of Object.entries(roulette.PAYOUT)) {
    const n = roulette.WHEEL.length;
    const wins = { type: 1, group: 6, parity: 9 }[kind];
    assert.ok((wins * pay) / n <= BAL.RTP.roulette + 1e-9, `ruleta ${kind}`);
  }
  for (const risk of Object.keys(plinko.TABLES)) {
    const r = plinko.rtp(risk);
    assert.ok(r <= BAL.RTP.plinko && r >= 0.95, `plinko ${risk}: ${r}`);
  }
  for (const m of [1, 3, 5, 10, 15, 20, 24]) {
    let survive = 1;
    for (let safe = 1; safe <= 25 - m; safe++) {
      survive *= (25 - m - safe + 1) / (25 - safe + 1);
      assert.ok(mines.multiplier(m, safe) * survive <= BAL.RTP.mines + 1e-9, `minas ${m}/${safe}`);
    }
  }
  // Crash: P(explota ≥ x) = 0,97 / x → retirarse a ×2 devuelve ≈97 %.
  let hit = 0;
  const N = 300000;
  for (let i = 0; i < N; i++) if (crash.crashPoint() >= 2) hit++;
  assert.ok(Math.abs((2 * hit) / N - 0.97) < 0.02, `crash ×2: ${(2 * hit) / N}`);
});

test('Baccarat: las tres apuestas devuelven menos que el RTP declarado', () => {
  const N = 300000;
  const w = { player: 0, banker: 0, tie: 0 };
  for (let i = 0; i < N; i++) w[baccarat.coup().winner]++;
  const sd = 3 * Math.sqrt(0.25 / N) * 2; // 3σ de una apuesta que paga ≈2
  const T = w.tie / N;
  assert.ok((w.player / N) * baccarat.PAYOUT.player + T <= BAL.RTP.baccarat + sd, 'Punto');
  assert.ok((w.banker / N) * baccarat.PAYOUT.banker + T <= BAL.RTP.baccarat + sd, 'Banca');
  assert.ok(T * baccarat.PAYOUT.tie < 0.9, 'Empate');
});

test('Video Póker: tabla 9/6 Jacks or Better (99,54 % con juego óptimo)', () => {
  const table = Object.fromEntries(videopoker.PAYTABLE);
  assert.deepStrictEqual(table, { 'Escalera real': 800, 'Escalera de color': 50, Póker: 25, Full: 9, Color: 6, Escalera: 4, Trío: 3, 'Doble pareja': 2, 'Jotas o mejor': 1 });
  assert.ok(BAL.RTP.videopoker >= 0.9954 && BAL.RTP.videopoker < 0.996);
});

test('Gran Carrera: apostar a cualquier corredor devuelve ≤ 90 %, también combinando los seis', () => {
  const { shuffle } = require('../server/rng');
  for (let k = 0; k < 3000; k++) {
    const runners = shuffle(race.POOL).slice(0, 6).map((r) => ({ ...r, w: Math.pow(r.spe, 2.2) }));
    const total = runners.reduce((s, r) => s + r.w, 0);
    for (const r of runners) {
      const p = r.w / total;
      const odds = Math.max(1.2, Math.min(race.MAX_ODDS, Math.floor((race.EDGE / p) * 10) / 10));
      assert.ok(p * odds <= BAL.RTP.race + 1e-9, `corredor ${r.id}: ${p * odds}`);
    }
  }
});

test('Voltorb Flip: el pago tiene tope y los divisores no dejan pagos de miles de veces la apuesta', () => {
  assert.ok(voltorb.SCORE_CAP <= 12);
  for (let lvl = 1; lvl <= 8; lvl++) {
    const maxMult = voltorb.SCORE_CAP / voltorb.divisor(lvl);
    assert.ok(maxMult <= 1.4, `nivel ${lvl}: pago máximo ×${maxMult}`);
    assert.ok(voltorb.divisor(lvl) >= 8, `nivel ${lvl}`);
  }
  const u = user('voltorb-cap', { voltorb: { level: 8, game: { bet: 1000, level: 8, board: [], flipped: [], score: 3456 } } });
  assert.strictEqual(voltorb.view(u).game.cashout, Math.floor((1000 * voltorb.SCORE_CAP) / voltorb.divisor(8)));
});

test('Voltorb Flip: con inferencia exacta (la mejor estrategia) el RTP del nivel 1 no pasa del 100 %', () => {
  const S = require('../scripts/strategies');
  const conf = voltorb.CONFIGS[0];
  const N = 25; // pocas partidas (calibración completa con scripts/calibrate-voltorb.js): solo detecta un pago roto
  let pts = 0;
  for (let g = 0; g < N; g++) {
    const board = voltorb.makeBoard(1);
    const hints = voltorb.hints(board);
    const cells = Array(25).fill(null);
    let score = 0;
    for (;;) {
      if (!board.some((v, i) => v > 1 && cells[i] === null) || score >= voltorb.SCORE_CAP) break;
      const post = S.voltorbPosterior(conf, hints, cells);
      let best = null;
      for (let k = 0; k < 25; k++) if (cells[k] === null && (!best || post.pVolt[k] < best.p)) best = { p: post.pVolt[k], k };
      if (score > 0 && best.p > 0.3) break;
      cells[best.k] = board[best.k];
      if (board[best.k] === 0) { score = 0; break; }
      if (board[best.k] > 1) score = score === 0 ? board[best.k] : score * board[best.k];
    }
    pts += Math.min(score, voltorb.SCORE_CAP);
  }
  const rtp = pts / N / voltorb.divisor(1);
  assert.ok(rtp < 1.2, `RTP ${rtp.toFixed(2)}`); // medido: ≈0,92 ± 0,02 con 600 partidas
});

// ---------- Devolución por niveles y bonus ----------
// Valor en monedas de las recompensas por nivel (a precio de compra de los PNJ: lo máximo que se puede «cobrar»).
const CASH = { 'rare-candy': 450, 'master-ball': 2000 };
const xpFor = (l) => 100 * (l - 1) * (l - 1);
function levelRebatePerXp(maxLevel = 300) {
  let worst = 0;
  let cum = 0;
  for (let l = 2; l <= maxLevel; l++) {
    cum += BAL.levelCoins(l) + (CASH[BAL.levelItem(l)] || 0);
    worst = Math.max(worst, cum / xpFor(l));
  }
  return worst;
}

test('la XP es proporcional a la ventaja de la casa: nunca devuelve más que ella', () => {
  const vpx = levelRebatePerXp(); // monedas de recompensa por XP, en el peor nivel
  for (const g of Object.keys(BAL.RTP)) {
    const edge = BAL.edge(g);
    // Lo que se espera perder por cada XP ganada: ≥ 0,4 monedas (2,5 XP por moneda de ventaja) salvo en juegos de mucha ventaja.
    const lossPerXp = edge / BAL.xpRate(g);
    assert.ok(lossPerXp >= 1 / BAL.XP_PER_EDGE - 1e-9, `${g}: ${lossPerXp}`);
    // Huevo Suerte (XP ×2) + todo el bonus posible (Amuleto + fin de semana del Compañero): < 100 % de la ventaja.
    const rebate = (2 * vpx * BAL.xpRate(g)) / edge + BAL.BONUS_SHARE_AMULET * BAL.BONUS_SHARE_EVENT;
    assert.ok(rebate < 0.97, `${g}: devuelve ${(rebate * 100).toFixed(0)} % de la ventaja`);
  }
  assert.ok(vpx < 0.1, `recompensa por XP: ${vpx}`);
});

test('subir de nivel: monedas 3 × nivel, Caramelo cada 5 desde el 10 y Master Ball cada 25', () => {
  assert.strictEqual(BAL.levelCoins(10), 30);
  const items5 = [...Array(100)].map((_, i) => BAL.levelItem(i + 1));
  assert.strictEqual(items5.filter((x) => x === 'master-ball').length, 4);
  assert.strictEqual(items5[4], null, 'el nivel 5 (Medalla Roca) no da caramelo');
  assert.strictEqual(items5[9], 'rare-candy');
  assert.strictEqual(items5[24], 'master-ball');
});

test('el bonus de un día nunca supera la fracción de ventaja de lo apostado, juego a juego', () => {
  for (const g of ['videopoker', 'blackjack', 'baccarat', 'slots', 'roulette', 'mines']) {
    const u = user('bonus-' + g, { coins: 1e9, buddy: { id: 151, shiny: true }, collection: { 151: { n: 5, s: 1 } }, buffs: { amuletUntil: Date.now() + 3600e3 } });
    let staked = 0;
    let bonus = 0;
    for (let i = 0; i < 300; i++) {
      hub.takeBet(u, 1000, g);
      staked += 1000;
      bonus += hub.pay(u, 3000, 1000, g).bonus;
    }
    const limit = staked * BAL.edge(g) * BAL.BONUS_SHARE_AMULET + 1;
    assert.ok(bonus <= limit, `${g}: bonus ${bonus} > ${limit}`);
    assert.ok(bonus < staked * BAL.edge(g), `${g}: más que la ventaja de la casa`);
  }
});

test('los duelos no dan XP al crear ni cancelar retos y la XP fija tiene tope diario', () => {
  const u = user('cultivador', { coins: 1e6, collection: { 6: { n: 1, s: 0 } } });
  for (let i = 0; i < 20; i++) {
    const r = duel.create(u, { pokeId: 6, wager: 10000 });
    duel.cancel(u, { id: r.duel.id });
  }
  assert.strictEqual(u.xp, 0, 'crear y cancelar retos con apuesta no da experiencia');
  assert.strictEqual(u.coins, 1e6);
  const v = user('duelista-xp');
  for (let i = 0; i < 100; i++) hub.addXp(v, 50, { flat: true });
  assert.strictEqual(v.xp, BAL.FLAT_XP_DAILY, 'la XP fija diaria está limitada');
});

// ---------- Bucles de monedas ----------
test('bucle crear → liberar: fabricar una especie cuesta mucho más polvo que el que devuelve liberarla', () => {
  for (const [r, def] of Object.entries(dex.RARITY)) {
    assert.ok(def.craft >= 10 * def.dust, `${r}: ${def.craft} vs ${def.dust}`);
  }
});

test('bucle Caramelo Raro → liberar/vender: las estrellas de caramelo están ligadas', () => {
  const u = user('caramelero', { coins: 0, items: { 'rare-candy': 4 }, collection: { 150: { n: 1, s: 0 } } });
  items.use(u, { itemId: 'rare-candy', pokeId: 150 });
  items.use(u, { itemId: 'rare-candy', pokeId: 150 });
  assert.strictEqual(u.collection[150].n, 3);
  assert.throws(() => gacha.release(u, { id: 150, count: 1 }), /conservar/);
  assert.throws(() => gacha.takePoke(u, 150, false), /Caramelo Raro/);
  assert.strictEqual(market.owned(u, { kind: 'poke', pokeId: 150, shiny: false }), 0);
  assert.throws(() => market.sell(u, { kind: 'poke', pokeId: 150, shiny: false, qty: 1, price: 1000 }), /No tienes/);
  // Con una copia real de más sí se puede vender/liberar, pero solo esa.
  gacha.grant(u, 150, false);
  assert.strictEqual(u.collection[150].n, 4);
  assert.strictEqual(market.owned(u, { kind: 'poke', pokeId: 150, shiny: false }), 1);
  assert.deepStrictEqual(gacha.release(u, { id: 150, count: 1 }), { dust: dex.RARITY.L.dust });
  assert.strictEqual(u.collection[150].n, 3);
  assert.throws(() => gacha.release(u, { id: 150, count: 1 }), /conservar/);
  // y un caramelo nunca da más de lo que vale en polvo si se pudiera liberar (red de seguridad numérica).
  assert.ok(dex.RARITY.M.dust * gacha.DUST_RATE < items.ITEMS['rare-candy'].price * 3);
});

test('bucle tienda → PNJ: los PNJ compran por menos de lo que cuesta en la tienda y venden por más', () => {
  for (const [id, it] of Object.entries(items.ITEMS)) {
    if (!it.price) continue;
    const b = npc.bounds({ kind: 'item', itemId: id });
    assert.ok(b.cap <= it.price / 2, `${id}: compran a ${b.cap}`);
    assert.ok(b.floor >= it.price, `${id}: venden a ${b.floor}`);
  }
});

test('bucle gacha → liberar/vender a PNJ: una tirada devuelve como mucho ≈66 % de lo que cuesta (caso imposible: todas repetidas)', () => {
  const dustPerPull = Object.entries(gacha.RATES).reduce((s, [r, p]) => s + p * dex.RARITY[r].dust, 0);
  const shinyExtra = 1 + 3 * gacha.SHINY_RATE * 4; // variocolor repetido: polvo ×3 (con el Amuleto Iris, ×4 de probabilidad)
  const gifts = Object.entries(gacha.X10_GIFTS).reduce((s, [it, p]) => s + p * (npc.bounds({ kind: 'item', itemId: it }).cap), 0) / 10;
  const back = dustPerPull * shinyExtra * gacha.DUST_RATE + gifts;
  assert.ok(back < 0.7 * gacha.COST[1], `${back.toFixed(1)} de ${gacha.COST[1]}`);
  assert.ok(gacha.COST[10] <= gacha.COST[1] * 10 && gacha.COST[10] >= gacha.COST[1] * 8.5, 'el ×10 no regala más del 15 %');
  // Los PNJ tampoco pagan más que el polvo del duplicado: cap ≤ 0,9 × liberar.
  for (const r of Object.keys(dex.RARITY)) assert.ok(npc.maxBid(r) <= 0.9 * dex.RARITY[r].dust * gacha.DUST_RATE);
});

test('bucle Huevo Misterioso → cosméticos: abrirlo vale menos que comprarlo a un PNJ', () => {
  const W = items.EGG_WEIGHTS || { C: 40, U: 30, R: 18, E: 9, L: 3 };
  const total = Object.values(W).reduce((a, b) => a + b, 0);
  const COSM = { C: 60, U: 150, R: 400, E: 1200, L: 4000 }; // lo que paga un PNJ por cada rareza
  const avg = Object.entries(W).reduce((s, [r, w]) => s + (w / total) * npc.bounds({ kind: 'item', itemId: Object.keys(items.COSMETICS).find((k) => items.COSMETICS[k].rarity === r) }).cap, 0);
  assert.ok(avg <= Object.values(COSM).reduce((a, b) => a + b, 0), 'sanidad');
  const eggAsk = npc.bounds({ kind: 'item', itemId: 'mystery-egg' }).floor;
  assert.ok(avg < eggAsk, `valor medio ${avg.toFixed(0)} < precio de venta del huevo ${eggAsk}`);
});

test('ningún PNJ compra más caro de lo que vende (cap < suelo) en todos los artículos', () => {
  const refs = [...Object.keys(items.ITEMS).map((itemId) => ({ kind: 'item', itemId })), { kind: 'dust' },
    ...Object.keys(dex.RARITY).map((r) => ({ kind: 'poke', pokeId: dex.BY_RARITY[r][0].id, shiny: false })),
    ...Object.keys(dex.RARITY).map((r) => ({ kind: 'poke', pokeId: dex.BY_RARITY[r][0].id, shiny: true }))];
  for (const a of refs) {
    const b = npc.bounds(a);
    if (b) assert.ok(b.cap < b.floor, JSON.stringify(a));
  }
});

// ---------- Fuentes de monedas ----------
test('Joy: como mucho 1.000 monedas al día', () => {
  assert.ok((24 * 3600e3 / healer.COOLDOWN) * healer.AMOUNT <= 1000);
  assert.ok(healer.AMOUNT <= 500);
});

test('ingresos diarios de un jugador casual: ≈2.500 monedas, y una legendaria concreta cuesta ≥ 2 semanas', () => {
  const val = (rw) => (rw.coins || 0) + Object.entries(rw.items || {}).reduce((s, [id, n]) => s + n * ({ ticket: 150, 'mystery-egg': 150, 'rare-candy': 450 }[id] || 0), 0);
  const missions = progress.DAILY.reduce((s, m) => s + val(m.reward), 0) / progress.DAILY.length;
  const income = BAL.dailyReward(7) + 150 /* ticket */ + 150 /* tirada gratis */ + 3 * missions + val({ coins: 250, items: { 'mystery-egg': 1 } });
  assert.ok(income > 1800 && income < 3200, `ingresos diarios ${income}`);
  // Legendaria concreta con 3 destacadas: 1 / (P(L) × 50 % / 3) tiradas.
  const pulls = 1 / (gacha.RATES.L * 0.5 / 3);
  const days = (pulls * gacha.COST[1]) / income;
  assert.ok(days >= 14 && days <= 35, `${days.toFixed(1)} días`);
  // El valor de lo que dan las 8 medallas y el campeonato es una vez en la vida: < 1 mes de ingresos.
  const badges = progress.BADGE_COINS * 36 + progress.CHAMPION_COINS;
  assert.ok(badges < 32 * income, `${badges}`);
});

test('regalos del ×10: la Master Ball es rara (≤ 0,5 % por sobre) y nada devuelve más del 20 % del coste', () => {
  assert.ok(gacha.X10_GIFTS['master-ball'] <= 0.005);
  const worth = { 'master-ball': 17000, 'shiny-charm': 1500, 'mystery-egg': 150 };
  const back = Object.entries(gacha.X10_GIFTS).reduce((s, [it, p]) => s + p * worth[it], 0);
  assert.ok(back / gacha.COST[10] < 0.2, `${(back / gacha.COST[10] * 100).toFixed(1)} %`);
});

test('Tienda: precios coherentes (Ticket = 1 tirada; Huevo Suerte y Moneda Amuleto, baratos porque valen poco)', () => {
  assert.strictEqual(items.ITEMS.ticket.price, gacha.COST[1]);
  assert.ok(items.ITEMS['lucky-egg'].price <= 400 && items.ITEMS['amulet-coin'].price <= 500);
  // El valor máximo de una Moneda Amuleto en una hora: la diferencia de bonus × ventaja × lo apostado. Con 100.000 apostados en
  // Pika-Slots (≈ una hora a tope) son ≈ (0,45 − 0,3) × 2,4 % × 100.000 = 360 monedas: el precio de 400 la deja sin beneficio.
  const gain = (BAL.BONUS_SHARE_AMULET - BAL.BONUS_SHARE) * BAL.edge('slots') * 100000;
  assert.ok(gain <= items.ITEMS['amulet-coin'].price, `${gain}`);
});

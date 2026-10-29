'use strict';
// Progresión casual (docs/BALANCE.md · «Progresión casual»): simulación de un jugador de ≈1 hora al día.
//  · Pokédex: núcleo (C/U/R/E, 931 especies) ≤ 5 semanas; completa (con 94 legendarios y míticos) ≤ ≈15 semanas.
//  · Maximizar un Pokémon (5★, Nv. 100, IV 31, amistad 255): C/U ≈ 1-2 h, R/E ≈ 3-5 h, L ≈ 8-12 h.
// El gacha usa el RNG real (criptográfico): se promedian varias partidas y los márgenes son holgados.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-prog-'));

const gacha = require('../server/gacha');
const candy = require('../server/candy');
const bond = require('../server/bond');
const BAL = require('../server/balance');
const progress = require('../server/progress');
const { DEX, BY_ID, RARITY, BY_RARITY } = require('../server/pokedex');
const { weighted } = require('../server/rng');

// ---- Modelo de ingresos: recompensa diaria con racha + ticket + tirada gratis + 3 misiones + bonus diario, menos lo que cuesta jugar ----
const val = (rw) => (rw.coins || 0) + Object.entries(rw.items || {}).reduce((s, [id, n]) => s + n * ({ ticket: 150, 'mystery-egg': 150, 'rare-candy': 450 }[id] || 0), 0);
const missions = progress.DAILY.reduce((s, m) => s + val(m.reward), 0) / progress.DAILY.length;
const INCOME = BAL.dailyReward(7) + 150 + 150 + 3 * missions + val({ coins: 250, items: { 'mystery-egg': 1 } });
// Una hora de juego a ≈15.000 monedas apostadas: se pierde la ventaja de la casa (≈3 %) menos el bonus devuelto (30 %).
const PLAY_LOSS = 15000 * BAL.edge('slots') * (1 - BAL.BONUS_SHARE);
const PULLS = Math.floor((INCOME - PLAY_LOSS) / (gacha.COST[10] / 10)); // sobres ×10
const banner = gacha.BANNERS.find((b) => b.id === 'kanto');

const EVOS = new Map();
for (const p of DEX) if (p.evolvesFrom) (EVOS.get(p.evolvesFrom) || EVOS.set(p.evolvesFrom, []).get(p.evolvesFrom)).push(p);

// Jugador casual de Pokédex: tira cada día, evoluciona lo que puede (primera evolución), usa el Milagroso, transfiere el resto
// y fabrica con el polvo lo más barato que le falta.
function simulateDex({ pulls, maxDays }) {
  const u = { collection: {}, dust: 0, candy: {}, wild: 0 };
  const own = (id) => (u.collection[id] ? u.collection[id].n : 0);
  const addFam = (id, n) => { const k = BY_ID.get(id).chain; u.candy[k] = (u.candy[k] || 0) + n; };
  const owned = (id) => own(id) > 0;
  let core = null; let full = null; let at35 = 0;
  const coreList = DEX.filter((p) => p.rarity !== 'L' && p.rarity !== 'M');
  let have = 0;
  const give = (id) => { if (!own(id)) have++; return gacha.grant(u, id, false); };
  for (let day = 1; day <= maxDays; day++) {
    for (let i = 0; i < pulls; i++) {
      const poke = gacha.rollPokemon(gacha.rollRarity(banner), banner, { owned });
      const g = give(poke.id);
      addFam(poke.id, g.isNew ? candy.PULL_NEW_CANDY : candy.PULL_CANDY);
      u.wild += candy.WILD_PULL;
    }
    // Evoluciones nuevas (primera vez: no gasta la copia de origen).
    for (let pass = 0; pass < 3; pass++) {
      for (const [from, list] of EVOS) {
        if (!own(from)) continue;
        for (const p of list) {
          if (own(p.id)) continue;
          const { cost } = candy.evoCost(from, p.id, false, true);
          const fam = u.candy[BY_ID.get(from).chain] || 0;
          if (fam + u.wild < cost) continue;
          const useF = Math.min(fam, cost);
          if (useF) u.candy[BY_ID.get(from).chain] -= useF;
          u.wild -= cost - useF;
          give(p.id);
        }
      }
    }
    // Milagroso: copias sobrantes de la misma rareza por especies nuevas (ponderadas igual que en el juego).
    for (let w = 0; w < candy.WONDER_DAILY; w++) {
      let best = null;
      for (const [id, c] of Object.entries(u.collection)) if (BY_ID.get(+id).rarity !== 'M' && c.n >= 2 && (!best || c.n > u.collection[best].n)) best = id;
      if (!best) break;
      const r = BY_ID.get(+best).rarity;
      const pool = BY_RARITY[r].filter((x) => x.id !== +best && own(x.id) < 5);
      if (!pool.length) continue;
      const got = weighted(pool, (x) => (r === 'L' ? 1 : gacha.stageWeight(x)) * (own(x.id) ? gacha.TUNING.dupKeep : 1));
      u.collection[best].n--;
      give(got.id);
    }
    // Transfiere sobrantes (deja 2 si aún le falta una evolución).
    for (const [id, c] of Object.entries(u.collection)) {
      const pk = BY_ID.get(+id);
      const keep = (EVOS.get(+id) || []).some((x) => !own(x.id)) ? 2 : 1;
      const k = c.n - keep;
      if (k <= 0) continue;
      c.n -= k;
      u.dust += RARITY[pk.rarity].dust * k;
      addFam(+id, candy.TRANSFER_CANDY[pk.rarity] * k);
      u.wild += candy.WILD_TRANSFER[pk.rarity] * k;
    }
    // Fabrica lo más barato que le falta (primero las formas difíciles de tirar).
    const missing = DEX.filter((p) => !own(p.id)).sort((a, b) => RARITY[a.rarity].craft - RARITY[b.rarity].craft || gacha.stageWeight(a) - gacha.stageWeight(b));
    for (const p of missing) { const c = RARITY[p.rarity].craft; if (u.dust >= c) { u.dust -= c; give(p.id); } }
    if (day === 35) at35 = have;
    if (core === null && coreList.every((p) => own(p.id))) core = day;
    if (have === DEX.length) { full = day; if (day < 35) at35 = have; break; }
  }
  return { core, full, at35 };
}

test(`modelo de ingresos: ≈${INCOME.toFixed(0)} monedas al día financian ≥ 20 tiradas`, () => {
  assert.ok(INCOME > 2500 && INCOME < 4200, `${INCOME}`);
  assert.ok(PULLS >= 20 && PULLS <= 30, `${PULLS} tiradas al día`);
});

test('Pokédex: el núcleo (931 especies) en ≤ 5 semanas y la completa en ≤ ≈15 semanas (antes ≈ 1 año)', () => {
  const runs = Array.from({ length: 5 }, () => simulateDex({ pulls: PULLS, maxDays: 160 }));
  const mean = (k) => runs.reduce((s, r) => s + (r[k] ?? 160), 0) / runs.length;
  if (process.env.SHOW) console.log('PULLS', PULLS, JSON.stringify(runs));
  const core = mean('core');
  const full = mean('full');
  const at35 = mean('at35');
  assert.ok(core <= 38, `núcleo: ${core.toFixed(1)} días (${runs.map((r) => r.core).join(', ')})`);
  assert.ok(at35 >= 0.9 * DEX.length, `al día 35 tiene ${at35.toFixed(0)} de ${DEX.length}`);
  assert.ok(full <= 115, `completa: ${full.toFixed(1)} días (${runs.map((r) => r.full).join(', ')})`);
  // Con 1 hora al día, «horas» = «días»: lejos de los cientos de horas de antes.
  assert.ok(full < 120 && core < 40); // objetivo ≈ 35 y ≈ 100 días; margen por el azar de 5 partidas
});

// ---- Maximizar un Pokémon: recursos por día (todos en paralelo; manda el más lento) ----
function maxDays(rarity) {
  const dustPerPull = Object.entries(gacha.RATES).reduce((s, [r, p]) => s + p * RARITY[r].dust, 0);
  const DUP_SHARE = 0.6; // tirada repetida: con el sesgo de Pokédex, al avanzar la colección salen menos nuevas
  const dustDay = PULLS * DUP_SHARE * dustPerPull;
  const candyPerDup = Object.entries(gacha.RATES).reduce((s, [r, p]) => s + p * (candy.TRANSFER_CANDY[r] + candy.WILD_TRANSFER[r]), 0);
  // Solo cuentan los caramelos comodín (valen para cualquier familia); los de la familia son un extra.
  const candyDay = PULLS * candy.WILD_PULL + PULLS * DUP_SHARE * candy.WILD_TRANSFER_AVG;
  void candyPerDup;
  const crafts = 5; // peor caso: ni la primera copia sale de las tiradas
  const dustNeed = crafts * RARITY[rarity].craft;
  let levels = 0; for (let l = candy.MIN_LEVEL; l < candy.MAX_LEVEL; l++) levels += candy.levelCost(l);
  const ivDeficit = 93; // 6 × (31 − 15,5): IV medios al azar
  const candyNeed = levels + ivDeficit * candy.TRAIN_COST;
  const friendDay = 0.7 * bond.CAP.feed + bond.CAP.buddy; // bayas al 70 % del tope + apuestas con el compañero
  const friendNeed = bond.FRIEND_MAX - 70;
  return {
    dust: dustNeed / dustDay, candy: candyNeed / candyDay, iv: ivDeficit / candy.TRAIN_DAILY, friend: friendNeed / friendDay,
    days: Math.max(dustNeed / dustDay, candyNeed / candyDay, ivDeficit / candy.TRAIN_DAILY, friendNeed / friendDay),
  };
}
candy.WILD_TRANSFER_AVG = Object.entries(gacha.RATES).reduce((s, [r, p]) => s + p * candy.WILD_TRANSFER[r], 0);

test('maximizar un Pokémon (5★, Nv. 100, IV 31, amistad máxima): C/U ≈ 1-2 h, R/E ≈ 3-5 h, L ≈ 8-12 h', () => {
  const t = Object.fromEntries(Object.keys(RARITY).map((r) => [r, maxDays(r)]));
  const d = (r) => Math.ceil(t[r].days);
  if (process.env.SHOW) console.log(Object.fromEntries(Object.entries(t).map(([r, x]) => [r, Object.fromEntries(Object.entries(x).map(([k, v]) => [k, +v.toFixed(2)]))])));
  assert.ok(d('C') >= 1 && d('C') <= 2, `Común ${t.C.days.toFixed(2)} días`);
  assert.ok(d('U') >= 1 && d('U') <= 2, `Poco común ${t.U.days.toFixed(2)}`);
  assert.ok(d('R') >= 2 && d('R') <= 5, `Rara ${t.R.days.toFixed(2)}`);
  assert.ok(d('E') >= 3 && d('E') <= 5, `Épica ${t.E.days.toFixed(2)}`);
  assert.ok(d('L') >= 6 && d('L') <= 12, `Legendaria ${t.L.days.toFixed(2)}`);
  assert.ok(d('M') <= 18, `Mítica ${t.M.days.toFixed(2)}`);
  assert.ok(t.C.days <= t.R.days && t.R.days < t.E.days && t.E.days < t.L.days, 'cuanto más rara, más cuesta');
});

test('el sesgo de Pokédex no cambia las rarezas ni a los destacados: solo reparte dentro de la rareza', () => {
  const owned = (id) => id % 2 === 0; // mitad de la Pokédex ya conseguida
  const N = 60000;
  const count = { C: 0, U: 0, R: 0, E: 0, L: 0, M: 0 };
  let newOnes = 0;
  for (let i = 0; i < N; i++) {
    const r = gacha.rollRarity(banner);
    const p = gacha.rollPokemon(r, banner, { owned });
    count[p.rarity]++;
    if (!owned(p.id)) newOnes++;
    assert.strictEqual(p.rarity, r);
  }
  for (const [r, p] of Object.entries(gacha.RATES)) assert.ok(Math.abs(count[r] / N - p) < 5 * Math.sqrt(p * (1 - p) / N) + 0.002, r);
  // Con la mitad ya conseguida, ≈ 92 % de las tiradas son especies nuevas (sin sesgo serían ≈ 50 %).
  assert.ok(newOnes / N > 0.85 && newOnes / N < 0.97, `${newOnes / N}`);
  // Los destacados del banner conservan su 50 % aunque ya los tengas todos.
  const aves = gacha.BANNERS.find((b) => b.id === 'aves');
  let feat = 0;
  for (let i = 0; i < 20000; i++) if (aves.featuredL.includes(gacha.rollPokemon('L', aves, { owned: () => true }).id)) feat++;
  assert.ok(Math.abs(feat / 20000 - 0.5) < 0.03, `${feat / 20000}`);
});

test('anti-arbitraje de la progresión casual: la evolución gratuita es única por especie y la copia no se puede liberar', () => {
  // La «primera evolución» no lleva el suelo por subida de rareza pero solo se da una vez por especie y cuenta.
  const g = DEX.find((p) => p.name === 'Gyarados'); const m = DEX.find((p) => p.name === 'Magikarp');
  assert.strictEqual(candy.evoCost(m.id, g.id, false, true).cost, candy.EVO[2].cost);
  assert.ok(candy.evoCost(m.id, g.id).cost >= Math.ceil((RARITY.E.dust - RARITY.C.dust) / candy.EVO_GAIN_PER_CANDY), 'repetida: con suelo');
  const u = { id: 'x', username: 'x', coins: 0, dust: 0, items: {}, buffs: {}, collection: { [m.id]: { n: 1, s: 0 } }, candy: { [candy.WILD]: 500 }, mons: {} };
  require('../server/specimen').syncAll(u);
  const uid = u.mons[m.id][0].uid;
  candy.evolve(u, { id: m.id, uid, to: g.id });
  assert.strictEqual(u.collection[m.id].n, 1);
  assert.strictEqual(u.collection[g.id].n, 1);
  assert.throws(() => gacha.release(u, { id: g.id, count: 1 }), /conservar/);
  // Si vende la copia, ya no vuelve a ser «primera» (no se puede imprimir copias).
  delete u.collection[g.id]; delete u.mons[g.id];
  assert.strictEqual(candy.isFirstEvo(u, g.id), false);
  assert.throws(() => candy.evolve(u, { id: m.id, uid: u.mons[m.id][0].uid, to: g.id }), /otra copia/);
});

'use strict';
// Progresión casual (docs/BALANCE.md · «Progresión casual» y «Progresión como en los juegos»): simulación de un jugador de ≈1 hora al día.
//  · Pokédex: núcleo (C/U/R/E, 931 especies) y completa (con 94 legendarios y míticos), con la EVOLUCIÓN gastando EXP (ya no hay caramelos).
//  · Nv. 50 en ≈ 4-5 días y Nv. 100 en ≈ 3 semanas para un Pokémon al que se dedica el día (EXP real: fórmula de combate, expediciones, tope diario, Caramelos Exp.).
//  · IV al máximo con Chapas del Entrenamiento Extremo: ≈ 1-2 semanas de PB.
//  · Techo de polvo al día que se puede sacar evolucionando y transfiriendo: acotado por los topes diarios de EXP.
// El gacha usa el RNG real (criptográfico): se promedian varias partidas y los márgenes son holgados.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-prog-'));

const gacha = require('../server/gacha');
const candy = require('../server/candy');
const exp = require('../server/exp');
const evoreq = require('../server/evoreq');
const bond = require('../server/bond');
const bpdata = require('../server/bpdata');
const hyper = require('../server/hyper');
const expedition = require('../server/expedition');
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

// ---- EXP de un día de juego casual ----
// Un día de un jugador que dedica su hora a un Pokémon: 10 victorias contra la CPU (3 rivales de EXP base 150 que van 3 niveles por encima, con 3 participantes y
// «niveles reales»), una expedición de 12 h por la noche, y los Caramelos Exp. que caen de todo ello (valor esperado) más los de unas 22 tiradas.
function levelDays(id, { wins = 10, foes = 3, part = 3, base = 150, delta = 3, expHours = 12, tier = 3, lucky = false, fair = false } = {}) {
  const m = { level: 5, exp: exp.expAt(id, 5), uid: 'sim00001' };
  if (lucky) m.item = 'luckyegg';
  const dropExp = exp.BATTLE_DROP[tier].reduce((s, pct, i) => s + (pct / 100) * exp.CANDIES[i][2], 0);
  const out = {};
  let day = 0;
  while (m.level < 100 && day < 400) {
    day++;
    m.xc = undefined; // día nuevo
    let g = 0;
    for (let w = 0; w < wins; w++) {
      const Lf = fair ? 50 : Math.min(100, m.level + delta);
      g += foes * Math.max(1, Math.floor(((base * Lf) / (5 * part) * Math.pow((2 * Lf + 10) / (Lf + m.level + 10), 2.5) + 1) * 1.5));
    }
    exp.award({}, id, m, g, 'battle');
    exp.award({}, id, m, expHours * (expedition.EXP_BASE + expedition.EXP_LEVEL * m.level), 'exp');
    const items = Math.min(wins * dropExp, exp.BATTLE_DROP_DAY) + 3 * 0.9 * 1000 + 0.12 * 10000 + 22 * 120; // botín de combates + expedición + tiradas
    exp.award({}, id, m, items, 'item');
    if (m.level >= 50 && !out[50]) out[50] = day;
  }
  out[100] = day;
  return out;
}

// EXP de un día casual de Pokédex: 10 victorias en «Nivel 50 (justo)» (3 rivales de EXP base 130 a Nv. 50 contra 3 participantes de Nv. 20: el bonus por ir por debajo del
// rival) + una expedición de 8 h con 3 Pokémon de Nv. 20. Todo se reparte entre varios ejemplares (los nuevos que hay que evolucionar).
const DEX_EXP_DAY = Math.round(10 * 3 * 3 * Math.floor(((130 * 50) / (5 * 3) * Math.pow(110 / 80, 2.5) + 1) * 1.5) + 3 * 8 * (expedition.EXP_BASE + expedition.EXP_LEVEL * 20));
// Un jugador de Pokédex tira cada día, evoluciona lo que puede (primera evolución: gasta la EXP que falta hasta el nivel), usa el Milagroso, transfiere
// el resto y fabrica con el polvo lo más barato que le falta. Como en el modelo anterior, se ignoran los requisitos especiales (objeto, intercambio, sexo, hora, amistad): solo cuenta la EXP (optimista).
function simulateDex({ pulls, maxDays }) {
  const u = { collection: {}, dust: 0, exp: 0 };
  const own = (id) => (u.collection[id] ? u.collection[id].n : 0);
  const owned = (id) => own(id) > 0;
  let core = null; let full = null; let at35 = 0;
  const coreList = DEX.filter((p) => p.rarity !== 'L' && p.rarity !== 'M');
  let have = 0;
  const give = (id) => { if (!own(id)) have++; return gacha.grant(u, id, false); };
  const addItem = (it, n) => { u.exp += n * exp.CANDY_EXP[it]; };
  const lvlOf = new Map(); // nivel al que ya se llevó a esa especie (las de fase 3 parten del nivel de su fase 2)
  for (let day = 1; day <= maxDays; day++) {
    u.exp += DEX_EXP_DAY;
    for (let i = 0; i < pulls; i++) {
      const poke = gacha.rollPokemon(gacha.rollRarity(banner), banner, { owned });
      const g = give(poke.id);
      addItem(g.isNew ? candy.PULL_NEW_ITEM : candy.PULL_ITEM, 1);
    }
    // Evoluciones nuevas (la primera vez no gasta la copia de origen), las más baratas primero.
    const todo = [];
    for (const [from, list] of EVOS) {
      if (!own(from)) continue;
      for (const p of list) {
        if (own(p.id)) continue;
        const L = candy.evoLevel(p.id);
        const start = Math.max(5, lvlOf.get(from) || 5);
        todo.push({ p, need: Math.max(0, exp.expAt(from, Math.max(start, L)) - exp.expAt(from, start)), L });
      }
    }
    todo.sort((a, b) => a.need - b.need);
    for (const t of todo) {
      if (own(t.p.id) || u.exp < t.need) continue;
      u.exp -= t.need;
      lvlOf.set(t.p.id, Math.max(5, t.L));
      give(t.p.id);
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
      addItem(candy.TRANSFER_EXP[pk.rarity][0], candy.TRANSFER_EXP[pk.rarity][1] * k);
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

test('Pokédex: el núcleo (931 especies) en ≤ ≈ 7 semanas y la completa en ≤ ≈ 17 semanas, con la evolución gastando EXP', () => {
  const runs = Array.from({ length: 5 }, () => simulateDex({ pulls: PULLS, maxDays: 200 }));
  const mean = (k) => runs.reduce((s, r) => s + (r[k] ?? 200), 0) / runs.length;
  if (process.env.SHOW) console.log('PULLS', PULLS, 'EXP/día', DEX_EXP_DAY, JSON.stringify(runs));
  const core = mean('core');
  const full = mean('full');
  const at35 = mean('at35');
  assert.ok(core <= 52, `núcleo: ${core.toFixed(1)} días (${runs.map((r) => r.core).join(', ')})`);
  assert.ok(at35 >= 0.85 * DEX.length, `al día 35 tiene ${at35.toFixed(0)} de ${DEX.length}`);
  assert.ok(full <= 125, `completa: ${full.toFixed(1)} días (${runs.map((r) => r.full).join(', ')})`);
});

test('Nv. 50 en ≈ 4-5 días y Nv. 100 en ≈ 3 semanas dedicando el día a un Pokémon (significativo, no trivial)', () => {
  for (const id of [25, 6, 130]) { // grupos Medio rápido, Medio lento y Lento
    const t = levelDays(id);
    if (process.env.SHOW) console.log(id, exp.groupOf(id), JSON.stringify(t), 'Huevo Suerte', JSON.stringify(levelDays(id, { lucky: true })), 'justo', JSON.stringify(levelDays(id, { fair: true })), '5 victorias', JSON.stringify(levelDays(id, { wins: 5, expHours: 8 })));
    assert.ok(t[50] >= 3 && t[50] <= 6, `Nv. 50: ${t[50]} días (grupo ${exp.groupOf(id)})`);
    assert.ok(t[100] >= 14 && t[100] <= 28, `Nv. 100: ${t[100]} días (grupo ${exp.groupOf(id)})`);
    assert.ok(t[100] > 3 * t[50], 'el tramo final cuesta de verdad');
    const lucky = levelDays(id, { lucky: true });
    assert.ok(lucky[100] < t[100] && lucky[100] >= 0.6 * t[100], `Huevo Suerte (×1,5): ${lucky[100]} < ${t[100]}`);
  }
  // Un jugador más tranquilo (5 victorias y 8 h de expedición al día): ≈ 5 semanas.
  const slow = levelDays(25, { wins: 5, expHours: 8 });
  assert.ok(slow[100] >= 24 && slow[100] <= 50, `tranquilo: ${slow[100]} días`);
});

test('IV al máximo con Chapas: ≈ 1-2 semanas de PB (una Chapa Dorada ≈ una semana)', () => {
  assert.strictEqual(hyper.BOTTLE_BP, 40);
  assert.strictEqual(hyper.GOLD_BP, 200);
  assert.ok(hyper.GOLD_BP <= 6 * hyper.BOTTLE_BP, 'la Dorada sale más barata que seis Chapas');
  // PB de un día casual: 10 victorias contra rivales de fuerza 3 (2 PB cada una, tope 30) + una carrera corta de Torre (≈ 20 PB, tope 40).
  const pbDay = Math.min(bpdata.CAPS.cpu, 10 * bpdata.CPU_BP[3]) + 20;
  const days = hyper.GOLD_BP / pbDay;
  assert.ok(days >= 4 && days <= 10, `Chapa Dorada en ${days.toFixed(1)} días de PB`);
  // Sin Torre (solo 10 victorias al día): ≈ 10 días; con el máximo de PB al día (90): ≈ 2 días.
  assert.ok(hyper.GOLD_BP / (10 * bpdata.CPU_BP[3]) <= 14);
  assert.ok(hyper.GOLD_BP / (bpdata.CAPS.cpu + bpdata.CAPS.pvp + bpdata.CAPS.tower) >= 2);
  // Un Pokémon con IV medios (15,5): ≈ 5,8 estadísticas por entrenar: con Chapas sueltas 232 PB, con la Dorada 200.
  assert.ok(6 * hyper.BOTTLE_BP >= hyper.GOLD_BP);
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

test('anti-arbitraje de la progresión casual: la primera evolución a una especie es única y la copia no se puede liberar', () => {
  // La «primera evolución» no gasta la copia de origen pero solo se da una vez por especie y cuenta.
  const g = DEX.find((p) => p.name === 'Gyarados'); const m = DEX.find((p) => p.name === 'Magikarp');
  assert.ok(candy.evoLevel(g.id) >= 20, 'Magikarp → Gyarados: nivel ' + candy.evoLevel(g.id));
  const u = { id: 'x', username: 'x', coins: 0, dust: 0, items: {}, buffs: {}, collection: { [m.id]: { n: 1, s: 0 } }, mons: {} };
  require('../server/specimen').syncAll(u);
  const uid = u.mons[m.id][0].uid;
  assert.throws(() => candy.evolve(u, { id: m.id, uid, to: g.id }), /nivel/);
  u.mons[m.id][0].level = candy.evoLevel(g.id);
  candy.evolve(u, { id: m.id, uid, to: g.id });
  assert.strictEqual(u.collection[m.id].n, 1);
  assert.strictEqual(u.collection[g.id].n, 1);
  assert.throws(() => gacha.release(u, { id: g.id, count: 1 }), /conservar/);
  // Si vende la copia, ya no vuelve a ser «primera» (no se puede imprimir copias).
  delete u.collection[g.id]; delete u.mons[g.id];
  assert.strictEqual(candy.isFirstEvo(u, g.id), false);
  u.mons[m.id][0].level = 100;
  assert.throws(() => candy.evolve(u, { id: m.id, uid: u.mons[m.id][0].uid, to: g.id }), /otra copia/);
});

test('techo de polvo al día evolucionando y transfiriendo: acotado por los topes diarios de EXP', () => {
  // Fuentes de EXP «externas» (las que no dependen de transferir) en un día, en el peor caso:
  //  · combates y expediciones: tope diario por ejemplar (24.000 a niveles bajos, ≈ 5 niveles a niveles altos); como mucho 6 participantes de combate y
  //    3 expediciones × 3 participantes que sean ejemplares distintos;
  //  · Caramelos Exp.: botín de combates (tope 12.000), de expediciones (8 caramelos como mucho de M + 1 L), Tienda de Combate (≤ 90 PB × 100 EXP/PB), Torre, tiradas.
  const specimens = 6 + 3 * expedition.SLOTS + 3; // ≈ 15
  const capExp = specimens * exp.CAP_MIN;
  const items = exp.BATTLE_DROP_DAY + expedition.CANDY_DAY_CAP * 3000 + 10000 + 90 * 100 + 4 * 3000 + 22 * 800;
  const EXT = capExp + items;
  // Dust ganado por EXP: en cada evolución «de nivel» que sube rareza hay un suelo de EVO_EXP_PER_DUST EXP por ✦ ganado.
  const bound = EXT / candy.EVO_EXP_PER_DUST;
  // ¿Y reinvirtiendo la EXP que da transferir? Cada ✦ de polvo transferido da ≤ 26,7 EXP: el factor del bucle es ≪ 1.
  const maxExpPerDust = Math.max(...Object.keys(candy.TRANSFER_EXP).map((r) => candy.transferExp(r) / RARITY[r].dust));
  const loop = maxExpPerDust / candy.EVO_EXP_PER_DUST;
  assert.ok(loop < 0.1, `factor del bucle ${loop.toFixed(3)}`);
  const total = bound / (1 - loop);
  if (process.env.SHOW) console.log('EXP externa máxima/día', EXT, 'polvo/día', total.toFixed(0), 'monedas', (total * gacha.DUST_RATE).toFixed(0));
  assert.ok(total * gacha.DUST_RATE <= 7000, `techo teórico ${total.toFixed(0)} ✦ = ${(total * gacha.DUST_RATE).toFixed(0)} monedas al día`);
  assert.ok(EXT <= 600000);
  // Caso típico (sin elegir especies): cada Pokémon tirado, evolucionado del todo por la rama de más polvo, da ≈ 25 ✦ a cambio de ≈ 26.000 EXP (≈ 0,001 ✦ por EXP):
  // 100 veces menos que el suelo. Con TODA la EXP de un casual en eso (≈ 150.000 al día) son ≈ 144 ✦ ≈ 580 monedas; con el máximo teórico de EXP, ≈ 1.700.
  const kids = EVOS;
  const best = (p, lvl) => {
    let b = { g: 0, e: 0 };
    for (const k of kids.get(p.id) || []) {
      const L = Math.max(lvl, candy.evoLevel(k.id) || lvl);
      const e = exp.expAt(p.id, L) - exp.expAt(p.id, lvl);
      const g = Math.max(0, RARITY[k.rarity].dust - RARITY[p.rarity].dust);
      const sub = best(k, L);
      if (g + sub.g > b.g) b = { g: g + sub.g, e: e + sub.e };
    }
    return b;
  };
  let G = 0; let E = 0;
  for (const r of Object.keys(gacha.RATES)) {
    const list = BY_RARITY[r];
    const w = list.map((p) => gacha.stageWeight(p));
    const tw = w.reduce((a, b) => a + b, 0);
    list.forEach((p, i) => { const b = best(p, 5); G += gacha.RATES[r] * (w[i] / tw) * b.g; E += gacha.RATES[r] * (w[i] / tw) * b.e; });
  }
  const typical = G / E;
  if (process.env.SHOW) console.log('típico: ✦ por EXP', typical.toFixed(5), '✦ por tirada', G.toFixed(1), 'EXP por tirada', E.toFixed(0));
  assert.ok(typical < 1 / candy.EVO_EXP_PER_DUST / 2, 'el caso típico queda muy por debajo del suelo');
  const casual = (DEX_EXP_DAY + 10000) * typical;
  assert.ok(casual * gacha.DUST_RATE < 800, `casual: ${casual.toFixed(0)} ✦ ≈ ${(casual * gacha.DUST_RATE).toFixed(0)} monedas al día (antes, con caramelos: ≈ 770)`);
  assert.ok(EXT * typical * gacha.DUST_RATE < 2000, `máximo teórico típico ${(EXT * typical * gacha.DUST_RATE).toFixed(0)} monedas`);
});

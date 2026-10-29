'use strict';
// Fase B5 «Criadero»: deja 2 Pokémon compatibles (comparten tipo, o uno es Ditto) y cada 6 h (4 h si son de la misma especie)
// aparece un huevo. Recogerlo cuesta una tarifa (sumidero de monedas, motivo 'daycare') y eclosiona con pasos: 1 paso por cada
// 100 monedas apostadas (o, a cambio de esperar, 12 h). Herencia: 3 IV de los padres, naturaleza de un padre con 50 %.
// Variocolor: 1/128 (1/64 si algún padre lo es). Sin legendarios, míticos ni especies cuya forma base sea L/M.
// La tarifa es siempre ≥ 1,2 × lo máximo que se puede sacar vendiendo/liberando al bebé (con el sesgo del variocolor), así que
// criar nunca da más monedas de las que cuesta. El bebé entra como cualquier Pokémon nuevo (Pokédex, +3 caramelos de familia).
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const gacha = require('./gacha');
const specimen = require('./specimen');
const { DEX, BY_ID, RARITY } = require('./pokedex');
const { rand, pick, shuffle } = require('./rng');

const HOUR = 3600 * 1000;
const DITTO = 132;
const HOURS_MIXED = 6;
const HOURS_SAME = 4;
const MAX_EGGS = 2; // huevos recogidos y sin eclosionar a la vez
const PAIRS = 1;
const PAIR2_LEVEL = 20; // nivel de entrenador para la segunda pareja
const WAGER_PER_STEP = 100;
const FALLBACK_MS = 12 * HOUR;
const NEED_STEPS = { C: 50, U: 70, R: 100, E: 150 };
const INHERIT_IVS = 3;
const NATURE_INHERIT = 0.5;
const SHINY_BASE = 1 / 128;
const SHINY_PARENT = 1 / 64; // «Método Masuda» simplificado: algún padre variocolor
const BABY_CANDY = 3;
const FEE_MIN = 200;
const FEE_MARGIN = 1.2;
const HA_INHERIT = 0.6; // como en los juegos: si la madre (el padre no Ditto) tiene habilidad oculta, el bebé la hereda el 60 % de las veces
const SHINY_SELL_MULT = 3; // un variocolor se libera/vende por 3 × (ver npc.bounds)

const maxPairs = (u) => (u.level >= PAIR2_LEVEL ? PAIRS + 1 : PAIRS);
const careOf = (u) => (u.daycare ||= { pairs: [], eggs: [], wager: 0 });
const fixed = (id) => { const r = BY_ID.get(id).rarity; return r === 'L' || r === 'M'; };

// Forma base (primera fase) de la familia de un Pokémon.
const BASE = new Map();
for (const p of DEX) if (!p.evolvesFrom && !BASE.has(p.chain)) BASE.set(p.chain, p);
const baseOf = (id) => BASE.get(BY_ID.get(id).chain) || BY_ID.get(id);

// Lo máximo que se recupera de un bebé normal: el polvo de liberar a cambio de monedas (= tope de compra de un PNJ).
const resaleCap = (rarity) => RARITY[rarity].dust * gacha.DUST_RATE;
// Esperanza del valor de reventa: variocolor con probabilidad `SHINY_PARENT` como cota alta.
const expectedResale = (rarity) => resaleCap(rarity) * (1 + (SHINY_SELL_MULT - 1) * SHINY_PARENT);
const feeFor = (rarity) => Math.max(FEE_MIN, Math.ceil((FEE_MARGIN * expectedResale(rarity)) / 5) * 5);
const needFor = (rarity) => NEED_STEPS[rarity] || 150;

// Comprueba la pareja y devuelve { ok, msg, baby, hours, fee }.
function check(a, b) {
  if (!a || !b) return { ok: false, msg: 'Elige dos Pokémon para el Criadero.' };
  if (a.m.uid === b.m.uid) return { ok: false, msg: 'Necesito dos Pokémon distintos.' };
  const pa = BY_ID.get(a.id);
  const pb = BY_ID.get(b.id);
  if (fixed(a.id) || fixed(b.id)) return { ok: false, msg: 'Los legendarios y míticos no crían. ¡Son demasiado especiales!' };
  const dA = a.id === DITTO;
  const dB = b.id === DITTO;
  if (dA && dB) return { ok: false, msg: 'Dos Ditto no hacen huevos: necesito un Pokémon de verdad.' };
  if (!dA && !dB && !pa.types.some((t) => pb.types.includes(t))) return { ok: false, msg: 'No se llevan muy bien… Necesitan compartir algún tipo (o que uno sea Ditto).' };
  let mother = dA ? pb : dB ? pa : null;
  if (!mother) {
    if (a.m.gender === 'F' && b.m.gender !== 'F') mother = pa;
    else if (b.m.gender === 'F' && a.m.gender !== 'F') mother = pb;
    else mother = pa; // sin sexos distintos, la primera plaza
  }
  const baby = baseOf(mother.id);
  if (baby.rarity === 'L' || baby.rarity === 'M') return { ok: false, msg: 'De esa familia no puede salir un huevo.' };
  const hours = a.id === b.id ? HOURS_SAME : HOURS_MIXED;
  return { ok: true, msg: a.id === b.id ? '¡Son de la misma especie y se llevan muy bien!' : '¡Parece que se llevan muy bien!', baby: baby.id, hours, fee: feeFor(baby.rarity) };
}

// La especie del bebé no depende del azar: la madre es la hembra, o la de la primera plaza.
function resolve(u, ref) {
  const m = specimen.find(u, { id: ref && ref.id, uid: ref && ref.uid });
  return { id: Number(ref.id), m };
}
function preview(u, p) {
  const a = resolve(u, p.a);
  const b = resolve(u, p.b);
  return check(a, b);
}
function deposit(u, p) {
  if (u.npc) throw new Error('Los comerciantes NPC no crían.');
  const care = careOf(u);
  while (care.pairs.length < maxPairs(u)) care.pairs.push(null);
  const slot = p.slot === undefined ? care.pairs.slice(0, maxPairs(u)).findIndex((x) => !x) : Number(p.slot);
  if (slot === -1) throw new Error('Esa plaza del Criadero ya está ocupada: no queda ninguna libre.');
  if (!Number.isInteger(slot) || slot < 0 || slot >= maxPairs(u)) throw new Error(`Solo tienes ${maxPairs(u)} pareja${maxPairs(u) > 1 ? 's' : ''} en el Criadero${u.level < PAIR2_LEVEL ? ` (la segunda, en el nivel ${PAIR2_LEVEL})` : ''}.`);
  if (care.pairs[slot]) throw new Error('Esa plaza del Criadero ya está ocupada.');
  const a = resolve(u, p.a);
  const b = resolve(u, p.b);
  specimen.assertFree(a.m, BY_ID.get(a.id).name);
  specimen.assertFree(b.m, BY_ID.get(b.id).name);
  const r = check(a, b);
  if (!r.ok) throw new Error(r.msg);
  const now = Date.now();
  care.pairs[slot] = { a: { id: a.id, uid: a.m.uid }, b: { id: b.id, uid: b.m.uid }, baby: r.baby, since: now, readyAt: now + r.hours * HOUR, hours: r.hours };
  a.m.away = 'care';
  b.m.away = 'care';
  db.save();
  return view(u);
}

function lookup(u, t) { return ((u.mons && u.mons[t.id]) || []).find((m) => m.uid === t.uid) || null; }
function free(u, pair) {
  for (const t of [pair.a, pair.b]) { const m = lookup(u, t); if (m && m.away === 'care') delete m.away; }
}

function withdraw(u, p) {
  const care = careOf(u);
  const slot = Number(p.slot);
  const pair = care.pairs[slot];
  if (!pair) throw new Error('No hay nadie en esa plaza.');
  free(u, pair);
  care.pairs[slot] = null;
  db.save();
  return view(u);
}

// «Madre» de la pareja: el que no es Ditto; si ninguno lo es, la hembra (o la primera plaza).
function motherOf(ma, mb, ida, idb) {
  if (ida === DITTO) return mb;
  if (idb === DITTO) return ma;
  if (ma.gender === 'F' && mb.gender !== 'F') return ma;
  if (mb.gender === 'F' && ma.gender !== 'F') return mb;
  return ma;
}
// ¿Hereda el bebé la habilidad oculta? Solo si la madre la tiene y la especie del bebé tiene una.
function inheritsHa(mother, babyId, roll = rand()) {
  return !!(mother && mother.ha && require('./moves').abilitiesOf(babyId).hidden && roll < HA_INHERIT);
}

// Movimientos huevo del bebé que cualquiera de los dos padres tiene aprendidos (regla de la 6.ª generación en adelante).
function inheritedEggMoves(babyId, parents) {
  const mv = require('./moves');
  return mv.eggMoves(babyId).filter((x) => parents.some((p) => Array.isArray(p.learned) && p.learned.includes(x))).slice(0, 4);
}

// Genera el huevo (la herencia queda decidida al recogerlo: los padres pueden retirarse después).
function makeEgg(u, pair) {
  const ma = lookup(u, pair.a);
  const mb = lookup(u, pair.b);
  if (!ma || !mb) return null;
  const baby = BY_ID.get(pair.baby);
  const parents = [ma, mb];
  const ivs = {};
  const idx = shuffle([0, 1, 2, 3, 4, 5]).slice(0, INHERIT_IVS);
  for (const i of idx) ivs[i] = pick(parents).ivs[i];
  const shinyP = parents.some((m) => m.shiny) ? SHINY_PARENT : SHINY_BASE;
  const now = Date.now();
  return {
    id: crypto.randomBytes(4).toString('hex'), species: baby.id, need: needFor(baby.rarity), steps: 0, born: now, hatchAt: now + FALLBACK_MS,
    ivs, nature: rand() < NATURE_INHERIT ? pick(parents).nature : null, shiny: rand() < shinyP, ha: inheritsHa(motherOf(ma, mb, pair.a.id, pair.b.id), baby.id), moves: inheritedEggMoves(baby.id, [ma, mb]),
  };
}

function collect(u, p) {
  const care = careOf(u);
  const slot = Number(p.slot);
  const pair = care.pairs[slot];
  if (!pair) throw new Error('No hay nadie en esa plaza.');
  const now = Date.now();
  if (now < pair.readyAt) throw new Error('Todavía no hay huevo.');
  if (care.eggs.length >= MAX_EGGS) throw new Error(`Ya llevas ${MAX_EGGS} huevos: eclosiona alguno primero.`);
  const baby = BY_ID.get(pair.baby);
  const fee = feeFor(baby.rarity);
  if (u.coins < fee) throw new Error(`La tarifa del Criadero son ${fee} monedas.`);
  const egg = makeEgg(u, pair);
  if (!egg) { free(u, pair); care.pairs[slot] = null; db.save(); throw new Error('Falta uno de los padres: la pareja se ha retirado del Criadero.'); }
  u.coins -= fee;
  hub.ledger(u, -fee, 'daycare', baby.name);
  care.eggs.push(egg);
  pair.readyAt = now + pair.hours * HOUR;
  db.save();
  return { ...view(u), fee };
}

// Gancho de hub.takeBet: 1 paso por cada 100 monedas apostadas (los duelos entre jugadores no cuentan).
function onBet(user, amount, game) {
  const care = user.daycare;
  if (!care || !care.eggs.length || user.npc || game === 'duel') return;
  care.wager = (care.wager || 0) + amount;
  const steps = Math.floor(care.wager / WAGER_PER_STEP);
  if (!steps) return;
  care.wager -= steps * WAGER_PER_STEP;
  for (const e of care.eggs) e.steps = Math.min(e.need, e.steps + steps);
}

function hatch(u, p) {
  const care = careOf(u);
  const i = care.eggs.findIndex((e) => e.id === String(p.id));
  if (i < 0) throw new Error('Ese huevo no existe.');
  const egg = care.eggs[i];
  const now = Date.now();
  if (egg.steps < egg.need && now < egg.hatchAt) throw new Error('Todavía no está listo para eclosionar.');
  const id = egg.species;
  const before = new Set(specimen.sync(u, id).map((m) => m.uid));
  const g = gacha.grant(u, id, egg.shiny);
  const arr = specimen.sync(u, id);
  const baby = arr.find((m) => !before.has(m.uid)) || null;
  if (baby) {
    for (const [k, v] of Object.entries(egg.ivs)) baby.ivs[Number(k)] = v;
    if (egg.nature) baby.nature = egg.nature;
    const ab = require('./abilities');
    ab.resolve(id, baby); // fija la versión de habilidades antes de marcar la oculta
    if (egg.ha) { baby.ha = true; ab.resolve(id, baby); } // habilidad oculta heredada
    for (const mvId of egg.moves || []) { try { require('./moves').teach(id, baby, mvId); } catch { /* ya lo conocía */ } } // movimientos huevo
  }
  require('./candy').addCandy(u, id, BABY_CANDY);
  care.eggs.splice(i, 1);
  const rarity = BY_ID.get(id).rarity;
  if (egg.shiny && rarity !== 'C') hub.feed('gacha', `🥚✨ ${u.username} sacó un ${BY_ID.get(id).name} VARIOCOLOR del Criadero`, { pokeId: id, shiny: true });
  db.save();
  return { ...view(u), hatched: { id, uid: baby ? baby.uid : null, shiny: !!egg.shiny, isNew: g.isNew, dust: g.dust, candy: BABY_CANDY, nature: baby ? baby.nature : null, ivs: baby ? baby.ivs : null } };
}

function view(u) {
  const care = careOf(u);
  const now = Date.now();
  const n = maxPairs(u);
  while (care.pairs.length < n) care.pairs.push(null);
  return {
    now, maxPairs: n, pair2Level: PAIR2_LEVEL,
    pairs: care.pairs.slice(0, n).map((pr) => (pr ? { a: pr.a, b: pr.b, baby: pr.baby, readyAt: pr.readyAt, hours: pr.hours, ready: now >= pr.readyAt, fee: feeFor(BY_ID.get(pr.baby).rarity),
      shiny: [lookup(u, pr.a), lookup(u, pr.b)].map((m) => !!(m && m.shiny)) } : null)),
    eggs: care.eggs.map((e) => ({ id: e.id, species: e.species, need: e.need, steps: e.steps, hatchAt: e.hatchAt, ready: e.steps >= e.need || now >= e.hatchAt })),
    maxEggs: MAX_EGGS,
  };
}

const STATIC = { hours: [HOURS_MIXED, HOURS_SAME], maxEggs: MAX_EGGS, pair2Level: PAIR2_LEVEL, wagerPerStep: WAGER_PER_STEP, feeMin: FEE_MIN, fees: Object.fromEntries(Object.keys(RARITY).map((r) => [r, feeFor(r)])), need: NEED_STEPS, fallbackH: FALLBACK_MS / HOUR, ditto: DITTO };

module.exports = {
  HA_INHERIT, motherOf, inheritsHa, inheritedEggMoves,
  STATIC, DITTO, HOURS_MIXED, HOURS_SAME, MAX_EGGS, PAIR2_LEVEL, WAGER_PER_STEP, FALLBACK_MS, NEED_STEPS, INHERIT_IVS, NATURE_INHERIT, SHINY_BASE, SHINY_PARENT, BABY_CANDY, FEE_MIN, FEE_MARGIN,
  feeFor, expectedResale, resaleCap, needFor, baseOf, check: (u, p) => preview(u, p), checkPair: check, maxPairs, view, deposit, withdraw, collect, hatch, onBet,
};

'use strict';
// Puente entre nuestros ejemplares y el simulador de Pokémon Showdown (paquete `pokemon-showdown`).
// El simulador pesa (~130 MB de RSS tras un combate), así que SOLO se carga la primera vez que se necesita
// (`ps()`); sin combates el servidor no lo toca.
//
// Decisiones documentadas:
//  - EVs: 84 en cada estadística (504 en total), igual que los combates aleatorios de Showdown. Los ejemplares
//    no tienen EVs propios todavía; así nadie arrastra una ventaja oculta y las IVs/naturaleza siguen mandando.
//  - Nivel: «Nivel 50 (justo)» por defecto (todos a 50) o «Niveles reales» (el nivel del ejemplar).
//  - Habilidad (`sdAbility`) y movimientos (`sdMoves`) se guardan en el ejemplar la primera vez que hacen falta
//    (perezoso, sin romper campos antiguos); `sdFor` guarda la especie para recalcular si evoluciona.
const crypto = require('crypto');
const { BY_ID } = require('./pokedex');
const movesMod = require('./moves');

let PS = null;
const ps = () => (PS ||= require('pokemon-showdown'));
const toID = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// Naturalezas: nombre en español → inglés (las 25).
const NATURE_EN = {
  Fuerte: 'Hardy', Huraña: 'Lonely', Audaz: 'Brave', Firme: 'Adamant', Pícara: 'Naughty',
  Osada: 'Bold', Dócil: 'Docile', Plácida: 'Relaxed', Agitada: 'Impish', Floja: 'Lax',
  Miedosa: 'Timid', Activa: 'Hasty', Seria: 'Serious', Alegre: 'Jolly', Ingenua: 'Naive',
  Modesta: 'Modest', Afable: 'Mild', Mansa: 'Quiet', Tímida: 'Bashful', Alocada: 'Rash',
  Serena: 'Calm', Amable: 'Gentle', Grosera: 'Sassy', Cauta: 'Careful', Rara: 'Quirky',
};
const STAT = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const EV_ALL = 84;

// ---- Especies ----
let SPECIES = null;
function speciesTable() {
  if (SPECIES) return SPECIES;
  SPECIES = new Map();
  for (const s of ps().Dex.species.all()) if (s.num > 0 && !s.forme && s.baseSpecies === s.name && !SPECIES.has(s.num)) SPECIES.set(s.num, s);
  return SPECIES;
}
const speciesOf = (id) => {
  const s = speciesTable().get(Number(id));
  if (!s) throw new Error('Ese Pokémon no puede combatir todavía.');
  return s;
};
const canBattle = (id) => speciesTable().has(Number(id));

// ---- Movimientos ----
const MOVE_INFO = new Map();
function moveInfo(id) {
  let m = MOVE_INFO.get(id);
  if (m !== undefined) return m;
  const mv = ps().Dex.moves.get(id);
  m = mv && mv.exists && !mv.isNonstandard && !mv.isZ && !mv.isMax ? mv : null;
  MOVE_INFO.set(id, m);
  return m;
}

function moveScore(mv, sp, atkSide) {
  if (mv.category === 'Status') return 55;
  let s = mv.basePower || 40;
  if (mv.multihit) s *= Array.isArray(mv.multihit) ? 3 : mv.multihit;
  if (sp.types.includes(mv.type)) s *= 1.5;
  if (typeof mv.accuracy === 'number') s *= mv.accuracy / 100;
  if (mv.self && mv.self.volatileStatus === 'mustrecharge') s *= 0.6;
  if (mv.flags && (mv.flags.charge || mv.flags.recharge)) s *= 0.6;
  if (mv.selfdestruct) s *= 0.2;
  if (mv.category === atkSide) s *= 1.1;
  return s;
}
const BAD_STATUS = new Set(['splash', 'celebrate', 'happyhour', 'holdhands', 'teleport', 'transform', 'metronome', 'mimic', 'sketch', 'conversion', 'conversion2', 'mindreader', 'lockon', 'curse', 'foresight', 'odorsleuth', 'mirrormove', 'copycat', 'assist', 'sleeptalk', 'snore', 'naturalgift', 'present', 'fling', 'beatup', 'bide', 'struggle', 'focuspunch', 'dreameater', 'nightmare', 'spite', 'doubleteam', 'minimize', 'harden', 'withdraw', 'defensecurl', 'sharpen', 'tailwhip', 'leer', 'growl', 'stringshot', 'smokescreen', 'sandattack', 'flash', 'kinesis', 'supersonic', 'screech', 'metalsound', 'scaryface', 'confide', 'babydolleyes', 'charm', 'featherdance', 'sweetscent', 'tickle', 'captivate', 'attract', 'swagger', 'flatter', 'torment', 'embargo', 'healblock', 'worryseed', 'gastroacid', 'simplebeam', 'entrainment', 'skillswap', 'roleplay', 'psychoshift', 'camouflage', 'electrify', 'iondeluge', 'powder', 'soak', 'magicpowder', 'trickortreat', 'forestscurse', 'topsyturvy', 'acupressure', 'bellydrum', 'substitute']);
const GOOD_STATUS = new Set(['protect', 'roost', 'recover', 'softboiled', 'slackoff', 'milkdrink', 'moonlight', 'morningsun', 'synthesis', 'shoreup', 'rest', 'swordsdance', 'nastyplot', 'calmmind', 'dragondance', 'quiverdance', 'bulkup', 'irondefense', 'amnesia', 'agility', 'rockpolish', 'willowisp', 'thunderwave', 'toxic', 'spore', 'sleeppowder', 'stunspore', 'leechseed', 'taunt', 'substitute', 'stealthrock', 'spikes', 'toxicspikes', 'stickyweb', 'reflect', 'lightscreen', 'auroraveil', 'tailwind', 'trickroom', 'fakeout', 'helpinghand', 'followme', 'ragepowder', 'encore', 'haze', 'painsplit', 'wish', 'healbell', 'aromatherapy', 'knockoff']);

// Los mejores 4 movimientos para un conjunto genérico: STAB + cobertura + utilidad típica.
function pickFromPool(sp, pool) {
  const { Dex } = ps();
  const st = sp.baseStats;
  const atkSide = st.atk >= st.spa ? 'Physical' : 'Special';
  const mvs = pool.map((id) => Dex.moves.get(id)).filter((m) => m.exists && moveInfo(m.id));
  const dmg = mvs.filter((m) => m.category !== 'Status').sort((a, b) => moveScore(b, sp, atkSide) - moveScore(a, sp, atkSide));
  const stat = mvs.filter((m) => m.category === 'Status' && GOOD_STATUS.has(m.id) && !BAD_STATUS.has(m.id));
  const out = [];
  const used = new Set();
  const add = (m) => { if (m && out.length < 4 && !out.includes(m.id)) { out.push(m.id); used.add(m.type); } };
  // 1-2 ataques del tipo propio, 1 de cobertura de otro tipo, el resto lo mejor que quede.
  for (const m of dmg) { if (sp.types.includes(m.type) && !used.has(m.type)) add(m); }
  for (const m of dmg) { if (out.length >= 3) break; if (!used.has(m.type) && (m.basePower || 0) >= 60) add(m); }
  const statUseful = stat.filter((m) => m.id === 'protect' || out.length < 3 || m.priority > 0);
  if (out.length < 3 && statUseful[0]) add(statUseful[0]);
  for (const m of dmg) add(m);
  for (const m of stat) add(m);
  for (const m of mvs) add(m);
  return out.slice(0, 4);
}

let SETS = null;
let SETS_D = null;
const randbats = (file) => { try { return require('pokemon-showdown/dist/data/random-battles/gen9/' + file); } catch { return {}; } };

// Conjunto por defecto: el de los combates aleatorios de Showdown si la especie lo tiene; si no, lo mejor del learnset.
function defaultMoves(id, doubles = false) {
  const sp = speciesOf(id);
  const src = doubles ? (SETS_D ||= randbats('doubles-sets.json')) : (SETS ||= randbats('sets.json'));
  const entry = src[sp.id] || (doubles ? (SETS ||= randbats('sets.json'))[sp.id] : null);
  let pool = [];
  if (entry && entry.sets && entry.sets.length) {
    const set = entry.sets[0];
    pool = (set.movepool || []).map(toID).filter((m) => moveInfo(m));
  }
  if (pool.length < 4) pool = [...new Set([...pool, ...movesMod.reachable(id, 100).map((x) => x.move).filter((x) => moveInfo(x))])];
  return pickFromPool(sp, pool);
}

const hashOf = (s) => crypto.createHash('sha1').update(String(s)).digest().readUInt32BE(0);
const abilitiesOf = (id) => {
  const a = speciesOf(id).abilities;
  return [a[0], a[1]].filter(Boolean).map(toID);
};
const allAbilitiesOf = (id) => {
  const a = speciesOf(id).abilities;
  return Object.entries(a).filter(([k]) => k !== 'S').map(([k, v]) => ({ id: toID(v), name: v, hidden: k === 'H' }));
};

// Rellena (sin romper nada) `sdAbility` y los movimientos (`learned`/`sdMoves`, ver moves.js) del ejemplar. Determinista por uid.
function ensureSd(id, m) {
  id = Number(id);
  require('./abilities').resolve(id, m); // habilidad normal u oculta del ejemplar (sin elecciones libres)
  m.sdFor = id;
  movesMod.ensure(id, m);
  return m;
}

// Valida lo que manda el cliente al cambiar habilidad / movimientos equipados (solo entre los aprendidos).
function validateSd(id, m, { ability, moves }) {
  const out = {};
  if (ability !== undefined && toID(ability) !== m.sdAbility) throw new Error('La habilidad se cambia con la Cápsula Habilidad o el Parche Habilidad (Tienda de Combate).');
  if (moves !== undefined) {
    if (!Array.isArray(moves) || moves.length < 1 || moves.length > 4) throw new Error('Elige de 1 a 4 movimientos.');
    const seen = new Set();
    out.sdMoves = moves.map((x) => {
      const mv = toID(x);
      if (!(m.learned || []).includes(mv)) throw new Error('Ese Pokémon aún no ha aprendido uno de esos movimientos.');
      if (seen.has(mv)) throw new Error('Movimiento repetido.');
      seen.add(mv);
      return mv;
    });
  }
  return out;
}

// ---- Mega ----
// Devuelve { item, move } o null. Mega-Rayquaza no usa piedra: megaevoluciona si conoce Ascenso Draco.
function megaSetup(formId) {
  const f = require('./mega').BY_FORM.get(Number(formId));
  if (!f) return null;
  const sp = speciesOf(f.species);
  if (sp.id === 'rayquaza') return { item: '', move: 'dragonascent' };
  const item = toID(f.stone.replace(/^stone-/, ''));
  const it = ps().Dex.items.get(item);
  if (!it.exists || !it.megaStone || !it.megaStone[sp.name]) return null;
  return { item, move: null };
}
const megaItemOf = (formId) => { const s = megaSetup(formId); return s ? s.item : null; };

// ---- Ejemplar → conjunto de Showdown ----
const cleanName = (s) => Array.from(String(s || '').replace(/[|\],@\\\[\u0000-\u001f]/g, '')).slice(0, 12).join('').trim();

/**
 * @param {object} m ejemplar (de u.mons[id])
 * @param {{level?: 'fair'|'real', mega?: number, doubles?: boolean, usedNames?: Set<string>}} o
 * @returns {{ set: object, roster: object }}
 */
function toSet(id, m, { level = 'fair', mega = 0, doubles = false, usedNames = new Set() } = {}) {
  id = Number(id);
  const sp = speciesOf(id);
  ensureSd(id, m);
  const dex = BY_ID.get(id);
  let name = cleanName(m.nick) || cleanName(dex.name) || sp.name;
  let base = name, k = 2;
  while (usedNames.has(name.toLowerCase())) name = `${Array.from(base).slice(0, 10).join('')} ${k++}`;
  usedNames.add(name.toLowerCase());
  const ivs = {};
  STAT.forEach((s, i) => { ivs[s] = Math.max(0, Math.min(31, Number.isInteger(m.ivs && m.ivs[i]) ? m.ivs[i] : 31)); });
  const evs = {};
  for (const s of STAT) evs[s] = EV_ALL;
  const lvl = level === 'real' ? Math.max(1, Math.min(100, Math.floor(m.level) || 5)) : 50;
  let gender = m.gender === 'F' ? 'F' : m.gender === 'M' ? 'M' : '';
  if (sp.gender) gender = sp.gender === 'N' ? '' : sp.gender; // especies de sexo fijo o sin sexo
  let item = require('./bp').holdable(m.item) ? m.item : ''; // objeto equipado (solo los de la Tienda de Combate y las bayas)
  let megaForm = 0;
  let moves = m.sdMoves.slice(0, 4);
  if (mega) {
    const ms = megaSetup(mega);
    if (!ms) throw new Error('Esa megaevolución no existe.');
    item = ms.item;
    megaForm = Number(mega);
    if (ms.move && !moves.includes(ms.move)) moves = [...moves.slice(0, 3), ms.move];
  }
  const set = {
    name, species: sp.name, item, ability: m.sdAbility, moves, nature: NATURE_EN[m.mint || m.nature] || 'Serious',
    gender, evs, ivs, level: lvl, shiny: !!m.shiny, happiness: Math.max(0, Math.min(255, Number.isFinite(m.friendship) ? m.friendship : 70)),
    pokeball: 'pokeball',
  };
  return { set, roster: { name, id, shiny: !!m.shiny, level: lvl, gender: gender || null, mega: megaForm || 0, uid: m.uid } };
}

const pack = (sets) => ps().Teams.pack(sets);

// Nombre de la especie en Showdown para los detalles `Charizard-Mega-X, L50, M` → id de nuestra Pokédex (para sprites).
const speciesNumByName = (name) => {
  const s = ps().Dex.species.get(String(name).split(',')[0]);
  return s && s.exists ? { num: s.num, baseSpecies: s.baseSpecies, forme: s.forme } : null;
};

// Información de un movimiento para el cliente.
function moveCard(id) {
  const m = moveInfo(id);
  if (!m) return null;
  return { id: m.id, type: m.type.toLowerCase(), cat: m.category === 'Physical' ? 'p' : m.category === 'Special' ? 's' : 'x', bp: m.basePower || 0, acc: m.accuracy === true ? 0 : m.accuracy, pp: m.pp };
}

module.exports = {
  ps, toID, NATURE_EN, EV_ALL, canBattle, speciesOf, moveInfo, moveCard, defaultMoves, ensureSd, validateSd,
  abilitiesOf, allAbilitiesOf, megaItemOf, megaSetup, toSet, pack, speciesNumByName, pickFromPool, STAT,
};

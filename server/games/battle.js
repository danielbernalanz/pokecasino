'use strict';
// Motor de combate simplificado (nivel 50, un movimiento STAB por tipo).
const { BY_ID, baseStats, effectiveness } = require('../pokedex');
const { rand } = require('../rng');

const MOVES = {
  normal: 'Golpe Cuerpo', fire: 'Lanzallamas', water: 'Surf', electric: 'Rayo', grass: 'Gigadrenado',
  ice: 'Rayo Hielo', fighting: 'A Bocajarro', poison: 'Bomba Lodo', ground: 'Terremoto', flying: 'Tajo Aéreo',
  psychic: 'Psíquico', bug: 'Tijera X', rock: 'Avalancha', ghost: 'Bola Sombra', dragon: 'Pulso Dragón',
  dark: 'Triturar', steel: 'Cabeza de Hierro', fairy: 'Fuerza Lunar',
};

// Factores del ejemplar (±5 % por IV, ±10 % por naturaleza). Sin datos de ejemplar: 1.
const ivF = (iv) => 1 + ((iv ?? 15.5) / 31 - 0.5) * 0.10;
function specimenFactors(id, sp) {
  if (!sp || !Array.isArray(sp.ivs)) return { hp: 1, atk: 1, def: 1, spe: 1 };
  const nm = (i) => require('../specimen').natureMult(require('../specimen').natureOf(sp), i);
  const st = BY_ID.get(id).stats;
  const ai = st[1] >= st[3] ? 1 : 3; // el ataque que cuenta es el mejor de los dos
  return {
    hp: ivF(sp.ivs[0]), atk: ivF(sp.ivs[ai]) * nm(ai), spe: ivF(sp.ivs[5]) * nm(5),
    def: ((ivF(sp.ivs[2]) * nm(2)) + (ivF(sp.ivs[4]) * nm(4))) / 2,
  };
}

// Nivel del ejemplar (5-100): +0,1 % por nivel por encima del 5 (Nv. 100 ≈ +9,5 %). Sin datos: 1.
const levelF = (level) => 1 + Math.max(0, (Number.isFinite(level) ? level : 5) - 5) * 0.001;

function fighter({ id, shiny, stars, owner, mega, ivs, nature, nick, level, friendship }) {
  const p = BY_ID.get(id);
  const form = mega ? require('../mega').BY_FORM.get(mega) : null;
  const b = form ? require('../mega').formBaseStats(mega) : baseStats(id);
  const mult = (1 + 0.04 * (stars - 1) + (shiny ? 0.05 : 0)) * (Array.isArray(ivs) ? levelF(level) * require('../bond').loveFactor(friendship) : 1);
  const f = specimenFactors(id, { ivs, nature });
  const hp = Math.round((b.hp + 60) * mult * f.hp);
  return {
    id, shiny, stars, owner, mega: form ? mega : undefined, name: form ? form.name : p.name, nick: nick || undefined, types: form ? form.types : p.types,
    hp, maxHp: hp, atk: (b.atk + 5) * mult * f.atk, def: (b.def + 5) * mult * f.def, spe: (b.spe + 5) * mult * f.spe,
  };
}

function bestMove(att, def) {
  let best = null;
  for (const t of att.types) {
    const eff = effectiveness(t, def.types);
    if (!best || eff > best.eff) best = { type: t, eff };
  }
  return best;
}

function simulate(a, b) {
  const A = fighter(a);
  const B = fighter(b);
  const log = [];
  for (let turn = 1; turn <= 60 && A.hp > 0 && B.hp > 0; turn++) {
    const first = A.spe === B.spe ? (rand() < 0.5 ? A : B) : (A.spe > B.spe ? A : B);
    const order = first === A ? [A, B] : [B, A];
    for (const att of order) {
      const def = att === A ? B : A;
      if (att.hp <= 0 || def.hp <= 0) continue;
      const mv = bestMove(att, def);
      const miss = rand() < 0.05;
      let dmg = 0;
      let crit = false;
      if (!miss && mv.eff > 0) {
        crit = rand() < 1 / 16;
        const base = ((2 * 50 / 5 + 2) * 85 * att.atk / def.def) / 50 + 2;
        dmg = Math.max(1, Math.floor(base * 1.5 * mv.eff * (0.85 + rand() * 0.15) * (crit ? 1.5 : 1)));
        def.hp = Math.max(0, def.hp - dmg);
      }
      log.push({ turn, by: att === A ? 0 : 1, move: MOVES[mv.type], type: mv.type, eff: mv.eff, dmg, crit, miss, hp: [A.hp, B.hp] });
    }
  }
  const winner = A.hp > 0 && B.hp <= 0 ? 0 : B.hp > 0 && A.hp <= 0 ? 1 : (A.hp / A.maxHp >= B.hp / B.maxHp ? 0 : 1);
  const strip = (f) => ({ id: f.id, mega: f.mega, shiny: f.shiny, stars: f.stars, owner: f.owner, name: f.name, nick: f.nick, types: f.types, maxHp: f.maxHp });
  return { fighters: [strip(A), strip(B)], log, winner };
}

module.exports = { simulate, fighter, MOVES, levelF };

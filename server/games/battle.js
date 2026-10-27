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

function fighter({ id, shiny, stars, owner }) {
  const p = BY_ID.get(id);
  const b = baseStats(id);
  const mult = 1 + 0.04 * (stars - 1) + (shiny ? 0.05 : 0);
  const hp = Math.round((b.hp + 60) * mult);
  return {
    id, shiny, stars, owner, name: p.name, types: p.types,
    hp, maxHp: hp, atk: (b.atk + 5) * mult, def: (b.def + 5) * mult, spe: (b.spe + 5) * mult,
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
  const strip = (f) => ({ id: f.id, shiny: f.shiny, stars: f.stars, owner: f.owner, name: f.name, types: f.types, maxHp: f.maxHp });
  return { fighters: [strip(A), strip(B)], log, winner };
}

module.exports = { simulate, fighter, MOVES };

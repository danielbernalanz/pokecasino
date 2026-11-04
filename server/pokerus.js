'use strict';
// Pokérus, como en los juegos: una infección muy rara (1 de cada 3.000 por victoria contra la CPU o expedición y Pokémon) que DUPLICA los EVs que gana el
// Pokémon. Se contagia a los demás Pokémon del mismo equipo de combate o de la misma expedición (25 % cada uno, solo si el portador sigue «infectado»)
// y a los 2-5 días (según el ejemplar) queda «curado»: sigue duplicando los EVs para siempre pero ya no contagia. Marca `PKRS` en la Caja PC.
// No crea monedas ni EXP: solo acelera el entrenamiento de EVs (que ya tiene sus topes diarios, ver evs.js).
const db = require('./db');
const hub = require('./hub');
const forms = require('./forms');
const { BY_ID } = require('./pokedex');
const rng = require('./rng');

const CHANCE = 1 / 3000;
const SPREAD = 0.25;
const MIN_DAYS = 2;
const MAX_DAYS = 5;
const DAY = 86400000;

const dayNum = (key) => Math.floor(Date.parse(key) / DAY);
const daysOf = (m) => MIN_DAYS + (forms.roll(m.uid, 'pkrs') % (MAX_DAYS - MIN_DAYS + 1));
// null (sano) | 'infected' | 'cured'
function state(m, key = hub.dayKey()) {
  if (!m || !m.prk || !m.prk.day) return null;
  return dayNum(key) - dayNum(m.prk.day) < (m.prk.days || MIN_DAYS) ? 'infected' : 'cured';
}
const evMult = (m) => (state(m) ? 2 : 1);
function infect(m, key = hub.dayKey()) { m.prk = { day: key, days: daysOf(m) }; return m.prk; }

// `members`: [{ id, m }] del mismo combate o expedición. Devuelve los nuevos casos [{ id, uid, name, spread }] y avisa al jugador.
function roll(u, members, { rand = rng.rand, chance = CHANCE, spread = SPREAD } = {}) {
  if (!u || u.npc) return [];
  const carriers = members.filter((x) => state(x.m) === 'infected');
  const out = [];
  for (const x of members) {
    if (x.m.prk) continue;
    const spreadHit = carriers.length > 0 && rand() < spread;
    if (spreadHit || rand() < chance) {
      infect(x.m);
      out.push({ id: x.id, uid: x.m.uid, name: x.m.nick || BY_ID.get(Number(x.id)).name, spread: spreadHit });
    }
  }
  for (const c of out) {
    hub.emitUser(u.id, 'toast', { kind: 'pokerus', text: `🦠 ¡${c.name} ha contraído el Pokérus! Ahora gana el doble de EVs.` });
    if (!c.spread) hub.feed('pokerus', `🦠 ¡${u.username} ha encontrado un Pokémon con Pokérus!`, { pokeId: Number(c.id) });
  }
  if (out.length) db.save();
  return out;
}

const STATIC = { chance: CHANCE, spread: SPREAD, days: [MIN_DAYS, MAX_DAYS] };
module.exports = { CHANCE, SPREAD, MIN_DAYS, MAX_DAYS, STATIC, state, evMult, infect, roll };

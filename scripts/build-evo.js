'use strict';
// Genera server/evodata.json: requisitos ESPECIALES de evolución por especie destino, a partir de los datos de Pokémon Showdown
// (evoType, evoItem, evoCondition, gender, prevo). Uso: node scripts/build-evo.js
// Qué se traduce (el coste en caramelos y el descuento de primera evolución no cambian; esto se AÑADE):
//  - useItem → `item` (piedras y objetos: se gasta 1).
//  - trade → `trade` (Cordón Unión o intercambio real con otro jugador) y, si hay, `item` (Revestimiento Metálico, Escama Dragón…).
//  - levelHold (Piedra Oval, Garra Afilada, Colmillo Afilado) → `item` + `time` (día/noche).
//  - nivel + «de día / de noche» → `time` (Lycanroc, Tyrantrum, Aurorus, Lurantis, Gumshoos, Houndstone…).
//  - Hitmonlee/Hitmonchan/Hitmontop → `stat` (Ataque > Defensa, < o =).
//  - levelMove → `move` (el Pokémon debe conocerlo), solo si la preevolución puede aprenderlo de verdad en este juego.
//  - Sexo del destino: si el destino es de sexo fijo (Gallade ♂, Froslass ♀, Vespiquen ♀, Wormadam ♀, Mothim ♂, Salazzle ♀…) y la
//    preevolución puede ser de los dos sexos → `gender`. (Meowstic y Oinkologne tienen forma de cada sexo: sin restricción.)
//  - Amistad con día/noche: solo Espeon (día) y Umbreon (noche); el resto de evoluciones por amistad no cambian (ver bond.js).
//  - Lo demás («otro»: pasos, golpes críticos, lugares, clima…) sigue siendo solo por caramelos.
const fs = require('fs');
const path = require('path');
const { Dex } = require('pokemon-showdown');
const { DEX } = require('../server/pokedex');
const moves = require('../server/moves');

const ITEM_ID = {
  'Fire Stone': 'fire-stone', 'Water Stone': 'water-stone', 'Thunder Stone': 'thunder-stone', 'Leaf Stone': 'leaf-stone', 'Moon Stone': 'moon-stone', 'Sun Stone': 'sun-stone',
  'Shiny Stone': 'shiny-stone', 'Dusk Stone': 'dusk-stone', 'Dawn Stone': 'dawn-stone', 'Ice Stone': 'ice-stone',
  "King's Rock": 'kings-rock', 'Metal Coat': 'metal-coat', 'Dragon Scale': 'dragon-scale', 'Up-Grade': 'up-grade', 'Prism Scale': 'prism-scale', 'Deep Sea Tooth': 'deep-sea-tooth',
  'Deep Sea Scale': 'deep-sea-scale', Protector: 'protector', Electirizer: 'electirizer', Magmarizer: 'magmarizer', 'Dubious Disc': 'dubious-disc', 'Reaper Cloth': 'reaper-cloth',
  Sachet: 'sachet', 'Whipped Dream': 'whipped-dream', 'Oval Stone': 'oval-stone', 'Razor Claw': 'razor-claw', 'Razor Fang': 'razor-fang', 'Tart Apple': 'tart-apple',
  'Sweet Apple': 'sweet-apple', 'Cracked Pot': 'cracked-pot', 'Syrupy Apple': 'syrupy-apple', 'Unremarkable Teacup': 'unremarkable-teacup', 'Metal Alloy': 'metal-alloy',
  'Black Augurite': 'black-augurite', 'Auspicious Armor': 'auspicious-armor', 'Malicious Armor': 'malicious-armor',
};
const NO_GENDER_RULE = new Set([678, 916]); // Meowstic, Oinkologne
const NO_TIME_RULE = new Set([745]); // Lycanroc: en los juegos cada hora da una forma distinta; aquí es una sola entrada, así que sin horario
const FRIEND_TIME = { 196: 'day', 197: 'night' }; // Espeon, Umbreon

const sp = new Map();
for (const s of Dex.species.all()) if (s.num > 0 && !s.forme && s.baseSpecies === s.name && !sp.has(s.num)) sp.set(s.num, s);
const toID = moves.toID;
const canLearn = (from, mv) => moves.levelMoves(from).some((x) => x.move === mv) || moves.tmCompat(from, mv) || moves.eggMoves(from).includes(mv) || moves.tutorMoves(from).includes(mv);

const req = {};
for (const p of DEX) {
  if (!p.evolvesFrom) continue;
  const s = sp.get(p.id);
  const prev = sp.get(p.evolvesFrom);
  if (!s || !prev || s.prevo !== prev.name) continue; // formas regionales: se quedan solo por caramelos
  const r = {};
  const cond = s.evoCondition || '';
  const time = /during the day/.test(cond) ? 'day' : /at night/.test(cond) ? 'night' : null;
  const t = s.evoType;
  if (t === 'useItem' && s.evoItem) { if (!ITEM_ID[s.evoItem]) throw new Error('Objeto sin id: ' + s.evoItem); r.item = ITEM_ID[s.evoItem]; }
  else if (t === 'trade') { r.trade = 1; if (s.evoItem) { if (!ITEM_ID[s.evoItem]) throw new Error('Objeto sin id: ' + s.evoItem); r.item = ITEM_ID[s.evoItem]; } }
  else if (t === 'levelHold' && s.evoItem) { r.item = ITEM_ID[s.evoItem]; if (time) r.time = time; }
  else if (t === 'levelFriendship') { if (FRIEND_TIME[p.id]) r.time = FRIEND_TIME[p.id]; }
  else if (s.evoLevel && time && !NO_TIME_RULE.has(p.id)) r.time = time;
  if (/Atk stat > its Def/.test(cond)) r.stat = 'atk>def';
  else if (/Atk stat < its Def/.test(cond)) r.stat = 'atk<def';
  else if (/Atk stat equal to its Def/.test(cond)) r.stat = 'atk=def';
  if (t === 'levelMove' && s.evoMove) { const mv = toID(s.evoMove); if (canLearn(p.evolvesFrom, mv)) r.move = mv; }
  if ((s.gender === 'M' || s.gender === 'F') && prev.gender !== s.gender && !NO_GENDER_RULE.has(p.id)) r.gender = s.gender;
  if (Object.keys(r).length) req[p.id] = r;
}
const out = path.join(__dirname, '..', 'server', 'evodata.json');
fs.writeFileSync(out, JSON.stringify({ req }, null, 0) + '\n');
console.log(Object.keys(req).length, 'evoluciones con requisito especial →', out);

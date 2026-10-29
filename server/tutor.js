'use strict';
// Tutor de movimientos (como en Omega Rubí/Zafiro Alfa): enseña movimientos de tutor a cambio de Fragmentos
// (Rojo/Azul/Amarillo/Verde) que caen, raros y con tope diario, en las Expediciones. Sin monedas de por medio.
const db = require('./db');
const hub = require('./hub');
const items = { give: (...a) => require('./items').give(...a), take: (...a) => require('./items').take(...a) }; // carga diferida: items.js importa este módulo
const moves = require('./moves');
const { BY_ID } = require('./pokedex');
const { rand, pick } = require('./rng');

const SHARDS = {
  'shard-red': { name: 'Fragmento Rojo', sprite: 'red-shard', types: ['fire', 'fighting', 'rock', 'ground'] },
  'shard-blue': { name: 'Fragmento Azul', sprite: 'blue-shard', types: ['water', 'ice', 'flying', 'dragon'] },
  'shard-yellow': { name: 'Fragmento Amarillo', sprite: 'yellow-shard', types: ['electric', 'psychic', 'normal', 'fairy'] },
  'shard-green': { name: 'Fragmento Verde', sprite: 'green-shard', types: ['grass', 'bug', 'poison', 'ghost', 'dark', 'steel'] },
};
const COST = 4; // fragmentos del color del tipo del movimiento
const DAY_CAP = 3; // fragmentos por día desde expediciones
const CHANCE = { 4: 0.35, 8: 0.6, 12: 1 }; // por reclamación (horas)
const AMOUNT = { 4: 1, 8: 1, 12: 2 };
const ES = require('./sd-es.json');
const colorOf = (type) => Object.keys(SHARDS).find((k) => SHARDS[k].types.includes(type));

function dayRec(u) {
  const k = hub.dayKey();
  if (!u.shardDay || u.shardDay.day !== k) u.shardDay = { day: k, n: 0 };
  return u.shardDay;
}
// Botín de una expedición: a veces fragmentos (color según los tipos de la zona).
function expeditionLoot(u, zone, hours) {
  const d = dayRec(u);
  const out = {};
  if (!CHANCE[hours] || !(rand() < CHANCE[hours])) return out;
  const n = Math.min(AMOUNT[hours], DAY_CAP - d.n);
  if (n <= 0) return out;
  const color = colorOf(pick(zone.types));
  items.give(u, color, n);
  d.n += n;
  out[color] = n;
  return out;
}

function list(u, p) {
  const specimen = require('./specimen');
  const id = Number(p.id);
  const m = specimen.find(u, { id, uid: p.uid });
  moves.ensure(id, m);
  return { moves: moves.tutorMoves(id).filter((x) => ES.meta[x]).map((x) => ({ move: x, color: colorOf(ES.meta[x][0]), cost: COST, known: m.learned.includes(x) })) };
}
function learn(u, p) {
  const specimen = require('./specimen');
  const id = Number(p.id);
  const m = specimen.find(u, { id, uid: p.uid });
  moves.ensure(id, m);
  const move = moves.toID(p.move);
  if (!moves.tutorMoves(id).includes(move) || !ES.meta[move]) throw new Error(`${BY_ID.get(id).name} no puede aprender eso del Tutor.`);
  if (m.learned.includes(move)) throw new Error('Ya conoce ese movimiento.');
  const color = colorOf(ES.meta[move][0]);
  if ((u.items[color] || 0) < COST) throw new Error(`Necesitas ${COST} × ${SHARDS[color].name} (tienes ${u.items[color] || 0}).`);
  items.take(u, color, COST);
  const how = moves.teach(id, m, move);
  db.save();
  return { move, how, eq: m.sdMoves, learned: m.learned };
}

module.exports = { SHARDS, COST, DAY_CAP, CHANCE, AMOUNT, colorOf, expeditionLoot, list, learn };

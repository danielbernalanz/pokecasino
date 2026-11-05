'use strict';
// Teracristalización (9.ª generación). Cada ejemplar tiene un Teratipo (`m.tera`): si no se ha cambiado, uno de los tipos de su especie
// (determinista por ejemplar, como los Pokémon normales de los juegos); los jefes de Teraincursión pueden tener uno distinto.
//
//  · Orbe Teracristal: objeto clave (no se vende, comercia, recicla ni regala). Te lo da el Profesor Oak al conseguir tu 1.ª medalla (se
//    reparte solo a quien ya la tiene). Sin Orbe no se puede teracristalizar.
//  · En combate se usa el soporte nativo del simulador (gen9, `terastallize` en la elección): una vez por combate y jugador. La CPU nunca
//    teracristaliza (su IA no lo usa), salvo el jefe de las Teraincursiones, que ya empieza cristalizado.
//  · DÓNDE (decisión de diseño; en Kanto/FRLG no existía y los líderes y el Alto Mando eran de una época sin Tera): Combates libres contra
//    entrenadores normales, PvP (opción del reto, activada por defecto; hace falta que AMBOS tengan el Orbe) y Teraincursiones. NO en los
//    líderes de gimnasio, el Alto Mando, la Torre Batalla (equipos de alquiler iguales para todos) ni la Clasificatoria de la Liga
//    (igualdad de condiciones, como con la amistad).
//  · Teralitos: 18 objetos, uno por tipo, que caen de las Teraincursiones. 50 Teralitos de un tipo cambian el Teratipo de un ejemplar a ese tipo
//    (como en EV: 50 Teralitos de un tipo). No dan monedas (los PNJ no los comercian); solo se pueden pasar entre jugadores en el Mercado.
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const { TYPES, BY_ID } = require('./pokedex');

const ORB = 'tera-orb';
const SHARDS_PER_CHANGE = 50;
const TYPE_ES = {
  normal: 'Normal', fire: 'Fuego', water: 'Agua', electric: 'Eléctrico', grass: 'Planta', ice: 'Hielo', fighting: 'Lucha', poison: 'Veneno', ground: 'Tierra',
  flying: 'Volador', psychic: 'Psíquico', bug: 'Bicho', rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón', dark: 'Siniestro', steel: 'Acero', fairy: 'Hada',
};
const shardId = (type) => `tera-shard-${type}`;
const isType = (t) => typeof t === 'string' && TYPES.includes(t);
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Entradas de `items.ITEMS`: el Orbe (objeto clave) y un Teralito por tipo. Sin precio en monedas.
function buildItems() {
  const out = {
    [ORB]: { name: 'Orbe Teracristal', sprite: 'tera-orb', price: null, key: true, desc: 'Objeto clave. Permite teracristalizar a un Pokémon una vez por combate (Combates libres, PvP con la regla activada y Teraincursiones). No se vende ni se comercia.' },
  };
  for (const t of TYPES) out[shardId(t)] = { name: `Teralito ${TYPE_ES[t]}`, sprite: `${t}-tera-shard`, price: null, teraShard: true, tera: t, desc: `Teralito de tipo ${TYPE_ES[t]}. Con ${SHARDS_PER_CHANGE} cambias el Teratipo de un Pokémon a ${TYPE_ES[t]} (Caja PC → Datos). Cae de las Teraincursiones.` };
  return out;
}

// Teratipo de un ejemplar: el elegido (con Teralitos o por ser jefe capturado) o uno de los tipos de su especie, estable según el uid.
function teraOf(id, m) {
  if (m && isType(m.tera)) return m.tera;
  const types = (BY_ID.get(Number(id)) || { types: ['normal'] }).types;
  const h = m && m.uid ? crypto.createHash('sha1').update(String(m.uid)).digest().readUInt32BE(0) : 0;
  return types[h % types.length];
}

const badgeCount = (u) => ((u.progress && u.progress.badges) || []).length;
const hasOrb = (u) => !!(u.items && u.items[ORB] > 0);
// Reparte el Orbe a quien ya tiene una medalla (una sola vez; es un objeto clave y no se puede perder).
function ensureOrb(u) {
  if (u.npc || hasOrb(u) || u.teraOrb || badgeCount(u) < 1) return false;
  u.teraOrb = true;
  u.items ||= {};
  u.items[ORB] = 1;
  hub.emitUser(u.id, 'toast', { kind: 'item', text: '💎 El Profesor Oak te ha dado el Orbe Teracristal' });
  db.save();
  return true;
}

// Reglas por modo de combate (las usa showdown.js): ¿se puede teracristalizar en este combate?
const modeAllows = ({ mode, tower, ranked, elite, fixed }) => {
  if (tower || ranked || elite || fixed) return false;
  return mode === 'cpu' || mode === 'pvp';
};

function view(u) {
  ensureOrb(u);
  const shards = {};
  for (const t of TYPES) shards[t] = (u.items && u.items[shardId(t)]) || 0;
  return { orb: hasOrb(u), shards, per: SHARDS_PER_CHANGE, types: TYPES };
}

// Cambia el Teratipo de un ejemplar gastando 50 Teralitos de ese tipo.
function setType(u, { id, uid, type }) {
  const specimen = require('./specimen');
  const items = require('./items');
  type = String(type);
  if (!isType(type)) throw new Error('Tipo no válido.');
  const m = specimen.find(u, { id, uid });
  specimen.assertFree(m, BY_ID.get(Number(id)).name);
  if (teraOf(id, m) === type) throw new Error(`Su Teratipo ya es ${TYPE_ES[type]}.`);
  if ((u.items[shardId(type)] || 0) < SHARDS_PER_CHANGE) throw new Error(`Necesitas ${SHARDS_PER_CHANGE} ${items.ITEMS[shardId(type)].name} (tienes ${u.items[shardId(type)] || 0}).`);
  items.take(u, shardId(type), SHARDS_PER_CHANGE);
  m.tera = type;
  db.save();
  return { tera: type, view: view(u) };
}

const STATIC = { orb: ORB, per: SHARDS_PER_CHANGE, types: TYPES, typeEs: TYPE_ES };

module.exports = { ORB, SHARDS_PER_CHANGE, TYPE_ES, shardId, isType, cap, buildItems, teraOf, hasOrb, ensureOrb, modeAllows, view, setType, STATIC };

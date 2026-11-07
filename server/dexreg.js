'use strict';
// Registro permanente de la Pokédex, como en los juegos principales (Escarlata/Púrpura): dos estados por especie y jugador.
//   VISTO     (`u.dexSeen`)   : lo has visto (combates, encuentros, evolución, intercambio…) o lo has obtenido. Permanente.
//   OBTENIDO  (`u.dexCaught`) : lo has capturado, eclosionado, recibido, comprado o conseguido evolucionando. Permanente: evolucionarlo, intercambiarlo,
//                               venderlo, regalarlo, liberarlo o transferirlo al Profesor Oak NO lo quita (lo único que cuenta como «lo tienes ahora» es la Caja PC).
// Sanción antiabuso (no es una mecánica de los juegos): las especies en la Caja con candado (`u.locked`) NO cuentan como obtenidas mientras sigan con candado
// (aunque consten en el registro) ni se rellenan en la migración. Si el jugador recupera la especie, vuelve a contar. Una copia nueva y legítima en la Caja sí cuenta.
const { BY_ID } = require('./pokedex');

const isLocked = (u, id) => !!(u.locked && u.locked[id]);
const held = (u, id) => !!(u.collection && u.collection[id] && u.collection[id].n > 0);

// ¿Obtenido? (lo que cuenta en Pokédex, ranking, regionales y colecciones)
const caught = (u, id) => held(u, id) || (!!(u.dexCaught && u.dexCaught[id]) && !isLocked(u, id));
// ¿Visto? Obtenido, con candado (lo has tenido) o marcado como visto.
const seen = (u, id) => caught(u, id) || isLocked(u, id) || !!(u.dexSeen && u.dexSeen[id]);

// Definición ÚNICA del estado de una especie: 'caught' | 'seen' | 'none'. Todo el servidor (y el cliente, que no lo recalcula) parte de aquí.
const status = (u, id) => (caught(u, id) ? 'caught' : seen(u, id) ? 'seen' : 'none');

function markSeen(u, id) {
  if (!u || u.npc || !BY_ID.has(Number(id))) return false;
  const d = (u.dexSeen ||= {});
  if (d[Number(id)]) return false;
  d[Number(id)] = 1;
  return true;
}
// Registra una especie como obtenida (y vista). Devuelve true si es la primera vez.
function markCaught(u, id) {
  if (!u || u.npc || !BY_ID.has(Number(id))) return false;
  id = Number(id);
  markSeen(u, id);
  const d = (u.dexCaught ||= {});
  if (d[id]) return false;
  d[id] = 1;
  return true;
}

const ids = (u, f) => { const out = new Set(); for (const id of [...Object.keys(u.collection || {}), ...Object.keys(u.dexCaught || {}), ...Object.keys(u.dexSeen || {}), ...Object.keys(u.locked || {})]) if (BY_ID.has(Number(id)) && f(u, Number(id))) out.add(Number(id)); return out; };
const caughtSet = (u) => ids(u, caught);
const seenSet = (u) => ids(u, seen);
const caughtCount = (u) => caughtSet(u).size;
const seenCount = (u) => seenSet(u).size;

// Para el cliente: listas de números de Pokédex.
const view = (u) => ({ seen: [...seenSet(u)].sort((a, b) => a - b), caught: [...caughtSet(u)].sort((a, b) => a - b) });

// Migración (una vez, desde fixes.js): rellena «obtenidos» con lo que se tiene ahora, el registro de primeras evoluciones y lo que ya constaba como
// visto/obtenido (`dexSeen` solo se rellenaba al recibir un ejemplar y, en la GTS, con especies ya vistas). Nada con candado. Idempotente.
function migrate(u) {
  if (u.npc) return 0;
  let n = 0;
  const add = (id) => { id = Number(id); if (BY_ID.has(id) && !isLocked(u, id) && markCaught(u, id)) n++; };
  for (const [id, c] of Object.entries(u.collection || {})) if (c && c.n > 0) add(id);
  for (const id of Object.keys(u.evoReg || {})) add(id);
  for (const id of Object.keys(u.dexSeen || {})) add(id);
  // Colecciones ya completadas: sus especies constan como obtenidas (nada ganado se pierde), salvo las que estén con candado.
  const done = new Set(((u.progress && u.progress.sets) || []));
  for (const s of require('./progress').SETS) if (done.has(s.id)) for (const id of s.ids) add(id);
  for (const id of Object.keys(u.locked || {})) markSeen(u, id);
  return n;
}

module.exports = { status, caught, seen, markSeen, markCaught, caughtSet, seenSet, caughtCount, seenCount, view, migrate, isLocked };

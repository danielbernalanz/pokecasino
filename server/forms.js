'use strict';
// Evoluciones al azar «reales» de los juegos. Como allí, el azar es del PROPIO ejemplar (su «personalidad»): se deriva de su `uid`, así que es
// fijo (cancelar y repetir no cambia nada) y distinto de un ejemplar a otro.
//  · Wurmple evoluciona a Silcoon o Cascoon (50 / 50), nunca a elegir.
//  · Dunsparce → Dudunsparce: 1 de cada 100 sale «de tres segmentos» (forma de Showdown `Dudunsparce-Three-Segment`).
//  · Tandemaus → Maushold: 1 de cada 100 sale «familia de tres»; el resto, «familia de cuatro» (`Maushold-Four` en Showdown).
const crypto = require('crypto');

const WURMPLE = 265;
const SILCOON = 266;
const CASCOON = 268;
const DUDUNSPARCE = 982;
const MAUSHOLD = 925;
const RARE = 100; // 1 de cada 100

const roll = (uid, salt) => parseInt(crypto.createHash('sha1').update(`${salt}:${uid}`).digest('hex').slice(0, 8), 16);

// Si la especie tiene una única evolución posible para ese ejemplar, cuál es (Wurmple); si no, null.
function forcedTarget(id, m) {
  if (Number(id) === WURMPLE) return roll(m.uid, 'wurmple') % 2 === 0 ? SILCOON : CASCOON;
  return null;
}
const rareFor = (m, salt) => roll(m.uid, salt) % RARE === 0;
// Forma del ejemplar (null = la forma normal / sin formas): 'three' en Dudunsparce (tres segmentos) · 'three' / 'four' en Maushold.
function formOf(id, m) {
  id = Number(id);
  if (id === DUDUNSPARCE) return m.form || (rareFor(m, 'dunsparce') ? 'three' : 'two');
  if (id === MAUSHOLD) return m.form || (rareFor(m, 'tandemaus') ? 'three' : 'four');
  return null;
}
// Fija la forma al evolucionar. Devuelve la etiqueta para mostrarla, o null.
function onEvolve(to, m) {
  const f = formOf(to, m);
  if (f) m.form = f; else delete m.form;
  return label(to, m);
}
const LABELS = { [DUDUNSPARCE]: { two: 'Dos segmentos', three: 'Tres segmentos' }, [MAUSHOLD]: { three: 'Familia de tres', four: 'Familia de cuatro' } };
const label = (id, m) => { const f = formOf(id, m); return f ? LABELS[Number(id)][f] : null; };
// Nombre de la forma en Showdown (o null si es la base).
function showdownName(id, m) {
  const f = formOf(id, m);
  if (Number(id) === DUDUNSPARCE && f === 'three') return 'Dudunsparce-Three-Segment';
  if (Number(id) === MAUSHOLD && f === 'four') return 'Maushold-Four';
  return null;
}

const STATIC = { rare: RARE, labels: LABELS };
module.exports = { WURMPLE, SILCOON, CASCOON, DUDUNSPARCE, MAUSHOLD, RARE, roll, forcedTarget, formOf, onEvolve, label, showdownName, STATIC };

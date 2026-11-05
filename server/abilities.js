'use strict';
// Habilidades como en los juegos: cada ejemplar tiene una habilidad NORMAL (casilla 0 o 1 de su especie) o la OCULTA (`ha`).
// Nada se elige gratis: la Cápsula Habilidad alterna entre las dos normales, el Parche Habilidad da la oculta y la
// oculta también se hereda en el Criadero (ver daycare.js). Los datos salen de server/learnsets.json (sin cargar el simulador).
const crypto = require('crypto');
const moves = require('./moves');

const ES = require('./sd-es.json');
const hashOf = (s) => crypto.createHash('sha1').update(String(s)).digest().readUInt32BE(0);
const name = (id) => ES.abilities[id] || id;
const VERSION = 1;

// Habilidad que le corresponde y casilla (0/1) normal; deja `abSlot`/`ha`/`sdAbility` consistentes en el ejemplar.
function resolve(id, m) {
  const { normal, hidden } = moves.abilitiesOf(id);
  if (m.abv !== VERSION) {
    // Migración: se descartan las elecciones libres antiguas (incluida la oculta); se conserva la casilla si era una normal.
    const i = normal.indexOf(m.sdAbility);
    if (i >= 0) m.abSlot = i;
    m.ha = false;
    m.abv = VERSION;
  }
  if (m.ha && hidden) { m.sdAbility = hidden; return hidden; }
  if (m.ha && !hidden) m.ha = false; // la nueva especie no tiene oculta
  if (!normal.length) { m.sdAbility = hidden || ''; return m.sdAbility; }
  let slot = Number.isInteger(m.abSlot) ? m.abSlot : hashOf(m.uid) % normal.length;
  if (slot >= normal.length) slot = 0;
  m.abSlot = slot;
  m.sdAbility = normal[slot];
  return m.sdAbility;
}

const optionsOf = (id) => moves.abilitiesOf(id);

// Cápsula: cambia a la otra habilidad normal. Parche: da la oculta.
function applyCapsule(id, m) {
  resolve(id, m);
  const { normal } = moves.abilitiesOf(id);
  if (m.ha) throw new Error('Con la habilidad oculta no sirve la Cápsula Habilidad.');
  if (normal.length < 2) throw new Error('Esa especie solo tiene una habilidad normal.');
  m.abSlot = 1 - m.abSlot;
  return resolve(id, m);
}
function applyPatch(id, m) {
  resolve(id, m);
  const { hidden } = moves.abilitiesOf(id);
  if (!hidden) throw new Error('Esa especie no tiene habilidad oculta.');
  if (m.ha) throw new Error('Ya tiene la habilidad oculta.');
  m.ha = true;
  return resolve(id, m);
}

module.exports = { resolve, optionsOf, applyCapsule, applyPatch, name };

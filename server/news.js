'use strict';
// Registro de novedades: versión del último aviso visto por cada jugador.
const MAX_VERSION = 40;

function markSeen(user, payload) {
  const version = payload && payload.version;
  if (typeof version !== 'string' || !version.trim() || version.length > MAX_VERSION) throw new Error('Versión no válida.');
  user.newsSeen = version;
  return {};
}

module.exports = { markSeen, MAX_VERSION };

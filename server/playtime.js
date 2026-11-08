'use strict';
// Tiempo de juego: el cliente manda un latido cada minuto mientras la pestaña está visible y el jugador ha hecho
// algo en los últimos 5 minutos. Cada latido suma lo que ha pasado desde el anterior, con un máximo de 75 s
// (así no cuenta el tiempo con la pestaña cerrada ni se puede inflar mandando latidos seguidos).
// Cada jugador decide si su tiempo es público (ficha y ranking) o privado.
const db = require('./db');

const MAX_STEP = 75 * 1000;
const MIN_GAP = 20 * 1000;

function beat(user, now = Date.now()) {
  const last = user.playBeat || 0;
  user.playBeat = now;
  const gap = now - last;
  if (last && gap >= MIN_GAP) user.playMs = (user.playMs || 0) + Math.min(MAX_STEP, gap);
  else if (!last) user.playMs = user.playMs || 0;
  db.save();
  return { playMs: user.playMs || 0 };
}
// Visible para los demás salvo que el jugador lo haya puesto en privado.
const isPublic = (u) => u.playPublic !== false;
function privacy(user, { public: pub }) {
  user.playPublic = !!pub;
  db.save();
  return { playPublic: user.playPublic };
}

module.exports = { beat, privacy, isPublic, MAX_STEP, MIN_GAP };

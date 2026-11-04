'use strict';
// Hora del día en España (Europe/Madrid), como el reloj de los juegos. Todo recibe `now` para poder probarlo.
//   noche: 21:00–06:00 · día: 06:00–21:00 (hay un tramo de «amanecer» 06–08 y «atardecer» 19–21 que cuentan como día).
// Lo usan el Gacha y las Expediciones (Pokémon que salen más de día o de noche, ver gacha.js) y las evoluciones por horario (evoreq.js).
const NIGHT_FROM = 21;
const NIGHT_TO = 6;
const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Hora (0–23) y minutos en Madrid.
function clock(now = Date.now()) {
  const parts = FMT.formatToParts(new Date(now));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { hour: get('hour') % 24, minute: get('minute') };
}
const phase = (now = Date.now()) => { const h = clock(now).hour; return h >= NIGHT_FROM || h < NIGHT_TO ? 'night' : 'day'; };
// Milisegundos hasta el próximo cambio de fase (para refrescar la pantalla): aproximado al minuto.
function msToChange(now = Date.now()) {
  const { hour, minute } = clock(now);
  const target = phase(now) === 'night' ? NIGHT_TO : NIGHT_FROM;
  const hoursLeft = (target - hour + 24) % 24 || 24;
  return Math.max(60000, (hoursLeft * 60 - minute) * 60000);
}
const STATIC = { nightFrom: NIGHT_FROM, nightTo: NIGHT_TO };

module.exports = { NIGHT_FROM, NIGHT_TO, clock, phase, msToChange, STATIC };

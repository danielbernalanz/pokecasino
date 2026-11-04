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

// ---- Pokémon de día y de noche ----
// En el Gacha pesan ×2 a su hora y ×0,5 fuera de ella (dentro de su rareza: la probabilidad de cada rareza no cambia, y
// ninguno queda excluido, así que la Pokédex se puede completar a cualquier hora). En las Expediciones, quien coincide con la
// hora de salida da un 25 % más de caramelos (sin penalización fuera de hora).
const AT_TIME = 2;
const OFF_TIME = 0.5;
const EXP_BONUS = 0.25;
// Números de Pokédex (solo especies comunes: ningún legendario ni mítico).
const NIGHT_SPECIES = [
  41, 42, 169, // Zubat, Golbat, Crobat
  92, 93, 94, // Gastly, Haunter, Gengar
  163, 164, // Hoothoot, Noctowl
  167, 168, // Spinarak, Ariados
  198, 430, // Murkrow, Honchkrow
  200, 429, // Misdreavus, Mismagius
  228, 229, // Houndour, Houndoom
  215, 461, // Sneasel, Weavile
  261, 262, // Poochyena, Mightyena
  302, 359, // Sableye, Absol
  353, 354, // Shuppet, Banette
  355, 356, 477, // Duskull, Dusclops, Dusknoir
  425, 426, // Drifloon, Drifblim
  434, 435, // Stunky, Skuntank
  607, 608, 609, // Litwick, Lampent, Chandelure
  708, 709, 710, 711, // Phantump, Trevenant, Pumpkaboo, Gourgeist
  714, 715, // Noibat, Noivern
  197, // Umbreon
];
const DAY_SPECIES = [
  10, 11, 12, // Caterpie, Metapod, Butterfree
  16, 17, // Pidgey, Pidgeotto
  165, 166, // Ledyba, Ledian
  187, 188, 189, // Hoppip, Skiploom, Jumpluff
  191, 192, // Sunkern, Sunflora
  276, 277, // Taillow, Swellow
  396, 397, 398, // Starly, Staravia, Staraptor
  415, 416, // Combee, Vespiquen
  420, 421, // Cherubi, Cherrim
  546, 547, // Cottonee, Whimsicott
  548, 549, // Petilil, Lilligant
  753, 754, // Fomantis, Lurantis
  196, // Espeon
];
const AFFINITY = new Map([...NIGHT_SPECIES.map((id) => [id, 'night']), ...DAY_SPECIES.map((id) => [id, 'day'])]);
const affinity = (id) => AFFINITY.get(Number(id)) || null;
// Multiplicador de peso en el Gacha para `id` a la hora `phase`.
const mult = (id, phase) => { const a = AFFINITY.get(Number(id)); return !a ? 1 : a === phase ? AT_TIME : OFF_TIME; };

const STATIC = { nightFrom: NIGHT_FROM, nightTo: NIGHT_TO, night: NIGHT_SPECIES, day: DAY_SPECIES, atTime: AT_TIME, offTime: OFF_TIME, expBonus: EXP_BONUS };

module.exports = { NIGHT_FROM, NIGHT_TO, AT_TIME, OFF_TIME, EXP_BONUS, NIGHT_SPECIES, DAY_SPECIES, affinity, mult, clock, phase, msToChange, STATIC };

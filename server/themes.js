'use strict';
// Eventos temáticos: una «Semana de <tipo>» determinista (de lunes a domingo, hora de España) que se suma a los eventos de fin de semana de events.js
// SIN tocarlos (events.publicState() solo añade el campo `theme`). Cada ciclo de 18 semanas recorre los 18 tipos una vez, en un orden fijo por hash.
//
// Efectos (ninguno da monedas ni tiene que ver con el dinero):
//  · CAPTURA: los Pokémon de ese tipo pesan ×3 en las tablas de encuentros de cada ruta (solo cambia a cuál te encuentras; los 30 encuentros diarios,
//    los ratios de captura y los legendarios no cambian).
//  · TERAINCURSIONES: el segundo jefe de cada estrella del día es de ese tipo (especie del tipo, si la hay en el grupo de la estrella) y su Teratipo
//    es ese tipo. El primero sigue siendo el de siempre.
//  · MISIÓN TEMÁTICA semanal: captura 3 Pokémon de ese tipo (en Captura o capturando a un jefe de Teraincursión). Premio, una vez por semana: 2 Tickets Gacha.
const crypto = require('crypto');
const { TYPES, BY_ID } = require('./pokedex');

const CAPTURE_BOOST = 3;
const MISSION_N = 3;
const MISSION_REWARD = { ticket: 2 };
const TZ = 'Europe/Madrid';
const DAY = 864e5;
const ICON = { normal: '⚪', fire: '🔥', water: '💧', electric: '⚡', grass: '🌿', ice: '❄️', fighting: '🥊', poison: '☠️', ground: '⛰️', flying: '🕊️', psychic: '🔮', bug: '🐛', rock: '🪨', ghost: '👻', dragon: '🐉', dark: '🌑', steel: '⚙️', fairy: '🧚' };
const ES = { normal: 'Normal', fire: 'Fuego', water: 'Agua', electric: 'Eléctrico', grass: 'Planta', ice: 'Hielo', fighting: 'Lucha', poison: 'Veneno', ground: 'Tierra', flying: 'Volador', psychic: 'Psíquico', bug: 'Bicho', rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón', dark: 'Siniestro', steel: 'Acero', fairy: 'Hada' };
const h32 = (s) => crypto.createHash('sha256').update(String(s)).digest().readUInt32BE(0);

// Fecha civil en España → nº de días desde 1970-01-01 (el 1-1-1970 fue jueves: lunes = (días + 3) mod 7 = 0).
const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function localParts(now) {
  const p = Object.fromEntries(FMT.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { dc: Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY), ms: ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000 };
}
const weekOfDay = (dc) => Math.floor((dc + 3) / 7);
// Tipo de una semana: dentro de cada ciclo de 18, los tipos van en un orden barajado de forma determinista.
function typeOfWeek(w) {
  const cycle = Math.floor(w / TYPES.length);
  const order = TYPES.slice().sort((a, b) => h32(`theme:${cycle}:${a}`) - h32(`theme:${cycle}:${b}`));
  return order[((w % TYPES.length) + TYPES.length) % TYPES.length];
}
// Tipo temático de un día UTC «AAAA-MM-DD» (lo usan las Teraincursiones, que rotan por día UTC).
function typeOfDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{1,3})$/.exec(String(day));
  if (!m) return typeOfWeek(weekOfDay(Math.floor(Date.now() / DAY)));
  return typeOfWeek(weekOfDay(Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY)));
}
// Instante (ms) en que empieza el día civil `dc` de España (se busca de cuarto de hora en cuarto de hora, así que también vale en los cambios de hora).
function exactStart(dc) {
  let t = dc * DAY - 3 * 3600e3;
  while (localParts(t).dc < dc || localParts(t).ms !== 0) { t += 60e3 * 15; if (t > dc * DAY + 3 * 3600e3) break; }
  return t;
}

let lastWeek = null; // la semana de la última consulta (casi todas las consultas caen en la misma: Captura la pide por cada especie de cada encuentro)
function weekAt(now = Date.now()) {
  if (lastWeek && now >= lastWeek.starts && now < lastWeek.ends) return lastWeek;
  const { dc } = localParts(now);
  const w = weekOfDay(dc);
  const monday = w * 7 - 3;
  lastWeek = { w, type: typeOfWeek(w), starts: exactStart(monday), ends: exactStart(monday + 7) };
  return lastWeek;
}
const ADJ = { electric: 'Eléctrica', psychic: 'Psíquica', flying: 'Voladora', dark: 'Siniestra' }; // «Semana Eléctrica», «Semana Psíquica»…
const info = (type) => ({ type, name: `Semana ${ADJ[type] || ES[type]}`, icon: ICON[type], typeName: ES[type] });

function state(now = Date.now()) {
  const k = weekAt(now);
  const nx = typeOfWeek(k.w + 1);
  return { ...info(k.type), week: k.w, starts: k.starts, ends: k.ends, boost: CAPTURE_BOOST, mission: { n: MISSION_N, reward: MISSION_REWARD }, next: { ...info(nx), starts: k.ends } };
}
const typeNow = (now = Date.now()) => weekAt(now).type;
// Peso de una especie en las tablas de encuentros de Captura esta semana.
const captureWeight = (id, now = Date.now()) => (BY_ID.get(id) && BY_ID.get(id).types.includes(typeNow(now)) ? CAPTURE_BOOST : 1);

// ---- Misión semanal ----
// u.theme = { w: semana, n: capturas del tipo, done: bool }
function mineOf(u, now = Date.now()) {
  const w = weekAt(now).w;
  if (!u.theme || u.theme.w !== w) u.theme = { w, n: 0, done: false };
  return u.theme;
}
function mine(u, now = Date.now()) {
  const m = mineOf(u, now);
  return { n: Math.min(MISSION_N, m.n), max: MISSION_N, done: m.done };
}
// Llamar al capturar un Pokémon (capture.finishCapture). Devuelve true si completó la misión con esta captura.
function onCapture(u, id, now = Date.now()) {
  if (!u || u.npc || !BY_ID.has(id)) return false;
  if (!BY_ID.get(id).types.includes(typeNow(now))) return false;
  const m = mineOf(u, now);
  if (m.done) return false;
  m.n++;
  if (m.n < MISSION_N) return false;
  m.done = true;
  const items = require('./items');
  const parts = [];
  for (const [k, q] of Object.entries(MISSION_REWARD)) { u.items[k] = (u.items[k] || 0) + q; parts.push(`${q}× ${items.ITEMS[k].name}`); }
  const text = `${info(typeNow(now)).icon} Misión de la ${info(typeNow(now)).name}: ${parts.join(', ')}`;
  require('./hub').emitUser(u.id, 'toast', { kind: 'quest', text: `🎯 ${text}` });
  require('./notify').push(u, { kind: 'quest', text: `🎯 ${text}`, link: '#/captura' });
  return true;
}

module.exports = { CAPTURE_BOOST, MISSION_N, MISSION_REWARD, ICON, ES, state, weekAt, typeOfWeek, typeOfDay, typeNow, captureWeight, mine, onCapture, info };

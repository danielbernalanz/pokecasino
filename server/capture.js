'use strict';
// Captura de Pokémon salvajes, lo más fiel posible a los juegos (Gen. 8/9) pero con RNG de casino y sin bucles de monedas rentables.
//
//  · RUTAS (capzones.js): tablas de encuentros por región y hora (daytime.js). Un encuentro se tira con los pesos de la tabla y cuesta 1 de los
//    DAILY (30) encuentros diarios del jugador (día UTC, como los demás topes). Un jugador solo puede tener un encuentro abierto.
//  · FÓRMULA REAL: a = ((3·PSmáx − 2·PSact) · ratio · bonusBall · bonusEstado) / (3·PSmáx)  (con el bonus de los juegos para niveles < 20);
//    si a ≥ 255 se captura sin más; si no, 4 sacudidas con b = 65536 / (255/a)^0,1875. Captura CRÍTICA según cuántas especies has registrado
//    (una sola sacudida). El ratio es el real de cada especie (catchdata.json, de PokeAPI).
//  · DEBILITAR: el jugador ataca con cualquier Pokémon libre de su Caja (daño sencillo de 5.ª generación con sus estadísticas reales) y puede
//    dormir / paralizar / quemar / envenenar / congelar con movimientos de estado. Dormir y congelar dan ×2,5 y el resto ×1,5. Falso Tortazo deja
//    siempre 1 PS. El salvaje no ataca (simplificación: no hay PS del equipo) pero puede HUIR (6 % por turno, nunca dormido ni congelado) y
//    puede DEBILITARSE (encuentro perdido).
//  · LEGENDARIOS DE ENCUENTRO: ratio real (3), nivel real, no huyen y solo se pueden capturar UNA vez por jugador; si escapan o se debilitan,
//    se puede volver a intentar otro día (un intento al día por legendario, que gasta un encuentro).
//  · APARICIONES MASIVAS (rotación determinista cada 4 h), MARCAS (hora, clima, rara 1/1000, tamaño) y TAMAÑOS (0–255) quedan guardados en el ejemplar.
//  · ECONOMÍA: capturar nunca da monedas. El valor de reventa del Pokémon capturado (polvo de liberar × 4, ver gacha.js) es siempre menor que
//    lo que cuesta, de media, la Poké Ball más barata que lo captura (test/capture.test.js).
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const items = require('./items');
const gacha = require('./gacha');
const specimen = require('./specimen');
const daytime = require('./daytime');
const balls = require('./balls');
const themes = require('./themes');
const movesMod = require('./moves');
const abilities = require('./abilities');
const Z = require('./capzones');
const { BY_ID, RARITY, effectiveness } = require('./pokedex');
const { rand } = require('./rng');

const CD = require('./catchdata.json').sp; // id → [ratio de captura, amistad base]

const DAILY = 30; // encuentros por jugador y día
const FLEE = 0.06; // probabilidad de huir por turno (nunca dormido ni congelado; los legendarios no huyen)
const TURN_LIMIT = 60; // pasado este número de turnos el salvaje se marcha
const SHINY_WILD = 1 / 1024;
const HA_CHANCE = 0.02; // habilidad oculta: rara, como en los juegos
const OUTBREAK_HOURS = 4;
const OUTBREAK_MS = OUTBREAK_HOURS * 3600e3;
const OUTBREAK_SHARE = 0.4; // en la zona de la aparición masiva, 4 de cada 10 encuentros son de esa especie
const WEATHER_MS = 6 * 3600e3;
const RAIN_WATER = 1.5; // con lluvia, los Agua salen más
const RARE_MARK = 1 / 1000;
const TIME_MARK = 1 / 50;
const WEATHER_MARK = 1 / 50;
const OUTBREAK_MARK = 1 / 10;
const FRIEND_BALL_FRIENDSHIP = 150;

const STATUS_BONUS = { slp: 2.5, frz: 2.5, par: 1.5, psn: 1.5, brn: 1.5, tox: 1.5 };
const STATUS_ES = { slp: 'dormido', frz: 'congelado', par: 'paralizado', psn: 'envenenado', brn: 'quemado', tox: 'gravemente envenenado' };
// Captura crítica (6.ª generación en adelante): multiplicador según las especies registradas.
const CRIT_TABLE = [[600, 2.5], [450, 2], [300, 1.5], [150, 1], [30, 0.5]];
const critMult = (species) => { for (const [min, m] of CRIT_TABLE) if (species > min) return m; return 0; };

const MARKS = {
  rare: { name: 'Marca Rara', title: 'el Excepcional', ico: '🌟' },
  jumbo: { name: 'Marca Jumbo', title: 'el Colosal', ico: '🦣' },
  mini: { name: 'Marca Mini', title: 'el Diminuto', ico: '🐜' },
  outbreak: { name: 'Marca de Aparición Masiva', title: 'el Multitudinario', ico: '👥' },
  rain: { name: 'Marca de Lluvia', title: 'el Empapado', ico: '🌧️' },
  fog: { name: 'Marca de Niebla', title: 'el Brumoso', ico: '🌫️' },
  dawn: { name: 'Marca del Amanecer', title: 'el Madrugador', ico: '🌅' },
  noon: { name: 'Marca del Mediodía', title: 'el Soleado', ico: '☀️' },
  dusk: { name: 'Marca del Atardecer', title: 'el Crepuscular', ico: '🌇' },
  night: { name: 'Marca de la Noche', title: 'el Noctámbulo', ico: '🌙' },
};
// Tamaño 0–255 (como la escala de altura de los juegos): la suma de dos dados da una campana con extremos muy raros.
const SIZES = [[0, 'Minúsculo'], [1, 'Diminuto'], [25, 'Pequeño'], [75, 'Normal'], [181, 'Grande'], [231, 'Enorme'], [255, 'Gigante']];
const sizeLabel = (s) => { let out = SIZES[0][1]; for (const [min, name] of SIZES) if (s >= min) out = name; return out; };
const rollSize = (rng = rand) => Math.floor(rng() * 129) + Math.floor(rng() * 128); // 0..255
// Título que da el tamaño (solo los extremos de verdad: Mini = 0, Jumbo = 255).
const sizeTitle = (s) => (s <= 0 ? 'Mini' : s >= 255 ? 'Jumbo' : null);

const h32 = (s) => crypto.createHash('sha1').update(String(s)).digest().readUInt32BE(0);
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
function weightedPick(list, w, rng) {
  const total = list.reduce((s, x) => s + w(x), 0);
  let r = rng() * total;
  for (const x of list) { r -= w(x); if (r < 0) return x; }
  return list[list.length - 1];
}

// ---------- Clima y apariciones masivas (deterministas: todos los jugadores ven lo mismo) ----------
// Solo en zonas al aire libre; 55 % despejado, 25 % lluvia, 20 % niebla; cambia cada 6 h.
function weatherOf(zoneId, now = Date.now()) {
  const z = Z.ZONE_BY_ID.get(zoneId);
  if (!z || z.kind === 'cave' || z.kind === 'tower') return 'clear';
  const r = h32(`wx:${zoneId}:${Math.floor(now / WEATHER_MS)}`) % 100;
  return r < 55 ? 'clear' : r < 80 ? 'rain' : 'fog';
}
// Aparición masiva: una por tramo de 4 h (6 al día), siempre la misma para todos, en una zona al aire libre accesible pronto.
function outbreakAt(now = Date.now()) {
  const slot = Math.floor(now / OUTBREAK_MS);
  const zones = Z.ZONES.filter((z) => z.kind !== 'tower' && z.open <= 5);
  const z = zones[h32(`ob-z:${slot}`) % zones.length];
  const all = z.enc.filter((e) => !e.t);
  const e = all[h32(`ob-s:${slot}`) % all.length];
  return { slot, zone: z.id, id: e.id, min: e.min, max: e.max, from: slot * OUTBREAK_MS, until: (slot + 1) * OUTBREAK_MS };
}

// ---------- Estado del jugador ----------
// u.cap = { day, n (encuentros de hoy), enc (el abierto), got: { id: t } (legendarios ya capturados), lt: { id: día } (último intento), st: totales }
function stateOf(u) {
  const c = (u.cap ||= { day: '', n: 0, enc: null, got: {}, lt: {}, st: {} });
  c.got ||= {}; c.lt ||= {}; c.st ||= {};
  const k = hub.dayKey();
  if (c.day !== k) { c.day = k; c.n = 0; }
  return c;
}
const bump = (c, k) => { c.st[k] = (c.st[k] || 0) + 1; };
const badgeCount = (u) => ((u.progress && u.progress.badges) || []).length;
const isChampion = (u) => !!(u.elite && u.elite.hof && u.elite.hof.length);
const speciesOwned = (u) => Object.values(u.collection || {}).filter((c) => c && c.n > 0).length;
const phaseOf = (now) => daytime.phase(now);

// Estado de un legendario para este jugador: 'ok' | 'got' | 'tried' (hoy) | 'locked' (faltan medallas / Liga).
function legendStatus(u, L, c = stateOf(u)) {
  if (c.got[L.id]) return 'got';
  if (badgeCount(u) < L.badges || (L.champ && !isChampion(u))) return 'locked';
  if (c.lt[L.id] === c.day) return 'tried';
  return 'ok';
}

// ---------- Datos de movimientos (el simulador solo se carga al atacar por primera vez) ----------
let PS = null;
const dex = () => (PS ||= require('pokemon-showdown')).Dex;
const INFLICT = new Set(['slp', 'par', 'psn', 'brn', 'tox', 'frz']);
const MOVE_CACHE = new Map();
function moveInfo(id) {
  if (MOVE_CACHE.has(id)) return MOVE_CACHE.get(id);
  const m = dex().moves.get(id);
  let out = null;
  if (m && m.exists) {
    const sec = m.secondary || (m.secondaries && m.secondaries[0]) || null;
    out = {
      id: m.id, type: String(m.type).toLowerCase(), cat: m.category, power: m.basePower || 0, acc: m.accuracy === true ? null : m.accuracy,
      status: INFLICT.has(m.status) ? m.status : null, sec: sec && INFLICT.has(sec.status) ? { chance: sec.chance || 0, status: sec.status } : null,
      damage: m.damage === undefined ? null : m.damage, ohko: !!m.ohko, hits: Array.isArray(m.multihit) ? 3 : (m.multihit || 1),
      noFaint: m.id === 'falseswipe' || m.id === 'holdback', selfdestruct: !!m.selfdestruct, powder: !!(m.flags && m.flags.powder),
      foe: ['normal', 'allAdjacentFoes', 'any', 'allAdjacent'].includes(m.target),
    };
  }
  MOVE_CACHE.set(id, out);
  return out;
}
const IMMUNE = { par: ['electric'], brn: ['fire'], psn: ['poison', 'steel'], tox: ['poison', 'steel'], frz: ['ice'], slp: [] };

// ---------- Fórmula de captura ----------
// Modificador por nivel bajo (8.ª generación): los Pokémon de nivel < 20 son más fáciles de capturar.
const levelMod = (level) => (level < 20 ? (30 - level) / 10 : 1);
function modifiedRate(enc, ballMult, status = enc.status) {
  const sb = STATUS_BONUS[status] || 1;
  return ((3 * enc.hpMax - 2 * enc.hp) * enc.rate * levelMod(enc.level) * ballMult * sb) / (3 * enc.hpMax);
}
const shakeB = (a) => Math.floor(65536 / Math.pow(255 / a, 0.1875));
// Resultado de un lanzamiento con `a` ya calculado: { crit, shakes (0–3 mostradas), caught }.
function roll(a, cm = 0, rng = rand) {
  if (a >= 255) return { crit: false, shakes: 3, caught: true };
  const b = shakeB(Math.max(a, 0.0001));
  const c = Math.floor((Math.min(255, a) * cm) / 6);
  if (c > 0 && Math.floor(rng() * 256) < c) return { crit: true, shakes: 1, caught: Math.floor(rng() * 65536) < b };
  let n = 0;
  for (let i = 0; i < 4; i++) { if (Math.floor(rng() * 65536) < b) n++; else break; }
  return { crit: false, shakes: Math.min(3, n), caught: n === 4 };
}
// Probabilidad exacta de captura de un lanzamiento (para tests y simulaciones).
function probability(a, cm = 0) {
  if (a >= 255) return 1;
  const p = shakeB(Math.max(a, 0.0001)) / 65536;
  const c = Math.min(1, Math.floor((Math.min(255, a) * cm) / 6) / 256);
  return c * p + (1 - c) * p ** 4;
}
const ratioOf = (id) => (CD[id] ? CD[id][0] : 45);

// ---------- Encuentros ----------
function wildStats(id, level, ivs, nature) {
  return BY_ID.get(id).stats.map((b, i) => {
    const core = Math.floor(((2 * b + ivs[i]) * level) / 100);
    return i === 0 ? core + level + 10 : Math.floor((core + 5) * specimen.natureMult(nature, i));
  });
}
function rollMark({ size, outbreak, weather, hour }, rng = rand) {
  if (rng() < RARE_MARK) return 'rare';
  if (size === 0) return 'mini';
  if (size === 255) return 'jumbo';
  if (outbreak && rng() < OUTBREAK_MARK) return 'outbreak';
  if ((weather === 'rain' || weather === 'fog') && rng() < WEATHER_MARK) return weather;
  const t = hour >= 5 && hour < 8 ? 'dawn' : hour >= 12 && hour < 15 ? 'noon' : hour >= 18 && hour < 21 ? 'dusk' : hour >= 22 || hour < 5 ? 'night' : null;
  if (t && rng() < TIME_MARK) return t;
  return null;
}
const isWater = (id) => BY_ID.get(id).types.includes('water');

// Elige la especie y el nivel de un encuentro normal en la zona.
function pickWild(z, now, rng) {
  const ph = phaseOf(now);
  const wx = weatherOf(z.id, now);
  const ob = outbreakAt(now);
  if (ob.zone === z.id && rng() < OUTBREAK_SHARE) return { id: ob.id, level: ri(rng, ob.min, ob.max), outbreak: true, wx };
  const pool = z.enc.filter((e) => !e.t || e.t === ph);
  const e = weightedPick(pool, (x) => x.w * (wx === 'rain' && isWater(x.id) ? RAIN_WATER : 1) * themes.captureWeight(x.id, now), rng); // (Semana temática: ×3 al tipo de la semana, ver themes.js)
  return { id: e.id, level: ri(rng, e.min, e.max), outbreak: false, wx };
}

function makeEncounter(u, z, now, rng, legend = null) {
  const w = legend ? { id: legend.id, level: legend.level, outbreak: false, wx: weatherOf(z.id, now) } : pickWild(z, now, rng);
  const ivs = Array.from({ length: 6 }, () => ri(rng, 0, 31));
  const nature = specimen.NATURES[ri(rng, 0, specimen.NATURES.length - 1)].name;
  const size = rollSize(rng);
  const stats = wildStats(w.id, w.level, ivs, nature);
  const hour = daytime.clock(now).hour;
  const ev = require('./events');
  return {
    zone: z.id, id: w.id, level: w.level, rate: ratioOf(w.id), ivs, nature, size, stats, hpMax: stats[0], hp: stats[0],
    shiny: rng() < SHINY_WILD * (ev.has('shiny') ? 2 : 1),
    ha: !!(movesMod.abilitiesOf(w.id).hidden && !legend && rng() < HA_CHANCE),
    mark: rollMark({ size, outbreak: w.outbreak, weather: w.wx, hour }, rng),
    status: null, sleep: 0, turn: 0, legend: !!legend, outbreak: w.outbreak, weather: w.wx, phase: phaseOf(now), at: now,
  };
}

const hpPct = (e) => (e.hp <= 0 ? 0 : Math.max(1, Math.ceil((100 * e.hp) / e.hpMax)));
// Lo que ve el jugador del encuentro (nada de IV, naturaleza, tamaño ni marca: se descubren al capturarlo).
const encView = (e) => e && ({ zone: e.zone, id: e.id, level: e.level, hp: hpPct(e), status: e.status, turn: e.turn, shiny: e.shiny, legend: e.legend, outbreak: e.outbreak, weather: e.weather, phase: e.phase });

// Multiplicador de cada Ball en el encuentro abierto (999 = captura segura): los juegos lo explican en la descripción de la Ball; aquí se muestra qué Balls rinden ahora.
function ballBonuses(u, e, now) {
  if (!e) return null;
  const owned = !!(u.collection[e.id] && u.collection[e.id].n > 0);
  const ctx = { night: phaseOf(now) === 'night', turn: e.turn, types: BY_ID.get(e.id).types, level: e.level, owned };
  return Object.fromEntries(balls.IDS.map((id) => { const b = balls.bonus(id, ctx); return [id, b === Infinity ? 999 : Math.round(b * 100) / 100]; }));
}

function view(u, now = Date.now()) {
  const c = stateOf(u);
  const ob = outbreakAt(now);
  return {
    ballBonus: ballBonuses(u, c.enc, now),
    now, max: DAILY, used: c.n, left: Math.max(0, DAILY - c.n), phase: phaseOf(now), enc: encView(c.enc),
    badges: badgeCount(u), champion: isChampion(u), species: speciesOwned(u), crit: critMult(speciesOwned(u)),
    outbreak: { zone: ob.zone, id: ob.id, from: ob.from, until: ob.until },
    zones: Z.ZONES.map((z) => ({ id: z.id, locked: badgeCount(u) < z.open, weather: weatherOf(z.id, now), legend: z.legend.map((L) => ({ id: L.id, status: legendStatus(u, L, c) })) })),
    stats: { caught: c.st.caught || 0, thrown: c.st.thrown || 0, fled: c.st.fled || 0, fainted: c.st.fainted || 0 },
  };
}

function encounter(u, p = {}, now = Date.now(), rng = rand) {
  if (u.npc) throw new Error('Los comerciantes NPC no capturan Pokémon.');
  const c = stateOf(u);
  if (c.enc) throw new Error('Ya tienes un encuentro en marcha: captúralo o huye primero.');
  if (c.n >= DAILY) throw new Error(`Hoy ya has tenido tus ${DAILY} encuentros. Vuelve mañana (el contador se reinicia a las 00:00 UTC).`);
  const z = Z.ZONE_BY_ID.get(String(p.zone));
  if (!z) throw new Error('Esa zona no existe.');
  if (badgeCount(u) < z.open) throw new Error(`${z.name} se abre con ${z.open} medalla${z.open > 1 ? 's' : ''} (llevas ${badgeCount(u)}).`);
  let legend = null;
  if (p.legend !== undefined && p.legend !== null && p.legend !== false) {
    legend = z.legend.find((L) => L.id === Number(p.legend));
    if (!legend) throw new Error('Ese legendario no está en esta zona.');
    const st = legendStatus(u, legend, c);
    if (st === 'got') throw new Error(`Ya capturaste a ${BY_ID.get(legend.id).name}: solo se puede una vez.`);
    if (st === 'locked') throw new Error(`${BY_ID.get(legend.id).name} exige ${legend.champ ? 'ser Campeón de la Liga' : `${legend.badges} medallas`}.`);
    if (st === 'tried') throw new Error(`Ya lo has intentado hoy con ${BY_ID.get(legend.id).name}: vuelve mañana.`);
  }
  c.n++;
  if (legend) c.lt[legend.id] = c.day; // el intento de hoy cuenta aunque escape o se debilite
  c.enc = makeEncounter(u, z, now, rng, legend);
  bump(c, 'encounters');
  db.save();
  return { ...view(u, now), msg: legend ? `¡${BY_ID.get(legend.id).name} apareció!` : `¡Ha aparecido un ${BY_ID.get(c.enc.id).name} salvaje!` };
}

function needEnc(u) {
  const c = stateOf(u);
  if (!c.enc) throw new Error('No tienes ningún encuentro abierto.');
  return [c, c.enc];
}
const nameOf = (id) => BY_ID.get(id).name;
function endEnc(u, c, how) {
  const e = c.enc;
  c.enc = null;
  bump(c, how);
  db.save();
  return e;
}

// Final de turno: el estado avanza, el salvaje puede huir. Devuelve null o 'fled'.
function endTurn(c, e, log, rng, fresh) {
  e.turn++;
  if (e.status === 'psn' || e.status === 'brn' || e.status === 'tox') {
    const d = Math.max(1, Math.floor(e.hpMax / (e.status === 'psn' ? 8 : 16)));
    e.hp = Math.max(1, e.hp - d); // sin llegar a debilitarlo: el veneno nunca remata
    log.push(`¡${nameOf(e.id)} sufre por ${e.status === 'brn' ? 'la quemadura' : 'el veneno'}!`);
  }
  if (!fresh && (e.status === 'slp' || e.status === 'frz')) {
    e.sleep--;
    if (e.sleep <= 0) { log.push(`¡${nameOf(e.id)} ${e.status === 'slp' ? 'se ha despertado' : 'se ha descongelado'}!`); e.status = null; }
  }
  if (!e.legend && e.status !== 'slp' && e.status !== 'frz' && (rng() < FLEE || e.turn >= TURN_LIMIT)) {
    log.push(`¡${nameOf(e.id)} salvaje ha huido!`);
    return 'fled';
  }
  return null;
}

// Equipo disponible para atacar: ejemplares de la Caja que no estén fuera, con sus movimientos equipados y los datos que necesita la pantalla.
function team(u) {
  if (u.npc) throw new Error('Los comerciantes NPC no capturan Pokémon.');
  specimen.syncAll(u);
  const out = [];
  for (const [id, arr] of Object.entries(u.mons || {})) {
    for (const m of arr) {
      if (m.away) continue;
      movesMod.ensure(Number(id), m);
      const mv = (m.sdMoves || []).map((x) => ({ x, i: moveInfo(x) })).filter(({ i }) => i).map(({ x, i }) => ({ id: x, name: movesMod.name(x), type: i.type, cat: i.cat, power: i.power, status: i.status }));
      out.push({ id: Number(id), uid: m.uid, level: m.level, nick: m.nick, shiny: !!m.shiny, buddy: !!(u.buddy && u.buddy.id === Number(id) && u.buddy.uid === m.uid), moves: mv });
    }
  }
  out.sort((a, b) => (b.buddy - a.buddy) || (b.level - a.level) || (a.id - b.id));
  return { mons: out.slice(0, 120), total: out.length };
}

// Daño sencillo de 5.ª generación (sin críticos ni clima). `atk` y `def` son las estadísticas reales.
function damage(info, attacker, level, types, e, rng) {
  if (info.damage !== null) return info.damage === 'level' ? level : Number(info.damage) || 0;
  if (info.ohko) return e.hp;
  const power = (info.power || 60) * (info.hits > 1 ? info.hits : 1);
  const special = info.cat === 'Special';
  const a = special ? attacker[3] : attacker[1];
  const d = special ? e.stats[4] : e.stats[2];
  const base = Math.floor(Math.floor((Math.floor((2 * level) / 5) + 2) * power * a / Math.max(1, d)) / 50) + 2;
  const stab = types.includes(info.type) ? 1.5 : 1;
  const eff = effectiveness(info.type, BY_ID.get(e.id).types);
  if (eff === 0) return 0;
  return Math.max(1, Math.floor(base * stab * eff * (0.85 + rng() * 0.15)));
}

// Ataca con un Pokémon de la Caja: baja los PS o aplica un estado. Gasta un turno.
function attack(u, p = {}, now = Date.now(), rng = rand) {
  if (u.npc) throw new Error('Los comerciantes NPC no capturan Pokémon.');
  const [c, e] = needEnc(u);
  const m = specimen.find(u, { id: p.id, uid: p.uid });
  const id = Number(p.id);
  specimen.assertFree(m, nameOf(id));
  movesMod.ensure(id, m);
  const mid = String(p.move || '');
  if (!(m.sdMoves || []).includes(mid)) throw new Error('Ese Pokémon no lleva ese movimiento equipado.');
  const info = moveInfo(mid);
  if (!info) throw new Error('Movimiento no válido.');
  const me = m.nick || nameOf(id);
  const log = [`¡${me} usó ${movesMod.name(mid)}!`];
  const before = hpPct(e);
  let fresh = false;
  let faint = false;
  if (info.selfdestruct) throw new Error('Ese movimiento debilitaría a tu Pokémon: no tiene sentido contra un Pokémon que quieres capturar.');
  if (info.cat === 'Status') {
    if (!info.status || !info.foe) throw new Error('Ese movimiento no sirve para debilitar ni para dejar un estado al Pokémon salvaje.');
    const types = BY_ID.get(e.id).types;
    if (e.status) log.push(`¡${nameOf(e.id)} ya tiene un problema de estado! No ha servido de nada.`);
    else if ((IMMUNE[info.status] || []).some((t) => types.includes(t)) || (info.powder && types.includes('grass')) || (mid === 'thunderwave' && effectiveness('electric', types) === 0)) log.push(`No afecta a ${nameOf(e.id)}…`);
    else if (info.acc !== null && rng() * 100 >= info.acc) log.push('¡Pero ha fallado!');
    else {
      e.status = info.status;
      e.sleep = info.status === 'slp' ? 2 + Math.floor(rng() * 3) : info.status === 'frz' ? 3 : 0; // dormido 2–4 turnos
      fresh = true;
      log.push(`¡${nameOf(e.id)} está ${STATUS_ES[info.status]}!`);
    }
  } else if (info.acc !== null && !info.ohko && rng() * 100 >= info.acc) {
    log.push('¡Pero ha fallado!');
  } else if (info.ohko && rng() * 100 >= 30) {
    log.push('¡Pero ha fallado!');
  } else if (mid === 'dreameater' && e.status !== 'slp') {
    log.push('No afecta a un Pokémon despierto…');
  } else {
    const atk = specimen.computeStats(id, m, m.level);
    let dmg = damage(info, atk, m.level, BY_ID.get(id).types, e, rng);
    if (dmg <= 0) log.push(`No afecta a ${nameOf(e.id)}…`);
    else {
      const eff = info.damage === null && !info.ohko ? effectiveness(info.type, BY_ID.get(e.id).types) : 1;
      if (info.noFaint && dmg >= e.hp) dmg = e.hp - 1;
      e.hp = Math.max(0, e.hp - dmg);
      if (eff > 1) log.push('¡Es muy eficaz!'); else if (eff < 1) log.push('No es muy eficaz…');
      if (e.hp <= 0) faint = true;
      else if (info.sec && !e.status && rng() * 100 < info.sec.chance && !(IMMUNE[info.sec.status] || []).some((t) => BY_ID.get(e.id).types.includes(t))) {
        e.status = info.sec.status; e.sleep = info.sec.status === 'slp' ? 2 + Math.floor(rng() * 3) : info.sec.status === 'frz' ? 3 : 0; fresh = true;
        log.push(`¡${nameOf(e.id)} está ${STATUS_ES[info.sec.status]}!`);
      }
    }
  }
  if (faint) {
    log.push(`¡${nameOf(e.id)} salvaje se ha debilitado! El encuentro se pierde.`);
    endEnc(u, c, 'fainted');
    return { ...view(u, now), log, before, after: 0, ended: 'fainted', gone: e.id };
  }
  const gone = endTurn(c, e, log, rng, fresh);
  if (gone) { endEnc(u, c, 'fled'); return { ...view(u, now), log, before, after: before, ended: 'fled', gone: e.id }; }
  db.save();
  return { ...view(u, now), log, before, after: hpPct(e), ended: null };
}

// Lanza una Ball. Con la captura, el Pokémon entra en la colección como cualquier otro ejemplar (Pokédex, Caja PC…).
function throwBall(u, p = {}, now = Date.now(), rng = rand) {
  if (u.npc) throw new Error('Los comerciantes NPC no capturan Pokémon.');
  const [c, e] = needEnc(u);
  const ballId = String(p.ball || '');
  if (!balls.isBall(ballId)) throw new Error('Esa Ball no existe.');
  if (!(u.items[ballId] > 0)) throw new Error(`No te queda ninguna ${balls.nameOf(ballId)}.`);
  const pk = BY_ID.get(e.id);
  const owned = !!(u.collection[e.id] && u.collection[e.id].n > 0);
  const mult = balls.bonus(ballId, { night: phaseOf(now) === 'night', turn: e.turn, types: pk.types, level: e.level, owned });
  items.take(u, ballId);
  const log = [`¡Lanzaste una ${balls.nameOf(ballId)}!`];
  bump(c, 'thrown');
  const master = mult === Infinity;
  const a = master ? 255 : modifiedRate(e, mult);
  const r = roll(a, master ? 0 : critMult(speciesOwned(u)), rng);
  if (r.caught) {
    log.push(r.crit ? '¡Captura crítica!' : '', `¡Has capturado a ${pk.name}!`);
    const got = finishCapture(u, e, ballId, now);
    endEnc(u, c, 'caught');
    if (e.legend) c.got[e.id] = now;
    db.save();
    return { ...view(u, now), log: log.filter(Boolean), ball: ballId, shakes: r.shakes, crit: r.crit, caught: true, got };
  }
  log.push(r.shakes === 0 ? '¡Oh, no! ¡El Pokémon se ha escapado!' : r.shakes === 1 ? '¡Vaya, parecía que lo habías atrapado!' : r.shakes === 2 ? '¡Qué lástima! ¡Casi lo atrapas!' : '¡Has estado muy cerca!');
  const gone = endTurn(c, e, log, rng, false);
  if (gone) { endEnc(u, c, 'fled'); return { ...view(u, now), log, ball: ballId, shakes: r.shakes, crit: r.crit, caught: false, ended: 'fled', gone: e.id }; }
  db.save();
  return { ...view(u, now), log, ball: ballId, shakes: r.shakes, crit: r.crit, caught: false, ended: null };
}

function finishCapture(u, e, ballId, now) {
  const id = e.id;
  const pk = BY_ID.get(id);
  const before = new Set(specimen.sync(u, id).map((m) => m.uid));
  const g = gacha.grant(u, id, e.shiny);
  const m = specimen.sync(u, id).find((x) => !before.has(x.uid)) || null;
  if (m) {
    m.level = e.level;
    m.exp = require('./exp').expAt(id, e.level);
    m.ivs = e.ivs.slice();
    m.nature = e.nature;
    delete m.mv; delete m.learned; delete m.sdMoves; delete m.pending; // los movimientos salen del nivel real
    movesMod.ensure(id, m);
    abilities.resolve(id, m);
    if (e.ha) { m.ha = true; abilities.resolve(id, m); } // habilidad oculta (rara)
    m.friendship = ballId === 'friend-ball' ? FRIEND_BALL_FRIENDSHIP : (CD[id] ? CD[id][1] : 70);
    m.ball = ballId;
    m.size = e.size;
    if (e.mark) m.mark = e.mark;
    m.caught = { zone: e.zone, level: e.level, at: now, legend: !!e.legend, outbreak: !!e.outbreak };
    m.at = now;
  }
  themes.onCapture(u, id, now); // misión de la semana temática
  const rare = pk.rarity === 'L' || pk.rarity === 'M';
  const z = Z.ZONE_BY_ID.get(e.zone);
  if (rare) hub.feed('capture', `🎯 ${u.username} ha capturado a ${pk.name} salvaje en ${z ? z.name : 'su ruta'}`, { pokeId: id, shiny: e.shiny });
  else if (e.shiny && pk.rarity !== 'C') hub.feed('capture', `🎯✨ ${u.username} ha capturado un ${pk.name} VARIOCOLOR salvaje`, { pokeId: id, shiny: true });
  const sz = sizeTitle(e.size);
  return {
    id, uid: m ? m.uid : null, name: pk.name, level: e.level, shiny: e.shiny, isNew: g.isNew, dust: g.dust, stars: g.stars, ball: ballId,
    ivs: e.ivs.slice(), ivTotal: e.ivs.reduce((s, x) => s + x, 0), nature: e.nature, ha: !!e.ha, size: e.size, sizeLabel: sizeLabel(e.size), sizeTitle: sz,
    mark: e.mark || null, legend: !!e.legend, outbreak: !!e.outbreak, ability: m ? abilities.name(m.sdAbility) : null,
  };
}

function run(u) {
  const [c, e] = needEnc(u);
  endEnc(u, c, 'ran');
  return { ...view(u), log: [`Huiste de ${nameOf(e.id)}.`], ended: 'ran' };
}

// Valor máximo en monedas de un Pokémon capturado de la especie `id`, tal cual (lo que se saca liberándolo o vendiéndolo a un PNJ, con la
// esperanza del variocolor): polvo de liberar × DUST_RATE. La evolución posterior no cuenta aquí: está acotada por los topes diarios de EXP y
// amistad (docs/ANTIABUSO.md, «Evolución + transferir», y test/progression.test.js). Se usa en test/capture.test.js.
function resaleValue(id) {
  return RARITY[BY_ID.get(id).rarity].dust * gacha.DUST_RATE * (1 + 2 * SHINY_WILD * 2); // variocolor: 3 × el valor, 1/1024 de las veces (el doble con el evento)
}

const STATIC = {
  daily: DAILY, flee: FLEE, shiny: SHINY_WILD, ha: HA_CHANCE, outbreakHours: OUTBREAK_HOURS, outbreakShare: OUTBREAK_SHARE, turnLimit: TURN_LIMIT,
  statusBonus: STATUS_BONUS, statusEs: STATUS_ES, critTable: CRIT_TABLE, marks: MARKS, sizes: SIZES, rareMark: RARE_MARK,
  zones: Z.ZONES.map((z) => ({ id: z.id, name: z.name, region: z.region, regionName: z.regionName, kind: z.kind, tone: z.tone, hostId: z.hostId, desc: z.desc, open: z.open, enc: z.enc, legend: z.legend })),
  legends: Z.LEGENDS, ratio: Object.fromEntries([...new Set(Z.ZONES.flatMap((z) => [...z.enc.map((e) => e.id), ...z.legend.map((l) => l.id)]))].map((id) => [id, ratioOf(id)])),
};

module.exports = {
  DAILY, FLEE, SHINY_WILD, HA_CHANCE, OUTBREAK_SHARE, OUTBREAK_HOURS, STATUS_BONUS, CRIT_TABLE, MARKS, SIZES, FRIEND_BALL_FRIENDSHIP, STATIC,
  critMult, sizeLabel, sizeTitle, rollSize, weatherOf, outbreakAt, stateOf, legendStatus, moveInfo, levelMod, modifiedRate, shakeB, roll, probability, ratioOf, wildStats,
  makeEncounter, view, encounter, team, attack, throwBall, run, resaleValue, hpPct, finishCapture,
};

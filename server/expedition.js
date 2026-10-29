'use strict';
// Fase B6 «Expediciones AFK»: envía de 1 a 3 Pokémon de la Caja PC a una zona durante 1, 4, 8 o 12 horas reales.
// Al volver dan caramelos (de la familia de cada participante y comodín), bayas, polvo, algún objeto raro, EXP (niveles sin
// caramelos), amistad y un hallazgo PEQUEÑO de monedas. Nunca dan Pokémon. Los ejemplares fuera llevan `away = 'exp:<id>'`
// y no se pueden liberar, transferir, vender, regalar, intercambiar, evolucionar ni llevar a combates (ver specimen.assertFree).
// Valor máximo diario por jugador (ver docs/BALANCE.md): monedas ≤ 300 + polvo ≤ 20 ✦ (= 80 monedas) + 1 objeto raro (≤ 172) = 552.
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const items = require('./items');
const bond = require('./bond');
const specimen = require('./specimen');
const gacha = require('./gacha');
const { BY_ID } = require('./pokedex');
const { rand, randInt, pick } = require('./rng');

const HOUR = 3600 * 1000;
const HOURS = [1, 4, 8, 12];
const MAX_TEAM = 3;
const SLOTS = 2;
const SLOT3_LEVEL = 15; // nivel de entrenador para la tercera expedición simultánea
const MAX_LEVEL = 100;

const MATCH_BONUS = 0.5; // +50 % de recompensas del ejemplar si comparte tipo con la zona
const CANDY_PER_HOUR = 1; // caramelos de su familia por hora y participante
const WILD_PER_HOUR = 1; // caramelos comodín por hora (por expedición, no por participante)
const LEVEL_EVERY = 2; // +1 nivel cada 2 h de expedición, por participante
const LEVEL_DAY_CAP = 8; // niveles por ejemplar y día (ganados fuera: sin caramelos)
const FRIEND_PER_HOUR = 5; // con tope diario `bond.CAP.exp` por ejemplar
const COIN_PER_HOUR = 8; // × (1 + 0,5 × proporción de participantes que coinciden con la zona)
const COIN_DAY_CAP = 300;
const DUST_DAY_CAP = 20;
const RARE_DAY_CAP = 1; // entre Ticket Gacha y Huevo Misterioso
const RARE_CHANCE = { 8: 0.1, 12: 0.2 };
const EGG_SHARE = 0.3; // de las veces que toca objeto raro, ¿huevo en vez de ticket?
const BERRY_CAP = bond.BERRY_CAP;

// Zona → tipos favorecidos y anfitrión (Pokémon amable que te despide y te recibe).
const ZONES = [
  { id: 'bosque', name: 'Bosque Verde', host: 'Caterpie', hostId: 10, types: ['bug', 'grass'], tone: 'g', desc: 'Hojas, setas y mucho zumbido.' },
  { id: 'cueva', name: 'Cueva Celeste', host: 'Geodude', hostId: 74, types: ['rock', 'ground', 'ghost'], tone: 'b', desc: 'Cristales azules y ecos misteriosos.' },
  { id: 'mar', name: 'Mar Espuma', host: 'Lapras', hostId: 131, types: ['water', 'ice'], tone: 'b', desc: 'Olas tranquilas y témpanos flotando.' },
  { id: 'volcan', name: 'Volcán Canela', host: 'Slugma', hostId: 218, types: ['fire'], tone: 'r', desc: 'Rocas tibias que huelen a canela.' },
  { id: 'central', name: 'Central Energía', host: 'Pikachu', hostId: 25, types: ['electric', 'steel'], tone: 'y', desc: 'Zumbidos eléctricos y engranajes.' },
  { id: 'torre', name: 'Torre Dragón', host: 'Dratini', hostId: 147, types: ['dragon', 'flying'], tone: 'p', desc: 'Una torre entre las nubes.' },
  { id: 'jardin', name: 'Jardín Hada', host: 'Clefairy', hostId: 35, types: ['fairy', 'psychic'], tone: 'p', desc: 'Luz de luna, flores y polvo brillante.' },
  { id: 'barrio', name: 'Barrio Oscuro', host: 'Meowth', hostId: 52, types: ['dark', 'fighting', 'poison'], tone: 'r', desc: 'Callejones, dojos y charcos raros.' },
];
const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

const STATIC = {
  zones: ZONES, hours: HOURS, maxTeam: MAX_TEAM, slots: SLOTS, slot3Level: SLOT3_LEVEL,
  caps: { coins: COIN_DAY_CAP, dust: DUST_DAY_CAP, rare: RARE_DAY_CAP, levels: LEVEL_DAY_CAP }, matchBonus: MATCH_BONUS,
  levelEvery: LEVEL_EVERY, friendPerHour: FRIEND_PER_HOUR,
};

const maxSlots = (u) => (u.level >= SLOT3_LEVEL ? SLOTS + 1 : SLOTS);
const expsOf = (u) => (u.expeditions ||= []);

function dayOf(u) {
  const k = hub.dayKey();
  if (!u.expDay || u.expDay.day !== k) u.expDay = { day: k, coins: 0, dust: 0, rare: 0 };
  return u.expDay;
}
// Valor máximo teórico por día en monedas (polvo a 4 monedas y el objeto raro más valioso al tope de compra de un PNJ).
const RARE_VALUE = 172;
const dailyMaxValue = () => COIN_DAY_CAP + DUST_DAY_CAP * gacha.DUST_RATE + RARE_DAY_CAP * RARE_VALUE;

const matches = (zone, pid) => BY_ID.get(pid).types.some((t) => zone.types.includes(t));

// Encuentra el ejemplar de un miembro del equipo sin lanzar error si ya no está.
function lookup(u, t) {
  const arr = (u.mons && u.mons[t.id]) || [];
  return arr.find((m) => m.uid === t.uid) || null;
}

function view(u) {
  const now = Date.now();
  const d = dayOf(u);
  return {
    now, slots: maxSlots(u),
    exps: expsOf(u).map((e) => ({ id: e.id, zone: e.zone, hours: e.hours, start: e.start, end: e.end, ready: now >= e.end, team: e.team.map((t) => ({ id: t.id, uid: t.uid, shiny: !!(lookup(u, t) || {}).shiny })) })),
    left: { coins: COIN_DAY_CAP - d.coins, dust: DUST_DAY_CAP - d.dust, rare: RARE_DAY_CAP - d.rare },
  };
}

function send(u, p) {
  if (u.npc) throw new Error('Los comerciantes NPC no van de expedición.');
  const zone = ZONE_BY_ID.get(String(p.zone));
  if (!zone) throw new Error('Esa zona no existe.');
  const hours = Number(p.hours);
  if (!HOURS.includes(hours)) throw new Error('Duración no válida.');
  const exps = expsOf(u);
  if (exps.length >= maxSlots(u)) throw new Error(`Ya tienes ${exps.length} expediciones en marcha${u.level < SLOT3_LEVEL ? ` (la tercera se desbloquea en el nivel ${SLOT3_LEVEL})` : ''}.`);
  const team = Array.isArray(p.team) ? p.team : [];
  if (team.length < 1 || team.length > MAX_TEAM) throw new Error(`El equipo lleva de 1 a ${MAX_TEAM} Pokémon.`);
  const seen = new Set();
  const found = team.map((t) => {
    const m = specimen.find(u, { id: t && t.id, uid: t && t.uid });
    if (seen.has(m.uid)) throw new Error('Ejemplar repetido en el equipo.');
    seen.add(m.uid);
    specimen.assertFree(m, BY_ID.get(Number(t.id)).name);
    return { m, id: Number(t.id) };
  });
  const now = Date.now();
  const e = { id: crypto.randomBytes(4).toString('hex'), zone: zone.id, hours, start: now, end: now + hours * HOUR, team: found.map((x) => ({ id: x.id, uid: x.m.uid })) };
  for (const x of found) x.m.away = 'exp:' + e.id;
  exps.push(e);
  db.save();
  return view(u);
}

function claim(u, p) {
  const exps = expsOf(u);
  const i = exps.findIndex((x) => x.id === String(p.id));
  if (i < 0) throw new Error('Esa expedición no existe.');
  const e = exps[i];
  const now = Date.now();
  if (now < e.end) throw new Error('Todavía no han vuelto.');
  const zone = ZONE_BY_ID.get(e.zone);
  const H = e.hours;
  const d = dayOf(u);
  const candy = require('./candy');
  const out = { zone: zone.id, hours: H, members: [], candy: {}, wild: 0, berries: {}, dust: 0, coins: 0, item: null, friend: 0 };
  // Participantes que siguen existiendo (si una especie se bloqueó, simplemente no cuenta).
  const live = e.team.map((t) => ({ t, m: lookup(u, t) })).filter((x) => x.m);
  const n = live.length;
  let matched = 0;
  for (const { t, m } of live) {
    const hit = matches(zone, t.id);
    if (hit) matched++;
    const avgBoost = 1 + m.level / 200; // hasta +50 % a Nv. 100
    const c = Math.max(1, Math.round(H * CANDY_PER_HOUR * (hit ? 1 + MATCH_BONUS : 1) * avgBoost));
    candy.addCandy(u, t.id, c);
    out.candy[t.id] = (out.candy[t.id] || 0) + c;
    // EXP: niveles sin caramelos (tope diario por ejemplar y nivel 100).
    const from = m.level;
    const xd = (m.xd && m.xd.day === hub.dayKey()) ? m.xd : (m.xd = { day: hub.dayKey(), n: 0 });
    const lv = Math.max(0, Math.min(Math.floor(H / LEVEL_EVERY), LEVEL_DAY_CAP - xd.n, MAX_LEVEL - m.level));
    m.level += lv;
    xd.n += lv;
    const fr = bond.addFriend(m, FRIEND_PER_HOUR * H, 'exp');
    out.friend += fr;
    out.members.push({ id: t.id, uid: t.uid, from, to: m.level, friend: fr, match: hit, candy: c });
    delete m.away;
  }
  // Los que ya no están (bloqueados, etc.) no se cuentan; el resto del botín sigue su curso.
  if (n) {
    out.wild = Math.round(H * WILD_PER_HOUR);
    candy.addWild(u, out.wild);
    const rolls = Math.ceil(H / 4);
    for (let k = 0; k < rolls; k++) {
      const b = pick(Object.keys(items.BERRIES));
      const q = randInt(1, 2);
      const before = (bond.berriesOf(u)[b] || 0);
      bond.giveBerry(u, b, q);
      const got = (bond.berriesOf(u)[b] || 0) - before;
      if (got > 0) out.berries[b] = (out.berries[b] || 0) + got;
    }
    const dust = Math.max(0, Math.min(randInt(H, 2 * H), DUST_DAY_CAP - d.dust));
    if (dust) { u.dust += dust; d.dust += dust; out.dust = dust; }
    if (RARE_CHANCE[H] && d.rare < RARE_DAY_CAP && rand() < RARE_CHANCE[H]) {
      const it = rand() < EGG_SHARE ? 'mystery-egg' : 'ticket';
      items.give(u, it, 1);
      d.rare++;
      out.item = it;
    }
    const coins = Math.max(0, Math.min(Math.round(H * COIN_PER_HOUR * (1 + MATCH_BONUS * matched / n)), COIN_DAY_CAP - d.coins));
    if (coins) { u.coins += coins; d.coins += coins; hub.ledger(u, coins, 'expedition', zone.name); out.coins = coins; }
  }
  // Por si algún ejemplar quedó marcado y ya no está en el equipo (no debería).
  exps.splice(i, 1);
  db.save();
  return { ...view(u), reward: out };
}

module.exports = {
  ZONES, ZONE_BY_ID, STATIC, HOURS, MAX_TEAM, SLOTS, SLOT3_LEVEL, MATCH_BONUS, CANDY_PER_HOUR, WILD_PER_HOUR, LEVEL_EVERY, LEVEL_DAY_CAP, FRIEND_PER_HOUR,
  COIN_PER_HOUR, COIN_DAY_CAP, DUST_DAY_CAP, RARE_DAY_CAP, RARE_CHANCE, RARE_VALUE, BERRY_CAP, maxSlots, dailyMaxValue, view, send, claim,
};

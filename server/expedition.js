'use strict';
// Fase B6 «Expediciones AFK»: envía de 1 a 3 Pokémon de la Caja PC a una zona durante 1, 4, 8 o 12 horas reales.
// Al volver dan EXP (como en los juegos; con el tope diario por ejemplar de exp.js), Caramelos Exp., bayas, polvo, algún objeto raro,
// amistad y un hallazgo PEQUEÑO de monedas. Nunca dan Pokémon. Los ejemplares fuera llevan `away = 'exp:<id>'`
// y no se pueden liberar, transferir, vender, regalar, intercambiar, evolucionar ni llevar a combates (ver specimen.assertFree).
// Valor máximo diario por jugador (ver docs/BALANCE.md): monedas ≤ 300 + polvo ≤ 20 ✦ (= 80 monedas) + 1 objeto raro (≤ 172) = 552.
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const items = require('./items');
const bond = require('./bond');
const specimen = require('./specimen');
const gacha = require('./gacha');
const evs = require('./evs');
const daytime = require('./daytime');
const { BY_ID } = require('./pokedex');
const { rand, randInt, pick, weighted } = require('./rng');

const HOUR = 3600 * 1000;
const HOURS = [1, 4, 8, 12];
const MAX_TEAM = 3;
const SLOTS = 2;
const SLOT3_LEVEL = 15; // nivel de entrenador para la tercera expedición simultánea

const MATCH_BONUS = 0.5; // +50 % de recompensas del ejemplar si comparte tipo con la zona
// EXP por hora y participante: EXP_BASE + EXP_LEVEL × nivel (a Nv. 50 ≈ 700/h; una expedición de 12 h ≈ 8.400). Se suma al tope diario por ejemplar (exp.js).
const EXP_BASE = 300;
const EXP_LEVEL = 8;
// Caramelos Exp. como botín: ⌈H/4⌉ tiradas por expedición (XS 60 % · S 30 % · M 10 %, 1-2 cada vez) con tope diario; en las largas, a veces uno L.
const CANDY_WEIGHTS = [['exp-xs', 60], ['exp-s', 30], ['exp-m', 10]];
const CANDY_DAY_CAP = 8; // caramelos Exp. al día por jugador desde expediciones
const BIG_CHANCE = { 8: 0.05, 12: 0.12 }; // un Caramelo Exp. L (10.000 EXP), máx. 1 al día
const LUCKY_CHANCE = { 8: 0.01, 12: 0.03 }; // un Huevo Suerte (objeto equipable), máx. 1 al día
const FRIEND_PER_HOUR = 5; // con tope diario `bond.CAP.exp` por ejemplar
const COIN_PER_HOUR = 8; // × (1 + 0,5 × proporción de participantes que coinciden con la zona)
const COIN_DAY_CAP = 300;
const DUST_DAY_CAP = 20;
const RARE_DAY_CAP = 1; // entre Ticket Gacha y Huevo Misterioso
const RARE_CHANCE = { 8: 0.1, 12: 0.2 };
const EGG_SHARE = 0.3; // de las veces que toca objeto raro, ¿huevo en vez de ticket?
const BERRY_CAP = bond.BERRY_CAP;
// Objetos de evolución como botín raro (aparte del objeto raro de arriba, con su propio tope): solo en expediciones largas.
// Sin valor en monedas: los PNJ no los compran ni se reciclan (ver npc.js y candy.js); entre jugadores se comercian libremente.
const EVO_CHANCE = { 8: 0.06, 12: 0.12 };
const EVO_DAY_CAP = 1;
const ZONE_EVO = {
  bosque: ['leaf-stone', 'sun-stone', 'tart-apple', 'sweet-apple'], cueva: ['moon-stone', 'dusk-stone', 'oval-stone', 'deep-sea-tooth'],
  mar: ['water-stone', 'ice-stone', 'prism-scale', 'deep-sea-scale', 'kings-rock'], volcan: ['fire-stone', 'magmarizer', 'sun-stone'],
  central: ['thunder-stone', 'electirizer', 'up-grade', 'metal-coat', 'protector'], torre: ['dragon-scale', 'sun-stone', 'razor-claw'],
  jardin: ['moon-stone', 'shiny-stone', 'dawn-stone', 'sachet', 'whipped-dream'], barrio: ['dusk-stone', 'razor-claw', 'razor-fang', 'reaper-cloth', 'dubious-disc'],
};

// Zona → tipos favorecidos y anfitrión (Pokémon amable que te despide y te recibe).
const ZONES = [
  { id: 'bosque', name: 'Bosque Verde', host: 'Caterpie', hostId: 10, types: ['bug', 'grass'], ev: 0, tone: 'g', desc: 'Hojas, setas y mucho zumbido.' },
  { id: 'cueva', name: 'Cueva Celeste', host: 'Geodude', hostId: 74, types: ['rock', 'ground', 'ghost'], ev: 2, tone: 'b', desc: 'Cristales azules y ecos misteriosos.' },
  { id: 'mar', name: 'Mar Espuma', host: 'Lapras', hostId: 131, types: ['water', 'ice'], ev: 4, tone: 'b', desc: 'Olas tranquilas y témpanos flotando.' },
  { id: 'volcan', name: 'Volcán Canela', host: 'Slugma', hostId: 218, types: ['fire'], ev: 3, tone: 'r', desc: 'Rocas tibias que huelen a canela.' },
  { id: 'central', name: 'Central Energía', host: 'Pikachu', hostId: 25, types: ['electric', 'steel'], ev: 5, tone: 'y', desc: 'Zumbidos eléctricos y engranajes.' },
  { id: 'torre', name: 'Torre Dragón', host: 'Dratini', hostId: 147, types: ['dragon', 'flying'], ev: 1, tone: 'p', desc: 'Una torre entre las nubes.' },
  { id: 'jardin', name: 'Jardín Hada', host: 'Clefairy', hostId: 35, types: ['fairy', 'psychic'], ev: 4, tone: 'p', desc: 'Luz de luna, flores y polvo brillante.' },
  { id: 'barrio', name: 'Barrio Oscuro', host: 'Meowth', hostId: 52, types: ['dark', 'fighting', 'poison'], ev: 1, tone: 'r', desc: 'Callejones, dojos y charcos raros.' },
];
// `ev`: estadística que entrena la zona (+4 EV por hora y participante, tope diario por ejemplar: ver evs.js). 0 PS · 1 Ataque · 2 Defensa · 3 At. Esp. · 4 Def. Esp. · 5 Velocidad.
const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

const STATIC = {
  zones: ZONES, evoChance: EVO_CHANCE, zoneEvo: ZONE_EVO, hours: HOURS, maxTeam: MAX_TEAM, slots: SLOTS, slot3Level: SLOT3_LEVEL,
  caps: { coins: COIN_DAY_CAP, dust: DUST_DAY_CAP, rare: RARE_DAY_CAP, candies: CANDY_DAY_CAP }, matchBonus: MATCH_BONUS,
  expBase: EXP_BASE, expLevel: EXP_LEVEL, friendPerHour: FRIEND_PER_HOUR, bigChance: BIG_CHANCE, luckyChance: LUCKY_CHANCE,
};

const maxSlots = (u) => (u.level >= SLOT3_LEVEL ? SLOTS + 1 : SLOTS);
const expsOf = (u) => (u.expeditions ||= []);

function dayOf(u) {
  const k = hub.dayKey();
  if (!u.expDay || u.expDay.day !== k) u.expDay = { day: k, coins: 0, dust: 0, rare: 0, evo: 0, candy: 0, big: 0, lucky: 0 };
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
  const e = { id: crypto.randomBytes(4).toString('hex'), zone: zone.id, hours, start: now, end: now + hours * HOUR, phase: daytime.phase(now), team: found.map((x) => ({ id: x.id, uid: x.m.uid })) };
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
  const exp = require('./exp');
  const out = { zone: zone.id, hours: H, members: [], exp: 0, candies: {}, evolve: [], pokerus: [], berries: {}, dust: 0, coins: 0, item: null, friend: 0, mats: {}, tm: null, lovers: 0, evoItem: null, ev: 0, evStat: zone.ev };
  // Participantes que siguen existiendo (si una especie se bloqueó, simplemente no cuenta).
  const live = e.team.map((t) => ({ t, m: lookup(u, t) })).filter((x) => x.m);
  const n = live.length;
  let matched = 0;
  const loveF = new Map(live.map((x) => [x.m, bond.lootFactor(x.m)])); // antes de subir la amistad con esta misma expedición
  for (const { t, m } of live) {
    delete m.away; // vuelve a la Caja (antes de repartir EXP: así ya puede evolucionar)
    const hit = matches(zone, t.id);
    if (hit) matched++;
    const timeHit = daytime.affinity(t.id) === (e.phase || daytime.phase(e.start)); // Pokémon de día/noche que salen a su hora: +25 % de EXP
    const rawExp = H * (EXP_BASE + EXP_LEVEL * m.level) * (hit ? 1 + MATCH_BONUS : 1) * (timeHit ? 1 + daytime.EXP_BONUS : 1);
    const lf = loveF.get(m); // «Te adora»: +10 % de EXP (nunca de monedas)
    if (lf > 1) out.lovers++;
    const from = m.level;
    const xr = exp.award(u, t.id, m, lf > 1 ? bond.stochRound(rawExp * lf) : Math.round(rawExp), 'exp'); // con el tope diario por ejemplar y el Huevo Suerte
    out.exp += xr.exp;
    if (xr.evo.length) out.evolve.push({ id: t.id, uid: t.uid, shiny: !!m.shiny, name: m.nick || BY_ID.get(t.id).name, to: xr.evo });
    const ev = evs.gain(m, zone.ev, evs.EXP_PER_HOUR * H, 'exp'); // EVs de la estadística de la zona
    out.ev += ev;
    const fr = bond.addFriend(m, FRIEND_PER_HOUR * H, 'exp');
    out.friend += fr;
    out.members.push({ id: t.id, uid: t.uid, shiny: !!m.shiny, name: m.nick || BY_ID.get(t.id).name, from, to: m.level, exp: xr.exp, friend: fr, ev, time: timeHit, match: hit, learned: xr.learned, pending: xr.pending });
  }
  // Los que ya no están (bloqueados, etc.) no se cuentan; el resto del botín sigue su curso.
  if (n) {
    const teamF = live.reduce((a, x) => a + loveF.get(x.m), 0) / n; // +10 % por cada ejemplar que te adora, repartido entre el equipo
    const boost = (x) => (teamF > 1 ? bond.stochRound(x * teamF) : x);
    const rolls = Math.ceil(H / 4);
    for (let k = 0; k < rolls; k++) { // Caramelos Exp. (tope diario)
      const it = weighted(CANDY_WEIGHTS, (x) => x[1])[0];
      const q = Math.min(boost(randInt(1, 2)), CANDY_DAY_CAP - (d.candy || 0));
      if (q > 0) { require('./candy').giveExp(u, it, q); d.candy = (d.candy || 0) + q; out.candies[it] = (out.candies[it] || 0) + q; }
    }
    if (BIG_CHANCE[H] && (d.big || 0) < 1 && rand() < BIG_CHANCE[H]) { require('./candy').giveExp(u, 'exp-l', 1); d.big = 1; out.candies['exp-l'] = (out.candies['exp-l'] || 0) + 1; }
    if (LUCKY_CHANCE[H] && (d.lucky || 0) < 1 && rand() < LUCKY_CHANCE[H]) { items.give(u, 'hi-luckyegg', 1); d.lucky = 1; out.lucky = true; }
    out.pokerus = require('./pokerus').roll(u, live.map((x) => ({ id: x.t.id, m: x.m }))); // Pokérus (muy raro; se contagia dentro del equipo)
    for (let k = 0; k < rolls; k++) {
      const b = pick(Object.keys(items.BERRIES));
      const q = boost(randInt(1, 2));
      const before = (bond.berriesOf(u)[b] || 0);
      bond.giveBerry(u, b, q);
      const got = (bond.berriesOf(u)[b] || 0) - before;
      if (got > 0) out.berries[b] = (out.berries[b] || 0) + got;
    }
    const dust = Math.max(0, Math.min(boost(randInt(H, 2 * H)), DUST_DAY_CAP - d.dust));
    if (dust) { u.dust += dust; d.dust += dust; out.dust = dust; }
    if (RARE_CHANCE[H] && d.rare < RARE_DAY_CAP && rand() < RARE_CHANCE[H]) {
      const it = rand() < EGG_SHARE ? 'mystery-egg' : 'ticket';
      items.give(u, it, 1);
      d.rare++;
      out.item = it;
    }
    if (EVO_CHANCE[H] && (d.evo || 0) < EVO_DAY_CAP && rand() < EVO_CHANCE[H]) {
      const stones = ZONE_EVO[zone.id].filter((x) => require('./evoreq').STONES.includes(x));
      const it = rand() < 0.7 && stones.length ? pick(stones) : pick(ZONE_EVO[zone.id]); // sobre todo piedras
      items.give(u, it, 1);
      d.evo = (d.evo || 0) + 1;
      out.evoItem = it;
    }
    const loot = require('./tm').expeditionLoot(u, zone, H); // materiales de MT (según los tipos de la zona) y, a veces, una MT
    out.mats = loot.mats; out.tm = loot.tm; out.shards = require('./tutor').expeditionLoot(u, zone, H);
    const coins = Math.max(0, Math.min(Math.round(H * COIN_PER_HOUR * (1 + MATCH_BONUS * matched / n)), COIN_DAY_CAP - d.coins));
    if (coins) { u.coins += coins; d.coins += coins; hub.ledger(u, coins, 'expedition', zone.name); out.coins = coins; }
  }
  // Por si algún ejemplar quedó marcado y ya no está en el equipo (no debería).
  exps.splice(i, 1);
  db.save();
  return { ...view(u), reward: out };
}

module.exports = {
  ZONES, ZONE_BY_ID, STATIC, HOURS, MAX_TEAM, SLOTS, SLOT3_LEVEL, MATCH_BONUS, EXP_BASE, EXP_LEVEL, CANDY_DAY_CAP, BIG_CHANCE, LUCKY_CHANCE, FRIEND_PER_HOUR,
  COIN_PER_HOUR, COIN_DAY_CAP, DUST_DAY_CAP, RARE_DAY_CAP, RARE_CHANCE, RARE_VALUE, BERRY_CAP, maxSlots, dailyMaxValue, view, send, claim,
};

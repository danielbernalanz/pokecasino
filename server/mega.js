'use strict';
// Evento «Megaevolución»: megapiedras, Megafragmentos 💠, Máquina Mega y Bote Mega.
//
// Reglas de economía (ver docs/BALANCE.md, «Evento Megaevolución»):
//  - Los fragmentos NO se convierten en monedas. La única vía de fragmentos → monedas es el Bote Mega, que se alimenta
//    EXCLUSIVAMENTE con monedas de las tiradas «de pago» de la Máquina (nunca se crean monedas) y tiene un tope.
//  - Las tiradas con monedas son un sumidero: la mitad del coste se quema y la otra mitad va al Bote.
//  - Fragmentos por jugar: 1 por cada 200 monedas apostadas, con multiplicadores (combo, Hora Mega, ráfaga) y un tope
//    DIARIO sobre lo ganado jugando. Misiones, racha y hitos tienen cantidades fijas.
//  - Los fragmentos que devuelve la Máquina no cuentan para los hitos ni el ranking (no se puede inflar girando).
const db = require('./db');
const hub = require('./hub');
const items = require('./items');
const events = require('./events');
const { BY_ID } = require('./pokedex');
const { randInt, pick, shuffle, weighted } = require('./rng');
const FORMS = require('./megadata.json');

const BY_FORM = new Map(FORMS.map((f) => [f.formId, f]));
const BY_STONE = new Map(FORMS.map((f) => [f.stone, f]));
const DAY = 864e5;

// ---- Constantes ----
const CFG = {
  DURATION_DAYS: 7, // duración de cada edición
  GAP_DAYS: 7, // tras terminar, la siguiente empieza sola pasado este tiempo (el anfitrión puede cambiarlo)
  FRAG_PER_COINS: 200, // 1 💠 por cada 200 monedas apostadas (o gastadas en el Gacha o la Máquina)
  BET_DAILY_CAP: 300, // tope diario de 💠 ganados jugando, ya con multiplicadores
  CRAFT_COST: 100, // fabricar la megapiedra que quieras
  FRAG_SPIN: 10, // coste de una tirada con fragmentos
  COIN_SPIN: 300, // coste de una tirada con monedas (sumidero)
  BOTE_SHARE: 0.5, // fracción del coste en monedas que va al Bote (el resto se quema)
  BOTE_MAX: 60000, // tope del Bote: lo que sobra se quema. Con la probabilidad de abajo su valor esperado por tirada es < 60
  HOUR_MS: 30 * 60e3,
  HOUR_MULT: 2,
  COMBO_GAP: 2 * 60e3, // máximo entre dos jugadas para mantener el combo
  COMBO_STEPS: [[25, 2], [12, 1.5], [5, 1.25]], // [jugadas seguidas, multiplicador]
  MIN_RANK: 100, // 💠 ganados mínimos para entrar en el podio final
  NO_FRAGS: ['duel', 'poker'], // juegos que no dan 💠 (la apuesta no se juega contra la casa: se podría granjear sin riesgo)
};

// Rodillos: seis megapiedras «normales» y el símbolo 💠. El número de 💠 de la tirada dice qué clase de premio es.
const SYMBOLS = ['venusaurite', 'charizardite-y', 'blastoisinite', 'ampharosite', 'gardevoirite', 'gengarite'];
const MEGA_SYM = 'mega';

// Resultados de la Máquina (peso sobre 10.000). Mismos para fragmentos y monedas.
const OUTCOMES = [
  { id: 'nada', w: 3955, name: 'Sin premio', desc: 'Tres símbolos distintos', mega: 0 },
  { id: 'par', w: 3000, name: 'Pareja', desc: 'Dos símbolos iguales: +6 💠', frags: 6, mega: 0 },
  { id: 'trio', w: 1600, name: 'Trío', desc: 'Tres símbolos iguales: +18 💠', frags: 18, mega: 0 },
  { id: 'rafaga', w: 700, name: 'Ráfaga ×2', desc: 'Un 💠 y pareja: +8 💠 y fragmentos ×2 en tus próximas 15 jugadas', frags: 8, boost: { left: 15, mult: 2 }, mega: 1 },
  { id: 'ticket', w: 300, name: 'Ticket Gacha', desc: 'Dos 💠: un Ticket Gacha', items: { ticket: 1 }, mega: 2 },
  { id: 'huevo', w: 250, name: 'Huevo Misterioso', desc: 'Dos 💠: un Huevo Misterioso', items: { 'mystery-egg': 1 }, mega: 2 },
  { id: 'supermega', w: 120, name: 'Súper Mega', desc: 'Tres 💠: +50 💠', frags: 50, mega: 3 },
  { id: 'cosmetico', w: 50, name: 'Cosmético Mega', desc: 'Tres 💠: Marco Mega, Dorso Megapiedra o título «Megaevolucionador»', mega: 3 },
  { id: 'piedra', w: 15, name: 'Megapiedra', desc: 'Tres 💠: una megapiedra al azar', mega: 3 },
  { id: 'bote', w: 10, name: 'BOTE MEGA', desc: 'Tres 💠: todo el Bote Mega y una megapiedra a elegir', mega: 3 },
];
const TOTAL_W = OUTCOMES.reduce((s, o) => s + o.w, 0); // 10.000
const BY_OUTCOME = new Map(OUTCOMES.map((o) => [o.id, o]));
const COSMETIC_POOL = { 'frame-mega': 3, 'back-megastone': 4, 'title-megaevolver': 3 };

// Pase de recompensas: hitos de 💠 ganados en la edición. Todo son objetos (nunca monedas).
const MILESTONES = [
  { at: 40, items: { ticket: 1 } },
  { at: 120, items: { 'mystery-egg': 1 } },
  { at: 250, items: { 'frame-mega': 1 } },
  { at: 400, items: { ticket: 3, 'mystery-egg': 1 } },
  { at: 600, items: { 'back-megastone': 1, ticket: 2 } },
  { at: 850, items: { 'master-ball': 1 } },
  { at: 1200, items: { 'title-megaevolver': 1 }, picks: 1 },
];
const MISSIONS = [
  { id: 'play20', title: 'Juega 20 partidas', n: 20, reward: 15, match: (e) => e === 'play' },
  { id: 'win5x', title: 'Gana una apuesta ×5', n: 1, reward: 15, match: (e, d) => e === 'win' && d.mult >= 5 },
  { id: 'pull10', title: 'Haz 10 tiradas de Gacha', n: 10, reward: 15, count: (d) => d.count || 1, match: (e) => e === 'pull' },
];
const MISSION_BONUS = 25;
const STREAK = [10, 10, 15, 15, 20, 25, 40]; // 💠 por día seguido de entrada
const PODIUM = [
  { items: { 'frame-mega': 1, 'title-megaevolver': 1 }, picks: 1, label: 'Marco Mega, título «Megaevolucionador» y una megapiedra a elegir' },
  { items: { 'back-megastone': 1 }, stones: 1, label: 'Dorso Megapiedra y una megapiedra al azar' },
  { items: { 'frame-mega': 1 }, stones: 1, label: 'Marco Mega y una megapiedra al azar' },
];

// ---- Estado de la edición (db.data.mega) ----
function S() {
  const m = (db.data.mega ||= {});
  if (!m.ed) {
    // Primer despliegue: la primera edición arranca ahora.
    const now = Date.now();
    Object.assign(m, { ed: 1, startsAt: now, endsAt: now + CFG.DURATION_DAYS * DAY, finalized: false, auto: true, bote: 0, burned: 0, hours: {}, winners: [] });
  }
  m.hours ||= {};
  return m;
}
const isActive = (now = Date.now()) => { const m = S(); return now >= m.startsAt && now < m.endsAt; };
function assertActive(now) { if (!isActive(now)) throw new Error('El evento Megaevolución no está activo ahora mismo.'); }

const MAD = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
const dayId = (t = Date.now()) => MAD.format(t);
const prevDay = (id) => new Date(Date.parse(id + 'T00:00:00Z') - DAY).toISOString().slice(0, 10);

// ---- Hora Mega: 1-2 ventanas de 30 min al día, al azar entre las 12:00 y las 23:30 (hora de España) ----
function scheduleDay(dayStart, id) {
  const m = S();
  if (m.hours[id]) return;
  const n = randInt(1, 2);
  const out = [];
  if (n === 1) {
    const s = randInt(12 * 60, 23 * 60);
    out.push({ s: dayStart + s * 60e3, e: dayStart + s * 60e3 + CFG.HOUR_MS });
  } else {
    const a = randInt(12 * 60, 17 * 60 + 30);
    const b = randInt(a + 120, 23 * 60);
    for (const s of [a, b]) out.push({ s: dayStart + s * 60e3, e: dayStart + s * 60e3 + CFG.HOUR_MS });
  }
  m.hours[id] = out;
  // Solo se guardan los días recientes.
  for (const k of Object.keys(m.hours).sort().slice(0, -4)) delete m.hours[k];
  db.save();
}
function ensureSchedule(now) {
  const { nextMidnight } = events.madrid(now);
  scheduleDay(nextMidnight - DAY, dayId(now));
  scheduleDay(nextMidnight, dayId(nextMidnight + 3600e3));
}
function currentHour(now = Date.now()) {
  const m = S();
  if (!isActive(now)) return null;
  if (m.forced && now >= m.forced.s && now < m.forced.e) return m.forced;
  for (const list of Object.values(m.hours)) for (const w of list) if (now >= w.s && now < w.e && w.e <= m.endsAt + CFG.HOUR_MS) return w;
  return null;
}
const hourMult = (now) => (currentHour(now) ? CFG.HOUR_MULT : 1);

// ---- Datos de cada jugador (user.mega) ----
const megasOf = (user) => (user.megas ||= {});
function U(user) {
  const m = S();
  let st = user.mega;
  if (!st) st = user.mega = { ed: m.ed, frags: 0, picks: 0, earned: 0, acc: 0, fx: 0, combo: { n: 0, last: 0 }, boost: null, claimed: [], notified: 0, streak: { n: 0, last: null }, missions: null, day: { id: null, bet: 0 }, spins: 0 };
  if (st.ed !== m.ed) {
    // Edición nueva: se reinicia lo que es «de la edición»; los 💠 y vales sin gastar se conservan.
    Object.assign(st, { ed: m.ed, earned: 0, acc: 0, fx: 0, combo: { n: 0, last: 0 }, boost: null, claimed: [], notified: 0, streak: { n: 0, last: null }, missions: null, day: { id: null, bet: 0 } });
  }
  return st;
}
function rollDay(st, now) {
  const id = dayId(now);
  if (st.day.id !== id) st.day = { id, bet: 0 };
  return st.day;
}
function ensureMissions(st, now) {
  const id = dayId(now);
  if (!st.missions || st.missions.day !== id) st.missions = { day: id, list: MISSIONS.map((d) => ({ id: d.id, prog: 0, done: false })), bonus: false };
  return st.missions;
}

const comboOf = (st, now) => {
  if (!st.combo.last || now - st.combo.last > CFG.COMBO_GAP) return { n: 0, mult: 1, ttl: 0 };
  const step = CFG.COMBO_STEPS.find(([n]) => st.combo.n >= n);
  return { n: st.combo.n, mult: step ? step[1] : 1, ttl: CFG.COMBO_GAP - (now - st.combo.last) };
};
function touch(st, now) {
  st.combo.n = st.combo.last && now - st.combo.last <= CFG.COMBO_GAP ? st.combo.n + 1 : 1;
  st.combo.last = now;
}
const multOf = (st, now) => comboOf(st, now).mult * hourMult(now) * (st.boost && st.boost.left > 0 ? st.boost.mult : 1);

// Abona 💠 (ganados jugando, misiones, racha…): cuentan para los hitos y el ranking.
function credit(user, st, n, now) {
  n = Math.floor(n);
  if (n <= 0) return 0;
  st.frags += n;
  st.earned += n;
  while (st.notified < MILESTONES.length && st.earned >= MILESTONES[st.notified].at) {
    const ms = MILESTONES[st.notified++];
    hub.emitUser(user.id, 'toast', { kind: 'mega', text: `💠 ¡Hito de ${ms.at} 💠 conseguido! Reclama tu premio en Megaevolución.` });
  }
  return n;
}

// ---- Ganchos desde el resto del servidor ----
// Una apuesta (o gasto en el Gacha / la Máquina): `play` = es una jugada nueva (cuenta para el combo).
function onBet(user, amount, game, { play = true } = {}, now = Date.now()) {
  if (user.npc || !isActive(now) || CFG.NO_FRAGS.includes(game)) return 0;
  const st = U(user);
  if (play) touch(st, now);
  const day = rollDay(st, now);
  st.acc += Number(amount) / CFG.FRAG_PER_COINS;
  const base = Math.floor(st.acc);
  const m = multOf(st, now);
  if (play && st.boost && st.boost.left > 0 && --st.boost.left <= 0) st.boost = null;
  if (base < 1) return 0;
  st.acc -= base;
  st.fx += base * m;
  const total = Math.floor(st.fx);
  st.fx -= total;
  const give = Math.max(0, Math.min(total, CFG.BET_DAILY_CAP - day.bet));
  day.bet += give;
  const got = credit(user, st, give, now);
  if (got) st.lastGain = { n: got, mult: m, at: now };
  db.save();
  return got;
}

// Eventos de progreso (misiones del evento). Llamado desde progress.track.
function onEvent(user, event, data = {}, now = Date.now()) {
  if (user.npc || !isActive(now)) return;
  const st = U(user);
  if (event === 'pull') touch(st, now);
  const ms = ensureMissions(st, now);
  for (const m of ms.list) {
    const def = MISSIONS.find((d) => d.id === m.id);
    if (m.done || !def || !def.match(event, data)) continue;
    m.prog += def.count ? def.count(data) : 1;
    if (m.prog >= def.n) {
      m.done = true;
      credit(user, st, def.reward, now);
      hub.emitUser(user.id, 'toast', { kind: 'mega', text: `💠 Misión Mega «${def.title}»: +${def.reward} 💠` });
    }
  }
  if (!ms.bonus && ms.list.every((x) => x.done)) {
    ms.bonus = true;
    credit(user, st, MISSION_BONUS, now);
    hub.emitUser(user.id, 'toast', { kind: 'mega', text: `💠 ¡Las 3 misiones Mega de hoy! +${MISSION_BONUS} 💠` });
  }
  db.save();
}

// ---- Acciones del jugador ----
function checkin(user, _p, now = Date.now()) {
  if (user.npc) throw new Error('Los comerciantes NPC no participan.');
  assertActive(now);
  const st = U(user);
  const today = dayId(now);
  if (st.streak.last === today) throw new Error('Ya has entrado hoy. ¡Vuelve mañana!');
  st.streak.n = st.streak.last === prevDay(today) ? st.streak.n + 1 : 1;
  st.streak.last = today;
  const reward = STREAK[Math.min(st.streak.n, STREAK.length) - 1];
  credit(user, st, reward, now);
  db.save();
  return { reward, streak: st.streak.n };
}

function grantItems(user, its) {
  for (const [id, n] of Object.entries(its || {})) items.give(user, id, n);
}
function claim(user, { i }, now = Date.now()) {
  i = Number(i);
  const ms = MILESTONES[i];
  const st = U(user);
  if (!ms) throw new Error('Hito desconocido.');
  if (st.earned < ms.at) throw new Error(`Aún te faltan ${ms.at - st.earned} 💠 para este hito.`);
  if (st.claimed.includes(i)) throw new Error('Ya reclamaste este hito.');
  st.claimed.push(i);
  grantItems(user, ms.items);
  if (ms.picks) st.picks += ms.picks;
  db.save();
  return { claimed: i, items: ms.items, picks: ms.picks || 0 };
}

function craft(user, { stone }, now = Date.now()) {
  assertActive(now);
  const f = BY_STONE.get(stone);
  if (!f) throw new Error('Megapiedra desconocida.');
  const st = U(user);
  if (st.frags < CFG.CRAFT_COST) throw new Error(`Te faltan ${CFG.CRAFT_COST - st.frags} 💠 (cuesta ${CFG.CRAFT_COST}).`);
  st.frags -= CFG.CRAFT_COST;
  items.give(user, f.stone, 1);
  db.save();
  return { stone: f.stone, formId: f.formId };
}

function pickStone(user, { stone }) {
  const st = U(user);
  if (st.picks < 1) throw new Error('No tienes ninguna megapiedra a elegir.');
  const f = BY_STONE.get(stone);
  if (!f) throw new Error('Megapiedra desconocida.');
  st.picks--;
  items.give(user, f.stone, 1);
  db.save();
  return { stone: f.stone, formId: f.formId };
}

// Usar una megapiedra: hace falta tener la especie base; se gasta la piedra y se desbloquea la forma.
function useStone(user, itemId) {
  const f = BY_STONE.get(itemId);
  if (!f) throw new Error('Eso no es una megapiedra.');
  if (!user.collection[f.species]) throw new Error(`Necesitas tener a ${BY_ID.get(f.species).name} para usar la ${f.stoneName}.`);
  const megas = megasOf(user);
  if (megas[f.formId]) throw new Error(`Ya tienes desbloqueada a ${f.name}.`);
  items.take(user, itemId);
  megas[f.formId] = Date.now();
  hub.track(user, 'item_use', { itemId });
  hub.feed('mega', `💠 ${user.username} desbloqueó a ${f.name}`, { pokeId: f.species });
  db.save();
  return { used: itemId, formId: f.formId, species: f.species };
}

// Megaevolucionar (o volver a la forma normal) al compañero.
function setBuddyMega(user, { formId }) {
  if (formId === null || formId === undefined || formId === 0) {
    if (user.buddy) delete user.buddy.mega;
    db.save();
    return {};
  }
  formId = Number(formId);
  const f = BY_FORM.get(formId);
  if (!f) throw new Error('Megaevolución desconocida.');
  if (!user.buddy || user.buddy.id !== f.species) throw new Error(`Tu compañero debe ser ${BY_ID.get(f.species).name}.`);
  if (!megasOf(user)[formId]) throw new Error('Aún no tienes desbloqueada esa megaevolución.');
  user.buddy.mega = formId;
  db.save();
  return { formId };
}
const buddyMegaOk = (user) => !!(user.buddy && user.buddy.mega && megasOf(user)[user.buddy.mega] && BY_FORM.get(user.buddy.mega).species === user.buddy.id);

// ---- Máquina Mega ----
function layout(id) {
  const o = BY_OUTCOME.get(id);
  const reg = () => pick(SYMBOLS);
  const place = (parts) => shuffle(parts);
  if (o.mega === 3) return [MEGA_SYM, MEGA_SYM, MEGA_SYM];
  if (o.mega === 2) return place([MEGA_SYM, MEGA_SYM, reg()]);
  if (o.mega === 1) { const s = reg(); return place([MEGA_SYM, s, s]); }
  if (id === 'trio') { const s = reg(); return [s, s, s]; }
  if (id === 'par') { const s = reg(); return place([s, s, pick(SYMBOLS.filter((x) => x !== s))]); }
  return shuffle(SYMBOLS).slice(0, 3);
}

function spin(user, { mode }, now = Date.now()) {
  if (user.npc) throw new Error('Los comerciantes NPC no participan.');
  assertActive(now);
  mode = mode === 'coins' ? 'coins' : 'frags';
  const st = U(user);
  const m = S();
  if (mode === 'frags') {
    if (st.frags < CFG.FRAG_SPIN) throw new Error(`Necesitas ${CFG.FRAG_SPIN} 💠 para girar.`);
    st.frags -= CFG.FRAG_SPIN;
  } else {
    if (user.coins < CFG.COIN_SPIN) throw new Error(`Necesitas ${CFG.COIN_SPIN} monedas para girar.`);
    user.coins -= CFG.COIN_SPIN;
    const toPool = Math.floor(CFG.COIN_SPIN * CFG.BOTE_SHARE);
    const room = Math.max(0, CFG.BOTE_MAX - m.bote);
    const into = Math.min(toPool, room);
    m.bote += into;
    m.burned += CFG.COIN_SPIN - into; // lo que no cabe en el Bote se quema junto con la otra mitad
    hub.ledger(user, -CFG.COIN_SPIN, 'mega_spin', 'Máquina Mega');
    hub.gameStat(user, 'mega', CFG.COIN_SPIN, 0);
  }
  st.spins = (st.spins || 0) + 1;
  touch(st, now);
  if (mode === 'coins') onBet(user, CFG.COIN_SPIN, 'mega', { play: false }, now);

  // Sorteo (crypto): el servidor decide el resultado y los rodillos solo lo muestran.
  const o = weighted(OUTCOMES, (x) => x.w);
  const prize = {};
  if (o.frags) { st.frags += o.frags; prize.frags = o.frags; }
  if (o.boost) { st.boost = { left: o.boost.left, mult: o.boost.mult }; prize.boost = { ...o.boost }; }
  if (o.items) { grantItems(user, o.items); prize.items = { ...o.items }; }
  let loud = null;
  if (o.id === 'supermega') loud = `¡Súper Mega! +${o.frags} 💠`;
  if (o.id === 'cosmetico') {
    const id = weighted(Object.keys(COSMETIC_POOL), (k) => COSMETIC_POOL[k]);
    items.give(user, id, 1);
    prize.cosmetic = id;
    loud = `¡${items.ITEMS[id].name}!`;
  }
  if (o.id === 'piedra') {
    const f = pick(FORMS);
    items.give(user, f.stone, 1);
    prize.stone = f.stone;
    loud = `¡una megapiedra: ${f.stoneName}!`;
  }
  if (o.id === 'bote') {
    const coins = m.bote;
    m.bote = 0;
    if (coins > 0) { user.coins += coins; user.stats.won += coins; hub.ledger(user, coins, 'mega_bote_out', 'Bote Mega'); hub.gameStat(user, 'mega', 0, coins); }
    st.picks++;
    prize.bote = { coins };
    loud = `¡¡EL BOTE MEGA!! ${coins.toLocaleString('es')} monedas y una megapiedra a elegir`;
  }
  db.save();
  // El aviso a los demás se retrasa unos segundos para no destripar la animación del ganador.
  if (loud || mode === 'coins') {
    const name = user.username;
    const bote = m.bote;
    setTimeout(() => {
      if (loud) {
        hub.feed('mega', `💠 ${name} sacó en la Máquina Mega: ${loud}`);
        if (o.id === 'bote') hub.broadcast('mega:bote:hit', { user: name, amount: prize.bote.coins });
      }
      hub.broadcast('mega:bote', { bote: S().bote });
    }, loud ? 6500 : 0).unref?.();
  }
  return { spin: { mode, outcome: o.id, name: o.name, triple: layout(o.id), prize, cost: mode === 'coins' ? CFG.COIN_SPIN : CFG.FRAG_SPIN }, bote: m.bote };
}

// ---- Ranking y final de edición ----
function leaderboard(n = 10) {
  const m = S();
  return Object.values(db.data.users).filter((u) => !u.npc && !u.banned && u.mega && u.mega.ed === m.ed && u.mega.earned > 0)
    .map((u) => ({ username: u.username, buddy: u.buddy, ...hub.looks(u), value: u.mega.earned }))
    .sort((a, b) => b.value - a.value || a.username.localeCompare(b.username)).slice(0, n);
}

function finalize(now = Date.now()) {
  const m = S();
  if (m.finalized) return;
  m.finalized = true;
  const users = Object.values(db.data.users).filter((u) => !u.npc && u.mega && u.mega.ed === m.ed);
  // Los hitos alcanzados y sin reclamar se entregan solos.
  for (const u of users) {
    const st = u.mega;
    MILESTONES.forEach((ms, i) => {
      if (st.earned >= ms.at && !st.claimed.includes(i)) { st.claimed.push(i); grantItems(u, ms.items); if (ms.picks) st.picks += ms.picks; }
    });
  }
  // Podio: los 3 que más 💠 ganaron (con un mínimo, para que no gane quien apenas jugó).
  const top = leaderboard(3).filter((r) => r.value >= CFG.MIN_RANK);
  m.winners = [];
  top.forEach((r, k) => {
    const u = db.userByName(r.username);
    const p = PODIUM[k];
    grantItems(u, p.items);
    U(u);
    if (p.picks) u.mega.picks += p.picks;
    for (let j = 0; j < (p.stones || 0); j++) items.give(u, pick(FORMS).stone, 1);
    m.winners.push({ rank: k + 1, username: u.username, value: r.value, reward: p.label });
    hub.emitUser(u.id, 'toast', { kind: 'mega', text: `🏆 ¡Puesto ${k + 1} en Megaevolución! Premio: ${p.label}.` });
    hub.pushMe(u);
  });
  if (m.winners.length) hub.feed('mega', `🏆 Fin de Megaevolución: ${m.winners.map((w) => `${w.rank}º ${w.username} (${w.value} 💠)`).join(' · ')}`);
  else hub.feed('mega', '💠 Termina la Megaevolución. ¡Hasta la próxima edición!');
  db.save();
  hub.broadcast('mega:state', publicState(now));
}

function startEdition(days = CFG.DURATION_DAYS, now = Date.now()) {
  const m = S();
  if (!m.finalized) finalize(now);
  Object.assign(m, { ed: m.ed + 1, startsAt: now, endsAt: now + days * DAY, finalized: false, hours: {}, forced: null, hourSeen: null });
  ensureSchedule(now);
  db.save();
  hub.feed('mega', '💠 ¡Empieza la MEGAEVOLUCIÓN! Megapiedras, Máquina Mega y el Bote. ¡A por todas!');
  hub.broadcast('mega:state', publicState(now));
  hub.broadcast('notify', { kind: 'mega', link: 'mega', text: '💠 ¡Ha empezado la Megaevolución!' });
}

// Reloj del evento: cambios de edición, final, Horas Mega. Se llama cada pocos segundos.
function tick(now = Date.now()) {
  const m = S();
  if (now >= m.endsAt && !m.finalized) finalize(now);
  if (m.finalized && m.auto && now >= m.endsAt + CFG.GAP_DAYS * DAY) { startEdition(CFG.DURATION_DAYS, now); return; }
  if (!isActive(now)) return;
  ensureSchedule(now);
  const w = currentHour(now);
  if (w && m.hourSeen !== w.s) {
    m.hourSeen = w.s;
    db.save();
    hub.feed('mega', `⚡ ¡HORA MEGA! Durante 30 minutos los 💠 por jugar valen el doble (${Math.round((w.e - now) / 60000)} min).`);
    hub.broadcast('mega:state', publicState(now));
    hub.broadcast('mega:hour', { s: w.s, e: w.e });
    hub.broadcast('notify', { kind: 'mega', link: 'mega', text: '⚡ ¡HORA MEGA! 30 minutos con fragmentos ×2.' });
  } else if (!w && m.hourSeen) {
    m.hourSeen = null;
    db.save();
    hub.broadcast('mega:state', publicState(now));
  }
}
let timer = null;
function start() {
  S();
  tick();
  timer = setInterval(() => { try { tick(); } catch (e) { console.error('mega.tick', e); } }, 10 * 1000);
  timer.unref();
}

// ---- Administración ----
function admin(op, { days, username, frags, earned } = {}, now = Date.now()) {
  const m = S();
  if (op === 'start') { startEdition(Math.min(30, Math.max(1, Number(days) || CFG.DURATION_DAYS)), now); return; }
  if (op === 'extend') {
    days = Number(days) || 1;
    if (!(days >= 1 && days <= 30)) throw new Error('Entre 1 y 30 días.');
    if (m.finalized) throw new Error('La edición ya terminó: reinícala.');
    m.endsAt += days * DAY;
  } else if (op === 'stop') {
    if (m.finalized) throw new Error('La edición ya terminó.');
    m.endsAt = Math.min(m.endsAt, now);
    finalize(now);
  } else if (op === 'hour') {
    assertActive(now);
    m.forced = { s: now, e: now + CFG.HOUR_MS };
    tick(now);
  } else if (op === 'auto') {
    m.auto = !!days;
  } else if (op === 'give') {
    const t = db.userByName(username);
    frags = Math.floor(Number(frags));
    if (!t || t.npc || !(Math.abs(frags) <= 100000)) throw new Error('Datos no válidos (máximo ±100.000 💠).');
    const st = U(t);
    st.frags = Math.max(0, st.frags + frags);
    if (earned && frags > 0) credit(t, st, frags, now);
    hub.pushMe(t);
  } else throw new Error('Operación desconocida.');
  db.save();
  hub.broadcast('mega:state', publicState(now));
}

// ---- Vistas ----
function publicState(now = Date.now()) {
  const m = S();
  const w = currentHour(now);
  return {
    ed: m.ed, active: isActive(now), startsAt: m.startsAt, endsAt: m.endsAt, finalized: !!m.finalized, now,
    nextAt: !isActive(now) && m.auto && m.finalized ? m.endsAt + CFG.GAP_DAYS * DAY : null,
    hour: w ? { s: w.s, e: w.e } : null, bote: m.bote, winners: m.finalized ? m.winners || [] : [],
  };
}

// Lo que va en cada actualización del jugador (se envía a menudo: pequeño).
function privateView(user, now = Date.now()) {
  const st = U(user);
  const c = comboOf(st, now);
  const room = isActive(now) ? Math.max(0, CFG.BET_DAILY_CAP - (st.day.id === dayId(now) ? st.day.bet : 0)) : 0;
  return {
    frags: st.frags, earned: st.earned, picks: st.picks, megas: Object.keys(megasOf(user)).map(Number),
    combo: c, boost: st.boost && st.boost.left > 0 ? { ...st.boost } : null, mult: isActive(now) ? multOf(st, now) : 1,
    betLeft: room, checkin: isActive(now) && st.streak.last !== dayId(now), lastGain: st.lastGain || null,
  };
}

// Todo lo de la vista «Megaevolución».
function full(user, now = Date.now()) {
  const st = U(user);
  const ms = ensureMissions(st, now);
  const nextStreak = st.streak.last === dayId(now) ? st.streak.n + 1 : st.streak.last === prevDay(dayId(now)) ? st.streak.n + 1 : 1;
  return {
    state: publicState(now),
    me: privateView(user, now),
    claimed: st.claimed,
    missions: ms.list.map((x) => { const d = MISSIONS.find((q) => q.id === x.id); return { id: x.id, title: d.title, n: d.n, prog: Math.min(x.prog, d.n), done: x.done, reward: d.reward }; }),
    missionBonus: { got: ms.bonus, reward: MISSION_BONUS },
    streak: { n: st.streak.n, today: st.streak.last === dayId(now), next: STREAK[Math.min(nextStreak, STREAK.length) - 1] },
    leaderboard: leaderboard(10),
    lastPodium: (S().winners || []),
  };
}

// Datos fijos para /api/static (el cliente los muestra y calcula con ellos).
const STATIC = {
  forms: FORMS.map((f) => ({ formId: f.formId, species: f.species, name: f.name, stone: f.stone, stoneName: f.stoneName, types: f.types, stats: f.stats })),
  cfg: {
    craftCost: CFG.CRAFT_COST, fragSpin: CFG.FRAG_SPIN, coinSpin: CFG.COIN_SPIN, boteShare: CFG.BOTE_SHARE, boteMax: CFG.BOTE_MAX,
    betCap: CFG.BET_DAILY_CAP, fragPerCoins: CFG.FRAG_PER_COINS, hourMult: CFG.HOUR_MULT, comboGap: CFG.COMBO_GAP, comboSteps: CFG.COMBO_STEPS,
    days: CFG.DURATION_DAYS, noFrags: CFG.NO_FRAGS, minRank: CFG.MIN_RANK,
  },
  symbols: SYMBOLS,
  outcomes: OUTCOMES.map((o) => ({ id: o.id, name: o.name, desc: o.desc, pct: (o.w / TOTAL_W) * 100, mega: o.mega })),
  milestones: MILESTONES,
  streak: STREAK,
  missions: MISSIONS.map((d) => ({ id: d.id, title: d.title, n: d.n, reward: d.reward })),
  missionBonus: MISSION_BONUS,
  podium: PODIUM.map((p) => p.label),
};

// Estadísticas base de una forma (mismo formato que baseStats de pokedex.js) para los duelos.
function formBaseStats(formId) {
  const [hp, atk, def, spa, spd, spe] = BY_FORM.get(formId).stats;
  return { hp, atk: Math.max(atk, spa), def: Math.round((def + spd) / 2), spe };
}

// Probabilidades y valores esperados (para las pruebas y el documento de equilibrio).
function expectedFrags() { return OUTCOMES.reduce((s, o) => s + (o.w / TOTAL_W) * (o.frags || 0), 0); }

module.exports = {
  MISSION_BONUS, CFG, FORMS, BY_FORM, BY_STONE, OUTCOMES, MILESTONES, MISSIONS, STREAK, PODIUM, SYMBOLS, STATIC, TOTAL_W,
  isActive, currentHour, dayId, onBet, onEvent, checkin, claim, craft, pickStone, useStone, setBuddyMega, buddyMegaOk, megasOf,
  spin, leaderboard, finalize, startEdition, tick, start, admin, publicState, privateView, full, formBaseStats, expectedFrags, state: S, U,
};

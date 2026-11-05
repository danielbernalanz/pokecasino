'use strict';
// GTS (Global Trade Station) como en los juegos (DPPt / BW): intercambio de Pokémon por Pokémon, nunca por monedas.
// Depositas UN ejemplar de tu Caja diciendo qué pides (especie vista, sexo y rango de nivel) y otro jugador, si tiene un ejemplar que
// lo cumple, lo intercambia al momento: se cambian los ejemplares EXACTOS y viajan con sus rasgos (specimen.traitsOf/applyTraits) y,
// como en los juegos, también con su nivel, EXP, movimientos, objeto y mote (no con EVs ni amistad: ver docs/BALANCE.md y ANTIABUSO.md).
//
//   db.data.gts = { deps: [ { id, userId, username, at, expiresAt, state, mon, want, recv?, with? } ], log: [...], nextId }
//   state: 'open' (a la venta) · 'expired' (caducó y no cabía en el PC: se recoge a mano) · 'done' (alguien intercambió y lo recibido espera en la GTS)
//   mon  = ejemplar depositado ENTERO (sale de la Caja: ya no cuenta como tuyo ni puede usarse en otro sitio mientras tanto)
//   want = { id, g: 'any'|'M'|'F', lv: 0 (cualquiera) | 1..10 (1-10, 11-20 … 91-100) }
//   recv = lo que recibe el dueño cuando alguien intercambia (pasa solo al PC si cabe; si no, espera a que haya sitio)
const db = require('./db');
const hub = require('./hub');
const specimen = require('./specimen');
const gacha = require('./gacha');
const tr = require('./transfer');
const eggroups = require('./eggroups');
const ex = require('./exp');
const { BY_ID } = require('./pokedex');

const DAY = 864e5;
const FEE = 150; // monedas por depositar: sumidero, no se devuelve si retiras o caduca
const MAX_ACTIVE = 3; // depósitos por jugador (abiertos, caducados sin recoger o con intercambio pendiente de recoger)
const EXPIRE_MS = 7 * DAY;
const DAILY = 5; // intercambios completados por cuenta y día (como oferente o como dueño del depósito)
const LOG_MAX = 200;
const RESULTS = 60;
const MAX_STARS = 5; // la Caja guarda como mucho 5 copias de una especie (gacha.grant)
const STATIC = { fee: FEE, max: MAX_ACTIVE, expireDays: EXPIRE_MS / DAY, daily: DAILY, stars: MAX_STARS };

const G = () => (db.data.gts ||= { deps: [], log: [], nextId: 1 });
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const nameOf = (id) => BY_ID.get(Number(id)).name;
const isRare = (id) => ['L', 'M'].includes(BY_ID.get(Number(id)).rarity);
const sexOf = (id, m) => eggroups.genderOf(id, m);

// ---- Pokédex «vista»: no hay seguimiento de vistos, así que cuenta lo que tienes, lo que tienes con candado y lo que has llegado a tener ----
const seenBy = (u, id) => !!((u.collection && u.collection[id]) || (u.locked && u.locked[id]) || (u.dexSeen && u.dexSeen[id]));
function seenList(u) {
  const out = new Set([...Object.keys(u.collection || {}), ...Object.keys(u.locked || {}), ...Object.keys(u.dexSeen || {})].map(Number));
  return [...out].filter((id) => BY_ID.has(id)).sort((a, b) => a - b);
}
const noteSeen = (u, id) => { if (!u.npc) (u.dexSeen ||= {})[id] = 1; };

// ---- Qué piden ----
const lvRange = (lv) => (lv ? [(lv - 1) * 10 + 1, lv * 10] : [1, 100]);
function cleanWant(u, w) {
  w = w && typeof w === 'object' ? w : {};
  const id = Number(w.id);
  if (!Number.isInteger(id) || !BY_ID.has(id)) throw new Error('Elige qué especie quieres a cambio.');
  if (!seenBy(u, id)) throw new Error('Solo puedes pedir Pokémon que has visto (que tengas o hayas tenido en tu Pokédex).');
  const g = w.g === 'M' || w.g === 'F' ? w.g : 'any';
  if (g !== 'any' && eggroups.fixedGender(id) !== undefined && eggroups.fixedGender(id) !== g) throw new Error(`${nameOf(id)} ${eggroups.fixedGender(id) ? 'es solo ' + (eggroups.fixedGender(id) === 'M' ? 'macho' : 'hembra') : 'no tiene sexo'}.`);
  const lv = Number(w.lv ?? 0);
  if (!Number.isInteger(lv) || lv < 0 || lv > 10) throw new Error('Rango de nivel no válido.');
  return { id, g, lv };
}
function meets(want, id, m) {
  if (Number(id) !== want.id) return false;
  if (want.g !== 'any' && sexOf(id, m) !== want.g) return false;
  ex.ensure(id, m);
  const [lo, hi] = lvRange(want.lv);
  return m.level >= lo && m.level <= hi;
}

// ---- Bloqueos: los mismos que para regalar/vender (fuera, compañero) y los que están en uso ahora mismo ----
// `what`: cómo se llama lo que se quiere hacer en los mensajes («la GTS», «el intercambio»). `roomId`: sala de intercambio directo que no cuenta como bloqueo (la propia).
function busyReason(u, id, m, what = 'la GTS', roomId = null) {
  if (m.away) return `${nameOf(id)} ${m.away === 'care' ? 'está en el Criadero' : 'está de expedición'}: espera a que vuelva.`;
  if (u.buddy && u.buddy.id === Number(id) && u.buddy.uid === m.uid) return `${nameOf(id)} es tu compañero: elige otro compañero antes.`;
  let inBattle = null;
  try { inBattle = require('./showdown').activeFor(u); } catch { /* sin combates */ }
  if (inBattle) return `Estás en un combate: termínalo antes de usar ${what}.`;
  const run = u.elite && u.elite.run;
  if (run && run.members.some((x) => x.uid === m.uid)) return `${nameOf(id)} está en tu carrera del Alto Mando.`;
  const heldIn = require('./trade').heldIn(u.id, m.uid);
  if (heldIn && heldIn !== roomId) return `${nameOf(id)} está ofrecido en una sala de intercambio.`;
  const inRaid = Object.values(db.data.raids || {}).some((r) => !r.over && r.players.some((p) => p.human && !p.left && p.userId === u.id && p.mon && p.mon.uid === m.uid));
  if (inRaid) return `${nameOf(id)} está en una Teraincursión.`;
  return null;
}

// ---- Cuentas y topes ----
function canUse(u, now, what = 'la GTS') {
  if (u.npc) throw new Error(`Los comerciantes NPC no usan ${what}.`);
  if (u.isAdmin) return;
  if (tr.young(u, now)) throw new Error(`Para usar ${what} necesitas nivel ${tr.GIFT_MIN_LEVEL} y una cuenta de al menos ${tr.GIFT_MIN_DAYS} días.`);
  if (tr.healed(u, now)) throw new Error(`La Enfermera Joy te ayudó hace menos de 24 h: hasta entonces no puedes usar ${what}.`);
}
function dayLeft(u, now = Date.now()) {
  const d = dayKey(now);
  if (!u.gts || u.gts.d !== d) u.gts = { d, n: 0 };
  return Math.max(0, DAILY - u.gts.n);
}
const room = (u, id) => { const c = u.collection[id]; return !c || c.n < MAX_STARS; };

// ---- Mover ejemplares ----
// Saca el ejemplar `m` (ya validado) de la Caja y lo devuelve con TODO lo suyo.
// `carryItem`: el objeto equipado viaja con el ejemplar (GTS, intercambio); si es false (Mercado, regalos) vuelve a la mochila.
function pull(u, id, m, carryItem = true) {
  m.drop = true; // sync() quita primero el marcado: así sale ESTE ejemplar y no otro
  if (carryItem) m.carry = true;
  try { gacha.takePoke(u, id, !!m.shiny); } catch (e) { delete m.drop; delete m.carry; throw e; }
  const arr = specimen.sync(u, id);
  for (const x of arr) delete x.drop;
  delete m.drop;
  delete m.carry;
  if (arr.includes(m)) throw new Error('No se pudo sacar el ejemplar de la Caja.');
  return m;
}
// Devuelve a la Caja, intacto, un ejemplar entero (retirada o caducidad).
function putBack(u, id, m) {
  if (!room(u, id)) throw new Error(`Ya tienes ${MAX_STARS} ${nameOf(id)} en la Caja: libera o transfiere uno para recuperarlo.`);
  const seen = new Set(specimen.sync(u, id).map((x) => x.uid));
  gacha.grant(u, id, !!m.shiny);
  const arr = specimen.sync(u, id);
  const i = arr.findIndex((x) => !seen.has(x.uid));
  if (i < 0) throw new Error('No se pudo devolver el ejemplar a la Caja.');
  arr[i] = m;
}
// Lo que viaja en un intercambio: rasgos (IV, naturaleza, Ball, marca, tamaño, OT, Teratipo, habilidad oculta) + nivel, EXP, movimientos, objeto y mote.
// NO viajan EVs ni amistad (el receptor los empieza de cero, como en los regalos).
function snapOf(from, id, m) {
  ex.ensure(id, m);
  require('./moves').ensure(id, m);
  require('./abilities').resolve(id, m); // deja fija la casilla de habilidad (abSlot) antes de copiarla
  return { id: Number(id), shiny: !!m.shiny, tr: specimen.traitsOf(m, from), level: m.level, exp: m.exp, nick: m.nick || '', item: m.item || null,
    mv: { learned: m.learned.slice(), sdMoves: m.sdMoves.slice(), pending: (m.pending || []).slice(), moves: Array.isArray(m.moves) ? m.moves.slice() : undefined, v: m.mv } };
}
// El receptor obtiene un ejemplar nuevo con lo que dice `snap`.
function receive(u, snap) {
  const id = snap.id;
  if (!room(u, id)) throw new Error(`Ya tienes ${MAX_STARS} ${nameOf(id)} en la Caja.`);
  const seen = new Set(specimen.sync(u, id).map((x) => x.uid));
  gacha.grant(u, id, snap.shiny);
  const got = specimen.sync(u, id).find((x) => !seen.has(x.uid));
  if (!got) throw new Error('No se pudo recibir el ejemplar.');
  specimen.applyTraits(id, got, snap.tr);
  got.level = snap.level; got.exp = snap.exp; ex.ensure(id, got);
  got.nick = snap.nick || '';
  if (snap.item) got.item = snap.item;
  got.learned = snap.mv.learned.slice(); got.sdMoves = snap.mv.sdMoves.slice(); got.pending = snap.mv.pending.slice();
  if (snap.mv.moves) got.moves = snap.mv.moves.slice();
  if (snap.mv.v !== undefined) got.mv = snap.mv.v;
  noteSeen(u, id);
  return got;
}

// ---- Vistas ----
const brief = (id, m) => ({ id: Number(id), shiny: !!m.shiny, level: m.level, gender: sexOf(id, m), nick: m.nick || '', ball: m.ball || null, ot: m.otn || null });
function pub(d, u) {
  const m = d.mon.m;
  return { id: d.id, user: d.username, at: d.at, expiresAt: d.expiresAt, state: d.state, want: d.want, mon: brief(d.mon.id, m),
    ...(d.state === 'done' ? { recv: { id: d.recv.id, shiny: d.recv.shiny, level: d.recv.level }, with: d.with } : {}), ...(u ? { mine: d.userId === u.id } : {}) };
}

// ---- Acciones ----
function deposit(u, p, now = Date.now()) {
  canUse(u, now);
  const id = Number(p.id);
  const want = cleanWant(u, p.want);
  if (!Number.isInteger(id) || !BY_ID.has(id)) throw new Error('Pokémon no válido.');
  const m = specimen.find(u, { id, uid: p.uid });
  const why = busyReason(u, id, m);
  if (why) throw new Error(why);
  const g = G();
  if (g.deps.filter((d) => d.userId === u.id).length >= MAX_ACTIVE) throw new Error(`Ya tienes ${MAX_ACTIVE} depósitos: retira uno o recoge los pendientes.`);
  if (u.coins < FEE) throw new Error(`Depositar cuesta ${FEE} monedas (no se devuelven).`);
  pull(u, id, m);
  u.coins -= FEE;
  hub.ledger(u, -FEE, 'gts_fee', 'Depósito en la GTS');
  noteSeen(u, id); noteSeen(u, want.id);
  const d = { id: g.nextId++, userId: u.id, username: u.username, at: now, expiresAt: now + EXPIRE_MS, state: 'open', mon: { id, m }, want };
  g.deps.push(d);
  db.save();
  return { dep: pub(d, u), ...state(u, now) };
}

function find(u, depId) {
  const d = G().deps.find((x) => x.id === Number(depId));
  if (!d || d.userId !== u.id) throw new Error('Ese depósito no es tuyo.');
  return d;
}

// Retira un depósito abierto o caducado: el ejemplar vuelve intacto a la Caja. La comisión no se devuelve.
function cancel(u, p, now = Date.now()) {
  const d = find(u, p.dep);
  if (d.state === 'done') throw new Error('Ya te han hecho un intercambio: recoge lo que recibiste.');
  putBack(u, d.mon.id, d.mon.m);
  G().deps.splice(G().deps.indexOf(d), 1);
  db.save();
  return state(u, now);
}

// Entrega al dueño lo que recibió (si cabe en su Caja). Devuelve true si se entregó.
function deliver(d) {
  const owner = db.userById(d.userId);
  if (!owner || !room(owner, d.recv.id)) return false;
  receive(owner, d.recv);
  G().deps.splice(G().deps.indexOf(d), 1);
  db.save();
  require('./notify').push(owner, { kind: 'gts', text: `🌐 GTS: ${d.with} ha intercambiado tu ${nameOf(d.mon.id)} y recibes ${d.recv.shiny ? nameOf(d.recv.id) + ' variocolor' : nameOf(d.recv.id)} (Nv. ${d.recv.level})`, link: '#/gts' });
  hub.emitUser(owner.id, 'toast', { kind: 'gts', text: `🌐 GTS: recibiste ${d.recv.shiny ? nameOf(d.recv.id) + ' variocolor' : nameOf(d.recv.id)} (Nv. ${d.recv.level}) de ${d.with} y ya está en tu Caja` });
  hub.pushMe(owner);
  return true;
}
// Caducados que vuelven al PC y recibidos pendientes: se hace solo al entrar en la GTS y cada 10 minutos.
function settle(now = Date.now(), only = null) {
  let n = 0;
  for (const d of G().deps.slice()) {
    if (only && d.userId !== only.id) continue;
    const owner = db.userById(d.userId);
    if (!owner) continue;
    try {
      if (d.state === 'open' && now >= d.expiresAt) d.state = 'expired';
      if (d.state === 'expired' && room(owner, d.mon.id)) {
        putBack(owner, d.mon.id, d.mon.m);
        G().deps.splice(G().deps.indexOf(d), 1);
        require('./notify').push(owner, { kind: 'gts', text: `🌐 Tu depósito de ${nameOf(d.mon.id)} caducó y vuelve a tu Caja (la comisión no se devuelve)`, link: '#/gts' });
        hub.emitUser(owner.id, 'toast', { kind: 'gts', text: `🌐 Tu depósito de ${nameOf(d.mon.id)} caducó y vuelve a tu Caja (la comisión no se devuelve)` });
        hub.pushMe(owner);
        n++;
      } else if (d.state === 'done' && deliver(d)) n++;
    } catch (e) { console.error('GTS:', e.message); }
  }
  if (n || G().deps.length) db.save();
  return n;
}
const claim = (u, _p, now = Date.now()) => { settle(now, u); return state(u, now); };

// Comprueba si `m` (de `u`) sirve para el depósito `d` y si todo lo demás permite el intercambio. Lanza un error en español si no.
function checkOffer(u, d, m, now) {
  const owner = db.userById(d.userId);
  if (d.state !== 'open' || now >= d.expiresAt) throw new Error('Ese depósito ya no está disponible.');
  if (d.userId === u.id) throw new Error('No puedes intercambiar con tu propio depósito.');
  if (!owner) throw new Error('Ese depósito ya no está disponible.');
  canUse(u, now);
  canUse(owner, now);
  if (dayLeft(u, now) < 1) throw new Error(`Hoy ya has hecho ${DAILY} intercambios en la GTS.`);
  if (dayLeft(owner, now) < 1) throw new Error(`${owner.username} ya ha hecho ${DAILY} intercambios en la GTS hoy.`);
  const id = d.want.id;
  const why = busyReason(u, id, m);
  if (why) throw new Error(why);
  if (!meets(d.want, id, m)) throw new Error(`No cumple lo que piden: ${wantText(d.want)}.`);
  // Topes de Pokémon recibidos al día (los mismos que los regalos) para los dos.
  tr.pokeInCheck(u, isRare(d.mon.id), now);
  tr.pokeInCheck(owner, isRare(id), now);
  if (d.mon.id !== id && !room(u, d.mon.id)) throw new Error(`Ya tienes ${MAX_STARS} ${nameOf(d.mon.id)} en la Caja: no te cabe otro.`);
  return owner;
}
function wantText(w) {
  const [lo, hi] = lvRange(w.lv);
  return `${nameOf(w.id)}${w.g === 'M' ? ' macho' : w.g === 'F' ? ' hembra' : ''}${w.lv ? ` de Nv. ${lo}-${hi}` : ' de cualquier nivel'}`;
}

// Intercambio inmediato: tu ejemplar `uid` por el del depósito. Todo se valida antes de tocar nada; como el servidor es de un solo hilo
// y el depósito pasa a 'done' en el mismo turno, si dos personas ofrecen a la vez solo gana la primera.
function offer(u, p, now = Date.now()) {
  const d = G().deps.find((x) => x.id === Number(p.dep));
  if (!d) throw new Error('Ese depósito ya no está disponible.');
  const id = d.want.id;
  const m = specimen.find(u, { id, uid: p.uid });
  const owner = checkOffer(u, d, m, now);
  const mine = snapOf(u, id, m); // lo que sale de mi Caja (con mis rasgos) …
  const theirs = snapOf(owner, d.mon.id, d.mon.m); // … y lo que sale del depósito
  pull(u, id, m);
  try { receive(u, theirs); } catch (e) { putBack(u, id, m); throw e; }
  tr.notePokeIn(u, isRare(d.mon.id), now);
  tr.notePokeIn(owner, isRare(id), now);
  dayLeft(u, now); u.gts.n++;
  dayLeft(owner, now); owner.gts.n++;
  d.state = 'done'; d.recv = mine; d.with = u.username; d.doneAt = now;
  const evo = require('./evoreq'); // intercambio real: vale como un Cordón Unión para los dos (ver evoreq.noteTrade)
  evo.noteTrade(u, owner, now);
  evo.noteTrade(owner, u, now);
  const g = G();
  g.log.push({ at: now, a: owner.username, b: u.username, ga: brief(d.mon.id, d.mon.m), gb: brief(id, m) });
  if (g.log.length > LOG_MAX) g.log.splice(0, g.log.length - LOG_MAX);
  const delivered = deliver(d);
  if (!delivered) require('./notify').push(owner, { kind: 'gts', text: `🌐 GTS: ${u.username} ha intercambiado tu ${nameOf(d.mon.id)}. Lo que recibes te espera en la GTS hasta que te quepa en la Caja`, link: '#/gts' });
  if (!delivered) hub.emitUser(owner.id, 'toast', { kind: 'gts', text: `🌐 GTS: ${u.username} intercambió tu ${nameOf(d.mon.id)}. Lo que recibiste te espera en la GTS hasta que te quepa en la Caja` });
  hub.feed('trade', `🌐 ${owner.username} y ${u.username} intercambiaron ${d.mon.m.shiny ? nameOf(d.mon.id) + ' variocolor' : nameOf(d.mon.id)} por ${m.shiny ? nameOf(id) + ' variocolor' : nameOf(id)} en la GTS`);
  db.save();
  hub.pushMe(owner);
  return { got: { id: d.mon.id, shiny: theirs.shiny, level: theirs.level }, gave: { id, level: mine.level }, ...state(u, now) };
}

// Lista de depósitos de una especie (la que quieres) con lo que piden y con qué ejemplares tuyos cumples.
function search(u, p = {}, now = Date.now()) {
  settle(now, null);
  const sp = p.species === undefined || p.species === null || p.species === '' ? null : Number(p.species);
  if (sp !== null && !BY_ID.has(sp)) throw new Error('Especie no válida.');
  const cache = new Map();
  const mine = (id) => {
    if (!cache.has(id)) cache.set(id, specimen.sync(u, id).filter((m) => !m.away && !(u.buddy && u.buddy.uid === m.uid)));
    return cache.get(id);
  };
  const list = G().deps.filter((d) => d.state === 'open' && now < d.expiresAt && d.userId !== u.id && (sp === null || d.mon.id === sp))
    .sort((a, b) => b.at - a.at).slice(0, RESULTS)
    .map((d) => ({ ...pub(d, u), can: mine(d.want.id).filter((m) => meets(d.want, d.want.id, m)).map((m) => m.uid).slice(0, 12) }));
  return { list, total: G().deps.filter((d) => d.state === 'open').length };
}

function state(u, now = Date.now()) {
  settle(now, u);
  const g = G();
  return {
    mine: g.deps.filter((d) => d.userId === u.id).map((d) => pub(d, u)),
    log: g.log.filter((x) => x.a === u.username || x.b === u.username).slice(-12).reverse().map((x) => ({ at: x.at, gave: x.a === u.username ? x.ga : x.gb, got: x.a === u.username ? x.gb : x.ga, with: x.a === u.username ? x.b : x.a })),
    seen: seenList(u), left: dayLeft(u, now), young: (() => { try { canUse(u, now); return null; } catch (e) { return e.message; } })(),
  };
}

let timer = null;
function init() {
  settle();
  if (!timer) { timer = setInterval(() => settle(), 10 * 60 * 1000); timer.unref(); }
}

module.exports = { pull, putBack, snapOf, receive, canUse, dayLeft, room, isRare, MAX_STARS, STATIC, FEE, MAX_ACTIVE, EXPIRE_MS, DAILY, deposit, cancel, claim, offer, search, state, settle, init, noteSeen, seenBy, seenList, wantText, meets, lvRange, busyReason, G };

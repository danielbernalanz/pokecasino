'use strict';
// Texas Hold'em No-Limit entre jugadores. Fichas compradas con monedas al sentarse
// y devueltas al levantarse. Sin comisión de la casa: es una partida entre amigos.
const db = require('../db');
const hub = require('../hub');
const { deck, best } = require('../cards');

const TABLES = [
  { id: 'pallet', name: 'Mesa Pueblo Paleta', sb: 10, bb: 20, min: 400, max: 4000, badges: 0 },
  { id: 'azulona', name: 'Mesa Ciudad Azulona', sb: 50, bb: 100, min: 2000, max: 20000, badges: 2 },
  { id: 'meseta', name: 'Mesa Meseta Añil', sb: 250, bb: 500, min: 10000, max: 100000, badges: 5 },
];
const SEATS = 6;
// POKER_SPEED solo se usa en las pruebas para acelerar los tiempos.
const SPEED = Number(process.env.POKER_SPEED) || 1;
const TURN_MS = 25000 / SPEED;
const NEXT_HAND_MS = 4000 / SPEED;
const SHOWDOWN_MS = 6000 / SPEED;

const tables = new Map(TABLES.map((t) => [t.id, { ...t, seats: Array(SEATS).fill(null), dealer: -1, hand: null, timer: null, nextTimer: null, log: [] }]));

const room = (t) => 'poker:' + t.id;

function seatOf(t, userId) { return t.seats.findIndex((s) => s && s.userId === userId); }
function note(t, text) { t.log.push({ text, at: Date.now() }); if (t.log.length > 30) t.log.shift(); }

// ---- Vista pública (cartas propias se envían aparte) ----
function publicTable(t) {
  const h = t.hand;
  return {
    id: t.id, name: t.name, sb: t.sb, bb: t.bb, min: t.min, max: t.max, badges: t.badges, dealer: t.dealer,
    seats: t.seats.map((s, i) => s && {
      username: s.username, buddy: s.buddy, frame: s.frame, cardback: s.cardback, title: s.title, stack: s.stack, sittingOut: s.sittingOut,
      inHand: !!(h && h.players.includes(i)), folded: !!(h && h.folded[i]), allIn: !!(h && h.allIn[i]),
      bet: h ? h.bets[i] || 0 : 0,
      cards: h && h.shown && h.shown[i] ? h.hole[i] : null,
      handName: h && h.shown && h.shown[i] ? h.shown[i] : null,
    }),
    hand: h && {
      no: h.no, board: h.board, pot: h.pot + h.bets.reduce((a, b) => a + (b || 0), 0), toAct: h.toAct, street: h.street,
      currentBet: h.currentBet, minRaise: h.minRaise, deadline: h.deadline, winners: h.winners || null,
      canRaise: h.toAct >= 0 && !h.acted[h.toAct],
    },
    log: t.log.slice(-12),
  };
}

// Apunta en el depósito las fichas de cada jugador sentado (más lo apostado en la mano en curso).
function syncEscrow(t) {
  const h = t.hand;
  t.seats.forEach((s, i) => {
    if (!s) return;
    const inPot = h && !h.finished && h.players.includes(i) ? h.contrib[i] : 0;
    db.escrowSet(`poker:${t.id}:${s.userId}`, s.userId, s.stack + inPot);
  });
}

function push(t) {
  syncEscrow(t);
  hub.broadcast('poker:lobby', lobby());
  // Cada jugador sentado recibe la mesa más sus propias cartas.
  const pub = publicTable(t);
  hub.emitRoom(room(t), 'poker:table', pub);
  if (t.hand) {
    t.hand.players.forEach((i) => {
      const s = t.seats[i];
      if (s) hub.emitUser(s.userId, 'poker:hole', { table: t.id, no: t.hand.no, cards: t.hand.hole[i] });
    });
  }
}

function lobby() {
  return [...tables.values()].map((t) => ({ id: t.id, name: t.name, sb: t.sb, bb: t.bb, min: t.min, max: t.max, badges: t.badges, players: t.seats.filter(Boolean).length, seats: SEATS }));
}

// ---- Sentarse / levantarse ----
function sit(user, { table, seat, buyIn }) {
  const t = tables.get(table);
  if (!t) throw new Error('Mesa no encontrada.');
  for (const other of tables.values()) if (seatOf(other, user.id) !== -1) throw new Error('Ya estás sentado en una mesa.');
  seat = Number(seat);
  buyIn = Number(buyIn);
  if (!Number.isInteger(seat) || seat < 0 || seat >= SEATS || t.seats[seat]) throw new Error('Asiento ocupado.');
  if (t.hand && t.hand.players.includes(seat)) throw new Error('Ese asiento se libera al terminar la mano.');
  if (!Number.isInteger(buyIn) || buyIn < t.min || buyIn > t.max) throw new Error(`Compra entre ${t.min} y ${t.max} fichas.`);
  if (user.coins < buyIn) throw new Error('No tienes suficientes monedas.');
  if ((user.progress ? user.progress.badges.length : 0) < t.badges) throw new Error(`Necesitas ${t.badges} medallas para sentarte en esta mesa.`);
  user.coins -= buyIn;
  t.seats[seat] = { userId: user.id, username: user.username, buddy: user.buddy, ...hub.looks(user), stack: buyIn, sittingOut: false, missed: 0, leaving: false };
  note(t, `${user.username} se sienta con ${buyIn} fichas.`);
  db.save();
  push(t);
  maybeStart(t);
  return { table: publicTable(t) };
}

function cashOut(t, i) {
  const s = t.seats[i];
  if (!s) return;
  db.escrowDel(`poker:${t.id}:${s.userId}`);
  const u = db.userById(s.userId);
  if (u) { u.coins += s.stack; hub.pushMe(u); }
  note(t, `${s.username} se levanta con ${s.stack} fichas.`);
  t.seats[i] = null;
  db.save();
}

function stand(user, { table }) {
  const t = tables.get(table);
  const i = t ? seatOf(t, user.id) : -1;
  if (i === -1) throw new Error('No estás sentado.');
  const h = t.hand;
  if (h && h.players.includes(i) && !h.folded[i] && !h.finished) {
    // Sigue en la mano: se retira y se levanta al terminarla.
    t.seats[i].leaving = true;
    if (h.toAct === i) doAction(t, i, 'fold');
    else {
      h.folded[i] = true;
      note(t, `${t.seats[i].username} se retira.`);
      if (live(h).length === 1) finish(t, [[live(h)[0]]], false);
    }
  } else {
    cashOut(t, i);
  }
  push(t);
  return {};
}

function setSitOut(user, { table, out }) {
  const t = tables.get(table);
  const i = t ? seatOf(t, user.id) : -1;
  if (i === -1) throw new Error('No estás sentado.');
  t.seats[i].sittingOut = !!out;
  t.seats[i].missed = 0;
  push(t);
  maybeStart(t);
  return {};
}

function rebuy(user, { table, amount }) {
  const t = tables.get(table);
  const i = t ? seatOf(t, user.id) : -1;
  if (i === -1) throw new Error('No estás sentado.');
  const h = t.hand;
  if (h && h.players.includes(i) && !h.finished) throw new Error('Espera a que termine la mano.');
  amount = Number(amount);
  const s = t.seats[i];
  if (!Number.isInteger(amount) || amount < 1 || s.stack + amount > t.max) throw new Error(`Máximo ${t.max} fichas en la mesa.`);
  if (user.coins < amount) throw new Error('No tienes suficientes monedas.');
  user.coins -= amount;
  s.stack += amount;
  db.save();
  push(t);
  maybeStart(t);
  return {};
}

// ---- Mano ----
const ready = (t) => t.seats.map((s, i) => (s && !s.sittingOut && !s.leaving && s.stack > 0 ? i : -1)).filter((i) => i !== -1);
function nextFrom(t, from, pred) {
  for (let k = 1; k <= SEATS; k++) {
    const i = (from + k) % SEATS;
    if (pred(i)) return i;
  }
  return -1;
}

function maybeStart(t) {
  if (t.hand || t.nextTimer) return;
  if (ready(t).length < 2) return;
  t.nextTimer = setTimeout(() => { t.nextTimer = null; startHand(t); }, 1500 / SPEED);
}

let handCounter = 0;
function startHand(t) {
  const players = ready(t);
  if (players.length < 2 || t.hand) return;
  t.dealer = nextFrom(t, t.dealer, (i) => players.includes(i));
  const d = deck(1);
  const h = {
    no: ++handCounter, deck: d, players, board: [], hole: {}, bets: Array(SEATS).fill(0), contrib: Array(SEATS).fill(0),
    folded: {}, allIn: {}, acted: {}, pot: 0, street: 'preflop', currentBet: 0, minRaise: t.bb, toAct: -1, finished: false,
  };
  t.hand = h;
  for (const i of players) {
    h.hole[i] = [d.pop(), d.pop()];
    const u = db.userById(t.seats[i].userId);
    if (u) hub.track(u, 'play', { game: 'poker' });
  }
  const inHand = (i) => players.includes(i);
  const headsUp = players.length === 2;
  const sbSeat = headsUp ? t.dealer : nextFrom(t, t.dealer, inHand);
  const bbSeat = nextFrom(t, sbSeat, inHand);
  post(t, sbSeat, t.sb);
  post(t, bbSeat, t.bb);
  h.currentBet = t.bb;
  h.bbSeat = bbSeat;
  note(t, `Mano #${h.no}: ciegas ${t.sb}/${t.bb}.`);
  h.toAct = nextFrom(t, bbSeat, (i) => canAct(h, i));
  if (h.toAct === -1) return runOut(t);
  armTimer(t);
  push(t);
}

function post(t, i, amount) {
  const h = t.hand;
  const s = t.seats[i];
  const a = Math.min(amount, s.stack);
  s.stack -= a;
  h.bets[i] += a;
  h.contrib[i] += a;
  if (s.stack === 0) h.allIn[i] = true;
}

const canAct = (h, i) => h.players.includes(i) && !h.folded[i] && !h.allIn[i];
const live = (h) => h.players.filter((i) => !h.folded[i]);

function armTimer(t) {
  clearTimeout(t.timer);
  const h = t.hand;
  h.deadline = Date.now() + TURN_MS;
  const actor = t.seats[h.toAct];
  if (actor) hub.emitUser(actor.userId, 'notify', { kind: 'turn', text: `🃏 Te toca en ${t.name}`, link: 'poker' });
  const no = h.no;
  const seat = h.toAct;
  t.timer = setTimeout(() => {
    if (!t.hand || t.hand.no !== no || t.hand.toAct !== seat) return;
    const s = t.seats[seat];
    if (s) { s.missed++; if (s.missed >= 2) s.sittingOut = true; }
    try { doAction(t, seat, t.hand.bets[seat] === t.hand.currentBet ? 'check' : 'fold'); } catch (e) { console.error('Hold\'em:', e); }
    push(t);
  }, TURN_MS);
}

function action(user, { table, type, amount }) {
  const t = tables.get(table);
  const i = t ? seatOf(t, user.id) : -1;
  if (i === -1 || !t.hand || t.hand.toAct !== i) throw new Error('No es tu turno.');
  t.seats[i].missed = 0;
  doAction(t, i, type, Number(amount));
  push(t);
  return {};
}

function doAction(t, i, type, amount) {
  const h = t.hand;
  const s = t.seats[i];
  const toCall = h.currentBet - h.bets[i];
  if (type === 'fold') {
    h.folded[i] = true;
    note(t, `${s.username} se retira.`);
  } else if (type === 'check') {
    if (toCall > 0) throw new Error('No puedes pasar: hay apuesta.');
    note(t, `${s.username} pasa.`);
  } else if (type === 'call') {
    if (toCall <= 0) throw new Error('No hay nada que igualar.');
    post(t, i, toCall);
    note(t, `${s.username} iguala ${Math.min(toCall, h.bets[i])}.`);
  } else if (type === 'raise' || type === 'allin') {
    const maxTo = h.bets[i] + s.stack;
    let to = type === 'allin' ? maxTo : amount;
    if (!Number.isInteger(to) || to <= h.currentBet) throw new Error('La subida debe superar la apuesta actual.');
    // Una subida all-in menor que la mínima no reabre la acción para quien ya habló.
    if (h.acted[i]) throw new Error('Solo puedes igualar o retirarte: la subida all-in no reabre la apuesta.');
    if (to > maxTo) throw new Error('No tienes tantas fichas.');
    const raiseBy = to - h.currentBet;
    if (raiseBy < h.minRaise && to < maxTo) throw new Error(`La subida mínima es hasta ${h.currentBet + h.minRaise}.`);
    post(t, i, to - h.bets[i]);
    if (raiseBy >= h.minRaise) {
      h.minRaise = raiseBy;
      h.acted = {}; // subida completa: todos deben volver a hablar
    }
    h.currentBet = Math.max(h.currentBet, h.bets[i]);
    note(t, `${s.username} ${h.allIn[i] ? 'va all-in con' : 'sube a'} ${h.bets[i]}.`);
  } else {
    throw new Error('Acción no válida.');
  }
  h.acted[i] = true;
  afterAction(t);
}

function afterAction(t) {
  const h = t.hand;
  if (live(h).length === 1) return finish(t, [[live(h)[0]]], false);
  const pending = h.players.filter((i) => canAct(h, i) && (!h.acted[i] || h.bets[i] < h.currentBet));
  if (pending.length) {
    h.toAct = nextFrom(t, h.toAct, (i) => pending.includes(i));
    armTimer(t);
    return;
  }
  nextStreet(t);
}

function collect(h) {
  for (let i = 0; i < SEATS; i++) { h.pot += h.bets[i]; h.bets[i] = 0; }
  h.currentBet = 0;
  h.acted = {};
}

function nextStreet(t) {
  const h = t.hand;
  collect(h);
  h.minRaise = t.bb;
  if (h.street === 'river') return showdown(t);
  if (h.street === 'preflop') { h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop()); h.street = 'flop'; }
  else if (h.street === 'flop') { h.board.push(h.deck.pop()); h.street = 'turn'; }
  else { h.board.push(h.deck.pop()); h.street = 'river'; }
  const actors = h.players.filter((i) => canAct(h, i));
  if (actors.length < 2) return runOut(t);
  h.toAct = nextFrom(t, t.dealer, (i) => actors.includes(i));
  armTimer(t);
}

// Nadie más puede apostar: se reparten las cartas que faltan.
function runOut(t) {
  const h = t.hand;
  collect(h);
  while (h.board.length < 5) h.board.push(h.deck.pop());
  h.street = 'river';
  showdown(t);
}

// Botes paralelos según lo aportado por cada jugador.
function sidePots(h) {
  const levels = [...new Set(h.players.map((i) => h.contrib[i]).filter((c) => c > 0))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const lvl of levels) {
    const contributors = h.players.filter((i) => h.contrib[i] >= lvl).length;
    const amount = (lvl - prev) * contributors;
    const eligible = h.players.filter((i) => !h.folded[i] && h.contrib[i] >= lvl);
    if (amount > 0) {
      if (eligible.length) pots.push({ amount, eligible });
      else if (pots.length) pots[pots.length - 1].amount += amount;
    }
    prev = lvl;
  }
  return pots;
}

function showdown(t) {
  const h = t.hand;
  h.shown = {};
  const values = {};
  for (const i of live(h)) {
    values[i] = best([...h.hole[i], ...h.board]);
    h.shown[i] = values[i].name;
  }
  const pots = sidePots(h);
  const awards = pots.map((p) => {
    const top = Math.max(...p.eligible.map((i) => values[i].score));
    return p.eligible.filter((i) => values[i].score === top);
  });
  finish(t, awards, true, pots, values);
}

function finish(t, awards, showdownReached, pots, values) {
  const h = t.hand;
  clearTimeout(t.timer);
  collect(h);
  h.finished = true;
  h.toAct = -1;
  if (!pots) pots = [{ amount: h.pot, eligible: awards[0] }];
  const winners = {};
  pots.forEach((p, k) => {
    const ws = awards[k];
    // Ordena desde la izquierda del botón para repartir las fichas sobrantes.
    const order = ws.slice().sort((a, b) => ((a - t.dealer + SEATS - 1) % SEATS) - ((b - t.dealer + SEATS - 1) % SEATS));
    const share = Math.floor(p.amount / ws.length);
    let rest = p.amount - share * ws.length;
    for (const i of order) {
      const won = share + (rest-- > 0 ? 1 : 0);
      if (t.seats[i]) t.seats[i].stack += won;
      winners[i] = (winners[i] || 0) + won;
    }
  });
  Object.keys(winners).forEach((i) => {
    const s = t.seats[i];
    const u = s && db.userById(s.userId);
    // Solo cuenta como victoria si ganó más de lo que puso.
    if (u && winners[i] > h.contrib[i]) hub.track(u, 'win', { game: 'poker', mult: winners[i] / Math.max(1, h.contrib[i]) });
  });
  h.winners = Object.entries(winners).map(([i, amount]) => ({ seat: Number(i), username: t.seats[i] && t.seats[i].username, amount, hand: values ? values[i].name : null }));
  for (const w of h.winners) {
    note(t, `${w.username} gana ${w.amount}${w.hand ? ' con ' + w.hand : ''}.`);
    if (w.amount >= t.bb * 100) hub.feed('win', `🃏 ${w.username} ganó un bote de ${w.amount.toLocaleString('es')} en ${t.name}${w.hand ? ' con ' + w.hand : ''}`);
  }
  if (!showdownReached) h.shown = {};
  push(t);
  setTimeout(() => endHand(t, h.no), showdownReached ? SHOWDOWN_MS : NEXT_HAND_MS);
}

function endHand(t, no) {
  if (!t.hand || t.hand.no !== no) return;
  t.hand = null;
  t.seats.forEach((s, i) => {
    if (!s) return;
    if (s.leaving || (s.sittingOut && s.missed >= 4) || (s.stack === 0 && s.sittingOut)) cashOut(t, i);
    else if (s.sittingOut) s.missed++;
  });
  push(t);
  maybeStart(t);
}

function watch(socket, { table }) {
  for (const t of tables.values()) socket.leave(room(t));
  const t = tables.get(table);
  if (!t) return { lobby: lobby() };
  socket.join(room(t));
  const i = seatOf(t, socket.data.userId);
  return { table: publicTable(t), hole: t.hand && i !== -1 && t.hand.hole[i] ? t.hand.hole[i] : null };
}

// Al apagar el servidor se devuelven fichas y lo apostado en la mano en curso.
function refundAll() {
  for (const t of tables.values()) {
    t.seats.forEach((s, i) => {
      if (!s) return;
      const u = db.userById(s.userId);
      if (u) u.coins += s.stack + (t.hand && !t.hand.finished ? t.hand.contrib[i] : 0);
      db.escrowDel(`poker:${t.id}:${s.userId}`);
    });
  }
}

module.exports = { sit, stand, setSitOut, rebuy, action, watch, lobby, refundAll, sidePots, TABLES, _tables: tables };

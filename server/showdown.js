'use strict';
// Combates reales al estilo Pokémon Showdown (individuales y dobles) con el simulador oficial.
// - Liga de entrenadores: contra la CPU (IA en sdai.js), con recompensas pequeñas y topadas por día.
// - PvP: retos entre jugadores con apuesta opcional (depósito en `escrow`, comisión del 5 %), igual que los duelos.
// El servidor es el dueño del BattleStream: cada jugador solo recibe SU flujo del simulador.
// El simulador se carga la primera vez que empieza un combate (ver sdmap.js).
const crypto = require('crypto');
const db = require('./db');
const hub = require('./hub');
const sd = require('./sdmap');
const trainers = require('./trainers');
const { Brain } = require('./sdai');
const { BY_ID } = require('./pokedex');

const MAX_BATTLES = Number(process.env.SD_MAX_BATTLES) || 8;
const TURN_MS = Number(process.env.SD_TURN_MS) || 60 * 1000;
const MAX_TIMEOUTS = 3;
const RAKE = 0.05;
const CHALLENGE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 60 * 60 * 1000;
const HIST_KEEP = 30;
const USER_HIST_KEEP = 20;
const MAX_TEAMS = 3;

const FORMATS = {
  singles: { id: 'gen9customgame', doubles: false, cap: 6, min: 1, label: 'Individual' },
  doubles: { id: 'gen9doublescustomgame', doubles: true, cap: 4, min: 2, label: 'Dobles' },
};
const LEVELS = new Set(['fair', 'real']);

const battles = new Map(); // id → Battle
const byUser = new Map(); // userId → Battle
const challenges = new Map();
const history = []; // últimos combates con registro completo (repeticiones)

// ---- Validación de lo que manda el cliente ----
const ACTION = '(?:move [1-4](?: -?[12])?(?: mega)?|switch [1-6]|pass|shift)';
const CHOICE_RE = new RegExp(`^(?:team [1-6]{1,6}|default|${ACTION}(?:, ${ACTION}){0,3})$`);
function validChoice(choice) {
  return typeof choice === 'string' && choice.length <= 100 && CHOICE_RE.test(choice);
}

// ---- Equipo del jugador ----
function resolveTeam(user, members, { format, level }) {
  const F = FORMATS[format];
  if (!F) throw new Error('Formato no válido.');
  if (!LEVELS.has(level)) throw new Error('Regla de nivel no válida.');
  if (!Array.isArray(members) || members.length < F.min || members.length > 6) {
    throw new Error(F.doubles ? 'En dobles lleva entre 2 y 6 Pokémon (lo recomendable son 4).' : 'Lleva entre 1 y 6 Pokémon.');
  }
  const specimen = require('./specimen');
  const mega = require('./mega');
  const seenUid = new Set();
  const seenSp = new Set();
  const usedNames = new Set();
  const sets = [];
  const roster = [];
  let megas = 0;
  for (const m of members) {
    if (!m || typeof m !== 'object') throw new Error('Equipo no válido.');
    const id = Number(m.id);
    const sp = specimen.find(user, { id, uid: m.uid });
    if (!sd.canBattle(id)) throw new Error(`${BY_ID.get(id).name} todavía no puede combatir.`);
    if (seenUid.has(sp.uid)) throw new Error('Ejemplar repetido en el equipo.');
    const base = sd.speciesOf(id).baseSpecies;
    if (seenSp.has(base)) throw new Error('Cláusula de especies: no puedes llevar dos Pokémon de la misma especie.');
    seenUid.add(sp.uid); seenSp.add(base);
    let formId = 0;
    if (m.mega) {
      formId = Number(m.mega);
      const f = mega.BY_FORM.get(formId);
      if (!f || f.species !== id) throw new Error('Esa megaevolución no es de ese Pokémon.');
      if (!mega.megasOf(user)[formId]) throw new Error('Aún no tienes desbloqueada esa megaevolución.');
      if (++megas > 1) throw new Error('Solo una megaevolución por equipo.');
    }
    const { set, roster: r } = sd.toSet(id, sp, { level, mega: formId, doubles: F.doubles, usedNames });
    sets.push(set);
    roster.push(r);
  }
  return { sets, roster };
}

// ---- Combate ----
class Battle {
  constructor({ mode, format, level, sides, wager = 0, trainer = null }) {
    this.id = crypto.randomUUID().slice(0, 8);
    this.mode = mode; // 'cpu' | 'pvp' | 'sim'
    this.format = format;
    this.level = level;
    this.wager = wager;
    this.trainer = trainer;
    this.sides = sides.map((s, i) => ({
      n: i, id: 'p' + (i + 1), userId: s.user ? s.user.id : null, name: s.name, sets: s.sets, roster: s.roster,
      brain: s.brain || null, req: null, chosen: false, deadline: 0, timer: null, timeouts: 0, log: [], seen: new Set(), human: !!s.user,
    }));
    this.pickN = Math.min(FORMATS[format].cap, ...this.sides.map((s) => s.sets.length));
    this.turn = 0;
    this.startedAt = Date.now();
    this.over = false;
    this.winner = undefined;
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
  }

  start() {
    const { BattleStream, getPlayerStreams } = sd.ps();
    const streams = (this.streams = getPlayerStreams(new BattleStream()));
    const maxLen = Math.max(...this.sides.map((s) => s.sets.length));
    const rules = ['Species Clause', 'Terastal Clause'];
    if (this.pickN < maxLen) rules.push(`Picked Team Size = ${this.pickN}`);
    const fid = `${FORMATS[this.format].id}@@@${rules.join(',')}`;
    const cmds = [`>start ${JSON.stringify({ formatid: fid })}`];
    for (const s of this.sides) cmds.push(`>player ${s.id} ${JSON.stringify({ name: s.name, team: sd.pack(s.sets) })}`);
    for (const s of this.sides) {
      if (s.brain) s.brain.pickN = this.pickN;
      (async () => {
        try { for await (const chunk of streams[s.id]) this.onChunk(s, chunk); } catch (e) { this.crash(e); }
      })();
    }
    streams.omniscient.write(cmds.join('\n'));
    return this;
  }

  humans() { return this.sides.filter((s) => s.human); }
  emitTo(side, ev, payload) { if (side.userId) hub.emitUser(side.userId, ev, payload); }

  onChunk(side, chunk) {
    if (this.over && this.finished) return;
    const out = [];
    const errs = [];
    let req = null;
    for (const line of String(chunk).split('\n')) {
      if (line.startsWith('|request|')) { try { req = JSON.parse(line.slice(9)); } catch { /* petición ilegible */ } continue; }
      if (line.startsWith('|error|')) { errs.push(line); continue; }
      if (line === '' || line.startsWith('|debug|')) continue;
      out.push(line);
    }
    for (const line of out) {
      const m = /^\|(?:switch|drag)\|p[12][ab]: ([^|]*)\|/.exec(line);
      if (m) side.seen.add(m[1]);
      if (side.n === 0 && line.startsWith('|turn|')) this.turn = Number(line.slice(6)) || this.turn;
      if (line.startsWith('|win|')) this.queueEnd(line.slice(5));
      else if (line === '|tie') this.queueEnd(null);
    }
    if (out.length) { side.log.push(...out); if (side.log.length > 3000) side.log.splice(0, side.log.length - 3000); }
    if (side.brain && out.length) side.brain.feed(out);
    if (req) {
      side.req = req;
      side.chosen = !!req.wait;
      side.errs = 0;
      if (!req.wait && side.human) { side.deadline = Date.now() + TURN_MS; this.arm(side); } else if (side.timer) { clearTimeout(side.timer); side.timer = null; }
    }
    if (errs.length && side.human) {
      side.chosen = false;
      if (side.req && !side.req.wait) this.arm(side);
    }
    if (side.human && (out.length || errs.length || req)) {
      this.emitTo(side, 'battle:event', { id: this.id, lines: [...out, ...errs], request: req || undefined, deadline: req && !req.wait ? side.deadline : undefined, wait: req ? !!req.wait : undefined });
    }
    if (side.brain) {
      if (errs.length) {
        side.errs = (side.errs || 0) + 1;
        if (side.errs <= 2) this.write(side, 'default');
      } else if (req && !req.wait) {
        setImmediate(() => {
          if (this.over) return;
          const choice = side.brain.decide(req) || 'default';
          this.write(side, choice);
        });
      }
    }
  }

  write(side, choice) {
    if (this.finished) return;
    try { this.streams[side.id].write(choice); } catch (e) { this.crash(e); }
  }

  // ---- Temporizador de turno (solo humanos) ----
  arm(side) {
    if (side.timer) clearTimeout(side.timer);
    const left = Math.max(0, side.deadline - Date.now());
    side.timer = setTimeout(() => this.timeout(side), left);
    if (side.timer.unref) side.timer.unref();
  }
  timeout(side) {
    side.timer = null;
    if (this.over || side.chosen || !side.req || side.req.wait) return;
    side.timeouts++;
    if (side.timeouts >= MAX_TIMEOUTS) { this.forfeit(side, 'por inactividad'); return; }
    this.emitTo(side, 'battle:event', { id: this.id, lines: [`|inactive|${side.name} se ha quedado sin tiempo (${side.timeouts}/${MAX_TIMEOUTS}): se elige una acción automática.`] });
    side.chosen = true;
    this.write(side, 'default');
  }

  choose(side, choice) {
    if (this.over) throw new Error('El combate ya ha terminado.');
    if (!validChoice(choice)) throw new Error('Elección no válida.');
    if (!side.req) throw new Error('Todavía no hay nada que elegir.');
    if (side.req.wait) throw new Error('Espera: ahora le toca elegir al rival.');
    if (side.chosen) throw new Error('Ya has elegido. Espera al rival.');
    side.timeouts = 0;
    side.chosen = true;
    if (side.timer) { clearTimeout(side.timer); side.timer = null; }
    this.write(side, choice);
  }

  forfeit(side, why = '') {
    if (this.over) return;
    this.write({ id: 'omniscient' }, `>forcelose ${side.id}`);
    this.forfeited = { side: side.n, why };
    this.emitTo(side, 'battle:event', { id: this.id, lines: [`|inactive|${side.name} se rinde${why ? ' ' + why : ''}.`] });
    // El simulador responde con |win|; por si acaso no llegara se cierra solo.
    setTimeout(() => this.over || this.queueEnd(this.sides[1 - side.n].name), 1500).unref();
  }

  queueEnd(winnerName) {
    if (this.over) return;
    this.over = true;
    this.winner = winnerName === null ? null : this.sides.findIndex((s) => s.name === winnerName);
    if (this.winner === -1) this.winner = null;
    setTimeout(() => this.finish(), 80); // (sin unref: tiene que llegar a liquidar)
  }

  teardown() {
    for (const s of this.sides) if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    try { this.streams.omniscient.writeEnd(); } catch { /* ya cerrado */ }
    battles.delete(this.id);
    for (const s of this.sides) if (s.userId && byUser.get(s.userId) === this) byUser.delete(s.userId);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    let result;
    try { result = settle(this); } catch (e) { console.error('Combate: error al liquidar', e); result = { error: true }; }
    this.teardown();
    this.resolveDone({ winner: this.winner, turns: this.turn, result });
  }

  // Algo ha ido mal en el simulador: se acaba el combate y se devuelven las apuestas.
  crash(e) {
    if (this.finished) return;
    console.error('Combate: error del simulador', e && e.stack ? e.stack : e);
    this.over = true;
    this.finished = true;
    try { refundBattle(this); } catch (e2) { console.error(e2); }
    for (const s of this.humans()) this.emitTo(s, 'battle:end', { id: this.id, aborted: true, text: 'El combate se ha interrumpido por un error. Si había apuesta, se te ha devuelto.' });
    this.teardown();
    this.resolveDone({ winner: null, turns: this.turn, aborted: true });
  }

  view(side) {
    return {
      id: this.id, mode: this.mode, format: this.format, level: this.level, wager: this.wager, side: side.id, pickN: this.pickN,
      you: side.name, foe: this.sides[1 - side.n].name, trainer: this.trainer ? { id: this.trainer.id, name: this.trainer.name, cls: this.trainer.cls } : null,
      roster: { p1: this.sides[0].roster, p2: this.sides[1].roster },
      log: side.log, request: side.req || null, chosen: side.chosen, deadline: side.chosen || !side.req || side.req.wait ? 0 : side.deadline, turnMs: TURN_MS, over: this.over,
    };
  }
}

// ---- Liquidación ----
const escKey = (b, n) => `btl:${b.id}:${n}`;

function refundOne(u, wager) {
  if (!u || !wager) return;
  u.coins += wager; u.stats.wagered -= wager;
  hub.gameStat(u, 'duel', -wager, 0, -1);
  hub.pushMe(u);
}
function refundBattle(b) {
  b.sides.forEach((s, i) => {
    if (b.mode === 'pvp') { db.escrowDel(escKey(b, i)); refundOne(db.userById(s.userId), b.wager); }
  });
  db.save();
}

function dayWins(u) {
  const k = hub.dayKey();
  if (!u.btDay || u.btDay.day !== k) u.btDay = { day: k, wins: 0 };
  return u.btDay;
}

function pushHist(u, entry) {
  (u.btHist ||= []).unshift(entry);
  u.btHist.length = Math.min(u.btHist.length, USER_HIST_KEEP);
}

function participants(b, side) {
  const out = [];
  for (const r of side.roster) if (side.seen.has(r.name)) out.push(r);
  return out;
}

function cpuReward(b, user, side) {
  const t = b.trainer;
  const d = dayWins(user);
  const out = { coins: 0, candy: [], friend: 0, capped: false, winsLeft: 0 };
  if (d.wins >= trainers.WINS_PER_DAY) { out.capped = true; return out; }
  d.wins++;
  out.winsLeft = trainers.WINS_PER_DAY - d.wins;
  out.coins = trainers.COINS[t.tier] || 20;
  user.coins += out.coins;
  hub.ledger(user, out.coins, 'battle', `Combate contra ${t.cls} ${t.name}`);
  const candy = require('./candy');
  const bond = require('./bond');
  const specimen = require('./specimen');
  const fams = new Set();
  for (const r of participants(b, side)) {
    const p = BY_ID.get(r.id);
    if (p && !fams.has(p.chain)) { fams.add(p.chain); candy.addCandy(user, r.id, 2); out.candy.push(p.name); }
    try { const sp = specimen.find(user, { id: r.id, uid: r.uid }); out.friend += bond.addFriend(sp, 2, 'battle'); } catch { /* el ejemplar ya no está */ }
  }
  hub.addXp(user, 15, { flat: true });
  hub.track(user, 'battle_win');
  return out;
}

function settle(b) {
  const humans = b.humans();
  const res = { id: b.id, at: Date.now(), mode: b.mode, format: b.format, level: b.level, wager: b.wager, turns: b.turn, players: b.sides.map((s) => s.name), winner: b.winner === null || b.winner === undefined ? null : b.winner, trainer: b.trainer ? b.trainer.id : null };
  if (b.mode === 'sim') return res;
  const rec = { ...res, log: { p1: b.sides[0].log, p2: b.sides[1].log }, users: b.sides.map((s) => s.userId), roster: { p1: b.sides[0].roster, p2: b.sides[1].roster }, pickN: b.pickN };
  history.unshift(rec);
  history.length = Math.min(history.length, HIST_KEEP);
  if (b.mode === 'cpu') {
    const side = b.sides[0];
    const user = db.userById(side.userId);
    const won = b.winner === 0;
    let reward = null;
    if (user) {
      if (won) reward = cpuReward(b, user, side);
      pushHist(user, { id: b.id, at: res.at, mode: 'cpu', format: b.format, level: b.level, foe: `${b.trainer.cls} ${b.trainer.name}`, won, tie: b.winner === null, turns: b.turn, coins: reward ? reward.coins : 0 });
      hub.track(user, 'battle_play');
      db.save();
      hub.pushMe(user);
    }
    hub.emitUser(side.userId, 'battle:end', { id: b.id, winner: b.winner === null ? 'tie' : won ? 'you' : 'foe', reward, trainer: { id: b.trainer.id, name: b.trainer.name, cls: b.trainer.cls, quote: b.trainer.quote } });
    return res;
  }
  // PvP
  const players = b.sides.map((s) => db.userById(s.userId));
  b.sides.forEach((s, i) => db.escrowDel(escKey(b, i)));
  let prize = 0;
  const tie = b.winner === null || b.winner === undefined;
  if (tie) {
    players.forEach((u) => refundOne(u, b.wager));
  } else {
    const winner = players[b.winner];
    const loser = players[1 - b.winner];
    if (b.wager && winner) {
      prize = Math.floor(b.wager * 2 * (1 - (require('./events').has('duels') ? 0 : RAKE)));
      hub.pay(winner, prize, b.wager, 'duel', { noBonus: true });
    }
    if (winner) { winner.stats.duelsWon++; hub.track(winner, 'duel_win'); hub.addXp(winner, 50, { flat: true }); }
    if (loser) { loser.stats.duelsLost++; hub.addXp(loser, 20, { flat: true }); }
    const bond = require('./bond');
    const specimen = require('./specimen');
    if (winner) for (const r of participants(b, b.sides[b.winner])) { try { bond.addFriend(specimen.find(winner, { id: r.id, uid: r.uid }), 2, 'battle'); } catch { /* ya no está */ } }
  }
  if (b.wager) for (const u of players) if (u) hub.addXp(u, b.wager * require('./balance').xpRate('duel'));
  for (const u of players) if (u) { hub.track(u, 'duel_play'); hub.track(u, 'play', { game: 'duel' }); }
  res.prize = prize;
  players.forEach((u, i) => {
    if (!u) return;
    pushHist(u, { id: b.id, at: res.at, mode: 'pvp', format: b.format, level: b.level, foe: b.sides[1 - i].name, won: !tie && b.winner === i, tie, turns: b.turn, wager: b.wager, coins: !tie && b.winner === i ? prize - b.wager : tie ? 0 : -b.wager });
    hub.pushMe(u);
  });
  db.save();
  b.sides.forEach((s, i) => hub.emitUser(s.userId, 'battle:end', { id: b.id, winner: tie ? 'tie' : b.winner === i ? 'you' : 'foe', prize: b.winner === i ? prize : 0, wager: b.wager, forfeited: b.forfeited ? b.forfeited.side === i : false }));
  if (!tie) {
    const w = players[b.winner]; const l = players[1 - b.winner];
    if (w && l) hub.feed('duel', `⚔️ ${w.username} venció a ${l.username} en un combate ${FORMATS[b.format].label.toLowerCase()}${b.wager ? ` y ganó ${prize.toLocaleString('es')} monedas` : ''}`);
  }
  return res;
}

// ---- Arranque ----
function checkCapacity() {
  if (battles.size >= MAX_BATTLES) throw new Error('Hay demasiados combates en curso ahora mismo. Inténtalo de nuevo en un minuto.');
}
function checkFree(user) {
  if (byUser.has(user.id)) throw new Error('Ya estás en un combate.');
}
function register(b) {
  battles.set(b.id, b);
  for (const s of b.sides) if (s.userId) byUser.set(s.userId, b);
  b.start();
  for (const s of b.humans()) hub.emitUser(s.userId, 'battle:start', { battle: b.view(s) });
  return b;
}

function startCpu(user, { trainer: trainerId, format, level = 'fair', team }) {
  checkFree(user);
  checkCapacity();
  const t = trainers.BY_TRAINER.get(String(trainerId));
  if (!t) throw new Error('Ese entrenador no existe.');
  if (!trainers.unlocked(t, user)) throw new Error(`Necesitas ${t.badges} medallas para retar a ${t.name}.`);
  const mine = resolveTeam(user, team, { format, level });
  const avg = mine.roster.reduce((s, r) => s + r.level, 0) / mine.roster.length;
  const foe = trainers.buildTeam(t, Math.min(FORMATS[format].cap, mine.sets.length), { level, avgLevel: avg, doubles: FORMATS[format].doubles });
  const doubles = FORMATS[format].doubles;
  const b = new Battle({
    mode: 'cpu', format, level, trainer: t,
    sides: [
      { user, name: user.username, sets: mine.sets, roster: mine.roster },
      { name: `${t.cls} ${t.name}`, sets: foe.sets, roster: foe.roster, brain: new Brain('p2', { doubles }) },
    ],
  });
  register(b);
  return { battle: b.view(b.sides[0]) };
}

// ---- PvP ----
function listPublic() {
  return [...challenges.values()].map((c) => ({ id: c.id, creator: c.creator, format: c.format, level: c.level, wager: c.wager, target: c.target, size: c.members.length, createdAt: c.createdAt }));
}
const pushList = () => hub.broadcast('battle:list', listPublic());

function challenge(user, { format, level = 'fair', wager, target, team }) {
  checkFree(user);
  if ([...challenges.values()].filter((c) => c.creatorId === user.id).length >= 2) throw new Error('Máximo 2 retos abiertos.');
  resolveTeam(user, team, { format, level }); // valida
  wager = Number(wager) || 0;
  if (target) {
    const t = db.userByName(String(target));
    if (!t || t.npc || t.id === user.id) throw new Error('Rival no encontrado.');
    target = t.username;
  } else target = null;
  if (wager !== 0) hub.takeBet(user, wager, 'duel', { quiet: true, noXp: true });
  const c = { id: crypto.randomUUID().slice(0, 8), creatorId: user.id, creator: user.username, format, level, wager, target, members: team.map((m) => ({ id: Number(m.id), uid: String(m.uid), mega: Number(m.mega) || 0 })), createdAt: Date.now() };
  challenges.set(c.id, c);
  db.escrowSet('btlc:' + c.id, user.id, wager);
  pushList();
  if (c.target) hub.emitUser(db.userByName(c.target).id, 'toast', { kind: 'duel', text: `⚔️ ${user.username} te reta a un combate ${FORMATS[format].label.toLowerCase()}${wager ? ` por ${wager} monedas` : ''}` });
  return { challenge: c.id };
}

function dropChallenge(c, refund = true) {
  challenges.delete(c.id);
  db.escrowDel('btlc:' + c.id);
  if (refund) refundOne(db.userById(c.creatorId), c.wager);
  db.save();
}

function cancel(user, { id }) {
  const c = challenges.get(id);
  if (!c || (c.creatorId !== user.id && !user.isAdmin)) throw new Error('Reto no encontrado.');
  dropChallenge(c);
  pushList();
  return {};
}

function accept(user, { id, team }) {
  const c = challenges.get(id);
  if (!c) throw new Error('Ese reto ya no existe.');
  if (c.creatorId === user.id) throw new Error('No puedes aceptar tu propio reto.');
  if (c.target && c.target !== user.username) throw new Error('Este reto es para otro entrenador.');
  checkFree(user);
  const creator = db.userById(c.creatorId);
  if (!creator || byUser.has(creator.id)) throw new Error('El retador está en otro combate ahora mismo.');
  checkCapacity();
  const mine = resolveTeam(user, team, { format: c.format, level: c.level });
  let theirs;
  try { theirs = resolveTeam(creator, c.members, { format: c.format, level: c.level }); } catch (e) {
    dropChallenge(c); pushList();
    throw new Error('El equipo del retador ya no es válido; el reto se ha cancelado.');
  }
  if (c.wager) hub.takeBet(user, c.wager, 'duel', { quiet: true, noXp: true });
  challenges.delete(c.id);
  db.escrowDel('btlc:' + c.id);
  const b = new Battle({
    mode: 'pvp', format: c.format, level: c.level, wager: c.wager,
    sides: [{ user: creator, name: creator.username, sets: theirs.sets, roster: theirs.roster }, { user, name: user.username, sets: mine.sets, roster: mine.roster }],
  });
  if (c.wager) { db.escrowSet(escKey(b, 0), creator.id, c.wager); db.escrowSet(escKey(b, 1), user.id, c.wager); }
  register(b);
  pushList();
  return { battle: b.view(b.sides[1]) };
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const c of challenges.values()) if (now - c.createdAt > CHALLENGE_MS) { dropChallenge(c); changed = true; }
  if (changed) pushList();
  for (const b of battles.values()) if (now - b.startedAt > MAX_AGE_MS) b.crash(new Error('Combate demasiado largo'));
}, 30000).unref();

function refundAll() {
  for (const c of [...challenges.values()]) dropChallenge(c);
  for (const b of [...battles.values()]) b.crash(new Error('Apagado del servidor'));
}

// ---- Acciones desde el cliente ----
function sideOf(user, id) {
  const b = battles.get(String(id));
  if (!b) throw new Error('Ese combate ya no existe.');
  const side = b.sides.find((s) => s.userId === user.id);
  if (!side) throw new Error('No participas en ese combate.');
  return { b, side };
}
function choose(user, { id, choice }) {
  const { b, side } = sideOf(user, id);
  b.choose(side, choice);
  return {};
}
function forfeitAction(user, { id }) {
  const { b, side } = sideOf(user, id);
  b.forfeit(side);
  return {};
}
function resume(user) {
  const b = byUser.get(user.id);
  return { battle: b ? b.view(b.sides.find((s) => s.userId === user.id)) : null };
}
const activeFor = (user) => { const b = byUser.get(user.id); return b ? b.id : null; };

function historyOf(user) {
  const d = dayWins(user);
  return { history: user.btHist || [], wins: { n: d.wins, max: trainers.WINS_PER_DAY } };
}
function replay(user, { id }) {
  const rec = history.find((h) => h.id === String(id) && h.users.includes(user.id));
  if (!rec) return { replay: null };
  const i = rec.users.indexOf(user.id);
  return { replay: { id: rec.id, mode: rec.mode, format: rec.format, players: rec.players, winner: rec.winner, side: 'p' + (i + 1), log: rec.log['p' + (i + 1)], roster: rec.roster, pickN: rec.pickN } };
}

// ---- Equipos guardados y constructor ----
function sanitizeMembers(user, members) {
  if (!Array.isArray(members) || members.length < 1 || members.length > 6) throw new Error('Un equipo lleva de 1 a 6 Pokémon.');
  const specimen = require('./specimen');
  const mega = require('./mega');
  return members.map((m) => {
    const id = Number(m && m.id);
    const sp = specimen.find(user, { id, uid: m && m.uid });
    let formId = 0;
    if (m.mega) {
      formId = Number(m.mega);
      const f = mega.BY_FORM.get(formId);
      if (!f || f.species !== id || !mega.megasOf(user)[formId]) throw new Error('Megaevolución no disponible.');
    }
    return { id, uid: sp.uid, mega: formId };
  });
}
function saveTeam(user, { slot, name, members }) {
  slot = Number(slot);
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_TEAMS) throw new Error('Hueco de equipo no válido.');
  const clean = sanitizeMembers(user, members);
  const teams = (user.btTeams ||= []);
  const nm = Array.from(String(name || `Equipo ${slot + 1}`).replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').trim()).slice(0, 20).join('') || `Equipo ${slot + 1}`;
  teams[slot] = { name: nm, members: clean };
  for (let i = 0; i < teams.length; i++) if (!teams[i]) teams[i] = null;
  db.save();
  return { teams };
}
function deleteTeam(user, { slot }) {
  slot = Number(slot);
  const teams = (user.btTeams ||= []);
  if (teams[slot]) teams[slot] = null;
  db.save();
  return { teams };
}

// Todos los ejemplares con su habilidad y movimientos por defecto, para el constructor de equipos.
function boxForBuilder(user) {
  const specimen = require('./specimen');
  const mega = require('./mega');
  specimen.syncAll(user);
  const megas = mega.megasOf(user);
  const out = [];
  for (const [idStr, arr] of Object.entries(user.mons || {})) {
    const id = Number(idStr);
    if (!sd.canBattle(id)) continue;
    const forms = Object.keys(megas).map(Number).map((fid) => mega.BY_FORM.get(fid)).filter((f) => f && f.species === id && (() => { try { return !!sd.megaSetup(f.formId); } catch { return false; } })()).map((f) => f.formId);
    for (const m of arr) {
      sd.ensureSd(id, m);
      out.push({ id, uid: m.uid, nick: m.nick, level: m.level, gender: m.gender, shiny: m.shiny, friendship: m.friendship, nature: m.nature, ability: m.sdAbility, moves: m.sdMoves, megas: forms, iv: (m.ivs || []).reduce((a, x) => a + x, 0) });
    }
  }
  db.save();
  return { mons: out, teams: user.btTeams || [], abilities: undefined };
}
function learnsetOf(user, { id, uid }) {
  const specimen = require('./specimen');
  const m = specimen.find(user, { id, uid });
  id = Number(id);
  sd.ensureSd(id, m);
  return {
    id, uid: m.uid, ability: m.sdAbility, moves: m.sdMoves,
    abilities: sd.allAbilitiesOf(id),
    learnset: sd.learnable(id).map((x) => sd.moveCard(x)).filter(Boolean),
  };
}
function setMoves(user, { id, uid, moves, ability }) {
  const specimen = require('./specimen');
  const m = specimen.find(user, { id, uid });
  id = Number(id);
  sd.ensureSd(id, m);
  const v = sd.validateSd(id, { moves, ability });
  Object.assign(m, v);
  db.save();
  return { ability: m.sdAbility, moves: m.sdMoves };
}

function state(user) {
  const d = dayWins(user);
  return { trainers: trainers.listFor(user), wins: { n: d.wins, max: trainers.WINS_PER_DAY }, teams: user.btTeams || [], challenges: listPublic(), active: activeFor(user), formats: Object.fromEntries(Object.entries(FORMATS).map(([k, f]) => [k, { label: f.label, min: f.min, cap: f.cap }])), max: MAX_BATTLES, running: battles.size, turnMs: TURN_MS };
}

// ---- Para pruebas: combate completo sin humanos (IA contra IA). ----
function runAiBattle({ format = 'singles', teamA, teamB, level = 'fair', timeoutMs = 60000 } = {}) {
  const doubles = FORMATS[format].doubles;
  const mk = (t, name, side) => ({ name, sets: t.sets, roster: t.roster, brain: new Brain(side, { doubles }) });
  const b = new Battle({ mode: 'sim', format, level, sides: [mk(teamA, 'IA uno', 'p1'), mk(teamB, 'IA dos', 'p2')] });
  battles.set(b.id, b);
  b.start();
  const to = setTimeout(() => b.crash(new Error('Tiempo agotado en la prueba')), timeoutMs);
  return b.done.then((r) => { clearTimeout(to); return { ...r, log: b.sides[0].log }; });
}

module.exports = {
  MAX_BATTLES, TURN_MS, MAX_TIMEOUTS, RAKE, FORMATS, validChoice, resolveTeam, startCpu, challenge, cancel, accept, choose,
  forfeit: forfeitAction, resume, activeFor, historyOf, replay, saveTeam, deleteTeam, boxForBuilder, learnsetOf, setMoves, state,
  listPublic, refundAll, runAiBattle, battles, challenges, dayWins,
};

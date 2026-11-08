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
const battleMoney = require('./battlemoney');
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
Object.setPrototypeOf(FORMATS, null); // claves que manda el cliente: sin 'constructor' ni '__proto__'
const LEVELS = new Set(['fair', 'real']);
const RESTORE_GRACE_MS = 60 * 1000;
const ABANDON_MS = 15 * 60 * 1000;
let SIM_VERSION = null;
try { SIM_VERSION = require('pokemon-showdown/package.json').version; } catch { SIM_VERSION = 'desconocida'; }

const battles = new Map(); // id → Battle
const byUser = new Map(); // userId → Battle
const challenges = new Map();
const queue = new Map(); // userId → { userId, format, level, band, wager, team, at }: «Buscar rival»
const history = []; // últimos combates con registro completo (repeticiones)

// ---- Validación de lo que manda el cliente ----
const ACTION = '(?:move [1-4](?: -?[12])?(?: mega| terastallize)?|switch [1-6]|pass|shift)';
const CHOICE_RE = new RegExp(`^(?:team [1-6]{1,6}|default|${ACTION}(?:, ${ACTION}){0,3})$`);
function validChoice(choice) {
  return typeof choice === 'string' && choice.length <= 100 && CHOICE_RE.test(choice);
}

// ---- Equipo del jugador ----
// `itemClause` (solo PvP): no se pueden llevar dos Pokémon con el mismo objeto.
function resolveTeam(user, members, { format, level, itemClause = false }) {
  const F = typeof format === 'string' && Object.hasOwn(FORMATS, format) ? FORMATS[format] : null;
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
  const seenItem = new Set();
  const sets = [];
  const roster = [];
  let megas = 0;
  for (const m of members) {
    if (!m || typeof m !== 'object') throw new Error('Equipo no válido.');
    const id = Number(m.id);
    const sp = specimen.find(user, { id, uid: m.uid });
    specimen.assertFree(sp, BY_ID.get(id).name);
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
    if (itemClause && set.item) {
      if (seenItem.has(set.item)) throw new Error('Cláusula de objetos: no puedes llevar dos Pokémon con el mismo objeto.');
      seenItem.add(set.item);
    }
    sets.push(set);
    roster.push(r);
  }
  return { sets, roster };
}

// Orden `>eval` para el simulador (queda en el registro de entradas, así que el combate se reconstruye igual tras un reinicio): fija PS, estado y PP de
// los Pokémon del jugador. `carry[i]` es lo de su i-ésimo Pokémon en el equipo ({ hp, max, s, pp }), o null. Si cambió el máximo de PS (subió de nivel) se conserva la proporción.
function carryCmd(carry) {
  const C = JSON.stringify(carry.map((c) => (c ? { hp: c.hp, max: c.max, s: c.s || '', pp: c.pp || {} } : null)));
  return `>eval const C=${C};C.forEach((c,i)=>{const p=p1.pokemon[i];if(!p||!c)return;p.sethp(Math.max(1,c.max===p.maxhp?c.hp:Math.round(p.maxhp*c.hp/c.max)));if(c.s)p.setStatus(c.s);for(const [m,n] of Object.entries(c.pp)){const sl=p.moveSlots.find(x=>x.id===m);if(sl)sl.pp=Math.min(sl.maxpp,n);}})`;
}

// ---- Combate ----
class Battle {
  constructor({ mode, format, level, sides, wager = 0, trainer = null, id = null, seed = null, createdAt = null, affection = false, ranked = false, tower = null, full = false, elite = null, tera = false, tn = null }) {
    this.id = id || crypto.randomUUID().slice(0, 8);
    // Semilla explícita: el simulador es determinista con ella y el registro de entradas, así que un combate se puede reconstruir.
    this.seed = seed || [0, 1, 2, 3].map(() => crypto.randomInt(1, 0x10000));
    this.inputLog = [];
    this.replaying = false;
    this.createdAt = createdAt || Date.now();
    this.mode = mode; // 'cpu' | 'pvp' | 'sim'
    this.format = format;
    this.level = level;
    this.wager = wager;
    this.trainer = trainer;
    this.ranked = !!ranked; // Clasificatoria de la Liga (league.js): solo PvP, nivel 50, sin apuesta ni afecto
    this.full = !!full; // líderes y Alto Mando: cada bando lleva su equipo entero (sin «Picked Team Size»), el del jugador de hasta 6
    // Teracristalización (tera.js): solo si el modo lo permite (Combates libres, PvP con la regla y Teraincursiones) y cada jugador necesita el Orbe.
    this.tera = !!tera;
    this.tn = tn; // combate de un torneo (tourney.js): { id, r, i }
    this.elite = elite; // carrera del Alto Mando (elite.js): { stage, carry } — los PS, PP y estados del jugador se arrastran de un combate al siguiente
    this.tower = tower; // Torre Batalla (tower.js): { n, boss } — el rival es un «trainer» sintético
    // Afecto (affection.js): true = solo el lado del jugador (CPU); 'both' = los dos lados (PvP). Se guarda en la instantánea (aff 1 / 2).
    this.affection = affection === 'both' ? 'both' : (!!affection && mode !== 'pvp');
    this.sides = sides.map((s, i) => ({
      n: i, id: 'p' + (i + 1), userId: s.user ? s.user.id : null, name: s.name, sets: s.sets, roster: s.roster,
      tera: !!(tera && s.user && require('./tera').hasOrb(s.user)), brain: s.brain || null, req: null, chosen: false, deadline: 0, timer: null, timeouts: 0, log: [], seen: new Set(), human: !!s.user, askedAt: Date.now(),
    }));
    this.pickN = this.full ? this.sides[0].sets.length : Math.min(FORMATS[format].cap, ...this.sides.map((s) => s.sets.length));
    this.pickFoe = this.full ? this.sides[1].sets.length : undefined;
    this.turn = 0;
    this.startedAt = Date.now();
    this.over = false;
    this.winner = undefined;
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });
  }

  // `replay`: reconstruye un combate guardado. Se vuelven a escribir todas las entradas y se ignora lo que el simulador
  // responde (ni la IA ni los temporizadores actúan sobre peticiones antiguas) hasta que todo se ha asentado.
  start(replay = null) {
    const { BattleStream, getPlayerStreams } = sd.ps();
    const bs = (this.bs = new BattleStream());
    const streams = (this.streams = getPlayerStreams(bs));
    const maxLen = Math.max(...this.sides.map((s) => s.sets.length));
    const rules = ['Species Clause'];
    if (!this.tera) rules.push('Terastal Clause'); // sin la cláusula, el simulador deja teracristalizar (la CPU nunca lo hace y a quien no tiene Orbe se lo quitamos de la petición)
    if (!this.full && this.pickN < maxLen) rules.push(`Picked Team Size = ${this.pickN}`);
    if (this.affection) rules.push(this.affection === 'both' ? 'AffectionBoth' : 'Affection');
    const fid = `${FORMATS[this.format].id}@@@${rules.join(',')}`;
    const cmds = [`>start ${JSON.stringify({ formatid: fid, seed: this.seed })}`];
    for (const s of this.sides) {
      cmds.push(`>player ${s.id} ${JSON.stringify({ name: s.name, team: sd.pack(s.sets) })}`);
      // Carrera del Alto Mando: tras sentar al jugador y ANTES de que entre el rival (así la vista previa ya muestra los PS buenos) se fijan PS, PP y estado.
      if (this.elite && s.n === 0 && this.elite.carry && this.elite.carry.some(Boolean)) cmds.push(carryCmd(this.elite.carry));
    }
    this.setupLen = cmds.length;
    if (replay) { this.replaying = true; this.inputLog = []; }
    for (const s of this.sides) {
      if (s.brain) s.brain.pickN = this.pickN;
      (async () => {
        try { for await (const chunk of streams[s.id]) this.onChunk(s, chunk); } catch (e) { this.crash(e); }
      })();
    }
    if (replay) {
      for (const c of [...cmds, ...replay]) { this.inputLog.push(c); streams.omniscient.write(c); }
      return this;
    }
    this.inputLog.push(...cmds);
    streams.omniscient.write(cmds.join('\n'));
    this.persist();
    return this;
  }

  // Espera a que el simulador termine de responder a lo reescrito (sin trozos nuevos durante unos instantes).
  async settle() {
    let last = -1, calm = 0;
    for (let i = 0; i < 400 && calm < 4; i++) {
      await new Promise((r) => setTimeout(r, 5));
      if (this.chunks === last) calm++; else { calm = 0; last = this.chunks; }
    }
  }

  snapshot() {
    return {
      id: this.id, v: SIM_VERSION, mode: this.mode, format: this.format, level: this.level, wager: this.wager, trainer: this.trainer ? this.trainer.id : null, rk: this.ranked ? 1 : 0, tn: this.tn || undefined, tw: this.tower ? { n: this.tower.n, boss: !!this.tower.boss, tr: { id: this.trainer.id, name: this.trainer.name, cls: this.trainer.cls, quote: this.trainer.quote } } : null, aff: this.affection === 'both' ? 2 : this.affection ? 1 : 0, tr: this.tera ? 1 : 0, full: this.full ? 1 : 0, el: this.elite ? { stage: this.elite.stage, carry: this.elite.carry, bonus: this.elite.bonus || 0 } : undefined,
      seed: this.seed, createdAt: this.createdAt, savedAt: Date.now(), input: this.inputLog.slice(this.setupLen || 1 + this.sides.length), turn: this.turn,
      sides: this.sides.map((s) => ({ userId: s.userId, name: s.name, sets: s.sets, roster: s.roster, human: s.human, chosen: s.chosen, timeouts: s.timeouts, askedAt: s.askedAt })),
    };
  }
  persist() {
    if (this.mode === 'sim' || this.finished || this.noPersist) return;
    (db.data.sdBattles ||= {})[this.id] = this.snapshot();
    db.save();
  }
  unpersist() {
    if (this.noPersist) return;
    if (db.data.sdBattles && db.data.sdBattles[this.id]) { delete db.data.sdBattles[this.id]; db.save(); }
  }

  // Abandono: un humano con petición pendiente sin elegir durante 15 min pierde (PvP: el rival se lleva el bote).
  expire(now = Date.now()) {
    if (this.over || this.replaying) return false;
    for (const s of this.humans()) {
      if (s.req && !s.req.wait && !s.chosen && now - s.askedAt > ABANDON_MS) { this.forfeit(s, 'por abandono'); return true; }
    }
    return false;
  }

  humans() { return this.sides.filter((s) => s.human); }
  emitTo(side, ev, payload) { if (side.userId) hub.emitUser(side.userId, ev, payload); }

  // Pokédex «vista» (dexreg.js): todo Pokémon que sale al campo en un combate real (CPU, líderes, Alto Mando, Torre, PvP, torneos) queda registrado como visto.
  noteSeenSpecies(side, line) {
    const m = /^\|(?:switch|drag|replace)\|p[12][ab]: [^|]*\|([^|]+)\|/.exec(line);
    if (!m) return;
    try {
      const sp = sd.speciesNumByName(m[1]);
      const u = sp && db.userById(side.userId);
      if (u) require('./dexreg').markSeen(u, sp.num);
    } catch { /* nunca debe romper un combate */ }
  }

  onChunk(side, chunk) {
    if (this.over && this.finished) return;
    this.chunks = (this.chunks || 0) + 1;
    const out = [];
    const errs = [];
    let req = null;
    for (const line of String(chunk).split('\n')) {
      if (line.startsWith('|request|')) { try { req = JSON.parse(line.slice(9)); } catch { /* petición ilegible */ } continue; }
      if (line.startsWith('|error|')) { errs.push(line); continue; }
      if (line === '' || line.startsWith('|debug|') || line.startsWith('||') || line.startsWith('|html|')) continue; // (eco de >eval y >editbattle: no es para el jugador)
      out.push(line);
    }
    if (req && req.active && !side.tera) for (const a of req.active) if (a) delete a.canTerastallize; // sin Orbe (o en un modo sin Tera) no hay botón
    for (const line of out) {
      const m = /^\|(?:switch|drag)\|p[12][ab]: ([^|]*)\|/.exec(line);
      if (m) side.seen.add(m[1]);
      if (side.userId && !this.replaying && this.mode !== 'sim') this.noteSeenSpecies(side, line);
      if (side.n === 0 && line.startsWith('|turn|')) this.turn = Number(line.slice(6)) || this.turn;
      if (line.startsWith('|win|')) this.queueEnd(line.slice(5));
      else if (line === '|tie') this.queueEnd(null);
    }
    if (out.length) { side.log.push(...out); if (side.log.length > 3000) side.log.splice(0, side.log.length - 3000); }
    if (side.brain && out.length) side.brain.feed(out);
    if (this.replaying) {
      if (req) { side.req = req; side.chosen = !!req.wait; }
      return;
    }
    if (req) {
      side.req = req;
      side.chosen = !!req.wait;
      side.errs = 0;
      side.askedAt = Date.now();
      if (!req.wait && side.human) { side.deadline = Date.now() + TURN_MS; this.arm(side); } else if (side.timer) { clearTimeout(side.timer); side.timer = null; }
    }
    if (req) this.persist();
    if (errs.length && side.human) {
      side.chosen = false;
      if (side.req && !side.req.wait) this.arm(side);
      this.persist();
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
    try {
      this.inputLog.push(side.id === 'omniscient' ? choice : `>${side.id} ${choice}`);
      this.streams[side.id].write(choice);
      this.persist();
    } catch (e) { this.crash(e); }
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
    if (/terastallize/.test(choice) && !side.tera) throw new Error(this.tera ? 'Necesitas el Orbe Teracristal (se consigue con la primera medalla).' : 'En este combate no se puede teracristalizar.');
    if (!side.req) throw new Error('Todavía no hay nada que elegir.');
    if (side.req.wait) throw new Error('Espera: ahora le toca elegir al rival.');
    if (side.chosen) throw new Error('Ya has elegido. Espera al rival.');
    side.timeouts = 0;
    side.chosen = true;
    if (side.timer) { clearTimeout(side.timer); side.timer = null; }
    this.write(side, choice);
  }

  // Cancelar la elección mientras el rival no haya elegido (como el «Cancelar» de Showdown). Si el turno ya se ha
  // resuelto, el simulador no hace nada y llega la petición del turno siguiente.
  undo(side) {
    if (this.over) throw new Error('El combate ya ha terminado.');
    if (!side.chosen || !side.req || side.req.wait) throw new Error('No hay ninguna elección que cancelar.');
    const req = side.req;
    side.chosen = false;
    this.write(side, 'undo');
    if (side.req === req && !this.over) {
      if (side.human && side.deadline) this.arm(side);
      this.persist();
    }
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

  // PS, PP y estado con los que han acabado los Pokémon del jugador (solo la carrera del Alto Mando los usa), por ejemplar.
  captureCarry() {
    try {
      const bat = this.bs && this.bs.battle;
      if (!bat) return null;
      const byName = new Map(this.sides[0].roster.map((r) => [r.name, r.uid]));
      const out = {};
      for (const p of bat.sides[0].pokemon) {
        const uid = byName.get(p.name);
        if (!uid) continue;
        out[uid] = { hp: Math.max(0, p.hp), max: p.maxhp, s: p.hp > 0 ? p.status || '' : '', pp: Object.fromEntries(p.baseMoveSlots.map((m) => [m.id, m.pp])) };
      }
      return out;
    } catch (e) { console.error('Alto Mando: no se pudo leer el estado final', e); return null; }
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
    if (this.elite) this.carryOut = this.captureCarry();
    let result;
    try { result = settle(this); } catch (e) { console.error('Combate: error al liquidar', e); result = { error: true }; }
    this.unpersist();
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
    if (this.tower) for (const s of this.humans()) require('./tower').onAbort(s.userId, this.id);
    if (this.tn) { try { require('./tourney').onAbort(this.tn); } catch (e) { console.error(e); } }
    this.unpersist();
    this.teardown();
    this.resolveDone({ winner: null, turns: this.turn, aborted: true });
  }

  view(side) {
    return {
      id: this.id, mode: this.mode, format: this.format, level: this.level, wager: this.wager, side: side.id, tera: side.tera || undefined, pickN: this.pickN, pickFoe: this.pickFoe, ranked: this.ranked || undefined, tn: this.tn ? this.tn.id : undefined, elite: this.elite ? { stage: this.elite.stage } : undefined, gym: this.trainer && this.trainer.badge ? this.trainer.badge : undefined,
      tower: this.tower ? { n: this.tower.n, round: Math.floor((this.tower.n - 1) / 7) + 1, boss: !!this.tower.boss } : undefined,
      ranks: this.mode === 'pvp' ? this.sides.map((s) => require('./league').emblem(db.userById(s.userId), this.ranked ? this.format : undefined)) : undefined,
      you: side.name, foe: this.sides[1 - side.n].name, trainer: this.trainer ? { id: this.trainer.id, name: this.trainer.name, cls: this.trainer.cls } : null,
      roster: this.mode === 'pvp' ? rosterFor(side.n, this.sides[0].roster, this.sides[1].roster) : { p1: this.sides[0].roster, p2: this.sides[1].roster },
      log: side.log, request: side.req || null, chosen: side.chosen, deadline: side.chosen || !side.req || side.req.wait ? 0 : side.deadline, turnMs: TURN_MS, over: this.over,
    };
  }
}

// En PvP el rival no revela su teratipo ni su megaevolución (solo se ven al usarlos, en el registro) ni los uid de sus ejemplares.
const hideFoe = (roster) => roster.map(({ tera, mega, uid, ...pub }) => pub);
const rosterFor = (n, r1, r2) => ({ p1: n === 0 ? r1 : hideFoe(r1), p2: n === 1 ? r2 : hideFoe(r2) });

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
  if (!u.btDay || u.btDay.day !== k) u.btDay = { day: k, wins: 0, coins: 0, pick: 0 };
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
  const out = { coins: 0, exp: [], candies: {}, evolve: [], pokerus: [], friend: 0, capped: false, winsLeft: 0, mats: {}, tm: null, bp: 0, ev: 0, prize: null, pickup: [] };
  if (d.wins >= trainers.WINS_PER_DAY) { out.capped = true; return out; }
  d.wins++;
  out.winsLeft = trainers.WINS_PER_DAY - d.wins;
  let amulet = false; // algún participante lleva la Moneda Amuleto
  const bond = require('./bond');
  const specimen = require('./specimen');
  const expMod = require('./exp');
  const foeStats = b.sides[1].roster.map((r) => (BY_ID.get(r.id) || { stats: [0, 0, 0, 0, 0, 0] }).stats);
  const part = participants(b, side);
  const members = [];
  for (const r of part) {
    try {
      const sp = specimen.find(user, { id: r.id, uid: r.uid });
      expMod.ensure(Number(r.id), sp);
      // EXP (fórmula escalada de 5.ª gen.): cada rival derrotado reparte su EXP entre los participantes; ×1,5 por ser entrenador.
      let gain = 0;
      for (const f of b.sides[1].roster) gain += expMod.foeExp(f.id, f.level, sp.level, part.length, true);
      const from = sp.level;
      const xr = expMod.award(user, r.id, sp, gain, 'battle'); // tope diario por ejemplar y Huevo Suerte
      out.exp.push({ id: r.id, uid: r.uid, shiny: !!sp.shiny, name: sp.nick || (BY_ID.get(r.id) || {}).name, from, to: sp.level, exp: xr.exp, learned: xr.learned, pending: xr.pending });
      if (xr.evo.length) out.evolve.push({ id: r.id, uid: r.uid, shiny: !!sp.shiny, name: sp.nick || (BY_ID.get(r.id) || {}).name, to: xr.evo });
      out.friend += bond.addFriend(sp, 2, 'battle');
      out.ev += require('./evs').onWin(sp, foeStats); // EVs: +4 por rival derrotado en su estadística base más alta (tope diario por ejemplar; ×2 con Pokérus)
      members.push({ id: r.id, m: sp });
      if (battleMoney.holdsAmulet(sp)) amulet = true;
    } catch { /* el ejemplar ya no está */ }
  }
  out.pokerus = require('./pokerus').roll(user, members); // Pokérus: muy raro; se contagia dentro del equipo
  // Premio en metálico (clase × nivel más alto del rival), Día de Pago y Moneda Amuleto, con el tope diario de siempre (trainers.COINS_DAY).
  const pz = battleMoney.prizeMoney(trainers.BY_TRAINER.get(t.id) || t, b.sides[1].roster.map((r) => r.level));
  const pd = battleMoney.payDay(side.log, side.roster);
  const gross = (pz.coins + pd.coins) * (amulet ? 2 : 1);
  const room = Math.max(0, trainers.COINS_DAY - (d.coins || 0));
  out.coins = Math.min(gross, room);
  d.coins = (d.coins || 0) + out.coins;
  out.prize = { pay: pz.pay, level: pz.level, base: pz.coins, payday: pd.coins, paydayUses: pd.uses, amulet, gross, capped: out.coins < gross, left: room - out.coins };
  if (out.coins) {
    user.coins += out.coins;
    hub.ledger(user, out.coins, 'battle', `Combate contra ${t.cls} ${t.name}`);
  }
  // Recogida: cada Pokémon del equipo con la habilidad, un 10 % de encontrar algo (tope diario de 5 hallazgos).
  const pickers = [];
  for (const r of side.roster) {
    try {
      const sp = specimen.find(user, { id: r.id, uid: r.uid });
      if (sd.toID(sp.sdAbility) === 'pickup') pickers.push({ name: sp.nick || (BY_ID.get(r.id) || {}).name || r.name, level: r.level });
    } catch { /* el ejemplar ya no está */ }
  }
  out.pickup = battleMoney.rollPickup(user, pickers, d);
  const drop = expMod.battleDrop(d, t.tier, require('./rng').rand);
  if (drop) { require('./candy').giveExp(user, drop, 1); out.candies[drop] = 1; }
  hub.addXp(user, 15, { flat: true });
  hub.track(user, 'battle_win');
  // Materiales de MT de los tipos de los rivales derrotados y, contra líderes y campeón, a veces una MT.
  const loot = require('./tm').battleLoot(user, t, b.sides[1].roster.map((r) => r.id));
  out.mats = loot.mats; out.tm = loot.tm;
  out.bp = require('./bp').cpuWin(user, t.tier); // Puntos de Batalla (tope diario en bp.js)
  return out;
}

// El torneo se entera SIEMPRE de cómo acabó el combate, aunque falle algo al liquidarlo (p. ej. el feed): si no, el cuadro se quedaría atascado.
function settle(b) {
  try { return settleCore(b); } finally {
    if (b.tn && b.mode !== 'cpu' && b.mode !== 'sim') { try { require('./tourney').onBattleEnd(b); } catch (e) { console.error('Torneo: error al cerrar el combate', e); } }
  }
}
function settleCore(b) {
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
    let tw = null;
    let badge = null;
    let elite = null;
    if (user) {
      if (b.tower) tw = require('./tower').onEnd(user, b, won); // Torre Batalla: sin monedas ni caramelos, solo PB con tope propio
      else {
        if (won) {
          reward = cpuReward(b, user, side);
          if (b.trainer.badge) badge = require('./progress').awardBadge(user, b.trainer.badge); // vencer al líder da la medalla (la primera vez) aunque hoy ya no queden premios
        }
        if (b.elite) elite = require('./elite').onEnd(user, b, b.winner === 0);
      }
      pushHist(user, { id: b.id, at: res.at, mode: 'cpu', format: b.format, level: b.level, foe: `${b.tower ? '🗼 ' : ''}${b.trainer.cls} ${b.trainer.name}`, won, tie: b.winner === null, turns: b.turn, coins: reward ? reward.coins : 0, tower: b.tower ? b.tower.n : undefined });
      if (!b.tower) hub.track(user, 'battle_play');
      db.save();
      hub.pushMe(user);
    }
    hub.emitUser(side.userId, 'battle:end', { id: b.id, winner: b.winner === null ? 'tie' : won ? 'you' : 'foe', reward, badge: badge || undefined, elite: elite || undefined, tower: tw || undefined, trainer: { id: b.trainer.id, name: b.trainer.name, cls: b.trainer.cls, quote: b.trainer.quote } });
    return res;
  }
  // PvP
  const players = b.sides.map((s) => db.userById(s.userId));
  b.sides.forEach((s, i) => db.escrowDel(escKey(b, i)));
  let prize = 0;
  const bpGain = [0, 0];
  const tie = b.winner === null || b.winner === undefined;
  // Rendición o abandono antes de PVP_MIN_TURNS turnos con apuesta: no se paga a nadie (sería un canal de monedas entre cuentas); se devuelven las apuestas enteras, sin comisión.
  const voided = !tie && !!b.wager && !!b.forfeited && b.turn < require('./bpdata').PVP_MIN_TURNS;
  // Clasificatoria: puntuación Elo (solo si cumple las reglas anti-abuso de league.js).
  const lg = b.ranked ? require('./league').record(players, b.format, tie ? null : b.winner, b.turn, !!b.forfeited) : null;
  if (lg && lg.rated && queueHook) queueHook(); // refresca la lista de conectados (los emblemas de rango)
  if (tie) {
    players.forEach((u) => refundOne(u, b.wager));
  } else {
    const winner = players[b.winner];
    const loser = players[1 - b.winner];
    if (voided) players.forEach((u) => refundOne(u, b.wager));
    else if (b.wager && winner) {
      prize = Math.floor(b.wager * 2 * (1 - (require('./events').has('duels') ? 0 : RAKE)));
      hub.pay(winner, prize, b.wager, 'duel', { noBonus: true });
      if (loser) require('./transfer').notePair(winner, loser, b.wager); // tope diario de ganancia neta entre dos cuentas
    }
    // Puntos de Batalla: 3 al ganar y 1 al perder (con tope diario, mínimo de turnos y límite por rival).
    if (winner && loser) { bpGain[b.winner] = require('./bp').pvp(winner, true, loser.id, b.turn); bpGain[1 - b.winner] = require('./bp').pvp(loser, false, winner.id, b.turn); }
    if (winner) { winner.stats.duelsWon++; hub.track(winner, 'duel_win'); hub.addXp(winner, 50, { flat: true }); }
    if (loser) { loser.stats.duelsLost++; hub.addXp(loser, 20, { flat: true }); }
    const bond = require('./bond');
    const specimen = require('./specimen');
    if (winner) for (const r of participants(b, b.sides[b.winner])) { try { bond.addFriend(specimen.find(winner, { id: r.id, uid: r.uid }), 2, 'battle'); } catch { /* ya no está */ } }
  }
  if (b.wager && !voided) for (const u of players) if (u) hub.addXp(u, b.wager * require('./balance').xpRate('duel'));
  for (const u of players) if (u) { hub.track(u, 'duel_play'); hub.track(u, 'play', { game: 'duel' }); }
  res.prize = prize;
  players.forEach((u, i) => {
    if (!u) return;
    pushHist(u, { id: b.id, at: res.at, mode: 'pvp', format: b.format, level: b.level, foe: b.sides[1 - i].name, won: !tie && b.winner === i, tie, turns: b.turn, wager: b.wager, ranked: b.ranked || undefined, dr: lg && lg.rated ? lg.side[i].delta : undefined, coins: voided || tie ? 0 : b.winner === i ? prize - b.wager : -b.wager, void: voided || undefined });
    hub.pushMe(u);
  });
  db.save();
  b.sides.forEach((s, i) => hub.emitUser(s.userId, 'battle:end', { id: b.id, winner: tie ? 'tie' : b.winner === i ? 'you' : 'foe', prize: b.winner === i ? prize : 0, bp: bpGain[i], wager: b.wager, refunded: voided || undefined, forfeited: b.forfeited ? b.forfeited.side === i : false, league: lg ? (lg.rated ? { rated: true, ...lg.side[i] } : { rated: false, why: lg.why }) : undefined }));
  if (!tie) {
    const w = players[b.winner]; const l = players[1 - b.winner];
    if (w && l) hub.feed('duel', `⚔️ ${w.username} venció a ${l.username} en un combate ${b.ranked ? 'clasificatorio ' : ''}${b.tn ? 'de torneo ' : ''}${FORMATS[b.format].label.toLowerCase()}${b.wager && !voided ? ` y ganó ${prize.toLocaleString('es')} monedas` : ''}`);
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
  for (const s of b.sides) if (s.userId) { byUser.set(s.userId, b); queue.delete(s.userId); }
  pushQueue();
  b.start();
  for (const s of b.humans()) hub.emitUser(s.userId, 'battle:start', { battle: b.view(s) });
  return b;
}

const smartFor = (t) => !!t && t.tier >= 5; // líderes y Alto Mando: IA más fina (sdai.js)

function startCpu(user, { trainer: trainerId, format, level = 'fair', team }) {
  checkFree(user);
  checkCapacity();
  const t = trainers.BY_TRAINER.get(String(trainerId));
  if (!t) throw new Error('Ese entrenador no existe.');
  if (!trainers.soloOk(t)) throw new Error(`${t.name} solo se enfrenta en el Alto Mando, seguido de los demás.`);
  if (!trainers.unlocked(t, user)) throw new Error(`${trainers.lockText(t)} Para retar a ${t.name}.`);
  if (trainers.fixed(t)) { format = 'singles'; level = 'real'; } // líderes y Alto Mando: Individual y niveles reales, como en los juegos
  const mine = resolveTeam(user, team, { format, level });
  const avg = mine.roster.reduce((s, r) => s + r.level, 0) / mine.roster.length;
  const foe = trainers.buildTeam(t, Math.min(FORMATS[format].cap, mine.sets.length), { level, avgLevel: avg, doubles: FORMATS[format].doubles });
  const doubles = FORMATS[format].doubles;
  require('./tera').ensureOrb(user);
  const b = new Battle({
    mode: 'cpu', format, level, trainer: t, affection: true, full: trainers.fixed(t), tera: require('./tera').modeAllows({ mode: 'cpu', fixed: trainers.fixed(t) }),
    sides: [
      { user, name: user.username, sets: mine.sets, roster: mine.roster },
      { name: `${t.cls} ${t.name}`, sets: foe.sets, roster: foe.roster, brain: new Brain('p2', { doubles, smart: smartFor(t) }) },
    ],
  });
  register(b);
  return { battle: b.view(b.sides[0]) };
}

// Alto Mando (elite.js decide quién y cuándo): equipo de nivel fijo (+`bonus` en las revanchas), Individual, niveles reales; los PS/PP/estados del jugador vienen de `carry`.
function startEliteBattle(user, { trainer: t, mine, carry, stage, bonus = 0 }) {
  checkFree(user);
  checkCapacity();
  const foe = trainers.buildTeam(t, 6, { bonus });
  const b = new Battle({
    mode: 'cpu', format: 'singles', level: 'real', trainer: t, affection: true, full: true, elite: { stage, carry, bonus },
    sides: [
      { user, name: user.username, sets: mine.sets, roster: mine.roster },
      { name: `${t.cls} ${t.name}`.slice(0, 18), sets: foe.sets, roster: foe.roster, brain: new Brain('p2', { doubles: false, smart: true }) },
    ],
  });
  register(b);
  return b;
}

// Torre Batalla: combate contra la CPU con equipos de alquiler (tower.js decide quién y cuándo; aquí solo se arranca).
function startTowerBattle(user, { format, n, boss, foe, mine }) {
  checkFree(user);
  checkCapacity();
  const doubles = FORMATS[format].doubles;
  const b = new Battle({
    mode: 'cpu', format, level: 'fair', trainer: { id: 'torre', name: foe.name, cls: foe.cls, quote: foe.quote }, tower: { n, boss }, affection: false,
    sides: [
      { user, name: user.username, sets: mine.sets, roster: mine.roster },
      { name: `${foe.cls} ${foe.name}`.slice(0, 18), sets: foe.sets, roster: foe.roster, brain: new Brain('p2', { doubles }) },
    ],
  });
  register(b);
  return b;
}

// ---- PvP ----
function listPublic() {
  return [...challenges.values()].filter((c) => !c.ranked).map((c) => ({ id: c.id, creator: c.creator, format: c.format, level: c.level, wager: c.wager, target: c.target, size: c.members.length, bond: c.bond, tera: c.tera, createdAt: c.createdAt }));
}
const pushList = () => hub.broadcast('battle:list', listPublic());

// Efectos de amistad en PvP: opción del reto (por defecto activada). Debe ser un booleano.
function bondFlag(v) {
  if (v === undefined || v === null) return true;
  if (typeof v !== 'boolean') throw new Error('Opción de amistad no válida.');
  return v;
}
function challenge(user, { format, level = 'fair', wager, target, team, bond, tera }, quiet = false, ranked = false) {
  checkFree(user);
  bond = bondFlag(bond);
  tera = ranked === true ? false : bondFlag(tera); // Teracristalización (por defecto sí; la Clasificatoria nunca)
  if ([...challenges.values()].filter((c) => c.creatorId === user.id).length >= 2) throw new Error('Máximo 2 retos abiertos.');
  resolveTeam(user, team, { format, level, itemClause: true }); // valida
  wager = Number(wager) || 0;
  const tr = require('./transfer');
  if (wager !== 0) tr.canBet(user); // cuentas nuevas o ayudadas por Joy: solo amistosos
  if (target) {
    const t = db.userByName(String(target));
    if (!t || t.npc || t.id === user.id) throw new Error('Rival no encontrado.');
    target = t.username;
    if (wager !== 0) tr.pairCheck(user, t, wager);
  } else target = null;
  if (wager !== 0) hub.takeBet(user, wager, 'duel', { quiet: true, noXp: true });
  const c = { id: crypto.randomUUID().slice(0, 8), creatorId: user.id, creator: user.username, format, level, wager, target, members: team.map((m) => ({ id: Number(m.id), uid: String(m.uid), mega: Number(m.mega) || 0 })), bond, tera, ranked: ranked === true, createdAt: Date.now() };
  challenges.set(c.id, c);
  db.escrowSet('btlc:' + c.id, user.id, wager);
  pushList();
  if (!quiet) {
    const what = `un combate ${FORMATS[format].label.toLowerCase()}${wager ? ` por ${wager} monedas` : ''}`;
    if (c.target) hub.emitUser(db.userByName(c.target).id, 'battle:ping', { kind: 'direct', from: user.username, text: `⚔️ ${user.username} te reta a ${what}` });
    else hub.broadcast('battle:ping', { kind: 'open', from: user.username, text: `⚔️ ${user.username} ha abierto un reto: ${what}` });
  }
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
  require('./tera').ensureOrb(user); require('./tera').ensureOrb(creator);
  const mine = resolveTeam(user, team, { format: c.format, level: c.level, itemClause: true });
  let theirs;
  try { theirs = resolveTeam(creator, c.members, { format: c.format, level: c.level, itemClause: true }); } catch (e) {
    dropChallenge(c); pushList();
    throw new Error('El equipo del retador ya no es válido; el reto se ha cancelado.');
  }
  if (c.wager) {
    const tr = require('./transfer');
    tr.canBet(user); tr.canBet(creator); tr.pairCheck(creator, user, c.wager);
    hub.takeBet(user, c.wager, 'duel', { quiet: true, noXp: true });
  }
  challenges.delete(c.id);
  db.escrowDel('btlc:' + c.id);
  const b = new Battle({
    mode: 'pvp', format: c.format, level: c.level, wager: c.wager, affection: c.ranked || c.bond === false ? false : 'both', ranked: !!c.ranked,
    tera: !c.ranked && c.tera !== false && require('./tera').hasOrb(creator) && require('./tera').hasOrb(user), // hace falta que AMBOS tengan el Orbe
    sides: [{ user: creator, name: creator.username, sets: theirs.sets, roster: theirs.roster }, { user, name: user.username, sets: mine.sets, roster: mine.roster }],
  });
  if (c.wager) { db.escrowSet(escKey(b, 0), creator.id, c.wager); db.escrowSet(escKey(b, 1), user.id, c.wager); }
  register(b);
  pushList();
  return { battle: b.view(b.sides[1]) };
}

// Combate de un torneo (tourney.js): sin apuesta, mismas reglas que un reto PvP. Los errores llevan `side` (0/1) y `team`/`busy` para que el torneo sepa a quién pedírselo.
function startTourney(ua, ub, { format, level, bond, tera, teamA, teamB, tn }) {
  const us = [ua, ub];
  us.forEach((u, i) => { if (byUser.has(u.id)) throw Object.assign(new Error('Ya estás en un combate.'), { side: i, busy: true }); });
  checkCapacity();
  const to = require('./tera');
  to.ensureOrb(ua); to.ensureOrb(ub);
  const res = [teamA, teamB].map((team, i) => { try { return resolveTeam(us[i], team, { format, level, itemClause: true }); } catch (e) { throw Object.assign(e, { side: i, team: true }); } });
  const b = new Battle({
    mode: 'pvp', format, level, wager: 0, affection: bond === false ? false : 'both', ranked: false, tn,
    tera: tera !== false && to.hasOrb(ua) && to.hasOrb(ub),
    sides: us.map((u, i) => ({ user: u, name: u.username, sets: res[i].sets, roster: res[i].roster })),
  });
  register(b);
  pushList();
  return b;
}

// ---- «Buscar rival»: cola de emparejamiento (mismo formato, nivel y banda de apuesta) ----
const QUEUE_MS = 2 * 60 * 1000;
const BANDS = Object.assign(Object.create(null), { none: 0, small: 50, medium: 200 });
function queueCounts() {
  const c = { singles: 0, doubles: 0 };
  for (const e of queue.values()) c[e.format]++;
  return c;
}
const queueInfo = () => ({ ...queueCounts(), challenges: challenges.size });
function pushQueue() { hub.broadcast('battle:queue', queueInfo()); if (queueHook) queueHook(); }
let queueHook = null;
const setQueueHook = (fn) => { queueHook = fn; };
const isQueued = (userId) => queue.has(userId);
function queueMine(user) { const e = queue.get(user.id); return e ? { ranked: !!e.ranked, format: e.format, level: e.level, band: e.band, wager: e.wager, bond: e.bond, tera: e.tera, left: Math.max(0, e.at + QUEUE_MS - Date.now()) } : null; }

function enqueue(user, { format, level = 'fair', band = 'none', team, bond, tera, ranked }) {
  checkFree(user);
  const lg = require('./league');
  ranked = ranked === true;
  // Clasificatoria: nivel 50 justo, sin apuesta y sin efectos de amistad (igualdad de condiciones); cuentas con antigüedad.
  if (ranked) { lg.canRank(user); level = 'fair'; band = 'none'; bond = false; tera = false; } else { bond = bondFlag(bond); tera = bondFlag(tera); }
  if (typeof band !== 'string' || !Object.hasOwn(BANDS, band)) throw new Error('Apuesta no válida.');
  const wager = BANDS[band];
  if (wager) require('./transfer').canBet(user);
  resolveTeam(user, team, { format, level, itemClause: true }); // valida
  if (wager && user.coins < wager) throw new Error('No tienes monedas suficientes para esa apuesta.');
  queue.delete(user.id);
  const me = { userId: user.id, format, level, band, wager, bond, tera, ranked, team: team.map((m) => ({ id: Number(m.id), uid: String(m.uid), mega: Number(m.mega) || 0 })), at: Date.now() };
  let rivals = [...queue.values()].filter((e) => !!e.ranked === ranked && e.format === format && e.level === level && e.band === band && e.bond === bond && e.tera === tera && e.userId !== user.id).sort((a, b) => a.at - b.at);
  if (ranked) {
    // Parejas de nivel parecido (la ventana se abre con la espera) y con cupo diario libre entre ambos.
    const mine = lg.rating(user, format);
    const near = (e) => { const o = db.userById(e.userId); return !!o && lg.ok(o) && Math.abs(lg.rating(o, format) - mine) <= 300 + 150 * Math.floor((Date.now() - e.at) / 30000) && lg.vsToday(user, o.id) < lg.MAX_VS_DAY && lg.vsToday(o, user.id) < lg.MAX_VS_DAY; };
    rivals = rivals.filter(near).sort((a, b) => Math.abs(lg.rating(db.userById(a.userId), format) - mine) - Math.abs(lg.rating(db.userById(b.userId), format) - mine));
  }
  for (const o of rivals) {
    const other = db.userById(o.userId);
    if (!other || byUser.has(o.userId)) { queue.delete(o.userId); continue; }
    let c;
    try { c = challenge(other, { format, level, wager, target: user.username, team: o.team, bond, tera }, true, ranked); } catch (e) {
      queue.delete(o.userId);
      hub.emitUser(o.userId, 'battle:queue:end', { reason: 'error', text: 'Te hemos sacado de la cola: ' + e.message });
      continue;
    }
    let acc;
    try { acc = accept(user, { id: c.challenge, team: me.team }); } catch (e) {
      const ch = challenges.get(c.challenge);
      if (ch) dropChallenge(ch);
      pushList();
      throw e;
    }
    queue.delete(o.userId);
    pushQueue();
    hub.emitUser(o.userId, 'battle:ping', { kind: 'match', from: user.username, text: `${ranked ? '🏆' : '🔎'} ¡Rival encontrado! Te toca contra ${user.username}` });
    hub.emitUser(user.id, 'battle:ping', { kind: 'match', from: other.username, text: `${ranked ? '🏆' : '🔎'} ¡Rival encontrado! Te toca contra ${other.username}` });
    return { matched: true, battle: acc.battle };
  }
  queue.set(user.id, me);
  pushQueue();
  return { matched: false, queue: queueMine(user) };
}
function unqueue(user) {
  if (queue.delete(user.id)) pushQueue();
  return {};
}
function unqueueUser(userId) { if (queue.delete(userId)) pushQueue(); }

setInterval(() => {
  const now = Date.now();
  let gone = false;
  for (const e of [...queue.values()]) if (now - e.at > QUEUE_MS) { queue.delete(e.userId); gone = true; hub.emitUser(e.userId, 'battle:queue:end', { reason: 'timeout', text: 'No ha aparecido ningún rival en 2 minutos.' }); }
  if (gone) pushQueue();
}, 5000).unref();

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const c of challenges.values()) if (now - c.createdAt > CHALLENGE_MS) { dropChallenge(c); changed = true; }
  if (changed) pushList();
  for (const b of battles.values()) { if (now - b.startedAt > MAX_AGE_MS && b.mode === 'sim') b.crash(new Error('Combate demasiado largo')); else b.expire(now); }
}, 30000).unref();

// Apagado (redespliegue): los retos abiertos se devuelven, pero los combates en curso se GUARDAN (inputLog + semilla) y
// se reconstruyen al arrancar. Sus depósitos siguen en `escrow` (ver db.refundEscrow).
function refundAll() {
  for (const c of [...challenges.values()]) dropChallenge(c);
  for (const b of [...battles.values()]) {
    if (b.mode === 'sim') { b.crash(new Error('Apagado del servidor')); continue; }
    for (const sd2 of b.sides) if (sd2.timer) { clearTimeout(sd2.timer); sd2.timer = null; }
    b.persist();
    b.noPersist = true; // nada más debe tocar lo guardado
  }
}

// ---- Restauración tras un reinicio ----
let restoring = false;
let restoreP = null;

function abortSnapshot(snap, why) {
  console.error(`Combate ${snap.id}: no se puede restaurar (${why}); se devuelven las apuestas.`);
  snap.sides.forEach((s, i) => {
    if (snap.mode === 'pvp') {
      // El depósito (escrow) manda: aunque el registro esté dañado, cada uno recupera lo que dejó.
      const key = `btl:${snap.id}:${i}`;
      const e = db.data.escrow[key];
      db.escrowDel(key);
      refundOne(db.userById(e ? e.userId : s.userId), e ? e.amount : snap.wager);
    }
    if (snap.tw && s.userId) require('./tower').onAbort(s.userId, snap.id);
    if (snap.tn && i === 0) { try { require('./tourney').onAbort(snap.tn); } catch (e) { console.error(e); } }
    // (la carrera del Alto Mando no se toca: sigue en el mismo combate y se puede reintentar)
    if (s.userId) hub.emitUser(s.userId, 'battle:end', { id: snap.id, aborted: true, text: 'Tu combate no se pudo recuperar tras la actualización del casino.' + (snap.wager ? ' Se te ha devuelto la apuesta.' : '') });
  });
  if (db.data.sdBattles) delete db.data.sdBattles[snap.id];
  db.save();
}

async function restoreOne(snap) {
  if (snap.v !== SIM_VERSION) throw new Error('versión del simulador distinta');
  if (!FORMATS[snap.format] || !Array.isArray(snap.input) || !Array.isArray(snap.seed) || !Array.isArray(snap.sides) || snap.sides.length !== 2) throw new Error('datos dañados');
  const doubles = FORMATS[snap.format].doubles;
  const trainer = snap.tw ? { ...snap.tw.tr } : snap.trainer ? trainers.BY_TRAINER.get(snap.trainer) : null;
  if (snap.mode === 'cpu' && !trainer) throw new Error('entrenador desconocido');
  const sides = snap.sides.map((s, i) => {
    const user = s.human ? db.userById(s.userId) : null;
    if (s.human && !user) throw new Error('jugador desaparecido');
    return { user, name: s.name, sets: s.sets, roster: s.roster, brain: s.human ? null : new Brain('p' + (i + 1), { doubles, smart: smartFor(trainer) }) };
  });
  const b = new Battle({ mode: snap.mode, format: snap.format, level: snap.level, wager: snap.wager || 0, trainer, affection: snap.aff === 2 ? 'both' : !!snap.aff, ranked: !!snap.rk, tower: snap.tw ? { n: snap.tw.n, boss: snap.tw.boss } : null, full: !!snap.full, tera: !!snap.tr, tn: snap.tn || null, elite: snap.el ? { stage: snap.el.stage, carry: snap.el.carry, bonus: snap.el.bonus || 0 } : null, id: snap.id, seed: snap.seed, createdAt: snap.createdAt, sides });
  b.startedAt = snap.createdAt;
  battles.set(b.id, b);
  for (const s of b.sides) if (s.userId) byUser.set(s.userId, b);
  try {
    b.start(snap.input);
    await b.settle();
    if (b.finished) return;
    b.replaying = false;
    if (!b.over && !b.sides.some((s) => s.req)) throw new Error('el simulador no respondió');
    b.sides.forEach((s, i) => {
      const o = snap.sides[i];
      s.timeouts = o.timeouts || 0;
      s.askedAt = Date.now(); // el tiempo que el casino estuvo caído no se castiga: la cuenta atrás de la petición empieza ahora
      if (o.chosen && s.req && !s.req.wait) s.chosen = true;
    });
    b.turn = Math.max(b.turn, snap.turn || 0);
  } catch (e) {
    battles.delete(b.id);
    for (const s of b.sides) if (s.userId && byUser.get(s.userId) === b) byUser.delete(s.userId);
    b.finished = true;
    try { b.streams.omniscient.writeEnd(); } catch { /* ya cerrado */ }
    throw e;
  }
  if (b.over) { b.finish(); return; }
  if (b.expire()) return;
  for (const s of b.sides) {
    if (!s.req || s.req.wait || s.chosen) continue;
    if (s.human) { s.deadline = Date.now() + TURN_MS + RESTORE_GRACE_MS; b.arm(s); } else {
      const choice = s.brain.decide(s.req) || 'default';
      b.write(s, choice);
    }
  }
  b.persist();
}

function restoreAll() {
  if (restoring) return restoreP;
  const snaps = Object.values(db.data.sdBattles || {}).filter((x) => !battles.has(x.id));
  if (!snaps.length) return Promise.resolve(0);
  restoring = true;
  restoreP = (async () => {
    let n = 0;
    try {
      for (const snap of snaps) {
        try { await restoreOne(snap); n++; } catch (e) { abortSnapshot(snap, e.message || String(e)); }
      }
    } finally { restoring = false; }
    if (n) console.log(`  ⚔️  ${n} combate(s) restaurado(s) tras el reinicio`);
    return n;
  })();
  return restoreP;
}
const afterRestore = (fn) => (u, p) => (restoring ? restoreP.then(() => fn(u, p)) : fn(u, p));

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
function undo(user, { id }) {
  const { b, side } = sideOf(user, id);
  b.undo(side);
  return { request: side.chosen ? null : side.req, deadline: side.deadline || 0 };
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
const activeFor = (user) => {
  const b = byUser.get(user.id);
  if (b) return b.id;
  const snap = Object.values(db.data.sdBattles || {}).find((x) => x.sides.some((s) => s.userId === user.id));
  return snap ? snap.id : null;
};

function historyOf(user) {
  const d = dayWins(user);
  return { history: user.btHist || [], wins: { n: d.wins, max: trainers.WINS_PER_DAY, coins: d.coins || 0, coinsMax: trainers.COINS_DAY } };
}
function replay(user, { id }) {
  const rec = history.find((h) => h.id === String(id) && h.users.includes(user.id));
  if (!rec) return { replay: null };
  const i = rec.users.indexOf(user.id);
  return { replay: { id: rec.id, mode: rec.mode, format: rec.format, players: rec.players, winner: rec.winner, side: 'p' + (i + 1), log: rec.log['p' + (i + 1)], roster: rec.mode === 'pvp' ? rosterFor(i, rec.roster.p1, rec.roster.p2) : rec.roster, pickN: rec.pickN } };
}

// ---- Equipos guardados y constructor ----
function sanitizeMembers(user, members) {
  if (!Array.isArray(members) || members.length < 1 || members.length > 6) throw new Error('Un equipo lleva de 1 a 6 Pokémon.');
  const specimen = require('./specimen');
  const mega = require('./mega');
  return members.map((m) => {
    const id = Number(m && m.id);
    const sp = specimen.find(user, { id, uid: m && m.uid });
    specimen.assertFree(sp, BY_ID.get(id).name);
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
      if (m.away) continue; // de expedición o en el criadero
      sd.ensureSd(id, m);
      const ex = require('./exp'); ex.ensure(id, m);
      out.push({ id, uid: m.uid, nick: m.nick, level: m.level, exp: m.exp, expLo: ex.expAt(id, m.level), expHi: m.level >= 100 ? m.exp : ex.expAt(id, m.level + 1), gender: m.gender, shiny: m.shiny, friendship: m.friendship, nature: m.nature, ability: m.sdAbility, item: m.item || null, moves: m.sdMoves, learned: m.learned.length, pending: m.pending.length, megas: forms, iv: (m.ivs || []).reduce((a, x) => a + x, 0) });
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
    learnset: m.learned.map((x) => sd.moveCard(x)).filter(Boolean),
    pending: m.pending,
  };
}
function setMoves(user, { id, uid, moves, ability }) {
  const specimen = require('./specimen');
  const m = specimen.find(user, { id, uid });
  id = Number(id);
  sd.ensureSd(id, m);
  const v = sd.validateSd(id, m, { moves, ability });
  Object.assign(m, v);
  db.save();
  return { ability: m.sdAbility, moves: m.sdMoves };
}

function state(user) {
  const d = dayWins(user);
  return { trainers: trainers.listFor(user), wins: { n: d.wins, max: trainers.WINS_PER_DAY, coins: d.coins || 0, coinsMax: trainers.COINS_DAY, pick: d.pick || 0, pickMax: battleMoney.PICKUP_DAY }, elite: require('./elite').view(user), teams: user.btTeams || [], challenges: listPublic(), queue: { mine: queueMine(user), ...queueInfo() }, active: activeFor(user), formats: Object.fromEntries(Object.entries(FORMATS).map(([k, f]) => [k, { label: f.label, min: f.min, cap: f.cap }])), max: MAX_BATTLES, running: battles.size, turnMs: TURN_MS };
}

// ---- Para pruebas: combate completo sin humanos (IA contra IA). ----
function runAiBattle({ format = 'singles', teamA, teamB, level = 'fair', timeoutMs = 60000, affection = false, seed = null } = {}) {
  const doubles = FORMATS[format].doubles;
  const mk = (t, name, side) => ({ name, sets: t.sets, roster: t.roster, brain: new Brain(side, { doubles }) });
  const b = new Battle({ mode: 'sim', format, level, seed, affection, sides: [mk(teamA, 'IA uno', 'p1'), mk(teamB, 'IA dos', 'p2')] });
  battles.set(b.id, b);
  b.start();
  const to = setTimeout(() => b.crash(new Error('Tiempo agotado en la prueba')), timeoutMs);
  return b.done.then((r) => { clearTimeout(to); return { ...r, log: b.sides[0].log }; });
}

// Solo para pruebas: olvida todo lo que hay en memoria (como un reinicio del proceso) sin tocar lo guardado.
function _dropMemory() {
  for (const b of battles.values()) {
    for (const sd2 of b.sides) if (sd2.timer) { clearTimeout(sd2.timer); sd2.timer = null; }
    b.finished = true;
    b.over = true;
    try { b.streams.omniscient.writeEnd(); } catch { /* ya cerrado */ }
  }
  battles.clear(); byUser.clear(); challenges.clear(); queue.clear();
}

module.exports = {
  undo: afterRestore(undo),
  MAX_BATTLES, TURN_MS, MAX_TIMEOUTS, RAKE, FORMATS, validChoice, resolveTeam, startCpu: afterRestore(startCpu), challenge: afterRestore(challenge), cancel, accept: afterRestore(accept), choose: afterRestore(choose),
  forfeit: afterRestore(forfeitAction), resume: afterRestore(resume), restoreAll, ABANDON_MS, RESTORE_GRACE_MS, activeFor, historyOf, replay, saveTeam, deleteTeam, boxForBuilder, learnsetOf, setMoves, state,
  startTourney, startTowerBattle, startEliteBattle, cpuReward, byUser, listPublic, queueInfo, queueMine, isQueued, unqueueUser, setQueueHook, queue, QUEUE_MS, BANDS, isRestoring: () => restoring, enqueue: afterRestore(enqueue), unqueue, refundAll, runAiBattle, _dropMemory, battles, challenges, dayWins,
};

'use strict';
// Alto Mando de Kanto: con las 8 medallas se puede retar la CARRERA de 5 combates seguidos (Lorelei, Bruno, Agatha, Lance y el Campeón Azul),
// como en los juegos: sin curar entre combates (los PS, los PP y los estados de cada Pokémon pasan de un combate al siguiente) y con los
// derrotados fuera hasta el final. Equipos de nivel fijo (Rojo Fuego / Verde Hoja), Individual y niveles reales.
//  - Perder (o empatar) acaba la carrera: hay que empezar de nuevo desde Lorelei, con el equipo curado. Cada victoria ya cobra lo suyo (EXP, PB, premio).
//  - Un fallo del simulador no cuenta: la carrera sigue en el mismo combate y se puede reintentar.
//  - Al vencer al Campeón: Salón de la Fama (con tu equipo), el título «Campeón de la Liga» + premios (una sola vez; quien ya los tenía de cuando los daban las
//    8 medallas no cobra dos veces) y, la primera vez, una Moneda Amuleto. Después se puede repetir (revancha): los equipos suben +3 niveles por cada
//    victoria anterior (hasta +15) y cada victoria vuelve a entrar en el Salón de la Fama.
// Estado en `user.elite = { clears, hof: [...], amulet, run: { stage, members, carry } }`; el combate en curso es un combate normal de la CPU con la marca `elite`.
const db = require('./db');
const hub = require('./hub');
const { BY_ID } = require('./pokedex');
const trainers = require('./trainers');

const IDS = ['lorelei', 'bruno', 'agatha', 'lance', 'azul'];
const STAGES = IDS.length;
const BONUS_PER_CLEAR = 3;
const BONUS_MAX = 15;
const HOF_KEEP = 50;
const NEED_BADGES = 8;

const stateOf = (u) => (u.elite ||= { clears: 0, hof: [], amulet: false, run: null });
const trainerOf = (stage) => trainers.BY_TRAINER.get(IDS[stage]);
const unlocked = (u) => trainers.badgeCount(u) >= NEED_BADGES;
const bonusFor = (u) => Math.min(BONUS_MAX, BONUS_PER_CLEAR * stateOf(u).clears);

function monView(u, m, carry) {
  let name = (BY_ID.get(m.id) || {}).name || '#' + m.id;
  let level = 0;
  let shiny = false;
  try { const sp = require('./specimen').find(u, { id: m.id, uid: m.uid }); name = sp.nick || name; level = sp.level; shiny = !!sp.shiny; } catch { /* ya no está */ }
  const c = carry && carry[m.uid];
  return { id: m.id, uid: m.uid, name, level, shiny, hp: c ? c.hp / c.max : 1, fainted: !!c && c.hp <= 0, status: c ? c.s : '' };
}

function view(u) {
  const E = stateOf(u);
  const bonus = bonusFor(u);
  return {
    unlocked: unlocked(u), need: NEED_BADGES, clears: E.clears, bonus,
    members: IDS.map((id) => {
      const t = trainers.BY_TRAINER.get(id);
      return { id, name: t.name, cls: t.cls, quote: t.quote, types: t.types, sig: t.sig, n: t.team.length, lv: [Math.min(...t.team.map((x) => x[1])) + bonus, trainers.highest(t, bonus)], champion: !!t.champion, team: t.team.map((x) => x[0]) };
    }),
    run: E.run ? { stage: E.run.stage, total: STAGES, members: E.run.members.map((m) => monView(u, m, E.run.carry)), next: trainerOf(E.run.stage).name } : null,
    hof: E.hof.slice(-12).reverse(),
  };
}

function begin(u, run) {
  const showdown = require('./showdown');
  const alive = run.members.filter((m) => !(run.carry[m.uid] && run.carry[m.uid].hp <= 0));
  if (!alive.length) throw new Error('Todos tus Pokémon están debilitados: la carrera ha terminado.');
  let mine;
  try { mine = showdown.resolveTeam(u, alive, { format: 'singles', level: 'real' }); } catch (e) { throw new Error(`Tu equipo de la carrera ya no está disponible (${e.message}). Abandona la carrera y empieza otra.`); }
  const carry = alive.map((m) => run.carry[m.uid] || null);
  const b = showdown.startEliteBattle(u, { trainer: trainerOf(run.stage), mine, carry, stage: run.stage, bonus: bonusFor(u) });
  return { battle: b.view(b.sides[0]) };
}

// Empieza una carrera nueva con `team` (los mismos que Individual: hasta 6).
function start(u, { team }) {
  if (!unlocked(u)) throw new Error(`Necesitas las ${NEED_BADGES} medallas de Kanto para retar al Alto Mando.`);
  const E = stateOf(u);
  if (E.run) throw new Error('Ya tienes una carrera en curso: continúala o abandónala.');
  if (!Array.isArray(team) || !team.length) throw new Error('Elige tu equipo.');
  const members = team.map((m) => ({ id: Number(m.id), uid: String(m.uid) }));
  const run = { stage: 0, members, carry: {}, at: Date.now() };
  const r = begin(u, run); // (si algo falla, no queda ninguna carrera a medias)
  E.run = run;
  db.save();
  return r;
}

// Siguiente combate (o reintento de uno interrumpido por un fallo del simulador).
function next(u) {
  const E = stateOf(u);
  if (!E.run) throw new Error('No tienes ninguna carrera en curso.');
  return begin(u, E.run);
}

function abandon(u) {
  const E = stateOf(u);
  if (require('./showdown').byUser.has(u.id)) throw new Error('Acaba antes el combate en curso.');
  E.run = null;
  db.save();
  return {};
}

// Fin de un combate de la carrera (lo llama showdown.settle). Devuelve lo que ve el jugador en la pantalla final.
function onEnd(u, b, won) {
  const E = stateOf(u);
  const run = E.run;
  if (!run || !b.elite || run.stage !== b.elite.stage) return null;
  const t = trainerOf(run.stage);
  const out = { stage: run.stage + 1, total: STAGES, foe: t.name };
  if (!won) {
    E.run = null;
    out.ended = true;
    db.save();
    return out;
  }
  Object.assign(run.carry, b.carryOut || {});
  if (run.stage < STAGES - 1) {
    run.stage++;
    out.next = trainerOf(run.stage).name;
    out.team = run.members.map((m) => monView(u, m, run.carry));
    db.save();
    return out;
  }
  // ¡Campeón!
  const first = E.clears === 0;
  E.clears++;
  const entry = { n: E.clears, at: Date.now(), team: run.members.map((m) => { const v = monView(u, m, null); return { id: v.id, name: v.name, level: v.level, shiny: v.shiny }; }) };
  E.hof.push(entry);
  if (E.hof.length > HOF_KEEP) E.hof.splice(0, E.hof.length - HOF_KEEP);
  out.cleared = true;
  out.n = E.clears;
  out.champion = require('./progress').awardChampion(u);
  if (first && !E.amulet) {
    E.amulet = true;
    u.items['hi-amuletcoin'] = (u.items['hi-amuletcoin'] || 0) + 1;
    out.amulet = true;
    hub.emitUser(u.id, 'toast', { kind: 'quest', text: '🎯 Alto Mando: 1× Moneda Amuleto' });
  }
  hub.feed('badge', `🏛️ ${u.username} entró en el Salón de la Fama (${E.clears}.ª vez)`);
  hub.track(u, 'elite_clear');
  E.run = null;
  db.save();
  return out;
}

module.exports = { IDS, STAGES, BONUS_PER_CLEAR, BONUS_MAX, NEED_BADGES, view, start, next, abandon, onEnd, bonusFor, stateOf };

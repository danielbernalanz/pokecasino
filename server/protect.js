'use strict';
// Ejemplares «de combate»: los que el jugador ha preparado y NO debe perder por descuido al vender, regalar, transferir o liberar.
// Una sola definición (`battleBuilt`) y un solo selector (`select`) que usan TODAS las vías:
//  - las que eligen solas el ejemplar (Mercado, PNJ, regalos, liberar, «Transferir repetidos») jamás toman uno protegido;
//  - si no quedan ejemplares libres, el servidor da un error claro y solo sigue si la petición trae `confirmUids` con el uid concreto;
//  - las vías en las que el jugador elige el ejemplar (ficha, GTS, intercambio) exigen esa misma confirmación (`needConfirm`).
const { BY_ID } = require('./pokedex');

const LEVEL_MIN = 50;

const nameOf = (id) => (BY_ID.get(Number(id)) || { name: '?' }).name;
const label = (id, m) => `${m.nick || nameOf(id)} Nv. ${m.level}`;
const heldName = (item) => { try { return require('./bp').nameOfHeld(item); } catch { return item; } };

// Equipos guardados de Combates (`u.btTeams`) y carrera del Alto Mando en los que está el ejemplar.
function teamsOf(u, uid) {
  const out = [];
  (u.btTeams || []).forEach((t, slot) => { if (t && Array.isArray(t.members) && t.members.some((x) => x && x.uid === uid)) out.push({ slot, name: t.name }); });
  return out;
}

// → { protected: bool, reasons: [texto en español], teams: [{ slot, name }] }
function battleBuilt(u, m, id) {
  const reasons = [];
  const teams = teamsOf(u, m.uid);
  for (const t of teams) reasons.push(`En el equipo «${t.name}»`);
  const run = u.elite && u.elite.run;
  if (run && Array.isArray(run.members) && run.members.some((x) => x.uid === m.uid)) reasons.push('En tu carrera del Alto Mando');
  if (m.fav) reasons.push('Es favorito');
  if (u.buddy && u.buddy.id === Number(id) && u.buddy.uid === m.uid) reasons.push('Es tu compañero');
  const ev = Array.isArray(m.evs) ? m.evs.reduce((s, v) => s + (Number(v) || 0), 0) : 0;
  if (ev > 0) reasons.push(`Tiene ${ev} EV`);
  if (Array.isArray(m.hyper) && m.hyper.some(Boolean)) reasons.push('Entrenado con Chapas (Entrenamiento Extremo)');
  if (m.mint) reasons.push(`Naturaleza cambiada con Menta (${m.mint})`);
  if (m.abUsed) reasons.push('Habilidad cambiada con Cápsula o Parche');
  if (m.item) reasons.push(`Lleva ${heldName(m.item)}`);
  if (m.mvHand) reasons.push('Movimientos elegidos a mano');
  if (m.teraSet) reasons.push('Teratipo elegido');
  if ((m.level || 1) >= LEVEL_MIN) reasons.push(`Nivel ${m.level}`);
  return { protected: reasons.length > 0, reasons, teams };
}

const isProtected = (u, m, id) => battleBuilt(u, m, id).protected;
const describe = (u, id, m) => { const b = battleBuilt(u, m, id); return `${label(id, m)} (${b.reasons.map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join(', ')})`; };

const uidSet = (list) => new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string').slice(0, 300));

// Error cuando una vía necesita confirmar ejemplares protegidos.
function protectedError(u, id, list, extra = '') {
  const txt = list.slice(0, 5).map((m) => describe(u, id, m)).join('; ') + (list.length > 5 ? ` y ${list.length - 5} más` : '');
  return Object.assign(new Error(`${extra}Solo te quedan ejemplares preparados para combate: ${txt}. Si de verdad quieres soltarlos, elígelos tú mismo y confirma.`), { code: 'protected', uids: list.map((m) => m.uid) });
}

// Vías con ejemplar concreto elegido por el jugador (ficha, GTS, intercambio…): lanza si es protegido y no viene confirmado.
function needConfirm(u, id, m, confirmUids) {
  const b = battleBuilt(u, m, id);
  if (!b.protected || uidSet(confirmUids).has(m.uid)) return b;
  throw Object.assign(new Error(`${label(id, m)} es un Pokémon de combate (${b.reasons.map((r) => r.charAt(0).toLowerCase() + r.slice(1)).join(', ')}). Confirma expresamente para seguir.`), { code: 'protected', uids: [m.uid] });
}

// Elige `qty` ejemplares de la especie para sacarlos de la Caja.
//  uids        : el jugador los ha elegido (deben ser exactamente `qty`); los protegidos exigen `confirmUids`.
//  sin uids    : elección automática: los menos valiosos NO protegidos; si faltan, solo entran protegidos presentes en `confirmUids`.
//  hard(m)     : texto del bloqueo duro (fuera, en combate…) o null.  shiny: null = cualquiera.
function select(u, id, shiny, qty, { uids, confirmUids, hard = () => null, pool } = {}) {
  const sp = require('./specimen');
  id = Number(id);
  const all = (pool || sp.sync(u, id)).filter((m) => shiny == null || !!m.shiny === !!shiny);
  const conf = uidSet(confirmUids);
  if (Array.isArray(uids) && uids.length) {
    if (uids.length !== qty) throw new Error(`Has elegido ${uids.length} ejemplares pero la cantidad es ${qty}.`);
    if (new Set(uids).size !== uids.length) throw new Error('Ejemplar repetido en la elección.');
    const out = [];
    for (const uid of uids) {
      const m = all.find((x) => x.uid === uid);
      if (!m) throw new Error('Alguno de los ejemplares elegidos ya no está disponible.');
      const why = hard(m);
      if (why) throw new Error(why);
      needConfirm(u, id, m, [...conf]);
      out.push(m);
    }
    return out;
  }
  const free = all.filter((m) => !hard(m));
  const safe = free.filter((m) => !isProtected(u, m, id)).sort(sp.byValue);
  if (safe.length >= qty) return safe.slice(0, qty);
  const rest = free.filter((m) => isProtected(u, m, id)).sort(sp.byValue);
  const ok = rest.filter((m) => conf.has(m.uid));
  const out = safe.concat(ok).slice(0, qty);
  if (out.length >= qty) return out;
  if (rest.length) throw protectedError(u, id, rest.filter((m) => !conf.has(m.uid)));
  const blocked = all.map(hard).find(Boolean);
  throw new Error(blocked || `No tienes ${qty > 1 ? 'tantos ejemplares' : 'ese Pokémon'}.`);
}

// Vista de los ejemplares de una especie para las listas de venta/regalo/transferencia del cliente.
function listView(u, id, shiny, hard = () => null) {
  const sp = require('./specimen');
  const moves = require('./moves');
  const abilities = require('./abilities');
  id = Number(id);
  if (!BY_ID.has(id)) throw new Error('Pokémon no válido.');
  const arr = sp.sync(u, id).filter((m) => shiny == null || !!m.shiny === !!shiny);
  const out = arr.map((m) => {
    try { moves.ensure(id, m); require('./sdmap').ensureSd(id, m); abilities.resolve(id, m); } catch { /* ejemplar raro */ }
    const eq = (m.sdMoves || []).map((mv) => ({ id: mv, name: moves.name(mv), type: moves.card(mv).type }));
    const b = battleBuilt(u, m, id);
    const ev = Array.isArray(m.evs) ? m.evs.slice() : [0, 0, 0, 0, 0, 0];
    const why = hard(m);
    return { uid: m.uid, id, shiny: !!m.shiny, nick: m.nick || '', level: m.level, gender: require('./eggroups').genderOf(id, m), nature: require('./specimen').natureOf(m), ability: abilities.name(m.sdAbility), item: m.item || null, itemName: m.item ? heldName(m.item) : null, itemBack: !!m.item,
      moves: eq, ivs: m.ivs.slice(), ivTotal: sp.ivTotal(m), evs: ev, evTotal: ev.reduce((s, v) => s + v, 0), protected: b.protected, reasons: b.reasons, teams: b.teams, blocked: why || null };
  });
  out.sort((a, b) => sp.byValue(arr.find((m) => m.uid === a.uid), arr.find((m) => m.uid === b.uid)));
  // Orden: los libres y no protegidos primero (menos valiosos antes); los protegidos y bloqueados al final.
  out.sort((a, b) => (Number(!!a.blocked) - Number(!!b.blocked)) || (Number(a.protected) - Number(b.protected)));
  return out;
}

module.exports = { battleBuilt, isProtected, describe, needConfirm, select, listView, protectedError, uidSet, teamsOf, LEVEL_MIN };

// «Liberar copias» de la Pokédex (shop:release): antes salía «el menos valioso» a ciegas; ahora, como las demás vías automáticas, nunca un protegido.
function releaseCopies(u, p = {}) {
  const gacha = require('./gacha');
  const sp = require('./specimen');
  const id = Number(p.id);
  const count = Number(p.count) || 1;
  if (!BY_ID.has(id) || !u.collection[id]) throw new Error('No tienes ese Pokémon.');
  if (!Number.isInteger(count) || count < 1) throw new Error('Cantidad no válida.');
  const explicit = Array.isArray(p.uids) && p.uids.length;
  const list = select(u, id, explicit ? null : false, count, { uids: p.uids, confirmUids: p.confirmUids, hard: (m) => (m.away ? sp.AWAY_TEXT : null) });
  for (const m of list) m.drop = true;
  let res;
  try { res = gacha.release(u, { id, count }); } catch (e) { for (const m of list) delete m.drop; throw e; }
  for (const x of sp.sync(u, id)) delete x.drop;
  return res;
}
module.exports.releaseCopies = releaseCopies;

// Quita ejemplares de todos los equipos guardados de Combates («Quitar del equipo y vender»).
function unteam(u, p = {}) {
  const set = uidSet(p.uids);
  if (!set.size) throw new Error('No hay ejemplares que quitar del equipo.');
  let n = 0;
  (u.btTeams || []).forEach((t, i) => {
    if (!t || !Array.isArray(t.members)) return;
    const keep = t.members.filter((x) => !(x && set.has(x.uid)));
    if (keep.length === t.members.length) return;
    n += t.members.length - keep.length;
    u.btTeams[i] = keep.length ? { ...t, members: keep } : null; // un equipo que se queda sin miembros se borra
  });
  require('./db').save();
  return { removed: n, teams: u.btTeams || [] };
}
module.exports.unteam = unteam;

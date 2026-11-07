'use strict';
// Exportación de equipo y Caja PC del propio jugador: JSON estable (`pokecasino-export` v1) y texto de Pokémon Showdown.
// Solo salen datos del ejemplar y el nombre/ID de entrenador (visibles para todos en el juego): nada de contraseña, token, IP, monedas ni mochila.
// `id` de cada ejemplar es su identificador interno de 8 hex (aleatorio, sin información): sirve para enlazar equipos con la caja y para reimportar en el futuro.
const db = require('./db');
const { BY_ID } = require('./pokedex');
const specimen = require('./specimen');
const sd = require('./sdmap');
const abilities = require('./abilities');
const eggroups = require('./eggroups');
const evs = require('./evs');
const hyper = require('./hyper');
const ES = require('./sd-es.json');

const FORMAT = 'pokecasino-export';
const VERSION = 1;
const STAT = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const toID = sd.toID;
const obj = (arr) => Object.fromEntries(STAT.map((s, i) => [s, arr[i]]));
const iso = (t) => (Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null);

function exportMon(u, id, m) {
  const dex = BY_ID.get(id);
  const ex = require('./exp'); ex.ensure(id, m);
  sd.ensureSd(id, m);
  const lot = require('./lottery');
  const tera = require('./tera');
  const balls = require('./balls');
  const cap = require('./capture');
  const fm = require('./forms');
  const natureEff = specimen.natureOf(m);
  const ballId = balls.ballOf(m);
  const hy = hyper.hyperOf(m) ? m.hyper : null;
  const markInfo = m.mark && cap.MARKS[m.mark] ? cap.MARKS[m.mark] : null;
  const c = m.caught || null;
  const sdSpecies = (() => { try { return sd.speciesOf(id); } catch { return null; } })();
  const formName = fm.showdownName(id, m);
  const itemName = m.item ? (ES.items[m.item] || m.item) : null;
  return {
    id: m.uid,
    species: { id, name: dex.name, showdownId: sdSpecies ? toID(formName || sdSpecies.name) : null, showdownName: sdSpecies ? (formName || sdSpecies.name) : null },
    form: fm.label(id, m),
    nickname: m.nick || null,
    level: m.level,
    exp: m.exp,
    gender: eggroups.genderOf(id, m) || null,
    shiny: !!m.shiny,
    nature: m.nature,
    mint: m.mint || null,
    effectiveNature: natureEff,
    ability: { id: m.sdAbility, name: abilities.name(m.sdAbility), hidden: !!m.ha },
    item: m.item ? { id: m.item, name: itemName } : null,
    moves: (m.sdMoves || []).map((mv) => ({ id: mv, name: ES.moves[mv] || mv })),
    ivs: obj(m.ivs),
    evs: obj(evs.ensure(m)),
    hyperTrained: hy ? obj(hy.map(Boolean)) : null,
    teraType: tera.teraOf(id, m),
    friendship: m.friendship,
    ball: { id: ballId, name: balls.nameOf(ballId) },
    mark: markInfo ? { id: m.mark, name: markInfo.name, title: markInfo.title } : null,
    size: Number.isInteger(m.size) ? { value: m.size, label: cap.sizeLabel(m.size) } : null,
    originalTrainer: { tid: lot.otOf(u, m), name: lot.otNameOf(u, m) || u.username },
    caught: { at: iso(m.at), zone: c ? c.zone || null : null, level: c && Number.isFinite(c.level) ? c.level : null },
    favorite: !!m.fav,
    pokerus: require('./pokerus').state(m),
  };
}

// Texto de exportación de Showdown (lo que se pega en Showdown / calculadoras) de un ejemplar: nivel real, IV efectivos (con Chapas a 31).
function showdownSet(id, m) {
  const { Dex } = sd.ps();
  const fm = require('./forms');
  const sp = sd.speciesOf(id);
  const formName = fm.showdownName(id, m);
  const species = formName && Dex.species.get(formName).exists ? Dex.species.get(formName).name : sp.name;
  const nick = String(m.nick || '').replace(/[()@|\\[\],\u0000-\u001f]/g, '').trim();
  const eff = hyper.effIvs({ ivs: m.ivs, hyper: m.hyper });
  const own = evs.ensure(m);
  const nameOf = (kind, v) => { const x = Dex[kind].get(v); return x && x.exists ? x.name : v; };
  const balls = require('./balls');
  const set = {
    name: nick && nick !== species ? nick : species, species,
    item: m.item && require('./bp').holdable(m.item) ? nameOf('items', m.item) : '',
    ability: nameOf('abilities', m.sdAbility),
    moves: (m.sdMoves || []).map((x) => nameOf('moves', x)),
    nature: sd.NATURE_EN[specimen.natureOf(m)] || 'Serious',
    gender: sp.gender ? (sp.gender === 'N' ? '' : sp.gender) : (eggroups.genderOf(id, m) === 'F' ? 'F' : eggroups.genderOf(id, m) === 'M' ? 'M' : ''),
    evs: Object.fromEntries(STAT.map((s, i) => [s, own[i]])),
    ivs: Object.fromEntries(STAT.map((s, i) => [s, Math.max(0, Math.min(31, Number.isInteger(eff[i]) ? eff[i] : 31))])),
    level: Math.max(1, Math.min(100, Math.floor(m.level) || 5)), shiny: !!m.shiny,
    happiness: Math.max(0, Math.min(255, Number.isFinite(m.friendship) ? m.friendship : 70)),
    pokeball: nameOf('items', toID(balls.ballOf(m))), teraType: require('./tera').cap(require('./tera').teraOf(id, m)),
  };
  return set;
}
function showdownText(sets) { return sd.ps().Teams.export(sets).trim(); }

function boxList(u) {
  specimen.syncAll(u);
  const out = [];
  for (const [idStr, arr] of Object.entries(u.mons || {})) {
    const id = Number(idStr);
    if (!BY_ID.has(id)) continue;
    for (const m of arr) out.push({ id, m });
  }
  out.sort((a, b) => a.id - b.id || (a.m.at || 0) - (b.m.at || 0));
  return out;
}

function exportData(u, p = {}) {
  const what = p && p.what;
  if (!['box', 'team', 'all'].includes(what)) throw new Error('Elige qué exportar: caja, equipo o todo.');
  const out = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), trainer: { name: u.username, tid: require('./lottery').tidOf(u) } };
  const box = boxList(u);
  const byUid = new Map(box.map((x) => [x.m.uid, x]));
  const teams = Array.isArray(u.btTeams) ? u.btTeams : [];
  const teamAt = (i) => {
    const slot = Number(i);
    const t = Number.isInteger(slot) && slot >= 0 ? teams[slot] : null;
    if (!t) throw new Error('Ese equipo no existe.');
    return { slot, name: t.name, members: (t.members || []).map((x) => x && byUid.get(x.uid)).filter(Boolean) };
  };
  if (what === 'team') {
    const t = teamAt(p.team);
    out.teamName = t.name;
    out.team = t.members.map(({ id, m }) => exportMon(u, id, m));
    out.showdown = showdownText(t.members.filter(({ id }) => sd.canBattle(id)).map(({ id, m }) => showdownSet(id, m)));
  } else {
    out.box = box.map(({ id, m }) => exportMon(u, id, m));
    if (what === 'all') {
      out.teams = teams.map((t, i) => (t ? { slot: i, name: t.name, members: (t.members || []).map((x) => x && x.uid).filter((x) => byUid.has(x)) } : null)).filter(Boolean);
    }
  }
  db.save();
  return out;
}

module.exports = { FORMAT, VERSION, exportData, exportMon, showdownSet, showdownText };

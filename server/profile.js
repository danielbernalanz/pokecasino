'use strict';
// Ficha pública del entrenador (modal desde el ranking, el chat, «En vivo» o el enlace #/entrenador/<nombre>): solo datos que el propio juego ya enseña a todos
// (aspecto, medallas, colección, Liga, Salón de la Fama, Pokédex regionales, títulos, torneos). NUNCA monedas, polvo, objetos, historial, IP, contraseña ni
// sesiones; el tiempo de juego solo si el jugador lo tiene público (playtime.isPublic) o es él mismo quien mira.
const db = require('./db');
const hub = require('./hub');
const playtime = require('./playtime');

const HOF_SHOWN = 5;

function view(viewer, { username } = {}) {
  const u = db.userByName(String(username || ''));
  if (!u || u.banned) throw new Error('Jugador no encontrado.');
  const progress = require('./progress');
  const L = u.league;
  const hof = ((u.elite && u.elite.hof) || []).slice(-HOF_SHOWN).reverse().map((e) => ({ n: e.n, at: e.at, team: e.team.map((m) => ({ id: m.id, name: m.name, level: m.level, shiny: !!m.shiny })) }));
  return {
    player: {
      ...hub.publicUser(u),
      tid: u.npc ? null : require('./lottery').tidOf(u),
      createdAt: u.createdAt,
      collection: u.collection,
      progress: { badges: u.progress ? u.progress.badges : [], sets: u.progress ? u.progress.sets : [] },
      titles: u.progress ? u.progress.titles.map((id) => ({ id, text: progress.titleText(id) })).filter((t) => t.text) : [],
      league: L && L.played ? { singles: { r: L.singles.r, w: L.singles.w, l: L.singles.l }, doubles: { r: L.doubles.r, w: L.doubles.w, l: L.doubles.l }, best: (L.hist[0] || {}).best } : null,
      stats: { pulls: u.stats.pulls, duelsWon: u.stats.duelsWon, duelsLost: u.stats.duelsLost, biggestWin: u.stats.biggestWin },
      hof: { total: (u.elite && u.elite.clears) || 0, last: hof },
      dexReg: u.npc ? [] : require('./regions').publicView(u),
      tourney: u.trn ? { played: u.trn.played || 0, won: u.trn.champion || 0 } : { played: 0, won: 0 },
      // Tiempo de juego: null si el jugador lo tiene en privado (salvo para él mismo).
      playMs: playtime.isPublic(u) || (viewer && u.id === viewer.id) ? u.playMs || 0 : null,
    },
  };
}

module.exports = { view, HOF_SHOWN };

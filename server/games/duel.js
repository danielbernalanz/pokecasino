'use strict';
// Duelos PvP: reta a otro entrenador con un Pokémon de tu colección y una apuesta.
const crypto = require('crypto');
const db = require('../db');
const hub = require('../hub');
const { simulate } = require('./battle');
const { BY_ID } = require('../pokedex');

const RAKE = 0.05;
const EXPIRE_MS = 10 * 60 * 1000;
const open = new Map();
const history = [];

function ownedPick(user, { pokeId, shiny }) {
  const id = Number(pokeId);
  const c = user.collection[id];
  if (!BY_ID.has(id) || !c || c.n < 1) throw new Error('No tienes ese Pokémon.');
  if (shiny && !(c.s > 0)) throw new Error('No tienes la versión variocolor.');
  return { id, shiny: !!shiny, stars: Math.min(5, c.n), owner: user.username };
}

function listPublic() {
  return [...open.values()].map((d) => ({
    id: d.id, creator: d.creator, wager: d.wager, poke: d.poke, target: d.target, createdAt: d.createdAt,
  }));
}
const push = () => hub.broadcast('duel:list', listPublic());

function create(user, { pokeId, shiny, wager, target }) {
  if ([...open.values()].filter((d) => d.creatorId === user.id).length >= 3) throw new Error('Máximo 3 retos abiertos.');
  const poke = ownedPick(user, { pokeId, shiny });
  wager = Number(wager) || 0;
  if (wager !== 0) hub.takeBet(user, wager);
  if (target) {
    const t = db.userByName(target);
    if (!t || t.id === user.id) throw new Error('Rival no encontrado.');
    target = t.username;
  }
  const d = { id: crypto.randomUUID().slice(0, 8), creatorId: user.id, creator: user.username, wager, poke, target: target || null, createdAt: Date.now() };
  open.set(d.id, d);
  push();
  if (d.target) {
    const t = db.userByName(d.target);
    hub.emitUser(t.id, 'toast', { kind: 'duel', text: `⚔️ ${user.username} te reta a un duelo por ${wager} monedas` });
  }
  return { duel: d };
}

function refund(d) {
  const u = db.userById(d.creatorId);
  if (u && d.wager) { u.coins += d.wager; u.stats.wagered -= d.wager; hub.pushMe(u); }
  db.save();
}

function cancel(user, { id }) {
  const d = open.get(id);
  if (!d || (d.creatorId !== user.id && !user.isAdmin)) throw new Error('Reto no encontrado.');
  open.delete(id);
  refund(d);
  push();
  return {};
}

function accept(user, { id, pokeId, shiny }) {
  const d = open.get(id);
  if (!d) throw new Error('Ese reto ya no existe.');
  if (d.creatorId === user.id) throw new Error('No puedes aceptar tu propio reto.');
  if (d.target && d.target !== user.username) throw new Error('Este reto es para otro entrenador.');
  const poke = ownedPick(user, { pokeId, shiny });
  if (d.wager) hub.takeBet(user, d.wager);
  open.delete(id);
  const creator = db.userById(d.creatorId);
  const result = simulate(d.poke, poke);
  const players = [creator, user];
  const winner = players[result.winner];
  const loser = players[1 - result.winner];
  let prize = 0;
  if (d.wager) {
    prize = Math.floor(d.wager * 2 * (1 - RAKE));
    hub.pay(winner, prize, d.wager, 'duel');
  }
  winner.stats.duelsWon++;
  loser.stats.duelsLost++;
  for (const p of players) { hub.track(p, 'duel_play'); hub.track(p, 'play', { game: 'duel' }); }
  hub.track(winner, 'duel_win');
  hub.addXp(winner, 50);
  hub.addXp(loser, 20);
  db.save();
  const record = { id: d.id, at: Date.now(), wager: d.wager, prize, players: [creator.username, user.username], ...result };
  history.unshift(record);
  history.length = Math.min(history.length, 20);
  for (const p of players) { hub.emitUser(p.id, 'duel:result', record); hub.pushMe(p); }
  const w = result.fighters[result.winner];
  const l = result.fighters[1 - result.winner];
  hub.feed('duel', `⚔️ ${winner.username} (${w.name}) venció a ${loser.username} (${l.name})${d.wager ? ` y ganó ${prize.toLocaleString('es')} monedas` : ''}`);
  push();
  return { record };
}

// Caducidad de retos olvidados.
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const d of open.values()) {
    if (now - d.createdAt > EXPIRE_MS) { open.delete(d.id); refund(d); changed = true; }
  }
  if (changed) push();
}, 30000).unref();

function refundAll() { for (const d of open.values()) refund(d); open.clear(); }
const recent = () => history.map(({ log, ...rest }) => rest);
const getRecord = (id) => history.find((h) => h.id === id);

module.exports = { create, cancel, accept, listPublic, refundAll, recent, getRecord };

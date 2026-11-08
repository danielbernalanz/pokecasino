'use strict';
// Exploración: la primera vez que un jugador abre cada apartado del casino recibe una pequeña recompensa.
const db = require('./db');
const hub = require('./hub');

const REWARD = 50;
const SECTIONS = new Set(['gacha', 'pc', 'pokedex', 'huerto', 'combates', 'market', 'shop', 'slots', 'blackjack', 'roulette', 'quiz', 'trainer', 'ranking', 'plinko', 'poker']);

function visit(user, { section } = {}) {
  if (typeof section !== 'string' || !SECTIONS.has(section)) return { reward: 0 };
  const seen = user.explored || (user.explored = {});
  if (seen[section]) return { reward: 0 };
  seen[section] = Date.now();
  user.coins += REWARD;
  hub.ledger(user, REWARD, 'explore', section);
  db.save();
  return { reward: REWARD };
}

module.exports = { visit, REWARD, SECTIONS };

'use strict';
// Recompensa diaria con racha: monedas (500 + 100 × (racha − 1), hasta 1.100), un Ticket Gacha y, cada 7 días,
// un Amuleto Iris.
const db = require('./db');
const hub = require('./hub');
const BAL = require('./balance');

const today = () => new Date().toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

function claim(user) {
  if (user.daily.last === today()) throw new Error('Ya reclamaste tu recompensa de hoy. ¡Vuelve mañana!');
  user.daily.streak = user.daily.last === yesterday() ? user.daily.streak + 1 : 1;
  user.daily.last = today();
  const reward = BAL.dailyReward(user.daily.streak);
  user.coins += reward;
  hub.ledger(user, reward, 'daily', `Racha ${user.daily.streak}`);
  user.items.ticket = (user.items.ticket || 0) + 1;
  const charm = user.daily.streak % 7 === 0;
  if (charm) user.items['shiny-charm'] = (user.items['shiny-charm'] || 0) + 1;
  hub.track(user, 'daily');
  db.save();
  return { reward, streak: user.daily.streak, charm };
}

module.exports = { claim };

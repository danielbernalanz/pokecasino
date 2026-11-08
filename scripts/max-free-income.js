'use strict';
// Máximo teórico de monedas por jugador y día que NO salen de apostar (docs/ANTIABUSO.md, primera tabla), con las constantes reales del servidor.
//   node scripts/max-free-income.js
// Convención: lo que no son monedas (Tickets, Huevos, polvo, Caramelos…) se valora a lo máximo que pagan los comerciantes NPC (`npc.bounds().cap`) o,
// el polvo, al tipo de cambio; un Huevo Misterioso se valora por lo que rinde ABRIRLO y vender el cosmético a un PNJ (esperanza sobre los pesos del huevo).
// Es un techo (todo a la vez y con el mejor sorteo de misiones): un jugador real queda muy por debajo. No incluye lo que ocurre una sola vez
// (Ruta, medallas, niveles, primeras visitas), la Liga (2.000 por temporada) ni la Enfermera Joy (red de seguridad, aparte).
const os = require('os');
const fs = require('fs');
const path = require('path');
if (!process.env.DATA_DIR) process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-maxincome-'));
const S = path.join(__dirname, '..', 'server');
const BAL = require(S + '/balance');
const items = require(S + '/items');
const npc = require(S + '/npc');
const gacha = require(S + '/gacha');
const progress = require(S + '/progress');
const trainers = require(S + '/trainers');
const expedition = require(S + '/expedition');
const bond = require(S + '/bond');
const heal = require(S + '/heal');

const cap = (id) => npc.bounds({ kind: 'item', itemId: id }).cap;
function eggValue() {
  const W = items.EGG_WEIGHTS;
  const tot = Object.values(W).reduce((a, b) => a + b, 0);
  return Object.entries(W).reduce((s, [r, w]) => {
    const ids = Object.keys(items.COSMETICS).filter((k) => items.COSMETICS[k].rarity === r && !items.COSMETICS[k].event);
    return s + (w / tot) * (ids.reduce((t, k) => t + cap(k), 0) / ids.length);
  }, 0);
}
const pullValue = () => Object.entries(gacha.RATES).reduce((s, [r, p]) => s + p * npc.maxBid(r), 0); // una tirada vendida pieza a pieza a los NPC

function compute({ wednesday = false, legendaryCosmetics = false } = {}) {
  const egg = eggValue();
  const ticket = cap('ticket');
  const value = (it) => Object.entries(it).reduce((s, [id, n]) => s + n * (id === 'mystery-egg' ? egg : id === 'ticket' ? ticket : cap(id)), 0);
  const rows = [];
  const add = (name, v, note = '') => rows.push({ name, v: Math.round(v), note });

  add('Recompensa diaria', BAL.dailyReward(BAL.DAILY_MAX_STREAK), 'racha ≥ 7');
  add('… Ticket diario + Amuleto Iris cada 7 días', ticket + cap('shiny-charm') / 7);
  add('Tirada gratis diaria', pullValue(), 'vendida pieza a pieza a los NPC');
  add('Combates contra la CPU', trainers.COINS_DAY);
  // Misiones: las 3 de mayor valor del catálogo (el sorteo real da 3 al azar) + el bonus de las tres.
  const vals = progress.DAILY.map((m) => ({ id: m.id, coins: (m.reward.coins || 0) * (wednesday ? 2 : 1), v: (m.reward.coins || 0) * (wednesday ? 2 : 1) + value(m.reward.items || {}) }));
  const best = vals.sort((a, b) => b.v - a.v).slice(0, 3);
  add('Misiones diarias (las 3 mejores del catálogo)', best.reduce((s, m) => s + m.v, 0), best.map((m) => m.id).join(', ') + (wednesday ? ' · miércoles ×2 en monedas' : ''));
  const bonus = { coins: 250, items: { 'mystery-egg': 1 } };
  add('… bonus de las 3 misiones', bonus.coins + value(bonus.items));
  add('Expediciones', expedition.COIN_DAY_CAP + expedition.DUST_DAY_CAP * gacha.DUST_RATE + egg, 'monedas + polvo + 1 objeto raro (el huevo)');
  add('Hallazgos del compañero', bond.COIN_DAY_CAP + bond.DUST_DAY_CAP * gacha.DUST_RATE + ticket * bond.TICKET_DAY_CAP, 'monedas + polvo + 1 Ticket');
  // Encargos: 2 al día; la prima es el 50 % del precio cobrado (≤ 0,5 × tope) y el premio no son monedas.
  const encs = [];
  for (const p of npc.NPCS.filter((x) => x.enc)) for (const a of npc.encArticles(p)) {
    if (a.kind === 'item' && !legendaryCosmetics) continue;
    const r = a.kind === 'poke' ? require(S + '/pokedex').BY_ID.get(a.pokeId).rarity : items.ITEMS[a.itemId].rarity;
    const prem = Math.floor(npc.bounds(a).cap * npc.ENC.premium);
    const prize = Math.max(...npc.BONUS[r].map(([t, n]) => (t === 'egg' ? egg : t === 'ticket' ? ticket : 0) * n));
    encs.push(prem + prize);
  }
  encs.sort((a, b) => b - a);
  add('Encargos de los NPC (2 al día): prima + premio', encs.slice(0, npc.ENC.perPlayerDay).reduce((s, x) => s + x, 0), legendaryCosmetics ? 'con cosméticos legendarios' : 'con Pokémon legendarios');
  add('Misión semanal temática (2 Tickets/semana)', (2 * ticket) / 7);
  add('Voltorb Flip: Moneda de la Suerte (1 al día)', cap('amulet-coin'));
  add('Fuentes gratuitas sin precio (MT, materiales, Teralitos, Caramelos Exp., PB, Balls…)', npc.FARM_DAY, 'FARM_DAY: tope propio de lo que pagan los NPC');
  // Recogida: hasta 5 hallazgos al día; esperanza de los objetos que se venden (Moneda… ); se toma 5 × el mejor peso medio
  const table = require(S + '/battlemoney').TABLE.at(-1)[1];
  const w = table.reduce((s, x) => s + x[2], 0);
  const pick = table.filter((x) => x[0] === 'item').reduce((s, x) => s + (x[2] / w) * cap(x[1]), 0);
  add('Recogida (habilidad): objetos vendibles (esperanza)', pick * require(S + '/battlemoney').PICKUP_DAY);
  const total = rows.reduce((s, r) => s + r.v, 0);
  return { rows, total, joy: heal.AMOUNT * Math.floor(24 / (heal.COOLDOWN / 3600e3)), egg, ticket };
}

module.exports = { compute, eggValue, pullValue };

if (require.main === module) {
  for (const [label, opt] of [['Día normal', {}], ['Miércoles (misiones ×2)', { wednesday: true }], ['Con cosméticos legendarios en los encargos', { legendaryCosmetics: true }]]) {
    const r = compute(opt);
    console.log(`\n${label}`);
    console.table(r.rows);
    console.log(`TOTAL ≈ ${r.total.toLocaleString('es')} monedas/día · Enfermera Joy (solo con < ${heal.LIMIT} monedas): +${r.joy.toLocaleString('es')} · Huevo ≈ ${Math.round(r.egg)} · Ticket ${r.ticket}`);
  }
}

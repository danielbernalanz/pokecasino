'use strict';
// Gacha de MT: una vía rápida y divertida (pero peor que la Máquina MT) para conseguir MT con monedas.
//  - Sin pity. Cada tirada es independiente: se sortea el nivel (básica…suprema) y, dentro del nivel, una MT al azar
//    (la «destacada» de la semana —un tipo— pesa ×FEATURED_BOOST dentro de su nivel; no cambia el valor esperado).
//  - El valor esperado en monedas de fabricación de una tirada es MENOR que su precio (ver docs/BALANCE.md): fabricar
//    sigue siendo la vía eficiente y vender MT sacadas del gacha no crea monedas por encima de lo que ya permite fabricar.
//  - Tope diario de tiradas. Los PNJ no compran MT (npc.js), y el gasto va al libro de cuentas como `tm_gacha`.
const db = require('./db');
const hub = require('./hub');
const items = require('./items');
const tmdata = require('./tmdata');
const { rand, weighted } = require('./rng');

const COST = { 1: 1500, 10: 13500 }; // ×10 con un 10 % de descuento
const DAILY_LIMIT = 30; // tiradas (no pulsaciones) por jugador y día
const FEATURED_BOOST = 3;
// Probabilidad de cada nivel (suman 1).
const ODDS = { basic: 0.66, good: 0.23, strong: 0.075, top: 0.03, apex: 0.005 };
const TIER_ORDER = ['basic', 'good', 'strong', 'top', 'apex'];

const BY_TIER = {};
for (const t of tmdata.TMS) (BY_TIER[t.tier] || (BY_TIER[t.tier] = [])).push(t);
const TYPES = [...new Set(tmdata.TMS.map((t) => t.type))].sort();

// Tipo destacado de la semana (semanas UTC desde el 1-1-1970 + 4 días: empieza en lunes).
const WEEK_MS = 7 * 864e5;
const weekIndex = (now = Date.now()) => Math.floor((now - 4 * 864e5) / WEEK_MS);
const featuredType = (now = Date.now()) => TYPES[weekIndex(now) % TYPES.length];
const weekEnds = (now = Date.now()) => (weekIndex(now) + 1) * WEEK_MS + 4 * 864e5;

// Valor esperado, en monedas de fabricación, de UNA tirada: Σ P(nivel) × monedas del nivel.
const expectedCraftCoins = () => TIER_ORDER.reduce((s, k) => s + ODDS[k] * tmdata.TIERS[k].coins, 0);

function rollTier() { return weighted(TIER_ORDER, (k) => ODDS[k]); }
function rollTm(feat) {
  const tier = rollTier();
  return weighted(BY_TIER[tier], (t) => (t.type === feat ? FEATURED_BOOST : 1));
}

const day = (u) => {
  const d = require('./tm').day(u);
  if (typeof d.gacha !== 'number') d.gacha = 0;
  return d;
};

function info(u) {
  const now = Date.now();
  return { cost: COST, limit: DAILY_LIMIT, used: day(u).gacha, odds: ODDS, featured: featuredType(now), featuredBoost: FEATURED_BOOST, until: weekEnds(now), tiers: Object.fromEntries(TIER_ORDER.map((k) => [k, BY_TIER[k].length])) };
}

function pull(u, p) {
  if (u.npc) throw new Error('Los comerciantes NPC no tiran en el Gacha de MT.');
  const count = Number(p.count);
  if (!COST[count]) throw new Error('Cantidad no válida.');
  const d = day(u);
  if (d.gacha + count > DAILY_LIMIT) throw new Error(`Límite diario del Gacha de MT: ${DAILY_LIMIT} tiradas (te quedan ${DAILY_LIMIT - d.gacha}).`);
  const cost = COST[count];
  if (u.coins < cost) throw new Error(`Necesitas ${cost} monedas.`);
  u.coins -= cost;
  hub.ledger(u, -cost, 'tm_gacha', `×${count}`);
  d.gacha += count;
  const feat = featuredType();
  const results = [];
  for (let i = 0; i < count; i++) {
    const t = rollTm(feat);
    items.give(u, t.id, 1);
    results.push({ id: t.id, move: t.move, num: t.num, type: t.type, tier: t.tier, featured: t.type === feat });
  }
  hub.track(u, 'tm_gacha', { count });
  db.save();
  return { results, cost, left: DAILY_LIMIT - d.gacha };
}

module.exports = { COST, DAILY_LIMIT, FEATURED_BOOST, ODDS, TIER_ORDER, TYPES, BY_TIER, featuredType, weekEnds, expectedCraftCoins, rollTier, rollTm, info, pull };

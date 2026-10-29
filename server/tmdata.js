'use strict';
// Datos puros de las MT (máquinas de movimientos) y de los materiales con los que se fabrican. Sin lógica de jugador:
// lo usan items.js (para crear los objetos), tm.js (fabricar y usar) y el cliente (a través de los objetos).
//  - MT = las 229 de Escarlata/Púrpura, con su numeración oficial (MT001…MT229, machines.csv de PokeAPI).
//  - Coste en monedas por nivel de potencia + materiales del tipo del movimiento (ver docs/BALANCE.md).
const LS = require('./learnsets.json');
const ES = require('./sd-es.json');

// Materiales: 9 familias que cubren los 18 tipos. Se consiguen en Expediciones y combates (nunca se compran).
const MATERIALS = {
  'mat-escama': { name: 'Escama', sprite: 'dragon-scale', types: ['water', 'ice', 'dragon'] },
  'mat-pluma': { name: 'Pluma', sprite: 'pretty-wing', types: ['flying', 'normal'] },
  'mat-garra': { name: 'Garra', sprite: 'razor-claw', types: ['fighting', 'dark'] },
  'mat-polvo': { name: 'Polvo de Hada', sprite: 'fairy-feather', types: ['fairy', 'psychic'] },
  'mat-hoja': { name: 'Hoja', sprite: 'miracle-seed', types: ['grass', 'bug'] },
  'mat-chispa': { name: 'Chispa', sprite: 'magnet', types: ['electric', 'steel'] },
  'mat-ascua': { name: 'Ascua', sprite: 'charcoal', types: ['fire'] },
  'mat-roca': { name: 'Fragmento de Roca', sprite: 'hard-stone', types: ['rock', 'ground'] },
  'mat-esencia': { name: 'Esencia Espectral', sprite: 'spell-tag', types: ['ghost', 'poison'] },
};
const MAT_OF_TYPE = {};
for (const [id, m] of Object.entries(MATERIALS)) for (const t of m.types) MAT_OF_TYPE[t] = id;
for (const [id, m] of Object.entries(MATERIALS)) m.desc = `Material de MT (${m.types.length} tipos). Se consigue en Expediciones y ganando combates; se gasta en la Máquina MT. No se puede vender a los PNJ.`;

// Niveles de precio: monedas y nº de materiales del tipo del movimiento.
const TIERS = {
  basic: { coins: 500, mats: 3, label: 'Básica' },
  good: { coins: 1500, mats: 4, label: 'Buena' },
  strong: { coins: 4000, mats: 6, label: 'Fuerte' },
  top: { coins: 6000, mats: 7, label: 'Élite' },
  apex: { coins: 8000, mats: 8, label: 'Suprema' },
};
const APEX = new Set(['earthquake', 'psychic', 'thunderbolt', 'flamethrower', 'surf', 'shadowball', 'icebeam']);
const PREMIUM_STATUS = new Set(['swordsdance', 'nastyplot', 'calmmind', 'dragondance', 'bulkup', 'trickroom', 'stealthrock', 'willowisp', 'thunderwave', 'toxic', 'substitute', 'tailwind',
  'rest', 'irondefense', 'agility', 'taunt', 'encore', 'haze', 'spikes', 'toxicspikes', 'reflect', 'lightscreen', 'helpinghand', 'protect']);

function tierOf(move, meta) {
  const bp = meta[2];
  if (APEX.has(move)) return 'apex';
  if (meta[1] === 'x') return PREMIUM_STATUS.has(move) ? 'good' : 'basic';
  if (bp >= 120) return 'top';
  if (bp >= 90) return 'strong';
  if (bp >= 60) return 'good';
  return 'basic';
}

const pad = (n) => String(n).padStart(3, '0');
// [{ num, move, id: 'tm-<move>', name: 'MT024 Rayo', type, tier, coins, mat, matN }] por número.
const TMS = Object.entries(LS.tm).sort((a, b) => a[1] - b[1]).map(([move, num]) => {
  const meta = ES.meta[move];
  const type = meta[0];
  const tier = tierOf(move, meta);
  return { num, move, id: 'tm-' + move, name: `MT${pad(num)} ${ES.moves[move]}`, type, tier, coins: TIERS[tier].coins, mat: MAT_OF_TYPE[type], matN: TIERS[tier].mats };
});
const TM_BY_MOVE = new Map(TMS.map((t) => [t.move, t]));
const TM_BY_ID = new Map(TMS.map((t) => [t.id, t]));

module.exports = { MATERIALS, MAT_OF_TYPE, TIERS, TMS, TM_BY_MOVE, TM_BY_ID, APEX, PREMIUM_STATUS };

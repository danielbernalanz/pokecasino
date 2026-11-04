'use strict';
// Entrenamiento Extremo (Escarlata/Púrpura). Con una Chapa de Botella un Pokémon de nivel 50 o más tiene UN IV «efectivo» a 31 en combate; con la
// Chapa Dorada, los seis. Los IV reales NO cambian (`m.ivs`): el Criadero hereda los reales y las estadísticas/combates usan los efectivos
// (`effIvs`). `m.hyper = [bool × 6]` marca qué estadísticas están entrenadas. No se puede deshacer; una estadística con IV 31 no admite chapa.
// Las Chapas solo se consiguen con Puntos de Batalla (Tienda de Combate), Torre Batalla y Liga: nunca con monedas.
const db = require('./db');
const hub = require('./hub');
const { BY_ID } = require('./pokedex');

const MIN_LEVEL = 50;
const BOTTLE = 'bottle-cap';
const GOLD = 'gold-bottle-cap';
const BOTTLE_BP = 40;
const GOLD_BP = 200;
const NAMES = ['PS', 'Ataque', 'Defensa', 'At. Esp.', 'Def. Esp.', 'Velocidad'];

function buildItems() {
  return {
    [BOTTLE]: { name: 'Chapa de Botella', sprite: 'bottle-cap', price: null, bp: BOTTLE_BP, hyper: 1, cat: 'hyper',
      desc: `Entrenamiento Extremo: pone UN IV efectivo a 31 en combate (a elegir) en un Pokémon de nivel ${MIN_LEVEL} o más. Los IV reales no cambian, así que el Criadero sigue heredando los de siempre. Se compra con Puntos de Batalla (${BOTTLE_BP} PB) y cae de la Torre y la Liga.` },
    [GOLD]: { name: 'Chapa Dorada', sprite: 'gold-bottle-cap', price: null, bp: GOLD_BP, hyper: 6, cat: 'hyper',
      desc: `Entrenamiento Extremo: pone los SEIS IV efectivos a 31 en combate en un Pokémon de nivel ${MIN_LEVEL} o más. Se compra con Puntos de Batalla (${GOLD_BP} PB) y cae de la Torre y la Liga.` },
  };
}

const hyperOf = (m) => (Array.isArray(m.hyper) && m.hyper.length === 6 ? m.hyper : null);
// IV efectivos (los reales, con 31 en las estadísticas entrenadas).
const effIvs = (m) => { const h = hyperOf(m); return m.ivs.map((v, i) => (h && h[i] ? 31 : v)); };
const trained = (m) => { const h = hyperOf(m); return h ? h.filter(Boolean).length : 0; };

function use(u, p) {
  const specimen = require('./specimen');
  const items = require('./items');
  const itemId = String(p.itemId);
  if (itemId !== BOTTLE && itemId !== GOLD) throw new Error('Ese objeto no se usa así.');
  if (!(u.items[itemId] > 0)) throw new Error(`No tienes ${items.ITEMS[itemId].name}.`);
  const id = Number(p.id);
  const m = specimen.find(u, p);
  const name = m.nick || BY_ID.get(id).name;
  specimen.assertFree(m, name);
  if (m.level < MIN_LEVEL) throw new Error(`${name} necesita nivel ${MIN_LEVEL} o más para el Entrenamiento Extremo (ahora ${m.level}).`);
  const h = (m.hyper = hyperOf(m) || [false, false, false, false, false, false]);
  const open = (i) => !h[i] && m.ivs[i] < 31;
  let stats;
  if (itemId === BOTTLE) {
    const stat = Number(p.stat);
    if (!Number.isInteger(stat) || stat < 0 || stat > 5) throw new Error('Elige una estadística.');
    if (h[stat]) throw new Error(`${NAMES[stat]} ya tiene el Entrenamiento Extremo.`);
    if (m.ivs[stat] >= 31) throw new Error(`${NAMES[stat]} ya tiene IV 31: no hace falta.`);
    stats = [stat];
  } else {
    stats = [0, 1, 2, 3, 4, 5].filter(open);
    if (!stats.length) throw new Error('Todas sus estadísticas ya están a 31 (o entrenadas): la Chapa Dorada no haría nada.');
  }
  items.take(u, itemId, 1);
  for (const i of stats) h[i] = true;
  hub.track(u, 'item_use', { itemId });
  db.save();
  return { hyper: h.slice(), stats, eff: effIvs(m) };
}

const STATIC = { minLevel: MIN_LEVEL, bottle: BOTTLE, gold: GOLD, bottleBp: BOTTLE_BP, goldBp: GOLD_BP };
module.exports = { MIN_LEVEL, BOTTLE, GOLD, BOTTLE_BP, GOLD_BP, STATIC, buildItems, hyperOf, effIvs, trained, use };

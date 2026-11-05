'use strict';
// Puntos de esfuerzo (EVs), como en los juegos: `m.evs = [hp, atk, def, spa, spd, spe]`, máx. 252 por estadística y 510 en total.
// Se entrenan con Expediciones (la estadística de la zona), victorias contra la CPU (la estadística más alta del rival),
// vitaminas (+10, Tienda Poké) y se bajan con bayas (−10). Los conjuntos de Showdown usan los EVs reales (ver sdmap.js).
//
// Migración: los ejemplares anteriores a este sistema no tienen `evs`; la primera vez que se leen reciben 84 en cada
// estadística (504 en total), que es lo que usaban los combates hasta ahora: sus estadísticas de combate no cambian.
// Los ejemplares nuevos (`specimen.make`) empiezan en 0.
//
// Ningún camino crea monedas: las vitaminas y las bayas cuestan monedas (sumidero) y las fuentes gratuitas tienen tope diario
// por ejemplar (`CAPS`). Los EVs solo valen para combatir; no tienen valor en el Mercado ni con los NPC.
const db = require('./db');
const hub = require('./hub');

const STAT = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const NAMES = ['PS', 'Ataque', 'Defensa', 'At. Esp.', 'Def. Esp.', 'Velocidad'];
const MAX_STAT = 252;
const MAX_TOTAL = 510;
const LEGACY = 84; // lo que valían todos los EVs antes de este sistema
const VITAMIN_EV = 10;
const BERRY_EV = 10;
const VITAMIN_PRICE = 1000;
const BERRY_PRICE = 300;
const EXP_PER_HOUR = 4; // por participante y hora
const KO_EV = 4; // por rival derrotado, en su estadística base más alta
// Topes diarios por ejemplar y fuente (las vitaminas no tienen tope diario: cuestan monedas).
const CAPS = { exp: 60, bat: 48 };

// [id del objeto, nombre, sprite de PokeAPI, estadística]
const VITAMINS = [
  ['vit-hp', 'Más PS', 'hp-up', 0], ['vit-atk', 'Proteína', 'protein', 1], ['vit-def', 'Hierro', 'iron', 2],
  ['vit-spa', 'Calcio', 'calcium', 3], ['vit-spd', 'Zinc', 'zinc', 4], ['vit-spe', 'Carburante', 'carbos', 5],
];
const EV_BERRIES = [
  ['evb-hp', 'Baya Grana', 'pomeg-berry', 0], ['evb-atk', 'Baya Algama', 'kelpsy-berry', 1], ['evb-def', 'Baya Ispero', 'qualot-berry', 2],
  ['evb-spa', 'Baya Meluce', 'hondew-berry', 3], ['evb-spd', 'Baya Uvav', 'grepa-berry', 4], ['evb-spe', 'Baya Tamate', 'tamato-berry', 5],
];

// Entradas de `items.ITEMS`.
function buildItems() {
  const out = {};
  for (const [id, name, sprite, stat] of VITAMINS) {
    out[id] = { name, sprite, price: VITAMIN_PRICE, ev: { stat, add: VITAMIN_EV }, cat: 'vitamin',
      desc: `Da +${VITAMIN_EV} EV de ${NAMES[stat]} a un Pokémon (hasta ${MAX_STAT} en esa estadística y ${MAX_TOTAL} en total). Se usa en Caja PC → Datos → Entrenar.` };
  }
  for (const [id, name, sprite, stat] of EV_BERRIES) {
    out[id] = { name, sprite, price: BERRY_PRICE, ev: { stat, add: -BERRY_EV }, cat: 'evberry',
      desc: `Quita ${BERRY_EV} EV de ${NAMES[stat]} a un Pokémon para recolocar su entrenamiento. Se usa en Caja PC → Datos → Entrenar.` };
  }
  return out;
}

const clampInt = (v, hi) => Math.max(0, Math.min(hi, Number.isInteger(v) ? v : 0));
// EVs del ejemplar (los crea en 84 si es anterior al sistema) y los mantiene válidos.
function ensure(m) {
  if (!Array.isArray(m.evs) || m.evs.length !== 6) m.evs = new Array(6).fill(LEGACY);
  let total = 0;
  for (let i = 0; i < 6; i++) {
    m.evs[i] = Math.min(clampInt(m.evs[i], MAX_STAT), MAX_TOTAL - total);
    total += m.evs[i];
  }
  return m.evs;
}
const total = (m) => ensure(m).reduce((a, b) => a + b, 0);

// Suma EVs en una estadística respetando los topes de estadística y total. Devuelve lo que se sumó.
function add(m, stat, n) {
  const e = ensure(m);
  const g = Math.max(0, Math.min(n, MAX_STAT - e[stat], MAX_TOTAL - total(m)));
  e[stat] += g;
  return g;
}
// Igual, pero además con el tope diario de esa fuente ('exp' | 'bat') por ejemplar.
function gain(m, stat, n, kind) {
  const k = hub.dayKey();
  if (!m.evd || m.evd.day !== k) m.evd = { day: k, exp: 0, bat: 0 };
  const base = Math.max(0, Math.min(n, CAPS[kind] - (m.evd[kind] || 0)));
  const g = add(m, stat, base * require('./pokerus').evMult(m)); // Pokérus: el doble de EVs (el tope diario cuenta lo «base»)
  m.evd[kind] = (m.evd[kind] || 0) + Math.min(base, g);
  return g;
}

// Estadística base más alta de una especie (la primera si hay empate).
function topStat(stats) {
  let best = 0;
  for (let i = 1; i < 6; i++) if (stats[i] > stats[best]) best = i;
  return best;
}
// Victoria contra la CPU: cada participante recibe +4 EV por rival derrotado en su estadística más alta.
function onWin(m, foeStats) {
  const per = [0, 0, 0, 0, 0, 0];
  for (const st of foeStats) per[topStat(st)] += KO_EV;
  let got = 0;
  for (let i = 0; i < 6; i++) if (per[i]) got += gain(m, i, per[i], 'bat');
  return got;
}

// `pc:ev`: usa una vitamina (+10) o una baya (−10) sobre un ejemplar. `qty` (1–26) repite mientras sirva.
function use(u, p) {
  const specimen = require('./specimen');
  const items = require('./items');
  const itemId = String(p.itemId);
  const it = items.ITEMS[itemId];
  if (!it || !it.ev) throw new Error('Ese objeto no se usa así.');
  const qty = p.qty === undefined ? 1 : Number(p.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 26) throw new Error('Cantidad no válida.');
  if (!(u.items[itemId] > 0)) throw new Error('No tienes ese objeto.');
  const m = specimen.find(u, p);
  const e = ensure(m);
  const stat = it.ev.stat;
  let used = 0;
  let delta = 0;
  while (used < qty && (u.items[itemId] || 0) > used) {
    if (it.ev.add > 0) {
      if (e[stat] >= MAX_STAT) { if (!used) throw new Error(`${NAMES[stat]} ya está al máximo (${MAX_STAT} EV).`); break; }
      if (total(m) >= MAX_TOTAL) { if (!used) throw new Error(`Ya tiene el máximo de ${MAX_TOTAL} EV en total: quita alguno con una baya.`); break; }
      delta += add(m, stat, it.ev.add);
    } else {
      if (e[stat] <= 0) { if (!used) throw new Error(`No tiene EV de ${NAMES[stat]} que quitar.`); break; }
      const g = Math.min(-it.ev.add, e[stat]);
      e[stat] -= g;
      delta -= g;
    }
    used++;
  }
  items.take(u, itemId, used);
  hub.track(u, 'item_use', { itemId });
  db.save();
  return { evs: e.slice(), total: total(m), used, delta, stat };
}

const STATIC = { max: MAX_STAT, total: MAX_TOTAL, names: NAMES, caps: CAPS, expPerHour: EXP_PER_HOUR, ko: KO_EV, vitamin: VITAMIN_EV, berry: BERRY_EV };

module.exports = { STAT, NAMES, MAX_STAT, MAX_TOTAL, LEGACY, VITAMIN_EV, BERRY_EV, VITAMIN_PRICE, BERRY_PRICE, EXP_PER_HOUR, KO_EV, CAPS, VITAMINS, EV_BERRIES, STATIC, buildItems, ensure, total, add, gain, topStat, onWin, use };

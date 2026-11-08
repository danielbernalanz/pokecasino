'use strict';
// Dinero y hallazgos de los combates contra entrenadores CPU, como en los juegos:
//  - PREMIO EN METÁLICO: la «clase» del entrenador (`pay`, ver trainers.js: Jovencito ×16 … Líder de Gimnasio ×100) por el nivel MÁS ALTO de su
//    equipo. Se paga en monedas con el MISMO tope diario de antes (trainers.COINS_DAY = 800): el premio real manda en cada combate, pero el total
//    del día no puede subir. Con tope, nada de esto crea monedas por encima de lo que ya se podía ganar.
//  - MONEDA AMULETO (objeto equipado): si algún participante del combate la lleva, el premio (y el Día de Pago) se duplican. El tope diario sigue siendo el mismo.
//  - DÍA DE PAGO: cada uso que acierta esparce 5 × el nivel de quien lo usa; se recoge al ganar el combate y cuenta para el mismo tope diario.
//    Se cuenta a partir del registro del combate (las líneas `|move|p1a: …|Pay Day|`), así que es determinista.
//  - RECOGIDA (habilidad): tras cada victoria, cada Pokémon del equipo con Recogida tiene un 10 % de encontrar un objeto (tabla por nivel), con tope de 5 al día.
const { weighted, rand } = require('./rng');

const AMULET_COIN = 'amuletcoin'; // objeto equipable (Tienda de Combate): hi-amuletcoin
const PAYDAY_PER_LEVEL = 5;
const PICKUP_CHANCE = 0.10;
const PICKUP_DAY = 5;

const holdsAmulet = (m) => !!m && m.item === AMULET_COIN;

// Premio base: clase × nivel más alto del equipo rival.
function prizeMoney(trainer, foeLevels) {
  const pay = trainer && trainer.pay ? trainer.pay : ({ 1: 16, 2: 20, 3: 24, 4: 36, 5: 100, 6: 100 }[trainer && trainer.tier] || 16);
  const top = Math.max(1, ...foeLevels.map((l) => Number(l) || 1));
  return { pay, level: top, coins: pay * top };
}

// Usos de Día de Pago del jugador (lado p1) que han acertado, a partir de su registro. Devuelve { uses, coins, by: { nombre: usos } }.
function payDay(log, roster) {
  const lv = new Map((roster || []).map((r) => [r.name, Number(r.level) || 1]));
  const by = {};
  let coins = 0;
  let uses = 0;
  const lines = Array.isArray(log) ? log : [];
  let pending = null; // el último uso, hasta saber si falló
  const settle = () => {
    if (!pending) return;
    by[pending.name] = (by[pending.name] || 0) + 1;
    uses++;
    coins += PAYDAY_PER_LEVEL * pending.level;
    pending = null;
  };
  for (const line of lines) {
    if (typeof line !== 'string' || line[0] !== '|') continue;
    const p = line.split('|');
    const cmd = p[1];
    if (cmd === 'move' || cmd === 'turn' || cmd === 'switch' || cmd === 'drag' || cmd === 'faint' || cmd === 'win') {
      settle();
      if (cmd === 'move' && p[3] === 'Pay Day' && /^p1[a-c]?: /.test(p[2]) && !line.includes('[miss]') && !line.includes('[notarget]')) {
        const name = p[2].replace(/^p1[a-c]?: /, '');
        pending = { name, level: lv.get(name) || 1 };
      }
    } else if (pending && (cmd === '-miss' || cmd === '-fail' || cmd === '-immune' || cmd === '-notarget' || cmd === 'cant')) {
      pending = null; // falló: no hay monedas
    }
  }
  settle();
  return { uses, coins, by };
}

// Tabla de la Recogida por nivel (pesos). Tipos: 'berry' (Huerto), 'item' (mochila), 'exp' (Caramelo Exp.), 'stone' (piedra de evolución al azar).
const TABLE = [
  [24, [['berry', 'berry-aranja', 30], ['berry', 'berry-zidra', 15], ['berry', 'berry-frambu', 15], ['berry', 'berry-latano', 10], ['exp', 'exp-xs', 25], ['item', 'lucky-egg', 2], ['stone', '', 3]]],
  [49, [['berry', 'berry-aranja', 15], ['berry', 'berry-zidra', 20], ['berry', 'berry-frambu', 15], ['berry', 'berry-latano', 10], ['berry', 'berry-pinia', 5], ['exp', 'exp-xs', 25], ['exp', 'exp-s', 5], ['item', 'lucky-egg', 2], ['stone', '', 3]]],
  [74, [['berry', 'berry-zidra', 10], ['berry', 'berry-frambu', 10], ['berry', 'berry-latano', 15], ['berry', 'berry-pinia', 10], ['exp', 'exp-xs', 25], ['exp', 'exp-s', 20], ['item', 'lucky-egg', 3], ['stone', '', 5], ['item', 'rare-candy', 1]]],
  [100, [['berry', 'berry-latano', 10], ['berry', 'berry-pinia', 15], ['exp', 'exp-xs', 20], ['exp', 'exp-s', 30], ['item', 'lucky-egg', 3], ['stone', '', 6], ['item', 'rare-candy', 2]]],
];
const tableFor = (level) => (TABLE.find(([max]) => level <= max) || TABLE[TABLE.length - 1])[1];

// Una tirada de Recogida por Pokémon con la habilidad. `d`: estado del día del jugador (`d.pick`). Devuelve [{ name, kind, id, qty }].
function rollPickup(user, mons, d, rng = rand) {
  const out = [];
  const items = require('./items');
  for (const { name, level } of mons) {
    if ((d.pick || 0) >= PICKUP_DAY) break;
    if (rng() >= PICKUP_CHANCE) continue;
    const [kind, id0] = weighted(tableFor(level), (x) => x[2]);
    let id = id0;
    if (kind === 'stone') { const st = require('./evoreq').STONES; id = st[Math.floor(rng() * st.length) % st.length]; }
    if (kind === 'berry') require('./bond').giveBerry(user, id, 1);
    else if (kind === 'exp') require('./candy').giveExp(user, id, 1);
    else user.items[id] = (user.items[id] || 0) + 1;
    d.pick = (d.pick || 0) + 1;
    out.push({ name, kind: kind === 'berry' ? 'berry' : 'item', id, qty: 1, label: kind === 'berry' ? items.BERRIES[id].name : items.ITEMS[id].name });
  }
  return out;
}

module.exports = { AMULET_COIN, PAYDAY_PER_LEVEL, PICKUP_CHANCE, PICKUP_DAY, TABLE, holdsAmulet, prizeMoney, payDay, tableFor, rollPickup };

'use strict';
// Evoluciones como en los juegos (ver scripts/build-evo.js y server/evodata.json): nivel mínimo (`levelOf`) y requisitos especiales. Ya no cuestan caramelos:
//   item (piedra u objeto: se gasta 1) · trade («Intercambio»: se gasta un Cordón Unión o un intercambio real pendiente) ·
//   gender (el destino es de un solo sexo: Gallade ♂, Froslass ♀…) · time (de día / de noche, hora de España) ·
//   stat (Hitmonlee/Hitmonchan/Hitmontop: Ataque frente a Defensa) · move (debe conocer ese movimiento).
// Objetos: piedras 2.000 monedas, objetos raros 5.000 y Cordón Unión 1.500 en la Tienda Poké; también caen, poco a poco, en las
// Expediciones largas. Se comercian entre jugadores, pero los PNJ no los compran ni los reciclan (son botín gratuito: ver npc.js y candy.js).
// Intercambio real: cada Pokémon que RECIBES de otro jugador (regalo o Mercado) te da un «intercambio pendiente» (máx. 3 guardados y
// 2 nuevos al día) que sirve igual que un Cordón Unión.
const EVODATA = require('./evodata.json');
const DATA = EVODATA.req;
const LVL = EVODATA.lvl || {}; // destino → nivel mínimo (scripts/build-evo.js)
const LU = new Set(EVODATA.lu || []); // evoluciones «al subir de nivel»: las que se ofrecen con el aviso «¿Quieres que evolucione?»
const daytime = require('./daytime');
const eggroups = require('./eggroups');
const { BY_ID } = require('./pokedex');

const STONE = 2000;
const RARE = 5000;
const CORD = 1500;
const TOKEN_MAX = 3;
const TOKEN_DAILY = 2;
// [id, nombre, sprite de PokeAPI, precio]
const CATALOG = [
  ['fire-stone', 'Piedra Fuego', 'fire-stone', STONE], ['water-stone', 'Piedra Agua', 'water-stone', STONE], ['thunder-stone', 'Piedra Trueno', 'thunder-stone', STONE],
  ['leaf-stone', 'Piedra Hoja', 'leaf-stone', STONE], ['moon-stone', 'Piedra Lunar', 'moon-stone', STONE], ['sun-stone', 'Piedra Solar', 'sun-stone', STONE],
  ['shiny-stone', 'Piedra Día', 'shiny-stone', STONE], ['dusk-stone', 'Piedra Noche', 'dusk-stone', STONE], ['dawn-stone', 'Piedra Alba', 'dawn-stone', STONE], ['ice-stone', 'Piedra Hielo', 'ice-stone', STONE],
  ['kings-rock', 'Roca del Rey', 'kings-rock', RARE], ['metal-coat', 'Revestimiento Metálico', 'metal-coat', RARE], ['dragon-scale', 'Escama Dragón', 'dragon-scale', RARE],
  ['up-grade', 'Mejora', 'up-grade', RARE], ['prism-scale', 'Escama Bella', 'prism-scale', RARE], ['deep-sea-tooth', 'Diente Marino', 'deep-sea-tooth', RARE],
  ['deep-sea-scale', 'Escama Marina', 'deep-sea-scale', RARE], ['protector', 'Protector', 'protector', RARE], ['electirizer', 'Electrizador', 'electirizer', RARE],
  ['magmarizer', 'Magmatizador', 'magmarizer', RARE], ['dubious-disc', 'Disco Extraño', 'dubious-disc', RARE], ['reaper-cloth', 'Tela Terrible', 'reaper-cloth', RARE],
  ['sachet', 'Saquito Fragante', 'sachet', RARE], ['whipped-dream', 'Nata Montada', 'whipped-dream', RARE], ['oval-stone', 'Piedra Oval', 'oval-stone', RARE],
  ['razor-claw', 'Garra Afilada', 'razor-claw', RARE], ['razor-fang', 'Colmillo Afilado', 'razor-fang', RARE], ['tart-apple', 'Manzana Ácida', 'tart-apple', RARE],
  ['sweet-apple', 'Manzana Dulce', 'sweet-apple', RARE], ['cracked-pot', 'Tetera Agrietada', 'cracked-pot', RARE], ['syrupy-apple', 'Manzana Melosa', 'syrupy-apple', RARE],
  ['unremarkable-teacup', 'Taza Mediocre', 'unremarkable-teacup', RARE], ['metal-alloy', 'Aleación Metálica', 'metal-alloy', RARE], ['black-augurite', 'Augurita Negra', 'black-augurite', RARE],
  ['auspicious-armor', 'Armadura Auspiciosa', 'auspicious-armor', RARE], ['malicious-armor', 'Armadura Maldita', 'malicious-armor', RARE],
];
const LINK = 'link-cord';
const STONES = CATALOG.filter((x) => x[3] === STONE).map((x) => x[0]);
const RARES = CATALOG.filter((x) => x[3] === RARE).map((x) => x[0]);

// Entradas de `items.ITEMS`.
function buildItems() {
  const out = {};
  for (const [id, name, sprite, price] of CATALOG) {
    const users = Object.entries(DATA).filter(([, r]) => r.item === id).map(([to]) => BY_ID.get(Number(to)).name);
    const held = HELDABLE.has(id) ? { holdId: holdIdOf(id) } : {};
    out[id] = { name, sprite, price, evo: true, cat: 'evo', ...held, desc: `Objeto de evolución: se gasta al evolucionar a ${users.join(', ')}. Se usa desde Caja PC → Datos → Entrenar → Evolución.${HELDABLE.has(id) ? ' También se puede llevar equipado (Caja PC → Datos → Objeto): al evolucionar —por intercambio en la GTS o con un compañero, o al subir de nivel— se gasta el equipado.' : ''}` };
  }
  out[LINK] = { name: 'Cordón Unión', sprite: 'linking-cord', price: CORD, evo: true, cat: 'evo',
    desc: 'Sustituye al intercambio en las evoluciones por intercambio (Kadabra, Machoke, Graveler, Haunter…). Se gasta al evolucionar. También vale un intercambio real: cada Pokémon que recibes de otro jugador te da un intercambio pendiente.' };
  return out;
}

// Objetos de evolución que también se LLEVAN equipados y se gastan al evolucionar (como en los juegos): los de «intercambio con objeto» (Revestimiento Metálico,
// Roca del Rey, Escama Dragón…) y los de «nivel con objeto» (Garra/Colmillo Afilado, Piedra Oval). Las piedras y demás objetos que se USAN siguen saliendo de la mochila.
const HELDABLE = new Set(Object.values(DATA).filter((r) => r.item && (r.trade || r.time)).map((r) => r.item));
const holdIdOf = (item) => String(item).replace(/-/g, ''); // id de Showdown: metal-coat → metalcoat
// Evoluciones por intercambio que en los juegos exigen intercambiar una especie por otra concreta: Karrablast ↔ Shelmet.
const TRADE_PAIR = { 589: 616, 617: 588 };
const reqOf = (to) => DATA[Number(to)] || null;
const levelOf = (to) => LVL[Number(to)] || 0;
const isLevelUp = (to) => LU.has(Number(to));
const tokensOf = (u) => Math.max(0, Math.min(TOKEN_MAX, Math.floor(u.tradeTokens || 0)));

// Un Pokémon recibido de otro jugador (regalo o Mercado) vale como un intercambio.
function noteTrade(receiver, giver, now = Date.now()) {
  if (!receiver || !giver || receiver.npc || giver.npc || receiver.id === giver.id) return 0;
  const d = new Date(now).toISOString().slice(0, 10);
  if (!receiver.tradeDay || receiver.tradeDay.d !== d) receiver.tradeDay = { d, n: 0 };
  if (receiver.tradeDay.n >= TOKEN_DAILY || tokensOf(receiver) >= TOKEN_MAX) return 0;
  receiver.tradeDay.n++;
  receiver.tradeTokens = tokensOf(receiver) + 1;
  return 1;
}

// Comprueba los requisitos especiales de `from → to` para el ejemplar `m` SIN tocar nada. Lanza un error en español si faltan;
// devuelve { consume() } que gasta lo necesario (llamar solo cuando todo lo demás ya está validado).
// `friend`: la evolución va por la vía de amistad (cuenta el horario de Espeon/Umbreon, pero no hay objeto que gastar).
function plan(u, m, from, to, now = Date.now(), opt = {}) {
  const r = reqOf(to);
  if (!r) return { consume() {}, uses: {} };
  const items = require('./items');
  const target = BY_ID.get(Number(to)).name;
  const miss = [];
  if (r.gender && eggroups.genderOf(from, m) !== r.gender) miss.push(r.gender === 'M' ? 'ser macho' : 'ser hembra');
  if (r.time && daytime.phase(now) !== r.time) miss.push(r.time === 'day' ? 'que sea de día (06:00–21:00, hora de España)' : 'que sea de noche (21:00–06:00, hora de España)');
  if (r.stat) {
    const st = require('./specimen').computeStats(Number(from), m);
    const ok = r.stat === 'atk>def' ? st[1] > st[2] : r.stat === 'atk<def' ? st[1] < st[2] : st[1] === st[2];
    if (!ok) miss.push(r.stat === 'atk>def' ? 'más Ataque que Defensa' : r.stat === 'atk<def' ? 'menos Ataque que Defensa' : 'Ataque igual a Defensa');
  }
  if (r.move) {
    require('./moves').ensure(Number(from), m);
    if (!m.learned.includes(r.move)) miss.push(`conocer ${require('./moves').name(r.move)}`);
  }
  const held = !!r.item && HELDABLE.has(r.item) && m.item === holdIdOf(r.item); // equipado: se gasta ese
  if (r.item && !held && (opt.auto || !(u.items[r.item] > 0))) miss.push(items.ITEMS[r.item].name + (opt.auto ? ' equipado' : ''));
  let via = null;
  if (r.trade && opt.auto) {
    // Intercambio real (GTS o directo): evoluciona al recibirlo; Karrablast y Shelmet solo entre sí.
    if (TRADE_PAIR[Number(to)] && TRADE_PAIR[Number(to)] !== Number(opt.partner)) miss.push(`intercambiarlo por ${BY_ID.get(TRADE_PAIR[Number(to)]).name}`);
    via = 'auto';
  } else if (r.trade) {
    if (tokensOf(u) > 0) via = 'token';
    else if ((u.items[LINK] || 0) > 0) via = 'cord';
    else miss.push('un Cordón Unión (o un intercambio con otro jugador)');
  }
  if (miss.length) throw new Error(`Para evolucionar a ${target} necesita: ${miss.join(', ')}.`);
  return {
    uses: { item: r.item || null, via },
    consume() {
      if (r.item) { if (held) delete m.item; else items.take(u, r.item, 1); }
      if (via === 'token') u.tradeTokens = tokensOf(u) - 1;
      else if (via === 'cord') items.take(u, LINK, 1);
    },
  };
}

const STATIC = { req: DATA, lvl: LVL, lu: [...LU], link: LINK, phase: daytime.STATIC, tokenMax: TOKEN_MAX, tokenDaily: TOKEN_DAILY };

module.exports = { HELDABLE, holdIdOf, TRADE_PAIR, DATA, levelOf, isLevelUp, CATALOG, STONES, RARES, LINK, STONE, RARE, CORD, TOKEN_MAX, TOKEN_DAILY, STATIC, buildItems, reqOf, tokensOf, noteTrade, plan };

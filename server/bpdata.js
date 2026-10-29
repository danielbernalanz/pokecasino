'use strict';
// Datos puros de la Tienda de Combate (Puntos de Batalla, PB): objetos equipables, mentas, cápsula y parche de habilidad.
// Como en los juegos, los PB solo se ganan combatiendo, no se transfieren ni se convierten en monedas (ver bp.js).
// Precios en PB: objetos 16–48 · mentas 50 · Cápsula Habilidad 50 · Parche Habilidad 200.
const ES = require('./sd-es.json');

// [id de Showdown, PB, sprite de PokeAPI]
const HELD = [
  ['leftovers', 48, 'leftovers'], ['lifeorb', 48, 'life-orb'], ['choiceband', 48, 'choice-band'], ['choicespecs', 48, 'choice-specs'], ['choicescarf', 48, 'choice-scarf'],
  ['assaultvest', 40, 'assault-vest'], ['eviolite', 40, 'eviolite'],
  ['focussash', 32, 'focus-sash'], ['rockyhelmet', 32, 'rocky-helmet'], ['blacksludge', 32, 'black-sludge'], ['weaknesspolicy', 32, 'weakness-policy'], ['expertbelt', 32, 'expert-belt'], ['heavydutyboots', 32, 'heavy-duty-boots'],
  ['whiteherb', 16, 'white-herb'], ['mentalherb', 16, 'mental-herb'], ['scopelens', 16, 'scope-lens'],
];
const HELD_DESC = {
  leftovers: 'Recupera 1/16 de los PS cada turno.', lifeorb: '+30 % de daño, pero pierde 1/10 de los PS al atacar.', choiceband: '+50 % de Ataque, pero solo usa un movimiento.',
  choicespecs: '+50 % de At. Esp., pero solo usa un movimiento.', choicescarf: '+50 % de Velocidad, pero solo usa un movimiento.', assaultvest: '+50 % de Def. Esp., pero no puede usar movimientos de estado.',
  eviolite: '+50 % de Defensa y Def. Esp. si aún puede evolucionar.', focussash: 'Aguanta un golpe mortal con 1 PS si tenía los PS completos (un solo uso).', rockyhelmet: 'Daña al rival que le ataca con contacto.',
  blacksludge: 'Restaura PS si es de tipo Veneno; hace daño a los demás.', weaknesspolicy: 'Sube el Ataque y At. Esp. al recibir un golpe supereficaz (un solo uso).',
  expertbelt: '+20 % de daño en los golpes supereficaces.', heavydutyboots: 'Ignora el daño de las trampas de entrada (Trampa Rocas, Púas…).', whiteherb: 'Restaura las estadísticas bajadas (un solo uso).',
  mentalherb: 'Cura el enamoramiento y otras trabas (un solo uso).', scopelens: 'Sube la probabilidad de golpe crítico.',
};
// Bayas del Huerto que también se llevan en combate (id del Huerto → objeto de Showdown).
const BERRY_HOLD = { 'berry-aranja': 'oranberry', 'berry-zidra': 'sitrusberry', 'berry-frambu': 'lumberry', 'berry-latano': 'chestoberry', 'berry-pinia': 'leppaberry' };
const BERRY_DESC = {
  oranberry: 'Recupera 10 PS cuando le quedan pocos (un solo uso).', sitrusberry: 'Recupera el 25 % de los PS cuando le quedan pocos (un solo uso).',
  lumberry: 'Cura cualquier problema de estado (un solo uso).', chestoberry: 'Despierta al Pokémon dormido (un solo uso).', leppaberry: 'Recupera 10 PP de un movimiento agotado (un solo uso).',
};

// [id inglés (sprite), nombre de la naturaleza] — 20 mentas que suben/bajan estadísticas + la Menta Seria (neutra).
const MINTS = [
  ['lonely', 'Huraña'], ['adamant', 'Firme'], ['naughty', 'Pícara'], ['brave', 'Audaz'], ['bold', 'Osada'], ['impish', 'Agitada'], ['lax', 'Floja'], ['relaxed', 'Plácida'],
  ['modest', 'Modesta'], ['mild', 'Afable'], ['rash', 'Alocada'], ['quiet', 'Mansa'], ['calm', 'Serena'], ['gentle', 'Amable'], ['careful', 'Cauta'], ['sassy', 'Grosera'],
  ['timid', 'Miedosa'], ['hasty', 'Activa'], ['jolly', 'Alegre'], ['naive', 'Ingenua'], ['serious', 'Seria'],
];
const PRICES = { mint: 50, capsule: 50, patch: 200 };
// Topes diarios de PB (por jugador).
const CAPS = { cpu: 30, pvp: 20 };
const CPU_BP = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 3 }; // por victoria contra la CPU según la fuerza del rival
const PVP_WIN = 3;
const PVP_LOSS = 1;
const PVP_MIN_TURNS = 3; // sin turnos suficientes no hay PB (evita regalar combates rendidos al instante)
const PVP_PER_OPPONENT = 3; // combates con PB contra el mismo rival al día

// Entradas de `items.ITEMS`.
function buildItems() {
  const out = {};
  for (const [hold, bp, sprite] of HELD) {
    out['hi-' + hold] = { name: ES.items[hold], sprite, price: null, bp, held: hold, desc: `Objeto equipable (uno por Pokémon). ${HELD_DESC[hold]} Se compra con Puntos de Batalla.` };
  }
  for (const [en, es] of MINTS) {
    out['mint-' + en] = { name: `Menta ${es}`, sprite: en + '-mint', price: null, bp: PRICES.mint, mint: es,
      desc: `Cambia el efecto de la naturaleza de un Pokémon a «${es}» (estadísticas); la naturaleza original sigue figurando. Se puede repetir con otra menta. Se compra con Puntos de Batalla.` };
  }
  out['ability-capsule'] = { name: 'Cápsula Habilidad', sprite: 'ability-capsule', price: null, bp: PRICES.capsule, capsule: true,
    desc: 'Cambia la habilidad de un Pokémon a la otra habilidad normal de su especie (si tiene dos y no tiene la oculta). Se compra con Puntos de Batalla.' };
  out['ability-patch'] = { name: 'Parche Habilidad', sprite: 'ability-patch', price: null, bp: PRICES.patch, patch: true,
    desc: 'Da a un Pokémon su habilidad oculta (si su especie la tiene). No se puede deshacer. Se compra con Puntos de Batalla.' };
  return out;
}

module.exports = { HELD, HELD_DESC, BERRY_HOLD, BERRY_DESC, MINTS, PRICES, CAPS, CPU_BP, PVP_WIN, PVP_LOSS, PVP_MIN_TURNS, PVP_PER_OPPONENT, buildItems };

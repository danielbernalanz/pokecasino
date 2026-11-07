'use strict';
// VALOR ESTIMADO de un artículo del Mercado: un dato INFORMATIVO para el jugador. Jamás se usa para los topes antiabuso
// (transfer.js), ni para los precios de los comerciantes NPC (esos salen de bounds() y reference() de npc.js), ni
// aparece como una operación: el «último precio» sigue siendo el real.
//
// estimate(ref) → { value, basis, pb? } o null:
//   · 'jugadores'    mediana de las operaciones recientes entre jugadores (≥ 3, de ≥ 2 vendedores, sin cuentas nuevas), acotada
//                    a [tope de compra, 1,25 × suelo de venta] del artículo: dos cuentas compinchadas no la suben más allá
//   · 'comerciantes' punto medio de [tope, suelo], desplazado por la escasez entre todos los NPC (poco stock → hacia el suelo)
//   · 'tienda'       precio de la tienda (objetos que se compran con monedas)
//   · 'fabricación'  coste de fabricar una MT en el Taller (monedas + materiales a su precio de venta)
//   · 'polvo'        polvo estelar al tipo de cambio
//   · 'PB'           Tienda de Combate: {value: null, pb} (los Puntos de Batalla no se convierten en monedas)
// Teralitos, Fragmentos del Tutor y Caramelos Exp. no tienen una base coherente en monedas: null.
// Los variocolores se valoran con sus propios límites (≥ 3 × el suelo normal, coherente con SHINY_ASK_DEFAULT).
const items = require('./items');
const gacha = require('./gacha');
const npc = () => require('./npc');
const market = require('./market');

const BAND_UP = 1.25; // la referencia de jugadores nunca pasa de 1,25 × el suelo
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const NONE = new Set(['tera', 'shard', 'expcandy']);

function estimate(ref) {
  let a;
  try { a = market.parseRef(typeof ref === 'string' ? parseKey(ref) : ref); } catch { return null; }
  const N = npc();
  const b = N.bounds(a);
  const cat = N.categoryOf(a);
  if (!b || !cat) return null;
  if (a.kind === 'dust') return { value: gacha.DUST_RATE, basis: 'polvo' };
  if (cat === 'bp') return { value: null, basis: 'PB', pb: items.ITEMS[a.itemId].bp };
  if (NONE.has(cat)) return null;
  if (cat === 'tm') {
    const it = items.ITEMS[a.itemId];
    const mats = Object.entries(it.craft[1] || {}).reduce((t, [id, n]) => t + n * N.bounds({ kind: 'item', itemId: id }).floor, 0);
    return fin(it.craft[0] + mats, 'fabricación');
  }
  if (cat === 'shop' || cat === 'ball' || cat === 'evo') return fin(items.ITEMS[a.itemId].price, 'tienda');
  const med = N.reference(a.ref);
  if (med != null) return fin(clamp(med, b.cap, Math.ceil(BAND_UP * b.floor)), 'jugadores');
  const total = N.totalHeld(a);
  const t = clamp(0.5 + 0.1 * (2 - total), 0.1, 0.9);
  return fin(b.cap + t * (b.floor - b.cap), 'comerciantes');
}
function fin(v, basis) {
  v = Math.round(v);
  return Number.isFinite(v) && v > 0 ? { value: v, basis } : null;
}
function parseKey(key) {
  const [k, x, y] = String(key).split(':');
  if (k === 'poke') return { kind: 'poke', pokeId: Number(x), shiny: y === '1' };
  if (k === 'item') return { kind: 'item', itemId: x };
  return { kind: k };
}

// Todos los artículos comerciables (mismos que cotizan los comerciantes), para el cliente y para las pruebas.
function allRefs() {
  const { DEX } = require('./pokedex');
  const out = [];
  for (const p of DEX) out.push(`poke:${p.id}:0`, `poke:${p.id}:1`);
  for (const id of Object.keys(items.ITEMS)) if (!items.ITEMS[id].key) out.push(`item:${id}`);
  out.push('dust');
  return out;
}
// Mapa ref → [valor|null, base, pb?] cacheado unos minutos: se pide una vez al abrir el Mercado.
let cache = null;
function all(now = Date.now()) {
  if (cache && now - cache.at < 5 * 60 * 1000) return cache.map;
  const map = {};
  for (const ref of allRefs()) {
    const e = estimate(ref);
    if (e) map[ref] = e.pb != null ? [null, e.basis, e.pb] : [e.value, e.basis];
  }
  cache = { at: now, map };
  return map;
}

// ---- Precio sugerido al crear una orden (solo una propuesta que el jugador puede cambiar) ----
const MAX_PRICE = 10_000_000;
const friendly = (v) => {
  const step = v < 50 ? 1 : v < 500 ? 5 : v < 5000 ? 10 : v < 50000 ? 50 : 100;
  return Math.max(1, Math.round(v / step) * step);
};
// side 'sell': mejor compra abierta si supera al valor estimado (se vende al instante); si hay una venta más barata, un poco por debajo
// de ella; si no, el valor estimado. side 'buy': la venta más barata si no supera al valor estimado (compra al instante) o el valor
// estimado. Respeta los límites del servidor y el tope de las cuentas nuevas (transfer.maxBuyPrice).
function suggest(user, payload) {
  const a = market.parseRef(payload);
  const side = payload.side === 'sell' ? 'sell' : 'buy';
  const est = estimate(a.ref);
  const v = est && est.value ? est.value : null;
  const others = db().data.market.orders.filter((o) => o.ref === a.ref && o.qty > 0 && o.userId !== user.id);
  const lowAsk = Math.min(Infinity, ...others.filter((o) => o.side === 'sell').map((o) => o.price));
  const topBid = Math.max(0, ...others.filter((o) => o.side === 'buy').map((o) => o.price));
  let price = null;
  let basis = null;
  if (side === 'sell') {
    if (topBid && (v == null || topBid >= v)) { price = topBid; basis = 'mejor compra'; }
    else if (lowAsk < Infinity && (v == null || lowAsk <= v)) { price = Math.max(1, lowAsk - Math.max(1, Math.round(lowAsk * 0.01))); basis = 'mejor venta'; }
    else if (v != null) { price = friendly(v); basis = 'valor estimado'; }
    else if (topBid) { price = topBid; basis = 'mejor compra'; }
    else if (lowAsk < Infinity) { price = lowAsk; basis = 'mejor venta'; }
  } else if (lowAsk < Infinity && (v == null || lowAsk <= v)) { price = lowAsk; basis = 'mejor venta'; }
  else if (v != null) { price = friendly(v); basis = 'valor estimado'; }
  else if (topBid) { price = topBid + 1; basis = 'mejor compra'; }
  else if (lowAsk < Infinity) { price = lowAsk; basis = 'mejor venta'; }
  let max = MAX_PRICE;
  if (side === 'buy') max = Math.min(max, require('./transfer').maxBuyPrice(user, a));
  if (price == null) return { price: null, basis: null, max: Number.isFinite(max) ? max : MAX_PRICE };
  const capped = Math.min(Math.max(1, Math.round(price)), max);
  return { price: capped, basis: capped < price ? 'tope de tu cuenta' : basis, max: Number.isFinite(max) ? max : MAX_PRICE };
}
const db = () => require('./db');
module.exports = { estimate, all, allRefs, suggest, BAND_UP };

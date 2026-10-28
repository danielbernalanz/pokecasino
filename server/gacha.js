'use strict';
// Gacha "Poké Ball Gacha": banners con destacados y variocolores. Sin pity: cada tirada es independiente
// y la única legendaria segura es la Master Ball (que además da el destacado del banner).
const db = require('./db');
const hub = require('./hub');
const { BY_ID, BY_RARITY, RARITY } = require('./pokedex');
const { rand, pick, weighted } = require('./rng');

const COST = { 1: 150, 10: 1350 };
const SHINY_RATE = 1 / 64;
// Regalos de un ×10 (probabilidad por sobre). Una Master Ball vale ≈17.000 monedas de tiradas (una destacada de un banner: 1 / (1,75 % × 50 %) = 114 tiradas): con 0,5 % el
// regalo devuelve ≈6 % de lo gastado en ×10, no el ≈60 % que devolvía con el 5 % anterior.
const X10_GIFTS = { 'master-ball': 0.005, 'shiny-charm': 0.05, 'mystery-egg': 0.2 };
// Probabilidades por tirada (sin pity). Una legendaria o mítica cada 50 tiradas (7.500 monedas) y una concreta
// de un banner con 3 destacadas cada ≈343 (51.000 monedas ≈ 3-4 semanas de ingresos de un jugador casual).
const RATES = { C: 0.496, U: 0.283, R: 0.15, E: 0.051, L: 0.0175, M: 0.0025 };

const BANNERS = [
  {
    id: 'kanto', name: 'Gran Banner Nacional', art: 25, theme: '#e3350d',
    desc: 'Los 1.025 Pokémon de todas las regiones, sin destacados. Ideal para completar la Pokédex.',
    featuredL: [], featuredE: [],
  },
  {
    id: 'aves', name: 'Alas Legendarias', art: 145, theme: '#3b82f6',
    desc: 'Articuno, Zapdos y Moltres con probabilidad aumentada. Charizard, Dragonite y Aerodactyl destacados.',
    featuredL: [144, 145, 146], featuredE: [6, 149, 142],
  },
  {
    id: 'psi', name: 'Laboratorio Psíquico', art: 150, theme: '#a855f7',
    desc: 'Mewtwo destacado y probabilidad doble de Mew. Alakazam y Gengar destacados.',
    featuredL: [150], featuredE: [65, 94], mythicBoost: 2,
  },
  {
    id: 'johto', name: 'Leyendas de Johto', art: 249, theme: '#f59e0b',
    desc: 'Lugia, Ho-Oh y las bestias legendarias. Tyranitar y Scizor destacados.',
    featuredL: [243, 244, 245, 249, 250], featuredE: [248, 212],
  },
  {
    id: 'hoenn', name: 'Leyendas de Hoenn', art: 282, theme: '#10b981',
    desc: 'Kyogre, Groudon y Rayquaza destacados. Gardevoir, Gallade, Blaziken y Salamence con probabilidad aumentada.',
    featuredL: [382, 383, 384], featuredE: [282, 475, 257, 373],
  },
  {
    id: 'sinnoh', name: 'Leyendas de Sinnoh', art: 487, theme: '#64748b',
    desc: 'Dialga, Palkia y Giratina destacados. Garchomp y Lucario con probabilidad aumentada.',
    featuredL: [483, 484, 487], featuredE: [445, 448],
  },
  {
    id: 'unova', name: 'Leyendas de Teselia', art: 644, theme: '#0ea5e9',
    desc: 'Reshiram, Zekrom y Kyurem destacados. Hydreigon y Volcarona con probabilidad aumentada.',
    featuredL: [643, 644, 646], featuredE: [635, 637],
  },
  {
    id: 'kalos', name: 'Leyendas de Kalos', art: 658, theme: '#2563eb',
    desc: 'Xerneas, Yveltal y Zygarde destacados. Greninja y Goodra con probabilidad aumentada.',
    featuredL: [716, 717, 718], featuredE: [658, 706],
  },
  {
    id: 'alola', name: 'Leyendas de Alola', art: 791, theme: '#f97316',
    desc: 'Solgaleo, Lunala y Necrozma destacados. Decidueye y Kommo-o con probabilidad aumentada.',
    featuredL: [791, 792, 800], featuredE: [724, 784],
  },
  {
    id: 'galar', name: 'Leyendas de Galar', art: 888, theme: '#be123c',
    desc: 'Zacian, Zamazenta y Eternatus destacados. Dragapult y Rillaboom con probabilidad aumentada.',
    featuredL: [888, 889, 890], featuredE: [887, 812],
  },
  {
    id: 'paldea', name: 'Leyendas de Paldea', art: 1008, theme: '#7c3aed',
    desc: 'Koraidon y Miraidon destacados. Baxcalibur y Meowscarada con probabilidad aumentada.',
    featuredL: [1007, 1008], featuredE: [998, 908],
  },
];
const BANNER_BY_ID = new Map(BANNERS.map((b) => [b.id, b]));
// ---- Rotación: banner permanente + un promocional que cambia cada 3 días ----
const PERMANENT = 'kanto';
const PROMOS = BANNERS.filter((b) => b.id !== PERMANENT);
const ROTATION_MS = 3 * 864e5;
const EPOCH = Date.parse('2026-10-26T23:00:00Z'); // lunes 00:00 en Madrid
const slot = (now) => Math.floor((now - EPOCH) / ROTATION_MS);
const promoAt = (n) => PROMOS[((n % PROMOS.length) + PROMOS.length) % PROMOS.length];

function activeBanners(now = Date.now()) {
  const n = slot(now);
  const next = promoAt(n + 1);
  return {
    permanent: BANNER_BY_ID.get(PERMANENT),
    promo: { ...promoAt(n), ends: EPOCH + (n + 1) * ROTATION_MS },
    next: { id: next.id, name: next.name, art: next.art, starts: EPOCH + (n + 1) * ROTATION_MS },
    now,
  };
}
// Versión ligera para el cliente (los datos completos de cada banner ya van en /api/static).
function bannersInfo(now = Date.now()) {
  const a = activeBanners(now);
  return { permanent: a.permanent.id, promo: a.promo.id, ends: a.promo.ends, next: a.next, now };
}

const RANK = { C: 0, U: 1, R: 2, E: 3, L: 4, M: 5 };

// Rareza de una tirada: cada una es independiente. `minRare` (último sobre de un ×10 sin raras) solo
// sortea entre Rara y Épica.
function rollRarity(banner, { minRare = false } = {}) {
  const mRate = RATES.M * (banner.mythicBoost || 1);
  if (!minRare && rand() < RATES.L + mRate) return rand() < mRate / (RATES.L + mRate) ? 'M' : 'L';
  return weighted(minRare ? ['R', 'E'] : ['C', 'U', 'R', 'E'], (k) => RATES[k]);
}

// Dentro de una rareza, las formas evolucionadas salen mucho menos que las básicas: la evolución
// (por caramelos, en una fase posterior) tiene que tener sentido. Legendarios y míticos no evolucionan.
const STAGE_WEIGHT = { 0: 1, 1: 1, 2: 0.25, 3: 0.06 };
const stageWeight = (p) => (p.rarity === 'L' || p.rarity === 'M' ? 1 : STAGE_WEIGHT[p.stage] ?? 1);
const weightCache = new WeakMap(); // lista → pesos acumulados
function pickByStage(list) {
  let cum = weightCache.get(list);
  if (!cum) {
    let t = 0;
    cum = list.map((p) => (t += stageWeight(p)));
    weightCache.set(list, cum);
  }
  const r = rand() * cum[cum.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] > r) hi = mid; else lo = mid + 1; }
  return list[lo];
}

function rollPokemon(rarity, banner, { masterBall = false } = {}) {
  const all = BY_RARITY[rarity];
  if (rarity === 'L' && banner.featuredL.length) {
    // 50 % destacado; con Master Ball, destacado seguro.
    const featured = masterBall || rand() < 0.5;
    const pool = all.filter((x) => banner.featuredL.includes(x.id) === featured);
    return pickByStage(pool.length ? pool : all);
  }
  if (rarity === 'E' && banner.featuredE.length && rand() < 0.5) {
    return BY_ID.get(pick(banner.featuredE));
  }
  return pickByStage(all);
}

// Añade un Pokémon a la colección. Más allá de 5 copias se convierte en polvo estelar.
// `unlock`: si la especie estaba con candado (ver locked.js), sus copias vuelven a la colección (solo desde el gacha).
function grant(user, id, shiny, { unlock = false } = {}) {
  const p = BY_ID.get(id);
  const unlocked = unlock && !!(user.locked && user.locked[id]);
  let back = 0;
  if (unlocked) back = require('./locked').restore(user, id);
  const c = (user.collection[id] ||= { n: 0, s: 0 });
  const isNew = c.n === 0;
  const newShiny = shiny && c.s === 0;
  let dust = back;
  if (c.n < 5) c.n++;
  else dust += RARITY[p.rarity].dust;
  if (shiny) {
    if (c.s < c.n) c.s++;
    else dust += RARITY[p.rarity].dust * 3;
  }
  user.dust += dust;
  return { isNew, newShiny, dust, stars: Math.min(5, c.n), ...(unlocked ? { unlocked: true } : {}) };
}

function pull(user, { banner: bannerId, count, free, ticket }) {
  const banner = BANNER_BY_ID.get(bannerId);
  if (!banner) throw new Error('Banner desconocido.');
  const act = activeBanners();
  if (banner.id !== act.permanent.id && banner.id !== act.promo.id) throw new Error('Ese banner ya no está disponible.');
  count = Number(count) === 10 ? 10 : 1;
  const today = new Date().toISOString().slice(0, 10);
  if (free) {
    if (count !== 1) throw new Error('La tirada gratis es individual.');
    if (user.daily.freePull === today) throw new Error('Ya usaste tu tirada gratis de hoy.');
    user.daily.freePull = today;
  } else if (ticket) {
    if ((user.items.ticket || 0) < count) throw new Error(`Necesitas ${count} Ticket(s) Gacha.`);
    user.items.ticket -= count;
    if (!user.items.ticket) delete user.items.ticket;
  } else {
    const cost = COST[count];
    if (user.coins < cost) throw new Error(`Necesitas ${cost} monedas.`);
    user.coins -= cost;
    hub.ledger(user, -cost, 'gacha', `×${count}`);
    require('./mega').onBet(user, cost, 'gacha', { play: false });
  }
  const results = [];
  for (let i = 0; i < count; i++) {
    let rarity;
    const masterBall = !!user.buffs.masterBall;
    if (masterBall) {
      // La Master Ball preparada asegura legendaria (la destacada, si el banner tiene).
      user.buffs.masterBall = false;
      rarity = 'L';
    } else {
      // Un sobre ×10 siempre trae al menos una Rara: si las 9 primeras no la tienen, la última sí.
      const minRare = count === 10 && i === 9 && !results.some((r) => RANK[r.rarity] >= 2);
      rarity = rollRarity(banner, { minRare });
    }
    const poke = rollPokemon(rarity, banner, { masterBall });
    const charm = user.buffs.shinyCharges > 0;
    if (charm) user.buffs.shinyCharges--;
    const shiny = rand() < SHINY_RATE * (charm ? 4 : 1) * (require('./events').has('shiny') ? 2 : 1);
    const g = grant(user, poke.id, shiny, { unlock: true });
    const candy = require('./candy').onPull(user, poke.id, g.isNew);
    results.push({ id: poke.id, name: poke.name, rarity, shiny, masterBall, candy, ...g });
    if (rarity === 'L' || rarity === 'M' || (shiny && rarity !== 'C')) {
      hub.feed('gacha', `✨ ${user.username} obtuvo ${shiny ? 'un ' + poke.name + ' VARIOCOLOR' : poke.name} (${RARITY[rarity].name}) en "${banner.name}"`, { pokeId: poke.id, shiny });
    }
  }
  user.stats.pulls += count;
  require('./locked').accrue(user);
  hub.addXp(user, count * 15);
  hub.track(user, 'pull', { count });
  // Las tiradas x10 pueden traer objetos de regalo.
  const bonus = [];
  if (count === 10) {
    for (const [it, p] of Object.entries(X10_GIFTS)) if (rand() < p) bonus.push(it);
    for (const it of bonus) user.items[it] = (user.items[it] || 0) + 1;
  }
  db.save();
  return { results, bonus };
}

// Tienda de polvo estelar.
function craft(user, { id }) {
  const p = BY_ID.get(Number(id));
  if (!p) throw new Error('Pokémon desconocido.');
  const cost = RARITY[p.rarity].craft;
  if (user.dust < cost) throw new Error(`Necesitas ${cost} de polvo estelar.`);
  const c = user.collection[p.id];
  if (c && c.n >= 5) throw new Error('Ya tienes 5 estrellas de ese Pokémon.');
  user.dust -= cost;
  const g = grant(user, p.id, false);
  db.save();
  return { id: p.id, name: p.name, ...g };
}

// Copias «reales» de un Pokémon: las estrellas de Caramelo Raro (`cn`) están ligadas y no se pueden
// vender, regalar ni liberar (si no, un caramelo de 900 monedas fabricaría copias de legendarias y su
// liberación o venta daría más de lo que cuesta). Siempre queda una copia real que las respalda.
const realCopies = (c) => c.n - (c.cn || 0);
const spareCopies = (c) => Math.max(0, realCopies(c) - 1);

// Liberar repetidos y cambiar el polvo no puede devolver más de lo que cuesta tirar (el polvo de una tirada ×1
// vale ≈55 % de su coste a DUST_RATE).
const DUST_RATE = 4;
function exchangeDust(user, { amount }) {
  amount = Number(amount);
  if (!Number.isInteger(amount) || amount <= 0 || amount > user.dust) throw new Error('Cantidad no válida.');
  user.dust -= amount;
  user.coins += amount * DUST_RATE;
  hub.ledger(user, amount * DUST_RATE, 'dust', `${amount} ✦`);
  db.save();
  return { coins: amount * DUST_RATE };
}

// Liberar copias sobrantes a cambio de polvo (se conserva al menos una).
function release(user, { id, count }) {
  const p = BY_ID.get(Number(id));
  const c = p && user.collection[p.id];
  count = Number(count) || 1;
  if (!c || !Number.isInteger(count) || count < 1 || count > spareCopies(c)) throw new Error('Debes conservar al menos una copia (las estrellas de Caramelo Raro no se pueden liberar).');
  c.n -= count;
  if (c.s > realCopies(c)) c.s = realCopies(c);
  const dust = RARITY[p.rarity].dust * count;
  user.dust += dust;
  db.save();
  return { dust };
}

// Quita una copia de la colección (para regalos y el Mercado).
function takePoke(user, id, shiny) {
  const p = BY_ID.get(Number(id));
  const c = p && user.collection[p.id];
  if (!c || c.n < 1) throw new Error('No tienes ese Pokémon.');
  if (shiny && !(c.s > 0)) throw new Error('No tienes la versión variocolor.');
  if (!shiny && c.s >= realCopies(c)) throw new Error('Todas tus copias son variocolor: elige la versión variocolor.');
  if ((c.cn || 0) > 0 && realCopies(c) <= 1) throw new Error('Tus estrellas de Caramelo Raro necesitan una copia real: no puedes quitar la última.');
  c.n--;
  if (shiny) c.s--;
  if (c.n <= 0) {
    delete user.collection[p.id];
    if (user.buddy && user.buddy.id === p.id) user.buddy = null;
  } else if (user.buddy && user.buddy.id === p.id && user.buddy.shiny && !c.s) {
    user.buddy.shiny = false;
  }
  return p;
}

module.exports = { X10_GIFTS, realCopies, spareCopies, STAGE_WEIGHT, stageWeight, pull, takePoke, craft, exchangeDust, release, grant, activeBanners, bannersInfo, BANNERS, COST, RATES, SHINY_RATE, DUST_RATE, rollRarity, rollPokemon };

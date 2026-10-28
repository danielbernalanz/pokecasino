'use strict';
// «Desafío Pokémon»: preguntas con apuesta progresiva (como Minas: cada acierto sube el multiplicador y puedes
// retirarte entre pregunta y pregunta). Dos modos:
//  · «type»   ¿Quién es ese Pokémon?: se escribe el nombre (silueta, recorte o solo pistas).
//  · «choice» Trivia: preguntas de opción múltiple generadas con los datos reales de la Pokédex + un banco a mano.
// Todo lo importante es del servidor: la respuesta nunca viaja al cliente antes de contestar, el tiempo se
// controla aquí y las imágenes se sirven a través de un proxy con token (la URL del sprite revelaría el número).
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');
const db = require('../db');
const hub = require('../hub');
const dex = require('../pokedex');
const { rand, randInt, pick, shuffle, weighted } = require('../rng');
const { BANK } = require('./quizdata');

// ---------- Dificultades y escalera de multiplicadores ----------
// `acc` es la precisión que se supone a un fan EXPERTO en cada dificultad (el multiplicador se calcula para que
// incluso con esa precisión el retorno sea < 97 %: ver docs/BALANCE.md).
const DIFFS = {
  facil: { id: 'facil', label: 'Fácil', options: 4, secs: 20, acc: 0.95, max: 5, prior: 20 },
  normal: { id: 'normal', label: 'Normal', options: 4, secs: 15, acc: 0.85, max: 6, prior: 20 },
  dificil: { id: 'dificil', label: 'Difícil', options: 6, secs: 12, acc: 0.70, max: 6, prior: 20 },
  maestro: { id: 'maestro', label: 'Maestro', options: 6, secs: 10, acc: 0.50, max: 5, prior: 8 },
};
const LADDER_BASE = 0.94; // RTP del experto al retirarse tras k aciertos (sin objetivo)
const TARGET_BONUS = 1.03; // +3 % al completar el objetivo elegido: 0,94 × 1,03 = 0,968 < 0,97
const MAX_MULT = 50;
const MAX_STREAK = 20; // cota general de la escalera; cada dificultad se corta antes (`max`: allí se cobra solo)
// Racha máxima por dificultad: la escalera crece como 1/precisión^k, así que quien acierte más de lo supuesto (o
// busque las respuestas) ganaría más cuanto más larga fuera la racha. Se corta donde Maestro y Difícil ya rozan ×50.
const TARGETS = [3, 5];
const PAYOUT_CAP = 20; // pago máximo por ronda: 20 × límite de apuesta del jugador
const GRACE_MS = 1000; // margen de latencia
const IMG_EXTRA_MS = 1000; // la imagen puede tardar en cargar
const MIN_GAP_MS = 250; // entre dos acciones del mismo jugador

// `acc` (opcional) es la precisión real del jugador: así la escalera se adapta a quien acierta más de lo previsto.
const ladder = (diff, k, acc = DIFFS[diff].acc) => (k <= 0 ? 1 : Math.min(MAX_MULT, Math.max(1, Math.floor((100 * LADDER_BASE) / Math.pow(acc, k)) / 100)));
const finalMult = (diff, k, bonus, acc) => (k <= 0 ? 1 : Math.min(MAX_MULT, Math.floor(100 * ladder(diff, k, acc) * (bonus ? TARGET_BONUS : 1)) / 100));

// ---------- Precisión de cada jugador (por modo y dificultad) ----------
// Se parte de la precisión supuesta (como si ya hubiera respondido PRIOR preguntas así) y se ajusta con sus
// respuestas reales. Las rachas son cortas (5–6) porque en rachas largas cualquier error de la estimación se
// multiplica y quien acierta casi todo (o busca las respuestas) ganaría. Nunca baja de la supuesta: quien acierta más ve multiplicadores más bajos y nadie puede
// sacar dinero a la larga, sepa lo que sepa (o busque las respuestas).
// Peso de la precisión supuesta (en preguntas). Maestro es más prudente: con una precisión supuesta del 50 %
// es donde más ganaría quien acierta casi todo.
const PRIOR = 20;
const accKey = (mode, diff) => `${mode}:${diff}`;
function playerAcc(user, mode, diff) {
  const r = ((user.quizAcc ||= {})[accKey(mode, diff)]) || { ok: 0, n: 0 };
  const base = DIFFS[diff].acc;
  const prior = DIFFS[diff].prior || PRIOR;
  const n = r.n + prior;
  const mean = (r.ok + prior * base) / n;
  // Estimación prudente (media + una desviación + 1 punto): con pocos datos se supone que el jugador es mejor.
  return Math.min(0.995, Math.max(base, mean + Math.sqrt((mean * (1 - mean)) / n) + 0.01));
}
function noteAnswer(user, g, ok) {
  const r = ((user.quizAcc ||= {})[accKey(g.mode, g.diff)] ||= { ok: 0, n: 0 });
  r.n++;
  if (ok) r.ok++;
}
const payoutOf = (user, bet, mult) => Math.min(Math.floor(bet * mult), PAYOUT_CAP * hub.maxBetFor(user));

// ---------- Texto ----------
const TYPE_ES = {
  normal: 'Normal', fire: 'Fuego', water: 'Agua', electric: 'Eléctrico', grass: 'Planta', ice: 'Hielo', fighting: 'Lucha', poison: 'Veneno',
  ground: 'Tierra', flying: 'Volador', psychic: 'Psíquico', bug: 'Bicho', rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón', dark: 'Siniestro',
  steel: 'Acero', fairy: 'Hada',
};
const REGION = { 1: 'Kanto', 2: 'Johto', 3: 'Hoenn', 4: 'Sinnoh', 5: 'Teselia', 6: 'Kalos', 7: 'Alola', 8: 'Galar', 9: 'Paldea' };
const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX' };
const STAT_LABEL = ['PS', 'Ataque', 'Defensa', 'At. Esp.', 'Def. Esp.', 'Velocidad'];

// ---------- Nombres: normalización y tolerancia a erratas ----------
function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/♀/g, 'f').replace(/♂/g, 'm').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const ALL_NORM = new Set(dex.DEX.map((p) => normalize(p.name)));
// Acierta si coincide (sin tildes, mayúsculas ni signos) o, en nombres de ≥ 6 letras, con una errata (Levenshtein ≤ 1).
// Escribir exactamente el nombre de OTRO Pokémon nunca se perdona (Nidorina ≠ Nidorino).
function matches(input, names) {
  const t = normalize(input);
  if (!t || t.length > 40) return false;
  for (const name of names) {
    const n = normalize(name);
    if (t === n) return true;
    if (n.length >= 6 && !ALL_NORM.has(t) && lev(t, n) <= 1) return true;
  }
  return false;
}

// ---------- Imágenes: PNG sin dependencias (silueta y recorte en el servidor) ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('png');
  let pos = 8; let w = 0; let hgt = 0; let depth = 0; let ct = 0; let il = 0;
  const idat = [];
  while (pos + 12 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); hgt = data.readUInt32BE(4); depth = data[8]; ct = data[9]; il = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  if (!ch || depth !== 8 || il !== 0 || !w || !hgt || w * hgt > 4e6) throw new Error('png no soportado');
  const stride = w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(hgt * stride);
  for (let y = 0; y < hgt; y++) {
    const f = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[o + x - ch] : 0;
      const b = y ? px[o - stride + x] : 0;
      const c = x >= ch && y ? px[o - stride + x - ch] : 0;
      let v = raw[line + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  const rgba = Buffer.alloc(w * hgt * 4);
  for (let i = 0; i < w * hgt; i++) {
    const s = i * ch;
    if (ct === 6) { rgba[i * 4] = px[s]; rgba[i * 4 + 1] = px[s + 1]; rgba[i * 4 + 2] = px[s + 2]; rgba[i * 4 + 3] = px[s + 3]; }
    else if (ct === 2) { rgba[i * 4] = px[s]; rgba[i * 4 + 1] = px[s + 1]; rgba[i * 4 + 2] = px[s + 2]; rgba[i * 4 + 3] = 255; }
    else { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = px[s]; rgba[i * 4 + 3] = ct === 4 ? px[s + 1] : 255; }
  }
  return { w, h: hgt, rgba };
}
function encodePng(w, hgt, rgba) {
  const raw = Buffer.alloc(hgt * (w * 4 + 1));
  for (let y = 0; y < hgt; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
// Silueta completa (todo el cuerpo en un solo color oscuro) o recorte en color de una zona del cuerpo.
function processImage(png, mode) {
  const { w, h: hh, rgba } = decodePng(png);
  if (mode === 'sil') {
    for (let i = 0; i < w * hh; i++) { rgba[i * 4] = 22; rgba[i * 4 + 1] = 18; rgba[i * 4 + 2] = 46; }
    return encodePng(w, hh, rgba);
  }
  let x0 = w; let y0 = hh; let x1 = 0; let y1 = 0;
  const solid = [];
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (rgba[(y * w + x) * 4 + 3] > 40) { solid.push(y * w + x); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!solid.length) throw new Error('png vacío');
  const side = Math.max(48, Math.min(w, hh, Math.round(0.5 * Math.max(x1 - x0, y1 - y0))));
  const c = solid[randInt(0, solid.length - 1)];
  const cx = Math.min(w - side / 2, Math.max(side / 2, c % w));
  const cy = Math.min(hh - side / 2, Math.max(side / 2, Math.floor(c / w)));
  const sx = Math.round(cx - side / 2); const sy = Math.round(cy - side / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) rgba.copy(out, y * side * 4, ((sy + y) * w + sx) * 4, ((sy + y) * w + sx + side) * 4);
  return encodePng(side, side, out);
}

const ART_URL = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
const artCache = new Map(); // id -> Buffer (LRU simple)
const artPending = new Map();
function getArt(id) {
  if (artCache.has(id)) { const b = artCache.get(id); artCache.delete(id); artCache.set(id, b); return Promise.resolve(b); }
  if (artPending.has(id)) return artPending.get(id);
  const p = new Promise((resolve, reject) => {
    const req = https.get(ART_URL(id), { timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('imagen ' + res.statusCode)); }
      const parts = []; let size = 0;
      res.on('data', (d) => { size += d.length; if (size > 3e6) { req.destroy(new Error('demasiado grande')); } else parts.push(d); });
      res.on('end', () => resolve(Buffer.concat(parts)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('tiempo de espera')));
    req.on('error', reject);
  }).then((b) => {
    artCache.set(id, b);
    if (artCache.size > 120) artCache.delete(artCache.keys().next().value);
    return b;
  }).finally(() => artPending.delete(id));
  artPending.set(id, p);
  return p;
}

// token -> { id, mode: 'sil' | 'crop' | 'color', exp, buf }. El token no revela el número del Pokémon.
const IMG = new Map();
const IMG_TTL = 10 * 60 * 1000;
function imgToken(id, mode) {
  const token = crypto.randomBytes(12).toString('base64url');
  IMG.set(token, { id, mode, exp: Date.now() + IMG_TTL, buf: null });
  if (IMG.size > 4000) for (const k of IMG.keys()) { if (IMG.size <= 3000) break; IMG.delete(k); }
  getArt(id).catch(() => {}); // se calienta la caché para que la imagen llegue enseguida
  return `/api/quiz/img/${token}`;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of IMG) if (v.exp < t) IMG.delete(k); }, 60 * 1000).unref();
async function imgHandler(req, res) {
  const e = IMG.get(String(req.params.token || ''));
  if (!e || e.exp < Date.now()) return res.status(404).end();
  try {
    if (!e.buf) { const art = await getArt(e.id); e.buf = e.mode === 'color' ? art : processImage(art, e.mode); }
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=600' }).send(e.buf);
  } catch { res.status(502).end(); }
}

// ---------- Generadores de preguntas de opción múltiple ----------
const BY_NAME = new Map(dex.DEX.map((p) => [p.name, p]));
const KIDS = new Map();
for (const p of dex.DEX) if (p.evolvesFrom) { if (!KIDS.has(p.evolvesFrom)) KIDS.set(p.evolvesFrom, []); KIDS.get(p.evolvesFrom).push(p); }
const sample = (arr, k) => shuffle(arr).slice(0, k);
const ES = (t) => TYPE_ES[t];
const sameTypes = (a, b) => a.types.length === b.types.length && a.types.every((t) => b.types.includes(t));
const sharesType = (a, b) => a.types.some((t) => b.types.includes(t));
// Distractores «parecidos» (mismo tipo) para que no se acierte por descarte.
const similar = (p, list, k) => shuffle(list.filter((q) => q.id !== p.id)).sort((a, b) => (sharesType(b, p) ? 1 : 0) - (sharesType(a, p) ? 1 : 0)).slice(0, Math.max(k, 0));

// Populares: primera generación + iniciales y legendarios que todo el mundo conoce.
const FAMOUS = [152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816, 906, 909, 912,
  196, 197, 212, 242, 243, 244, 245, 248, 249, 250, 251, 282, 330, 359, 376, 380, 381, 382, 383, 384, 385, 386, 392, 395, 445, 448, 468, 483, 484, 487,
  493, 571, 609, 635, 658, 700, 718, 720, 724, 727, 778, 785, 786, 787, 788, 800, 807];
const POOLS = {
  facil: dex.DEX.filter((p) => p.id <= 151 || FAMOUS.includes(p.id)),
  normal: dex.DEX.filter((p) => p.id <= 493),
  dificil: dex.DEX,
  maestro: dex.DEX,
};
const POOLSET = Object.fromEntries(Object.entries(POOLS).map(([k, v]) => [k, new Set(v)]));

// Cada generador devuelve { prompt, answer, wrong[], ok(opcion) } (o null si no puede). `c`: { pool, n, d }.
const GEN = {
  typeOf(c) {
    const p = pick(c.pool);
    const t = pick(p.types);
    return { prompt: p.types.length === 1 ? `¿De qué tipo es ${p.name}?` : `¿Cuál de estos tipos tiene ${p.name}?`, answer: ES(t),
      wrong: shuffle(dex.TYPES.filter((x) => !p.types.includes(x))).map(ES), ok: (o) => p.types.some((x) => ES(x) === o) };
  },
  secondType(c) {
    const p = pick(c.pool.filter((q) => q.types.length === 2));
    return { prompt: `¿Cuál es el tipo secundario de ${p.name}?`, answer: ES(p.types[1]),
      wrong: [ES(p.types[0]), ...shuffle(dex.TYPES.filter((x) => !p.types.includes(x))).map(ES)], ok: (o) => o === ES(p.types[1]) };
  },
  notType(c) {
    const t = pick(dex.TYPES.filter((x) => c.pool.filter((p) => p.types.includes(x)).length >= c.n - 1));
    const answer = pick(c.pool.filter((p) => !p.types.includes(t)));
    const wrong = sample(c.pool.filter((p) => p.types.includes(t)), c.n - 1).map((p) => p.name);
    return { prompt: `¿Cuál de estos Pokémon NO es de tipo ${ES(t)}?`, answer: answer.name, wrong, ok: (o) => !BY_NAME.get(o).types.includes(t) };
  },
  compare(c) {
    const [idx, more, less] = pick([[0, 'tiene más PS base', 'tiene menos PS base'], [1, 'tiene más Ataque base', 'tiene menos Ataque base'], [2, 'tiene más Defensa base', 'tiene menos Defensa base'],
      [3, 'tiene más Ataque Especial base', 'tiene menos Ataque Especial base'], [4, 'tiene más Defensa Especial base', 'tiene menos Defensa Especial base'], [5, 'es el más rápido', 'es el más lento']]);
    const max = rand() < 0.65;
    const [gmin, gmax] = { facil: [30, 999], normal: [15, 999], dificil: [6, 999], maestro: [1, 12] }[c.d];
    for (let i = 0; i < 300; i++) {
      const g = sample(c.pool, c.n);
      const vals = g.map((p) => p.stats[idx]).sort((a, b) => (max ? b - a : a - b));
      const gap = Math.abs(vals[0] - vals[1]);
      if (gap < gmin || gap > gmax) continue;
      const best = g.find((p) => p.stats[idx] === vals[0]);
      return { prompt: `¿Cuál de estos Pokémon ${max ? more : less}?`, answer: best.name, wrong: g.filter((p) => p !== best).map((p) => p.name), ok: (o) => BY_NAME.get(o).stats[idx] === vals[0] };
    }
    return null;
  },
  gen(c) {
    const p = pick(c.pool);
    if (rand() < 0.5) return { prompt: `¿De qué región es ${p.name}?`, answer: REGION[p.gen], wrong: shuffle(Object.keys(REGION).filter((g) => Number(g) !== p.gen)).map((g) => REGION[g]), ok: (o) => o === REGION[p.gen] };
    const lab = (g) => `Generación ${ROMAN[g]}`;
    return { prompt: `¿En qué generación debutó ${p.name}?`, answer: lab(p.gen), wrong: shuffle(Object.keys(ROMAN).filter((g) => Number(g) !== p.gen)).map((g) => lab(g)), ok: (o) => o === lab(p.gen) };
  },
  evolvesTo(c) {
    const p = pick(c.pool.filter((q) => KIDS.has(q.id)));
    const kids = KIDS.get(p.id);
    const kid = pick(kids);
    const others = dex.DEX.filter((q) => q.id !== p.id && !kids.includes(q) && c.set.has(q));
    return { prompt: kids.length === 1 ? `¿En qué evoluciona ${p.name}?` : `¿Cuál de estos Pokémon es una evolución de ${p.name}?`, answer: kid.name,
      wrong: similar(kid, others, 30).map((q) => q.name), ok: (o) => kids.some((k) => k.name === o) };
  },
  evolvesFrom(c) {
    const p = pick(c.pool.filter((q) => q.evolvesFrom));
    const from = dex.BY_ID.get(p.evolvesFrom);
    const others = dex.DEX.filter((q) => q.id !== p.id && q.id !== from.id && c.set.has(q));
    return { prompt: `¿De qué Pokémon evoluciona ${p.name}?`, answer: from.name, wrong: similar(from, others, 30).map((q) => q.name), ok: (o) => o === from.name };
  },
  dexNum(c) {
    const p = pick(c.pool);
    const R = { facil: 40, normal: 25, dificil: 12, maestro: 6 }[c.d];
    const fmtN = (n) => '#' + String(n).padStart(3, '0');
    const near = new Set();
    for (let i = 0; i < 200 && near.size < c.n + 4; i++) { const n = p.id + randInt(-R, R); if (n >= 1 && n <= 1025 && n !== p.id) near.add(n); }
    return { prompt: `¿Qué número de Pokédex Nacional tiene ${p.name}?`, answer: fmtN(p.id), wrong: [...near].map(fmtN), ok: (o) => o === fmtN(p.id) };
  },
  statLine(c) {
    const p = pick(c.pool);
    const bst = p.stats.reduce((a, b) => a + b, 0);
    const line = p.stats.join('/');
    const cand = c.pool.filter((q) => q.id !== p.id && q.stats.join('/') !== line && Math.abs(q.stats.reduce((a, b) => a + b, 0) - bst) <= 90);
    return { prompt: `¿Qué Pokémon tiene estas estadísticas base?\nPS ${p.stats[0]} · Ataque ${p.stats[1]} · Defensa ${p.stats[2]} · At. Esp. ${p.stats[3]} · Def. Esp. ${p.stats[4]} · Velocidad ${p.stats[5]}`,
      answer: p.name, wrong: sample(cand, 12).map((q) => q.name), ok: (o) => BY_NAME.get(o).stats.join('/') === line };
  },
  dualType(c) {
    const p = pick(c.pool.filter((q) => q.types.length === 2));
    const has = (q) => p.types.every((t) => q.types.includes(t));
    const wrong = similar(p, c.pool.filter((q) => !has(q)), 30).map((q) => q.name);
    return { prompt: `¿Cuál de estos Pokémon es de tipo ${ES(p.types[0])}/${ES(p.types[1])}?`, answer: p.name, wrong, ok: (o) => has(BY_NAME.get(o)) };
  },
  effective(c) {
    const kind = pick(c.d === 'facil' ? ['vsType', 'vsPoke'] : c.d === 'maestro' ? ['vsPoke', 'immune', 'x4', 'x4'] : ['vsType', 'vsPoke', 'immune']);
    const mul = (a, def) => def.reduce((m, t) => m * (dex.CHART[a][t] ?? 1), 1);
    if (kind === 'vsType') {
      const t = pick(dex.TYPES);
      const good = dex.TYPES.filter((a) => mul(a, [t]) === 2);
      if (!good.length) return null;
      return { prompt: `¿Qué tipo de ataque es súper eficaz contra el tipo ${ES(t)}?`, answer: ES(pick(good)), wrong: shuffle(dex.TYPES.filter((a) => mul(a, [t]) <= 1)).map(ES), ok: (o) => mul(dex.TYPES.find((a) => ES(a) === o), [t]) === 2 };
    }
    if (kind === 'vsPoke') {
      const p = pick(c.pool);
      const good = dex.TYPES.filter((a) => mul(a, p.types) >= 2);
      if (!good.length) return null;
      return { prompt: `¿Qué tipo de ataque es súper eficaz contra ${p.name}?`, answer: ES(pick(good)), wrong: shuffle(dex.TYPES.filter((a) => mul(a, p.types) <= 1)).map(ES), ok: (o) => mul(dex.TYPES.find((a) => ES(a) === o), p.types) >= 2 };
    }
    if (kind === 'x4') {
      const p = pick(c.pool.filter((q) => q.types.length === 2 && dex.TYPES.some((a) => mul(a, q.types) >= 4)));
      const good = dex.TYPES.filter((a) => mul(a, p.types) >= 4);
      return { prompt: `¿Qué tipo de ataque hace daño ×4 a ${p.name}?`, answer: ES(pick(good)), wrong: shuffle(dex.TYPES.filter((a) => mul(a, p.types) <= 2)).map(ES), ok: (o) => mul(dex.TYPES.find((a) => ES(a) === o), p.types) >= 4 };
    }
    const atk = pick(dex.TYPES.filter((a) => Object.values(dex.CHART[a]).includes(0)));
    const imm = dex.TYPES.filter((t) => dex.CHART[atk][t] === 0);
    return { prompt: `¿Qué tipo es inmune a los ataques de tipo ${ES(atk)}?`, answer: ES(pick(imm)), wrong: shuffle(dex.TYPES.filter((t) => dex.CHART[atk][t] !== 0)).map(ES), ok: (o) => dex.CHART[atk][dex.TYPES.find((t) => ES(t) === o)] === 0 };
  },
  fan(c) {
    const maxTier = { facil: 1, normal: 2, dificil: 3, maestro: 4 }[c.d];
    const it = pick(BANK.filter((b) => b[0] <= maxTier && (c.d !== 'maestro' || b[0] >= 2)));
    return { prompt: it[1], answer: it[2], wrong: shuffle(it[3]), ok: (o) => o === it[2] };
  },
};
const WEIGHTS = {
  facil: { typeOf: 3, notType: 2, compare: 2, gen: 1, evolvesTo: 2, evolvesFrom: 1, dexNum: 1, effective: 1.5, dualType: 1, fan: 3 },
  normal: { typeOf: 2, secondType: 1, notType: 2, compare: 2, gen: 2, evolvesTo: 2, evolvesFrom: 2, dexNum: 1, effective: 2, dualType: 1, statLine: 1, fan: 3 },
  dificil: { typeOf: 1, secondType: 2, notType: 2, compare: 2, gen: 2, evolvesTo: 2, evolvesFrom: 2, dexNum: 2, effective: 3, dualType: 2, statLine: 2, fan: 3 },
  maestro: { secondType: 3, notType: 2, compare: 3, gen: 2, evolvesTo: 2, evolvesFrom: 2, dexNum: 3, effective: 4, dualType: 2, statLine: 4, fan: 4 },
};

// Monta la pregunta con `n` opciones barajadas y comprueba que EXACTAMENTE una es correcta.
function assemble(g, n) {
  if (!g) return null;
  const seen = new Set([g.answer]);
  const wrong = [];
  for (const w of g.wrong) if (!seen.has(w)) { seen.add(w); wrong.push(w); if (wrong.length === n - 1) break; }
  if (wrong.length < n - 1) return null;
  const options = shuffle([g.answer, ...wrong]);
  const good = options.filter(g.ok);
  if (good.length !== 1 || good[0] !== g.answer) return null;
  return { prompt: g.prompt, options, idx: options.indexOf(g.answer), answer: g.answer };
}
function genChoice(diff, { only, avoid = [] } = {}) {
  const D = DIFFS[diff];
  const c = { pool: POOLS[diff], set: POOLSET[diff], n: D.options, d: diff };
  for (let i = 0; i < 80; i++) {
    const kind = only || weighted(Object.entries(WEIGHTS[diff]), ([, w]) => w)[0];
    let q = null;
    try { q = assemble(GEN[kind](c), D.options); } catch { q = null; }
    if (q && !avoid.includes(q.prompt)) return { ...q, kind: 'choice', gen: kind };
  }
  throw new Error('No se pudo generar la pregunta.');
}

// ---------- Escribir el nombre ----------
function genType(diff, { avoid = [] } = {}) {
  const D = DIFFS[diff];
  for (let i = 0; i < 200; i++) {
    const p = pick(POOLS[diff]);
    if (avoid.includes(p.id)) continue;
    const letters = normalize(p.name).length;
    if (diff === 'maestro') {
      // Solo pistas: tipos, generación, letras y varias estadísticas. Vale cualquier Pokémon que cumpla TODAS las pistas.
      const order = shuffle([0, 1, 2, 3, 4, 5]);
      const shown = [];
      let accepted = [];
      for (const idx of order) {
        shown.push(idx);
        accepted = dex.DEX.filter((q) => sameTypes(q, p) && q.gen === p.gen && normalize(q.name).length === letters && shown.every((k) => q.stats[k] === p.stats[k]));
        if (shown.length >= 2 && accepted.length <= 3) break;
      }
      if (accepted.length > 3) continue;
      return { kind: 'type', id: p.id, names: accepted.map((q) => q.name), reveal: p.name, letters, img: null, imgMode: null,
        clues: { types: p.types, gen: p.gen, stage: p.stage, stats: shown.sort().map((k) => ({ k: STAT_LABEL[k], v: p.stats[k] })) },
        prompt: '¿Quién es ese Pokémon? Solo tienes pistas.' };
    }
    const crop = diff === 'dificil';
    const clues = { letters };
    if (diff === 'facil') clues.types = p.types;
    if (crop) clues.gen = p.gen;
    return { kind: 'type', id: p.id, names: [p.name], reveal: p.name, letters, imgMode: crop ? 'crop' : 'sil', clues, prompt: crop ? '¿De qué Pokémon es este detalle?' : '¿Quién es ese Pokémon?' };
  }
  throw new Error('No se pudo generar la pregunta.');
}

// ---------- Estado de la partida ----------
// g = { mode, diff, bet, target, streak, phase: 'ask' | 'decide' | 'over', done, q, n, recent[], lastAct }
// q (solo servidor) = { kind, prompt, options, idx, answer, names, id, letters, clues, img, issued, limit, deadline }
function issue(user, g) {
  const D = DIFFS[g.diff];
  let q;
  if (g.mode === 'type') {
    q = genType(g.diff, { avoid: g.recent.filter((x) => typeof x === 'number') });
    g.recent.push(q.id);
    if (q.imgMode) q.img = imgToken(q.id, q.imgMode);
  } else {
    q = genChoice(g.diff, { avoid: g.recent.filter((x) => typeof x === 'string') });
    g.recent.push(q.prompt);
  }
  if (g.recent.length > 40) g.recent.splice(0, g.recent.length - 40);
  const now = Date.now();
  g.n++;
  g.phase = 'ask';
  q.issued = now;
  q.limit = D.secs * 1000;
  q.deadline = now + q.limit + (q.img ? IMG_EXTRA_MS : 0);
  g.q = q;
}
// Lo único que ve el cliente de la pregunta: nunca la respuesta, el número ni el nombre.
function publicQ(g, now = Date.now()) {
  const q = g.q;
  return { n: g.n, kind: q.kind, prompt: q.prompt, options: q.kind === 'choice' ? q.options : null, img: q.img || null, clues: q.clues || null, letters: q.letters || null,
    ms: Math.max(0, q.limit - (now - q.issued)), limit: q.limit };
}
function view(user, g) {
  const now = Date.now();
  const playing = !g.done;
  const bonusNext = g.target && g.streak + 1 === g.target;
  return {
    mode: g.mode, diff: g.diff, bet: g.bet, target: g.target, streak: g.streak, n: g.n, phase: g.phase, done: g.done,
    mult: finalMult(g.diff, g.streak, false, g.acc), next: finalMult(g.diff, g.streak + 1, bonusNext, g.acc),
    cash: g.streak > 0 ? payoutOf(user, g.bet, finalMult(g.diff, g.streak, false, g.acc)) : 0,
    ladder: Array.from({ length: DIFFS[g.diff].max }, (_, i) => ladder(g.diff, i + 1, g.acc)),
    q: playing && g.phase === 'ask' ? publicQ(g, now) : null,
  };
}
const best = (user) => ((user.quizBest ||= {}));
function bump(user, g) {
  const b = best(user);
  if (g.streak > (b[g.diff] || 0)) b[g.diff] = g.streak;
}

function active(user) {
  const g = user.games.quiz;
  return g && !g.done ? g : null;
}
// Pregunta vencida (con margen): se pierde la ronda aunque el jugador no haya vuelto a contestar.
function settle(user, g) {
  if (g && !g.done && g.phase === 'ask' && Date.now() > g.q.deadline + GRACE_MS) return lose(user, g, true);
  return null;
}
function reveal(g) {
  const q = g.q;
  return q.kind === 'type' ? { name: q.reveal, names: q.names, img: imgToken(q.id, 'color') } : { answer: q.answer, idx: q.idx };
}
function lose(user, g, timeout) {
  noteAnswer(user, g, false);
  const rv = reveal(g);
  g.done = true; g.phase = 'over';
  bump(user, g);
  const out = { correct: false, timeout: !!timeout, reveal: rv, game: view(user, g), lost: g.bet };
  g.q = null;
  db.save();
  return out;
}
function pace(g) {
  const now = Date.now();
  if (now - (g.lastAct || 0) < MIN_GAP_MS) throw new Error('Más despacio, entrenador.');
  g.lastAct = now;
}

function start(user, { bet, mode, diff, target }) {
  if (active(user)) throw new Error('Termina la partida actual.');
  if (!['type', 'choice'].includes(mode)) throw new Error('Modo no válido.');
  if (!DIFFS[diff]) throw new Error('Dificultad no válida.');
  target = Number(target) || 0;
  if (target && (!TARGETS.includes(target) || target > DIFFS[diff].max)) throw new Error('Objetivo no válido.');
  const g = { mode, diff, bet: 0, target, streak: 0, n: 0, phase: 'ask', done: false, q: null, recent: [], lastAct: Date.now(), acc: playerAcc(user, mode, diff) };
  issue(user, g); // si algo falla al generar, no se ha cobrado nada
  g.bet = hub.takeBet(user, bet, 'quiz');
  user.games.quiz = g;
  db.save();
  return { game: view(user, g) };
}

function win(user, g, bonus) {
  const mult = finalMult(g.diff, g.streak, bonus, g.acc);
  const amount = payoutOf(user, g.bet, mult);
  const paid = hub.pay(user, amount, g.bet, 'quiz').paid;
  g.done = true; g.phase = 'over'; g.q = null;
  bump(user, g);
  db.save();
  return { paid, mult, capped: amount < Math.floor(g.bet * mult), bonus: !!bonus };
}

function answer(user, { option, text, giveUp }) {
  const g = active(user);
  if (!g || g.phase !== 'ask') throw new Error('No hay ninguna pregunta en juego.');
  const late = settle(user, g);
  if (late) return late;
  if (giveUp) return lose(user, g, true); // el cliente avisa de que se acabó el tiempo
  pace(g);
  const q = g.q;
  let ok;
  if (q.kind === 'choice') {
    option = Number(option);
    if (!Number.isInteger(option) || option < 0 || option >= q.options.length) throw new Error('Opción no válida.');
    ok = option === q.idx;
  } else {
    if (typeof text !== 'string') throw new Error('Escribe un nombre.');
    ok = matches(text, q.names);
  }
  if (!ok) return lose(user, g, false);
  noteAnswer(user, g, true);
  const rv = reveal(g);
  g.streak++;
  g.q = null;
  bump(user, g);
  hub.track(user, 'quiz_correct', { streak: g.streak });
  const out = { correct: true, reveal: rv, streak: g.streak };
  if (g.streak >= DIFFS[g.diff].max || (g.target && g.streak >= g.target)) {
    Object.assign(out, win(user, g, !!g.target && g.streak >= g.target), { auto: true });
  } else {
    g.phase = 'decide';
  }
  out.game = view(user, g);
  db.save();
  return out;
}

function next(user) {
  const g = active(user);
  if (!g || g.phase !== 'decide') throw new Error('No se puede pedir otra pregunta ahora.');
  pace(g);
  issue(user, g);
  db.save();
  return { game: view(user, g) };
}

function cashout(user) {
  const g = active(user);
  if (!g) throw new Error('No hay partida en curso.');
  const late = settle(user, g);
  if (late) return late;
  if (g.phase !== 'decide' || g.streak < 1) throw new Error('Solo puedes retirarte entre pregunta y pregunta, tras acertar al menos una.');
  pace(g);
  const r = win(user, g, false);
  return { game: view(user, g), ...r };
}

// Escaleras personales (para mostrarlas antes de jugar).
function myLadders(user) {
  const out = {};
  for (const mode of ['type', 'choice']) for (const d of Object.keys(DIFFS)) {
    const acc = playerAcc(user, mode, d);
    out[accKey(mode, d)] = { acc: Math.round(acc * 1000) / 10, ladder: Array.from({ length: DIFFS[d].max }, (_, i) => ladder(d, i + 1, acc)) };
  }
  return out;
}

function state(user) {
  const g = user.games.quiz;
  const ladders = myLadders(user);
  if (!g || g.done) return { game: null, best: { ...best(user) }, ladders };
  settle(user, g);
  return { game: g.done ? null : view(user, g), best: { ...best(user) }, ladders };
}

// Mejores rachas por dificultad (top 10).
function board() {
  const users = Object.values(db.data.users).filter((u) => !u.banned && !u.npc);
  const out = {};
  for (const d of Object.keys(DIFFS)) {
    out[d] = users.filter((u) => u.quizBest && u.quizBest[d] > 0).sort((a, b) => b.quizBest[d] - a.quizBest[d]).slice(0, 10)
      .map((u) => ({ username: u.username, streak: u.quizBest[d], buddy: u.buddy, ...hub.looks(u) }));
  }
  return { board: out };
}

// Solo para pruebas (NODE_ENV=test): la respuesta de la pregunta en curso.
function peek(user) {
  const g = active(user);
  if (!g || !g.q) throw new Error('Sin pregunta.');
  return g.q.kind === 'choice' ? { option: g.q.idx } : { text: g.q.names[0] };
}

const STATIC = {
  diffs: Object.values(DIFFS).map((d) => ({ id: d.id, label: d.label, options: d.options, secs: d.secs, max: d.max, ladder: Array.from({ length: d.max }, (_, i) => ladder(d.id, i + 1)) })),
  targets: TARGETS, targetBonus: TARGET_BONUS, maxStreak: MAX_STREAK, maxMult: MAX_MULT, payoutCap: PAYOUT_CAP,
};

module.exports = { playerAcc, PRIOR, DIFFS, ladder, finalMult, payoutOf, LADDER_BASE, TARGET_BONUS, MAX_MULT, MAX_STREAK, TARGETS, PAYOUT_CAP, GRACE_MS, STATIC,
  normalize, lev, matches, genChoice, genType, GEN, BANK, POOLS, start, answer, next, cashout, state, board, peek, imgHandler, processImage, decodePng, encodePng };

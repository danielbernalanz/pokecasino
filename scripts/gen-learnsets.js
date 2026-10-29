'use strict';
// Genera server/learnsets.json: movimientos por nivel, MT, huevo y tutores de cada especie (datos de Pokémon Showdown,
// generación 9 y, para especies ausentes de Escarlata/Púrpura, la más reciente que tenga datos) y la numeración oficial
// de las MT de Escarlata/Púrpura (machines.csv de PokeAPI, grupo de versiones 25). Se ejecuta a mano:
//   node scripts/gen-learnsets.js [carpeta-con-machines.csv-y-moves.csv]
// El servidor no carga el simulador para consultar esto (solo este JSON), así que la Caja PC sigue siendo ligera.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Dex, toID } = require('pokemon-showdown');

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const dir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'pokeapi-csv-'));
for (const f of ['machines', 'moves']) {
  const p = path.join(dir, f + '.csv');
  if (!fs.existsSync(p)) execFileSync('curl', ['-sSf', '-o', p, BASE + f + '.csv']);
}
const rows = (f) => fs.readFileSync(path.join(dir, f + '.csv'), 'utf8').replace(/\r/g, '').trim().split('\n').slice(1).map((l) => l.split(','));
const ident = new Map(rows('moves').map((r) => [r[0], toID(r[1])]));
const tmNum = {};
for (const r of rows('machines')) if (r[1] === '25') tmNum[ident.get(r[3])] = Number(r[0]);

const okMove = (id) => { const m = Dex.moves.get(id); return m.exists && !m.isNonstandard && !m.isZ && !m.isMax; };
const MOVES = [];
const MI = new Map();
const mi = (id) => { if (!MI.has(id)) { MI.set(id, MOVES.length); MOVES.push(id); } return MI.get(id); };
for (const id of Object.keys(tmNum)) if (!okMove(id)) throw new Error('MT con movimiento no válido: ' + id);

const genOf = (codes, re) => { let g = 0; for (const c of codes) { const m = re.exec(c); if (m) g = Math.max(g, Number(m[1])); } return g; };
const out = {};
let n = 0;
for (const s of Dex.species.all()) {
  if (!(s.num > 0) || s.forme || s.baseSpecies !== s.name || out[s.num]) continue;
  // Cadena: la especie y sus preevoluciones (para MT, huevo y tutores).
  const chain = [];
  for (let sp = s, g = 0; sp && g < 6; g++, sp = sp.prevo ? Dex.species.get(sp.prevo) : null) chain.push(sp);
  const rec = { l: [], m: [], e: [], t: [], a: [], h: '' };
  const ab = s.abilities;
  rec.a = [ab[0], ab[1]].filter(Boolean).map(toID);
  rec.h = ab.H ? toID(ab.H) : '';
  // Por nivel: solo la propia especie.
  const own = Dex.species.getLearnsetData(s.id);
  const ownL = own && own.learnset ? Object.entries(own.learnset) : [];
  const gl = Math.max(0, ...ownL.map(([, c]) => genOf(c, /^(\d)L\d+$/)));
  for (const [mv, codes] of ownL) {
    if (!okMove(mv)) continue;
    const lv = codes.map((c) => new RegExp(`^${gl}L(\\d+)$`).exec(c)).filter(Boolean).map((x) => Number(x[1]));
    if (lv.length) rec.l.push(mi(mv), Math.min(...lv));
  }
  const sets = { m: new Set(), e: new Set(), t: new Set() };
  for (const sp of chain) {
    const ld = Dex.species.getLearnsetData(sp.id);
    if (!ld || !ld.learnset) continue;
    const all = Object.values(ld.learnset).flat();
    const has9 = all.some((c) => c.startsWith('9'));
    const gm = has9 ? 9 : genOf(all, /^(\d)M$/);
    for (const [mv, codes] of Object.entries(ld.learnset)) {
      if (!okMove(mv)) continue;
      if (tmNum[mv] && codes.includes(`${gm}M`)) sets.m.add(mv);
      if (codes.some((c) => /^[89]T$/.test(c))) sets.t.add(mv);
    }
  }
  // Los huevos solo cuentan para la forma base de la familia (la última del bucle de cadena).
  const baseSp = chain[chain.length - 1];
  const bl = Dex.species.getLearnsetData(baseSp.id);
  if (bl && bl.learnset) {
    const all = Object.values(bl.learnset).flat();
    const ge = all.some((c) => c.startsWith('9')) ? 9 : genOf(all, /^(\d)E$/);
    for (const [mv, codes] of Object.entries(bl.learnset)) if (okMove(mv) && codes.includes(`${ge}E`)) sets.e.add(mv);
  }
  for (const k of ['m', 'e', 't']) rec[k] = [...sets[k]].sort().map(mi);
  out[s.num] = rec;
  n++;
}
fs.writeFileSync(path.join(__dirname, '..', 'server', 'learnsets.json'), JSON.stringify({ moves: MOVES, tm: tmNum, sp: out }));
console.log(`especies ${n}, movimientos ${MOVES.length}, MT ${Object.keys(tmNum).length}`);

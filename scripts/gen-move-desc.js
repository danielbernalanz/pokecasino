'use strict';
// Genera server/move-desc-es.json: descripción en español (España) de cada movimiento, con el id de Pokémon
// Showdown como clave. Sale del CSV de PokeAPI move_flavor_text (local_language_id 7 = español), tomando el
// texto del juego más reciente que lo tenga. Se ejecuta a mano y el resultado se sube al repositorio:
//   node scripts/gen-move-desc.js [carpeta-con-los-csv]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { Dex, toID } = require('pokemon-showdown');

const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/';
const dir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'pokeapi-csv-'));
for (const f of ['moves', 'move_flavor_text']) {
  const p = path.join(dir, f + '.csv');
  if (!fs.existsSync(p)) execFileSync('curl', ['-sSf', '-o', p, BASE + f + '.csv']);
}

// CSV con campos entre comillas que pueden llevar comas y saltos de línea.
function csv(name) {
  const text = fs.readFileSync(path.join(dir, name + '.csv'), 'utf8').replace(/\r/g, '');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
}

const ident = new Map(csv('moves').map((r) => [r.id, toID(r.identifier)]));
const best = new Map(); // id de Showdown → { vg, text }
for (const r of csv('move_flavor_text')) {
  if (r.language_id !== '7') continue;
  const id = ident.get(r.move_id);
  if (!id) continue;
  const vg = Number(r.version_group_id);
  const text = r.flavor_text.replace(/­\s*/g, '').replace(/\s+/g, ' ').trim();
  // En los juegos donde un movimiento ya no existe, su texto dice que «no se puede usar»: se ignora.
  if (!text || /no se puede (usar|utilizar)/i.test(text)) continue;
  const prev = best.get(id);
  if (!prev || vg > prev.vg) best.set(id, { vg, text });
}
// Movimientos de 9.ª generación sin texto en español en PokeAPI: descripciones escritas a mano.
const extra = require('./move-desc-extra.json');
const out = {};
for (const m of Dex.moves.all()) {
  const d = best.get(m.id);
  if (d) out[m.id] = d.text;
  else if (extra[m.id]) out[m.id] = extra[m.id];
}
fs.writeFileSync(path.join(__dirname, '..', 'server', 'move-desc-es.json'), JSON.stringify(out));
console.log(`Descripciones: ${Object.keys(out).length} de ${Dex.moves.all().length} movimientos.`);

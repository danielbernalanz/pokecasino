'use strict';
// Pokédex regionales (como las de los juegos: Kanto 151, Johto 100, Hoenn 135, Sinnoh 107, Teselia 156, Kalos 72, Alola 88, Galar 96, Paldea 120) y el
// DIPLOMA DEL GAME FREAK por completar cada una: título + marco de avatar, una sola vez por cuenta y región. Sin monedas.
//  · Las regiones son las generaciones de la Pokédex del casino (`dexdata.json`, campo `gen`): Kanto = n.º 1-151 … Paldea = n.º 906-1025.
//    Galar incluye los 7 Pokémon de Hisui (n.º 899-905), que son de la 8.ª generación.
//  · «Obtenido» = el registro permanente de la Pokédex (`dexreg.js`, como los «capturados» de los juegos: no se pierde al evolucionar, regalar, liberar ni
//    transferir), sin las especies que sigan en la Caja con candado (sanción antiabuso). Los diplomas ya concedidos no se quitan.
//  · Los diplomas ya merecidos se conceden solos la próxima vez que se comprueba (al obtener un Pokémon o al evaluar las colecciones).
const db = require('./db');
const { DEX } = require('./pokedex');

const REGIONS = [
  { id: 'kanto', name: 'Kanto', gen: 1, color: '#e3350d' },
  { id: 'johto', name: 'Johto', gen: 2, color: '#d4a017' },
  { id: 'hoenn', name: 'Hoenn', gen: 3, color: '#1d8f5a' },
  { id: 'sinnoh', name: 'Sinnoh', gen: 4, color: '#6d7fd8' },
  { id: 'teselia', name: 'Teselia', gen: 5, color: '#475569' },
  { id: 'kalos', name: 'Kalos', gen: 6, color: '#d946a8' },
  { id: 'alola', name: 'Alola', gen: 7, color: '#f97316' },
  { id: 'galar', name: 'Galar', gen: 8, color: '#a855f7' },
  { id: 'paldea', name: 'Paldea', gen: 9, color: '#dc2626' },
];
for (const r of REGIONS) {
  r.ids = DEX.filter((p) => p.gen === r.gen).map((p) => p.id);
  r.title = `dex-${r.id}`;
  r.frame = `frame-dex-${r.id}`;
}
const BY_ID = new Map(REGIONS.map((r) => [r.id, r]));
const REGION_OF = new Map();
for (const r of REGIONS) for (const id of r.ids) REGION_OF.set(id, r);

// Pokémon que la cuenta ha obtenido alguna vez (ver arriba).
const got = (u, id) => require('./dexreg').caught(u, id);
const haveOf = (u, r) => { let n = 0; for (const id of r.ids) if (got(u, id)) n++; return n; };
const diplomas = (u) => (u.dexDip ||= {});

// Concede el diploma de la región si está completa y aún no lo tiene. Devuelve true si lo concede ahora.
function award(u, r, now = Date.now()) {
  if (!u || u.npc || diplomas(u)[r.id] || haveOf(u, r) < r.ids.length) return false;
  diplomas(u)[r.id] = now;
  const p = u.progress;
  if (p && !p.titles.includes(r.title)) p.titles.push(r.title);
  const bag = (u.items ||= {});
  bag[r.frame] = (bag[r.frame] || 0) + 1;
  const text = `📜 ¡Diploma del Game Freak! Has completado la Pokédex de ${r.name} (${r.ids.length}): título «Diploma de ${r.name}» y Marco Diploma ${r.name}.`;
  require('./notify').push(u, { kind: 'dex', text, link: '#/trainer', toast: true });
  require('./hub').feed('level', `📜 ${u.username} completó la Pokédex de ${r.name} y recibió el Diploma del Game Freak`);
  db.save();
  return true;
}
// Al obtener una especie: solo se mira su región.
function onObtain(u, id) {
  const r = REGION_OF.get(Number(id));
  return r ? award(u, r) : false;
}
// Comprueba todas las regiones (cuentas antiguas que ya tenían una Pokédex completa).
function check(u) {
  let any = false;
  for (const r of REGIONS) if (award(u, r)) any = true;
  return any;
}

function view(u) {
  return REGIONS.map((r) => ({ id: r.id, name: r.name, gen: r.gen, total: r.ids.length, have: haveOf(u, r), diploma: diplomas(u)[r.id] || 0 }));
}
// Para la ficha pública: solo lo que ya es público (progreso por región y diplomas).
const publicView = (u) => view(u);

const STATIC = REGIONS.map((r) => ({ id: r.id, name: r.name, gen: r.gen, total: r.ids.length, color: r.color, title: r.title, frame: r.frame, ids: r.ids }));

module.exports = { REGIONS, BY_ID, REGION_OF, STATIC, got, haveOf, award, onObtain, check, view, publicView };

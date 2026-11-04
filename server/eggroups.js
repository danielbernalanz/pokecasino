'use strict';
// Grupos huevo y sexo por especie, como en los juegos (datos de Pokémon Showdown: eggGroups, gender, genderRatio).
// Todo se calcula bajo demanda y se guarda en caché: el simulador solo se carga la primera vez que hace falta.
const EG_ES = {
  Monster: 'Monstruo', 'Water 1': 'Agua 1', 'Water 2': 'Agua 2', 'Water 3': 'Agua 3', Bug: 'Bicho', Flying: 'Volador', Field: 'Campo', Fairy: 'Hada',
  Grass: 'Planta', 'Human-Like': 'Humanoide', Mineral: 'Mineral', Amorphous: 'Amorfo', Dragon: 'Dragón', Ditto: 'Ditto', Undiscovered: 'Desconocido',
};
const CACHE = new Map();

function info(id) {
  id = Number(id);
  if (CACHE.has(id)) return CACHE.get(id);
  let r = { groups: ['Undiscovered'], gender: '', ratioM: 0.5 };
  try {
    const sp = require('./sdmap').speciesOf(id);
    const gr = sp.genderRatio || { M: 0.5, F: 0.5 };
    r = { groups: sp.eggGroups && sp.eggGroups.length ? [...sp.eggGroups] : ['Undiscovered'], gender: sp.gender || '', ratioM: gr.M };
  } catch { /* especie sin datos de simulador: no cría */ }
  CACHE.set(id, r);
  return r;
}
const groupsOf = (id) => info(id).groups;
const groupsEs = (id) => groupsOf(id).map((g) => EG_ES[g] || g);
const canBreed = (id) => !groupsOf(id).includes('Undiscovered');
const isDitto = (id) => groupsOf(id).includes('Ditto');
// 'M' | 'F' si la especie tiene sexo fijo, null si no tiene sexo, undefined si es al azar.
const fixedGender = (id) => { const g = info(id).gender; return g === 'M' || g === 'F' ? g : g === 'N' ? null : undefined; };
// Sexo real de un ejemplar: el de la especie si es fijo (o ninguno si no tiene sexo); si no, el guardado.
const genderOf = (id, m) => { const f = fixedGender(id); return f !== undefined ? f : (m && (m.gender === 'M' || m.gender === 'F') ? m.gender : null); };
// Sexo para un ejemplar nuevo.
const rollGender = (id, roll) => { const f = fixedGender(id); return f !== undefined ? f : (roll < info(id).ratioM ? 'M' : 'F'); };
const shareGroup = (a, b) => groupsOf(a).some((g) => g !== 'Ditto' && g !== 'Undiscovered' && groupsOf(b).includes(g));

module.exports = { EG_ES, groupsOf, groupsEs, canBreed, isDitto, fixedGender, genderOf, rollGender, shareGroup };

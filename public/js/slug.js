// Conversión de nombre inglés a slug de Pokémon Showdown. Sin dependencias del navegador (se prueba en Node).
// Minúsculas, sin espacios ni signos; solo unos pocos conservan el guion.
const KEEP_HYPHEN = new Set(['ho-oh', 'porygon-z', 'jangmo-o', 'hakamo-o', 'kommo-o', 'wo-chien', 'chien-pao', 'ting-lu', 'chi-yu']);
export function showdownSlug(name) {
  const base = String(name || '').toLowerCase().replace('♀', 'f').replace('♂', 'm')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const dashed = base.replace(/[’']/g, '').replace(/[.:]/g, '').replace(/\s+/g, '-');
  if (KEEP_HYPHEN.has(dashed)) return dashed;
  // «Mega-Venusaur» → venusaur-mega · «Mega-Charizard X» → charizard-megax
  const mega = /^mega-(.+?)(?:-([xyz]))?$/.exec(dashed);
  if (mega) return showdownSlug(mega[1]) + '-mega' + (mega[2] || '');
  return base.replace(/[^a-z0-9]/g, '');
}

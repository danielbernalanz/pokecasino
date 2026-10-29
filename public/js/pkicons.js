// Iconos de Pokémon en lugar de emojis genéricos.
// Un único mapa «emoji → imagen del mundo Pokémon» (objetos y sprites de PokeAPI) y un observador que
// convierte automáticamente cualquier texto de la interfaz (también el que llega del servidor: avisos,
// «En vivo», novedades…). Si la imagen no carga, se vuelve a poner el emoji original.
// Se dejan tal cual: ✨ (brillo variocolor), ★ ☆ ♀ ♂, palos de cartas y flechas/símbolos de interfaz.
const SPR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites';
const I = (n) => ({ u: `${SPR}/items/${n}.png`, k: 'item' });
const M = (id) => ({ u: `${SPR}/pokemon/${id}.png`, k: 'mon' });
const B = (n) => ({ u: `${SPR}/badges/${n}.png`, k: 'item' });
const T = (t) => ({ t });

// Claves sin el selector de variación U+FE0F (se admite opcional en el texto).
export const EMO = {
  // Moneda, polvo y recompensas
  '🪙': I('amulet-coin'), '💰': I('nugget'), '💱': T('⇄'), '🏦': M(52), '✦': I('stardust'), '🍬': I('rare-candy'),
  '💠': I('key-stone'), '💎': I('prism-scale'), '🌟': I('comet-shard'), '⭐': I('star-piece'),
  '🎁': M(225), '🎟': I('rainbow-pass'), '🎉': M(25), '🎲': I('wishing-piece'),
  // Premios y rangos
  '🏆': I('gold-bottle-cap'), '🏅': B(1), '🥇': I('gold-bottle-cap'), '🥈': I('bottle-cap'), '🥉': M(436), '👑': I('kings-rock'),
  // Juegos
  '🎰': M(137), '🎮': M(474), '🃏': M(122), '🎴': I('tm-normal'), '🎡': M(101), '🎯': I('scope-lens'), '🏁': M(78), '🚀': M(121),
  '💣': M(100), '💥': M(101), '🔻': T('▼'), '❓': M(201), '🧠': M(65), '🥊': M(107), '⚔': I('expert-belt'), '🗡': M(212),
  '🛡': I('protective-pads'), '💪': M(66), '🤝': M(68), '🏟': M(112), '🌀': M(327),
  // Tiendas y objetos
  '🏪': M(352), '🏬': M(352), '🛒': M(352), '🛍': M(352), '🎒': I('explorer-kit'), '🧺': I('berry-pouch'), '🍓': I('razz-berry'),
  '📦': I('pokemon-box'), '📂': I('pokemon-box'), '💾': I('pokemon-box'), '🥚': I('mystery-egg'), '🐣': M(175),
  '♻': M(568), '🛠': M(532), '⚙': I('machine-part'), '🏷': I('poke-toy'), '🧾': I('tm-normal'), '📚': I('exp-candy-m'),
  // Elementos y naturaleza
  '🔥': I('fire-stone'), '⚡': I('thunder-stone'), '💧': I('water-stone'), '🌱': I('leaf-stone'), '🌿': M(1), '🌾': M(357),
  '🌙': I('moon-stone'), '☀': I('sun-stone'), '🌐': M(351),
  // Utilidades y menús
  '🧭': I('town-map'), '📜': I('old-sea-map'), '📋': I('vs-seeker'), '📈': I('exp-share'), '📊': I('exp-candy-xl'),
  '🔒': I('secret-key'), '🔓': I('storage-key'), '🔑': I('storage-key'), '🔎': I('dowsing-machine'), '🔍': I('dowsing-machine'),
  '🔔': I('soothe-bell'), '🔕': M(39), '🚪': M(50), '🏳': I('escape-rope'), '📅': I('coin-case'), '🆕': I('lucky-egg'),
  '📕': M(479), '📲': M(479), '📱': M(479), '📰': M(278), '✉': M(16), '📝': M(235), '🖼': M(235), '🎞': M(151),
  '🖥': M(137), '🔌': M(81), '🔬': M(605), '🧬': M(132), '🎓': M(164), '🧑‍🔬': M(199), '👩‍🌾': M(241),
  '⏳': M(251), '⏱': M(483), '⏰': M(483), '🚨': M(109), '⚖': M(448), '💬': M(441), '🧢': M(25),
  // Personas y ánimo
  '🧑': I('poke-ball'), '👩': I('poke-ball'), '👤': I('poke-ball'), '👥': I('great-ball'),
  '💗': I('sweet-heart'), '💖': I('sweet-heart'), '💕': M(370), '💞': M(370),
  '😀': M(25), '😌': M(79), '🤫': M(94), '🤖': M(462), '🐘': M(232),
  '⚠': M(54),
  // Estados y marcas
  '🟢': I('rawst-berry'), '🔵': I('oran-berry'), '🟣': I('master-ball'), '⚪': T('○'), '⬜': T('☐'), '🟫': T('■'),
  '✅': T('✓'), '❌': T('✕'), '⛔': T('✕'), '➕': T('+'), '⬆': T('↑'), '⬇': T('↓'), '⏩': T('»'), '⏭': T('»'),
  '🔄': T('↺'), '🔁': T('↺'), '↩': T('↩'), '✏': T('✎'),
};

const KEYS = Object.keys(EMO).sort((a, b) => b.length - a.length);
const RE = new RegExp(`(${KEYS.join('|')})\\uFE0F?`, 'gu');
const SKIP_TAG = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'OPTION', 'SELECT', 'TITLE', 'NOSCRIPT']);

function makeImg(emoji, spec) {
  const img = document.createElement('img');
  img.className = 'pk-emo ' + spec.k;
  img.src = spec.u; img.alt = emoji; img.width = 20; img.height = 20;
  img.decoding = 'async'; img.draggable = false;
  img.addEventListener('error', () => {
    const fb = document.createElement('span');
    fb.setAttribute('data-noemo', '');
    fb.textContent = emoji;
    img.replaceWith(fb);
  }, { once: true });
  return img;
}

// Texto con emojis → lista de nodos (texto + imágenes). Sin emojis mapeados devuelve [texto].
export function emo(text) {
  const s = String(text ?? '');
  RE.lastIndex = 0;
  if (!RE.test(s)) return [s];
  RE.lastIndex = 0;
  const out = [];
  let last = 0, m;
  while ((m = RE.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const spec = EMO[m[1]];
    out.push(spec.t !== undefined ? spec.t : makeImg(m[1], spec));
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  // Une los trozos de texto contiguos.
  const merged = [];
  for (const p of out) {
    if (typeof p === 'string' && typeof merged[merged.length - 1] === 'string') merged[merged.length - 1] += p; else merged.push(p);
  }
  return merged;
}

// Texto plano para sitios donde no caben imágenes (option, title, placeholder…): quita los emojis mapeados.
export function plain(text) {
  const s = String(text ?? '');
  RE.lastIndex = 0;
  if (!RE.test(s)) return s;
  RE.lastIndex = 0;
  return s.replace(RE, (_, k) => (EMO[k].t !== undefined ? EMO[k].t : '')).replace(/^\s+/, '').replace(/ {2,}/g, ' ');
}

// ¿Debe respetarse este nodo? (texto de usuarios, campos, SVG…)
function skipped(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP_TAG.has(el.tagName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return true;
    if (el.hasAttribute('data-noemo') || el.isContentEditable || el.classList.contains('msg-text')) return true;
  }
  return false;
}

function convertText(node) {
  const v = node.nodeValue;
  if (!v) return;
  RE.lastIndex = 0;
  if (!RE.test(v) || skipped(node)) return;
  const parts = emo(v);
  // Solo texto: algunos símbolos se sustituyen por otro parecido (↩️ → ↩). Si no cambia nada no se toca el nodo:
  // reescribirlo dispararía otra vez el observador y la página entraría en un bucle infinito.
  if (parts.length === 1 && typeof parts[0] === 'string') {
    if (parts[0] !== v) node.nodeValue = parts[0];
    return;
  }
  node.replaceWith(...parts);
}

function scan(root) {
  if (root.nodeType === 3) { convertText(root); return; }
  if (root.nodeType !== 1) return;
  if (SKIP_TAG.has(root.tagName)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) found.push(n);
  for (const n of found) convertText(n);
}

let started = false;
export function installEmoji() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const run = () => {
    scan(document.body);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') convertText(m.target);
        else for (const n of m.addedNodes) scan(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  if (document.body) run(); else document.addEventListener('DOMContentLoaded', run, { once: true });
}

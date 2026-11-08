// «Buscar rival» y avisos de combates PvP: estado compartido (retos abiertos, gente buscando), insignias, avisos con botón.
import { S, h, bus, sfx, notify } from './core.js';
import { refreshPvp } from './nav.js';

S.pvp = S.pvp || { list: [], q: { singles: 0, doubles: 0 }, mine: null };

export function initPvp(res) {
  S.pvp.list = res.btChallenges || [];
  S.pvp.q = res.btQueue || { singles: 0, doubles: 0 };
  S.pvp.mine = res.btMine || null;
  refreshPvp();
}

// Aviso con botón «Ir al combate» (el toast normal no admite botones).
export function pvpToast(text, ms = 9000) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = h('div', { class: 'toast toast-success pvp-toast', role: 'status' },
    h('span', { class: 't-txt' }, text),
    h('a', { class: 'btn small gold', href: '#/combates', onclick: () => { t.remove(); } }, 'Ir al combate'));
  box.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

bus.on('battle:list', (l) => { S.pvp.list = l || []; refreshPvp(); });
bus.on('battle:queue', (q) => { S.pvp.q = q || { singles: 0, doubles: 0 }; refreshPvp(); });
bus.on('battle:queue:end', (p) => { S.pvp.mine = null; refreshPvp(); bus.emit('pvp:mine', null); if (p && p.text) pvpToast(p.text, 6000); });
bus.on('battle:ping', (p) => {
  if (!p || !S.me || p.from === S.me.username) return;
  if (p.kind === 'open' && (S.view === 'combates' || S.battle)) return; // ya lo ves en la lista
  if (p.kind === 'match') { S.pvp.mine = null; refreshPvp(); bus.emit('pvp:mine', null); }
  pvpToast(p.text);
  sfx(p.kind === 'match' ? 'big' : 'chat');
  notify(p.text, { link: 'combates' }); // solo avisa fuera de la pestaña y si el jugador activó los avisos
});
bus.on('battle:start', () => { if (S.pvp.mine) { S.pvp.mine = null; refreshPvp(); } });

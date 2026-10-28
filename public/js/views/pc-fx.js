// Animaciones de la Caja PC: evolución (silueta que parpadea cada vez más rápido, destello y estallido)
// y Intercambio Milagroso (carta que se da la vuelta). Respetan prefers-reduced-motion.
import { S, h, sfx, art, sleep, typeBadge, rarityName } from '../core.js';
import { aniImg } from '../anim.js';
import { burstAt, flash, vibrate, reduced } from '../fx.js';

function overlay(content) {
  const ov = h('div', { class: 'pcfx-ov', role: 'dialog', 'aria-modal': 'true' }, content);
  document.body.append(ov);
  return ov;
}

// Devuelve una promesa que se resuelve cuando el jugador cierra la pantalla.
export async function evolveAnim(fromId, toId, shiny) {
  const from = S.dexById.get(fromId);
  const to = S.dexById.get(toId);
  // Sprites animados de Showdown (arte oficial si no existen o están apagados).
  const a = aniImg(fromId, { shiny, cls: 'pcfx-img', alt: from.name, fallback: art(fromId, shiny) });
  const b = aniImg(toId, { shiny, cls: 'pcfx-img pcfx-b', alt: to.name, fallback: art(toId, shiny) });
  const title = h('h2', { class: 'pcfx-title' }, `¿${from.name} está evolucionando?`);
  const stage = h('div', { class: 'pcfx-stage' }, a, b);
  const close = h('button', { class: 'btn primary big pcfx-close hidden', onclick: () => end() }, 'Continuar');
  const ov = overlay([title, stage, close]);
  let end = () => {};
  const done = new Promise((res) => { end = () => { ov.remove(); res(); }; });
  (async () => {
    if (reduced()) {
      a.classList.add('sil'); await sleep(500);
      a.classList.add('gone'); b.classList.add('shown');
    } else {
      sfx('shiny');
      // Alterna silueta A / silueta B, cada vez más deprisa.
      let wait = 520;
      let showB = false;
      a.classList.add('sil'); b.classList.add('sil');
      while (wait > 70) {
        showB = !showB;
        a.classList.toggle('gone', showB); b.classList.toggle('shown', showB);
        await sleep(wait);
        wait *= 0.82;
      }
      flash('#ffffff', 700);
      await sleep(250);
      a.classList.add('gone');
      b.classList.add('shown');
      const r = stage.getBoundingClientRect();
      burstAt(r.left + r.width / 2, r.top + r.height / 2, '#fff7b0', 36, { spread: 240, stars: 0.8 });
      burstAt(r.left + r.width / 2, r.top + r.height / 2, '#8be9ff', 24, { spread: 180, stars: 0.5 });
      vibrate([60, 40, 120]);
      sfx('win');
    }
    b.classList.remove('sil');
    title.textContent = `¡${from.name} evolucionó a ${to.name}!`;
    close.classList.remove('hidden');
    close.focus();
  })();
  return done;
}

// Reveal sencillo: carta boca abajo que se da la vuelta. `res` = { id, name, rarity, isNew }.
export async function wonderReveal(res) {
  const p = S.dexById.get(res.id);
  const front = h('div', { class: 'pcfx-face pcfx-front r-' + p.rarity },
    h('img', { src: art(res.id), alt: p.name }),
    h('b', {}, p.name),
    h('div', { class: 'types' }, p.types.map(typeBadge), h('span', { class: 'rar r-' + p.rarity }, rarityName(p.rarity))),
    res.isNew ? h('div', { class: 'tag' }, '¡NUEVO!') : null);
  const back = h('div', { class: 'pcfx-face pcfx-back' }, h('span', {}, '?'));
  const card = h('div', { class: 'pcfx-card' }, back, front);
  const close = h('button', { class: 'btn primary big pcfx-close hidden', onclick: () => end() }, 'Genial');
  const ov = overlay([h('h2', { class: 'pcfx-title' }, 'Intercambio Milagroso'), card, close]);
  let end = () => {};
  const done = new Promise((r) => { end = () => { ov.remove(); r(); }; });
  (async () => {
    await sleep(reduced() ? 100 : 700);
    card.classList.add('flip');
    sfx('shiny');
    await sleep(reduced() ? 100 : 700);
    const r = card.getBoundingClientRect();
    burstAt(r.left + r.width / 2, r.top + r.height / 2, '#ffd54f', 24, { spread: 180, stars: 0.7 });
    close.classList.remove('hidden');
    close.focus();
  })();
  return done;
}

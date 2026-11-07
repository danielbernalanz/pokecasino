// Animaciones de la Caja PC: evolución (silueta que parpadea cada vez más rápido, destello y estallido)
// y Intercambio Milagroso (carta que se da la vuelta). Respetan prefers-reduced-motion.
import { S, h, sfx, art, sprite, sleep, typeBadge, rarityName, act, toast, fmt, modal } from '../core.js';
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

// ---- EXP, subida de nivel y aviso de evolución («¿Quieres que evolucione?») ----
// Barra de EXP del siguiente nivel: `m` trae level, exp, expLo (EXP del nivel actual) y expHi (la del siguiente; = exp en el Nv. 100).
export function expBar(m, { compact = false } = {}) {
  const max = m.level >= 100;
  const span = Math.max(1, (m.expHi || 0) - (m.expLo || 0));
  const pct = max ? 100 : Math.max(0, Math.min(100, ((m.exp - m.expLo) / span) * 100));
  return h('div', { class: 'exp-wrap' + (compact ? ' compact' : ''), 'data-testid': 'exp-bar' },
    h('div', { class: 'exp-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct), 'aria-label': 'EXP hasta el siguiente nivel' }, h('i', { style: { width: pct + '%' } })),
    compact ? null : h('div', { class: 'small muted exp-txt' }, max ? `Nv. 100 · EXP ${fmt(m.exp)} (máximo)` : `EXP ${fmt(m.exp - m.expLo)} / ${fmt(span)} · faltan ${fmt(m.expHi - m.exp)} para el Nv. ${m.level + 1}`));
}

// Aviso flotante de subida de nivel (no bloquea): «¡Pikachu subió al nivel 12!», con lo que aprende.
export function levelUpFx({ id, shiny, name, from, to, learned = [], pending = [] }) {
  if (!(to > from)) return;
  const mv = [...(learned || []), ...(pending || [])];
  const el = h('div', { class: 'lvlup-pop', role: 'status', 'data-testid': 'levelup-pop' },
    h('img', { class: 'pixel', src: sprite(id, shiny), alt: '' }),
    h('div', {}, h('b', {}, `¡${name} subió al nivel ${to}!`), from + 1 < to ? h('div', { class: 'small muted' }, `+${to - from} niveles (Nv. ${from} → ${to})`) : null, mv.length ? h('div', { class: 'small' }, `Movimientos nuevos: ${mv.length}`) : null));
  document.body.append(el);
  sfx('win');
  if (!reduced()) { const r = el.getBoundingClientRect(); burstAt(r.left + 40, r.top + 30, '#ffd54f', 14, { spread: 90, stars: 0.6 }); }
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}

// Pregunta «¿Quieres que X evolucione?». `info` = { id, uid, shiny, name, to: [{ to, name }] }. Si el jugador acepta, evoluciona (animación incluida) y,
// si tras evolucionar puede seguir evolucionando, vuelve a preguntar. Cancelar no cambia nada: se puede evolucionar después desde la Caja PC.
// Devuelve true si evolucionó.
export async function askEvolution(info) {
  const from = S.dexById.get(info.id);
  const name = info.name || from.name;
  const choice = await new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const body = h('div', { class: 'stack evo-ask', 'data-testid': 'evo-ask' },
      h('div', { class: 'evo-ask-art' }, h('img', { src: art(info.id, info.shiny), alt: from.name })),
      h('p', {}, h('b', {}, `¿Quieres que ${name} evolucione?`)),
      h('div', { class: 'row gap wrap evo-ask-btns' },
        ...info.to.map((t) => h('button', { class: 'btn primary', type: 'button', 'data-evo-to': t.to, onclick: () => finish(t.to) }, info.to.length > 1 ? `Evolucionar a ${t.name}` : `Sí, a ${t.name}`)),
        h('button', { class: 'btn', type: 'button', 'data-evo-cancel': '1', onclick: () => finish(0) }, 'No, que siga como está')),
      h('p', { class: 'small muted' }, 'info.auto ? 'Si ahora no, podrás hacerlo más tarde con un Cordón Unión o un intercambio pendiente (Caja PC → Datos → Entrenar).' : 'Si ahora no, podrás hacerlo cuando quieras en Caja PC → Datos → Entrenar.'));
    const m = modal(body, { title: 'Evolución', onClose: () => finish(0) });
  });
  if (!choice) { if (info.auto) await act('pc:evocancel', { uid: info.uid }); return false; } // cancelar = pulsar B: sin evolucionar; después, Cordón Unión o intercambio pendiente
  const r = await act('pc:evolve', { id: info.id, uid: info.uid, to: choice, ...(info.auto ? { auto: true } : {}) });
  if (!r) { if (info.auto) await act('pc:evocancel', { uid: info.uid }); return false; }
  await evolveAnim(info.id, choice, info.shiny);
  toast(`¡Tu ${name} evolucionó a ${r.name}!${r.form ? ` (${r.form})` : ''}`, 'success');
  if (r.shedinja) toast('¡Con una Poké Ball ha aparecido un Shedinja en tu Caja!', 'success');
  if (r.evo && r.evo.length) await askEvolution({ id: r.to, uid: info.uid, shiny: info.shiny, name: info.nick || S.dexById.get(r.to).name, nick: info.nick, to: r.evo });
  return true;
}

// Resumen tras una victoria o una expedición: subidas de nivel y avisos de evolución (uno detrás de otro). `members` = [{ id, uid, name, shiny, from, to, learned, pending }],
// `evolve` = [{ id, uid, name, shiny, to: [{ to, name }] }].
export async function showProgress({ members = [], evolve = [], pokerus = [] }) {
  for (const m of members) levelUpFx({ id: m.id, shiny: !!m.shiny, name: m.name || S.dexById.get(m.id).name, from: m.from, to: m.to, learned: m.learned, pending: m.pending });
  for (const p of pokerus) { sfx('shiny'); toast(`🦠 ¡${p.name} ha contraído el Pokérus!${p.spread ? ' (contagiado)' : ''} Gana el doble de EVs.`, 'success', 6000); }
  if (members.some((m) => m.to > m.from)) await sleep(900);
  for (const e of evolve) await askEvolution({ id: e.id, uid: e.uid, shiny: !!e.shiny, name: e.name || S.dexById.get(e.id).name, to: e.to });
}

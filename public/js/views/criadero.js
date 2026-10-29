// Criadero (fase B5): deja a dos Pokémon compatibles, recoge el huevo y hazlo eclosionar jugando.
import { S, h, fmt, act, emit, sfx, toast, modal, art, hpBar, say, emptyState, loader, MON, sleep } from '../core.js';
import { aniImg } from '../anim.js';
import { burstAt, flash, reduced, confetti } from '../fx.js';
import { clock, loadMons, monTile, monPicker } from './afk-common.js';

const cfg = () => S.data.daycare;
const NATURE_NOTE = 'Hereda 3 IV de los padres y, con un 50 %, la naturaleza de uno de ellos.';

// Animación de eclosión: huevo que tiembla → grieta → destello → Pokémon animado.
async function hatchAnim(r) {
  const p = S.dexById.get(r.id);
  const egg = h('span', { class: 'egg-img shake', 'aria-hidden': 'true', style: { fontSize: '120px', lineHeight: 1 } }, '🥚');
  const flashEl = h('div', { class: 'hatch-flash' });
  const stage = h('div', { class: 'hatch-stage' }, egg, flashEl);
  const title = h('h2', { class: 'pcfx-title' }, '¡Algo se mueve dentro del huevo!');
  const info = h('div', { class: 'stack hatch-info', style: { alignItems: 'center' } });
  const ov = h('div', { class: 'hatch-ov', role: 'dialog', 'aria-label': 'Eclosión' }, title, stage, info);
  document.body.append(ov);
  const fast = reduced();
  await sleep(fast ? 300 : 1700);
  egg.classList.add('crack'); egg.textContent = '🐣'; sfx('click');
  await sleep(fast ? 200 : 800);
  flashEl.classList.add('go'); flash('#ffffff', 500); sfx(r.shiny ? 'shiny' : 'win');
  await sleep(fast ? 100 : 280);
  egg.remove();
  const mon = aniImg(r.id, { shiny: r.shiny, cls: 'hatch-mon', alt: p.name, fallback: art(r.id, r.shiny) });
  stage.append(mon);
  requestAnimationFrame(() => mon.classList.add('in'));
  title.textContent = `¡Ha nacido ${r.shiny ? '✨ ' : ''}${p.name}!`;
  if (!fast) { const [x, y] = [innerWidth / 2, innerHeight / 2.4]; burstAt(x, y, r.shiny ? '#ffd54f' : '#ff9ec4', r.shiny ? 40 : 24, { spread: 220, stars: 0.6 }); if (r.shiny) confetti({ count: 50 }); }
  const bits = [r.isNew ? '¡Nueva entrada en la Pokédex!' : null, `+${r.candy} 🍬 caramelos de su familia`, r.dust ? `Ya tenías 5 estrellas: +${r.dust} ✦` : null, r.nature ? `Naturaleza ${r.nature}` : null].filter(Boolean);
  info.replaceChildren(...bits.map((t) => h('div', { class: 'small' }, t)), h('button', { class: 'btn primary big', onclick: () => ov.remove() }, '¡Genial!'));
  await new Promise((res) => { const done = new MutationObserver(() => { if (!ov.isConnected) { done.disconnect(); res(); } }); done.observe(document.body, { childList: true }); });
}

export default {
  id: 'criadero', title: 'Criadero', icon: '🥚',
  async mount(root) {
    let st = null;
    let skew = 0;
    let tick = 0;
    const sel = {}; // plaza → [mon|null, mon|null]
    const checks = {}; // plaza → respuesta de care:check
    const sayBox = h('div', {});
    const slots = h('div', { class: 'care-slots' });
    const eggs = h('div', { class: 'care-eggs' });
    const live = [];
    const now = () => Date.now() + skew;
    let speech = { text: 'Hola, entrenador. Déjame dos Pokémon que se lleven bien y te guardaré un huevo.' };
    const setSay = (text) => { speech = { text }; sayBox.replaceChildren(say({ emoji: '👩‍🌾', who: 'Criadora', text, cls: 'compact' })); };
    function apply(r) { if (r.now) skew = r.now - Date.now(); st = r; render(); }

    async function chooseParent(slot, which) {
      let mons;
      try { mons = await loadMons(); } catch (e) { return toast(e.message, 'error'); }
      const cur = sel[slot] || [null, null];
      const other = cur[1 - which];
      const chosen = new Set();
      const picker = monPicker(mons, { max: 1, selected: chosen,
        can: (m) => (m.away ? (m.away === 'care' ? 'En el Criadero' : 'De expedición') : (['L', 'M'].includes(S.dexById.get(m.id).rarity) ? 'No cría' : (other && other.uid === m.uid ? 'Ya elegido' : null))),
        onChange: () => { const m = picker.get()[0]; if (m) { cur[which] = m; sel[slot] = cur; mdl.close(); verify(slot); } } });
      const mdl = modal(h('div', { class: 'stack' }, h('p', { class: 'small muted' }, 'Comparten tipo, o uno de ellos es Ditto. Los legendarios y míticos no crían.'), picker.el), { title: `Padre ${which + 1}`, wide: true });
    }
    async function verify(slot) {
      const [a, b] = sel[slot] || [];
      if (a && b) {
        try {
          const r = await emit('care:check', { a: { id: a.id, uid: a.uid }, b: { id: b.id, uid: b.uid } });
          checks[slot] = r;
          setSay(r.ok ? `${r.msg} Saldrá un ${S.dexById.get(r.baby).name} en ${r.hours} h. La tarifa para recoger el huevo: ${fmt(r.fee)} monedas.` : r.msg);
        } catch (e) { checks[slot] = { ok: false, msg: e.message }; setSay(e.message); }
      } else { checks[slot] = null; setSay('Elige a los dos padres.'); }
      render();
    }

    function parentSlot(slot, which, m, locked) {
      if (m) return h('button', { type: 'button', class: 'care-slot filled', disabled: !!locked, title: locked ? '' : 'Cambiar', onclick: () => !locked && chooseParent(slot, which) }, monTile(m));
      return h('button', { type: 'button', class: 'care-slot', onclick: () => chooseParent(slot, which) }, h('span', { class: 'muted' }, `➕ Padre ${which + 1}`));
    }

    function pairCard(pr, slot) {
      if (!pr) {
        const [a, b] = sel[slot] || [null, null];
        const ck = checks[slot];
        return h('div', { class: 'care-pair' },
          h('b', {}, `Plaza ${slot + 1}`),
          h('div', { class: 'care-parents' }, parentSlot(slot, 0, a), h('span', { class: 'care-heart', 'aria-hidden': 'true' }, ck && ck.ok ? '💕' : '➕'), parentSlot(slot, 1, b)),
          ck ? h('div', { class: 'small ' + (ck.ok ? 'good' : 'bad') }, ck.msg) : h('div', { class: 'small muted' }, 'Elige dos Pokémon de la Caja PC.'),
          h('div', { class: 'care-actions' }, h('button', { class: 'btn primary', disabled: !(ck && ck.ok), onclick: async (e) => {
            const r = await act('care:deposit', { slot, a: { id: a.id, uid: a.uid }, b: { id: b.id, uid: b.uid } }, e.currentTarget);
            if (!r) return;
            sfx('win'); delete sel[slot]; delete checks[slot]; setSay('¡Los cuido yo! Vuelve en unas horas a por el huevo.'); apply(r);
          } }, '🥚 Dejar en el Criadero')));
      }
      const baby = S.dexById.get(pr.baby);
      const left = pr.readyAt - now();
      const ready = left <= 0;
      const total = pr.hours * 3600 * 1000;
      const bar = hpBar(ready ? 100 : Math.max(0, (1 - left / total) * 100), 'thin');
      const txt = h('span', { class: 'small' }, ready ? '¡Hay un huevo esperando!' : `Huevo en ${clock(left)}`);
      if (!ready) live.push({ pr, bar, txt, total });
      const mk = (t, i) => ({ id: t.id, uid: t.uid, level: 0, shiny: pr.shiny[i], nick: '' });
      return h('div', { class: 'care-pair' },
        h('b', {}, `Plaza ${slot + 1}`),
        h('div', { class: 'care-parents' }, h('div', { class: 'care-slot filled' }, monTile(mk(pr.a, 0), { cls: 'compact' })), h('span', { class: 'care-heart', 'aria-hidden': 'true' }, '💕'), h('div', { class: 'care-slot filled' }, monTile(mk(pr.b, 1), { cls: 'compact' }))),
        h('div', { class: 'small' }, `Saldrá un ${baby.name} · cada ${pr.hours} h · tarifa ${fmt(pr.fee)} 🪙`), bar, txt,
        h('div', { class: 'care-actions' },
          h('button', { class: 'btn gold', disabled: !ready || st.eggs.length >= st.maxEggs, title: st.eggs.length >= st.maxEggs ? 'Ya llevas el máximo de huevos' : '', onclick: async (e) => {
            const r = await act('care:collect', { slot }, e.currentTarget);
            if (r) { sfx('shiny'); toast(`Recogiste el huevo (−${fmt(r.fee)} monedas)`, 'success'); setSay('¡Aquí tienes! Cuídalo bien: juega para que eclosione.'); apply(r); }
          } }, `🥚 Recoger (${fmt(pr.fee)} 🪙)`),
          h('button', { class: 'btn', onclick: async (e) => { const r = await act('care:withdraw', { slot }, e.currentTarget); if (r) { toast('Vuelven a tu Caja PC', 'success'); setSay('Muy bien, ¡hasta pronto!'); apply(r); } } }, 'Retirar')));
    }

    function eggCard(e) {
      const ready = e.ready;
      const pct = Math.min(100, e.steps / e.need * 100);
      const left = e.hatchAt - now();
      const bar = hpBar(pct, 'thin');
      const hatchBtn = h('button', { class: 'btn gold', disabled: !ready, onclick: async (ev) => {
        const r = await act('care:hatch', { id: e.id }, ev.currentTarget);
        if (!r) return;
        apply(r);
        await hatchAnim(r.hatched);
        setSay(r.hatched.shiny ? '¡¡Un variocolor!! ¡Qué suerte!' : '¡Mira qué cosita más bonita!');
      } }, ready ? '🐣 ¡Eclosionar!' : 'Aún no está listo');
      if (!ready) live.push({ egg: e });
      return h('div', { class: 'care-egg' + (ready ? ' ready' : '') },
        h('span', { class: 'egg-img ' + (ready ? 'ready' : 'wobble'), style: { fontSize: '72px', lineHeight: 1.1 }, 'aria-hidden': 'true' }, '🥚'),
        h('b', {}, 'Huevo'), bar,
        h('span', { class: 'small' }, `${e.steps}/${e.need} pasos · 100 monedas apostadas = 1 paso`),
        h('span', { class: 'small muted' }, ready ? '¡Está a punto de salir!' : `O espera ${clock(left)}`),
        hatchBtn);
    }

    function render() {
      live.length = 0;
      const n = st.maxPairs;
      slots.replaceChildren(...Array.from({ length: n }, (_, i) => pairCard(st.pairs[i], i)));
      eggs.replaceChildren(...(st.eggs.length ? st.eggs.map(eggCard) : [emptyState('Aún no llevas ningún huevo.', MON.togepi || MON.snorlax)]));
    }

    setSay(speech.text);
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🥚 Criadero')), sayBox,
      h('h2', { class: 'section-title' }, 'Parejas'), slots,
      h('p', { class: 'small muted' }, `${NATURE_NOTE} Variocolor: 1/128 (1/64 si algún padre lo es). Recoger el huevo cuesta una tarifa según la rareza (desde ${cfg().feeMin} monedas). La segunda plaza se desbloquea en el nivel ${cfg().pair2Level}.`),
      h('h2', { class: 'section-title' }, 'Tus huevos'), eggs);
    root.append(loader('Despertando a la Criadora…'));
    try { apply(await emit('care:view')); } catch (e) { toast(e.message, 'error'); } finally { root.querySelector('.loader')?.remove(); }
    tick = setInterval(() => {
      if (!slots.isConnected) { clearInterval(tick); return; } // la pantalla ya no está: no se queda un temporizador huérfano
      let change = false;
      for (const l of live) {
        if (l.pr) {
          const left = l.pr.readyAt - now();
          if (left <= 0) { change = true; break; }
          l.txt.textContent = `Huevo en ${clock(left)}`;
          const f = l.bar.querySelector('i'); if (f) f.style.width = Math.min(100, Math.max(0, (1 - left / l.total) * 100)) + '%';
        } else if (l.egg && now() >= l.egg.hatchAt) { change = true; break; }
      }
      if (change) { emit('care:view').then(apply).catch(() => {}); }
    }, 1000);
    this.stop = () => clearInterval(tick);
  },
  unmount() { this.stop && this.stop(); },
};

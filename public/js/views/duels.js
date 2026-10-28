import { S, h, fmt, act, sfx, bus, sprite, art, img, animImg, modal, typeBadge, sleep, confirmBet } from '../core.js';
import { aniImg, animEnabled, TYPE_COLOR } from '../anim.js';
import { pickPokemon } from '../picker.js';
import { burstEl, shake, flash, confetti, coinRain, vibrate, floatText, reduced } from '../fx.js';

// Reproduce un combate con animaciones.
export function playBattle(record) {
  const meIdx = record.players.indexOf(S.me.username);
  const side = meIdx === -1 ? 0 : meIdx; // el lado "propio" se dibuja de espaldas
  const f = record.fighters;
  const hp = [f[0].maxHp, f[1].maxHp];
  const bars = [0, 1].map(() => h('i', {}));
  const hpTxt = [0, 1].map((i) => h('span', {}, `${hp[i]}/${f[i].maxHp}`));
  // Sprites animados de Showdown (rival de frente, el propio de espaldas); sin ellos, el estático.
  // Con Mega se pinta la forma Mega (arte oficial) cuando las animaciones están apagadas.
  const fimg = (i, back) => (!animEnabled() && f[i].mega
    ? img(art(f[i].mega, f[i].shiny), { cls: 'pixel bt-sprite', alt: f[i].name, fallback: art(f[i].mega, false) })
    : aniImg(f[i].id, { shiny: f[i].shiny, back, mega: f[i].mega || 0, cls: 'pixel bt-sprite', alt: f[i].name }));
  const spr = [0, 1].map((i) => fimg(i, i === side));
  const slot = spr.map((el, i) => h('div', { class: 'bt-slot' + (i === side ? ' mine' : '') }, el));
  const box = (i) => h('div', { class: 'bt-box' }, h('b', {}, (f[i].mega ? '💠 ' : '') + f[i].name + (f[i].nick ? ` «${f[i].nick}»` : '') + (f[i].shiny ? ' ✨' : '')), h('span', { class: 'muted small' }, ` ${f[i].owner} · ${'★'.repeat(f[i].stars)}`),
    h('div', { class: 'types' }, f[i].types.map(typeBadge)), h('div', { class: 'hpbar' }, bars[i]), hpTxt[i]);
  const text = h('div', { class: 'bt-text' }, `¡${record.players[0]} y ${record.players[1]} se enfrentan!`);
  const other = 1 - side;
  const pop = h('div', { class: 'bt-pop', 'aria-hidden': 'true' });
  const say = (txt, kind) => { pop.textContent = txt; pop.className = 'bt-pop'; void pop.offsetWidth; pop.className = 'bt-pop show ' + kind; };
  const scene = h('div', { class: 'battle' },
    h('div', { class: 'bt-foe' }, box(other), slot[other]),
    h('div', { class: 'bt-me' }, slot[side], box(side)),
    pop,
    text);
  const skipBtn = h('button', { class: 'btn', onclick: () => { skip = true; } }, 'Saltar ⏩');
  let skip = false;
  const m = modal(h('div', { class: 'stack' }, scene, skipBtn), { title: `⚔️ Duelo${record.wager ? ' por ' + fmt(record.wager) : ' amistoso'}`, wide: true });
  const setHp = (i, v) => {
    const pct = (v / f[i].maxHp) * 100;
    bars[i].style.width = pct + '%';
    bars[i].className = pct < 20 ? 'red' : pct < 50 ? 'yellow' : '';
    hpTxt[i].textContent = `${v}/${f[i].maxHp}`;
  };
  setHp(0, hp[0]); setHp(1, hp[1]);
  (async () => {
    await sleep(900);
    for (const ev of record.log) {
      if (!document.contains(scene)) return;
      const att = f[ev.by];
      const tgt = 1 - ev.by;
      let line = `${att.name} usó ${ev.move}.`;
      if (ev.miss) line += ' ¡Pero falló!';
      else if (ev.eff === 0) line += ` No afecta a ${f[tgt].name}…`;
      else {
        if (ev.crit) line += ' ¡Golpe crítico!';
        if (ev.eff > 1) line += ' ¡Es muy eficaz!';
        if (ev.eff < 1) line += ' No es muy eficaz…';
      }
      text.textContent = line;
      if (!skip) {
        spr[ev.by].classList.add('lunge'); sfx('click');
        await sleep(300);
        spr[ev.by].classList.remove('lunge');
        if (!ev.miss && ev.dmg) {
          const strong = ev.crit || ev.eff > 1;
          const col = TYPE_COLOR[ev.type] || '#ffffff';
          spr[tgt].classList.add('hit'); sfx(ev.eff > 1 ? 'boom' : 'flip');
          slot[tgt].classList.add(ev.crit ? 'shake-big' : 'shake');
          // Partículas del color del tipo del ataque; más y con estrellas si es crítico o supereficaz.
          burstEl(spr[tgt], col, strong ? 26 : 12, { spread: strong ? 150 : 80, stars: strong ? 0.5 : 0.15 });
          if (ev.crit) burstEl(spr[tgt], '#ffffff', 10, { spread: 110, stars: 0.8 });
          floatText(`-${ev.dmg}`, spr[tgt], { color: ev.crit ? '#ff5a5a' : '#fff', size: ev.crit ? 30 : 22 });
          if (ev.crit) say('¡Golpe crítico!', 'crit');
          else if (ev.eff > 1) say('¡Es muy eficaz!', 'good');
          else if (ev.eff < 1) say('No es muy eficaz…', 'meh');
          if (strong && !reduced()) { shake(scene, 350); vibrate(ev.crit ? [50, 30, 50] : 40); }
          if (ev.crit) flash('#ffffff', 160);
        } else if (ev.miss) say('¡Falló!', 'meh');
        else if (ev.eff === 0) say('No afecta…', 'meh');
      }
      setHp(0, ev.hp[0]); setHp(1, ev.hp[1]);
      if (!skip) { await sleep(600); spr[tgt].classList.remove('hit'); slot[tgt].classList.remove('shake', 'shake-big'); }
    }
    const w = record.winner;
    spr[1 - w].classList.add('faint'); slot[1 - w].classList.add('down');
    text.replaceChildren(h('b', {}, `🏆 ¡${record.players[w]} gana con ${f[w].name}!`), record.prize ? ` +${fmt(record.prize)} monedas` : '');
    const won = record.players[w] === S.me.username;
    sfx(won ? 'big' : 'lose');
    if (won) {
      burstEl(spr[w], '#ffd54f', 40, { spread: 260, stars: 0.6 });
      confetti({ count: 40 });
      vibrate([40, 30, 80]);
      if (record.prize) { if (record.prize >= 5000) flash('#ffe08a', 400); coinRain(record.prize, { from: spr[w] }); }
    }
    skipBtn.textContent = 'Cerrar';
    skipBtn.onclick = m.close;
  })();
}

const hSpr = (x) => (x.mega ? img(art(x.mega, x.shiny), { cls: 'pixel', alt: '', fallback: art(x.mega, false) }) : h('img', { class: 'pixel', src: sprite(x.id, x.shiny), alt: '' }));
const pickName = (p) => (p.mega ? '💠 ' + (S.megaById.get(p.mega)?.name || '') : S.dexById.get(p.id).name);

// Pokémon elegidos en los retos que he creado (solo en esta sesión).
const myPicks = {};

export default {
  id: 'duels', title: 'Duelos PvP', icon: '⚔️',
  mount(root) {
    let chosen = null;
    const chosenBox = h('div', { class: 'chosen' });
    const wager = h('input', { type: 'number', min: 0, step: 10, value: 200 });
    const target = h('input', { list: 'online-users', placeholder: 'Cualquiera (opcional)' });
    const datalist = h('datalist', { id: 'online-users' }, S.online.filter((u) => u.username !== S.me.username).map((u) => h('option', { value: u.username })));
    const showChosen = () => chosenBox.replaceChildren(chosen
      ? h('div', { class: 'row gap' }, hSpr(chosen), h('b', {}, pickName(chosen) + (chosen.shiny ? ' ✨' : '')))
      : h('span', { class: 'muted' }, 'Ningún Pokémon elegido'));
    showChosen();
    const openBox = h('div', { class: 'duel-list' });
    const histBox = h('div', { class: 'duel-list' });

    function renderOpen() {
      const list = S.duels || [];
      if (!list.length) { openBox.replaceChildren(h('p', { class: 'muted' }, 'No hay retos abiertos. ¡Crea el primero!')); return; }
      openBox.replaceChildren(...list.map((d) => {
        const mine = d.creator === S.me.username;
        const forOther = d.target && d.target !== S.me.username && !mine;
        // El Pokémon del rival está oculto; solo el creador recuerda el suyo en esta sesión.
        const own = mine && myPicks[d.id];
        return h('div', { class: 'duel-row' + (d.target === S.me.username ? ' for-me' : '') },
          own ? (own.mega ? img(art(own.mega, own.shiny), { cls: 'pixel duel-sprite', alt: '', fallback: art(own.mega, false) }) : animImg(own.id, own.shiny, 'duel-sprite')) : h('div', { class: 'duel-hidden' }, '?'),
          h('div', { class: 'grow' },
            h('b', {}, d.creator), mine ? ' (tú) ' : ' ', own ? `retas con ${pickName(own)}${own.shiny ? ' ✨' : ''}` : 'reta con un Pokémon oculto',
            h('div', { class: 'muted small' }, d.target ? `Reto directo a ${d.target}` : 'Reto abierto'),
            mine ? h('div', { class: 'muted small' }, 'Tu rival no ve tu Pokémon hasta que empieza el combate.') : null),
          h('div', { class: 'wager' }, d.wager ? fmt(d.wager) : 'Amistoso'),
          mine
            ? h('button', { class: 'btn danger', onclick: (e) => act('duel:cancel', { id: d.id }, e.target) }, 'Cancelar')
            : h('button', { class: 'btn primary', disabled: forOther, onclick: async (e) => {
              const pick = await pickPokemon({ title: `Elige tu Pokémon a ciegas contra ${d.creator}`, mega: true });
              if (!pick) return;
              if (d.wager && !(await confirmBet('duels', d.wager, { what: 'jugarte en este duelo' }))) return;
              const r = await act('duel:accept', { id: d.id, pokeId: pick.id, shiny: pick.shiny, mega: pick.mega || 0 }, e.target);
              if (r) playBattle(r.record);
            } }, '¡Aceptar!'));
      }));
    }
    function renderHist() {
      const list = S.duelHistory || [];
      histBox.replaceChildren(...(list.length ? list.map((r) => h('div', { class: 'duel-row small' },
        hSpr(r.fighters[0]),
        h('span', { class: r.winner === 0 ? 'good' : '' }, r.players[0]), ' vs ',
        h('span', { class: r.winner === 1 ? 'good' : '' }, r.players[1]),
        hSpr(r.fighters[1]),
        h('span', { class: 'grow muted' }, r.wager ? `${fmt(r.wager)} c/u` : 'amistoso'),
        h('button', { class: 'btn', onclick: async () => { const x = await act('duel:replay', { id: r.id }); if (x && x.record) playBattle(x.record); } }, '▶ Ver')))
        : [h('p', { class: 'muted' }, 'Aún no hay combates.')]));
    }

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '⚔️ Duelos PvP'), h('p', { class: 'muted' }, 'Combate 1 contra 1 a nivel 50 con elección a ciegas: ninguno ve el Pokémon del otro hasta que empieza. Cuentan las estadísticas, las estrellas, la versión variocolor y la tabla de tipos.',
        S.events && S.events.active.some((e) => e.id === 'duels') ? h('span', { class: 'event-pill' }, '⚔️ Lunes de Duelos: sin comisión') : null)),
      h('div', { class: 'duel-layout' },
        h('div', { class: 'card stack' },
          h('h3', {}, 'Crear reto'),
          chosenBox,
          h('button', { class: 'btn', onclick: async () => { const p = await pickPokemon({ mega: true }); if (p) { chosen = p; showChosen(); } } }, 'Elegir Pokémon'),
          h('label', {}, 'Apuesta (0 = amistoso)', wager),
          h('label', {}, 'Rival', target, datalist),
          h('button', { class: 'btn primary big', onclick: async (e) => {
            if (!chosen) return pickPokemon({ mega: true }).then((p) => { if (p) { chosen = p; showChosen(); } });
            const wg = Number(wager.value) || 0;
            if (wg && !(await confirmBet('duels', wg, { what: 'poner en juego' }))) return;
            const r = await act('duel:create', { pokeId: chosen.id, shiny: chosen.shiny, mega: chosen.mega || 0, wager: Number(wager.value) || 0, target: target.value.trim() || null }, e.target);
            if (r) { myPicks[r.duel.id] = { id: chosen.id, shiny: chosen.shiny, mega: chosen.mega || 0 }; sfx('click'); renderOpen(); }
          } }, 'Publicar reto'),
          h('p', { class: 'muted small' }, 'El ganador se lleva el bote menos un 5 % de comisión de la casa. Los retos caducan a los 10 minutos.')),
        h('div', { class: 'stack' }, h('h3', {}, 'Retos abiertos'), openBox, h('h3', {}, 'Últimos combates'), histBox)));
    renderOpen(); renderHist();
    this.offs = [bus.on('duels', renderOpen), bus.on('duel:result', (r) => { renderHist(); if (r.players[0] === S.me.username) playBattle(r); })];
  },
  unmount() { this.offs.forEach((f) => f()); },
};

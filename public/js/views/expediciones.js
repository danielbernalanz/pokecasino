// Expediciones AFK (fase B6): envía a tu equipo a una zona y recoge el botín al volver.
import { S, h, act, emit, fmt, sfx, toast, modal, sprite, typeBadge, hpBar, say, emptyState, loader, itemImg, MON } from '../core.js';
import { aniImg } from '../anim.js';
import { burstEl, reduced } from '../fx.js';
import { clock, loadMons, monPicker } from './afk-common.js';
import { berryImg } from './huerto.js';
import { phaseNow, PHASE, timeSpecies } from '../daytime.js';
import { showProgress } from './pc-fx.js';

const EV_SHORT = ['PS', 'Ataque', 'Defensa', 'At. Esp.', 'Def. Esp.', 'Velocidad'];
const cfg = () => S.data.expedition;
const zoneOf = (id) => cfg().zones.find((z) => z.id === id);
const matches = (zone, pid) => S.dexById.get(pid).types.some((t) => zone.types.includes(t));
const typesEl = (zone) => h('span', { class: 'types' }, zone.types.map(typeBadge));

// Estimación de lo que dará (las monedas con el mismo cálculo que el servidor; el resto, aproximado).
function estimate(zone, hours, team) {
  const n = team.length || 1;
  const hit = team.filter((m) => matches(zone, m.id)).length;
  const coins = Math.round(hours * 8 * (1 + cfg().matchBonus * hit / n));
  // EXP por hora y participante: base + por nivel; ×1,5 si encaja con la zona (aproximado: sin tope diario ni Huevo Suerte).
  const exp = team.map((m) => Math.round(hours * (cfg().expBase + cfg().expLevel * (m.level || 5)) * (matches(zone, m.id) ? 1 + cfg().matchBonus : 1)));
  return { coins, exp, hit };
}

// Camino con el equipo paseando (animación CSS; sin movimiento si el sistema lo pide).
function track(zone, e, done) {
  return h('div', { class: 'afk-track' + (done ? ' done' : ''), 'aria-hidden': 'true' },
    h('span', { class: 'afk-ground' }),
    ...e.team.map((t, i) => h('img', { class: 'afk-walker pixel', src: sprite(t.id, t.shiny), alt: '', style: { animationDelay: `${-i * 1.6}s`, '--lane': `${i * 7}px` } })),
    h('span', { class: 'afk-flag' }, done ? '🏁' : '🧭'));
}

export default {
  id: 'expediciones', title: 'Expediciones', icon: '🧭',
  async mount(root) {
    let st = null;
    let skew = 0;
    let tick = 0;
    const running = h('div', { class: 'afk-running' });
    const zones = h('div', { class: 'afk-zones' });
    const live = [];
    const now = () => Date.now() + skew;
    const intro = say({ emoji: '🧑‍🔬', who: 'Prof. Oak', text: 'Tus Pokémon pueden explorar por su cuenta. Elige una zona, mándalos de 1 a 12 horas y ¡recoge el botín cuando vuelvan! Los Pokémon de noche (Gastly, Zubat…) rinden más si salen de noche, y los de día (Ledyba, Cherubi…) de día.', cls: 'compact' });

    function apply(r) { if (r.now) skew = r.now - Date.now(); st = r; render(); }

    function runCard(e) {
      const zone = zoneOf(e.zone);
      const total = e.end - e.start;
      const left = e.end - now();
      const ready = left <= 0;
      const bar = hpBar(ready ? 100 : Math.max(0, (1 - left / total) * 100), 'thin');
      const txt = h('span', { class: 'small afk-count' }, ready ? '¡Han vuelto!' : `Vuelven en ${clock(left)}`);
      if (!ready) live.push({ e, bar, txt, total });
      return h('div', { class: `afk-run tone-${zone.tone}` + (ready ? ' ready' : '') },
        h('div', { class: 'afk-run-head' }, h('img', { class: 'pixel afk-host', src: sprite(zone.hostId), alt: '' }),
          h('div', { class: 'grow' }, h('b', {}, zone.name), h('div', { class: 'small muted' }, `${e.hours} h · ${e.team.length} Pokémon`))),
        track(zone, e, ready), bar, txt,
        ready
          ? h('button', { class: 'btn gold big', onclick: (ev) => claim(e, ev.currentTarget) }, '🎒 Recoger el botín')
          : h('div', { class: 'small muted' }, 'Mientras tanto no pueden liberarse, venderse ni combatir.'));
    }

    async function claim(e, btn) {
      const r = await act('exp:claim', { id: e.id }, btn);
      if (!r) return;
      sfx('shiny');
      apply(r);
      reveal(r.reward);
    }

    function reveal(rw) {
      const zone = zoneOf(rw.zone);
      const rows = [];
      for (const m of rw.members) {
        const p = S.dexById.get(m.id);
        rows.push(h('div', { class: 'afk-rw-mon' }, h('img', { class: 'pixel', src: sprite(m.id), alt: '' }),
          h('div', { class: 'grow' }, h('b', {}, p.name + (m.match ? ' ⭐' : '')),
            h('div', { class: 'small muted' }, `+${fmt(m.exp)} EXP · Nv. ${m.from}${m.to > m.from ? ` → ${m.to}` : ''} · +${m.friend} ♥${m.ev ? ` · +${m.ev} EV ${EV_SHORT[rw.evStat]}` : ''}${m.time ? ' · 🌙☀️ +25 %' : ''}`))));
      }
      const loot = [];
      for (const [c, q] of Object.entries(rw.candies || {})) loot.push(h('span', { class: 'afk-rw-chip gold' }, itemImg(c), `×${q}`));
      if (rw.amulet) loot.push(h('span', { class: 'afk-rw-chip gold' }, itemImg('hi-amuletcoin'), '¡Moneda Amuleto!'));
      if (rw.lucky) loot.push(h('span', { class: 'afk-rw-chip gold' }, itemImg('hi-luckyegg'), '¡Huevo Suerte!'));
      for (const [b, q] of Object.entries(rw.berries)) loot.push(h('span', { class: 'afk-rw-chip' }, berryImg(b), `×${q}`));
      if (rw.dust) loot.push(h('span', { class: 'afk-rw-chip' }, `✦ ${rw.dust}`));
      if (rw.coins) loot.push(h('span', { class: 'afk-rw-chip gold' }, `🪙 ${rw.coins}`));
      if (rw.item) loot.push(h('span', { class: 'afk-rw-chip gold' }, itemImg(rw.item), S.data.items[rw.item].name));
      for (const [mt, q] of Object.entries(rw.mats || {})) loot.push(h('span', { class: 'afk-rw-chip' }, itemImg(mt), `×${q}`));
      for (const [sh, q] of Object.entries(rw.shards || {})) loot.push(h('span', { class: 'afk-rw-chip gold' }, itemImg(sh), `×${q}`));
      if (rw.evoItem) loot.push(h('span', { class: 'afk-rw-chip gold' }, itemImg(rw.evoItem), S.data.items[rw.evoItem].name));
      if (rw.tm) loot.push(h('span', { class: 'afk-rw-chip gold' }, itemImg(rw.tm), S.data.items[rw.tm].name));
      const body = h('div', { class: 'stack afk-reveal' },
        say({ mon: zone.hostId, who: zone.host, text: `¡Qué bien lo hemos pasado en ${zone.name}! Mira lo que hemos traído.`, cls: 'compact' }),
        h('div', { class: 'afk-rw-mons' }, rows),
        h('div', { class: 'afk-rw-loot' }, loot),
        rw.lovers ? h('p', { class: 'small good' }, `💖 ${rw.lovers === 1 ? 'Un Pokémon que te adora ha traído' : rw.lovers + ' Pokémon que te adoran han traído'} un 10 % más de EXP, bayas y polvo (las monedas no cambian).`) : null,
        h('p', { class: 'small muted' }, `EXP total: ${fmt(rw.exp)} (con tope diario por Pokémon). Los Caramelos Exp. ya están en tu mochila.`));
      const m = modal(body, { title: '🧭 ¡Expedición completada!', onClose: () => showProgress({ evolve: rw.evolve || [] }) });
      showProgress({ members: rw.members.filter((x) => x.to > x.from), pokerus: rw.pokerus || [] }); // avisos de nivel y Pokérus al momento; la evolución, al cerrar el resumen
      if (!reduced()) setTimeout(() => { const c = m.el.querySelector('.afk-rw-loot'); if (c) burstEl(c, '#ffd54f', 24, { spread: 150, stars: 0.6 }); }, 150);
    }

    async function openSend(zone) {
      let mons;
      try { mons = await loadMons(); } catch (e) { return toast(e.message, 'error'); }
      let hours = 4;
      const sel = new Set();
      const info = h('div', { class: 'afk-est small' });
      const sendBtn = h('button', { class: 'btn primary big', disabled: true, onclick: async (ev) => {
        const team = picker.get().map((x) => ({ id: x.id, uid: x.uid }));
        const r = await act('exp:send', { zone: zone.id, hours, team }, ev.currentTarget);
        if (!r) return;
        sfx('win');
        toast(`¡Tu equipo se fue a ${zone.name}! Vuelven en ${hours} h.`, 'success');
        mdl.close();
        apply(r);
      } }, '🧭 ¡A explorar!');
      const hoursRow = h('div', { class: 'afk-hours', role: 'group', 'aria-label': 'Duración' });
      function update() {
        const team = picker.get();
        hoursRow.replaceChildren(...cfg().hours.map((x) => h('button', { type: 'button', class: 'chip' + (x === hours ? ' active' : ''), 'aria-pressed': x === hours ? 'true' : 'false', onclick: () => { hours = x; update(); } }, `${x} h`)));
        sendBtn.disabled = team.length < 1;
        if (!team.length) { info.replaceChildren('Elige de 1 a 3 Pokémon.'); return; }
        const e = estimate(zone, hours, team);
        info.replaceChildren(h('div', {}, `Con ${e.hit} de ${team.length} que encajan con la zona (+${Math.round(cfg().matchBonus * 100)} % cada uno):`),
          h('div', {}, `⭐ ≈ ${e.exp.map(fmt).join(' + ')} EXP (con tope diario por Pokémon) · Caramelos Exp. · ♥ amistad`),
          h('div', {}, `🪙 ${e.coins} monedas (máx. ${cfg().caps.coins} al día) · bayas, polvo y, a veces, un objeto raro`));
      }
      const picker = monPicker(mons, { max: cfg().maxTeam, selected: sel, onChange: update,
        can: (m) => (m.away ? (m.away === 'care' ? 'En el Criadero' : 'De expedición') : null),
        mark: (m) => (matches(zone, m.id) ? '⭐' : ''),
        // Primero los que encajan con la zona (más botín), y entre ellos los de más nivel (más EXP).
        rank: (m) => (matches(zone, m.id) ? 1000 : 0) + (m.level || 0) });
      const mdl = modal(h('div', { class: 'stack' },
        h('div', { class: 'afk-zone-head' }, h('img', { class: 'pixel afk-host', src: sprite(zone.hostId), alt: '' }), h('div', {}, h('b', {}, zone.name), typesEl(zone), h('div', { class: 'small muted' }, `⭐ = comparte tipo con la zona`))),
        h('h4', {}, 'Duración'), hoursRow, h('h4', {}, 'Equipo (1 a 3)'), picker.el, info, sendBtn), { title: `Enviar a ${zone.name}`, wide: true });
      update();
    }

    // Pokémon de esta zona que rinden más según la hora de salida (+25 % de EXP si coincide con su hora).
    function timeNote(z) {
      const ph = phaseNow();
      const ids = timeSpecies(ph).filter((id) => matches(z, id)).map((id) => S.dexById.get(id).name);
      if (!ids.length) return null;
      return h('span', { class: 'small afk-zone-time', 'data-testid': 'zone-time' }, `${PHASE[ph].ico} ${PHASE[ph].label.toLowerCase()} rinden +${Math.round(S.data.daytime.expBonus * 100)} % de EXP: ${ids.slice(0, 4).join(', ')}${ids.length > 4 ? '…' : ''}`);
    }

    function zoneCard(z) {
      const full = st && st.exps.length >= st.slots;
      return h('div', { class: `afk-zone tone-${z.tone}` },
        h('div', { class: 'afk-zone-art' }, aniImg(z.hostId, { cls: 'afk-zone-img', alt: z.host })),
        h('b', { class: 'afk-zone-name' }, z.name), typesEl(z), h('span', { class: 'small muted' }, z.desc),
        timeNote(z),
        h('span', { class: 'small afk-zone-ev', title: 'Puntos de esfuerzo que ganan tus Pokémon en esta zona' }, `💪 +${S.data.evs.expPerHour} EV/h de ${EV_SHORT[z.ev]}`),
        h('button', { class: 'btn primary', disabled: full, title: full ? 'Todas tus expediciones están en marcha' : '', onclick: () => openSend(z) }, full ? 'Sin plazas libres' : '🧭 Enviar'));
    }

    function render() {
      live.length = 0;
      running.replaceChildren(
        h('h2', { class: 'section-title' }, `En marcha (${st.exps.length}/${st.slots})`),
        st.exps.length ? h('div', { class: 'afk-runs' }, st.exps.map(runCard)) : emptyState('Nadie de expedición ahora mismo.', MON.snorlax),
        ...(st.slots < cfg().slots + 1 ? [h('p', { class: 'small muted' }, `La tercera expedición simultánea se desbloquea en el nivel ${cfg().slot3Level} de entrenador.`)] : []));
      zones.replaceChildren(...cfg().zones.map(zoneCard));
    }

    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🧭 Expediciones')), intro, running,
      h('h2', { class: 'section-title' }, 'Zonas'), zones,
      h('p', { class: 'small muted' }, `Recompensas: EXP (como en los juegos), Caramelos Exp., bayas, polvo y objetos, y amistad. Hallazgo de monedas pequeño: tope de ${cfg().caps.coins} al día. Nunca dan Pokémon.`));
    root.append(loader('Preparando las mochilas…'));
    try { apply(await emit('exp:list')); } catch (e) { toast(e.message, 'error'); } finally { root.querySelector('.loader')?.remove(); }
    tick = setInterval(() => {
      if (!running.isConnected) { clearInterval(tick); return; } // la pantalla ya no está: no se queda un temporizador huérfano
      let ready = false;
      for (const l of live) {
        const left = l.e.end - now();
        if (left <= 0) { ready = true; break; }
        l.txt.textContent = `Vuelven en ${clock(left)}`;
        const f = l.bar.querySelector('i');
        if (f) f.style.width = Math.min(100, Math.max(0, (1 - left / l.total) * 100)) + '%';
        l.bar.setAttribute('aria-valuenow', Math.round(Math.min(100, Math.max(0, (1 - left / l.total) * 100))));
      }
      if (ready) render();
    }, 1000);
    this.stop = () => clearInterval(tick);
  },
  unmount() { this.stop && this.stop(); },
};

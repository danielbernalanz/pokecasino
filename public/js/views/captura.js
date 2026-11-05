// Captura: rutas de Kanto con encuentros salvajes. Debilita con tu equipo, duerme, lanza Balls y captúralo (ver server/capture.js).
import { S, h, act, emit, fmt, sfx, toast, modal, sprite, typeBadge, hpBar, say, loader, itemImg, sleep, bus } from '../core.js';
import { themeNote } from '../weekly.js';
import { aniImg } from '../anim.js';
import { burstEl, reduced, confetti, flash, vibrate, shake } from '../fx.js';
import { phaseNow, PHASE } from '../daytime.js';
import { openInPc } from './pc.js';

const cfg = () => S.data.capture;
const dexName = (id) => (S.dexById.get(id) || {}).name || '#' + id;
const WX = { clear: ['☀️', 'Despejado'], rain: ['🌧️', 'Lluvia'], fog: ['🌫️', 'Niebla'] };
const ST_ICO = { slp: '💤', par: '⚡', psn: '☠️', tox: '☠️', brn: '🔥', frz: '❄️' };
const KIND_ICO = { grass: '🌿', forest: '🌳', cave: '🕳️', water: '🌊', tower: '🪦' };
const num = (x) => String(x).replace('.', ',');
const hhmm = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });

export default {
  id: 'captura', title: 'Captura', icon: '🌿',
  async mount(root) {
    root.classList.add('view-captura');
    let st = null;
    let sel = null;
    let busy = false;
    let lastMon = null;
    const logLines = [];
    const body = h('div', { class: 'cap-body' });
    let stage = null;
    let msgEl = null;
    let sprEl = null;

    try { sel = localStorage.getItem('cap:zone'); } catch { /* sin almacenamiento */ }
    const zoneDef = (id) => cfg().zones.find((z) => z.id === id);
    const zoneDyn = (id) => st.zones.find((z) => z.id === id) || {};
    const open = () => cfg().zones.filter((z) => !zoneDyn(z.id).locked);
    const say1 = (t) => { if (msgEl) msgEl.textContent = t; };
    const pushLog = (lines) => { for (const l of lines || []) logLines.push(l); while (logLines.length > 40) logLines.shift(); };

    async function load() { st = await emit('cap:state'); if (!sel || !zoneDef(sel) || zoneDyn(sel).locked) sel = (open()[0] || cfg().zones[0]).id; render(); }

    // ---------- Rutas ----------
    function speciesOf(z) {
      const ph = phaseNow();
      const rows = z.enc.filter((e) => !e.t || e.t === ph);
      const total = rows.reduce((s, e) => s + e.w, 0);
      const by = new Map();
      for (const e of rows) {
        const o = by.get(e.id) || { id: e.id, min: e.min, max: e.max, w: 0 };
        o.min = Math.min(o.min, e.min); o.max = Math.max(o.max, e.max); o.w += e.w;
        by.set(e.id, o);
      }
      return [...by.values()].sort((a, b) => b.w - a.w).map((o) => ({ ...o, pct: Math.round((o.w / total) * 100) }));
    }

    function zoneCard(z) {
      const d = zoneDyn(z.id);
      const wx = WX[d.weather] || WX.clear;
      return h('button', { type: 'button', class: `cap-zone tone-${z.tone}` + (z.id === sel ? ' on' : '') + (d.locked ? ' locked' : ''), 'data-zone': z.id, 'aria-pressed': z.id === sel ? 'true' : 'false',
        onclick: () => { sel = z.id; try { localStorage.setItem('cap:zone', sel); } catch { /* nada */ } render(); } },
      h('img', { class: 'pixel cap-zone-ico', src: sprite(z.hostId), alt: '' }),
      h('span', { class: 'cap-zone-name' }, z.name),
      h('span', { class: 'small muted' }, d.locked ? `🔒 ${z.open} medalla${z.open > 1 ? 's' : ''}` : `${KIND_ICO[z.kind] || ''} ${z.kind === 'cave' || z.kind === 'tower' ? 'Interior' : wx[0] + ' ' + wx[1]}`),
      st.outbreak.zone === z.id ? h('span', { class: 'cap-ob-tag', title: 'Aparición masiva en curso' }, '👥') : null,
      d.legend.some((l) => l.status === 'ok') ? h('span', { class: 'cap-leg-tag', title: 'Legendario disponible' }, '⭐') : null);
    }

    function zonePanel(z) {
      const d = zoneDyn(z.id);
      const ph = phaseNow();
      const spp = speciesOf(z);
      const ob = st.outbreak.zone === z.id ? st.outbreak : null;
      const wx = WX[d.weather] || WX.clear;
      const out = [
        h('div', { class: 'cap-zone-head' }, h('img', { class: 'pixel', src: sprite(z.hostId), alt: '' }),
          h('div', { class: 'grow' }, h('b', {}, `${z.name} · ${z.regionName}`), h('div', { class: 'small muted' }, z.desc),
            h('div', { class: 'small' }, `${PHASE[ph].ico} ${PHASE[ph].label}`, z.kind === 'cave' || z.kind === 'tower' ? ' · interior' : ` · ${wx[0]} ${wx[1]}${d.weather === 'rain' ? ' (salen más Pokémon de Agua)' : ''}`))),
        ob ? h('div', { class: 'cap-ob', 'data-testid': 'outbreak' }, `👥 ¡Aparición masiva de ${dexName(ob.id)}! Hasta las ${hhmm(ob.until)}: ${Math.round(cfg().outbreakShare * 100)} % de los encuentros.`) : null,
        h('div', { class: 'cap-spp', 'aria-label': 'Pokémon de esta ruta a esta hora' }, spp.map((s) => h('div', { class: 'cap-sp', title: `${dexName(s.id)} · Nv. ${s.min === s.max ? s.min : s.min + '-' + s.max} · ${s.pct} %` },
          h('img', { class: 'pixel', src: sprite(s.id), alt: dexName(s.id) }), h('span', { class: 'small' }, `${s.pct} %`), h('span', { class: 'small muted' }, `Nv.${s.min === s.max ? s.min : s.min + '-' + s.max}`)))),
      ];
      const left = st.left;
      const go = h('button', { class: 'btn primary big', 'data-testid': 'cap-go', disabled: d.locked || busy || left < 1, onclick: (e) => start(z, null, e.currentTarget) },
        d.locked ? `🔒 Necesitas ${z.open} medalla${z.open > 1 ? 's' : ''}` : left < 1 ? 'Sin encuentros hoy' : `${KIND_ICO[z.kind] || '🌿'} Buscar Pokémon`);
      out.push(go);
      for (const L of z.legend) {
        const ds = d.legend.find((x) => x.id === L.id) || { status: 'locked' };
        const label = ds.status === 'got' ? '✅ Ya capturado' : ds.status === 'tried' ? '⏳ Vuelve mañana' : ds.status === 'locked' ? `🔒 ${L.champ ? 'Campeón de la Liga' : L.badges + ' medallas'}` : `⭐ Enfrentarse a ${dexName(L.id)} (Nv. ${L.level})`;
        out.push(h('button', { class: 'btn gold', 'data-legend': L.id, disabled: ds.status !== 'ok' || busy || left < 1, onclick: (e) => start(z, L.id, e.currentTarget) }, label,
          ds.status === 'ok' ? h('span', { class: 'small' }, ` · ${L.spot}`) : null));
      }
      out.push(h('p', { class: 'small muted' }, `Cada búsqueda gasta 1 de tus ${st.max} encuentros diarios. Los legendarios solo se capturan una vez; si escapa o se debilita, vuelve otro día.`));
      return h('div', { class: 'cap-panel stack' }, out);
    }

    // ---------- Encuentro ----------
    function stageEl(e) {
      const z = zoneDef(e.zone);
      const wx = e.weather;
      msgEl = h('div', { class: 'cap-msg', 'data-testid': 'cap-msg', 'aria-live': 'polite' }, e.legend ? `¡${dexName(e.id)} apareció!` : `¡Ha aparecido un ${dexName(e.id)} salvaje!`);
      sprEl = aniImg(e.id, { shiny: e.shiny, cls: 'cap-foe-img', alt: dexName(e.id) });
      const hp = hpBar(e.hp, 'cap-hp');
      stage = h('div', { class: `cap-stage kind-${z.kind} ${e.phase === 'night' ? 'night' : 'day'} wx-${wx}` },
        h('div', { class: 'cap-fx', 'aria-hidden': 'true' }),
        h('div', { class: 'cap-foe' },
          h('div', { class: 'cap-foe-top' }, h('b', { class: 'cap-foe-name' }, dexName(e.id), e.shiny ? ' ✨' : ''), h('span', { class: 'cap-foe-lv' }, `Nv. ${e.level}`)),
          h('div', { class: 'cap-foe-types' }, S.dexById.get(e.id).types.map(typeBadge), h('span', { class: 'cap-st', 'data-testid': 'cap-status' }, e.status ? `${ST_ICO[e.status]} ${cfg().statusEs[e.status]}` : '')),
          h('div', { class: 'cap-hp-row' }, h('span', { class: 'cap-hp-lbl' }, 'PS'), hp)),
        h('div', { class: 'cap-sprite' + (e.shiny ? ' shiny' : ''), 'data-testid': 'cap-sprite' }, sprEl),
        h('div', { class: 'cap-ground', 'aria-hidden': 'true' }),
        msgEl);
      return stage;
    }
    function updateStage(e) {
      if (!stage) return;
      const hp = stage.querySelector('.cap-hp');
      if (hp) { hp.querySelector('i').style.width = e.hp + '%'; hp.classList.toggle('r', e.hp < 20); hp.classList.toggle('y', e.hp >= 20 && e.hp < 50); hp.setAttribute('aria-valuenow', e.hp); }
      const stt = stage.querySelector('.cap-st');
      if (stt) stt.textContent = e.status ? `${ST_ICO[e.status]} ${cfg().statusEs[e.status]}` : '';
      stage.classList.toggle('asleep', e.status === 'slp');
    }

    function encPanel(e) {
      const owned = (S.me.collection[e.id] || {}).n || 0;
      return h('div', { class: 'cap-panel stack' },
        h('div', { class: 'cap-actions' },
          h('button', { class: 'btn primary big', 'data-testid': 'cap-attack', disabled: busy, onclick: openAttack }, '⚔️ Atacar'),
          h('button', { class: 'btn gold big', 'data-testid': 'cap-throw', disabled: busy, onclick: openBalls }, '⚪ Lanzar Ball'),
          h('button', { class: 'btn big', 'data-testid': 'cap-run', disabled: busy, onclick: runAway }, '🏃 Huir')),
        h('div', { class: 'small muted' }, `Turno ${e.turn + 1}${owned ? ` · ya tienes ${dexName(e.id)} (${owned}★)` : ' · ¡especie nueva!'}${owned >= 5 ? ' · con 5 estrellas se convierte en polvo' : ''}`),
        h('div', { class: 'cap-log', 'data-testid': 'cap-log', role: 'log' }, logLines.slice(-6).map((l) => h('div', {}, l))),
        h('p', { class: 'small muted' }, 'Consejo: baja los PS con tu Pokémon (Falso Tortazo nunca lo debilita), duérmelo o paralízalo y lanza la Ball. Las críticas dependen de cuántas especies tengas registradas.'));
    }

    async function start(z, legend, btn) {
      busy = true; render();
      const r = await act('cap:encounter', { zone: z.id, legend: legend || undefined }, btn);
      busy = false;
      if (!r) return render();
      st = r; logLines.length = 0; pushLog([r.msg]);
      sfx('click');
      render(true);
      if (!reduced()) shake(stage, 300);
      if (st.enc && st.enc.shiny) { sfx('shiny'); const sp = stage.querySelector('.cap-sprite'); if (sp) burstEl(sp, '#ffd54f', 26, { spread: 120, stars: 0.8 }); }
    }

    async function runAway() {
      const r = await act('cap:run', {});
      if (!r) return;
      st = r; logLines.length = 0;
      toast('Has huido sin problemas.', 'info');
      render();
    }

    // ---------- Atacar ----------
    async function openAttack() {
      const r = await act('cap:team', {});
      if (!r) return;
      let mons = r.mons;
      const body2 = h('div', { class: 'stack cap-pick' });
      const m = modal(body2, { title: '⚔️ ¿Con quién atacas?', wide: true });
      const list = () => {
        const q = h('input', { type: 'search', placeholder: 'Buscar por nombre…', class: 'cap-q', 'aria-label': 'Buscar Pokémon' });
        const grid = h('div', { class: 'cap-mons' });
        const draw = () => {
          const t = q.value.trim().toLowerCase();
          const shown = mons.filter((x) => !t || dexName(x.id).toLowerCase().includes(t) || (x.nick || '').toLowerCase().includes(t)).slice(0, 60);
          grid.replaceChildren(...shown.map((x) => h('button', { type: 'button', class: 'cap-mon', 'data-uid': x.uid, onclick: () => moves(x) },
            h('img', { class: 'pixel', src: sprite(x.id, x.shiny), alt: '' }), h('b', {}, x.nick || dexName(x.id)), h('span', { class: 'small muted' }, `Nv. ${x.level}${x.buddy ? ' · 🤝' : ''}`))));
          if (!shown.length) grid.append(h('p', { class: 'muted' }, 'Ningún Pokémon libre con ese nombre.'));
        };
        q.addEventListener('input', draw); draw();
        body2.replaceChildren(h('div', { class: 'small muted' }, 'Elige un Pokémon de tu Caja (los que están de expedición o en el Criadero no pueden). El salvaje no contraatacará.'), q, grid);
      };
      const moves = (x) => {
        lastMon = x.uid;
        const e = st.enc;
        body2.replaceChildren(
          h('div', { class: 'cap-mon-head' }, h('img', { class: 'pixel', src: sprite(x.id, x.shiny), alt: '' }), h('div', { class: 'grow' }, h('b', {}, `${x.nick || dexName(x.id)} Nv. ${x.level}`), h('div', { class: 'small muted' }, `Salvaje: ${dexName(e.id)} (${e.hp} % PS)`)),
            h('button', { class: 'btn small', onclick: list }, '← Otro Pokémon')),
          h('div', { class: 'cap-moves' }, x.moves.map((mv) => h('button', { type: 'button', class: 'cap-move', 'data-move': mv.id, onclick: async (ev) => { m.close(); await attack(x, mv, ev.currentTarget); } },
            typeBadge(mv.type), h('b', {}, mv.name), h('span', { class: 'small muted' }, mv.status ? `${ST_ICO[mv.status]} ${cfg().statusEs[mv.status]}` : mv.cat === 'Status' ? 'Estado' : `Poder ${mv.power || '—'}`)))),
          h('p', { class: 'small muted' }, 'Falso Tortazo deja siempre 1 PS. Los movimientos de dormir, paralizar, quemar o envenenar dan un bonus a la captura (dormir y congelar ×2,5; el resto ×1,5).'));
      };
      const prev = lastMon && mons.find((x) => x.uid === lastMon);
      if (prev) moves(prev); else list();
    }

    async function attack(x, mv, btn) {
      busy = true; render(true);
      const r = await act('cap:attack', { id: x.id, uid: x.uid, move: mv.id }, btn);
      busy = false;
      if (!r) return render(true);
      st = { ...st, ...r };
      pushLog(r.log);
      if (!reduced() && r.after < r.before && stage) { const sp = stage.querySelector('.cap-sprite'); sp.classList.remove('hit'); void sp.offsetWidth; sp.classList.add('hit'); }
      sfx('click');
      say1(r.log[r.log.length - 1] || '');
      if (r.ended) return finishEnc(r);
      render(true);
    }

    function finishEnc(r) {
      busy = true;
      const fainted = r.ended === 'fainted';
      if (stage) {
        const sp = stage.querySelector('.cap-sprite');
        if (sp) sp.classList.add(fainted ? 'faint' : 'flee');
        say1(r.log[r.log.length - 1] || '');
      }
      sfx(fainted ? 'error' : 'click');
      setTimeout(() => {
        busy = false;
        const dead = fainted ? 'se ha debilitado' : 'ha huido';
        const mdl = modal(h('div', { class: 'stack cap-end' }, h('img', { class: 'pixel cap-end-ico', src: sprite(r.gone), alt: '' }),
          h('p', {}, `${dexName(r.gone)} ${dead}. ${fainted ? 'Un Pokémon debilitado no se puede capturar: ' : ''}el encuentro se ha perdido.`),
          h('button', { class: 'btn primary', onclick: () => mdl.close() }, 'Continuar')), { title: fainted ? '💫 Debilitado' : '💨 Se escapó', onClose: () => { st.enc = null; logLines.length = 0; render(); } });
      }, reduced() ? 0 : 900);
    }

    // ---------- Lanzar Ball ----------
    function openBalls() {
      const e = st.enc;
      const order = S.data.balls.order;
      const have = order.filter((id) => (S.me.items[id] || 0) > 0);
      const grid = h('div', { class: 'cap-balls' }, have.map((id) => {
        const b = st.ballBonus ? st.ballBonus[id] : 1;
        const hot = b > 1;
        return h('button', { type: 'button', class: 'cap-ball-btn' + (hot ? ' hot' : ''), 'data-ball': id, title: S.data.items[id].desc, onclick: () => { m.close(); throwBall(id); } },
          itemImg(id, 'cap-ball-img'), h('b', {}, S.data.items[id].name), h('span', { class: 'small' }, `×${S.me.items[id]}`),
          h('span', { class: 'small ' + (hot ? 'good' : 'muted') }, b >= 999 ? '¡100 %!' : hot ? `ahora ×${num(b)}` : 'sin bonus ahora'));
      }));
      const m = modal(h('div', { class: 'stack' },
        have.length ? grid : h('div', { class: 'stack' }, h('p', {}, 'No tienes Poké Balls. Cómpralas en la Tienda Poké (a partir de 120 monedas).'), h('a', { class: 'btn primary', href: '#/shop', onclick: () => m.close() }, '🏬 Ir a la Tienda')),
        h('p', { class: 'small muted' }, `${dexName(e.id)} está al ${e.hp} % de PS${e.status ? ' y ' + cfg().statusEs[e.status] : ''}. Con menos PS y con un estado alterado, la Ball funciona mucho mejor.`)), { title: '⚪ ¿Qué Ball lanzas?', wide: true });
    }

    async function throwBall(ballId) {
      busy = true; render(true);
      const r = await act('cap:ball', { ball: ballId });
      if (!r) { busy = false; return render(true); }
      await playThrow(ballId, r);
      busy = false;
      st = { ...st, ...r };
      pushLog(r.log);
      if (r.caught) return reveal(r.got, r);
      if (r.ended) return finishEnc(r);
      render(true);
      say1(r.log[r.log.length - 1] || '');
    }

    // Animación: la Ball vuela, el Pokémon se encoge, la Ball se sacude 1–3 veces y, o se cierra (captura), o se abre (escapa). Crítica: una sacudida lenta y dorada.
    async function playThrow(ballId, r) {
      const wrap = stage && stage.querySelector('.cap-sprite');
      if (!wrap) return;
      const ball = itemImg(ballId, 'cap-throw-ball');
      stage.append(ball);
      const q = reduced() ? 0.01 : 1;
      const T = (ms) => ms * q;
      const sr = stage.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      const tx = wr.left + wr.width / 2 - sr.left - 20;
      const ty = wr.top + wr.height / 2 - sr.top - 20;
      const gy = sr.height - 64 - 6;
      const anim = (el, kf, ms, o = {}) => el.animate(kf, { duration: T(ms), fill: 'forwards', easing: 'ease-out', ...o }).finished.catch(() => {});
      sfx('click');
      await anim(ball, [{ transform: `translate(8px, ${sr.height - 70}px) rotate(0)` }, { transform: `translate(${tx * 0.6}px, ${ty - 70}px) rotate(300deg)`, offset: 0.55 }, { transform: `translate(${tx}px, ${ty}px) rotate(540deg)` }], 650);
      await anim(wrap, [{ transform: 'scale(1)', filter: 'brightness(1)', opacity: 1 }, { transform: 'scale(.1)', filter: 'brightness(3) saturate(0) drop-shadow(0 0 8px #fff)', opacity: 0.2 }], 380);
      await anim(ball, [{ transform: `translate(${tx}px, ${ty}px)` }, { transform: `translate(${tx}px, ${gy}px)` }], 340, { easing: 'cubic-bezier(.3,.1,.6,1)' });
      const base = `translate(${tx}px, ${gy}px)`;
      const shakes = r.crit ? 1 : r.shakes;
      for (let i = 0; i < shakes; i++) {
        await sleep(T(250));
        sfx('click');
        if (r.crit) ball.classList.add('crit');
        await anim(ball, [{ transform: `${base} rotate(0)` }, { transform: `${base} rotate(-28deg)` }, { transform: `${base} rotate(24deg)` }, { transform: `${base} rotate(0)` }], r.crit ? 1100 : 620, { easing: 'ease-in-out' });
      }
      await sleep(T(350));
      if (r.caught) {
        ball.classList.add('done');
        sfx('shiny'); vibrate([40, 30, 40]);
        burstEl(ball, '#ffd54f', 22, { spread: 90, stars: 0.9 });
        await sleep(T(450));
      } else {
        sfx('error');
        await anim(ball, [{ opacity: 1, transform: `${base} scale(1)` }, { opacity: 0, transform: `${base} scale(1.7)` }], 260);
        await anim(wrap, [{ transform: 'scale(.1)', filter: 'brightness(3)', opacity: 0.2 }, { transform: 'scale(1)', filter: 'brightness(1)', opacity: 1 }], 320);
      }
      ball.remove();
    }

    function reveal(g, r) {
      const p = S.dexById.get(g.id);
      const marks = cfg().marks;
      const mk = g.mark ? marks[g.mark] : null;
      const spec = [
        h('div', {}, h('b', {}, `Nv. ${g.level} · ${g.nature}`), g.ha ? ' · ✨ habilidad oculta' : ''),
        h('div', { class: 'small' }, `IV total ${g.ivTotal}/186 · ${g.ability || ''}`),
        h('div', { class: 'small' }, `Tamaño ${g.size}/255 (${g.sizeLabel})${g.sizeTitle ? ' · Marca ' + g.sizeTitle : ''}`),
        mk ? h('div', { class: 'cap-mark' }, `${mk.ico} ${mk.name}: «${mk.title}»`) : null,
        h('div', { class: 'small row gap' }, itemImg(g.ball, 'cap-mini'), S.data.items[g.ball].name),
        g.dust ? h('div', { class: 'small warn' }, `Ya tenías 5 estrellas: se convierte en ${g.dust} ✦ de polvo.`) : g.isNew ? h('div', { class: 'small good' }, '📕 ¡Nueva entrada en la Pokédex!') : h('div', { class: 'small muted' }, `Ya la tenías: ahora ${g.stars}★`),
      ];
      const mdl = modal(h('div', { class: 'stack cap-reveal' },
        h('img', { class: 'cap-reveal-img pixel', src: sprite(g.id, g.shiny), alt: p.name }),
        h('h3', {}, `¡${p.name} capturado!${g.shiny ? ' ✨' : ''}`), r.crit ? h('div', { class: 'good' }, '⭐ ¡Captura crítica!') : null, spec,
        h('div', { class: 'row gap wrap' },
          g.uid ? h('button', { class: 'btn', onclick: () => { mdl.close(); openInPc(g.id); } }, '🖥️ Ver en la Caja') : null,
          h('button', { class: 'btn primary', 'data-testid': 'cap-continue', onclick: () => mdl.close() }, 'Seguir capturando'))), { title: '🎉 ¡Captura!', onClose: () => { st.enc = null; logLines.length = 0; render(); } });
      if (!reduced()) { confetti({ count: g.legend || g.shiny ? 120 : 40 }); if (g.legend || g.shiny) flash('#ffd54f', 500); }
    }

    // ---------- Pantalla ----------
    function render(keepStage) {
      if (!st) return;
      const e = st.enc;
      const top = h('div', { class: 'cap-top' },
        h('span', { class: 'chip cap-count', 'data-testid': 'cap-count', title: 'Encuentros de hoy (se reinicia a las 00:00 UTC)' }, `🌿 Hoy ${st.used}/${st.max}`),
        h('span', { class: 'chip', title: `${PHASE[phaseNow()].label} (${PHASE[phaseNow()].range}, hora de España)` }, `${PHASE[phaseNow()].ico} ${phaseNow() === 'night' ? 'Noche' : 'Día'}`),
        h('span', { class: 'chip', title: 'Especies registradas en tu Pokédex: más especies, más posibilidades de captura crítica' }, `📕 ${st.species} · crítica ${st.crit ? '×' + num(st.crit) : 'no'}`),
        h('a', { class: 'btn small', href: '#/shop', title: 'Comprar Poké Balls en la Tienda' }, '🏬 Balls'));
      if (e) {
        if (!(keepStage && stage && stage.isConnected)) body.replaceChildren(h('div', { class: 'cap-grid enc' }, stageEl(e), encPanel(e)));
        else { updateStage(e); body.querySelector('.cap-panel').replaceWith(encPanel(e)); }
      } else {
        stage = null;
        const z = zoneDef(sel);
        body.replaceChildren(h('div', { class: 'cap-grid zones' }, h('div', { class: 'cap-zones', 'data-testid': 'cap-zones' }, cfg().zones.map(zoneCard)), zonePanel(z)));
      }
      head.replaceChildren(top);
    }

    const head = h('div', { class: 'cap-head' });
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🌿 Captura'), h('div', { class: 'row gap wrap' }, h('a', { class: 'btn small', href: '#/pc' }, '🖥️ Caja PC'), h('a', { class: 'btn small', href: '#/bag' }, '🎒 Mochila'))),
      head, body);
    { const tn = themeNote(); if (tn) root.querySelector('.game-head .row')?.prepend(tn); }
    body.append(loader('Entrando en la hierba alta…'));
    try { await load(); } catch (err) { toast(err.message, 'error'); }
    this.off = bus.on('me', () => { /* la cabecera y los contadores salen del estado del servidor */ });
    // El tramo del día (día/noche) cambia con el reloj: refresca las tablas de especies sin tocar el encuentro abierto.
    this.timer = setInterval(() => { if (!st || st.enc || busy || !body.isConnected) return; if (document.querySelector('.modal-wrap')) return; load().catch(() => {}); }, 60000);
  },
  unmount() { if (this.off) this.off(); clearInterval(this.timer); },
};

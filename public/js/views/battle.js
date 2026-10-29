// Combates al estilo Pokémon Showdown (individuales y dobles): Liga de entrenadores, retos PvP, equipos e historial.
import { S, h, fmt, act, emit, toast, sfx, bus, modal, sprite, typeBadge, TYPE_ES, confirmBet } from '../core.js';
import { BattleScreen, loadNames, moveEs, abilityEs, moveMeta, CAT } from '../battle-screen.js';

const FORMAT_ES = { singles: 'Individual', doubles: 'Dobles' };
const LEVEL_ES = { fair: 'Nivel 50 (justo)', real: 'Niveles reales' };
const NO_TEAM = 'auto';

const prefs = { format: 'singles', level: 'fair', team: NO_TEAM, wager: 0 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('btprefs') || '{}')); } catch { /* sin almacenamiento */ }
const savePrefs = () => { try { localStorage.setItem('btprefs', JSON.stringify(prefs)); } catch { /* sin almacenamiento */ } };

const dexOf = (id) => S.dexById.get(id) || { name: '#' + id, types: [] };
const sig = (n) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 6 - n));

// Si el rival acepta un reto mientras estás en otra pantalla, te lleva al combate.
bus.on('battle:start', (p) => {
  if (S.view !== 'combates' && p && p.battle) {
    toast(`⚔️ ¡Empieza tu combate contra ${p.battle.foe}!`, 'success', 5000);
    sfx('big');
    location.hash = '#/combates';
  }
});

export default {
  id: 'combates', title: 'Combates', icon: '⚔️',
  mount(root) {
    const ctx = { tab: 'fight', state: null, box: null, screen: null, edit: { slot: 0, members: [], name: '' }, offs: [], lastCpu: null, replayScreen: null };
    this.ctx = ctx;
    const tabsEl = h('div', { class: 'tabs bt-tabs' });
    const content = h('div', { class: 'bt-content' });
    const head = h('div', { class: 'game-head' }, h('h1', {}, '⚔️ Combates'),
      h('p', { class: 'muted' }, 'Combates por turnos con el simulador de Pokémon Showdown: movimientos reales, habilidades, tipos, Megaevolución… Individuales y dobles, contra entrenadores de la Liga o contra otros jugadores.'));
    root.append(head, tabsEl, content);

    const TABS = [['fight', '🏟️ Combatir'], ['pvp', '🤝 Retos'], ['teams', '🎒 Mis equipos'], ['hist', '📜 Historial']];
    const drawTabs = () => tabsEl.replaceChildren(...TABS.map(([id, label]) => h('button', { class: 'tab' + (ctx.tab === id ? ' active' : ''), type: 'button', onclick: () => { ctx.tab = id; drawTabs(); show(); } }, label)));
    const inBattle = () => !!ctx.screen;

    // ---------- Combate en curso ----------
    async function openBattle(view) {
      await loadNames();
      if (ctx.screen) { if (ctx.screen.view.id === view.id) return; ctx.screen.destroy(); }
      closeReplay();
      const screen = new BattleScreen(view, {
        onExit: () => { closeBattle(); show(); },
        onRematch: view.mode === 'cpu' && ctx.lastCpu ? () => startCpu(ctx.lastCpu.trainer, true) : null,
      });
      ctx.screen = screen;
      head.classList.add('hidden'); tabsEl.classList.add('hidden');
      content.replaceChildren(screen.root);
      screen.feed(view.log || [], { instant: true });
      screen.setRequest(view.request, { chosen: view.chosen, deadline: view.deadline });
      screen.root.scrollIntoView({ block: 'start' });
    }
    function closeBattle() {
      if (ctx.screen) { ctx.screen.destroy(); ctx.screen = null; }
      head.classList.remove('hidden'); tabsEl.classList.remove('hidden');
    }
    function closeReplay() { if (ctx.replayScreen) { ctx.replayScreen.destroy(); ctx.replayScreen = null; } }

    async function resync() {
      let r;
      try { r = await emit('battle:resume'); } catch { return; }
      if (r.battle) {
        if (ctx.screen && ctx.screen.view.id === r.battle.id) { const old = ctx.screen; ctx.screen = null; old.destroy(); }
        else if (ctx.screen) { ctx.screen.destroy(); ctx.screen = null; }
        await openBattle(r.battle);
      } else if (ctx.screen && !ctx.screen.over) {
        toast('El combate ha terminado mientras estabas desconectado.', 'info');
        closeBattle(); show();
      }
    }

    // ---------- Equipos ----------
    async function loadBox(force = false) {
      if (ctx.box && !force) return ctx.box;
      const r = await act('battle:box');
      if (r) { ctx.box = r.mons; ctx.teams = r.teams; }
      return ctx.box || [];
    }
    function autoTeam(box, format) {
      const n = format === 'doubles' ? 4 : 6;
      const seen = new Set();
      const sorted = [...box].sort((a, b) => b.level - a.level || b.iv - a.iv);
      const out = [];
      for (const m of sorted) {
        if (seen.has(m.id)) continue;
        seen.add(m.id); out.push({ id: m.id, uid: m.uid, mega: 0 });
        if (out.length >= n) break;
      }
      return out;
    }
    async function teamMembers(format) {
      const box = await loadBox();
      if (prefs.team !== NO_TEAM) {
        const t = (ctx.state && ctx.state.teams || [])[Number(prefs.team)];
        if (t && t.members.length) return t.members.map((m) => ({ id: m.id, uid: m.uid, mega: m.mega || 0 }));
      }
      const t = autoTeam(box, format);
      if (!t.length) { toast('Necesitas al menos un Pokémon para combatir. ¡Consigue alguno en el Gacha!', 'error'); return null; }
      return t;
    }
    function teamSelect(onChange) {
      const teams = (ctx.state && ctx.state.teams) || [];
      const sel = h('select', { class: 'bt-sel' }, h('option', { value: NO_TEAM }, '⚡ Equipo automático (mis mejores)'),
        teams.map((t, i) => (t ? h('option', { value: String(i) }, `🎒 ${t.name} (${t.members.length})`) : null)));
      sel.value = prefs.team !== NO_TEAM && teams[Number(prefs.team)] ? prefs.team : NO_TEAM;
      sel.addEventListener('change', () => { prefs.team = sel.value; savePrefs(); if (onChange) onChange(); });
      return sel;
    }
    function seg(options, current, onPick) {
      return h('div', { class: 'seg' }, options.map(([v, label]) => h('button', { class: 'seg-b' + (current === v ? ' on' : ''), type: 'button', onclick: () => onPick(v) }, label)));
    }

    // ---------- Pestaña Combatir ----------
    async function startCpu(trainerId, rematch = false) {
      if (!rematch) { const ok = await ensureTeam(); if (!ok) return; }
      const team = await teamMembers(prefs.format);
      if (!team) return;
      const r = await act('battle:cpu', { trainer: trainerId, format: prefs.format, level: prefs.level, team });
      if (!r) return;
      ctx.lastCpu = { trainer: trainerId };
      await openBattle(r.battle);
    }
    async function ensureTeam() {
      const box = await loadBox();
      if (!box.length) { toast('Aún no tienes Pokémon: ¡consigue el primero en el Gacha!', 'error'); return false; }
      return true;
    }

    function trainerCard(t) {
      const lvTxt = prefs.level === 'fair' ? 'Nv 50' : `Nv ≈ ${Math.max(5, Math.round((avgLevel() || 20) + t.dl))}`;
      return h('div', { class: 'tr-card tier-' + t.tier + (t.locked ? ' locked' : '') + (t.gym ? ' gym' : '') },
        h('div', { class: 'tr-sil' }, t.sig.map((id) => h('img', { class: 'pixel', src: sprite(id), alt: '', loading: 'lazy' }))),
        h('div', { class: 'tr-info' },
          h('div', { class: 'tr-cls' }, t.gym ? '🏅 ' + t.cls : t.cls),
          h('b', { class: 'tr-name' }, t.name),
          h('div', { class: 'tr-meta small muted' }, `${sig(t.tier)} · ${lvTxt}`),
          h('div', { class: 'tr-quote small muted' }, `«${t.quote}»`)),
        h('div', { class: 'tr-act' },
          h('span', { class: 'tr-coins' }, `🪙 ${t.coins}`),
          t.locked ? h('span', { class: 'small muted' }, `🔒 ${t.badges} medallas`) : h('button', { class: 'btn primary', type: 'button', onclick: (e) => { const btn = e.currentTarget; btn.disabled = true; startCpu(t.id).finally(() => { btn.disabled = false; }); } }, 'Retar')));
    }
    const avgLevel = () => {
      const box = ctx.box;
      if (!box || !box.length) return 0;
      const t = (prefs.team !== NO_TEAM && ctx.state && ctx.state.teams[Number(prefs.team)]) || null;
      const ms = t ? t.members.map((m) => box.find((b) => b.uid === m.uid)).filter(Boolean) : autoTeam(box, prefs.format).map((m) => box.find((b) => b.uid === m.uid));
      return ms.length ? ms.reduce((s, m) => s + m.level, 0) / ms.length : 0;
    };

    async function drawFight() {
      const st = ctx.state;
      const f = FORMAT_ES;
      const list = h('div', { class: 'tr-grid' });
      const redraw = () => { list.replaceChildren(...st.trainers.map(trainerCard)); };
      const controls = h('div', { class: 'card bt-ctl' },
        h('div', { class: 'bt-ctl-row' },
          h('div', {}, h('div', { class: 'small muted' }, 'Formato'), seg(Object.entries(f), prefs.format, (v) => { prefs.format = v; savePrefs(); drawFight(); })),
          h('div', {}, h('div', { class: 'small muted' }, 'Niveles'), seg(Object.entries(LEVEL_ES), prefs.level, (v) => { prefs.level = v; savePrefs(); drawFight(); })),
          h('div', { class: 'grow' }, h('div', { class: 'small muted' }, 'Tu equipo'), teamSelect(redraw))),
        h('p', { class: 'small muted' }, prefs.format === 'doubles'
          ? 'Dobles: dos Pokémon por bando y objetivos a elegir. Lleva al menos 2 (lo recomendable son 4).'
          : 'Individual: un Pokémon por bando. Llevas todo tu equipo (hasta 6).',
        prefs.level === 'fair' ? ' Todos combaten a nivel 50: gana el mejor equipo, no el más entrenado.' : ' Niveles reales: cada Pokémon pelea con el nivel que tiene.'),
        h('div', { class: 'bt-wins' }, `🏆 Victorias premiadas hoy: ${st.wins.n}/${st.wins.max}`, h('span', { class: 'small muted' }, ' · Cada victoria da monedas, caramelos de la familia y amistad; perder no cuesta nada.')));
      redraw();
      content.replaceChildren(controls, list);
    }

    // ---------- Pestaña Retos ----------
    async function drawPvp() {
      const st = ctx.state;
      const wager = h('input', { type: 'number', min: 0, step: 10, value: prefs.wager || 0, 'aria-label': 'Apuesta' });
      const target = h('input', { list: 'bt-online', placeholder: 'Cualquiera (opcional)' });
      const datalist = h('datalist', { id: 'bt-online' }, (S.online || []).filter((u) => u.username !== S.me.username).map((u) => h('option', { value: u.username })));
      const openBox = h('div', { class: 'duel-list' });
      const drawOpen = () => {
        const list = ctx.challenges || st.challenges || [];
        if (!list.length) { openBox.replaceChildren(h('p', { class: 'muted' }, 'No hay retos abiertos. ¡Crea el primero!')); return; }
        openBox.replaceChildren(...list.map((c) => {
          const mine = c.creator === S.me.username;
          const forOther = c.target && c.target !== S.me.username && !mine;
          return h('div', { class: 'duel-row' + (c.target === S.me.username ? ' for-me' : '') },
            h('div', { class: 'duel-hidden' }, c.format === 'doubles' ? '2v2' : '1v1'),
            h('div', { class: 'grow' }, h('b', {}, c.creator), mine ? ' (tú)' : '', h('div', { class: 'muted small' }, `${FORMAT_ES[c.format]} · ${LEVEL_ES[c.level]} · ${c.size} Pokémon${c.target ? ' · Reto a ' + c.target : ''}`)),
            h('div', { class: 'wager' }, c.wager ? fmt(c.wager) : 'Amistoso'),
            mine ? h('button', { class: 'btn danger', type: 'button', onclick: (e) => { const btn = e.currentTarget; act('battle:cancel', { id: c.id }, btn); } }, 'Cancelar')
              : h('button', { class: 'btn primary', type: 'button', disabled: forOther, onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  if (!(await ensureTeam())) return;
                  if (c.wager && !(await confirmBet('duels', c.wager, { what: 'jugarte en este combate' }))) return;
                  const team = await teamMembers(c.format);
                  if (!team) return;
                  const r = await act('battle:accept', { id: c.id, team });
                  if (r) await openBattle(r.battle);
                } finally { btn.disabled = false; }
              } }, '¡Aceptar!'));
        }));
      };
      ctx.drawOpen = drawOpen;
      const form = h('div', { class: 'card stack' },
        h('h3', {}, 'Crear reto'),
        h('div', {}, h('div', { class: 'small muted' }, 'Formato'), seg(Object.entries(FORMAT_ES), prefs.format, (v) => { prefs.format = v; savePrefs(); drawPvp(); })),
        h('div', {}, h('div', { class: 'small muted' }, 'Niveles'), seg(Object.entries(LEVEL_ES), prefs.level, (v) => { prefs.level = v; savePrefs(); drawPvp(); })),
        h('div', {}, h('div', { class: 'small muted' }, 'Tu equipo'), teamSelect()),
        h('label', {}, 'Apuesta (0 = amistoso)', wager),
        h('label', {}, 'Rival', target, datalist),
        h('button', { class: 'btn primary big', type: 'button', onclick: async (e) => {
          const btn = e.currentTarget;
          if (!(await ensureTeam())) return;
          const wg = Number(wager.value) || 0;
          if (wg && !(await confirmBet('duels', wg, { what: 'poner en juego' }))) return;
          const team = await teamMembers(prefs.format);
          if (!team) return;
          prefs.wager = wg; savePrefs();
          const r = await act('battle:challenge', { format: prefs.format, level: prefs.level, wager: wg, target: target.value.trim() || null, team }, btn);
          if (r) { sfx('click'); toast('Reto publicado. Cuando alguien lo acepte empezará el combate.', 'success'); }
        } }, 'Publicar reto'),
        h('p', { class: 'muted small' }, 'Cada jugador elige su equipo a ciegas y llevan lo mismo (el equipo más pequeño marca cuántos). El ganador se lleva el bote menos un 5 % de comisión. Turnos de 60 s: si te quedas sin tiempo se elige solo, y 3 seguidos pierden el combate. Los retos caducan a los 10 minutos.'));
      content.replaceChildren(h('div', { class: 'duel-layout' }, form, h('div', { class: 'stack' }, h('h3', {}, 'Retos abiertos'), openBox)));
      drawOpen();
    }

    // ---------- Pestaña Mis equipos ----------
    async function drawTeams() {
      const box = await loadBox(true);
      const st = ctx.state;
      const teams = st.teams || [];
      const e = ctx.edit;
      if (!e.loaded) {
        const t = teams[e.slot];
        e.members = t ? t.members.map((m) => ({ ...m })) : [];
        e.name = t ? t.name : `Equipo ${e.slot + 1}`;
        e.loaded = true;
      }
      const byUid = new Map(box.map((m) => [m.uid, m]));
      const slotTabs = h('div', { class: 'tabs' }, [0, 1, 2].map((i) => h('button', { class: 'tab' + (e.slot === i ? ' active' : ''), type: 'button', onclick: () => { e.slot = i; e.loaded = false; drawTeams(); } }, teams[i] ? `${teams[i].name}` : `Hueco ${i + 1}`)));
      const nameIn = h('input', { value: e.name, maxlength: 20, 'aria-label': 'Nombre del equipo', oninput: () => { e.name = nameIn.value; } });
      const rows = h('div', { class: 'tm-list' });
      const moveName = (id) => moveEs(id);
      const drawRows = () => {
        const max = 6;
        rows.replaceChildren(...(e.members.length ? e.members.map((m, i) => {
          const sp = byUid.get(m.uid);
          if (!sp) return h('div', { class: 'tm-row gone' }, h('span', { class: 'grow muted' }, 'Ejemplar ya no disponible'), h('button', { class: 'btn small', type: 'button', onclick: () => { e.members.splice(i, 1); drawRows(); } }, '✕'));
          const d = dexOf(sp.id);
          const form = m.mega && S.megaById.get(m.mega);
          return h('div', { class: 'tm-row' },
            h('img', { class: 'pixel', src: sprite(sp.id, sp.shiny), alt: '' }),
            h('div', { class: 'grow tm-info' },
              h('div', {}, h('b', {}, sp.nick || d.name), sp.shiny ? ' ✨' : '', sp.gender ? h('span', { class: sp.gender === 'M' ? 'gm' : 'gf' }, sp.gender === 'M' ? ' ♂' : ' ♀') : '', h('span', { class: 'muted small' }, ` Nv${sp.level}`), h('span', { class: 'types' }, ' ', d.types.map(typeBadge))),
              h('div', { class: 'small muted' }, `${abilityEs(sp.ability)} · ${sp.moves.map(moveName).join(', ')}`)),
            h('div', { class: 'tm-btns' },
              sp.megas.length ? h('button', { class: 'btn small' + (m.mega ? ' active' : ''), type: 'button', title: form ? form.name : 'Megaevolución', onclick: () => {
                if (m.mega) m.mega = 0;
                else { e.members.forEach((x) => { x.mega = 0; }); m.mega = sp.megas[0]; }
                drawRows();
              } }, m.mega ? `💠 ${form ? form.name : ''}` : '💠') : null,
              h('button', { class: 'btn small', type: 'button', onclick: () => editMoves(sp, () => { drawRows(); drawPc(); }) }, '⚙️ Movs.'),
              h('button', { class: 'btn small', type: 'button', disabled: i === 0, 'aria-label': 'Subir', onclick: () => { [e.members[i - 1], e.members[i]] = [e.members[i], e.members[i - 1]]; drawRows(); } }, '▲'),
              h('button', { class: 'btn small', type: 'button', disabled: i === e.members.length - 1, 'aria-label': 'Bajar', onclick: () => { [e.members[i + 1], e.members[i]] = [e.members[i], e.members[i + 1]]; drawRows(); } }, '▼'),
              h('button', { class: 'btn small danger', type: 'button', 'aria-label': 'Quitar', onclick: () => { e.members.splice(i, 1); drawRows(); drawPc(); } }, '✕')));
        }) : [h('p', { class: 'muted' }, 'Equipo vacío: añade Pokémon desde la caja de la derecha.')]), h('div', { class: 'small muted' }, `${e.members.length}/${max} Pokémon`));
      };
      const q = h('input', { placeholder: 'Buscar en la Caja PC…', class: 'grow', oninput: () => drawPc() });
      const pc = h('div', { class: 'pc-list' });
      const drawPc = () => {
        const text = q.value.trim().toLowerCase();
        const inTeam = new Set(e.members.map((m) => m.uid));
        const speciesIn = new Set(e.members.map((m) => (byUid.get(m.uid) || {}).id));
        const list = box.filter((m) => !inTeam.has(m.uid)).filter((m) => {
          const d = dexOf(m.id);
          return !text || d.name.toLowerCase().includes(text) || (m.nick || '').toLowerCase().includes(text) || d.types.some((t) => (TYPE_ES[t] || '').toLowerCase().includes(text));
        }).sort((a, b) => b.level - a.level || a.id - b.id).slice(0, 120);
        pc.replaceChildren(...(list.length ? list.map((m) => {
          const d = dexOf(m.id);
          const dup = speciesIn.has(m.id);
          const full = e.members.length >= 6;
          return h('button', { class: 'pc-tile', type: 'button', disabled: dup || full, title: dup ? 'Ya llevas esa especie (cláusula de especies)' : full ? 'El equipo está completo' : 'Añadir', onclick: () => { e.members.push({ id: m.id, uid: m.uid, mega: 0 }); drawRows(); drawPc(); } },
            h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: '', loading: 'lazy' }),
            h('span', { class: 'pc-n' }, (m.nick || d.name) + (m.shiny ? ' ✨' : '')),
            h('span', { class: 'small muted' }, `Nv${m.level}${m.gender ? (m.gender === 'M' ? ' ♂' : ' ♀') : ''}`));
        }) : [h('p', { class: 'muted' }, box.length ? 'Nada coincide.' : 'Tu Caja PC está vacía.')]));
      };
      const save = h('button', { class: 'btn primary', type: 'button', onclick: async (ev) => {
        if (!e.members.length) { toast('Añade al menos un Pokémon.', 'error'); return; }
        const r = await act('battle:saveteam', { slot: e.slot, name: e.name, members: e.members.map((m) => ({ id: m.id, uid: m.uid, mega: m.mega || 0 })) }, ev.currentTarget);
        if (r) { st.teams = r.teams; sfx('click'); toast('Equipo guardado.', 'success'); drawTeams(); }
      } }, '💾 Guardar equipo');
      const del = teams[e.slot] ? h('button', { class: 'btn danger', type: 'button', onclick: async (ev) => {
        const r = await act('battle:delteam', { slot: e.slot }, ev.currentTarget);
        if (r) { st.teams = r.teams; e.loaded = false; drawTeams(); }
      } }, 'Borrar') : null;
      content.replaceChildren(h('div', { class: 'tm-layout' },
        h('div', { class: 'card stack' }, slotTabs, h('label', {}, 'Nombre', nameIn), rows, h('div', { class: 'row gap wrap' }, save, del),
          h('p', { class: 'muted small' }, 'Los movimientos y la habilidad de cada Pokémon se eligen aquí y valen en todos tus equipos. Una Megaevolución por equipo (hace falta haberla desbloqueado).')),
        h('div', { class: 'card stack' }, h('h3', {}, 'Caja PC'), h('div', { class: 'row gap' }, q), pc)));
      drawRows(); drawPc();
    }

    async function editMoves(sp, done) {
      const r = await act('battle:learnset', { id: sp.id, uid: sp.uid });
      if (!r) return;
      let moves = [...r.moves];
      let ability = r.ability;
      const filter = h('input', { placeholder: 'Buscar movimiento…', class: 'grow' });
      const list = h('div', { class: 'mv-list' });
      const cur = h('div', { class: 'mv-cur' });
      const abil = h('div', { class: 'ab-list' }, r.abilities.map((a) => h('label', { class: 'ab' }, h('input', { type: 'radio', name: 'ab', value: a.id, checked: a.id === ability, onchange: () => { ability = a.id; } }), h('span', {}, abilityEs(a.id), a.hidden ? h('span', { class: 'muted small' }, ' (oculta)') : null))));
      const draw = () => {
        cur.replaceChildren(...[0, 1, 2, 3].map((i) => (moves[i] ? row(moves[i], true) : h('div', { class: 'mvrow empty' }, '— hueco libre —'))));
        const t = filter.value.trim().toLowerCase();
        const all = r.learnset.filter((m) => !moves.includes(m.id)).filter((m) => !t || moveEs(m.id).toLowerCase().includes(t) || (TYPE_ES[m.type] || '').toLowerCase().includes(t))
          .sort((a, b) => b.bp - a.bp || moveEs(a.id).localeCompare(moveEs(b.id), 'es'));
        list.replaceChildren(...all.map((m) => row(m.id, false)));
      };
      const meta = (id) => r.learnset.find((m) => m.id === id) || { id, ...(moveMeta(id) || { type: 'normal', cat: 'x', bp: 0, acc: 0, pp: 0 }) };
      const row = (id, sel) => {
        const m = meta(id);
        return h('button', { class: 'mvrow t-' + m.type + (sel ? ' sel' : ''), type: 'button', onclick: () => {
          if (sel) moves = moves.filter((x) => x !== id);
          else if (moves.length < 4) moves.push(id);
          else { toast('Ya tienes 4 movimientos: quita uno primero.', 'error'); return; }
          draw();
        } }, h('b', {}, moveEs(id)), h('span', { class: 'mvr-ty' }, TYPE_ES[m.type]), h('span', { title: CAT[m.cat][0] }, CAT[m.cat][1]), h('span', {}, m.bp ? `Pot. ${m.bp}` : '—'), h('span', {}, m.acc ? `Prec. ${m.acc}` : 'Prec. —'), h('span', { class: 'muted' }, `PP ${m.pp}`));
      };
      filter.addEventListener('input', draw);
      const body = h('div', { class: 'stack' },
        h('div', { class: 'small muted' }, `Movimientos de ${sp.nick || dexOf(sp.id).name} (de 1 a 4). Toca un movimiento para quitarlo o añadirlo.`),
        cur, h('h4', {}, 'Habilidad'), abil, h('h4', {}, 'Todos los que puede aprender'), h('div', { class: 'row gap' }, filter), list,
        h('div', { class: 'row gap wrap' }, h('button', { class: 'btn primary', type: 'button', onclick: async (ev) => {
          const res = await act('battle:setmoves', { id: sp.id, uid: sp.uid, moves, ability }, ev.currentTarget);
          if (res) { sp.moves = res.moves; sp.ability = res.ability; sfx('click'); m.close(); done(); }
        } }, 'Guardar'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Cancelar')));
      const m = modal(body, { title: `⚙️ ${sp.nick || dexOf(sp.id).name}`, wide: true });
      draw();
    }

    // ---------- Pestaña Historial ----------
    async function drawHist() {
      const r = await act('battle:history');
      if (!r) return;
      const rows = r.history.length ? r.history.map((x) => h('div', { class: 'duel-row small' },
        h('span', {}, x.mode === 'cpu' ? '🏟️' : '🤝'),
        h('div', { class: 'grow' }, h('b', { class: x.tie ? '' : x.won ? 'good' : 'bad' }, x.tie ? 'Empate' : x.won ? 'Victoria' : 'Derrota'), ` contra ${x.foe}`,
          h('div', { class: 'muted small' }, `${FORMAT_ES[x.format]} · ${LEVEL_ES[x.level]} · ${x.turns} turnos · ${new Date(x.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`)),
        x.coins ? h('span', { class: x.coins > 0 ? 'good' : 'bad' }, `${x.coins > 0 ? '+' : ''}${fmt(x.coins)}`) : null,
        h('button', { class: 'btn small', type: 'button', onclick: (ev) => playReplay(x.id, ev.currentTarget) }, '▶ Ver')))
        : [h('p', { class: 'muted' }, 'Aún no has combatido. ¡Reta a un entrenador de la Liga!')];
      content.replaceChildren(h('div', { class: 'stack' }, h('div', { class: 'small muted' }, `Victorias premiadas hoy: ${r.wins.n}/${r.wins.max}. La repetición completa se guarda hasta que se reinicie el servidor (los últimos 30 combates).`), h('div', { class: 'duel-list' }, rows)));
    }
    async function playReplay(id, btn) {
      const r = await act('battle:replay', { id }, btn);
      if (!r) return;
      if (!r.replay) { toast('La repetición ya no está disponible (se borra al reiniciar el servidor).', 'info'); return; }
      await loadNames();
      const rp = r.replay;
      const view = { id: rp.id, side: rp.side, format: rp.format, you: rp.players[Number(rp.side[1]) - 1], foe: rp.players[2 - Number(rp.side[1])], roster: rp.roster, pickN: rp.pickN, log: rp.log };
      closeReplay();
      const screen = new BattleScreen(view, { replay: true, onExit: () => { closeReplay(); show(); } });
      ctx.replayScreen = screen;
      head.classList.add('hidden'); tabsEl.classList.add('hidden');
      const skip = h('button', { class: 'btn', type: 'button', onclick: () => { screen.skip = true; } }, 'Saltar ⏩');
      const close = h('button', { class: 'btn gold', type: 'button', onclick: () => { closeReplay(); head.classList.remove('hidden'); tabsEl.classList.remove('hidden'); show(); } }, 'Cerrar repetición');
      screen.menu.replaceChildren(h('div', { class: 'bt2-wait' }, h('span', {}, `▶ Repetición: ${view.you} contra ${view.foe}`), skip, close));
      content.replaceChildren(screen.root);
      screen.feed(rp.log.filter((l) => !l.startsWith('|request|')));
    }

    // ---------- Navegación ----------
    async function show() {
      if (inBattle() || ctx.replayScreen) return;
      content.replaceChildren(h('p', { class: 'muted' }, 'Cargando…'));
      await loadNames();
      if (!ctx.state) {
        const r = await act('battle:state');
        if (!r) { content.replaceChildren(h('p', { class: 'bad' }, 'No se pudo cargar. Inténtalo de nuevo.')); return; }
        ctx.state = r;
        ctx.challenges = r.challenges;
      } else {
        const r = await act('battle:state');
        if (r) { ctx.state = r; ctx.challenges = r.challenges; }
      }
      if (ctx.tab === 'fight') { await loadBox().catch(() => {}); drawFight(); }
      else if (ctx.tab === 'pvp') drawPvp();
      else if (ctx.tab === 'teams') drawTeams();
      else drawHist();
    }

    // ---------- Eventos del servidor ----------
    const onEvent = (ev) => {
      const sc = ctx.screen;
      if (!sc || ev.id !== sc.view.id) return;
      if (ev.lines && ev.lines.length) sc.feed(ev.lines);
      if (ev.request) sc.setRequest(ev.request, { chosen: false, deadline: ev.deadline });
      else if (ev.wait) sc.setRequest(sc.req, { chosen: true });
    };
    const onEnd = (info) => {
      const sc = ctx.screen;
      if (!sc || info.id !== sc.view.id) return;
      sc.end(info);
    };
    const onStart = (p) => { if (p && p.battle) openBattle(p.battle); };
    const onList = (l) => { ctx.challenges = l; if (ctx.state) ctx.state.challenges = l; if (ctx.tab === 'pvp' && ctx.drawOpen && !inBattle()) ctx.drawOpen(); };
    ctx.offs.push(bus.on('battle:event', onEvent), bus.on('battle:end', onEnd), bus.on('battle:start', onStart), bus.on('battle:list', onList));
    const onConnect = () => { if (ctx.screen || ctx.wasIn) resync(); };
    if (S.socket) S.socket.on('connect', onConnect);
    ctx.offs.push(() => { if (S.socket) S.socket.off('connect', onConnect); });

    drawTabs();
    (async () => {
      await loadNames();
      let r = null;
      try { r = await emit('battle:resume'); } catch { /* sin combate */ }
      if (r && r.battle) { ctx.wasIn = true; await openBattle(r.battle); } else show();
    })();
  },
  unmount() {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.offs.forEach((f) => f());
    if (ctx.screen) ctx.screen.destroy();
    if (ctx.replayScreen) ctx.replayScreen.destroy();
    this.ctx = null;
  },
};

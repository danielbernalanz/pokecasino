// Torneos entre amigos (server/tourney.js): crear, apuntarse por código o lista pública, cuadro en vivo y «Listo» para cada ronda.
// Cada ronda es un combate PvP normal: al empezar llega el aviso de combate y se juega en Combates.
import { S, h, act, emit, bus, sfx, toast, fmt, emptyState, loader, confirmRisk } from '../core.js';
import { clock } from './afk-common.js';

const FMT = { singles: 'Individual', doubles: 'Dobles' };
const LVL = { fair: 'Nivel 50', real: 'Niveles reales' };
let selected = null; // torneo que se está mirando
const cfg = () => S.data.tourney;
const roundName = (r, total) => (r === total ? 'Final' : r === total - 1 ? 'Semifinales' : r === total - 2 ? 'Cuartos' : `Ronda ${r}`);
const chip = (t, title) => h('span', { class: 'trn-chip', title }, t);
const rules = (t) => [chip(FMT[t.format]), chip(LVL[t.level], t.level === 'fair' ? 'Todos combaten a nivel 50, como el VGC' : 'Cada Pokémon con su nivel real'), t.bond ? chip('💞 Amistad') : null, t.tera ? chip('💎 Tera') : null, chip(t.entry ? `🪙 ${fmt(t.entry)}` : 'Gratis'), chip(`⏱️ ${t.wait} min/ronda`)];

export default {
  id: 'torneos', title: 'Torneos', icon: '🏆',
  async mount(root) {
    let st = null;
    let teams = [];
    let slot = 'auto';
    let alive = true;
    const body = h('div', { class: 'trn-body' });
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🏆 Torneos'), h('p', { class: 'muted' }, 'Eliminación directa entre amigos: 4, 8 o 16 plazas. Cada ronda es un combate PvP normal.')), body);

    async function load(id = selected) {
      try { st = await emit('tourney:state', id ? { id } : {}); } catch (e) { if (alive) toast(e.message, 'error'); return; }
      if (!alive) return;
      if (!selected && st.mine) selected = st.mine;
      if (selected && !st.current) selected = null;
      draw();
    }
    async function loadTeams() {
      try { const r = await emit('battle:state'); teams = (r.teams || []).map((t, i) => (t ? { i, name: t.name, n: t.members.length } : null)).filter(Boolean); } catch { teams = []; }
    }

    // ---------- Lista y creación ----------
    function createCard() {
      const f = { name: '', size: 8, format: 'singles', level: 'fair', bond: true, tera: true, entry: 0, wait: 10, pub: true };
      const sel = (key, opts, label) => h('label', {}, label, h('select', { onchange: (e) => { f[key] = typeof opts[0][0] === 'number' ? Number(e.target.value) : e.target.value; } }, opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l))));
      return h('form', { class: 'card stack trn-create', onsubmit: async (e) => {
        e.preventDefault();
        if (f.entry && !(await confirmRisk('tourney-entry', { title: `Inscripción de ${fmt(f.entry)} monedas`, text: `Pagarás ${fmt(f.entry)} monedas para entrar. El bote va al campeón (70 %) y al finalista (30 %), menos un ${Math.round(cfg().rake * 100)} % de comisión. Si el torneo se cancela, se devuelve.`, danger: 'Crear y pagar', safe: 'Cancelar' }))) return;
        const r = await act('tourney:create', { ...f, name: f.name.trim() }, e.submitter);
        if (r) { sfx('click'); selected = r.id; st = r; draw(); }
      } },
      h('h3', {}, '➕ Crear un torneo'),
      h('label', {}, 'Nombre (opcional)', h('input', { maxlength: 24, placeholder: `Torneo de ${S.me.username}`, oninput: (e) => { f.name = e.target.value; } })),
      h('div', { class: 'trn-opts' },
        sel('size', cfg().sizes.map((n) => [n, `${n} plazas`]), 'Plazas'),
        sel('format', Object.entries(FMT), 'Formato'),
        sel('level', Object.entries(LVL), 'Niveles'),
        sel('wait', cfg().waits.map((n) => [n, `${n} min`]), 'Plazo por combate'),
        sel('entry', cfg().entries.map((n) => [n, n ? `${fmt(n)} monedas` : 'Gratis']), 'Inscripción')),
      h('div', { class: 'row gap wrap' },
        h('label', { class: 'bond-opt' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { f.bond = e.target.checked; } }), ' 💞 Efectos de amistad'),
        h('label', { class: 'bond-opt' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { f.tera = e.target.checked; } }), ' 💎 Teracristalización'),
        h('label', { class: 'bond-opt' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { f.pub = e.target.checked; } }), ' 🌐 Visible en la lista pública')),
      h('button', { class: 'btn primary', type: 'submit' }, 'Crear torneo'),
      h('p', { class: 'small muted' }, `Con bote hace falta cuenta con nivel 3 y 3 días, y como mucho ${fmt(cfg().entryDaily)} monedas de inscripciones al día (hoy te quedan ${fmt(st.left)}).`));
    }
    function listCard() {
      const code = h('input', { placeholder: 'Código (5 letras)', maxlength: 5, 'aria-label': 'Código del torneo', style: { textTransform: 'uppercase' } });
      const open = (t) => h('div', { class: 'trn-row' },
        h('div', { class: 'grow' }, h('b', {}, t.name), h('div', { class: 'small muted' }, `${t.host} · ${t.state === 'open' ? `${t.n}/${t.size}` : 'en marcha'} · ${FMT[t.format]} · ${t.entry ? '🪙 ' + fmt(t.entry) : 'gratis'}`)),
        h('button', { class: 'btn small', type: 'button', onclick: () => { selected = t.id; load(t.id); } }, 'Ver'));
      return h('div', { class: 'card stack' },
        h('h3', {}, '🔑 Entrar con código'),
        h('form', { class: 'row gap', onsubmit: (e) => { e.preventDefault(); const c = code.value.trim().toUpperCase(); if (c) { selected = c; load(c); } } }, code, h('button', { class: 'btn' }, 'Buscar')),
        h('h3', {}, '🌐 Torneos públicos'),
        st.list.length ? h('div', { class: 'stack' }, st.list.map(open)) : h('p', { class: 'muted small' }, 'No hay torneos públicos ahora mismo. ¡Crea el primero!'),
        st.recent.length ? h('div', { class: 'small muted' }, '🏆 Últimos campeones: ', st.recent.map((r) => `${r.champion} («${r.name}»)`).join(' · ')) : null,
        h('div', { class: 'small muted' }, `Tu historial: ${st.stats.played} torneos jugados · ${st.stats.champion} ganados`));
    }

    // ---------- Torneo ----------
    const mClock = (m) => `⏳ ${clock(m.left)}`;
    const meTitle = (t) => { const me = t.me; return `${roundName(me.r, t.rounds)}: ${(me.ready ? `✅ Listo: esperando a ${me.foe}` : `Te toca contra ${me.foe}`)} · quedan ${clock(me.left)}`; };
    function bracket(t) {
      const cols = [];
      for (let r = 1; r <= t.rounds; r++) {
        const ms = t.matches.filter((m) => m.r === r);
        cols.push(h('div', { class: 'trn-col' }, h('div', { class: 'trn-colh' }, roundName(r, t.rounds)), ms.map((m) => {
          const side = (name, pend, win) => h('div', { class: 'trn-side' + (win ? ' win' : '') + (m.state === 'done' && !win && name ? ' lose' : '') + (name === S.me.username ? ' me' : '') }, pend ? '…' : name || h('i', { class: 'muted' }, 'libre'));
          const status = m.state === 'live' ? '⚔️ en juego' : m.state === 'wait' ? mClock(m) : m.state === 'done' ? (m.how === 'bye' ? 'pasa directo' : m.how === 'wo' ? 'incomparecencia' : m.how === 'dq' ? 'nadie se presentó' : '') : '';
          return h('div', { class: `trn-match st-${m.state}` + (m.mine ? ' mine' : '') }, side(m.a, m.pa, m.winner && m.winner === m.a), side(m.b, m.pb, m.winner && m.winner === m.b), status ? h('div', { class: 'trn-st small muted', 'data-clk': `${m.r}:${m.i}` }, status) : null);
        })));
      }
      return h('div', { class: 'trn-bracket' }, cols);
    }
    function myPanel(t) {
      const me = t.me;
      if (!me) {
        if (t.state === 'running' && t.joined) return h('div', { class: 'card trn-me' }, h('p', { class: 'muted' }, 'Ahora no tienes combate: espera a que acabe la ronda (o ya estás eliminado).'));
        return null;
      }
      if (me.state === 'live') return h('div', { class: 'card trn-me hot' }, h('b', {}, `⚔️ Tu combate contra ${me.foe} está en marcha`), h('a', { class: 'btn primary', href: '#/combates' }, 'Ir al combate'));
      const pick = h('select', { 'aria-label': 'Equipo', onchange: (e) => { slot = e.target.value; } }, h('option', { value: 'auto' }, '⚡ Equipo automático (mis mejores)'), teams.map((x) => h('option', { value: String(x.i), selected: String(x.i) === slot }, `🎒 ${x.name} (${x.n})`)));
      return h('div', { class: 'card trn-me hot stack' }, h('b', { 'data-me': '1' }, meTitle(t)),
        me.ready ? h('p', { class: 'small muted' }, 'Cuando tu rival pulse «Listo» empezará el combate. Si no se presenta en el plazo, ganas tú.')
          : h('div', { class: 'row gap wrap' }, pick, h('button', { class: 'btn primary', type: 'button', onclick: async (e) => { const r = await act('tourney:ready', { id: t.id, slot }, e.currentTarget); if (r) { sfx('click'); st = r; draw(); } } }, '✅ Listo')));
    }
    function detail() {
      const t = st.current;
      const total = t.players.length;
      const act_ = [];
      if (t.state === 'open' && !t.joined) act_.push(h('button', { class: 'btn primary', type: 'button', onclick: async (e) => {
        if (t.entry && !(await confirmRisk('tourney-entry', { title: `Inscripción de ${fmt(t.entry)} monedas`, text: `Pagarás ${fmt(t.entry)} monedas. Si el torneo se cancela o sales antes de empezar, se devuelven.`, danger: 'Inscribirme', safe: 'Cancelar' }))) return;
        const r = await act('tourney:join', { id: t.id }, e.currentTarget); if (r) { sfx('click'); st = r; draw(); } } }, t.entry ? `Inscribirme (${fmt(t.entry)})` : 'Inscribirme'));
      if (t.state === 'open' && t.joined && !t.hostId) act_.push(h('button', { class: 'btn', type: 'button', onclick: async (e) => { const r = await act('tourney:leave', { id: t.id }, e.currentTarget); if (r) { selected = null; st = r; draw(); } } }, 'Salir'));
      if (t.state === 'open' && t.hostId) {
        const who = h('input', { list: 'trn-online', placeholder: 'Invitar a…', 'aria-label': 'Invitar a un jugador' });
        act_.push(h('form', { class: 'row gap', onsubmit: async (e) => { e.preventDefault(); if (who.value.trim() && await act('tourney:invite', { id: t.id, to: who.value.trim() })) { toast('Invitación enviada.', 'success'); who.value = ''; } } }, who, h('datalist', { id: 'trn-online' }, (S.online || []).filter((u) => u.username !== S.me.username).map((u) => h('option', { value: u.username }))), h('button', { class: 'btn small' }, '✉️')));
        act_.push(h('button', { class: 'btn primary', type: 'button', disabled: total < cfg().min, title: `Hacen falta al menos ${cfg().min}`, onclick: async (e) => { const r = await act('tourney:start', { id: t.id }, e.currentTarget); if (r) { sfx('big'); st = r; draw(); } } }, `▶ Empezar ahora (${total}/${t.size})`));
        act_.push(h('button', { class: 'btn danger', type: 'button', onclick: async (e) => { if (!(await confirmRisk('tourney-cancel', { title: '¿Cancelar el torneo?', text: 'Se devuelven las inscripciones a todos.', danger: 'Cancelar torneo', safe: 'Seguir' }))) return; const r = await act('tourney:cancel', { id: t.id }, e.currentTarget); if (r) { selected = null; st = r; draw(); } } }, 'Cancelar'));
      }
      if (t.state === 'running' && S.me.isAdmin) act_.push(h('button', { class: 'btn danger small', type: 'button', onclick: async (e) => { const r = await act('tourney:cancel', { id: t.id }, e.currentTarget); if (r) { selected = null; st = r; draw(); } } }, 'Cancelar (admin)'));
      const pot = t.pot;
      return h('div', { class: 'stack' },
        h('div', { class: 'row gap wrap between' }, h('button', { class: 'btn small', type: 'button', onclick: () => { selected = null; load(); } }, '← Torneos'),
          h('span', { class: 'trn-code', title: 'Comparte este código para que se apunten' }, `Código ${t.id}`)),
        h('div', { class: 'card stack' },
          h('div', { class: 'row gap wrap between' }, h('h2', { class: 'trn-title' }, '🏆 ', t.name), h('span', { class: 'small muted' }, `Anfitrión: ${t.host}`)),
          h('div', { class: 'row gap wrap' }, rules(t)),
          pot ? h('div', { class: 'small' }, `🪙 Bote ${fmt(pot.pool)} · comisión ${fmt(pot.rake)} · campeón ${fmt(pot.champ)} · finalista ${fmt(pot.runner)}${pot.done ? ' (pagado)' : ''}`) : null,
          t.state === 'open' ? h('div', { class: 'small' }, `Inscritos (${total}/${t.size}): `, t.players.map((p) => p.name).join(', '), h('div', { class: 'muted' }, 'El cuadro se genera al llenarse las plazas o cuando el anfitrión lo inicia (mínimo 3).')) : null,
          t.state === 'done' ? h('div', { class: 'trn-champ' }, t.champion ? `🏆 Campeón: ${t.champion}${t.runnerUp ? ` · 🥈 Finalista: ${t.runnerUp}` : ''}` : 'Terminó sin campeón.') : null,
          t.state === 'cancelled' ? h('div', { class: 'muted' }, 'Torneo cancelado: inscripciones devueltas.') : null,
          act_.length ? h('div', { class: 'row gap wrap' }, act_) : null),
        myPanel(t),
        t.state !== 'open' && t.state !== 'cancelled' ? bracket(t) : null);
    }
    function draw() {
      if (!st) { body.replaceChildren(loader()); return; }
      if (st.current) body.replaceChildren(detail());
      else body.replaceChildren(h('div', { class: 'trn-home' }, createCard(), listCard()));
    }

    // Cuenta atrás de los plazos: solo se actualiza el texto de los relojes (reconstruir todo cada segundo cerraba el desplegable de equipo).
    // Cuando un plazo llega a 0 se pide el estado al servidor (que es quien decide qué pasa).
    const tick = setInterval(() => {
      if (!st || !st.current) return;
      const t = st.current;
      let expired = false;
      for (const m of t.matches) if (m.left > 0) { m.left = Math.max(0, m.left - 1000); if (!m.left) expired = true; }
      if (t.me && t.me.left > 0) { t.me.left = Math.max(0, t.me.left - 1000); if (!t.me.left) expired = true; }
      if (!document.hidden) {
        for (const el of body.querySelectorAll('[data-clk]')) { const [r, i] = el.dataset.clk.split(':').map(Number); const m = t.matches.find((x) => x.r === r && x.i === i); if (m && m.state === 'wait') el.textContent = mClock(m); }
        const mine = body.querySelector('[data-me]');
        if (mine && t.me) mine.textContent = meTitle(t);
      }
      if (expired) load();
    }, 1000);
    let t0 = 0;
    const offs = [bus.on('tourney:changed', (p) => { if (!alive) return; clearTimeout(t0); t0 = setTimeout(() => { if (!selected || (p && p.id === selected) || !st || !st.current) load(); }, 250); }), bus.on('battle:end', () => setTimeout(() => load(), 1200))];
    this.cleanup = () => { alive = false; clearInterval(tick); clearTimeout(t0); offs.forEach((f) => f && f()); };
    draw();
    await loadTeams();
    await load();
  },
  unmount() { if (this.cleanup) this.cleanup(); },
};

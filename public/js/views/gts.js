// GTS (Global Trade Station): intercambio de Pokémon por Pokémon, como en los juegos. Pestañas: Depositar · Buscar · Mis depósitos.
// Todo lo decide el servidor (server/gts.js); aquí solo se elige y se muestra.
import { S, h, act, emit, sfx, toast, modal, sprite, typeBadge, say, emptyState, loader, confirmRisk, MON } from '../core.js';
import { monPicker, loadMons, clock } from './afk-common.js';
import { openSpecimen } from './pc.js';

let tab = 'deposit';
const cfg = () => S.data.gts;
const dex = (id) => S.dexById.get(Number(id));
const sexTag = (g) => (g === 'M' ? '♂' : g === 'F' ? '♀' : '');
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const LEVELS = [[0, 'Cualquier nivel'], ...Array.from({ length: 10 }, (_, i) => [i + 1, `Nv. ${i * 10 + 1}-${(i + 1) * 10}`])];
const lvText = (lv) => LEVELS[lv][1];
const wantText = (w) => `${dex(w.id).name}${w.g === 'M' ? ' ♂' : w.g === 'F' ? ' ♀' : ''} · ${lvText(w.lv)}`;
const SEX = [['any', 'Cualquiera'], ['M', '♂ Macho'], ['F', '♀ Hembra']];
const label = (m) => m.nick || dex(m.id).name;

// Especie escrita («Pikachu», «25», «#025») → id (o null).
function pickSpecies(text, only = null) {
  const q = norm(text).replace(/^#/, '');
  if (!q) return null;
  const hit = S.data.dex.find((p) => (!only || only.has(p.id)) && (norm(p.name) === q || String(p.id) === String(Number(q))));
  return hit ? hit.id : null;
}
// Pequeña ficha de un ejemplar o de lo que se pide.
function monLine(m, extra) {
  const p = dex(m.id);
  return h('div', { class: 'gts-mon' },
    h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: '', loading: 'lazy' }),
    h('div', { class: 'gts-mon-txt' },
      h('b', {}, `${m.shiny ? '✨ ' : ''}${m.nick || p.name} ${sexTag(m.gender)}`),
      h('span', { class: 'small muted' }, `Nv. ${m.level}${m.ot ? ` · OT ${m.ot}` : ''}`),
      h('span', { class: 'types' }, p.types.map(typeBadge)), extra || null));
}
function wantLine(w) {
  const p = dex(w.id);
  return h('div', { class: 'gts-mon want' },
    h('img', { class: 'pixel', src: sprite(w.id), alt: '', loading: 'lazy' }),
    h('div', { class: 'gts-mon-txt' }, h('b', {}, `${p.name} ${sexTag(w.g)}`), h('span', { class: 'small muted' }, lvText(w.lv)), h('span', { class: 'types' }, p.types.map(typeBadge))));
}
const left = (ms) => (ms <= 0 ? 'caducado' : ms > 864e5 ? `${Math.floor(ms / 864e5)} d ${Math.floor((ms % 864e5) / 36e5)} h` : clock(ms));

export default {
  id: 'gts', title: 'GTS', icon: '🌐',
  async mount(root) {
    let st = null; // { mine, log, seen, left, young }
    let mons = [];
    let found = null; // última búsqueda
    const body = h('div', { class: 'gts-body' });
    const tabs = h('div', { class: 'tabs gts-tabs', role: 'tablist' });
    const TABS = [['deposit', '📥', 'Depositar'], ['search', '🔎', 'Buscar'], ['mine', '📦', 'Mis depósitos']];
    const seen = () => new Set(st ? st.seen : []);

    function apply(r) { if (r.mine) st = { mine: r.mine, log: r.log, seen: r.seen, left: r.left, young: r.young }; }
    async function reload() { apply(await emit('gts:state')); mons = await loadMons(); }
    function go(k) { tab = k; draw(); }
    function drawTabs() {
      const n = st ? st.mine.length : 0;
      const pend = st ? st.mine.filter((d) => d.state !== 'open').length : 0;
      tabs.replaceChildren(...TABS.map(([k, ico, l]) => h('button', { class: 'tab' + (tab === k ? ' active' : ''), 'data-tab': k, type: 'button', role: 'tab', 'aria-selected': String(tab === k), onclick: () => go(k) },
        h('span', { class: 'tab-ico', 'aria-hidden': 'true' }, ico), h('span', { class: 'tab-lbl' }, l + (k === 'mine' ? ` (${n}/${cfg().max})` : '')), k === 'mine' && pend ? h('i', { class: 'new-dot' }) : null)));
    }
    function draw() {
      drawTabs();
      if (!st) return;
      body.replaceChildren(tab === 'deposit' ? depositTab() : tab === 'search' ? searchTab() : mineTab());
    }
    const info = () => h('p', { class: 'small muted gts-note' }, `Depositar cuesta ${cfg().fee} monedas (no se devuelven, ni si retiras ni si caduca) · hasta ${cfg().max} depósitos · caducan a los ${cfg().expireDays} días y vuelven a tu Caja · hasta ${cfg().daily} intercambios al día (te quedan ${st.left}). Los intercambios conservan nivel y rasgos del Pokémon (no EVs ni amistad).`);

    // ---- Depositar ----
    function depositTab() {
      if (st.young) return h('div', { class: 'stack' }, emptyState(st.young, MON.psyduck));
      const sel = new Set();
      let want = { id: null, g: 'any', lv: 0 };
      const speciesIn = h('input', { type: 'text', class: 'gts-species', placeholder: 'Especie que pides (solo las que has visto)', autocomplete: 'off', list: 'gts-seen', 'aria-label': 'Especie que pides', oninput: sync });
      const dl = h('datalist', { id: 'gts-seen' }, st.seen.map((id) => h('option', { value: dex(id).name }, `#${String(id).padStart(3, '0')}`)));
      const sexRow = h('div', { class: 'afk-hours', role: 'group', 'aria-label': 'Sexo' });
      const lvSel = h('select', { 'aria-label': 'Rango de nivel', onchange: (e) => { want.lv = Number(e.target.value); sync(); } }, LEVELS.map(([v, l]) => h('option', { value: v }, l)));
      const sum = h('div', { class: 'gts-sum small' });
      const btn = h('button', { class: 'btn primary big', type: 'button', disabled: true, onclick: submit }, `📥 Depositar (${cfg().fee} monedas)`);
      function sync() {
        want.id = pickSpecies(speciesIn.value, seen());
        sexRow.replaceChildren(...SEX.map(([v, l]) => h('button', { type: 'button', class: 'chip' + (want.g === v ? ' active' : ''), 'aria-pressed': want.g === v ? 'true' : 'false', onclick: () => { want.g = v; sync(); } }, l)));
        const m = picker.get()[0];
        const ok = !!m && !!want.id && S.me.coins >= cfg().fee && st.mine.length < cfg().max;
        btn.disabled = !ok;
        sum.replaceChildren(!m ? 'Elige el Pokémon que depositas.' : !want.id ? 'Escribe qué especie pides (solo las que has visto).'
          : st.mine.length >= cfg().max ? `Ya tienes ${cfg().max} depósitos.` : S.me.coins < cfg().fee ? `Te faltan monedas: depositar cuesta ${cfg().fee}.`
            : `Das ${label(m)} (Nv. ${m.level}) a cambio de ${wantText(want)}.`);
      }
      async function submit(e) {
        const m = picker.get()[0];
        if (!m || !want.id) return;
        const extra = [m.fav ? '⚠ Es uno de tus favoritos' : '', m.shiny ? '⚠ Es variocolor' : ''].filter(Boolean);
        if (!(await confirmRisk('gts-deposit', { section: 'la GTS', title: `¿Depositar ${label(m)}?`, danger: 'Depositar', safe: 'Cancelar',
          text: 'Sale de tu Caja hasta que alguien lo intercambie, lo retires o caduque (entonces vuelve intacto). La comisión no se devuelve.',
          details: [`Das: ${label(m)} Nv. ${m.level}`, `Pides: ${wantText(want)}`, `Comisión: ${cfg().fee} monedas`, ...extra] }))) return;
        const r = await act('gts:deposit', { id: m.id, uid: m.uid, want: { id: want.id, g: want.g, lv: want.lv } }, e.currentTarget);
        if (!r) return;
        sfx('win'); toast(`${label(m)} está en la GTS. ¡Te avisaremos cuando alguien lo cambie!`, 'success');
        apply(r); mons = await loadMons(); tab = 'mine'; draw();
      }
      const picker = monPicker(mons, { max: 1, selected: sel, onChange: sync,
        can: (m) => (m.away ? (m.away === 'care' ? 'En el Criadero' : 'De expedición') : m.buddy ? 'Compañero' : null),
        rank: (m) => m.level });
      const view = h('button', { class: 'btn small', type: 'button', onclick: () => { const m = picker.get()[0]; if (m) openSpecimen(m.uid); } }, '📋 Ver ficha');
      sync();
      return h('div', { class: 'gts-grid' },
        h('section', { class: 'gts-col' }, h('h2', { class: 'section-title' }, '1 · Tu Pokémon'), picker.el),
        h('section', { class: 'gts-col gts-form' }, h('h2', { class: 'section-title' }, '2 · Qué pides'),
          speciesIn, dl, h('h4', {}, 'Sexo'), sexRow, h('h4', {}, 'Nivel'), lvSel, sum, h('div', { class: 'row gap wrap' }, btn, view), info()));
    }

    // ---- Buscar ----
    function searchTab() {
      const speciesIn = h('input', { type: 'search', class: 'gts-species', placeholder: 'Pokémon que quieres (vacío = los últimos)', autocomplete: 'off', list: 'gts-all', 'aria-label': 'Pokémon que quieres',
        onkeydown: (e) => { if (e.key === 'Enter') run(e); } });
      const dl = h('datalist', { id: 'gts-all' }, S.data.dex.map((p) => h('option', { value: p.name }, `#${String(p.id).padStart(3, '0')}`)));
      const only = h('input', { type: 'checkbox', onchange: () => paint() });
      const list = h('div', { class: 'gts-list' });
      async function run(e) {
        const txt = speciesIn.value.trim();
        const sp = txt ? pickSpecies(txt) : null;
        if (txt && !sp) return toast('No conozco ese Pokémon.', 'error');
        const r = await act('gts:search', { species: sp }, e.currentTarget || null);
        if (!r) return;
        found = r; paint();
      }
      function paint() {
        if (!found) { list.replaceChildren(h('p', { class: 'muted small' }, 'Busca por el Pokémon que quieres conseguir.')); return; }
        const rows = found.list.filter((d) => !only.checked || d.can.length);
        list.replaceChildren(...(rows.length ? rows.map(card) : [emptyState(found.list.length ? 'Nadie pide algo que tú tengas ahora mismo.' : 'No hay depósitos de ese Pokémon. ¡Prueba con otro!', MON.chansey)]));
      }
      function card(d) {
        const can = d.can.length > 0;
        return h('div', { class: 'gts-card' + (can ? ' can' : '') },
          h('div', { class: 'gts-card-in' }, monLine(d.mon, h('span', { class: 'small muted' }, `de ${d.user} · ${left(d.expiresAt - Date.now())}`)),
            h('span', { class: 'gts-arrow', 'aria-hidden': 'true' }, '⇄'), wantLine(d.want)),
          h('button', { class: 'btn primary', type: 'button', disabled: !can, title: can ? '' : 'No tienes un ejemplar que cumpla lo que piden', onclick: () => offer(d) }, can ? '🔁 Intercambiar' : 'No cumples'));
      }
      function offer(d) {
        const opts = mons.filter((m) => d.can.includes(m.uid));
        const sel = new Set();
        const go = h('button', { class: 'btn primary big', type: 'button', disabled: true, onclick: async (e) => {
          const m = opts.find((x) => sel.has(x.uid));
          if (!m) return;
          const extra = [m.fav ? '⚠ Es uno de tus favoritos' : '', m.shiny ? '⚠ Es variocolor' : ''].filter(Boolean);
          if (!(await confirmRisk('gts-offer', { section: 'la GTS', title: `¿Intercambiar ${label(m)}?`, danger: 'Intercambiar', safe: 'Cancelar',
            text: 'El intercambio es inmediato y no se puede deshacer.', details: [`Das: ${label(m)} Nv. ${m.level}`, `Recibes: ${d.mon.shiny ? '✨ ' : ''}${dex(d.mon.id).name} Nv. ${d.mon.level}`, ...extra] }))) return;
          const r = await act('gts:offer', { dep: d.id, uid: m.uid }, e.currentTarget);
          if (!r) { await run({ currentTarget: null }); return; }
          mdl.close(); sfx('shiny');
          toast(`¡Intercambio hecho! Recibiste ${dex(r.got.id).name} Nv. ${r.got.level}`, 'success');
          apply(r); mons = await loadMons(); found = null; draw();
        } }, '🔁 Intercambiar');
        const pk = monPicker(opts, { max: 1, selected: sel, onChange: () => { go.disabled = !sel.size; }, rank: (m) => m.level });
        const mdl = modal(h('div', { class: 'stack' }, h('div', { class: 'gts-card-in' }, monLine(d.mon), h('span', { class: 'gts-arrow' }, '⇄'), wantLine(d.want)),
          h('h4', {}, 'Elige tu ejemplar'), pk.el, h('div', { class: 'row gap wrap' }, go,
            h('button', { class: 'btn small', type: 'button', onclick: () => { const m = opts.find((x) => sel.has(x.uid)); if (m) openSpecimen(m.uid); } }, '📋 Ver ficha'))), { title: `Intercambiar con ${d.user}`, wide: true });
      }
      if (!found) run({ currentTarget: null });
      paint();
      return h('div', { class: 'stack gts-search' },
        h('div', { class: 'row gap wrap' }, speciesIn, dl, h('button', { class: 'btn primary', type: 'button', onclick: run }, '🔎 Buscar'),
          h('label', { class: 'gts-only' }, only, h('span', {}, 'Solo los que puedo cumplir'))), list);
    }

    // ---- Mis depósitos ----
    function mineTab() {
      const row = (d) => {
        const done = d.state === 'done';
        const exp = d.state === 'expired';
        return h('div', { class: 'gts-card ' + d.state },
          h('div', { class: 'gts-card-in' }, monLine(d.mon), h('span', { class: 'gts-arrow', 'aria-hidden': 'true' }, '⇄'), wantLine(d.want)),
          h('div', { class: 'gts-state small' }, done ? `✅ ${d.with} lo intercambió: ${dex(d.recv.id).name} Nv. ${d.recv.level} te espera (hace falta sitio en la Caja).`
            : exp ? '⌛ Caducado: no cabe en tu Caja todavía.' : `⏳ Caduca en ${left(d.expiresAt - Date.now())}`),
          done || exp ? h('button', { class: 'btn gold', type: 'button', onclick: async (e) => { const r = await act('gts:claim', {}, e.currentTarget); if (r) { apply(r); mons = await loadMons(); draw(); } } }, '🎒 Recoger')
            : null,
          !done ? h('button', { class: 'btn danger', type: 'button', onclick: async (e) => {
            if (!(await confirmRisk('gts-cancel', { section: 'la GTS', title: `¿Retirar ${label(d.mon)}?`, danger: 'Retirar', safe: 'Seguir', text: 'Vuelve a tu Caja intacto. La comisión de depósito no se devuelve.' }))) return;
            const r = await act('gts:cancel', { dep: d.id }, e.currentTarget);
            if (r) { toast(`${label(d.mon)} vuelve a tu Caja.`, 'success'); apply(r); mons = await loadMons(); draw(); }
          } }, exp ? 'Retirar' : '↩ Retirar') : null);
      };
      return h('div', { class: 'stack' },
        st.mine.length ? h('div', { class: 'gts-list' }, st.mine.map(row)) : emptyState('No tienes depósitos. Deposita un Pokémon y pide el que quieres.', MON.snorlax, h('button', { class: 'btn primary', type: 'button', onclick: () => go('deposit') }, '📥 Depositar')),
        info(),
        st.log.length ? h('div', { class: 'gts-log' }, h('h2', { class: 'section-title' }, 'Últimos intercambios'),
          h('ul', { class: 'small' }, st.log.map((x) => h('li', {}, `${new Date(x.at).toLocaleDateString('es-ES')} · diste ${x.gave.shiny ? '✨ ' : ''}${dex(x.gave.id).name} Nv. ${x.gave.level} por ${x.got.shiny ? '✨ ' : ''}${dex(x.got.id).name} Nv. ${x.got.level} (con ${x.with})`)))) : null);
    }

    root.append(h('div', { class: 'game-head' }, h('h1', {}, '🌐 GTS')),
      say({ mon: MON.wobbuffet, who: 'Estación Global', text: 'Deposita un Pokémon, di cuál quieres a cambio y otro entrenador te lo cambia en cualquier momento. Un Pokémon por otro: aquí no hay monedas.', cls: 'compact' }),
      tabs, body);
    body.append(loader('Conectando con la GTS…'));
    try { await reload(); draw(); } catch (e) { toast(e.message, 'error'); body.replaceChildren(emptyState('No se pudo abrir la GTS.', MON.psyduck)); }
    // Aviso en directo: si alguien intercambia contigo mientras estás aquí, se refresca (los toasts del servidor ya avisan).
    this.off = () => {};
  },
  unmount() { this.off && this.off(); },
};

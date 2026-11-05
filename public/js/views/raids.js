// Teraincursiones cooperativas: jefes teracristalizados de 1★ a 5★, en solitario (3 aliados CPU) o con hasta 4 jugadores (ver server/raid.js).
import { S, h, act, emit, fmt, sfx, toast, modal, sprite, typeBadge, hpBar, itemImg, bus, TYPE_ES } from '../core.js';
import { aniImg } from '../anim.js';
import { themeNote } from '../weekly.js';
import { confetti, reduced, shake } from '../fx.js';
import { TYPE_COLOR } from './tera-ui.js';

const cfg = () => S.data.raid;
const dexName = (id) => (S.dexById.get(id) || {}).name || '#' + id;
const stars = (n) => '★'.repeat(n);
const effTxt = (e) => (e === 0 ? 'Sin efecto' : e >= 4 ? 'Muy eficaz ×4' : e > 1 ? 'Muy eficaz ×2' : e < 1 ? (e <= 0.25 ? 'Poco eficaz ×¼' : 'Poco eficaz ×½') : '');
const effOf = (att, def) => (S.data.chart && S.data.chart[att] ? def.reduce((m, d) => m * (S.data.chart[att][d] ?? 1), 1) : 1);
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const CAT = { p: '💥 Físico', s: '✨ Especial', x: 'Estado' };

export default {
  id: 'raids', title: 'Teraincursiones', icon: '💎',
  async mount(root) {
    root.classList.add('view-raids');
    let st = null; // estado general (jefes del día, sala, capturas…)
    let cur = null; // la incursión en la que estoy (vista del servidor)
    let prev = null;
    let busy = false;
    const teraSel = { on: false, turn: -1, id: null }; // Teracristalizar: se recuerda mientras dure el turno (los avisos de otros jugadores repintan la pantalla) y se reinicia al cambiar de turno
    let timers = [];
    const body = h('div', { class: 'raid-body' });
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '💎 Teraincursiones'), h('p', { class: 'muted' }, 'Jefes teracristalizados de 1★ a 5★: solo con 3 aliados o con hasta 4 jugadores. Capturas al jefe con su Teratipo.')), body);
    { const tn = themeNote(); if (tn) root.querySelector('.game-head')?.append(tn); }

    async function load() { try { st = await emit('raid:state'); } catch (e) { toast(e.message, 'error'); return; } cur = st.raid; render(); }
    const stop = () => { timers.forEach(clearInterval); timers = []; };
    this.stopTimers = stop;

    // ---------- Elegir Pokémon ----------
    async function pickMon(boss, title) {
      const r = await act('raid:team', {});
      if (!r) return null;
      return new Promise((resolve) => {
        const wrap = h('div', { class: 'stack raid-pick' });
        let done = false;
        const m = modal(wrap, { title, wide: true, onClose: () => { if (!done) resolve(null); } });
        const q = h('input', { type: 'search', placeholder: 'Buscar por nombre…', class: 'cap-q', 'aria-label': 'Buscar Pokémon' });
        const grid = h('div', { class: 'cap-mons' });
        const bt = boss ? [boss.tera] : null;
        const score = (x) => (bt ? Math.max(0, ...x.moves.filter((mv) => mv.power > 0 && mv.cat !== 'Status').map((mv) => effOf(mv.type, bt))) : 0);
        const draw = () => {
          const t = q.value.trim().toLowerCase();
          const list = r.mons.filter((x) => !t || dexName(x.id).toLowerCase().includes(t) || (x.nick || '').toLowerCase().includes(t))
            .sort((a, b) => score(b) - score(a) || b.level - a.level).slice(0, 60);
          grid.replaceChildren(...list.map((x) => {
            const e = score(x);
            return h('button', { type: 'button', class: 'cap-mon raid-mon', 'data-uid': x.uid, onclick: () => { done = true; m.close(); resolve(x); } },
              h('img', { class: 'pixel', src: sprite(x.id, x.shiny), alt: '' }), h('b', {}, x.nick || dexName(x.id)),
              h('span', { class: 'small muted' }, `💎 ${TYPE_ES[x.tera]}${x.buddy ? ' · 🤝' : ''}`),
              e > 1 ? h('span', { class: 'small good' }, `Ataque ${effTxt(e).toLowerCase()}`) : e > 0 && e < 1 ? h('span', { class: 'small bad' }, 'Ataques poco eficaces') : null);
          }));
          if (!list.length) grid.append(h('p', { class: 'muted' }, 'Ningún Pokémon libre con ese nombre.'));
        };
        q.addEventListener('input', draw); draw();
        wrap.append(h('p', { class: 'small muted' }, 'Elige tu Pokémon (en la incursión lucha con las estadísticas del Nv. 50 y sus movimientos equipados). Los de expedición o Criadero no pueden.'), q, grid);
      });
    }

    // ---------- Pantalla general ----------
    function bossCard(b) {
      const tc = TYPE_COLOR[b.tera] || '#9be9f5';
      const p = S.dexById.get(b.id);
      const go = async (mode) => {
        const x = await pickMon(b, `${stars(b.star)} ${p.name}: ¿con quién vas?`);
        if (!x) return;
        busy = true;
        const r = await act('raid:create', { star: b.star, slot: b.slot, id: x.id, uid: x.uid, mode });
        busy = false;
        if (r) { cur = r.raid; sfx('click'); render(); }
      };
      return h('div', { class: 'raid-boss-card' + (b.locked ? ' locked' : ''), 'data-star': b.star, 'data-slot': b.slot, style: '--tc:' + (tc) },
        h('div', { class: 'raid-bc-head' }, h('b', { class: 'raid-stars' }, stars(b.star)), h('span', { class: 'small muted' }, `Nv. ${b.level}`)),
        h('div', { class: 'raid-bc-spr' }, h('img', { class: 'pixel', src: sprite(b.id), alt: p.name })),
        h('b', { class: 'raid-bc-name' }, p.name),
        h('div', { class: 'raid-bc-tera' }, typeBadge(b.tera), h('span', { class: 'small' }, '💎 Tera')),
        b.locked ? h('div', { class: 'small muted' }, `🔒 ${cfg().badges[b.star]} medalla${cfg().badges[b.star] > 1 ? 's' : ''}`)
          : h('div', { class: 'raid-bc-btns' },
            h('button', { class: 'btn primary small', type: 'button', 'data-testid': 'raid-solo', disabled: busy, onclick: () => go('solo') }, 'Solo'),
            h('button', { class: 'btn small', type: 'button', 'data-testid': 'raid-open', disabled: busy, title: 'Sala abierta: aparece en la lista para que otros se unan', onclick: () => go('open') }, 'Abierta'),
            h('button', { class: 'btn small', type: 'button', 'data-testid': 'raid-private', disabled: busy, title: 'Sala privada: se une quien tenga el código', onclick: () => go('private') }, 'Privada')));
    }

    function lobbyScreen() {
      const claims = (st.claims || []).map((c) => claimRow(c));
      const open = st.open.filter((o) => true);
      const codeIn = h('input', { class: 'raid-code', maxlength: 4, placeholder: 'CÓDIGO', 'aria-label': 'Código de sala', style: { textTransform: 'uppercase' } });
      const joinBy = async (payload, boss) => {
        const x = await pickMon(boss, '¿Con quién te unes?');
        if (!x) return;
        const r = await act('raid:join', { ...payload, monId: x.id, uid: x.uid });
        if (r) { cur = r.raid; sfx('click'); render(); }
      };
      const bossOfOpen = (o) => ({ id: o.boss, tera: o.tera });
      return h('div', { class: 'raid-lobby' },
        h('div', { class: 'raid-chips' },
          h('span', { class: 'chip', title: 'Incursiones con recompensa hoy (tope diario)' }, `🎁 Hoy: ${st.done}/${st.daily}`),
          h('span', { class: 'chip' + (st.orb ? '' : ' warn'), title: 'Orbe Teracristal: te lo da el Profesor Oak con tu primera medalla' }, st.orb ? '🔮 Orbe Teracristal' : '🔮 Sin Orbe (1 medalla)'),
          h('span', { class: 'chip', title: 'EXP de Caramelos Exp. de incursiones hoy' }, `🍬 ${fmt(st.exp)}/${fmt(st.expMax)} EXP`),
          h('span', { class: 'chip muted', title: 'Los jefes cambian cada día a las 00:00 UTC' }, `🔄 Jefes de hoy · cambian a las ${new Date(st.nextRotation).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}`)),
        claims.length ? h('div', { class: 'raid-claims card stack', 'data-testid': 'raid-claims' }, h('h3', {}, '⚪ Capturas pendientes'), claims) : null,
        h('div', { class: 'raid-grid', 'data-testid': 'raid-bosses' }, st.bosses.map(bossCard)),
        h('div', { class: 'cards2 raid-join' },
          h('div', { class: 'card stack' }, h('h3', {}, '🚪 Salas abiertas'),
            open.length ? h('div', { class: 'raid-open' }, open.map((o) => h('div', { class: 'raid-open-row', 'data-code': o.code },
              h('img', { class: 'pixel', src: sprite(o.boss), alt: '' }), h('div', { class: 'grow' }, h('b', {}, `${stars(o.star)} ${dexName(o.boss)}`), h('div', { class: 'small muted' }, `${o.host} · ${o.n}/${o.max} · 💎 ${TYPE_ES[o.tera]}`)),
              h('button', { class: 'btn primary small', type: 'button', disabled: busy, onclick: () => joinBy({ id: o.id }, bossOfOpen(o)) }, 'Unirse'))))
              : h('p', { class: 'muted small' }, 'Ahora mismo no hay salas abiertas. Crea una con «Abierta» en un jefe.')),
          h('div', { class: 'card stack' }, h('h3', {}, '🔑 Sala privada'), h('p', { class: 'small muted' }, 'Escribe el código de 4 letras que te ha pasado un amigo.'),
            h('div', { class: 'row gap' }, codeIn, h('button', { class: 'btn primary', type: 'button', onclick: () => { const c = codeIn.value.trim().toUpperCase(); if (c.length !== 4) return toast('El código tiene 4 letras.', 'error'); joinBy({ code: c }, null); } }, 'Unirse')))),
        h('p', { class: 'small muted' }, `Premios al ganar (hasta ${st.daily} incursiones al día): Teralitos del tipo del jefe, Caramelos Exp., a veces una Menta y la captura garantizada del jefe con su Teratipo (gasta una Ball: Poké 1★-2★, Super 3★, Ultra 4★-5★). Sin monedas.`));
    }

    function claimRow(c) {
      const need = cfg().minBall[c.star];
      return h('div', { class: 'raid-claim row gap wrap', 'data-claim': c.id },
        h('img', { class: 'pixel', src: sprite(c.boss), alt: '' }), h('div', { class: 'grow' }, h('b', {}, `${stars(c.star)} ${dexName(c.boss)}`), h('div', { class: 'small muted' }, `💎 ${TYPE_ES[c.tera]} · Nv. ${c.level} · te quedan ${Math.max(1, Math.round(c.left / 3600e3))} h · Ball mínima: ${S.data.balls.balls[need].name}`)),
        h('button', { class: 'btn gold', type: 'button', 'data-testid': 'raid-capture', onclick: () => captureDialog(c) }, '⚪ Capturar'));
    }

    function captureDialog(c) {
      const BA = S.data.balls;
      const min = BA.balls[cfg().minBall[c.star]].price;
      const have = BA.order.filter((id) => (S.me.items[id] || 0) > 0 && (BA.balls[id].price === null || BA.balls[id].price >= min));
      const wrap = h('div', { class: 'stack' },
        h('p', {}, `¡${dexName(c.boss)} no puede escapar! Lanza una Ball: se gasta, pero la captura está garantizada.`),
        have.length ? h('div', { class: 'raid-balls' }, have.map((id) => h('button', { class: 'btn', type: 'button', 'data-ball': id, onclick: async (e) => {
          const r = await act('raid:claim', { claim: c.id, ball: id }, e.currentTarget);
          if (!r) return;
          m.close(); sfx('shiny'); confetti({ count: 60 });
          showCaught(r.got);
          await load();
        } }, itemImg(id), ` ${S.data.items[id].name} ×${S.me.items[id]}`)))
          : h('p', { class: 'bad' }, `No tienes ninguna Ball válida: hace falta una ${BA.balls[cfg().minBall[c.star]].name} o mejor (Tienda Poké → Poké Balls). La captura sigue disponible durante 24 h.`),
        h('a', { class: 'btn small', href: '#/shop', onclick: () => m.close() }, '🛍️ Ir a la Tienda'));
      const m = modal(wrap, { title: `⚪ Capturar a ${dexName(c.boss)}` });
    }
    function showCaught(g) {
      modal(h('div', { class: 'stack raid-caught', 'data-testid': 'raid-caught' },
        h('div', { class: 'raid-caught-spr', style: '--tc:' + (TYPE_COLOR[g.tera] || '#9be9f5') }, h('img', { class: 'pixel', src: sprite(g.id, g.shiny), alt: g.name })),
        h('h3', {}, `¡Has capturado a ${g.name}${g.shiny ? ' ✨' : ''}!`),
        h('div', { class: 'row gap wrap' }, typeBadge(g.tera), h('span', {}, `💎 Teratipo ${TYPE_ES[g.tera]} · Nv. ${g.level} · ${g.star}★`)),
        h('p', { class: 'small muted' }, `${g.isNew ? '¡Especie nueva en tu Pokédex! ' : ''}IV totales ${g.ivTotal}/186 · ${g.nature}. Míralo en la Caja PC (cambia su Teratipo con Teralitos).`),
        h('a', { class: 'btn primary', href: '#/pc' }, '🖥️ Ver en la Caja PC')), { title: '💎 Captura de Teraincursión' });
    }

    // ---------- Sala de espera ----------
    function lobbyRoom() {
      const r = cur;
      const bossSpr = h('img', { class: 'pixel raid-lobby-boss', src: sprite(r.boss.id), alt: dexName(r.boss.id) });
      const left = h('span', { class: 'raid-count' }, '');
      const tick = () => { left.textContent = mmss(r.deadline - Date.now()); };
      tick(); timers.push(setInterval(tick, 500));
      return h('div', { class: 'raid-room card stack', 'data-testid': 'raid-room', style: '--tc:' + (TYPE_COLOR[r.boss.tera] || '#9be9f5') },
        h('div', { class: 'row gap wrap' }, bossSpr, h('div', { class: 'grow' }, h('h2', {}, `${stars(r.star)} ${dexName(r.boss.id)}`), h('div', { class: 'small' }, typeBadge(r.boss.tera), ` 💎 Nv. ${r.boss.level} · ${fmt(r.boss.hpMax)} PS`),
          h('div', { class: 'small muted' }, 'Empieza cuando el anfitrión lo decida, al llenarse la sala o a los ', left, '. Las plazas libres las ocupan aliados de la CPU.'))),
        h('div', { class: 'raid-code-box' }, h('span', { class: 'small muted' }, r.open ? 'Sala abierta · código' : 'Sala privada · código'), h('b', { class: 'raid-code-big', 'data-testid': 'raid-code' }, r.code)),
        h('div', { class: 'raid-players' }, r.players.map((p) => h('div', { class: 'raid-pl' }, h('img', { class: 'pixel', src: sprite(p.mon.id, p.mon.shiny), alt: '' }), h('b', {}, p.name), h('div', { class: 'raid-pl-sub small muted' }, `${p.mon.name} · Tera ${TYPE_ES[p.mon.tera]}`)))),
        h('div', { class: 'row gap wrap' },
          r.me.host ? h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'raid-start', onclick: async (e) => { const x = await act('raid:start', {}, e.currentTarget); if (x) { cur = x.raid; render(); } } }, '▶ Empezar ahora') : null,
          h('button', { class: 'btn danger', type: 'button', onclick: leave }, r.me.host ? 'Cancelar sala' : 'Salir')));
    }

    async function leave() {
      const r = await act('raid:leave', {});
      if (r) { cur = null; await load(); }
    }

    // ---------- Combate ----------
    function teamCard(p, i) {
      const pct = (p.mon.hp / p.mon.maxHp) * 100;
      return h('div', { class: 'raid-pl-card' + (p.mon.ko ? ' ko' : '') + (p.mon.teraOn ? ' tera-on' : '') + (i === cur.me.idx ? ' me' : ''), style: '--tc:' + (TYPE_COLOR[p.mon.tera] || '#9be9f5'), 'data-i': i },
        h('img', { class: 'pixel', src: sprite(p.mon.id, p.mon.shiny), alt: '' }),
        h('div', { class: 'raid-pl-info' },
          h('div', { class: 'raid-pl-name' }, p.mon.teraOn ? '💎 ' : '', h('b', {}, p.mon.name), p.human ? '' : h('span', { class: 'small muted' }, p.left ? ' (CPU)' : ' (aliado)')),
          hpBar(pct, 'raid-pl-hp'), h('div', { class: 'small muted' }, p.mon.ko ? 'Debilitado: vuelve pronto' : `${p.mon.hp}/${p.mon.maxHp}`, p.human && !p.mon.ko ? (p.chosen ? ' ✓' : p.afk ? ' 💤' : ' …') : '')));
    }

    function bossStage() {
      const r = cur; const b = r.boss;
      const pct = (b.hp / b.hpMax) * 100;
      const sh = b.shield.on ? (b.shield.hp / b.shield.max) * 100 : 0;
      const tc = TYPE_COLOR[b.tera] || '#9be9f5';
      const spr = aniImg(b.id, { cls: 'raid-boss-img', alt: dexName(b.id) });
      return h('div', { class: 'raid-stage' + (b.shield.on ? ' shielded' : '') + (b.stunned ? ' stunned' : ''), style: '--tc:' + (tc), 'data-testid': 'raid-stage' },
        h('div', { class: 'raid-boss-top' },
          h('div', { class: 'grow' }, h('b', { class: 'raid-boss-name' }, `${stars(r.star)} ${dexName(b.id)}`, h('span', { class: 'small muted' }, ` Nv. ${b.level}`)),
            h('div', { class: 'raid-boss-types' }, typeBadge(b.tera), h('span', { class: 'small' }, '💎 teracristalizado'))),
          h('div', { class: 'raid-turn' }, h('b', {}, `Turno ${Math.min(r.turn, r.maxTurns)}/${r.maxTurns}`), h('div', { class: 'raid-kos', title: `Pokémon debilitados: ${r.kos}/${r.maxKos}`, 'aria-label': `Debilitados ${r.kos} de ${r.maxKos}` }, Array.from({ length: r.maxKos }, (_, i) => h('i', { class: i < r.maxKos - r.kos ? 'on' : '' }))))),
        h('div', { class: 'raid-hp-row' }, h('span', { class: 'raid-hp-lbl' }, 'PS'), hpBar(pct, 'raid-boss-hp'), h('span', { class: 'small' }, `${fmt(b.hp)}/${fmt(b.hpMax)}`)),
        b.shield.on ? h('div', { class: 'raid-shield-row', 'data-testid': 'raid-shield' }, h('span', { class: 'raid-hp-lbl' }, '🛡️'), h('div', { class: 'bar raid-shield', role: 'progressbar', 'aria-valuenow': Math.round(sh), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('i', { style: { width: sh + '%' } })), h('span', { class: 'small' }, 'Escudo')) : null,
        h('div', { class: 'raid-boss-spr' }, h('div', { class: 'raid-crystal', 'aria-hidden': 'true' }), spr, b.stunned ? h('span', { class: 'raid-stun' }, '💫') : null));
    }

    function actionPanel() {
      const r = cur; const me = r.me;
      const mon = r.players[me.idx].mon;
      if (r.over) return resultPanel();
      const left = h('span', { class: 'raid-count' }, '');
      const tick = () => { left.textContent = mmss(r.deadline - Date.now()); };
      tick(); timers.push(setInterval(tick, 500));
      if (teraSel.turn !== r.turn || teraSel.id !== r.id) { teraSel.on = false; teraSel.turn = r.turn; teraSel.id = r.id; }
      if (mon.teraUsed || !me.orb) teraSel.on = false;
      const tera = teraSel;
      const tl = h('b', {}, tera.on ? `¡${mon.name} se teracristalizará!` : `Teracristalizar (${TYPE_ES[mon.tera]})`);
      const teraBtn = !mon.teraUsed && me.orb ? h('button', { class: 'tera-btn' + (tera.on ? ' on' : ''), type: 'button', 'aria-pressed': String(tera.on), 'data-testid': 'raid-tera', style: '--tc:' + (TYPE_COLOR[mon.tera] || '#9be9f5'), onclick: () => {
        tera.on = !tera.on; teraBtn.classList.toggle('on', tera.on); teraBtn.setAttribute('aria-pressed', String(tera.on));
        tl.textContent = tera.on ? `¡${mon.name} se teracristalizará!` : `Teracristalizar (${TYPE_ES[mon.tera]})`;
      } }, h('span', { class: 'tera-btn-ico' }, '💎'), h('span', { class: 'tera-btn-t' }, tl, h('small', {}, 'Una vez por incursión: STAB reforzado y su tipo pasa a ser ese')))
        : mon.teraOn ? h('div', { class: 'small muted' }, `💎 Teracristalizado (${TYPE_ES[mon.tera]})`) : null;
      const choose = async (i, btn) => {
        const x = await act('raid:choose', { move: i, tera: tera.on }, btn);
        if (x) { cur = x.raid; sfx('click'); render(); }
      };
      const waiting = me.chosen;
      const moves = h('div', { class: 'mv-grid raid-moves' }, me.moves.map((mv) => h('button', { class: `mv t-${mv.type}` + (me.choice && me.choice.m === mv.i ? ' picked' : ''), type: 'button', 'data-move': mv.i, disabled: mon.ko || busy, onclick: (e) => choose(mv.i, e.currentTarget) },
        h('span', { class: 'mv-n' }, mv.name),
        h('span', { class: 'mv-m' }, h('span', { class: 'mv-ty' }, TYPE_ES[mv.type] || mv.type), h('span', { class: 'mv-c' }, CAT[mv.cat] || ''), mv.power ? h('span', {}, `${mv.power}`) : null),
        mv.kind === 'dmg' ? h('span', { class: 'mv-pp' }, `≈ ${mv.dmg} PS${mv.eff !== 1 ? ' · ' + effTxt(mv.eff) : ''}`) : h('span', { class: 'mv-pp' }, mv.kind === 'heal' ? '💚 Cura el 50 %' : mv.kind === 'boost' ? '⬆️ Sube su ataque' : 'Sin efecto contra el jefe'))));
      return h('div', { class: 'raid-act', 'data-testid': 'raid-act' },
        h('div', { class: 'bt2-ask' }, h('b', {}, mon.ko ? `${mon.name} está debilitado: vuelve enseguida` : `¿Qué hará ${mon.name}?`), h('span', { class: 'muted small' }, ' ⏱ ', left, me.afk ? ' · 💤 piloto automático (elige para volver)' : '')),
        waiting ? h('div', { class: 'small good', 'data-testid': 'raid-waiting' }, `✓ Elegido. Esperando a los demás (${r.players.filter((p) => p.human && p.chosen).length}/${r.players.filter((p) => p.human && !p.mon.ko && !p.afk).length})… puedes cambiar tu elección.`) : null,
        teraBtn, moves,
        h('div', { class: 'bt2-row' }, h('button', { class: 'btn danger small', type: 'button', onclick: async () => { if (confirm('¿Abandonar la incursión? Tu Pokémon seguirá con la CPU y no cobrarás.')) await leave(); } }, '🏳️ Abandonar')));
    }

    function resultPanel() {
      const r = cur; const rw = r.me.reward; const win = r.win;
      const rows = [];
      if (win && rw) {
        if (rw.shards) rows.push(h('div', { class: 'raid-rw' }, itemImg(`tera-shard-${rw.shards.type}`), h('b', {}, `+${rw.shards.n} Teralito${rw.shards.n > 1 ? 's' : ''} ${TYPE_ES[rw.shards.type]}`)));
        if (rw.candy) rows.push(h('div', { class: 'raid-rw' }, itemImg(rw.candy.id), h('b', {}, `+${rw.candy.n} ${S.data.items[rw.candy.id].name}`)));
        if (rw.candyCapped) rows.push(h('div', { class: 'raid-rw small muted' }, 'Hoy ya has alcanzado el tope de EXP de caramelos de incursiones.'));
        if (rw.item) rows.push(h('div', { class: 'raid-rw' }, itemImg(rw.item), h('b', {}, `+1 ${S.data.items[rw.item].name}`)));
        if (rw.none || rw.capped) rows.push(h('div', { class: 'raid-rw small muted' }, rw.why));
      }
      return h('div', { class: 'raid-result ' + (win ? 'win' : 'lose'), 'data-testid': 'raid-result' },
        h('h3', {}, win ? `🎉 ¡Has derrotado a ${dexName(r.boss.id)}!` : '💔 La incursión ha fracasado'),
        win ? null : h('p', { class: 'small' }, r.why || 'Inténtalo de nuevo: mira los tipos de tus movimientos contra el Teratipo del jefe y teracristaliza a tiempo.'),
        rows.length ? h('div', { class: 'raid-rws' }, rows) : null,
        win && rw && rw.capture ? h('button', { class: 'btn gold big', type: 'button', 'data-testid': 'raid-capture-now', onclick: async () => { await load(); const c = (st.claims || []).find((x) => x.boss === r.boss.id && x.star === r.star); if (c) captureDialog(c); else toast('No hay ninguna captura pendiente.', 'info'); } }, `⚪ Capturar a ${dexName(r.boss.id)}`) : null,
        h('button', { class: 'btn primary', type: 'button', 'data-testid': 'raid-leave', onclick: leave }, 'Volver a las incursiones'));
    }

    function battleScreen() {
      const r = cur;
      const logEl = h('div', { class: 'raid-log', 'data-testid': 'raid-log', role: 'log', 'aria-live': 'polite' }, r.log.slice(-6).map((l) => h('div', { class: /^—/.test(l) ? 'raid-log-t' : '' }, l)));
      const scr = h('div', { class: 'raid-battle' },
        h('div', { class: 'raid-left' }, bossStage(), h('div', { class: 'raid-team' }, r.players.map(teamCard))),
        h('div', { class: 'raid-right' }, actionPanel(), logEl));
      return scr;
    }

    function render() {
      stop();
      if (!st) return;
      let node;
      if (cur && cur.state === 'lobby') node = lobbyRoom();
      else if (cur) node = battleScreen();
      else node = lobbyScreen();
      body.replaceChildren(node);
      root.classList.toggle('raid-live', !!cur && cur.state !== 'lobby');
      // Efectos al cambiar la vida del jefe o de los aliados.
      if (cur && prev && prev.id === cur.id && cur.state !== 'lobby') {
        if (cur.boss.hp < prev.boss.hp || (cur.boss.shield.hp < prev.boss.shield.hp)) { const s = body.querySelector('.raid-boss-spr'); if (s && !reduced()) { s.classList.add('hit'); setTimeout(() => s.classList.remove('hit'), 500); } }
        if (cur.kos > prev.kos) { sfx('error'); const f = body.querySelector('.raid-stage'); if (f && !reduced()) shake(f, 300); }
        if (cur.boss.shield.on && !prev.boss.shield.on) sfx('sparkle');
        if (cur.over && !prev.over) { sfx(cur.win ? 'levelup' : 'error'); if (cur.win && !reduced()) confetti({ count: 50 }); }
      }
      prev = cur;
    }

    this.offState = bus.on('raid:state', async (v) => {
      if (!st) return;
      if (v === null) { cur = null; await load(); return; }
      const wasOver = cur && cur.over;
      cur = v;
      if (v.over && !wasOver) await load().catch(() => {}); // trae las capturas pendientes
      else render();
    });
    this.offList = bus.on('raid:list', (l) => { if (st) { st.open = l; if (!cur) render(); } });
    this.offMe = bus.on('me', () => {});
    await load();
    prev = cur;
  },
  unmount() { if (this.stopTimers) this.stopTimers(); if (this.offState) this.offState(); if (this.offList) this.offList(); if (this.offMe) this.offMe(); },
};

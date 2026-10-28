import { S, h, fmt, emit, sfx, toast, betInput, confirmBet, typeBadge, avatar, titleTag } from '../core.js';
import { winFx, burstEl, flash, shake, vibrate, glow, pop, floatText } from '../fx.js';

const MODES = [
  { id: 'type', ico: '🔍', name: '¿Quién es ese Pokémon?', desc: 'Escribe el nombre' },
  { id: 'choice', ico: '🧠', name: 'Trivia Pokémon', desc: 'Elige la respuesta' },
];
const DIFF_NOTE = {
  facil: 'Solo Pokémon populares',
  normal: 'Generaciones 1 a 4',
  dificil: 'Los 1.025 Pokémon',
  maestro: 'Todo, preguntas de experto',
};
const MODE_NOTE = {
  type: { facil: 'Silueta + tipos + letras', normal: 'Silueta + letras', dificil: 'Solo un detalle + generación', maestro: 'Solo pistas, sin imagen' },
  choice: {},
};
const REGION = { 1: 'Kanto', 2: 'Johto', 3: 'Hoenn', 4: 'Sinnoh', 5: 'Teselia', 6: 'Kalos', 7: 'Alola', 8: 'Galar', 9: 'Paldea' };
const STAGE = ['bebé', 'fase 1', 'fase 2', 'fase 3'];
const pref = (k, d) => { try { return localStorage.getItem('quiz:' + k) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('quiz:' + k, v); } catch { /* sin almacenamiento */ } };
const mf = (m) => '×' + (Math.round(m * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2 });

export default {
  id: 'quiz', title: 'Desafío Pokémon', icon: '🧠',
  async mount(root) {
    const Q = S.data.quiz;
    const diffById = Object.fromEntries(Q.diffs.map((d) => [d.id, d]));
    let mode = pref('mode', 'type');
    let diff = pref('diff', 'normal');
    let target = Number(pref('target', '0')) || 0;
    let game = null;
    let busy = false;
    let timer = null; let autoNext = null; let endAt = 0; let limit = 1; let lastSec = -1;
    let bestMap = {};
    let boardDiff = diff;
    let board = null;
    if (!MODES.some((m) => m.id === mode)) mode = 'type';
    if (!diffById[diff]) diff = 'normal';
    if (target && !Q.targets.includes(target)) target = 0;

    const bet = betInput(100, 'quiz');
    const modeBox = h('div', { class: 'qz-modes' });
    const diffBox = h('div', { class: 'qz-diffs' });
    const targetBox = h('div', { class: 'chips' });
    const preview = h('div', { class: 'qz-ladder preview' });
    const bestLine = h('div', { class: 'small muted' });
    const startBtn = h('button', { class: 'btn primary big qz-start', onclick: start }, 'Empezar');
    const setup = h('div', { class: 'card stack qz-setup' },
      h('div', { class: 'qz-sec' }, 'Modo'), modeBox,
      h('div', { class: 'qz-sec' }, 'Dificultad'), diffBox,
      h('div', { class: 'qz-sec' }, 'Objetivo de racha'), targetBox,
      h('div', { class: 'small muted' }, `Con objetivo se cobra solo al alcanzarlo, con un +${Math.round((Q.targetBonus - 1) * 100)} % extra. «Libre»: te retiras tú entre pregunta y pregunta.`),
      h('div', { class: 'qz-sec' }, 'Multiplicadores'), preview,
      bet.el, bestLine, h('div', { class: 'sticky-actions row' }, startBtn));

    // ---- Partida ----
    const streakEl = h('b', { class: 'qz-streak-n' }, '0');
    const multEl = h('b', { class: 'qz-mult-n' }, '×1,00');
    const cashBtn = h('button', { class: 'btn gold big qz-cash', onclick: cashout, disabled: true, title: 'Podrás retirarte entre pregunta y pregunta' }, 'Retirar');
    const barFill = h('i');
    const bar = h('div', { class: 'qz-bar', role: 'progressbar', 'aria-label': 'Tiempo restante' }, barFill);
    const secEl = h('span', { class: 'qz-secs' }, '');
    const stage = h('div', { class: 'qz-stage' });
    const ladderEl = h('div', { class: 'qz-ladder' });
    const hud = h('div', { class: 'qz-hud' },
      h('div', { class: 'qz-stat' }, h('span', { class: 'muted small' }, 'Racha'), h('span', {}, '🔥 ', streakEl)),
      h('div', { class: 'qz-stat' }, h('span', { class: 'muted small' }, 'Multiplicador'), multEl),
      cashBtn);
    const play = h('div', { class: 'card stack qz-play hidden' }, hud, h('div', { class: 'qz-timer' }, bar, secEl), stage, ladderEl);
    const boardCard = h('div', { class: 'card stack qz-board' });

    // ---- Selector de configuración ----
    function drawSetup() {
      modeBox.replaceChildren(...MODES.map((m) => h('button', { class: 'qz-mode' + (m.id === mode ? ' active' : ''), type: 'button', onclick: () => { mode = m.id; setPref('mode', mode); sfx('click'); drawSetup(); } },
        h('span', { class: 'qz-mode-ico' }, m.ico), h('b', {}, m.name), h('span', { class: 'small muted' }, m.desc))));
      diffBox.replaceChildren(...Q.diffs.map((d) => h('button', { class: 'qz-diff d-' + d.id + (d.id === diff ? ' active' : ''), type: 'button', onclick: () => { diff = d.id; setPref('diff', diff); sfx('click'); drawSetup(); } },
        h('b', {}, d.label),
        h('span', { class: 'small' }, `${d.secs} s · ${d.options} opciones`),
        h('span', { class: 'small muted' }, (mode === 'type' && MODE_NOTE.type[d.id]) || DIFF_NOTE[d.id]))));
      if (target > diffById[diff].max) { target = 0; setPref('target', '0'); }
      targetBox.replaceChildren(...[0, ...Q.targets.filter((t) => t <= diffById[diff].max)].map((t) => h('button', { class: 'chip' + (t === target ? ' active' : ''), type: 'button', onclick: () => { target = t; setPref('target', String(t)); sfx('click'); drawSetup(); } }, t ? `${t} seguidas` : 'Libre')));
      drawLadder(preview, diff, 0, target, 8);
      const b = bestMap[diff];
      bestLine.replaceChildren('Tu mejor racha en ', h('b', {}, diffById[diff].label), ': ', h('b', { class: 'good' }, String(b || 0)),
        h('span', { class: 'muted' }, ` · pago máximo por ronda ${Q.payoutCap} × tu límite de apuesta (×${Q.maxMult} máx.)`));
      drawBoard();
    }
    // Tira de multiplicadores: iluminados los ya conseguidos; el objetivo lleva bandera.
    function drawLadder(el, d, streak, tgt, cap) {
      const lad = diffById[d].ladder;
      const n = Math.min(cap || diffById[d].max, tgt || diffById[d].max);
      el.replaceChildren(...Array.from({ length: n }, (_, i) => {
        const k = i + 1;
        const bonus = tgt && k === tgt;
        const m = Math.min(Q.maxMult, Math.floor(100 * lad[i] * (bonus ? Q.targetBonus : 1)) / 100);
        return h('div', { class: 'qz-step' + (k <= streak ? ' got' : '') + (k === streak + 1 ? ' next' : '') + (bonus ? ' goal' : ''), 'data-k': k },
          h('span', { class: 'qz-step-k' }, bonus ? '🏁' : k), h('span', { class: 'qz-step-m' }, mf(m)));
      }));
    }

    // ---- Estado visible ----
    function drawHud() {
      const g = game;
      streakEl.textContent = g ? g.streak : 0;
      multEl.textContent = mf(g ? g.mult : 1);
      const can = g && !g.done && g.phase === 'decide' && g.streak >= 1;
      cashBtn.disabled = !can;
      cashBtn.textContent = g && !g.done && g.streak >= 1 ? `Retirar ${fmt(g.cash)}` : 'Retirar';
      cashBtn.title = can ? '' : 'Podrás retirarte entre pregunta y pregunta, tras acertar al menos una';
      drawLadder(ladderEl, g ? g.diff : diff, g ? g.streak : 0, g ? g.target : 0);
      const nx = ladderEl.querySelector('.next');
      if (nx && ladderEl.scrollTo) ladderEl.scrollTo({ left: Math.max(0, nx.offsetLeft - ladderEl.clientWidth / 2 + nx.offsetWidth / 2), behavior: 'smooth' });
    }
    function show(on) {
      setup.classList.toggle('hidden', on);
      play.classList.toggle('hidden', !on);
    }

    // ---- Cuenta atrás ----
    function stopTimer() { clearInterval(timer); timer = null; }
    function idleTimer() { stopTimer(); barFill.style.transform = 'scaleX(0)'; bar.classList.remove('low', 'mid'); secEl.textContent = ''; }
    function runTimer(ms, lim) {
      stopTimer();
      limit = lim; endAt = performance.now() + ms; lastSec = -1;
      tick();
      timer = setInterval(tick, 100);
    }
    function tick() {
      const left = endAt - performance.now();
      const pct = Math.max(0, Math.min(1, left / limit));
      barFill.style.transform = `scaleX(${pct})`;
      bar.classList.toggle('low', pct < 0.3);
      bar.classList.toggle('mid', pct >= 0.3 && pct < 0.55);
      const s = Math.max(0, Math.ceil(left / 1000));
      secEl.textContent = s + ' s';
      if (s !== lastSec) { lastSec = s; if (s <= 5 && s > 0) sfx('tick'); }
      if (left <= 0) { stopTimer(); submit({ giveUp: true }); }
    }

    // ---- Preguntas ----
    function drawQuestion(q) {
      show(true);
      drawHud();
      const kids = [];
      let input = null;
      let started = false;
      const begin = () => { if (started) return; started = true; runTimer(q.ms, q.limit); if (input) input.focus(); };
      if (q.kind === 'type') {
        const artBox = h('div', { class: 'qz-art' + (q.img ? '' : ' none') });
        if (q.img) {
          const im = h('img', { src: q.img, alt: '', draggable: 'false', class: 'qz-img' });
          im.addEventListener('load', begin);
          im.addEventListener('error', () => { artBox.replaceChildren(h('span', { class: 'qz-img-fail' }, '❓')); begin(); });
          artBox.append(im);
          setTimeout(begin, 3000); // si la imagen tarda mucho, empieza igualmente
        } else artBox.append(h('span', { class: 'qz-img-fail' }, '🔎'));
        kids.push(artBox, h('p', { class: 'qz-prompt' }, q.prompt), clueRow(q.clues, q.letters));
        input = h('input', { type: 'text', class: 'qz-input', placeholder: 'Escribe el nombre…', enterkeyhint: 'go', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', maxlength: 40, 'aria-label': 'Nombre del Pokémon' });
        const go = h('button', { class: 'btn primary big', type: 'button', onclick: () => send() }, 'Responder');
        const send = () => { if (!input.value.trim() || busy) return; submit({ text: input.value }); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
        kids.push(h('div', { class: 'qz-answer' }, input, go));
        if (!q.img) begin();
      } else {
        kids.push(h('p', { class: 'qz-prompt big' }, q.prompt),
          h('div', { class: 'qz-opts n' + q.options.length }, q.options.map((o, i) => h('button', { class: 'qz-opt', type: 'button', 'data-i': i, onclick: () => submit({ option: i }) }, o))));
        begin();
      }
      stage.className = 'qz-stage ask';
      stage.replaceChildren(h('div', { class: 'qz-qn small muted' }, `Pregunta ${q.n}`), ...kids);
      stage.animate?.([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    }
    function clueRow(c, letters) {
      if (!c) return null;
      const chips = [];
      if (c.types) c.types.forEach((t) => chips.push(typeBadge(t)));
      if (c.gen) chips.push(h('span', { class: 'qz-clue' }, `Gen ${c.gen} · ${REGION[c.gen]}`));
      if (c.stage !== undefined) chips.push(h('span', { class: 'qz-clue' }, STAGE[c.stage] || ''));
      if (c.stats) c.stats.forEach((s) => chips.push(h('span', { class: 'qz-clue stat' }, `${s.k} ${s.v}`)));
      if (c.letters || letters) chips.push(h('span', { class: 'qz-clue' }, `${c.letters || letters} letras`));
      return h('div', { class: 'qz-clues' }, chips);
    }

    // ---- Acciones ----
    async function start() {
      if (busy) return;
      if (!(await confirmBet('quiz', bet.value))) return;
      busy = true; startBtn.disabled = true;
      try {
        const r = await emit('quiz:start', { bet: bet.value, mode, diff, target });
        sfx('click');
        game = r.game;
        drawQuestion(game.q);
      } catch (e) { toast(e.message, 'error'); sfx('error'); } finally { busy = false; startBtn.disabled = false; }
    }
    async function submit(payload) {
      if (busy || !game || game.phase !== 'ask') return;
      busy = true; stopTimer();
      stage.querySelectorAll('button, input').forEach((el) => { el.disabled = true; });
      try {
        const chosen = payload.option;
        const r = await emit('quiz:answer', payload);
        game = r.game;
        result(r, chosen);
      } catch (e) {
        toast(e.message, 'error'); sfx('error');
        try { game = (await emit('quiz:state')).game; } catch { game = null; }
        if (game && game.q) drawQuestion(game.q); else { show(false); drawSetup(); }
      } finally { busy = false; }
    }
    async function next() {
      if (busy) return;
      clearTimeout(autoNext); autoNext = null;
      busy = true;
      try { const r = await emit('quiz:next'); game = r.game; drawQuestion(game.q); sfx('click'); } catch (e) { toast(e.message, 'error'); } finally { busy = false; }
    }
    async function cashout() {
      if (busy) return;
      clearTimeout(autoNext); autoNext = null;
      busy = true;
      try { const r = await emit('quiz:cashout'); game = r.game; if (r.paid !== undefined) paidFx(r); else result(r); } catch (e) { toast(e.message, 'error'); } finally { busy = false; }
    }

    // ---- Resultados y efectos ----
    function revealBlock(r) {
      const rv = r.reveal;
      if (!rv) return null;
      if (rv.name) {
        const im = h('img', { class: 'qz-reveal-img', src: rv.img, alt: rv.name, draggable: 'false' });
        im.addEventListener('error', () => im.replaceWith(h('span', { class: 'qz-img-fail' }, '❓')));
        return h('div', { class: 'qz-reveal' }, h('div', { class: 'qz-art color' }, im), h('div', { class: 'qz-reveal-name' }, r.correct ? `¡Sí, es ${rv.name}!` : `¡Era ${rv.name}!`));
      }
      return h('div', { class: 'qz-reveal-name' }, r.correct ? '¡Correcto!' : `Era: ${rv.answer}`);
    }
    function result(r, chosen) {
      idleTimer();
      const g = game;
      drawHud();
      stage.className = 'qz-stage ' + (r.correct ? 'right' : 'fail');
      const rv = r.reveal || {};
      // Trivia: se mantienen las opciones marcadas en verde y rojo.
      let optsEl = null;
      const old = stage.querySelector('.qz-opts');
      if (old && rv.idx !== undefined) {
        optsEl = old.cloneNode(false);
        [...old.children].forEach((b, i) => {
          const c = b.cloneNode(true);
          c.disabled = true;
          if (i === rv.idx) c.classList.add('right');
          else if (i === chosen) c.classList.add('wrong');
          else c.classList.add('dim');
          optsEl.append(c);
        });
      }
      const promptEl = stage.querySelector('.qz-prompt')?.cloneNode(true);
      const msgs = [];
      if (r.correct) {
        sfx('win'); sfx('star', Math.min(8, g.streak));
        flash('#3ddc84', 340); vibrate(18);
        burstEl(streakEl, '#ffd54f', 10 + Math.min(14, g.streak * 2), { spread: 120, stars: 0.7 });
        pop(streakEl, 1.6); glow(play, '#3ddc84', 700);
        floatText(`+1 · ${mf(g.mult)}`, streakEl, { color: '#3ddc84', size: 20 });
      } else {
        sfx('lose'); flash('#ff4d4d', 420); shake(); vibrate([80, 40, 140]);
        msgs.push(h('div', { class: 'qz-lost bad' }, r.timeout ? '⏰ ¡Se acabó el tiempo!' : '❌ ¡Fallaste!', ` Pierdes ${fmt(r.lost)} monedas.`));
        if (g.streak) msgs.push(h('div', { class: 'small muted' }, `Racha final: ${g.streak}`));
      }
      const parts = [h('div', { class: 'qz-qn small muted' }, r.correct ? '¡Correcto!' : r.timeout ? 'Tiempo' : 'Fallo'), promptEl, optsEl, revealBlock(r), ...msgs];
      const acts = h('div', { class: 'qz-actions' });
      if (r.correct && r.paid !== undefined) {
        // Racha máxima u objetivo: cobro automático.
        stage.replaceChildren(...parts.filter(Boolean));
        setTimeout(() => paidFx(r), 450);
        return;
      }
      if (r.correct) {
        const nextBtn = h('button', { class: 'btn primary big', onclick: next }, `Siguiente pregunta · ${mf(g.next)}`);
        const cash = h('button', { class: 'btn gold big', onclick: cashout }, `Retirar ${fmt(g.cash)}`);
        acts.append(nextBtn, cash);
        if (g.target) {
          const left = g.target - g.streak;
          parts.push(h('div', { class: 'small muted qz-auto' }, `Objetivo: ${g.target} seguidas (te faltan ${left}). Siguiente pregunta automática…`));
          autoNext = setTimeout(next, 1500);
        }
        setTimeout(() => nextBtn.focus(), 50);
      } else {
        const again = h('button', { class: 'btn primary big', onclick: again_ }, 'Jugar otra vez');
        acts.append(again);
        setTimeout(() => again.focus(), 50);
      }
      stage.replaceChildren(...parts.filter(Boolean), acts);
      if (!r.correct) { refreshBoard(); }
    }
    function again_() { game = null; show(false); drawSetup(); }
    function paidFx(r) {
      idleTimer();
      sfx(r.paid >= game.bet * 5 ? 'big' : 'win');
      const g = game;
      stage.className = 'qz-stage right';
      drawHud();
      stage.replaceChildren(
        h('div', { class: 'qz-won' }, h('div', { class: 'qz-won-ico' }, '💰'),
          h('b', { class: 'good' }, `${mf(r.mult)} · +${fmt(r.paid)} monedas`),
          h('div', { class: 'small muted' }, `${g.streak} aciertos seguidos${r.bonus ? ' · bonus de objetivo' : ''}${r.capped ? ' · pago limitado al tope por ronda' : ''}`)),
        h('div', { class: 'qz-actions' }, h('button', { class: 'btn primary big', onclick: again_ }, 'Jugar otra vez')));
      winFx(r.paid, g.bet, { el: stage, icon: '🧠', title: '¡GRAN RACHA!' });
      refreshBoard();
    }

    // ---- Clasificación ----
    async function refreshBoard() {
      try { board = (await emit('quiz:board')).board; } catch { /* sin clasificación */ }
      try { bestMap = (await emit('quiz:state')).best || bestMap; } catch { /* nada */ }
      drawBoard();
      if (!setup.classList.contains('hidden')) { /* el récord se ve en el pie del selector */ drawBestOnly(); }
    }
    function drawBestOnly() {
      const b = bestMap[diff];
      const el = bestLine.querySelector('.good');
      if (el) el.textContent = String(b || 0);
    }
    function drawBoard() {
      const rows = board ? board[boardDiff] : null;
      boardCard.replaceChildren(
        h('h3', {}, '🏆 Mejores rachas'),
        h('div', { class: 'tabs' }, Q.diffs.map((d) => h('button', { class: 'tab' + (d.id === boardDiff ? ' active' : ''), type: 'button', onclick: () => { boardDiff = d.id; drawBoard(); } }, d.label))),
        !rows ? h('div', { class: 'muted small' }, 'Cargando…')
          : rows.length ? h('div', { class: 'qz-rows' }, rows.map((r, i) => h('div', { class: 'qz-row' + (r.username === S.me.username ? ' me' : '') },
            h('span', { class: 'qz-rank' }, i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1), avatar(r.buddy, r), h('span', { class: 'grow qz-name' }, r.username, ' ', titleTag(r.title)), h('b', {}, `🔥 ${r.streak}`))))
            : h('div', { class: 'muted small' }, 'Nadie ha puntuado aún en esta dificultad. ¡Sé el primero!'));
    }

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🧠 Desafío Pokémon'),
        h('p', { class: 'muted' }, 'Contesta seguido para subir el multiplicador y retírate cuando quieras. Un fallo o quedarte sin tiempo pierde la apuesta.')),
      h('div', { class: 'qz-layout' }, h('div', { class: 'stack' }, setup, play), boardCard));

    this.unmount = () => { stopTimer(); clearTimeout(autoNext); };
    drawSetup();
    try {
      const st = await emit('quiz:state');
      bestMap = st.best || {};
      game = st.game;
    } catch { /* sin partida */ }
    if (game && !game.done) { mode = game.mode; diff = game.diff; if (game.phase === 'ask' && game.q) drawQuestion(game.q); else { show(true); drawHud(); stage.className = 'qz-stage right'; stage.replaceChildren(h('div', { class: 'qz-qn small muted' }, 'Partida en curso'), h('div', { class: 'qz-actions' }, h('button', { class: 'btn primary big', onclick: next }, `Siguiente pregunta · ${mf(game.next)}`), h('button', { class: 'btn gold big', onclick: cashout }, `Retirar ${fmt(game.cash)}`))); } }
    drawSetup();
    refreshBoard();
  },
};

'use strict';
// Desafío Pokémon: normalización de nombres, generadores de preguntas, tiempos, pagos y RTP por dificultad.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-quiz-'));

const db = require('../server/db');
const hub = require('../server/hub');
const BAL = require('../server/balance');
const dex = require('../server/pokedex');
const quiz = require('../server/games/quiz');

let n = 0;
function user(extra = {}) {
  const name = 'quiz' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 1e9, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: {}, stats: { wagered: 0, won: 0, pulls: 0, biggestWin: 0 }, daily: {}, voltorb: { level: 1, game: null }, xp: 0, level: 1, createdAt: Date.now() - 5 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
const free = (u) => { if (u.games.quiz) u.games.quiz.lastAct = 0; };
const ans = (u) => quiz.peek(u);
const right = (u) => { free(u); return quiz.answer(u, ans(u)); };
function wrong(u) {
  free(u);
  const q = u.games.quiz.q;
  return quiz.answer(u, q.kind === 'choice' ? { option: (q.idx + 1) % q.options.length } : { text: 'zzzzzz' });
}
const DIFFS = Object.keys(quiz.DIFFS);

// ---------- Nombres ----------
test('normalización: sin tildes, mayúsculas, espacios ni signos', () => {
  assert.strictEqual(quiz.normalize(' Flabébé '), 'flabebe');
  assert.strictEqual(quiz.normalize("Farfetch'd"), 'farfetchd');
  assert.strictEqual(quiz.normalize('Mr. Mime'), 'mrmime');
  assert.strictEqual(quiz.normalize('Porygon-Z'), 'porygonz');
  assert.strictEqual(quiz.normalize('Nidoran♀'), 'nidoranf');
  assert.ok(quiz.matches('PIKACHU', ['Pikachu']));
  assert.ok(quiz.matches('  mr mime', ['Mr. Mime']));
  assert.ok(quiz.matches('flabebe', ['Flabébé']));
  assert.ok(quiz.matches('ho oh', ['Ho-Oh']));
  assert.ok(!quiz.matches('', ['Pikachu']));
  assert.ok(!quiz.matches('x'.repeat(60), ['Pikachu']));
});

test('erratas: Levenshtein ≤ 1 solo en nombres de 6 o más letras', () => {
  assert.ok(quiz.matches('Pikacu', ['Pikachu'])); // falta una letra
  assert.ok(quiz.matches('Charisard', ['Charizard'])); // cambia una
  assert.ok(quiz.matches('Blastoisee', ['Blastoise'])); // sobra una
  assert.ok(!quiz.matches('Pikachuuu', ['Pikachu'])); // dos
  assert.ok(!quiz.matches('Mew', ['Mewtwo']));
  // nombres cortos (< 6 letras): exactos
  assert.ok(!quiz.matches('Mewt', ['Mew']));
  assert.ok(quiz.matches('Raicu', ['Raichu'])); // 6 letras → se admite
  assert.ok(!quiz.matches('Rich', ['Raichu']));
  assert.ok(!quiz.matches('Onx', ['Onix']));
  assert.ok(!quiz.matches('Abra', ['Arbok'])); // lejos
  // escribir otro Pokémon real NUNCA se perdona aunque esté a 1 letra
  assert.ok(!quiz.matches('Nidorino', ['Nidorina']));
  // Cualquiera de los nombres aceptados vale
  assert.ok(quiz.matches('Gabite', ['Gible', 'Gabite']));
});

// ---------- Preguntas ----------
test('banco de trivia: respuesta única y suficientes distractores', () => {
  assert.ok(quiz.BANK.length >= 60, `${quiz.BANK.length}`);
  for (const [tier, q, a, w] of quiz.BANK) {
    assert.ok(tier >= 1 && tier <= 4, q);
    assert.ok(w.length >= 5, `${q}: distractores`);
    assert.ok(!w.includes(a), `${q}: la respuesta está entre los distractores`);
    assert.strictEqual(new Set(w).size, w.length, `${q}: distractores repetidos`);
  }
});

test('generadores: 2000 preguntas por tipo, una sola correcta y opciones distintas', () => {
  for (const kind of Object.keys(quiz.GEN)) {
    for (let i = 0; i < 2000; i++) {
      const d = DIFFS[i % 4];
      const q = quiz.genChoice(d, { only: kind });
      assert.strictEqual(q.options.length, quiz.DIFFS[d].options, `${kind}/${d}`);
      assert.strictEqual(new Set(q.options).size, q.options.length, `${kind}: opciones repetidas`);
      assert.strictEqual(q.options[q.idx], q.answer);
      assert.ok(q.prompt.length > 8);
    }
  }
});

test('cada dificultad genera todos sus tipos de pregunta y de escritura', () => {
  for (const d of DIFFS) {
    const kinds = new Set();
    for (let i = 0; i < 400; i++) kinds.add(quiz.genChoice(d).gen);
    assert.ok(kinds.size >= 9, `${d}: ${[...kinds]}`);
    for (let i = 0; i < 300; i++) {
      const t = quiz.genType(d);
      assert.ok(t.names.length >= 1 && t.names.length <= 3);
      assert.ok(quiz.matches(t.names[0], t.names));
      if (d === 'maestro') { assert.strictEqual(t.imgMode, null); assert.ok(t.clues.types && t.clues.stats.length >= 2); } else assert.ok(t.imgMode);
    }
  }
  // Fácil: solo Pokémon populares
  for (let i = 0; i < 300; i++) assert.ok(quiz.POOLS.facil.includes(dex.BY_ID.get(quiz.genType('facil').id)));
  assert.ok(quiz.POOLS.normal.every((p) => p.id <= 493));
  assert.strictEqual(quiz.POOLS.dificil.length, 1025);
});

test('lo que ve el cliente no contiene la respuesta ni el número del Pokémon', () => {
  for (const mode of ['type', 'choice']) {
    for (const d of DIFFS) {
      for (let i = 0; i < 40; i++) {
        const u = user();
        const r = quiz.start(u, { bet: 100, mode, diff: d });
        const g = u.games.quiz;
        const txt = JSON.stringify(r);
        for (const k of ['answer', 'idx', 'names', 'reveal', 'deadline', '"id"']) assert.ok(!txt.includes(k), `${mode}/${d}: filtra ${k}`);
        if (mode === 'type') {
          for (const nm of g.q.names) assert.ok(!txt.toLowerCase().includes(nm.toLowerCase()), `${d}: filtra el nombre`);
          if (g.q.img) {
            assert.match(r.game.q.img, /^\/api\/quiz\/img\/[A-Za-z0-9_-]{16}$/);
            assert.ok(!/official-artwork|sprites/.test(r.game.q.img));
          }
        } else {
          assert.ok(Array.isArray(r.game.q.options) && r.game.q.options.length === quiz.DIFFS[d].options);
          assert.ok(!('idx' in r.game.q));
        }
      }
    }
  }
});

test('opciones barajadas: la correcta no está siempre en el mismo sitio', () => {
  const pos = new Array(4).fill(0);
  for (let i = 0; i < 800; i++) pos[quiz.genChoice('facil').idx]++;
  assert.ok(pos.every((c) => c > 120), pos.join(','));
});

// ---------- Partidas ----------
test('una respuesta incorrecta pierde la apuesta y revela la solución', () => {
  for (const mode of ['type', 'choice']) {
    const u = user();
    const before = u.coins;
    quiz.start(u, { bet: 500, mode, diff: 'normal' });
    assert.strictEqual(u.coins, before - 500);
    const r = wrong(u);
    assert.strictEqual(r.correct, false);
    assert.ok(r.reveal);
    assert.strictEqual(r.game.done, true);
    assert.strictEqual(u.coins, before - 500);
    assert.throws(() => { free(u); quiz.answer(u, { option: 0 }); }, /No hay/);
    assert.strictEqual(quiz.state(u).game, null);
  }
});

test('se pierde al pasar el tiempo (con 1 s de margen), también sin volver a contestar', () => {
  for (const mode of ['type', 'choice']) {
    // Dentro del margen de latencia: se acepta
    const a = user();
    quiz.start(a, { bet: 100, mode, diff: 'facil' });
    a.games.quiz.q.deadline = Date.now() - 500;
    assert.strictEqual(right(a).correct, true);
    // Pasado el margen: pierde aunque la respuesta sea la correcta
    const b = user();
    const before = b.coins;
    quiz.start(b, { bet: 100, mode, diff: 'facil' });
    b.games.quiz.q.deadline = Date.now() - 2500;
    const r = right(b);
    assert.strictEqual(r.correct, false);
    assert.strictEqual(r.timeout, true);
    assert.strictEqual(b.coins, before - 100);
    // Recargar la página con la pregunta vencida también la pierde
    const c = user();
    quiz.start(c, { bet: 100, mode, diff: 'maestro' });
    c.games.quiz.q.deadline = Date.now() - 2500;
    assert.strictEqual(quiz.state(c).game, null);
    assert.strictEqual(c.games.quiz.done, true);
  }
});

test('rendirse (tiempo agotado en el cliente) pierde la ronda y revela la solución', () => {
  const u = user();
  quiz.start(u, { bet: 100, mode: 'choice', diff: 'facil' });
  const r = quiz.answer(u, { giveUp: true });
  assert.strictEqual(r.correct, false);
  assert.strictEqual(r.timeout, true);
  assert.ok(r.reveal.answer);
});

test('tiempo por dificultad: 20 / 15 / 12 / 10 s y 4 / 4 / 6 / 6 opciones', () => {
  assert.deepStrictEqual(DIFFS.map((d) => quiz.DIFFS[d].secs), [20, 15, 12, 10]);
  assert.deepStrictEqual(DIFFS.map((d) => quiz.DIFFS[d].options), [4, 4, 6, 6]);
  const u = user();
  const r = quiz.start(u, { bet: 100, mode: 'choice', diff: 'dificil' });
  assert.ok(r.game.q.ms <= 12000 && r.game.q.ms > 11000);
});

test('retirarse paga apuesta × multiplicador y solo entre preguntas', () => {
  const u = user();
  const before = u.coins;
  quiz.start(u, { bet: 1000, mode: 'choice', diff: 'dificil' });
  const acc = u.games.quiz.acc; // escalera personal (se parte de suponer un experto)
  assert.throws(() => { free(u); quiz.cashout(u); }, /entre pregunta/);
  const r1 = right(u);
  assert.strictEqual(r1.correct, true);
  assert.strictEqual(r1.game.phase, 'decide');
  assert.strictEqual(r1.game.q, null);
  assert.throws(() => { free(u); quiz.answer(u, { option: 0 }); }, /No hay ninguna pregunta/);
  free(u); quiz.next(u);
  right(u);
  free(u);
  const out = quiz.cashout(u);
  const mult = quiz.ladder('dificil', 2, acc);
  assert.strictEqual(out.mult, mult);
  assert.strictEqual(out.paid, Math.floor(1000 * mult));
  assert.strictEqual(u.coins, before - 1000 + Math.floor(1000 * mult));
  assert.throws(() => quiz.cashout(u), /No hay partida/);
});

test('con objetivo se cobra solo al alcanzarlo, con +3 %', () => {
  const u = user();
  const before = u.coins;
  quiz.start(u, { bet: 1000, mode: 'choice', diff: 'normal', target: 3 });
  const acc = u.games.quiz.acc;
  right(u); free(u); quiz.next(u);
  right(u); free(u); quiz.next(u);
  const r = right(u);
  assert.strictEqual(r.auto, true);
  assert.strictEqual(r.bonus, true);
  assert.strictEqual(r.mult, quiz.finalMult('normal', 3, true, acc));
  assert.ok(r.mult > quiz.ladder('normal', 3, acc));
  assert.strictEqual(u.coins, before - 1000 + r.paid);
  assert.strictEqual(r.game.done, true);
  assert.throws(() => quiz.start(u, { bet: 100, mode: 'choice', diff: 'normal', target: 4 }), /Objetivo/);
  assert.throws(() => quiz.start(u, { bet: 100, mode: 'choice', diff: 'maestro', target: 10 }), /Objetivo/);
});

test('mejor racha por dificultad y clasificación', () => {
  const u = user();
  quiz.start(u, { bet: 100, mode: 'choice', diff: 'facil' });
  right(u); free(u); quiz.next(u); right(u); free(u); quiz.next(u); right(u);
  free(u); quiz.next(u);
  wrong(u);
  assert.strictEqual(u.quizBest.facil, 3);
  const top = quiz.board().board.facil;
  assert.ok(top.some((e) => e.username === u.username && e.streak === 3));
  assert.ok(top.length <= 10);
});

test('tope: ×50 como máximo, racha máxima por dificultad y pago ≤ 20 × el límite de apuesta', () => {
  assert.ok(quiz.MAX_MULT === 50 && quiz.MAX_STREAK === 20 && quiz.PAYOUT_CAP === 20);
  assert.deepStrictEqual(DIFFS.map((d) => quiz.DIFFS[d].max), [5, 6, 6, 5]);
  for (const d of DIFFS) for (let k = 1; k <= 40; k++) assert.ok(quiz.finalMult(d, k, true) <= 50);
  const u = user();
  const maxBet = hub.maxBetFor(u);
  const before = u.coins;
  quiz.start(u, { bet: maxBet, mode: 'choice', diff: 'maestro' });
  u.games.quiz.streak = 3; // atajo: la escalera de Maestro sube muy deprisa
  u.games.quiz.acc = quiz.DIFFS.maestro.acc; // como un jugador con la precisión supuesta (50 %)
  const r4 = right(u);
  assert.strictEqual(r4.correct, true);
  assert.ok(!r4.auto);
  free(u); quiz.next(u);
  const out = right(u); // 5.º acierto: cobro automático (racha máxima de Maestro)
  const m5 = quiz.ladder('maestro', 5, quiz.DIFFS.maestro.acc);
  assert.ok(m5 > 20 && m5 <= 50);
  assert.strictEqual(out.auto, true);
  assert.strictEqual(out.mult, m5);
  assert.strictEqual(out.paid, 20 * maxBet); // más de ×20 superaría el tope de 20 × límite de apuesta
  assert.strictEqual(out.capped, true);
  assert.ok(u.coins - before >= 19 * maxBet && u.coins - before < 19 * maxBet + 1000); // + subidas de nivel por la XP
  // El último acierto de la dificultad cobra solo
  const v = user();
  quiz.start(v, { bet: 100, mode: 'choice', diff: 'facil' });
  v.games.quiz.streak = quiz.DIFFS.facil.max - 1;
  assert.strictEqual(right(v).auto, true);
});

test('límites de apuesta y una sola partida a la vez', () => {
  const u = user();
  assert.throws(() => quiz.start(u, { bet: 1, mode: 'choice', diff: 'facil' }), /apuesta/);
  assert.throws(() => quiz.start(u, { bet: hub.maxBetFor(u) + 1, mode: 'choice', diff: 'facil' }), /apuesta/);
  assert.throws(() => quiz.start(u, { bet: 100, mode: 'otro', diff: 'facil' }), /Modo/);
  assert.throws(() => quiz.start(u, { bet: 100, mode: 'type', diff: 'imposible' }), /Dificultad/);
  assert.strictEqual(u.coins, 1e9, 'una petición no válida no cobra nada');
  quiz.start(u, { bet: 100, mode: 'type', diff: 'facil' });
  assert.throws(() => quiz.start(u, { bet: 100, mode: 'type', diff: 'facil' }), /Termina/);
});

test('límite de ritmo entre acciones', () => {
  const u = user();
  quiz.start(u, { bet: 100, mode: 'choice', diff: 'facil' });
  assert.throws(() => quiz.answer(u, { option: 0 }), /despacio/);
});

test('XP y estadísticas por las vías normales (juego «quiz»)', () => {
  assert.ok(hub.GAME_NAMES.quiz && hub.GAME_LABELS.quiz);
  assert.ok(Math.abs(BAL.xpRate('quiz') - 0.075) < 1e-9);
  const u = user();
  quiz.start(u, { bet: 1000, mode: 'choice', diff: 'facil' });
  assert.ok(u.xp >= 70 && u.xp <= 80, `xp ${u.xp}`);
  assert.strictEqual(u.hist.games.quiz.bet, 1000);
});

// ---------- Imágenes ----------
test('PNG: silueta de un solo color con el mismo canal alfa y recorte más pequeño', () => {
  const w = 64; const h = 48;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 10; y < 40; y++) for (let x = 12; x < 52; x++) { const i = (y * w + x) * 4; rgba[i] = 200; rgba[i + 1] = 40 + x; rgba[i + 2] = 90; rgba[i + 3] = 255; }
  const png = quiz.encodePng(w, h, rgba);
  const back = quiz.decodePng(png);
  assert.deepStrictEqual([back.w, back.h], [w, h]);
  assert.ok(back.rgba.equals(rgba), 'ida y vuelta sin pérdidas');
  const sil = quiz.decodePng(quiz.processImage(png, 'sil'));
  for (let i = 0; i < w * h; i++) {
    assert.strictEqual(sil.rgba[i * 4 + 3], rgba[i * 4 + 3]);
    assert.deepStrictEqual([...sil.rgba.subarray(i * 4, i * 4 + 3)], [22, 18, 46]);
  }
  const crop = quiz.decodePng(quiz.processImage(png, 'crop'));
  assert.ok(crop.w <= 48 && crop.w === crop.h);
});

// ---------- Equilibrio ----------
test('escalera: ningún experto (precisión supuesta) supera el 97 % en ningún punto de retirada', () => {
  for (const d of DIFFS) {
    const p = quiz.DIFFS[d].acc;
    let top = 0;
    for (let k = 1; k <= quiz.DIFFS[d].max; k++) {
      for (const bonus of quiz.TARGETS.includes(k) ? [false, true] : [false]) {
        const rtp = Math.pow(p, k) * quiz.finalMult(d, k, bonus);
        assert.ok(rtp <= BAL.RTP.quiz + 1e-9, `${d} k=${k} bonus=${bonus}: ${rtp}`);
        top = Math.max(top, rtp);
      }
    }
    assert.ok(top <= 0.97 && top > 0.9, `${d}: mejor retirada ${top}`);
  }
  assert.ok(BAL.edge('quiz') >= 0.03 - 1e-9);
});

test('el multiplicador crece con la racha, empieza en ≥ ×1 y no baja nunca', () => {
  for (const d of DIFFS) {
    let prev = 1;
    for (let k = 1; k <= quiz.DIFFS[d].max; k++) { const m = quiz.ladder(d, k); assert.ok(m >= prev && m >= 1, `${d} ${k}`); prev = m; }
  }
});

test('RTP simulado con el código real: expertos y casuales, por dificultad', () => {
  const N = 1000;
  const BET = 100;
  const u = user({ coins: 1e12 });
  function round(d, p, stopAt, target) {
    free(u);
    quiz.start(u, { bet: BET, mode: Math.random() < 0.5 ? 'type' : 'choice', diff: d, target });
    for (;;) {
      free(u);
      const r = Math.random() < p ? right(u) : wrong(u);
      if (!r.correct) return 0;
      if (r.auto) return r.paid;
      if (r.streak >= stopAt) { free(u); return quiz.cashout(u).paid; }
      free(u); quiz.next(u);
    }
  }
  for (const d of DIFFS) {
    const p = quiz.DIFFS[d].acc;
    // Mejor retirada analítica del experto y dos objetivos
    let kBest = 1;
    for (let k = 1; k <= 20; k++) if (Math.pow(p, k) * quiz.ladder(d, k) > Math.pow(p, kBest) * quiz.ladder(d, kBest)) kBest = k;
    for (const cfg of [{ stop: kBest, target: 0 }, { stop: 99, target: 3 }, { stop: 99, target: 5 }]) {
      let sum = 0; let sq = 0;
      for (let i = 0; i < N; i++) { const r = round(d, p, cfg.stop, cfg.target) / BET; sum += r; sq += r * r; }
      const mean = sum / N;
      const se = Math.sqrt(Math.max(0, sq / N - mean * mean) / N);
      assert.ok(mean <= 0.97 + 4 * se, `${d} ${JSON.stringify(cfg)}: RTP ${mean.toFixed(3)} ± ${se.toFixed(3)}`);
    }
    // Un jugador casual (precisión 15 puntos menor) pierde claramente
    let sum = 0;
    for (let i = 0; i < N; i++) sum += round(d, p - 0.15, 3, 0) / BET;
    assert.ok(sum / N < 0.9, `${d} casual: ${(sum / N).toFixed(3)}`);
  }
});

test('la escalera se adapta a la precisión real: ni un experto (o quien busque) gana a la larga', () => {
  const quiz = require('../server/games/quiz');
  for (const diff of Object.keys(quiz.DIFFS)) {
    const D = quiz.DIFFS[diff];
    for (const p of [Math.min(0.99, D.acc + 0.1), 0.99]) {
      // Mejor punto de retirada fijo para ese jugador, rondas sucesivas con la precisión que va aprendiendo el juego.
      let best = 0;
      for (let k = 1; k <= D.max; k++) {
        const user = { quizAcc: {} };
        let bet = 0, paid = 0;
        for (let round = 0; round < 400; round++) {
          const acc = quiz.playerAcc(user, 'choice', diff);
          const rec = (user.quizAcc[`choice:${diff}`] ||= { ok: 0, n: 0 });
          bet += 1;
          let streak = 0;
          while (streak < k) {
            const ok = Math.random() < p;
            rec.n++; if (ok) rec.ok++;
            if (!ok) break;
            streak++;
          }
          // Pago esperado de la ronda (sin el azar del cobro, que solo añade ruido a la medida).
          paid += Math.pow(p, k) * Math.min(quiz.MAX_MULT, quiz.ladder(diff, k, acc));
        }
        best = Math.max(best, paid / bet);
      }
      assert.ok(best < 1, `${diff} con precisión ${p}: devuelve ${(best * 100).toFixed(1)} %`);
    }
  }
});

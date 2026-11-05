'use strict';
// Liga Pokémon: clasificatoria por temporadas (Elo, rangos, anti-abuso, fin de temporada con premios y reinicio suave).
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-lg-'));

const db = require('../server/db');
const specimen = require('../server/specimen');
const sdw = require('../server/showdown');
const league = require('../server/league');
const items = require('../server/items');
const hub = require('../server/hub');

let n = 0;
function player(extra = {}, ids = [25, 6, 9]) {
  const name = 'lg' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 50000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection: Object.fromEntries(ids.map((id) => [id, { n: 1, s: 0 }])), stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  specimen.syncAll(u);
  return u;
}
const IDS = [25, 6, 9];
const team = (u) => IDS.map((id) => ({ id, uid: u.mons[id][0].uid }));
const T = (s) => Date.parse(s);

test('temporada: mes natural en hora de España (horario de invierno y de verano)', () => {
  assert.strictEqual(league.seasonOf(T('2026-10-31T22:59:59Z')), '2026-10');
  assert.strictEqual(league.seasonOf(T('2026-10-31T23:00:00Z')), '2026-11'); // 00:00 del 1 de noviembre (UTC+1)
  assert.strictEqual(league.seasonOf(T('2026-06-30T21:59:59Z')), '2026-06');
  assert.strictEqual(league.seasonOf(T('2026-06-30T22:00:00Z')), '2026-07'); // UTC+2
  assert.strictEqual(league.seasonEnd(T('2026-11-15T12:00:00Z')), T('2026-11-30T23:00:00Z'));
  assert.strictEqual(league.seasonEnd(T('2026-12-15T12:00:00Z')), T('2026-12-31T23:00:00Z'));
  assert.strictEqual(league.seasonEnd(T('2026-06-10T12:00:00Z')), T('2026-06-30T22:00:00Z'));
  assert.strictEqual(league.labelOf('2026-11'), 'Noviembre 2026');
});

test('rangos como las Poké Balls y puntuación Elo con K = 32', () => {
  assert.deepStrictEqual([0, 1099, 1100, 1249, 1250, 1399, 1400, 2000].map(league.tierOf), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.deepStrictEqual(league.TIERS.map((t) => t.sprite), ['poke-ball', 'great-ball', 'ultra-ball', 'master-ball']);
  assert.strictEqual(league.eloDelta(1000, 1000, 1), 16);
  assert.strictEqual(league.eloDelta(1000, 1000, 0.5), 0);
  assert.strictEqual(league.eloDelta(1000, 1400, 1), 29);
  assert.strictEqual(league.eloDelta(1400, 1000, 0), -29);
  const a = player(), b = player();
  const r = league.record([a, b], 'singles', 0, 10);
  assert.ok(r.rated);
  assert.deepStrictEqual(r.side.map((x) => x.delta), [16, -16]);
  assert.strictEqual(a.league.singles.r, 1016);
  assert.strictEqual(b.league.singles.r, 984);
  assert.strictEqual(a.league.doubles.r, 1000, 'cada formato tiene su puntuación');
  assert.deepStrictEqual([a.league.singles.w, b.league.singles.l], [1, 1]);
  // Empate y suelo en 0.
  b.league.singles.r = 5;
  const t = league.record([a, b], 'singles', 0, 10);
  assert.ok(t.rated && b.league.singles.r >= 0);
  const c = player(), d = player();
  c.league = undefined; league.ensure(c); c.league.singles.r = 0;
  league.record([c, d], 'singles', 1, 10);
  assert.strictEqual(c.league.singles.r, 0, 'el suelo es 0');
});

test('anti-abuso: misma cuenta, cuentas nuevas, menos de 3 turnos y 5 combates puntuados al día contra el mismo rival', () => {
  const a = player(), b = player();
  assert.strictEqual(league.record([a, a], 'singles', 0, 10).rated, false);
  assert.strictEqual(league.record([a, b], 'singles', 0, 2).rated, false, 'menos de 3 turnos');
  assert.strictEqual(league.record([a, player({ level: 2 })], 'singles', 0, 10).rated, false, 'nivel < 3');
  assert.strictEqual(league.record([a, player({ createdAt: Date.now() - 864e5 })], 'singles', 0, 10).rated, false, 'cuenta de menos de 3 días');
  assert.strictEqual(league.record([a, b], 'singles', 0, 3).rated, true);
  for (let i = 0; i < 4; i++) assert.ok(league.record([a, b], 'singles', i % 2, 10).rated);
  const sixth = league.record([a, b], 'singles', 0, 10);
  assert.strictEqual(sixth.rated, false);
  assert.match(sixth.why, /5 combates/);
  assert.strictEqual(a.league.singles.w + a.league.singles.l, 5);
  // Otro rival sí cuenta; y el doble formato comparte el cupo contra el mismo rival.
  assert.ok(league.record([a, player()], 'doubles', 0, 10).rated);
  assert.strictEqual(league.record([a, b], 'doubles', 0, 10).rated, false);
});

test('Clasificatoria por la cola: nivel 50, sin apuesta ni amistad; solo con otra cuenta veterana y del mismo formato', async () => {
  const young = player({ level: 2 });
  assert.throws(() => sdw.enqueue(young, { format: 'singles', ranked: true, team: team(young) }), /nivel 3/);
  const a = player(), b = player(), c = player();
  assert.strictEqual(sdw.enqueue(a, { format: 'doubles', ranked: true, band: 'medium', level: 'real', bond: true, team: team(a) }).matched, false);
  assert.deepStrictEqual([sdw.queueMine(a).ranked, sdw.queueMine(a).band, sdw.queueMine(a).level, sdw.queueMine(a).bond], [true, 'none', 'fair', false], 'ajustes forzados');
  assert.strictEqual(sdw.enqueue(b, { format: 'singles', ranked: true, team: team(b) }).matched, false, 'otro formato');
  assert.strictEqual(sdw.enqueue(c, { format: 'singles', ranked: false, team: team(c) }).matched, false, 'la cola normal no se mezcla con la clasificatoria');
  sdw.unqueue(a); sdw.unqueue(b); sdw.unqueue(c);
  const x = player(), y = player();
  sdw.enqueue(x, { format: 'singles', ranked: true, team: team(x) });
  const r = sdw.enqueue(y, { format: 'singles', ranked: true, team: team(y) });
  assert.strictEqual(r.matched, true);
  const bat = sdw.battles.get(r.battle.id);
  assert.ok(bat.ranked && bat.mode === 'pvp' && bat.wager === 0 && bat.affection === false && bat.level === 'fair');
  assert.strictEqual(r.battle.ranked, true);
  assert.strictEqual(sdw.listPublic().length, 0, 'no aparece en retos abiertos');
  // Se rinde antes de 3 turnos: cuenta como derrota puntuada (si no, rendirse al instante evitaría perder puntos).
  sdw.forfeit(x, { id: bat.id });
  await bat.done;
  assert.strictEqual(x.league.played, 1);
  assert.strictEqual(x.league.singles.l, 1);
  assert.strictEqual(x.btHist[0].ranked, true);
  assert.ok(x.btHist[0].dr < 0, 'pierde puntos');
});

test('Clasificatoria: rendirse tras 3 turnos puntúa como derrota y se ve en el emblema, el historial y la tabla', async () => {
  const x = player(), y = player();
  sdw.enqueue(x, { format: 'singles', ranked: true, team: team(x) });
  const bat = sdw.battles.get(sdw.enqueue(y, { format: 'singles', ranked: true, team: team(y) }).battle.id);
  assert.deepStrictEqual(bat.view(bat.sides[0]).ranks, [null, null], 'sin emblema hasta jugar la primera');
  bat.turn = 5;
  sdw.forfeit(x, { id: bat.id });
  await bat.done;
  assert.strictEqual(x.league.singles.r, 984);
  assert.strictEqual(y.league.singles.r, 1016);
  assert.strictEqual(x.btHist[0].dr, -16);
  assert.strictEqual(y.btHist[0].dr, 16);
  assert.deepStrictEqual(league.emblem(x), { t: 0, r: 1000, top: false }, 'el emblema general es el mejor de los dos formatos');
  assert.strictEqual(league.emblem(x, 'singles').r, 984);
  assert.strictEqual(hub.publicUser(y).rank.r, 1016);
  const st = league.state(y);
  assert.ok(st.board.singles.some((r) => r.username === y.username && r.r === 1016));
  assert.strictEqual(st.mine.singles.w, 1);
  assert.strictEqual(st.label, league.labelOf(league.seasonOf()));
});

test('emparejamiento clasificatorio: ventana de nivel y cupo diario contra el mismo rival', () => {
  const hi = player(), lo = player(), mid = player();
  league.ensure(hi); league.ensure(lo); league.ensure(mid);
  hi.league.singles.r = 1700; lo.league.singles.r = 900; mid.league.singles.r = 1650;
  sdw.enqueue(hi, { format: 'singles', ranked: true, team: team(hi) });
  assert.strictEqual(sdw.enqueue(lo, { format: 'singles', ranked: true, team: team(lo) }).matched, false, '800 de diferencia: no se emparejan');
  const m = sdw.enqueue(mid, { format: 'singles', ranked: true, team: team(mid) });
  assert.strictEqual(m.matched, true, 'elige al más cercano');
  assert.ok(sdw.battles.get(m.battle.id).sides.some((s) => s.userId === hi.id));
  sdw.forfeit(mid, { id: m.battle.id });
  sdw.unqueue(lo);
  // Cupo diario agotado entre dos cuentas: no se emparejan.
  const p = player(), q = player();
  league.ensure(p); league.ensure(q);
  for (let i = 0; i < league.MAX_VS_DAY; i++) league.record([p, q], 'singles', 0, 10);
  sdw.enqueue(p, { format: 'singles', ranked: true, team: team(p) });
  assert.strictEqual(sdw.enqueue(q, { format: 'singles', ranked: true, team: team(q) }).matched, false);
  sdw.unqueue(p); sdw.unqueue(q);
});

test('fin de temporada: premios por rango más alto, Top 3, reinicio suave, historial y reinicio idempotente', () => {
  const clock = { t: T('2026-11-10T12:00:00Z') };
  league._setClock(() => clock.t);
  db.data.league = { season: '2026-11' };
  // Jugadores con temporadas ya jugadas (se montan a mano las puntuaciones).
  const mk = (r, g, extra) => { const u = player(extra); league.ensure(u); u.league.season = '2026-11'; u.league.singles = { r, w: g, l: 0, d: 0, peak: r }; u.league.played = g; u.league.best = league.tierOf(r); u.bp = 0; return u; };
  const poke = mk(1050, 6), great = mk(1150, 6), ultra = mk(1300, 6), master = mk(1450, 12), few = mk(1500, 3);
  const top1 = mk(1900, 20), top2 = mk(1800, 20), top3 = mk(1700, 20);
  const coins0 = Object.fromEntries([poke, master, top1].map((u) => [u.id, u.coins]));
  const titles = (u) => u.progress.titles;
  clock.t = T('2026-11-30T23:00:01Z'); // ya es diciembre
  assert.strictEqual(league.tick(), true);
  assert.strictEqual(db.data.league.season, '2026-12');
  assert.strictEqual(league.tick(), false, 'idempotente');
  assert.strictEqual(poke.bp, 20); assert.strictEqual(poke.coins, coins0[poke.id]); assert.ok(!poke.items['frame-liga-super']);
  assert.strictEqual(great.bp, 40); assert.strictEqual(great.items['frame-liga-super'], 1); assert.ok(titles(great).includes('liga-super'));
  assert.strictEqual(ultra.bp, 80); assert.strictEqual(ultra.items['frame-liga-ultra'], 1); assert.ok(titles(ultra).includes('liga-ultra'));
  assert.strictEqual(master.bp, 150); assert.strictEqual(master.items['frame-liga-master'], 1); assert.strictEqual(master.coins, coins0[master.id] + 1000);
  assert.strictEqual(few.bp, 0, 'menos de 5 combates: sin premios'); assert.strictEqual(few.items['frame-liga-master'], undefined);
  assert.strictEqual(top1.items['frame-liga-top'], 1); assert.strictEqual(top1.coins, coins0[top1.id] + 2000, 'Top 3: 2.000 en total');
  assert.ok(titles(top1).includes('liga-top'));
  for (const u of [top1, top2, top3]) assert.ok(u.league.hist[0].top);
  assert.ok(!master.league.hist[0].top, 'el 4.º no es Top 3');
  // Tope de monedas por temporada.
  for (const u of [master, top1, top2, top3]) assert.ok(u.coins - (coins0[u.id] || 50000) <= league.MAX_COINS);
  // Reinicio suave y nueva temporada.
  assert.strictEqual(top1.league.singles.r, 1450); assert.strictEqual(poke.league.singles.r, 1025); assert.strictEqual(great.league.singles.r, 1075);
  assert.deepStrictEqual([top1.league.singles.w, top1.league.season], [0, '2026-12']);
  assert.strictEqual(top1.league.hist[0].season, '2026-11');
  assert.strictEqual(top1.league.hist[0].singles.r, 1900);
  assert.strictEqual(top1.league.hist[0].best, 3);
  assert.strictEqual(league.state(top1).past.length, 1);
  for (const f of ['frame-liga-super', 'frame-liga-ultra', 'frame-liga-master', 'frame-liga-top']) assert.ok(items.COSMETICS[f] && items.COSMETICS[f].event, f + ' no sale de los huevos');
  assert.ok(items.ITEMS['frame-liga-ultra'].name.includes('Liga Ultra'));
  // El arranque tras varios meses apagado también cierra la temporada.
  clock.t = T('2027-03-05T12:00:00Z');
  assert.strictEqual(league.tick(), true);
  assert.strictEqual(top1.league.season, '2027-03');
  league._setClock(null);
});

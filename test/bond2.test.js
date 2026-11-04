'use strict';
// «Ampliar la amistad»: niveles de vínculo, efectos de afecto en el simulador (solo p1 contra la CPU; ambos lados en PvP), Retribución /
// Frustración, caricias diarias, frases y botín de expediciones.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-bond2-'));
process.env.SD_MAX_BATTLES = '4';
delete process.env.AFFECTION_FORCE;

const db = require('../server/db');
const hub = require('../server/hub');
const specimen = require('../server/specimen');
const sd = require('../server/sdmap');
const sdw = require('../server/showdown');
const bond = require('../server/bond');
const affection = require('../server/affection');
const exp = require('../server/expedition');
const { Brain } = require('../server/sdai');

let n = 0;
function user(collection = {}, extra = {}) {
  const name = 'bd2' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 50000, dust: 0, buddy: null, items: {}, buffs: {}, games: {}, collection, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 1, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  specimen.syncAll(u);
  return u;
}
const withMons = (ids, friend) => {
  const u = user(Object.fromEntries(ids.map((id) => [id, { n: 1, s: 0 }])));
  if (friend !== undefined) for (const id of ids) u.mons[id][0].friendship = friend;
  return u;
};
const members = (u, ids) => ids.map((id) => ({ id, uid: u.mons[id][0].uid }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('waitFor: tiempo agotado'); await wait(10); } }
function clock(t0 = Date.now()) {
  const real = Date.now;
  let t = t0;
  Date.now = () => t;
  return { advance: (ms) => { t += ms; return t; }, restore: () => { Date.now = real; } };
}
const H = 3600 * 1000;

// ---------- Niveles de vínculo ----------
test('niveles: umbrales, etiquetas y efectos crecientes', () => {
  const at = (f) => bond.stageName(f);
  assert.deepStrictEqual([0, 99, 100, 149, 150, 199, 200, 219, 220, 254, 255].map(at),
    ['Indiferente', 'Indiferente', 'Amistoso', 'Amistoso', 'Muy amistoso', 'Muy amistoso', 'Compañero fiel', 'Compañero fiel', 'Te adora', 'Te adora', 'Vínculo máximo']);
  assert.strictEqual(bond.LOVE_MIN, 220);
  assert.ok(bond.loves(220) && !bond.loves(219));
  // Sin efectos por debajo de 150; con ellos, siempre crecientes por nivel.
  for (const f of [0, 70, 100, 149]) assert.deepStrictEqual(affection.chancesOf(f), { survive: 0, evade: 0, cure: 0, crit: 0 });
  const order = [150, 200, 220, 255].map(affection.chancesOf);
  for (const k of ['survive', 'evade', 'cure']) {
    for (let i = 1; i < order.length; i++) assert.ok(order[i][k] > order[i - 1][k], `${k} crece con el vínculo`);
    assert.ok(order[3][k] >= 10 && order[3][k] <= 25, `${k} al máximo entre el 10 y el 25 %`);
  }
  assert.ok(order[3].crit > 0 && order[3].crit <= 10);
  assert.strictEqual(bond.tiersView().length, 6);
  assert.strictEqual(bond.hearts(255), 5);
});

// ---------- Retribución / Frustración ----------
test('Retribución y Frustración: potencia según la amistad (igual que el simulador)', () => {
  assert.strictEqual(affection.returnPower(255), 102);
  assert.strictEqual(affection.returnPower(0), 1);
  assert.strictEqual(affection.frustrationPower(0), 102);
  assert.strictEqual(affection.frustrationPower(255), 1);
  assert.strictEqual(affection.returnPower(70), 28);
  const { Dex } = sd.ps();
  for (const f of [0, 1, 70, 100, 150, 220, 254, 255]) {
    assert.strictEqual(Dex.moves.get('return').basePowerCallback({ happiness: f }), affection.returnPower(f), `Retribución ${f}`);
    assert.strictEqual(Dex.moves.get('frustration').basePowerCallback({ happiness: f }), affection.frustrationPower(f), `Frustración ${f}`);
    assert.strictEqual(bond.bondMovePower('return', f), affection.returnPower(f));
  }
  assert.strictEqual(bond.bondMovePower('tackle', 100), null);
  assert.ok(sd.moveInfo('return') && sd.moveInfo('frustration'), 'los conjuntos admiten ambos movimientos');
  assert.strictEqual(sd.moveInfo('pursuit'), null, 'el resto de movimientos obsoletos siguen fuera');
});

test('enseñar Retribución / Frustración según la amistad', () => {
  const u = withMons([25, 6]);
  const [pika, chari] = [u.mons[25][0], u.mons[6][0]];
  pika.friendship = 149;
  assert.throws(() => bond.teachBondMove(u, { id: 25, uid: pika.uid, move: 'return' }), /150/);
  assert.throws(() => bond.teachBondMove(u, { id: 25, uid: pika.uid, move: 'tackle' }), /vínculo/);
  pika.friendship = 150;
  const r = bond.teachBondMove(u, { id: 25, uid: pika.uid, move: 'return' });
  assert.ok(r.learned.includes('return'));
  assert.throws(() => bond.teachBondMove(u, { id: 25, uid: pika.uid, move: 'return' }), /Ya conoce/);
  assert.throws(() => bond.teachBondMove(u, { id: 25, uid: pika.uid, move: 'frustration' }), /99 o menos/);
  chari.friendship = 90;
  assert.ok(bond.teachBondMove(u, { id: 6, uid: chari.uid, move: 'frustration' }).learned.includes('frustration'));
  // El conjunto de Showdown conserva el movimiento y la amistad como `happiness`.
  const { set } = sd.toSet(25, pika);
  assert.strictEqual(set.happiness, 150);
  assert.ok(set.moves.includes('return') || pika.sdMoves.length === 4, 'equipada si había hueco');
});

// ---------- Efectos de afecto en el simulador ----------
const ACT = /^\|-activate\|(p[12])[ab]: [^|]*\|affection\|(\w+)/;
const affLines = (log) => log.filter((l) => ACT.test(l));
async function aiRun(teamA, teamB, opts = {}) {
  const r = await sdw.runAiBattle({ teamA, teamB, level: 'fair', affection: true, ...opts });
  return r;
}

test('afecto: solo actúa en el lado p1 (aunque el rival tenga la amistad al máximo) y salta de verdad', async () => {
  process.env.AFFECTION_FORCE = '1';
  try {
    const ids = [25, 6, 9];
    const a = withMons(ids, 255), b = withMons(ids, 255);
    const ta = sdw.resolveTeam(a, members(a, ids), { format: 'singles', level: 'fair' });
    const tb = sdw.resolveTeam(b, members(b, ids), { format: 'singles', level: 'fair' });
    assert.ok(ta.sets.every((s) => s.happiness === 255) && tb.sets.every((s) => s.happiness === 255));
    const kinds = new Set();
    let mine = 0, theirs = 0;
    for (let i = 0; i < 3; i++) {
      const r = await aiRun(ta, tb);
      for (const l of affLines(r.log)) { const m = ACT.exec(l); if (m[1] === 'p1') { mine++; kinds.add(m[2]); } else theirs++; }
    }
    assert.ok(mine > 0, 'el Pokémon del jugador tuvo efectos de afecto');
    assert.strictEqual(theirs, 0, 'la CPU/rival nunca recibe efectos');
    assert.ok([...kinds].every((k) => ['survive', 'evade', 'cure', 'crit'].includes(k)));
    // Con el interruptor apagado (como PvP o duelos entre IA) no hay ningún efecto.
    const off = await aiRun(ta, tb, { affection: false });
    assert.strictEqual(affLines(off.log).length, 0);
    // Variante PvP («AffectionBoth»): los dos lados tienen efectos, cada uno según su amistad.
    const sides = new Set();
    for (let i = 0; i < 3; i++) for (const l of affLines((await aiRun(ta, tb, { affection: 'both' })).log)) sides.add(ACT.exec(l)[1]);
    assert.deepStrictEqual([...sides].sort(), ['p1', 'p2']);
    // Sin amistad alta no hay efectos en ninguno de los dos lados.
    const lo = withMons(ids, 70), lo2 = withMons(ids, 70);
    const tl = sdw.resolveTeam(lo, members(lo, ids), { format: 'singles', level: 'fair' });
    const tl2 = sdw.resolveTeam(lo2, members(lo2, ids), { format: 'singles', level: 'fair' });
    assert.strictEqual(affLines((await aiRun(tl, tl2, { affection: 'both' })).log).length, 0);
  } finally { delete process.env.AFFECTION_FORCE; }
});

test('afecto: por debajo de 150 de amistad no pasa nada ni siquiera forzado', async () => {
  process.env.AFFECTION_FORCE = '1';
  try {
    const ids = [25, 6, 9];
    const a = withMons(ids, 149), b = withMons(ids, 70);
    const r = await aiRun(sdw.resolveTeam(a, members(a, ids), { format: 'singles', level: 'fair' }), sdw.resolveTeam(b, members(b, ids), { format: 'singles', level: 'fair' }));
    assert.strictEqual(affLines(r.log).length, 0);
  } finally { delete process.env.AFFECTION_FORCE; }
});

test('afecto: CPU solo el jugador (Affection), PvP los dos lados (AffectionBoth)', async () => {
  const ids = [25, 6, 9];
  const u = withMons(ids, 255);
  const v = sdw.startCpu(u, { trainer: 'hugo', format: 'singles', level: 'fair', team: members(u, ids) });
  const cpu = sdw.battles.get(v.battle.id);
  assert.strictEqual(cpu.affection, true);
  assert.match(cpu.inputLog[0], /Affection/);
  assert.strictEqual(cpu.snapshot().aff, 1);
  sdw.forfeit(u, { id: cpu.id });
  await cpu.done;
  // PvP
  const a = withMons(ids, 255), b = withMons(ids, 255);
  const c = sdw.challenge(a, { format: 'singles', level: 'fair', wager: 0, team: members(a, ids) });
  const acc = sdw.accept(b, { id: c.challenge, team: members(b, ids) });
  const pvp = sdw.battles.get(acc.battle.id);
  assert.strictEqual(pvp.mode, 'pvp');
  assert.strictEqual(pvp.affection, 'both');
  assert.match(pvp.inputLog[0], /AffectionBoth/);
  assert.strictEqual(pvp.snapshot().aff, 2);
  sdw.forfeit(a, { id: pvp.id });
  await pvp.done;
  // Opción del reto: sin «bond» no hay afecto en PvP; el valor debe ser booleano.
  const a2 = withMons(ids, 255), b2 = withMons(ids, 255);
  assert.throws(() => sdw.challenge(a2, { format: 'singles', level: 'fair', wager: 0, bond: 'si', team: members(a2, ids) }), /amistad/);
  const c2 = sdw.challenge(a2, { format: 'singles', level: 'fair', wager: 0, bond: false, team: members(a2, ids) });
  assert.strictEqual(sdw.listPublic().find((x) => x.id === c2.challenge).bond, false);
  const off = sdw.battles.get(sdw.accept(b2, { id: c2.challenge, team: members(b2, ids) }).battle.id);
  assert.strictEqual(off.affection, false);
  assert.ok(!off.inputLog[0].includes('Affection'));
  assert.strictEqual(off.snapshot().aff, 0);
  sdw.forfeit(a2, { id: off.id });
  await off.done;
});

// Combate crudo con el simulador: misma semilla y mismas entradas ⇒ mismo registro (incluidos los eventos de afecto).
async function rawBattle(seed, affectionOn) {
  const { BattleStream, getPlayerStreams, Teams } = sd.ps();
  const mk = (sp, mv) => Teams.pack([{ name: sp, species: sp, ability: '', item: '', moves: mv, nature: 'Serious', evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 }, ivs: {}, level: 50, happiness: 255 }]);
  const s = getPlayerStreams(new BattleStream());
  const out = [];
  const reader = (async () => { for await (const c of s.omniscient) out.push(c); })();
  const fid = `gen9customgame@@@Species Clause${affectionOn ? ',Affection' : ''}`;
  s.omniscient.write(`>start ${JSON.stringify({ formatid: fid, seed })}`);
  s.omniscient.write(`>player p1 ${JSON.stringify({ name: 'a', team: mk('Blissey', ['softboiled', 'toxic', 'thunderwave', 'willowisp']) })}`);
  s.omniscient.write(`>player p2 ${JSON.stringify({ name: 'b', team: mk('Machamp', ['closecombat', 'knockoff', 'thunderwave', 'toxic']) })}`);
  s.omniscient.write('>p1 team 1\n>p2 team 1');
  for (let t = 0; t < 30; t++) {
    s.omniscient.write(`>p1 move ${1 + (t % 4)}\n>p2 move ${1 + ((t * 3) % 4)}`);
    await wait(2);
  }
  await wait(50);
  s.omniscient.writeEnd();
  await reader.catch(() => {});
  return out.join('\n').split('\n').filter((l) => !l.startsWith('|t:|')).join('\n'); // sin las marcas de hora
}
test('determinismo: misma semilla y mismas entradas ⇒ mismo registro, con eventos de afecto reales', async () => {
  const seed = [11, 22, 33, 44];
  const a = await rawBattle(seed, true);
  const b = await rawBattle(seed, true);
  assert.strictEqual(a, b, 'registro idéntico');
  const lines = a.split('\n').filter((l) => /\|affection\|/.test(l));
  assert.ok(lines.length > 0, 'con 255 de amistad y 30 turnos hay al menos un efecto de afecto');
  assert.ok(lines.every((l) => /\|p1[ab]: /.test(l)));
  const c = await rawBattle(seed, false);
  assert.ok(!/\|affection\|/.test(c));
  // Otra semilla da otro combate.
  assert.notStrictEqual(await rawBattle([5, 6, 7, 8], true), a);
});

// Reinicio del servidor a mitad de combate: la reconstrucción desde semilla + entradas da el mismo registro.
function restart() {
  sdw.refundAll();
  sdw._dropMemory();
  db.data.sdBattles = JSON.parse(JSON.stringify(db.data.sdBattles || {}));
  db.refundEscrow();
  return sdw.restoreAll();
}
test('reinicio: un combate CPU con afecto se reconstruye con el mismo registro', async () => {
  process.env.AFFECTION_FORCE = '1';
  try {
    const ids = [25, 6, 9];
    const u = withMons(ids, 255);
    const v = sdw.startCpu(u, { trainer: 'hugo', format: 'singles', level: 'fair', team: members(u, ids) });
    const b = sdw.battles.get(v.battle.id);
    const asking = (side) => !!(side.req && !side.req.wait && !side.chosen);
    await waitFor(() => asking(b.sides[0]));
    sdw.choose(u, { id: b.id, choice: 'team 123' });
    const br = new Brain('p1', { doubles: false });
    let seen = 0;
    const t0 = Date.now();
    while (b.turn < 4 && !b.over && Date.now() - t0 < 20000) {
      const side = b.sides[0];
      if (side.log.length > seen) { br.feed(side.log.slice(seen)); seen = side.log.length; }
      if (asking(side) && side.req.active) { try { sdw.choose(u, { id: b.id, choice: br.decide(side.req) || 'default' }); } catch { /* ya elegido */ } }
      else if (asking(side) && side.req.forceSwitch) { try { sdw.choose(u, { id: b.id, choice: br.decide(side.req) || 'default' }); } catch { /* ya elegido */ } }
      await wait(15);
    }
    await wait(80);
    if (b.over) return; // el combate acabó antes de poder reiniciarlo: nada que reconstruir
    const noT = (l) => l.filter((x) => !x.startsWith('|t:|')); // sin las marcas de hora
    const log = noT(b.sides[0].log);
    assert.ok(db.data.sdBattles[b.id], 'guardado');
    assert.ok(affLines(log).length > 0, 'ya hubo efectos de afecto');
    const restored = await restart();
    assert.strictEqual(restored, 1);
    const b2 = sdw.battles.get(v.battle.id);
    assert.ok(b2 && b2 !== b && b2.affection === true);
    assert.deepStrictEqual(noT(b2.sides[0].log).slice(0, log.length), log, 'mismo registro (incluido el afecto)');
    sdw.forfeit(u, { id: b2.id });
    await b2.done;
  } finally { delete process.env.AFFECTION_FORCE; }
});

// ---------- Acariciar ----------
test('acariciar: +2 una vez al día por ejemplar, respeta el máximo y los demás topes', () => {
  const ck = clock();
  try {
    const u = withMons([25, 4]);
    const m = u.mons[25][0];
    m.friendship = 100;
    const r = bond.pet(u, { id: 25, uid: m.uid });
    assert.strictEqual(r.gain, 2);
    assert.strictEqual(m.friendship, 102);
    assert.ok(bond.petted(m));
    assert.throws(() => bond.pet(u, { id: 25, uid: m.uid }), /mañana/);
    assert.strictEqual(m.friendship, 102);
    // Otro ejemplar tiene su propio contador; los demás topes siguen funcionando aparte.
    const o = u.mons[4][0];
    o.friendship = 100;
    assert.strictEqual(bond.pet(u, { id: 4, uid: o.uid }).gain, 2);
    assert.strictEqual(bond.addFriend(m, 100, 'feed'), 100);
    assert.strictEqual(bond.dayCounters(m).pet, 2);
    // Al día siguiente, otra vez.
    ck.advance(25 * H);
    assert.ok(!bond.petted(m));
    assert.strictEqual(bond.pet(u, { id: 25, uid: m.uid }).gain, 2);
    // En 255 ya no puede quererte más.
    m.friendship = 255;
    ck.advance(25 * H);
    assert.throws(() => bond.pet(u, { id: 25, uid: m.uid }), /máximo/);
    // Cerca del máximo suma solo lo que cabe.
    m.friendship = 254;
    assert.strictEqual(bond.pet(u, { id: 25, uid: m.uid }).gain, 1);
    assert.strictEqual(bond.CAP.pet, bond.PET_GAIN);
  } finally { ck.restore(); }
});

// ---------- Frases ----------
test('frases: varias por nivel, estables en el día y distintas entre días/contextos', () => {
  for (const [tier, t] of Object.entries(bond.PHRASES)) {
    const total = t.any.length + t.pc.length + t.lobby.length;
    assert.ok(total >= 8 && total <= 12, `${tier}: ${total} frases`);
  }
  const ck = clock();
  try {
    const m = { uid: 'abc123', friendship: 230, gender: 'F' };
    const a = bond.phraseFor(m, 'Eevee', 'lobby');
    assert.strictEqual(bond.phraseFor(m, 'Eevee', 'lobby'), a, 'no parpadea');
    assert.ok(a.includes('Eevee') && !/\{|\}/.test(a));
    const seen = new Set();
    for (let d = 0; d < 20; d++) { seen.add(bond.phraseFor(m, 'Eevee', 'pc')); ck.advance(24 * H); }
    assert.ok(seen.size >= 4, `varía con los días (${seen.size})`);
    // Cada nivel habla distinto.
    const per = new Set([10, 120, 160, 210, 230, 255].map((f) => bond.phraseFor({ uid: 'z', friendship: f }, 'Pikachu', 'pc')));
    assert.strictEqual(per.size, 6);
  } finally { ck.restore(); }
  // La vista de la Caja PC y la del compañero las incluyen.
  const u = withMons([25]);
  u.buddy = { id: 25, shiny: false, uid: u.mons[25][0].uid };
  assert.ok(specimen.boxView(u).mons[0].phrase.includes('Pikachu'));
  assert.strictEqual(specimen.boxView(u).mons[0].petted, false);
  assert.ok(bond.buddyBondView(u).phrase.length > 5);
  assert.ok(bond.buddyStatus(u).phrase);
  bond.pet(u, { id: 25, uid: u.mons[25][0].uid });
  assert.strictEqual(bond.buddyBondView(u).petted, true);
});

// ---------- Expediciones ----------
test('expedición: «Te adora» trae +10 % de EXP/bayas/polvo y las monedas no cambian', () => {
  const ck = clock();
  try {
    const run = (friend) => {
      const u = withMons([4], friend); // Charmander en el Bosque Verde: no coincide, así que ambos parten igual
      const m = u.mons[4][0];
      const e = exp.send(u, { zone: 'bosque', hours: 12, team: [{ id: 4, uid: m.uid }] }).exps[0];
      ck.advance(12 * H);
      return exp.claim(u, { id: e.id }).reward;
    };
    const lover = run(230);
    const plain = run(120);
    assert.strictEqual(lover.coins, plain.coins, 'las monedas son idénticas');
    assert.ok(lover.coins > 0);
    assert.strictEqual(lover.lovers, 1);
    assert.strictEqual(plain.lovers, 0);
    assert.ok(lover.exp > plain.exp, `EXP ${lover.exp} > ${plain.exp}`);
    assert.ok(lover.exp <= Math.ceil(plain.exp * 1.1) + 1);
    // El factor es exactamente +10 % solo para «Te adora».
    assert.strictEqual(bond.lootFactor({ friendship: 219 }), 1);
    assert.strictEqual(bond.lootFactor({ friendship: 220 }), 1.1);
    assert.strictEqual(bond.stochRound(2.2, 0.1), 3);
    assert.strictEqual(bond.stochRound(2.2, 0.5), 2);
  } finally { ck.restore(); }
});

'use strict';
// Evolución por intercambio automática (GTS / directo), objetos equipados que se gastan y Nincada → Ninjask + Shedinja.
const os = require('os');
const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pokecasino-evoauto-'));

const db = require('../server/db');
const gacha = require('../server/gacha');
const sp = require('../server/specimen');
const candy = require('../server/candy');
const gts = require('../server/gts');
const bp = require('../server/bp');
const hub = require('../server/hub');
const dex = require('../server/dexreg');
const { DEX, RARITY } = require('../server/pokedex');
const items = require('../server/items');

let n = 0;
function user(extra = {}) {
  const name = 'ea' + ++n;
  const u = { id: 'id-' + name, username: name, coins: 100000, dust: 0, buddy: null, items: {}, buffs: { shinyCharges: 0 }, games: {}, collection: {}, stats: { pulls: 0, wagered: 0, won: 0, biggestWin: 0, duelsWon: 0, duelsLost: 0 }, pity: {}, daily: {}, voltorb: { level: 1 }, xp: 0, level: 5, createdAt: Date.now() - 9 * 864e5, ...extra };
  db.addUser(u);
  return u;
}
const id = (name) => DEX.find((p) => p.name === name).id;
const PIKA = 25;

// Intercambio de GTS: el dueño (A) deposita `give` pidiendo `want`; B ofrece `want` y se lleva `give`. Devuelve el ejemplar que recibe A.
function swap(a, b, give, want, tweak = () => {}) {
  sp.syncAll(a); sp.syncAll(b);
  dex.markSeen(a, want);
  gts.deposit(a, { id: give, uid: a.mons[give][0].uid, want: { id: want, g: 'any', lv: 0 } });
  const mb = b.mons[want][0];
  tweak(mb);
  const d = require('../server/db').data.gts.deps.find((x) => x.userId === a.id && x.state === 'open');
  gts.offer(b, { dep: d.id, uid: mb.uid });
  return a.mons[want] && a.mons[want][0];
}

test('GTS: lo que recibes por intercambio evoluciona al llegar (oferta), sin gastar Cordón Unión; cancelar lo deja como está', () => {
  const a = user({ collection: { [PIKA]: { n: 1, s: 0 } } });
  const b = user({ collection: { [id('Kadabra')]: { n: 1, s: 0 } } });
  const got = swap(a, b, PIKA, id('Kadabra'));
  assert.ok(got);
  const view = candy.tradeEvoView(a);
  assert.strictEqual(view.length, 1);
  assert.strictEqual(view[0].to[0].to, id('Alakazam'));
  assert.deepStrictEqual(hub.privateUser(a).tradeEvo.map((o) => o.uid), [got.uid]);
  // Sin oferta no se puede forzar con «auto».
  assert.throws(() => candy.evolve(b, { id: id('Kadabra'), uid: 'x', to: id('Alakazam'), auto: true }));
  // Cancelar (como pulsar B): queda sin evolucionar y la vía del intercambio pendiente sigue ahí (el intercambio real dio uno).
  candy.cancelTradeEvo(a, { uid: got.uid });
  assert.strictEqual(candy.tradeEvoView(a).length, 0);
  assert.strictEqual(a.collection[id('Kadabra')].n, 1);
  assert.ok(a.tradeTokens >= 1);
  assert.throws(() => candy.evolve(a, { id: id('Kadabra'), uid: got.uid, to: id('Alakazam'), auto: true }), /ya no está disponible/);
  // Segundo intercambio: aceptar.
  const c = user({ collection: { [PIKA]: { n: 1, s: 0 } } });
  const d = user({ collection: { [id('Kadabra')]: { n: 1, s: 0 } } });
  const got2 = swap(c, d, PIKA, id('Kadabra'));
  const tokens = c.tradeTokens || 0;
  const r = candy.evolve(c, { id: id('Kadabra'), uid: got2.uid, to: id('Alakazam'), auto: true });
  assert.strictEqual(r.to, id('Alakazam'));
  assert.strictEqual(c.tradeTokens || 0, tokens, 'la evolución automática no gasta el intercambio pendiente');
  assert.strictEqual(candy.tradeEvoView(c).length, 0);
  assert.ok(c.collection[id('Alakazam')] && dex.caught(c, id('Alakazam')));
});

test('objeto equipado de intercambio (Revestimiento Metálico): se gasta al evolucionar; Piedra Eterna lo impide', () => {
  const a = user({ collection: { [PIKA]: { n: 1, s: 0 } } });
  const b = user({ collection: { [id('Onix')]: { n: 1, s: 0 } }, items: { 'metal-coat': 1 } });
  sp.syncAll(b);
  bp.hold(b, { id: id('Onix'), uid: b.mons[id('Onix')][0].uid, item: 'metalcoat' });
  assert.strictEqual(b.items['metal-coat'], undefined, 'el objeto sale de la mochila al equiparlo');
  const got = swap(a, b, PIKA, id('Onix'));
  assert.strictEqual(got.item, 'metalcoat', 'el objeto viaja con el ejemplar');
  assert.strictEqual(candy.tradeEvoView(a)[0].to[0].to, id('Steelix'));
  candy.evolve(a, { id: id('Onix'), uid: got.uid, to: id('Steelix'), auto: true });
  assert.strictEqual(got.item, undefined, 'se gasta el equipado');
  assert.strictEqual(a.items['metal-coat'], undefined);
  // Sin objeto no hay oferta (Onix → Steelix lo exige).
  const c = user({ collection: { [PIKA]: { n: 1, s: 0 } } });
  const d = user({ collection: { [id('Onix')]: { n: 1, s: 0 } } });
  swap(c, d, PIKA, id('Onix'));
  assert.strictEqual(candy.tradeEvoView(c).length, 0);
  // Piedra Eterna: sin oferta.
  const e = user({ collection: { [PIKA]: { n: 1, s: 0 } } });
  const f = user({ collection: { [id('Kadabra')]: { n: 1, s: 0 } }, items: { 'hi-everstone': 1 } });
  sp.syncAll(f);
  bp.hold(f, { id: id('Kadabra'), uid: f.mons[id('Kadabra')][0].uid, item: 'everstone' });
  swap(e, f, PIKA, id('Kadabra'));
  assert.strictEqual(candy.tradeEvoView(e).length, 0);
});

test('Karrablast y Shelmet solo evolucionan al intercambiarse entre sí', () => {
  const a = user({ collection: { [id('Shelmet')]: { n: 1, s: 0 } } });
  const b = user({ collection: { [id('Karrablast')]: { n: 1, s: 0 } } });
  swap(a, b, id('Shelmet'), id('Karrablast'));
  assert.strictEqual(candy.tradeEvoView(a)[0].to[0].to, id('Escavalier'));
  assert.strictEqual(candy.tradeEvoView(b)[0].to[0].to, id('Accelgor'));
  const c = user({ collection: { [PIKA]: { n: 1, s: 0 } } });
  const d = user({ collection: { [id('Karrablast')]: { n: 1, s: 0 } } });
  swap(c, d, PIKA, id('Karrablast'));
  assert.strictEqual(candy.tradeEvoView(c).length, 0, 'por un Pikachu no evoluciona');
});

test('regalo: no es un intercambio (solo da el intercambio pendiente de siempre, sin oferta automática)', () => {
  const evoreq = require('../server/evoreq');
  const a = user(); const b = user();
  assert.strictEqual(evoreq.noteTrade(a, b), 1);
  assert.strictEqual((a.tradeEvo || []).length, 0);
});

test('objeto equipado que se gasta al evolucionar por nivel (Piedra Oval de día); las piedras de la mochila siguen igual', () => {
  const real = Date.now; Date.now = () => Date.UTC(2026, 5, 10, 10, 0, 0); // 12:00 en España
  try {
    const u = user({ collection: { [id('Happiny')]: { n: 1, s: 0 }, [id('Pikachu')]: { n: 1, s: 0 } }, items: { 'oval-stone': 1, 'thunder-stone': 1 } });
    sp.syncAll(u);
    const m = u.mons[id('Happiny')][0]; m.level = 30;
    bp.hold(u, { id: id('Happiny'), uid: m.uid, item: 'ovalstone' });
    assert.strictEqual(u.items['oval-stone'], undefined);
    candy.evolve(u, { id: id('Happiny'), uid: m.uid, to: id('Chansey') });
    assert.strictEqual(m.item, undefined, 'la Piedra Oval equipada se ha gastado');
    assert.strictEqual(u.items['oval-stone'], undefined, 'y no se ha devuelto a la mochila');
    const pk = u.mons[id('Pikachu')][0];
    candy.evolve(u, { id: id('Pikachu'), uid: pk.uid, to: id('Raichu') });
    assert.strictEqual(u.items['thunder-stone'], undefined, 'la piedra se gasta de la mochila');
  } finally { Date.now = real; }
});

test('Nincada → Ninjask: con hueco y una Poké Ball aparece un Shedinja (mismo nivel, IV y naturaleza), sin bucle de monedas', () => {
  const NIN = id('Nincada'); const NJK = id('Ninjask'); const SHE = id('Shedinja');
  const u = user({ collection: { [NIN]: { n: 1, s: 0 } }, items: { 'poke-ball': 2 } });
  sp.syncAll(u);
  const m = u.mons[NIN][0];
  m.level = 24; m.ivs = [1, 2, 3, 4, 5, 6]; m.nature = 'Audaz'; m.nick = 'Bicho'; m.friendship = 100;
  assert.throws(() => candy.evolve(u, { id: NIN, uid: m.uid, to: SHE }), /Ninjask/, 'Shedinja no se obtiene evolucionando directamente');
  const r = candy.evolve(u, { id: NIN, uid: m.uid, to: NJK });
  const s = u.mons[SHE][0];
  assert.strictEqual(r.shedinja, s.uid);
  assert.strictEqual(u.items['poke-ball'], 1, 'gasta una Poké Ball');
  assert.deepStrictEqual([s.level, s.ivs, s.nature, s.nick, s.ball, s.item], [24, [1, 2, 3, 4, 5, 6], 'Audaz', '', 'poke-ball', undefined]);
  assert.strictEqual(u.collection[NJK].n, 1);
  assert.strictEqual(u.collection[SHE].n, 1);
  assert.ok(dex.caught(u, SHE));
  // Sin Poké Ball: no hay Shedinja.
  const v = user({ collection: { [NIN]: { n: 1, s: 0 } } });
  sp.syncAll(v); v.mons[NIN][0].level = 24;
  assert.strictEqual(candy.evolve(v, { id: NIN, uid: v.mons[NIN][0].uid, to: NJK }).shedinja, null);
  assert.ok(!v.collection[SHE]);
  // Sin hueco (5 Shedinja): no hay Shedinja y la Poké Ball no se gasta.
  const w = user({ collection: { [NIN]: { n: 1, s: 0 }, [SHE]: { n: 5, s: 0 } }, items: { 'poke-ball': 1 } });
  sp.syncAll(w); w.mons[NIN][0].level = 24;
  assert.strictEqual(candy.evolve(w, { id: NIN, uid: w.mons[NIN][0].uid, to: NJK }).shedinja, null);
  assert.strictEqual(w.items['poke-ball'], 1);
  // Economía: cada Shedinja así obtenido vale mucho menos que la Poké Ball (120) que cuesta.
  const price = items.ITEMS['poke-ball'].price;
  const best = RARITY.C.dust * gacha.DUST_RATE + 100 * 0; // polvo de transferirlo (el PNJ paga como mucho lo mismo o menos)
  assert.ok(best < price / 2, `${best} vs ${price}`);
  assert.strictEqual(require('../server/pokedex').BY_ID.get(SHE).rarity, 'C');
});

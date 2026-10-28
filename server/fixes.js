'use strict';
// Correcciones puntuales de datos. Cada una se aplica una sola vez (queda marcada en state.fixes)
// y siempre después de una copia de seguridad, para poder deshacerla.
const db = require('./db');

const FIXES = [
  {
    // Monedas metidas con el panel de anfitrión antes de que existiera el registro (confirmado por el
    // propio anfitrión): piti13579 las usó para subir a nivel 129 y tusmuertos recibió ~125.000.
    id: 'abuso-panel-2026-10-28',
    apply() {
      const hub = require('./hub');
      const { BY_ID } = require('./pokedex');
      const out = [];
      const piti = db.userByName('piti13579');
      if (piti) {
        // Nivel 15 (como el jugador legítimo más alto) y la experiencia justa de ese nivel.
        const lvl = 15;
        out.push(`piti13579: nivel ${piti.level} → ${lvl}`);
        piti.level = lvl;
        piti.xp = 100 * (lvl - 1) * (lvl - 1);
        // Caramelos Raros de las recompensas de nivel: se queda con 6.
        if ((piti.items['rare-candy'] || 0) > 6) { out.push(`caramelos ${piti.items['rare-candy']} → 6`); piti.items['rare-candy'] = 6; }
        // Medalla Tierra exige nivel 20.
        const p = piti.progress || {};
        if (p.badges && p.badges.includes('tierra')) {
          p.badges = p.badges.filter((b) => b !== 'tierra');
          p.titles = (p.titles || []).filter((t) => t !== 'badge-tierra');
          if (piti.equip && piti.equip.title === 'badge-tierra') piti.equip.title = null;
          out.push('sin Medalla Tierra');
        }
        // Legendarias y míticas: se queda con 8 (las de más valor). Primero se quitan las legendarias
        // normales sin variocolor y nunca el compañero.
        const leg = Object.entries(piti.collection)
          .map(([id, c]) => ({ id: Number(id), c, p: BY_ID.get(Number(id)) }))
          .filter((x) => x.p && (x.p.rarity === 'L' || x.p.rarity === 'M'))
          .sort((a, b) => (a.p.rarity === 'M') - (b.p.rarity === 'M') || (a.c.s > 0) - (b.c.s > 0) || a.c.n - b.c.n);
        const removed = [];
        for (const x of leg.slice(0, Math.max(0, leg.length - 8))) {
          if (piti.buddy && piti.buddy.id === x.id) continue;
          delete piti.collection[x.id];
          removed.push(x.p.name);
        }
        if (removed.length) out.push(`quitadas ${removed.length} legendarias/míticas: ${removed.join(', ')}`);
        // Legendarias y míticas puestas a la venta en el Mercado: se retiran sin devolverlas.
        const m = db.data.market;
        if (m && m.orders) {
          const gone = m.orders.filter((o) => o.userId === piti.id && o.side === 'sell' && o.kind === 'poke' && ['L', 'M'].includes((BY_ID.get(o.pokeId) || {}).rarity));
          if (gone.length) {
            m.orders = m.orders.filter((o) => !gone.includes(o));
            out.push(`retiradas del Mercado ${gone.reduce((s, o) => s + o.qty, 0)} legendarias/míticas en venta`);
          }
        }
        hub.ledger(piti, 0, 'admin', 'Corrección por abuso del panel');
      }
      const tus = db.userByName('tusmuertos');
      if (tus) {
        const take = Math.min(100000, tus.coins);
        tus.coins -= take;
        hub.ledger(tus, -take, 'admin', 'Corrección: monedas sin origen en el juego');
        out.push(`tusmuertos: −${take} monedas (queda ${tus.coins})`);
      }
      db.data.adminLog ||= [];
      db.data.adminLog.push({ at: Date.now(), by: 'sistema', action: 'fix', target: 'piti13579, tusmuertos', detail: out.join(' · ').slice(0, 400) });
      return out;
    },
  },
  {
    // Rastros del abuso en el ranking y las estadísticas: récord de mayor premio y apostado/ganado.
    id: 'abuso-ranking-2026-10-28',
    apply() {
      const out = [];
      for (const name of ['piti13579', 'tusmuertos']) {
        const u = db.userByName(name);
        if (!u || !u.stats) continue;
        out.push(`${name}: mayor premio ${u.stats.biggestWin || 0} → 0`);
        u.stats.biggestWin = 0;
        if (name === 'piti13579') {
          out.push(`apostado/ganado ${u.stats.wagered}/${u.stats.won} → 0/0`);
          u.stats.wagered = 0;
          u.stats.won = 0;
        }
      }
      db.data.adminLog ||= [];
      db.data.adminLog.push({ at: Date.now(), by: 'sistema', action: 'fix', target: 'piti13579, tusmuertos', detail: out.join(' · ') });
      return out;
    },
  },
  {
    // Últimos rastros: lo que piti13579 vendió a los NPC (Master Balls y legendarias del abuso), contadores
    // internos, colecciones que ya no están completas y anuncios de «En vivo» de lo que se le quitó.
    id: 'abuso-rastros-2026-10-28',
    apply() {
      const hub = require('./hub');
      const { SETS } = require('./progress');
      const out = [];
      const piti = db.userByName('piti13579');
      if (!piti) return out;
      // Ventas a NPC de cosas conseguidas con el abuso: el NPC recupera sus monedas y pierde lo comprado.
      const sold = ((db.data.market && db.data.market.trades) || []).filter((t) => t.seller === 'piti13579' && t.buyerNpc);
      for (const t of sold) {
        const npc = db.userByName(t.buyer);
        const coins = t.qty * t.price - Math.floor(t.qty * t.price * 0.03); // lo que recibió (sin el impuesto)
        const take = Math.min(coins, piti.coins);
        piti.coins -= take;
        hub.ledger(piti, -take, 'admin', `Corrección: venta a NPC (${t.ref})`);
        if (npc) {
          npc.coins += take;
          if (t.kind === 'item' || t.ref.startsWith('item:')) {
            const id = t.itemId || t.ref.slice(5);
            npc.items[id] = Math.max(0, (npc.items[id] || 0) - t.qty);
            if (!npc.items[id]) delete npc.items[id];
          } else if (t.pokeId || t.ref.startsWith('poke:')) {
            const id = t.pokeId || Number(t.ref.split(':')[1]);
            const c = npc.collection && npc.collection[id];
            if (c) { c.n -= t.qty; if (c.n <= 0) delete npc.collection[id]; }
          }
          // Si el NPC ya lo había puesto a la venta, se retira de su orden.
          const m = db.data.market;
          for (const o of m.orders.filter((o) => o.userId === npc.id && o.side === 'sell' && o.ref === t.ref)) o.qty = Math.max(0, o.qty - t.qty);
          m.orders = m.orders.filter((o) => o.qty > 0);
        }
        out.push(`venta a ${t.buyer} de ${t.qty}× ${t.ref}: −${take} monedas`);
      }
      // Contadores internos coherentes con el nivel y las medallas actuales.
      const p = piti.progress || {};
      if (p.counters) { p.counters.level = Math.min(p.counters.level || 0, piti.level - 1); p.counters.badge = (p.badges || []).length; }
      // Colecciones que ya no están completas: fuera la colección, su título y su bonus.
      for (const set of SETS) {
        if (!(p.sets || []).includes(set.id)) continue;
        if (set.ids.every((id) => piti.collection[id])) continue;
        p.sets = p.sets.filter((x) => x !== set.id);
        p.titles = (p.titles || []).filter((x) => x !== 'set-' + set.id);
        if (piti.equip && piti.equip.title === 'set-' + set.id) piti.equip.title = null;
        out.push(`colección «${set.name}» ya no completa`);
      }
      // «En vivo»: fuera los anuncios de legendarias que ya no tiene.
      const { BY_ID } = require('./pokedex');
      const before = db.data.feed.length;
      db.data.feed = db.data.feed.filter((f) => !(f.text || '').includes('piti13579 obtuvo') || !f.pokeId || piti.collection[f.pokeId]
        || !['L', 'M'].includes((BY_ID.get(f.pokeId) || {}).rarity));
      if (db.data.feed.length !== before) out.push(`${before - db.data.feed.length} anuncios de «En vivo» retirados`);
      out.push(`monedas finales ${piti.coins}`);
      db.data.adminLog ||= [];
      db.data.adminLog.push({ at: Date.now(), by: 'sistema', action: 'fix', target: 'piti13579', detail: out.join(' · ').slice(0, 400) });
      return out;
    },
  },
  {
    // Recorte «inteligente» de la Pokédex inflada con tiradas pagadas con monedas del abuso: en vez de borrar,
    // se bloquean con candado (se recuperan apostando, tirando o saliendo en el gacha; ver locked.js) hasta
    // dejar 120 especies. Primero las de menos valor: no variocolor, no compañero, ni legendarias/míticas, ni
    // de colecciones completas, ni base de una Mega desbloqueada.
    id: 'candado-2026-10-28',
    apply() {
      const locked = require('./locked');
      const out = [];
      for (const name of ['piti13579', 'tusmuertos']) {
        const u = db.userByName(name);
        if (!u) continue;
        const before = Object.keys(u.collection).length;
        const ids = locked.lockDown(u, 120);
        out.push(`${name}: ${before} → ${Object.keys(u.collection).length} especies, ${ids.length} con candado`);
      }
      db.data.adminLog ||= [];
      db.data.adminLog.push({ at: Date.now(), by: 'sistema', action: 'fix', target: 'piti13579, tusmuertos', detail: ('Pokémon con candado: ' + out.join(' · ')).slice(0, 400) });
      return out;
    },
  },
];

// Copia de seguridad y después las correcciones pendientes.
async function run(backupNow) {
  db.data.state.fixes ||= {};
  const pending = FIXES.filter((f) => !db.data.state.fixes[f.id]);
  if (!pending.length) return;
  await backupNow('antes de corrección');
  for (const f of pending) {
    const out = f.apply();
    db.data.state.fixes[f.id] = Date.now();
    console.log(`  🛠️  Corrección ${f.id}: ${out.join(' · ')}`);
  }
  db.save();
}

module.exports = { run, FIXES };

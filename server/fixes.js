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

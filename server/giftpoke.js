'use strict';
// Regalar un Pokémon a otro jugador (ejemplar concreto; ver protect.js para los ejemplares de combate).
const db = require('./db');
const hub = require('./hub');
const dex = require('./pokedex');
const gacha = require('./gacha');
const specimen = require('./specimen');
const canGift = (user) => require('./transfer').canGift(user);

function giftPoke(user, { to, id, shiny, uid, confirmUids }) {
  canGift(user);
  const t = db.userByName(to);
  if (!t || t.id === user.id) throw new Error('Destinatario no válido.');
  if (t.npc) throw new Error('Los comerciantes NPC no aceptan regalos.');
  const rare = ['L', 'M'].includes((dex.BY_ID.get(Number(id)) || {}).rarity);
  require('./transfer').pokeInCheck(t, rare);
  // Se regala un ejemplar concreto: el que elijas (`uid`) o, sin elección, el menos valioso que NO sea de combate (protect.js); nunca uno en uso
  // (sala de intercambio, Alto Mando, incursión, expedición, criadero, compañero). Si solo quedan ejemplares de combate, error salvo `confirmUids`.
  // Sus IV, naturaleza, Ball, marca y tamaño viajan con él; el objeto equipado vuelve a tu mochila.
  const gts = require('./gts');
  const nid = Number(id);
  if (!specimen.sync(user, nid).some((m) => !!m.shiny === !!shiny)) { gacha.takePoke(user, id, !!shiny); throw new Error('No tienes ese Pokémon.'); } // takePoke explica por qué no
  const gone = require('./protect').select(user, nid, !!shiny, 1, { uids: uid ? [String(uid)] : undefined, confirmUids, hard: (m) => gts.busyReason(user, nid, m, 'los regalos') })[0];
  gts.pull(user, nid, gone, false);
  const p = dex.BY_ID.get(nid);
  require('./transfer').notePokeIn(t, rare);
  const seen = new Set(specimen.sync(t, p.id).map((m) => m.uid));
  gacha.grant(t, p.id, !!shiny);
  const got = gone && specimen.sync(t, p.id).find((m) => !seen.has(m.uid));
  if (got) specimen.applyTraits(p.id, got, specimen.traitsOf(gone, user));
  require('./evoreq').noteTrade(t, user); // intercambio real: vale como un Cordón Unión
  hub.track(t, 'gift_recv');
  db.save();
  hub.emitUser(t.id, 'toast', { kind: 'gift', text: `🎁 ${user.username} te envió un ${shiny ? p.name + ' variocolor' : p.name}` });
  require('./notify').push(t, { kind: 'gift', text: `🎁 ${user.username} te envió un ${shiny ? p.name + ' variocolor' : p.name}`, link: '#/pc' });
  hub.feed('trade', `🤝 ${user.username} le regaló ${shiny ? 'un ' + p.name + ' variocolor' : p.name} a ${t.username}`);
  hub.pushMe(t);
  return {};
}

module.exports = { giftPoke };

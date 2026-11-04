'use strict';
// Torre Batalla: se completa en la siguiente entrega (de momento solo el enlace con el resto del casino).
const no = () => { throw new Error('La Torre Batalla llega muy pronto.'); };
module.exports = { state: () => ({ run: null, best: { singles: 0, doubles: 0 }, board: { singles: [], doubles: [] }, rules: { pick: {}, medals: [] }, medals: {}, bpToday: 0, bpCap: 40 }), start: no, pick: no, fight: no, swap: no, abandon: no, onEnd: () => null, onAbort: () => {}, board: () => [] };

// Hora de España (Europe/Madrid) en el cliente, igual que server/daytime.js: noche 21:00–06:00, día 06:00–21:00.
import { S } from './core.js';

const FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' });
export const phaseNow = (now = Date.now()) => {
  const d = (S.data && S.data.daytime) || { nightFrom: 21, nightTo: 6 };
  const h = Number(FMT.formatToParts(new Date(now)).find((p) => p.type === 'hour').value) % 24;
  return h >= d.nightFrom || h < d.nightTo ? 'night' : 'day';
};
export const PHASE = { night: { ico: '🌙', label: 'De noche', range: '21:00–06:00' }, day: { ico: '☀️', label: 'De día', range: '06:00–21:00' } };
export const timeSpecies = (phase) => ((S.data && S.data.daytime && S.data.daytime[phase]) || []).filter((id) => S.dexById.has(id));
// «Gastly, Zubat, Hoothoot y 12 más»
export function listNames(ids, max = 6) {
  const names = ids.slice(0, max).map((id) => S.dexById.get(id).name);
  return names.join(', ') + (ids.length > max ? ` y ${ids.length - max} más` : '');
}

// Pestaña «Liga» de Combates: rango y puntuación por formato, cuenta atrás de la temporada, tabla, premios y temporadas pasadas.
import { S, h, fmt, act, avatar, titleTag, rankBadge, rankIcon, RANK_NAMES } from '../core.js';
import { showPlayer } from '../social.js';

const FORMAT_ES = { singles: 'Individual', doubles: 'Dobles' };
let boardFormat = 'singles';

export function fmtLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d} d ${hh} h` : hh ? `${hh} h ${mm} min` : `${mm} min`;
}
const tierBadge = (t, top) => rankBadge({ t, r: 0, top });

/** @param {{ goRanked: (format: string) => void }} o */
export function leagueTab({ goRanked }) {
  const root = h('div', { class: 'stack lg-tab' }, h('p', { class: 'muted' }, 'Cargando la Liga…'));
  (async () => {
    const st = await act('league:state');
    if (!st) { root.replaceChildren(h('p', { class: 'bad' }, 'No se pudo cargar la Liga.')); return; }
    const draw = () => {
      const fcard = (f) => {
        const x = st.mine[f];
        const pct = x.next ? Math.max(0, Math.min(100, Math.round(((x.r - (st.tiers[x.tier].min || 1000)) / (x.next - (st.tiers[x.tier].min || 1000))) * 100))) : 100;
        return h('div', { class: 'card lg-fmt' },
          h('div', { class: 'lg-emb' }, h('span', { class: `rank-badge xl t${x.tier}${x.top ? ' top' : ''}` }, h('img', { class: 'pixel', src: rankIcon(x.tier), alt: '' }), x.top ? h('i', {}, '★') : null)),
          h('div', { class: 'lg-info' },
            h('h3', {}, FORMAT_ES[f]),
            h('div', { class: 'lg-rank' }, h('b', {}, RANK_NAMES[x.tier]), x.top ? h('span', { class: 'lg-top' }, ' · Top 3 🏅') : null),
            h('div', { class: 'lg-rating' }, `${x.r} puntos`),
            h('div', { class: 'small muted' }, `${x.w} V · ${x.l} D${x.d ? ` · ${x.d} E` : ''} · máx. ${x.peak}`),
            h('div', { class: 'lg-prog', role: 'img', 'aria-label': x.next ? `${pct} % hacia ${RANK_NAMES[x.tier + 1]}` : 'Rango máximo' }, h('i', { style: { width: pct + '%' } })),
            h('div', { class: 'small muted' }, x.next ? `Faltan ${Math.max(0, x.next - x.r)} para ${RANK_NAMES[x.tier + 1]}` : '¡Rango máximo!')),
          h('button', { class: 'btn primary', type: 'button', disabled: !st.allowed, title: st.why || '', onclick: () => goRanked(f) }, '🏆 Jugar clasificatoria'));
      };
      const rows = (st.board[boardFormat] || []).map((r, i) => h('div', { class: 'rank-row' + (r.username === S.me.username ? ' me' : '') + (i < 3 ? ' top' + (i + 1) : ''), onclick: () => showPlayer(r.username) },
        h('span', { class: 'rank-pos' }, ['🥇', '🥈', '🥉'][i] || i + 1), avatar(r.buddy, r),
        h('b', { class: 'grow' }, r.username, ' ', rankBadge({ t: r.tier, r: r.r, top: r.top }, 'sm'), ' ', titleTag(r.title)),
        h('span', { class: 'small muted' }, `${r.w}V ${r.l}D`), h('span', { class: 'rank-val' }, String(r.r))));
      const past = st.past.length ? st.past.map((p) => h('div', { class: 'duel-row small' },
        h('b', {}, seasonName(p.season)), tierBadge(p.best, p.top),
        h('div', { class: 'grow muted' }, `Individual ${p.singles.r} (${p.singles.w}V ${p.singles.l}D) · Dobles ${p.doubles.r} (${p.doubles.w}V ${p.doubles.l}D)`),
        h('span', {}, p.reward ? rewardText(p.reward) : p.games ? 'Sin premio (mín. 5 combates)' : '—')))
        : [h('p', { class: 'muted small' }, 'Aún no hay temporadas terminadas. ¡Esta es la primera!')];
      root.replaceChildren(...[
        h('div', { class: 'card lg-head' },
          h('div', {}, h('h3', {}, `🏆 Liga Pokémon · ${st.label}`),
            h('p', { class: 'small muted' }, 'Clasificatoria 1 contra 1 por temporadas mensuales (hora de España): nivel 50, sin apuesta y sin efectos de amistad. Empiezas con 1000 puntos por formato; ganar a rivales fuertes da más.')),
          h('div', { class: 'lg-count' }, h('span', { class: 'small muted' }, 'Termina en'), h('b', {}, fmtLeft(st.left)))),
        st.allowed ? null : h('p', { class: 'bad small' }, st.why),
        h('div', { class: 'lg-fmts' }, fcard('singles'), fcard('doubles')),
        h('div', { class: 'card stack' },
          h('div', { class: 'row gap wrap' }, h('h3', { class: 'grow' }, '📊 Clasificación (top 20)'),
            h('div', { class: 'seg' }, Object.entries(FORMAT_ES).map(([k, l]) => h('button', { class: 'seg-b' + (boardFormat === k ? ' on' : ''), type: 'button', onclick: () => { boardFormat = k; draw(); } }, l)))),
          h('div', { class: 'rank-list' }, rows.length ? rows : [h('p', { class: 'muted' }, 'Nadie ha jugado aún esta temporada.')])),
        h('div', { class: 'card stack' }, h('h3', {}, '🎁 Premios de fin de temporada'),
          h('div', { class: 'lg-rewards' }, st.tiers.map((t, i) => h('div', { class: 'lg-rw' + (st.best === i ? ' on' : '') }, tierBadge(i), h('b', {}, `${t.name}${t.min ? ` (${t.min}+)` : ''}`),
            h('span', { class: 'small muted' }, rewardText(t.reward))))),
          h('div', { class: 'small muted' }, `Top 3 de cada formato (mín. ${st.rules.minTop} combates y Super Ball): `, rewardText({ ...st.top }), '. Se premia el rango más alto alcanzado en la temporada y hay que haber jugado al menos ', String(st.rules.minGames), ' combates puntuados. Después, tu puntuación se acerca a 1000 (la mitad de la distancia).')),
        h('div', { class: 'card stack' }, h('h3', {}, '📜 Temporadas anteriores'), h('div', { class: 'duel-list' }, past)),
        h('div', { class: 'card small muted' }, `Reglas: solo cuentan los combates contra otra cuenta (nivel 3 y 3 días de antigüedad), de al menos ${st.rules.minTurns} turnos y como mucho ${st.rules.maxVs} al día contra el mismo rival. Rendirse, quedarse sin tiempo o abandonar cuenta como derrota. Los combates clasificatorios también dan PB como cualquier combate PvP.`)].filter(Boolean));
    };
    draw();
  })();
  return root;
}
const seasonName = (k) => { const [y, m] = k.split('-').map(Number); return `${['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][m - 1]} ${y}`; };
function rewardText(r) {
  const parts = [];
  if (r.bp) parts.push(`🎖️ ${r.bp} PB`);
  if (r.coins) parts.push(`🪙 ${fmt(r.coins)}`);
  if (r.frame && S.data.items[r.frame]) parts.push(S.data.items[r.frame].name);
  for (const [id, q] of Object.entries(r.items || {})) if (S.data.items[id]) parts.push(`${q}× ${S.data.items[id].name}`);
  if (r.title) parts.push('título');
  return parts.join(' · ') || '—';
}

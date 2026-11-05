// Pestaña «Alto Mando» de Combates: la carrera de 5 combates seguidos sin curar (Lorelei, Bruno, Agatha, Lance y el Campeón Azul) y el Salón de la Fama.
import { S, h, act, toast, sfx, sprite } from '../core.js';
import { loadNames } from '../battle-screen.js';

const dexName = (id) => (S.dexById.get(id) || { name: '#' + id }).name;
const STATUS = { brn: '🔥', par: '⚡', psn: '☠️', tox: '☠️', slp: '💤', frz: '🧊' };

export function hofList(entries, { limit = 12 } = {}) {
  if (!entries || !entries.length) return h('p', { class: 'muted small' }, 'Aún no has entrado en el Salón de la Fama. Vence al Alto Mando y al Campeón con tu equipo.');
  return h('div', { class: 'el-hof' }, entries.slice(-limit).reverse().map((e) => h('div', { class: 'el-hof-row', 'data-testid': 'hof-row' },
    h('div', { class: 'el-hof-n' }, h('b', {}, `#${e.n}`), h('span', { class: 'small muted' }, new Date(e.at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }))),
    h('div', { class: 'el-hof-team' }, e.team.map((m) => h('div', { class: 'el-hof-mon', title: `${m.name} Nv. ${m.level}` }, h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: m.name, loading: 'lazy' }), h('span', { class: 'small' }, `Nv. ${m.level}`)))))));
}

/** @param {{ openBattle: Function, teamMembers: Function, ensureTeam: Function, refresh: Function }} o */
export function eliteTab({ openBattle, teamMembers, ensureTeam, refresh, state }) {
  const root = h('div', { class: 'stack el-tab' });
  (async () => {
    await loadNames();
    const E = state.elite;
    const badges = S.me.progress.badges.filter((b) => b.got).length;
    const run = E.run;
    const head = h('div', { class: 'card stack el-head' },
      h('h3', {}, '👑 Alto Mando de Kanto'),
      h('p', { class: 'small muted' }, 'Como en los juegos: cinco combates seguidos (Lorelei, Bruno, Agatha, Lance y el Campeón Azul) SIN curar a tu equipo entre uno y otro: los PS, los PP y los estados pasan al siguiente combate y los debilitados quedan fuera. Individual, niveles reales y equipos de nivel fijo. Si pierdes, empiezas de nuevo desde Lorelei con el equipo curado. Cada victoria cobra su premio, EXP y Puntos de Batalla.'),
      h('p', { class: 'small muted' }, 'Al vencer al Campeón entras en el Salón de la Fama y recibes el título de Campeón de la Liga (una sola vez); además, la primera vez, una Moneda Amuleto. Después puedes repetir: los equipos suben +3 niveles por cada victoria anterior (hasta +15).'),
      E.clears ? h('div', { class: 'small' }, `🏛️ Has entrado ${E.clears} ${E.clears === 1 ? 'vez' : 'veces'} en el Salón de la Fama${E.bonus ? ` · rivales +${E.bonus} niveles` : ''}.`) : null);
    const members = h('div', { class: 'el-members' }, E.members.map((m, i) => {
      const state = run ? (i < run.stage ? 'done' : i === run.stage ? 'now' : '') : '';
      return h('div', { class: 'el-member' + (state ? ' ' + state : '') + (m.champion ? ' champ' : ''), 'data-testid': 'el-member' },
        h('div', { class: 'tr-sil' }, m.team.slice(0, 3).map((id) => h('img', { class: 'pixel', src: sprite(id), alt: '', loading: 'lazy' }))),
        h('div', { class: 'grow' }, h('div', { class: 'small muted' }, `${i + 1}/5 · ${m.cls}`), h('b', {}, m.name),
          h('div', { class: 'small muted' }, `${m.n} Pokémon · Nv. ${m.lv[0] === m.lv[1] ? m.lv[0] : `${m.lv[0]}-${m.lv[1]}`}`), h('div', { class: 'small muted' }, `«${m.quote}»`)),
        state === 'done' ? h('span', { class: 'good' }, '✔') : state === 'now' ? h('span', { class: 'good' }, '▶') : null);
    }));
    const body = [head];
    if (!E.unlocked) {
      body.push(h('div', { class: 'card lock-note' }, `🔒 Necesitas las ${E.need} medallas de Kanto (tienes ${badges}). Véncelas en «Combatir» contra los Líderes de Gimnasio, en orden.`), members);
    } else if (!run) {
      const go = h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'el-start', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          if (!(await ensureTeam())) return;
          const team = await teamMembers('singles');
          if (!team) return;
          const r = await act('battle:elite:start', { team }, btn);
          if (r) { sfx('click'); await openBattle(r.battle); }
        } finally { btn.disabled = false; }
      } }, '🏛️ Empezar la carrera');
      body.push(h('div', { class: 'card stack' }, h('p', { class: 'small muted' }, 'Llevas tu equipo (el de «Combatir»: elige uno guardado o el automático) y no podrás cambiarlo hasta el final. Recomendable: Pokémon por encima del nivel 55 y objetos para curarse en combate.'), go), members);
    } else {
      const team = h('div', { class: 'el-team' }, run.members.map((m) => h('div', { class: 'el-mon' + (m.fainted ? ' down' : '') },
        h('img', { class: 'pixel', src: sprite(m.id, m.shiny), alt: m.name }),
        h('div', { class: 'grow' }, h('div', { class: 'small' }, h('b', {}, m.name), m.level ? ` Nv. ${m.level}` : '', m.status ? ` ${STATUS[m.status] || m.status}` : ''),
          h('div', { class: 'hpbar' }, h('i', { class: m.hp > 0.5 ? '' : m.hp > 0.2 ? 'yellow' : 'red', style: { width: Math.round(m.hp * 100) + '%' } })),
          h('div', { class: 'small muted' }, m.fainted ? 'Debilitado' : `${Math.round(m.hp * 100)} % PS`)))));
      const next = h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'el-next', onclick: async (e) => {
        const r = await act('battle:elite:next', {}, e.currentTarget);
        if (r) { sfx('click'); await openBattle(r.battle); }
      } }, `⚔️ Siguiente combate: ${run.next} (${run.stage + 1}/${run.total})`);
      const quit = h('button', { class: 'btn danger small', type: 'button', onclick: async (e) => {
        if (!confirm('¿Abandonar la carrera? Perderás el progreso de esta carrera (los premios de los combates ya ganados se quedan).')) return;
        const r = await act('battle:elite:abandon', {}, e.currentTarget);
        if (r) { toast('Carrera abandonada.', 'info'); refresh(); }
      } }, 'Abandonar carrera');
      body.push(h('div', { class: 'card stack' }, h('h3', {}, `Carrera en curso · combate ${run.stage + 1}/${run.total}`), team, h('div', { class: 'row gap wrap' }, next, quit)), members);
    }
    body.push(h('div', { class: 'card stack' }, h('h3', {}, '🏛️ Salón de la Fama'), hofList(E.hof)));
    root.replaceChildren(...body);
  })();
  return root;
}

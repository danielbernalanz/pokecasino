import { aniImg } from '../anim.js';
import { S, h, fmt, act, sfx, toast, art, item, badgeImg, bus, hpBar, monImg, MON } from '../core.js';
import { SECTIONS, sectionNew } from '../nav.js';
import { canInstall, installApp } from '../main.js';
import { dailyChest } from '../rewards.js';
import { buddyFindBlock } from './huerto.js';
import { oakSay } from '../nav.js';

function rewardText(r) {
  const parts = [];
  if (r.coins) parts.push(`${fmt(r.coins)} monedas`);
  for (const [id, n] of Object.entries(r.items || {})) parts.push(`${n}× ${S.data.items[id].name}`);
  if (r.title) parts.push('un título');
  return parts.join(' + ');
}

const SEC_TONE = { casino: 'r', pokemon: 'b', mercado: 'y', entrenador: 'g' };
const SEC_MON = { casino: 52, pokemon: 25, mercado: 352, entrenador: 133 };
const SEC_DESC = { casino: 'Mesas, máquinas y retos', pokemon: 'Gacha, Caja PC y combates', mercado: 'Compra y vende', entrenador: 'Medallas y ranking' };

// Aviso a los anfitriones: hace tiempo que nadie descarga una copia (se puede cerrar hasta recargar).
let backupDismissed = false;
export function backupReminder() {
  const box = h('div');
  if (!S.me || !S.me.isAdmin || backupDismissed) return box;
  act('admin:backups').then((r) => {
    if (!r || (r.downloadAgo != null && r.downloadAgo < 7)) return;
    const close = () => { backupDismissed = true; box.replaceChildren(); };
    box.replaceChildren(h('div', { class: 'card row gap', style: { border: '2px solid #e0a100' } },
      h('div', { class: 'grow' }, h('b', {}, '💾 Descarga una copia de seguridad'),
        h('div', { class: 'small' }, `Última descarga: ${r.downloadAgo == null ? 'nunca' : `hace ${r.downloadAgo} días`}. La base de datos gratuita puede caducar.`)),
      h('a', { class: 'btn small primary', href: '#/admin' }, 'Ir a Admin'), h('button', { class: 'btn small', onclick: close }, '✕')));
  });
  return box;
}

// Eventos activos y el siguiente, con la cuenta atrás en palabras.
const left = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} días`; };
const WEEKDAY = (t) => new Date(t).toLocaleDateString('es-ES', { weekday: 'long', timeZone: 'Europe/Madrid' });
// Banner del evento Megaevolución (cuenta atrás, Hora Mega y fragmentos).
export function megaBanner() {
  const m = S.mega;
  if (!m || !m.active) return null;
  const mm = S.me.mega;
  return h('a', { class: 'card mega-banner' + (m.hour ? ' hour' : ''), href: '#/mega' },
    h('span', { class: 'mb-ico' }, '💠'),
    h('div', { class: 'grow' },
      h('b', {}, m.hour ? '⚡ ¡HORA MEGA! Fragmentos ×2' : '¡Evento Megaevolución!'),
      h('div', { class: 'small' }, `Megapiedras, Máquina Mega y Bote de ${fmt(m.bote)} monedas · quedan ${left(m.endsAt - Date.now())}`),
      h('div', { class: 'small mb-frags' }, `Tienes ${fmt(mm.frags)} 💠${mm.frags >= S.data.mega.cfg.craftCost ? ' · ¡ya puedes fabricar una megapiedra!' : ` · te faltan ${S.data.mega.cfg.craftCost - mm.frags} para fabricar una`}`)),
    h('span', { class: 'btn primary' }, 'Entrar'));
}
export function eventsCard() {
  const ev = S.events;
  if (!ev) return '';
  if (!ev.active.length) {
    return ev.next ? h('div', { class: 'card event-card soon' }, h('span', { class: 'event-ico' }, ev.next.events[0].icon),
      h('div', { class: 'grow' }, h('b', {}, `Próximo evento: ${ev.next.events.map((e) => e.name).join(' y ')}`),
        h('div', { class: 'small muted' }, `Empieza el ${WEEKDAY(ev.next.starts)} (en ${left(ev.next.starts - Date.now())}). ${ev.next.events.map((e) => e.desc).join(' ')}`))) : '';
  }
  return h('div', { class: 'card event-card' }, h('div', { class: 'event-title' }, '🎉 Evento activo'),
    ev.active.map((e) => h('div', { class: 'row gap event-row' }, h('span', { class: 'event-ico' }, e.icon),
      h('div', { class: 'grow' }, h('b', {}, e.name), h('div', { class: 'small' }, e.desc)),
      h('span', { class: 'muted small nowrap' }, `quedan ${left(e.ends - Date.now())}`))));
}

export default {
  id: 'lobby', title: 'Inicio', icon: '🏠',
  mount(root) {
    const me = S.me;
    const today = new Date().toISOString().slice(0, 10);
    const dailyDone = me.daily.last === today;
    const freeDone = me.daily.freePull === today;
    const streak = dailyDone ? me.daily.streak : (me.daily.last === new Date(Date.now() - 864e5).toISOString().slice(0, 10) ? me.daily.streak + 1 : 1);
    const dl = S.data.daily;
    const nextReward = dl.base + dl.step * (Math.min(streak, dl.max) - 1);

    const dailyBtn = h('button', { class: 'btn primary', disabled: dailyDone, onclick: async (e) => {
      const r = await act('daily:claim', {}, e.target);
      if (r) {
        toast(`+${fmt(r.reward)} monedas y 1 Ticket Gacha · racha de ${r.streak} días${r.charm ? ' · ¡+1 Amuleto Iris!' : ''}`, 'success', 6000);
        await dailyChest({ reward: r.reward, streak: r.streak, charm: !!r.charm });
        this.remount(root);
      }
    } }, dailyDone ? 'Reclamado hoy ✓' : `Reclamar ${fmt(nextReward)}`);

    // Motivo por el que Joy no puede ayudar ahora, con los datos que ya tiene el cliente (el servidor decide al final).
    const hl = S.data.heal;
    const healWhy = () => {
      if (S.me.coins >= hl.limit) return `Joy ayuda cuando tienes menos de ${hl.limit} monedas.`;
      const wait = (S.me.lastHeal || 0) + hl.cooldown - Date.now();
      if (wait > 0) return `Joy ya te ayudó hace poco. Vuelve en ${Math.ceil(wait / 60000)} min.`;
      if (S.me.coins + (S.me.lockedCoins || 0) >= hl.limit) return `Tienes ${fmt(S.me.lockedCoins)} monedas apartadas en pedidos del Mercado o en una mesa/apuesta en curso. Cancela el pedido o levántate de la mesa para recuperarlas.`;
      return '';
    };
    const healNote = h('p', { class: 'small muted' });
    const healBtn = h('button', { class: 'btn', onclick: async (e) => {
      const r = await act('center:heal', {}, e.target);
      if (r) { sfx('win'); toast(`La enfermera Joy te prestó ${fmt(S.data.heal.amount)} monedas. ¡Suerte!`, 'success'); }
      else healNote.textContent = 'Joy no pudo ayudarte: revisa que no tengas monedas en el Mercado o en una partida.';
      refreshHeal();
    } }, 'Pedir ayuda');
    function refreshHeal() {
      const why = healWhy();
      healBtn.disabled = !!why;
      if (why) healNote.textContent = why;
      else if (!healNote.textContent.startsWith('Joy no pudo')) healNote.textContent = '';
    }
    refreshHeal();
    // Se reevalúa si cambian las monedas (otra pestaña, un regalo) o cuando termina la espera.
    if (this.offHeal) this.offHeal();
    const offMe = bus.on('me', refreshHeal);
    const healTimer = setInterval(refreshHeal, 30000);
    this.offHeal = () => { offMe(); clearInterval(healTimer); };

    const days = h('div', { class: 'streak' }, [1, 2, 3, 4, 5, 6, 7].map((d) => h('span', { class: 'sday' + (d <= (dailyDone ? me.daily.streak : streak - 1) ? ' on' : '') }, d)));

    const pr = me.progress;
    const tut = pr.tutorial;
    const routeBox = tut.done
      ? h('div', { class: 'card route done' }, h('h3', {}, '🎓 Ruta del Entrenador completada'), h('p', { class: 'muted' }, 'Ahora a por las 8 medallas, las colecciones y el Mercado.'), h('a', { class: 'btn', href: '#/trainer' }, '🏅 Mi Entrenador'))
      : h('div', { class: 'card route' },
        h('div', { class: 'row between' }, h('h3', {}, `🧭 Ruta del Entrenador · paso ${tut.index + 1}/${tut.total}`), h('span', { class: 'muted small' }, `Premio: ${rewardText(tut.reward)}`)),
        h('div', { class: 'route-steps' }, Array.from({ length: tut.total }, (_, k) => h('i', { class: k < tut.index ? 'done' : k === tut.index ? 'now' : '' }))),
        h('b', { class: 'route-title' }, tut.title), h('p', {}, tut.desc),
        tut.n > 1 ? hpBar((tut.prog / tut.n) * 100) : null,
        h('a', { class: 'btn primary', href: '#/' + tut.link }, '¡Vamos!'));
    const daily = h('div', { class: 'card' },
      h('h3', {}, '📋 Misiones de hoy'),
      ...pr.daily.missions.map((m) => h('div', { class: 'mission' + (m.done ? ' done' : '') },
        h('span', {}, m.done ? '✅' : '⬜'), h('div', { class: 'grow' }, h('div', {}, m.title), h('div', { class: 'muted small' }, rewardText(m.reward))),
        m.n > 1 ? h('span', { class: 'small' }, `${Math.min(m.prog, m.n)}/${m.n}`) : null)),
      h('div', { class: 'muted small' }, pr.daily.bonus ? '🎁 Bonus diario conseguido' : 'Completa las 3 para un Huevo Misterioso extra.'));
    const badgeStrip = h('a', { class: 'card badge-strip', href: '#/trainer' },
      h('div', { class: 'row between' }, h('h3', {}, `🏅 Medallas ${pr.badges.filter((b) => b.got).length}/8`), h('span', { class: 'muted small' }, `Apuesta máxima ${fmt(me.maxBet)}`)),
      h('div', { class: 'row gap wrap' }, pr.badges.map((b) => badgeImg(b.n, b.got))),
      (() => { const next = pr.badges.find((b) => !b.got); return next ? h('div', { class: 'small' }, `Siguiente: ${next.name} — ${next.req}`) : h('div', { class: 'small good' }, '👑 Campeón de la Liga'); })());
    const buddyCard = h('div', { class: 'card' },
      h('h3', {}, '🤝 Compañero'),
      me.buddy
        ? h('p', {}, h('b', {}, S.dexById.get(me.buddy.id).name + (me.buddy.shiny ? ' ✨' : '')), ` te da +${(me.buddyBonus * 100).toFixed(1)}% en cada ganancia neta (hoy te quedan ${fmt(me.bonusLeft)} de bonus: crece con lo que apuestas y llega como mucho a ${fmt(me.bonusCap)} al día).`)
        : h('p', { class: 'muted' }, 'Elige un compañero en tu Pokédex: aumenta tus ganancias según su rareza y estrellas.'),
      buddyFindBlock(),
      h('div', { class: 'row gap wrap' }, h('a', { class: 'btn', href: '#/pokedex' }, 'Elegir compañero'), h('a', { class: 'btn', href: '#/huerto' }, '🌱 Huerto')));

    if (this.offEv) this.offEv();
    const o1 = bus.on('events', () => this.remount(root));
    const o2 = bus.on('mega', () => this.remount(root));
    const o3 = bus.on('visited', () => { if (S.view === 'lobby') this.remount(root); });
    this.offEv = () => { o1(); o2(); o3(); };

    const buddyArt = me.buddy
      ? aniImg(me.buddy.id, { shiny: me.buddy.shiny, mega: me.buddy.mega || 0, cls: 'home-buddy', alt: S.dexById.get(me.buddy.id)?.name || '', fallback: me.buddy.mega ? art(me.buddy.mega, me.buddy.shiny) : art(me.buddy.id, me.buddy.shiny) })
      : monImg(MON.meowth, 'home-buddy');
    root.append(
      h('div', { class: 'page-head home-head' }, h('h1', {}, `¡Hola, ${me.username}!`), buddyArt),
      oakSay(),
      h('div', { class: 'stack' }, backupReminder(), megaBanner(), eventsCard()),
      h('div', { class: 'home-grid' },
        h('div', { class: 'card home-card' }, h('h3', {}, h('img', { class: 'pixel', src: item('amulet-coin'), alt: '' }), 'Regalo diario'),
          days, h('div', { class: 'home-actions' }, dailyBtn)),
        h('div', { class: 'card home-card' }, h('h3', {}, h('img', { class: 'pixel', src: item('great-ball'), alt: '' }), 'Poké Gacha'),
          h('p', { class: 'muted' }, freeDone ? 'Ya usaste tu tirada gratis de hoy.' : 'Tu tirada gratis de hoy te espera.'),
          h('div', { class: 'home-actions' }, h('a', { class: 'btn primary', href: '#/gacha' }, freeDone ? '🎁 Ir al Gacha' : '🎁 ¡Tirada gratis disponible!'))),
        h('div', { class: 'card home-card' }, h('h3', {}, monImg(MON.chansey, 'chansey-joy'), 'Centro Pokémon'),
          h('p', { class: 'small muted' }, `¿Sin fondos? La enfermera Joy te presta ${fmt(hl.amount)} monedas (una vez cada ${Math.round(hl.cooldown / 3600e3)} h).`),
          h('div', { class: 'home-actions' }, healBtn), healNote)),
      h('h2', { class: 'section-title' }, '¿A dónde vamos?'),
      h('div', { class: 'home-sections' }, SECTIONS.filter((s) => s.id !== 'lobby').map((sec) => h('a', { class: `hub-card tone-${SEC_TONE[sec.id]}`, href: '#/' + sec.id },
        sectionNew(sec) ? h('span', { class: 'new-badge' }, '¡NUEVO!') : null,
        h('span', { class: 'hub-art' }, monImg(SEC_MON[sec.id])),
        h('b', { class: 'hub-name' }, sec.label),
        h('span', { class: 'hub-desc' }, SEC_DESC[sec.id])))),
      h('details', { class: 'more-box' }, h('summary', {}, 'Ver más'),
        h('div', { class: 'more-body' },
          canInstall() && (() => { try { return !localStorage.getItem('installHidden'); } catch { return true; } })() ? h('div', { class: 'card install-card' },
            h('img', { src: '/icons/icon-192.png', alt: '' }),
            h('div', { class: 'grow' }, h('b', {}, 'Instala PokéCasino en tu móvil'), h('div', { class: 'small muted' }, 'Ábrelo desde la pantalla de inicio, como una app.')),
            h('button', { class: 'btn primary', onclick: () => installApp() }, 'Instalar'),
            h('button', { class: 'icon-btn', 'aria-label': 'Ocultar', onclick: (e) => { try { localStorage.setItem('installHidden', '1'); } catch { /* nada */ } e.target.closest('.install-card').remove(); } }, '✕')) : '',
          h('div', { class: 'cards3' }, routeBox, daily, badgeStrip, buddyCard),
          h('h2', { class: 'section-title' }, 'Tus estadísticas'),
          h('div', { class: 'stat-row big' },
            st('Apostado', fmt(me.stats.wagered)), st('Ganado', fmt(me.stats.won)), st('Mayor premio', fmt(me.stats.biggestWin)),
            st('Tiradas gacha', fmt(me.stats.pulls)), st('Pokédex', `${Object.keys(me.collection).length}/${S.data.dex.length}`),
            st('Duelos', `${me.stats.duelsWon}V/${me.stats.duelsLost}D`)))),
      h('div', { class: 'footprints', 'aria-hidden': 'true' }),
    );
  },
  // Solo se repinta si el jugador sigue en el Vestíbulo (las respuestas pueden llegar tarde).
  remount(root) { if (S.view !== 'lobby') return; root.replaceChildren(); this.mount(root); },
  unmount() { if (this.offEv) this.offEv(); this.offEv = null; if (this.offHeal) this.offHeal(); this.offHeal = null; },
};
const st = (l, v) => h('div', { class: 'stat' }, h('span', { class: 'muted small' }, l), h('b', {}, v));

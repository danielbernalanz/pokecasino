// Evento «Megaevolución»: Máquina Mega, Bote, pase de recompensas, fabricar megapiedras, megaevolucionar y ranking.
import { S, h, fmt, act, emit, sfx, toast, item, sprite, bus, sleep, modal, confirmBet, confirmRisk, avatar, titleTag, itemImg, typeBadge } from '../core.js';
import { burst, burstEl, flash, glow, pop, countUp, floatText, confetti, celebrate, vibrate, reduced, centerOf } from '../fx.js';
import { megaEvolve, megaSymbol } from './mega-evo.js';
import { openEgg } from '../rewards.js';
import { updateMegaPill } from '../main.js';

const GLOW = { venusaurite: '#4ade80', 'charizardite-y': '#fb923c', blastoisinite: '#38bdf8', ampharosite: '#facc15', gardevoirite: '#f472b6', gengarite: '#a78bfa', mega: '#7df9ff' };
const symSrc = (s) => (s === 'mega' ? item('mega-ring') : item(s));
// Cada símbolo lleva el color de su tipo para distinguirlos de un vistazo (las megapiedras se parecen mucho).
const symImg = (s) => h('div', { class: 'mg-cell' + (s === 'mega' ? ' is-mega' : ''), style: { '--c': GLOW[s] || '#fff' } }, h('img', { class: 'pixel mg-sym', src: symSrc(s), alt: s === 'mega' ? 'Mega' : s, draggable: 'false' }));
export const stoneImg = (f, cls = '') => {
  const el = h('img', { class: 'pixel ' + cls, src: item(f.stone.replace(/^stone-/, '')), alt: f.stoneName, loading: 'lazy' });
  el.addEventListener('error', () => { el.src = item('mega-ring'); }, { once: true });
  return el;
};
const dhms = (ms) => {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const p = (n) => String(n).padStart(2, '0');
  return `${d ? d + 'd ' : ''}${p(Math.floor(s / 3600) % 24)}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
};
const CFG = () => S.data.mega.cfg;
const prefs = { tab: 'machine' };
const fast = () => { try { return localStorage.getItem('mega:fast') === '1'; } catch { return false; } };

// Elegir una megapiedra de las 90+ (vale de «megapiedra a elegir»).
function stonePicker({ title, onPick }) {
  const q = h('input', { type: 'search', placeholder: 'Buscar Pokémon…', class: 'mg-search' });
  const grid = h('div', { class: 'mg-stones' });
  const m = modal(h('div', { class: 'stack' }, q, grid), { title, wide: true });
  const paint = () => {
    const t = q.value.trim().toLowerCase();
    grid.replaceChildren(...S.data.mega.forms.filter((f) => !t || f.name.toLowerCase().includes(t) || f.stoneName.toLowerCase().includes(t))
      .map((f) => h('button', { class: 'mg-stone', onclick: () => { m.close(); onPick(f); } }, stoneImg(f, 'mg-stone-ico'), h('span', { class: 'mg-stone-n' }, f.stoneName), h('small', {}, f.name))));
  };
  q.addEventListener('input', paint);
  paint();
}

export default {
  id: 'mega', title: 'Megaevolución', icon: '💠',
  mount(root) {
    const T = S.data.mega;
    let D = null;
    let spinning = false;
    let shownFrags = S.me.mega.frags;
    let comboExp = 0;
    let shownBote = S.mega ? S.mega.bote : 0;
    const recent = [];
    const timers = [];
    let skipSpin = false;

    // ---------- Cabecera con cuenta atrás ----------
    const countEl = h('div', { class: 'mg-count' });
    const stateEl = h('div', { class: 'mg-state' });
    const hero = h('section', { class: 'mg-hero' },
      h('div', { class: 'mg-orbs', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')),
      h('div', { class: 'mg-hero-sym' }, megaSymbol('hero')),
      h('div', { class: 'mg-hero-txt' }, h('h1', { class: 'mg-title' }, 'MEGAEVOLUCIÓN'), stateEl, countEl));
    const hourEl = h('div', { class: 'mg-hour hidden' });

    // ---------- Fragmentos, combo y mejoras ----------
    const fragsEl = h('b', { class: 'mg-frags-n' }, fmt(shownFrags));
    const multChip = h('span', { class: 'mg-chip mult' });
    const boostChip = h('span', { class: 'mg-chip boost hidden' });
    const picksChip = h('button', { class: 'mg-chip picks hidden', onclick: () => pickFlow() });
    const comboFill = h('i', { class: 'mg-combo-fill' });
    const comboTxt = h('span', { class: 'mg-combo-txt' }, 'COMBO ×1');
    const combo = h('div', { class: 'mg-combo' }, h('div', { class: 'mg-combo-bar' }, comboFill), comboTxt);
    const craftBar = h('i', {});
    const craftTxt = h('div', { class: 'small' });
    const hud = h('section', { class: 'mg-hud' },
      h('div', { class: 'mg-frags' }, h('span', { class: 'mg-frag-ico' }, '💠'), fragsEl, h('div', { class: 'mg-chips' }, multChip, boostChip, picksChip)),
      combo,
      h('div', { class: 'mg-craftbar' }, h('div', { class: 'mg-bar' }, craftBar), craftTxt));

    // ---------- Pestañas ----------
    const body = h('div', { class: 'mg-body' });
    const tabsEl = h('div', { class: 'mg-tabs', role: 'tablist' });
    const TABS = [['machine', '🎰', 'Máquina'], ['today', '📋', 'Hoy'], ['pass', '🎁', 'Pase'], ['craft', '💠', 'Fabricar'], ['megas', '🧬', 'Megas'], ['rank', '🏆', 'Ranking']];
    const paintTabs = () => tabsEl.replaceChildren(...TABS.map(([id, ico, l]) => h('button', { class: 'mg-tab' + (prefs.tab === id ? ' active' : ''), role: 'tab', onclick: () => { prefs.tab = id; paintTabs(); paintTab(); } }, h('span', {}, ico), h('small', {}, l))));

    root.append(h('div', { class: 'mg' }, hero, hourEl, hud, tabsEl, body));

    // ---------- Reloj ----------
    function tickClock() {
      const st = S.mega;
      if (!st) return;
      const now = Date.now();
      if (st.active) {
        countEl.textContent = dhms(st.endsAt - now);
        stateEl.textContent = 'Termina en';
      } else {
        stateEl.textContent = st.finalized ? 'Evento terminado' : 'Terminando…';
        countEl.textContent = st.nextAt ? `Próxima edición en ${dhms(st.nextAt - now)}` : 'Pregunta al anfitrión por la siguiente';
      }
      if (st.hour && st.hour.e > now) {
        hourEl.classList.remove('hidden');
        hourEl.replaceChildren(h('span', { class: 'mg-hour-bolt' }, '⚡'), h('div', { class: 'grow' }, h('b', {}, '¡HORA MEGA!'), h('div', { class: 'small' }, 'Fragmentos por jugar ×2')), h('b', { class: 'mg-hour-t' }, dhms(st.hour.e - now).replace(/^00:/, '')));
      } else if (!hourEl.classList.contains('hidden')) { hourEl.classList.add('hidden'); hourEl.replaceChildren(); }
      // Combo: la barra se vacía hasta que caduca.
      const mm = S.me.mega;
      const left = Math.max(0, comboExp - now);
      const c = mm.combo;
      const live = left > 0 && c && c.n > 0;
      comboFill.style.width = live ? Math.min(100, (left / T.cfg.comboGap) * 100) + '%' : '0%';
      combo.dataset.tier = live ? String(c.mult) : '1';
      combo.classList.toggle('hot', live && c.mult > 1);
      comboTxt.textContent = live ? `COMBO ×${c.mult} · ${c.n} jugadas seguidas` : 'COMBO ×1 · juega sin pausas de más de 2 min';
    }
    const clock = setInterval(tickClock, 250);
    timers.push(clock);

    // ---------- HUD ----------
    function paintHud(animate = true) {
      const mm = S.me.mega;
      if (mm.frags !== shownFrags) {
        const from = shownFrags;
        shownFrags = mm.frags;
        if (animate && mm.frags > from) { countUp(fragsEl, from, mm.frags, 700); pop(fragsEl, 1.3); glow(hud, '#7df9ff', 800); } else fragsEl.textContent = fmt(mm.frags);
      }
      comboExp = Date.now() + (mm.combo ? mm.combo.ttl : 0);
      const m = mm.mult || 1;
      multChip.textContent = m > 1 ? `×${m} fragmentos` : '';
      multChip.classList.toggle('hidden', m <= 1);
      multChip.classList.toggle('hot', m > 1);
      boostChip.classList.toggle('hidden', !mm.boost);
      if (mm.boost) boostChip.textContent = `⚡ Ráfaga ×${mm.boost.mult} · ${mm.boost.left} jugadas`;
      picksChip.classList.toggle('hidden', !mm.picks);
      picksChip.textContent = `🎟️ ${mm.picks} megapiedra${mm.picks > 1 ? 's' : ''} a elegir`;
      const need = T.cfg.craftCost - mm.frags;
      craftBar.style.width = Math.min(100, (mm.frags / T.cfg.craftCost) * 100) + '%';
      craftTxt.textContent = need > 0 ? `Te faltan ${need} 💠 para fabricar una megapiedra a tu elección` : '¡Ya puedes fabricar una megapiedra! (pestaña Fabricar)';
      hud.classList.toggle('ready', need <= 0);
      tickClock();
    }

    // ---------- Carga ----------
    async function load() {
      const r = await act('mega:state');
      if (!r) return;
      D = r;
      S.mega = r.state;
      paintHud(false);
      paintTab();
    }

    function paintTab() {
      if (!D) { body.replaceChildren(h('p', { class: 'muted' }, 'Cargando…')); return; }
      const f = { machine: machineTab, today: todayTab, pass: passTab, craft: craftTab, megas: megasTab, rank: rankTab }[prefs.tab];
      body.replaceChildren(f());
    }

    // =========================================================================
    // Máquina Mega
    // =========================================================================
    const CELL = 92;
    function machineTab() {
      const st = S.mega;
      const reels = [0, 1, 2].map((i) => {
        const strip = h('div', { class: 'mg-strip' }, symImg(recent.length ? recent[0].triple[i] : T.symbols[(i * 2) % 6]));
        return h('div', { class: 'mg-reel' }, strip);
      });
      const msg = h('div', { class: 'mg-msg' }, st.active ? '¡Gira y consigue megapiedras!' : 'La Máquina está apagada hasta la próxima edición.');
      const boteEl = h('b', { class: 'mg-bote-n' }, fmt(shownBote));
      const boteBar = h('i', { style: { width: Math.min(100, (shownBote / T.cfg.boteMax) * 100) + '%' } });
      const bote = h('div', { class: 'mg-bote' }, h('div', { class: 'mg-bote-lbl' }, '💥 BOTE MEGA'), h('div', { class: 'mg-bote-row' }, h('span', { class: 'coin-ico' }), boteEl),
        h('div', { class: 'mg-bar gold' }, boteBar), h('small', { class: 'muted' }, `Crece con cada giro con monedas (hasta ${fmt(T.cfg.boteMax)}). Toca con 1 de cada 1.000 giros.`));
      const recentEl = h('div', { class: 'mg-recent' });
      const paintRecent = () => recentEl.replaceChildren(...recent.slice(0, 8).map((r) => h('span', { class: 'mg-rc o-' + r.outcome, title: r.name }, r.outcome === 'nada' ? '·' : r.outcome === 'par' ? '2' : r.outcome === 'trio' ? '3' : '💠')));
      paintRecent();
      const bFrag = h('button', { class: 'btn primary big mg-spin', onclick: () => doSpin('frags') }, `GIRAR · ${T.cfg.fragSpin} 💠`);
      const bCoin = h('button', { class: 'btn gold big mg-spin', onclick: () => doSpin('coins') }, h('span', { class: 'coin-ico' }), `GIRAR · ${T.cfg.coinSpin}`);
      const fastBtn = h('button', { class: 'chip' + (fast() ? ' on' : ''), onclick: () => { try { localStorage.setItem('mega:fast', fast() ? '0' : '1'); } catch { /* nada */ } fastBtn.classList.toggle('on', fast()); } }, '⚡ Giro rápido');
      const machine = h('div', { class: 'mg-machine' },
        h('div', { class: 'mg-machine-top' }, h('span', {}, '💠'), h('b', {}, 'MÁQUINA MEGA'), h('span', {}, '💠')),
        h('div', { class: 'mg-reels' }, reels, h('div', { class: 'mg-payline' })),
        msg, recentEl,
        h('div', { class: 'mg-btns' }, bFrag, bCoin),
        h('div', { class: 'row between wrap' }, fastBtn, h('small', { class: 'muted' }, 'Toca la máquina para saltar la animación')));
      const oddsRows = T.outcomes.map((o) => h('tr', {}, h('td', {}, h('b', {}, o.name), h('div', { class: 'small muted' }, o.desc)), h('td', { class: 'num' }, `${o.pct.toLocaleString('es', { maximumFractionDigits: 2 })} %`)));
      const odds = h('details', { class: 'card mg-odds' }, h('summary', {}, '📊 Probabilidades'),
        h('table', {}, h('tbody', {}, oddsRows)),
        h('p', { class: 'small muted' }, `Los resultados los decide el servidor con aleatoriedad criptográfica y son idénticos con fragmentos y con monedas. Los rodillos solo muestran el resultado real: tres símbolos distintos = nada; con un 💠 es Ráfaga; con dos 💠 un objeto; con tres 💠 un premio gordo. Con monedas (${T.cfg.coinSpin}) la mitad se quema y la otra mitad va al Bote Mega: nunca se crean monedas. Los fragmentos que devuelve la máquina no cuentan para el pase ni el ranking.`));

      // ---- Giro ----
      const setBusy = (b) => { spinning = b; bFrag.disabled = b || !S.mega.active || S.me.mega.frags < T.cfg.fragSpin; bCoin.disabled = b || !S.mega.active || S.me.coins < T.cfg.coinSpin; };
      machineTab.refresh = () => { if (!spinning) setBusy(false); };
      setBusy(false);
      machineTab.setBote = (v) => { const from = shownBote; shownBote = v; countUp(boteEl, from, v, 800); boteBar.style.width = Math.min(100, (v / T.cfg.boteMax) * 100) + '%'; if (v > from) pop(boteEl, 1.15); };
      machine.addEventListener('click', (e) => { if (spinning && !e.target.closest('.mg-btns, .chip, .btn')) skipSpin = true; });

      async function doSpin(mode) {
        if (spinning) return;
        if (mode === 'coins' && !(await confirmBet('mega', T.cfg.coinSpin, { what: 'gastar' }))) return;
        setBusy(true);
        skipSpin = fast() || reduced();
        S.megaHold = true;
        let res;
        try { res = await emit('mega:spin', { mode }); } catch (e) { S.megaHold = false; toast(e.message, 'error'); sfx('error'); setBusy(false); return; }
        const sp = res.spin;
        machine.classList.add('spinning');
        msg.className = 'mg-msg';
        msg.textContent = '…';
        await animate(sp);
        machine.classList.remove('spinning');
        recent.unshift(sp);
        recent.length = Math.min(recent.length, 8);
        paintRecent();
        await outcome(sp);
        S.megaHold = false;
        updateMegaPill();
        paintHud();
        if (mode === 'coins' && sp.outcome !== 'bote' && machineTab.setBote) machineTab.setBote(res.bote);
        setBusy(false);
      }

      async function animate(sp) {
        const dur = skipSpin ? [120, 160, 200] : [1500, 2100, 2700];
        const t3 = sp.triple;
        // Anticipación honesta: si los dos primeros rodillos son iguales, el tercero tarda más en frenar.
        const tense = t3[0] === t3[1] && !skipSpin;
        if (tense) dur[2] = 4300;
        const anims = reels.map((r, i) => {
          const strip = r.firstChild;
          const L = 26;
          const cells = [strip.firstChild.cloneNode(true)];
          for (let k = 1; k < L - 1; k++) cells.push(symImg(Math.random() < 0.18 ? 'mega' : T.symbols[Math.floor(Math.random() * T.symbols.length)]));
          cells.push(symImg(t3[i]));
          strip.replaceChildren(...cells);
          r.classList.add('rolling');
          const end = -(L - 1) * CELL;
          return strip.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${end - 10}px)`, offset: 0.93 }, { transform: `translateY(${end}px)` }], { duration: dur[i], easing: 'cubic-bezier(.2,.65,.25,1)', fill: 'forwards' });
        });
        let tick = 0;
        const tk = setInterval(() => { if (!skipSpin) sfx('reel', tick++ % 5); }, 90);
        const done = [];
        for (let i = 0; i < 3; i++) {
          if (i === 2 && tense) {
            reels[2].classList.add('tense');
            machine.classList.add('anticipate');
            sfx('charge', 0); vibrate([40, 60, 40, 60]);
            const hb = setInterval(() => { if (!skipSpin) { sfx('heartbeat'); vibrate(25); } }, 620);
            done.push(hb);
          }
          const a = anims[i];
          await new Promise((res) => {
            const poll = setInterval(() => { if (skipSpin && a.playState === 'running') a.finish(); }, 40);
            a.onfinish = () => { clearInterval(poll); res(); };
            a.oncancel = () => { clearInterval(poll); res(); };
          });
          reels[i].classList.remove('rolling', 'tense');
          sfx('reelstop'); vibrate(15);
          glow(reels[i], GLOW[t3[i]] || '#fff', 400);
          // Los símbolos 💠 ya parados se encienden.
          if (t3[i] === 'mega') reels[i].classList.add('hit');
        }
        done.forEach(clearInterval);
        clearInterval(tk);
        machine.classList.remove('anticipate');
      }

      async function outcome(sp) {
        const o = sp.outcome;
        const p = sp.prize;
        const at = centerOf(machine);
        const set = (t, cls) => { msg.textContent = t; msg.className = 'mg-msg ' + (cls || ''); };
        reels.forEach((r, i) => { if (['par', 'trio'].includes(o) && sp.triple.filter((s) => s === sp.triple[i]).length >= 2) r.classList.add('hit'); });
        if (o === 'nada') { set('Sin premio… ¡la siguiente es la buena!'); sfx('lose'); } else if (o === 'par') {
          set(`¡Pareja! +${p.frags} 💠`, 'ok'); sfx('win'); burstEl(machine, '#7df9ff', 18, { spread: 160, stars: 0.6 }); floatText(`+${p.frags} 💠`, at, { color: '#7df9ff', size: 26 }); vibrate(25);
        } else if (o === 'trio') {
          set(`¡¡TRÍO!! +${p.frags} 💠`, 'big'); sfx('big'); flash('#7df9ff', 450); burstEl(machine, '#7df9ff', 44, { spread: 300, stars: 0.7 }); confetti({ count: 30 }); floatText(`+${p.frags} 💠`, at, { color: '#fff', size: 34 }); vibrate([40, 30, 80]);
        } else if (o === 'rafaga') {
          set(`⚡ ¡RÁFAGA ×${p.boost.mult}! +${p.frags} 💠 y fragmentos ×${p.boost.mult} en ${p.boost.left} jugadas`, 'big'); sfx('levelup'); flash('#facc15', 500); confetti({ count: 45, colors: ['#facc15', '#7df9ff', '#fff'] }); burstEl(machine, '#facc15', 36, { spread: 260 }); vibrate([40, 30, 80, 30, 120]);
        } else if (o === 'ticket' || o === 'huevo') {
          const id = Object.keys(p.items)[0];
          set(`¡${S.data.items[id].name}!`, 'big'); sfx('shiny'); flash('#c084fc', 450); burstEl(machine, '#c084fc', 40, { spread: 260, stars: 0.8 }); vibrate([40, 30, 100]);
          msg.append(' ', h('span', { class: 'mg-prize-ico' }, itemImg(id, 'mini')));
          if (o === 'huevo') msg.append(' ', h('button', { class: 'btn small primary', onclick: (e) => { e.stopPropagation(); openEgg(e.target); } }, 'Abrir ahora'));
        } else if (o === 'supermega') {
          set(`✨ ¡SÚPER MEGA! +${p.frags} 💠`, 'big');
          await celebrate(4, { title: '¡SÚPER MEGA!', subtitle: `+${p.frags} 💠 Megafragmentos`, icon: '💠' });
        } else if (o === 'cosmetico') {
          const c = S.data.cosmetics[p.cosmetic];
          set(`🌟 ¡${c.name}!`, 'big');
          await celebrate(5, { title: c.name.toUpperCase(), subtitle: 'Cosmético exclusivo del evento: equípalo en Mi Entrenador', icon: itemImg(p.cosmetic, 'fx-badge') });
        } else if (o === 'piedra') {
          const f = S.megaByStone.get(p.stone);
          set(`💎 ¡MEGAPIEDRA: ${f.stoneName}!`, 'big');
          await celebrate(5, { title: '¡MEGAPIEDRA!', subtitle: `${f.stoneName} · ${f.name}`, icon: stoneImg(f, 'fx-badge') });
        } else if (o === 'bote') {
          set(`💥 ¡¡BOTE MEGA!! +${fmt(p.bote.coins)} monedas`, 'big');
          shownBote = 0;
          if (machineTab.setBote) machineTab.setBote(0);
          await celebrate('jackpot', { title: '¡¡BOTE MEGA!!', subtitle: 'Y una megapiedra a tu elección', icon: '💥', amount: p.bote.coins });
          S.megaHold = false;
          updateMegaPill();
          await pickFlow(true);
        }
        paintHud();
      }

      const tip = !st.active ? h('div', { class: 'card muted' }, 'El evento no está activo: la Máquina y la fabricación vuelven en la próxima edición. Tus megapiedras siguen siendo tuyas.') : null;
      return h('div', { class: 'stack' }, tip, bote, machine, odds);
    }

    // =========================================================================
    // Hoy: racha de entrada y misiones
    // =========================================================================
    function todayTab() {
      const st = D.streak;
      const pips = T.streak.map((r, i) => h('div', { class: 'mg-pip' + (i < st.n ? ' on' : '') + (i === Math.min(st.n, 6) && !st.today ? ' next' : '') }, h('b', {}, `+${r}`), h('small', {}, `día ${i + 1}`)));
      const btn = h('button', { class: 'btn primary big', disabled: st.today || !S.mega.active, onclick: async (e) => {
        const r = await act('mega:checkin', {}, e.target);
        if (r) { sfx('levelup'); burstEl(e.target, '#7df9ff', 30, { spread: 200, stars: 0.8 }); floatText(`+${r.reward} 💠`, e.target, { color: '#7df9ff', size: 28 }); toast(`Racha de ${r.streak} días: +${r.reward} 💠`, 'success'); await load(); }
      } }, st.today ? 'Entrada de hoy cobrada ✓' : `Entrar hoy: +${st.next} 💠`);
      const used = T.cfg.betCap - S.me.mega.betLeft;
      return h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', {}, '🔥 Racha de entrada'), h('p', { class: 'muted small' }, 'Entra cada día del evento: la racha sube el premio. Si te saltas un día, vuelve a empezar.'), h('div', { class: 'mg-pips' }, pips), btn),
        h('div', { class: 'card' }, h('h3', {}, '📋 Misiones Mega de hoy'),
          D.missions.map((m) => h('div', { class: 'mission' + (m.done ? ' done' : '') }, h('span', {}, m.done ? '✅' : '⬜'),
            h('div', { class: 'grow' }, h('div', {}, m.title), h('div', { class: 'mg-bar mini' }, h('i', { style: { width: (m.prog / m.n) * 100 + '%' } }))), h('b', { class: 'small' }, `${m.prog}/${m.n} · +${m.reward} 💠`))),
          h('div', { class: 'muted small' }, D.missionBonus.got ? `🎁 Bonus de +${D.missionBonus.reward} 💠 conseguido` : `Completa las 3 para +${D.missionBonus.reward} 💠 extra.`)),
        h('div', { class: 'card' }, h('h3', {}, '🎲 Fragmentos por jugar'),
          h('p', { class: 'small' }, `Ganas 1 💠 por cada ${T.cfg.fragPerCoins} monedas apostadas en cualquier juego del casino (no cuentan los duelos ni el póker) y por el Gacha con monedas.`),
          h('div', { class: 'mg-bar' }, h('i', { style: { width: Math.min(100, (used / T.cfg.betCap) * 100) + '%' } })),
          h('div', { class: 'small muted' }, `Hoy: ${used}/${T.cfg.betCap} 💠 (el tope se renueva cada día).`),
          h('ul', { class: 'small mg-list' },
            h('li', {}, h('b', {}, 'Combo: '), `juega con menos de ${T.cfg.comboGap / 60000} min entre partidas: ×1,25 (5 seguidas), ×1,5 (12), ×2 (25).`),
            h('li', {}, h('b', {}, '⚡ Hora Mega: '), `1-2 veces al día, 30 min, sin avisar: ×${T.cfg.hourMult}. Se anuncia con un aviso en directo.`),
            h('li', {}, h('b', {}, 'Ráfaga: '), 'sale en la Máquina y multiplica tus próximas jugadas.'))));
    }

    // =========================================================================
    // Pase de recompensas
    // =========================================================================
    const rewardText = (ms) => [...Object.entries(ms.items || {}).map(([id, n]) => `${n}× ${S.data.items[id].name}`), ms.picks ? `${ms.picks}× megapiedra a elegir` : null].filter(Boolean).join(' + ');
    function passTab() {
      const earned = S.me.mega.earned;
      const top = T.milestones[T.milestones.length - 1].at;
      const next = T.milestones.find((m) => m.at > earned);
      const rows = T.milestones.map((ms, i) => {
        const reached = earned >= ms.at;
        const claimed = D.claimed.includes(i);
        const first = ms.items && Object.keys(ms.items)[0];
        const btn = claimed ? h('span', { class: 'mg-claimed' }, '✓') : h('button', { class: 'btn primary mg-claim', disabled: !reached || !S.mega.active, onclick: async (e) => {
          const at = centerOf(e.target);
          const r = await act('mega:claim', { i }, e.target);
          if (r) {
            sfx('fanfare'); vibrate([60, 40, 120]); flash('#7df9ff', 500); confetti({ count: 50 });
            burst(document.querySelector('.fx-layer') || document.body, ...at, '#7df9ff', 30, { spread: 260, stars: 0.8 });
            toast(`Reclamado: ${rewardText(ms)}`, 'success', 5000);
            await load();
            if (r.picks) pickFlow();
          }
        } }, reached ? '¡Reclamar!' : '🔒');
        return h('div', { class: 'mg-ms' + (reached ? ' lit' : '') + (reached && !claimed ? ' ready' : '') + (claimed ? ' done' : '') },
          h('div', { class: 'mg-ms-at' }, h('b', {}, fmt(ms.at)), h('small', {}, '💠')),
          h('div', { class: 'mg-ms-ico' }, first ? itemImg(first, 'mini') : '🎁'),
          h('div', { class: 'grow' }, h('div', { class: 'mg-ms-t' }, rewardText(ms)), h('div', { class: 'small muted' }, reached ? (claimed ? 'Reclamado' : '¡Conseguido!') : `Te faltan ${fmt(ms.at - earned)} 💠`)),
          btn);
      });
      return h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', {}, '🎁 Pase Mega'),
          h('p', { class: 'small muted' }, 'Los hitos suben con los 💠 que ganas en esta edición (jugando, misiones y racha; los que devuelve la Máquina no cuentan). Lo que no reclames se entrega solo al terminar.'),
          h('div', { class: 'mg-bar big' }, h('i', { style: { width: Math.min(100, (earned / top) * 100) + '%' } })),
          h('div', { class: 'small' }, `${fmt(earned)} / ${fmt(top)} 💠${next ? ` · siguiente hito en ${fmt(next.at - earned)}` : ' · ¡pase completado!'}`)),
        h('div', { class: 'mg-track' }, rows));
    }

    // =========================================================================
    // Fabricar megapiedras
    // =========================================================================
    function craftTab() {
      const q = h('input', { type: 'search', placeholder: 'Buscar Pokémon o megapiedra…', class: 'mg-search' });
      const grid = h('div', { class: 'mg-stones' });
      const megas = new Set(S.me.mega.megas);
      const paint = () => {
        const t = q.value.trim().toLowerCase();
        grid.replaceChildren(...T.forms.filter((f) => !t || f.name.toLowerCase().includes(t) || f.stoneName.toLowerCase().includes(t)).map((f) => {
          const have = S.me.items[f.stone] || 0;
          const unlocked = megas.has(f.formId);
          const owns = !!S.me.collection[f.species];
          return h('button', { class: 'mg-stone' + (unlocked ? ' unlocked' : '') + (have ? ' have' : '') + (owns ? '' : ' nobase'), onclick: () => stoneDialog(f) },
            stoneImg(f, 'mg-stone-ico'), h('span', { class: 'mg-stone-n' }, f.stoneName), h('small', {}, unlocked ? '✓ Desbloqueada' : have ? `🎒 ×${have}` : owns ? f.name : '🔒 sin especie'));
        }));
      };
      q.addEventListener('input', paint);
      paint();
      const need = T.cfg.craftCost - S.me.mega.frags;
      return h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', {}, '💠 Fabricar megapiedras'),
          h('p', { class: 'small' }, `Meta garantizada: con ${T.cfg.craftCost} 💠 fabricas la megapiedra que quieras. ${need > 0 ? `Te faltan ${need} 💠.` : '¡Ya tienes de sobra!'}`),
          h('div', { class: 'mg-bar big' }, h('i', { style: { width: Math.min(100, (S.me.mega.frags / T.cfg.craftCost) * 100) + '%' } })),
          h('p', { class: 'small muted' }, 'Para usar una megapiedra necesitas tener a ese Pokémon en tu colección. También se compran y venden en el Mercado.')),
        q, grid);
    }

    function stoneDialog(f) {
      const have = S.me.items[f.stone] || 0;
      const unlocked = S.me.mega.megas.includes(f.formId);
      const owns = !!S.me.collection[f.species];
      const base = S.dexById.get(f.species);
      const c = h('div', { class: 'stack mg-dlg' },
        h('div', { class: 'mg-dlg-top' }, stoneImg(f, 'mg-dlg-stone'), h('div', {}, h('b', {}, f.stoneName), h('div', { class: 'small muted' }, `${f.name} · ${f.types.map((t) => t).join('/')}`), h('div', { class: 'row gap' }, f.types.map(typeBadge)))),
        h('div', { class: 'mg-dlg-art' }, h('img', { src: art(f.species), alt: base.name, class: 'mg-dlg-base' }), h('span', {}, '➜'), h('img', { src: art(f.formId), alt: f.name, class: 'mg-dlg-mega' })),
        h('div', { class: 'small' }, `Estadísticas base: ${base.stats.reduce((a, b) => a + b, 0)} ➜ ${f.stats.reduce((a, b) => a + b, 0)}`),
        h('div', { class: 'small muted' }, `En tu mochila: ${have}${unlocked ? ' · megaevolución ya desbloqueada' : ''}${owns ? '' : ` · necesitas a ${base.name}`}`));
      const m = modal(c, { title: f.name });
      const craftBtn = h('button', { class: 'btn primary big', disabled: !S.mega.active || S.me.mega.frags < T.cfg.craftCost, onclick: async (e) => {
        const at = centerOf(e.target);
        const r = await act('mega:craft', { stone: f.stone }, e.target);
        if (r) { sfx('megaboom'); vibrate([60, 40, 120]); flash('#7df9ff', 500); burst(document.querySelector('.fx-layer') || document.body, ...at, '#7df9ff', 40, { spread: 300, stars: 0.8 }); toast(`¡Fabricaste ${f.stoneName}!`, 'success'); m.close(); await load(); stoneDialog(f); }
      } }, `Fabricar (${T.cfg.craftCost} 💠)`);
      const useBtn = h('button', { class: 'btn gold big', disabled: !have || unlocked || !owns, onclick: async (e) => { m.close(); await useStone(f, e.target); } }, unlocked ? `✓ ${f.name} ya desbloqueada` : !owns ? `Necesitas a ${base.name}` : `💠 Usar ${f.stoneName}: desbloquear ${f.name}`);
      c.append(h('div', { class: 'stack' }, craftBtn, useBtn, have ? h('a', { class: 'btn small', href: '#/market', onclick: () => { S.marketQuery = f.stoneName; m.close(); } }, 'Vender en el Mercado') : h('a', { class: 'btn small', href: '#/market', onclick: () => { S.marketQuery = f.stoneName; m.close(); } }, 'Buscar en el Mercado')));
    }

    async function useStone(f, btn) {
      const r = await act('mega:use', { stone: f.stone }, btn);
      if (!r) return;
      await load();
      // Si ese Pokémon es tu compañero, megaevoluciona al momento.
      if (S.me.buddy && S.me.buddy.id === f.species) {
        const ok = await act('buddy:mega', { formId: f.formId });
        if (ok) { S.megaHold = false; await megaEvolve({ id: f.species, shiny: S.me.buddy.shiny, form: f.formId }); await load(); return; }
      }
      await celebrate(5, { title: `¡${f.name.toUpperCase()}!`, subtitle: 'Megaevolución desbloqueada. Haz compañero a ese Pokémon y megaevoluciónalo en la pestaña Megas.', icon: itemImg(f.stone, 'fx-badge') });
    }

    // Vale de «megapiedra a elegir».
    async function pickFlow() {
      if (!S.me.mega.picks) return;
      await new Promise((resolve) => stonePicker({ title: '🎟️ Elige tu megapiedra', onPick: async (f) => {
        if (!(await confirmRisk('mega-pick', { title: `¿Elegir ${f.stoneName}?`, text: `Gastarás tu vale de «megapiedra a elegir» en la ${f.stoneName} (${f.name}). No se puede deshacer.`, danger: 'Elegirla', safe: 'Volver', section: 'el evento Megaevolución' }))) return resolve(pickFlow());
        const r = await act('mega:pick', { stone: f.stone });
        if (r) { sfx('fanfare'); confetti({ count: 40 }); toast(`Conseguiste ${f.stoneName}`, 'success'); await load(); }
        resolve();
      } }));
    }

    // =========================================================================
    // Megas: compañero y megaevoluciones desbloqueadas
    // =========================================================================
    function megasTab() {
      const me = S.me;
      const unlocked = me.mega.megas.map((id) => S.megaById.get(id)).filter(Boolean);
      const buddy = me.buddy;
      const bForms = buddy ? unlocked.filter((f) => f.species === buddy.id) : [];
      const evolve = async (f, e) => {
        const r = await act('buddy:mega', { formId: f.formId }, e.target);
        if (r) { S.megaHold = false; await megaEvolve({ id: f.species, shiny: me.buddy.shiny, form: f.formId }); await load(); }
      };
      const mk = (f) => {
        const isBuddy = buddy && buddy.id === f.species;
        const owned = !!me.collection[f.species];
        const on = isBuddy && buddy.mega === f.formId;
        return h('div', { class: 'mg-form' + (on ? ' on' : '') },
          h('img', { src: art(f.formId, false), alt: f.name, loading: 'lazy' }),
          h('b', {}, f.name), h('div', { class: 'row gap' }, f.types.map(typeBadge)),
          on ? h('button', { class: 'btn', onclick: async (e) => { if (await act('buddy:mega', { formId: null }, e.target)) { toast('Tu compañero vuelve a su forma normal', 'info'); load(); } } }, `↩ Volver a ${S.dexById.get(f.species).name} normal`)
            : isBuddy ? h('button', { class: 'btn primary mg-evo', onclick: (e) => evolve(f, e) }, `💠 Megaevolucionar a mi compañero`)
              : h('button', { class: 'btn', disabled: !owned, onclick: async (e) => {
                if (!(await act('buddy:set', { id: f.species, shiny: false }, e.target))) return;
                await evolve(f, e);
              } }, owned ? `💠 Hacer compañero a ${S.dexById.get(f.species).name} y megaevolucionar` : `Te falta ${S.dexById.get(f.species).name}`));
      };
      return h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', {}, '🧬 Tu compañero'),
          buddy ? h('p', { class: 'small' }, `${S.dexById.get(buddy.id).name}${buddy.mega ? ' (Mega activa: +1 % de bonus)' : ''}. ${bForms.length ? 'Tiene megaevolución disponible.' : 'Aún no tiene megaevolución desbloqueada.'}`) : h('p', { class: 'small muted' }, 'No tienes compañero: elígelo en la Pokédex.'),
          h('p', { class: 'small muted' }, 'Un compañero megaevolucionado se ve con su arte Mega en todas partes (barra superior, chat, ranking, mesas) y da un +1 % extra, dentro de los mismos topes diarios.'),
          me.mega.picks ? h('button', { class: 'btn gold', onclick: () => pickFlow() }, `🎟️ Canjear ${me.mega.picks} vale${me.mega.picks > 1 ? 's' : ''} de megapiedra`) : null),
        unlocked.length ? h('div', { class: 'mg-forms' }, unlocked.map(mk)) : h('div', { class: 'card muted' }, 'Todavía no has desbloqueado ninguna megaevolución. Consigue una megapiedra (fabricándola, en la Máquina, en el pase o en el Mercado) y úsala con su Pokémon.'));
    }

    // =========================================================================
    // Ranking
    // =========================================================================
    function rankTab() {
      const rows = D.leaderboard.map((r, i) => h('div', { class: 'rank-row mg-rank r' + (i + 1) }, h('b', { class: 'rk' }, i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1), avatar(r.buddy, r, 'sm'),
        h('div', { class: 'grow' }, h('b', {}, r.username), titleTag(r.title)), h('b', {}, `${fmt(r.value)} 💠`)));
      return h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('h3', {}, '🏆 Ranking de la edición'), h('p', { class: 'small muted' }, `Cuenta los 💠 ganados (no los de la Máquina). Al terminar, con al menos ${S.data.mega.cfg.minRank || 100} 💠, el podio se lleva:`),
          h('ol', { class: 'small mg-list' }, T.podium.map((p, i) => h('li', {}, h('b', {}, ['1.º', '2.º', '3.º'][i] + ': '), p)))),
        rows.length ? h('div', { class: 'card' }, rows) : h('div', { class: 'card muted' }, 'Aún nadie ha ganado fragmentos. ¡Sé el primero!'),
        D.lastPodium && D.lastPodium.length ? h('div', { class: 'card' }, h('h3', {}, 'Podio de la edición terminada'), D.lastPodium.map((w) => h('div', { class: 'small' }, `${w.rank}.º ${w.username} (${fmt(w.value)} 💠)`))) : null);
    }

    // ---------- Suscripciones ----------
    const offs = [
      bus.on('me', () => { if (S.megaHold) return; paintHud(); if (prefs.tab === 'machine') machineTab.refresh && machineTab.refresh(); else if (!spinning && ['pass', 'craft', 'megas', 'today'].includes(prefs.tab) && D && !document.activeElement?.matches?.('input')) paintTab(); }),
      bus.on('mega', () => { if (!spinning) load(); }),
      bus.on('mega:bote', (b) => { if (prefs.tab === 'machine' && !spinning && machineTab.setBote) machineTab.setBote(b.bote); else shownBote = b.bote; }),
      bus.on('mega:hour', () => tickClock()),
    ];
    this.cleanup = () => { offs.forEach((f) => f()); timers.forEach(clearInterval); S.megaHold = false; };

    paintTabs();
    paintHud(false);
    load();
  },
  unmount() { if (this.cleanup) this.cleanup(); },
};

function art(id) { return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`; }
void sprite; void sleep;

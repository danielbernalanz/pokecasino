// Pantalla de combate al estilo Pokémon: campo de batalla, cajas de PS, cuadro de texto con escritura y menú de acciones.
// Recibe líneas del protocolo de Showdown (ver sd-protocol.js) y las ejecuta una a una con pausas y animaciones.
import { S, h, emit, toast, sfx, TYPE_ES, typeBadge, sprite, modal } from './core.js';
import { aniImg } from './anim.js';
import { Protocol, STATUS_ES, STATUS_LONG, STAT_ES, toID } from './sd-protocol.js';

let ES = null;
let ESP = null;
export function loadNames() {
  if (ES) return Promise.resolve(ES);
  return (ESP ||= fetch('/data/sd-es.json').then((r) => r.json()).then((j) => { ES = j; return j; }).catch(() => { ES = { moves: {}, abilities: {}, items: {}, meta: {} }; return ES; }));
}
export const moveEs = (id) => (ES && ES.moves[id]) || id;
export const abilityEs = (id) => (ES && ES.abilities[id]) || id;
export const moveMeta = (id) => { const m = ES && ES.meta[id]; return m ? { type: m[0], cat: m[1], bp: m[2], acc: m[3], pp: m[4] } : null; };
export const CAT = { p: ['Físico', '🗡️'], s: ['Especial', '✨'], x: ['Estado', '🌀'] };

const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const sleepRaw = (ms) => new Promise((r) => setTimeout(r, ms));
const NEEDS_TARGET = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly']);
const GENDER = { M: ['♂', 'gm'], F: ['♀', 'gf'] };
const WEATHER_CLASS = { raindance: 'w-rain', primordialsea: 'w-rain', sunnyday: 'w-sun', desolateland: 'w-sun', sandstorm: 'w-sand', hail: 'w-snow', snowscape: 'w-snow', deltastream: 'w-wind' };
const TYPE_COLOR = { normal: '#c9c5b8', fire: '#ff7a2f', water: '#4fa3ff', electric: '#ffe03a', grass: '#6fd45a', ice: '#9be9f5', fighting: '#d9553a', poison: '#b45fd1', ground: '#d6b25c', flying: '#a9b8ff', psychic: '#ff6fa8', bug: '#a8c534', rock: '#b9a45e', ghost: '#7d62b8', dragon: '#6a5cff', dark: '#6b574a', steel: '#b8c2d1', fairy: '#ffadd6' };

const dexName = (id) => (S.dexById.get(id) || {}).name || '';
const stateOfCondition = (c) => {
  const t = String(c || '').split(' ');
  if (t[0] === '0') return { cur: 0, max: 0, pct: 0, status: '', fnt: true };
  const [a, b] = t[0].split('/').map(Number);
  return { cur: a, max: b || 100, pct: Math.max(0, Math.min(100, (a / (b || 100)) * 100)), status: t[1] && t[1] !== 'fnt' ? t[1] : '', fnt: false };
};
const barClass = (pct) => (pct <= 20 ? 'red' : pct <= 50 ? 'yellow' : 'green');
const detailsSpecies = (d) => String(d || '').split(',')[0];

/** Pantalla de combate. `opts.replay` = sin menú (repetición). */
export class BattleScreen {
  constructor(view, { replay = false, onExit, onRematch } = {}) {
    this.view = view;
    this.replay = replay;
    this.onExit = onExit;
    this.onRematch = onRematch;
    this.me = view.side || 'p1';
    this.foe = this.me === 'p1' ? 'p2' : 'p1';
    this.doubles = view.format === 'doubles';
    this.speed = Number(safeGet('btspeed')) === 2 ? 2 : 1;
    this.queue = [];
    this.running = false;
    this.skip = false;
    this.slots = {};
    this.history = [];
    this.fainted = { p1: 0, p2: 0 };
    this.req = null;
    this.reqChosen = false;
    this.deadline = 0;
    this.over = false;
    this.endInfo = null;
    this.shown = false;
    this.dead = false;
    this.proto = new Protocol({
      me: this.me, names: ES || {}, roster: view.roster, players: { [this.me]: view.you, [this.foe]: view.foe },
      megaName: (id) => ((S.megaById && S.megaById.get(id)) || {}).name || '',
    });
    this.proto.doubles = this.doubles;
    this.build();
  }

  // ---------- DOM ----------
  build() {
    const v = this.view;
    this.turnEl = h('span', { class: 'bt2-turn' }, 'Preparando…');
    this.timerEl = h('span', { class: 'bt2-clock hidden' });
    this.trayFoe = h('span', { class: 'tray foe' });
    this.trayMe = h('span', { class: 'tray me' });
    this.speedBtn = h('button', { class: 'btn small', type: 'button', title: 'Velocidad del texto', onclick: () => this.toggleSpeed() }, this.speed === 2 ? '⏩ x2' : '▶ x1');
    this.bar = h('div', { class: 'bt2-bar' },
      h('div', { class: 'bt2-bar-l' }, this.trayFoe, h('b', { class: 'bt2-foe-name' }, v.foe)),
      h('div', { class: 'bt2-bar-c' }, this.turnEl, this.timerEl),
      h('div', { class: 'bt2-bar-r' }, h('b', {}, v.you), this.trayMe, this.speedBtn,
        h('button', { class: 'btn small', type: 'button', title: 'Registro del combate', onclick: () => this.openLog() }, '📜')));
    this.fieldEl = h('div', { class: 'bf' + (this.doubles ? ' dbl' : ' sgl') });
    this.bg = h('div', { class: 'bf-bg' }, h('div', { class: 'bf-sun' }), h('div', { class: 'bf-hills' }), h('div', { class: 'bf-grass' }));
    this.wx = h('div', { class: 'bf-wx' });
    this.fxLayer = h('div', { class: 'bf-fxl' });
    this.banner = h('div', { class: 'bf-banner' });
    this.fieldEl.append(this.bg, this.wx);
    const keys = this.doubles ? ['p2b', 'p2a', 'p1b', 'p1a'] : ['p2a', 'p1a'];
    for (const k of keys) this.makeSlot(k);
    this.fieldEl.append(this.fxLayer, this.banner);
    this.textEl = h('div', { class: 'bt2-say', role: 'status', 'aria-live': 'polite' });
    this.textBox = h('div', { class: 'bt2-text', onclick: () => { this.skipType = true; } }, this.textEl, h('span', { class: 'bt2-next', 'aria-hidden': 'true' }, '▼'));
    this.menu = h('div', { class: 'bt2-menu' });
    this.root = h('div', { class: 'bt2' + (this.replay ? ' replay' : '') }, this.bar, this.fieldEl, this.textBox, this.menu);
    this.updateTray();
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.refit());
      this.ro.observe(this.fieldEl);
    }
  }

  makeSlot(key) {
    const own = key.startsWith(this.me);
    const plat = h('div', { class: 'plat' });
    const wrap = h('div', { class: 'spr-wrap' });
    const el = h('div', { class: `bf-slot ${own ? 'own' : 'foe'} pos-${key[2]} empty`, 'data-key': key }, plat, wrap);
    const nm = h('b', { class: 'nm' });
    const gd = h('span', { class: 'gd' });
    const lv = h('span', { class: 'lv' });
    const st = h('span', { class: 'stt hidden' });
    const fill = h('i', { class: 'green' });
    const num = h('span', { class: 'num' });
    const bst = h('div', { class: 'bst' });
    const hb = h('div', { class: `hpb ${own ? 'own' : 'foe'} pos-${key[2]} empty`, 'data-key': key },
      h('div', { class: 'hpb-top' }, nm, gd, lv),
      h('div', { class: 'hpb-bar' }, h('span', { class: 'lab' }, 'PS'), h('div', { class: 'track' }, fill)),
      h('div', { class: 'hpb-low' }, st, own ? num : null), bst);
    this.fieldEl.append(el, hb);
    this.slots[key] = { key, own, el, wrap, hb, nm, gd, lv, st, fill, num, bst, img: null, mon: null, hp: null, boosts: {}, status: '' };
  }

  // Sin conexión con el servidor (p. ej. el casino se está actualizando): el combate sigue guardado y se retoma solo.
  setOffline(on) {
    this.offline = on;
    this.root.classList.toggle('offline', on);
    if (on) this.menu.replaceChildren(h('div', { class: 'bt2-wait' }, h('span', { class: 'dots' }, ''), 'Reconectando al combate…'));
  }

  // ---------- Utilidades ----------
  sleep(ms) { return this.skip || this.dead ? Promise.resolve() : sleepRaw(ms / this.speed); }
  toggleSpeed() {
    this.speed = this.speed === 2 ? 1 : 2;
    safeSet('btspeed', String(this.speed));
    this.speedBtn.textContent = this.speed === 2 ? '⏩ x2' : '▶ x1';
  }
  destroy() {
    this.dead = true;
    clearInterval(this.clock);
    if (this.ro) this.ro.disconnect();
  }
  slotOf(key) { return key ? this.slots[key] : null; }

  fitImg(sl) {
    const img = sl.img;
    if (!img) return;
    const W = this.fieldEl.clientWidth || 360;
    const own = sl.own;
    const isGif = /\.gif/i.test(img.currentSrc || img.src);
    const k = (this.doubles ? (own ? 0.6 : 0.72) : 1) * (own ? 1 : 0.86);
    let w;
    if (isGif && img.naturalWidth) w = img.naturalWidth * (W / 300) * (own ? 1.55 : 1.25) * k;
    else w = W * (own ? 0.36 : 0.27) * k;
    w = Math.max(W * 0.12, Math.min(W * (own ? 0.5 : 0.36), w));
    img.style.width = Math.round(w) + 'px';
    img.style.height = 'auto';
  }
  refit() { for (const sl of Object.values(this.slots)) if (sl.img) this.fitImg(sl); }

  spriteFor(mon, own) {
    const img = aniImg(mon.id, { shiny: mon.shiny, back: own, mega: mon.mega || 0, cls: 'mon-img pixel', alt: mon.name });
    img.loading = 'eager';
    img.addEventListener('load', () => this.fitImg(this.slotOf(mon.key)));
    return img;
  }

  updateTray() {
    const mk = (side, el) => {
      const n = this.view.pickN || (this.view.roster[side] || []).length;
      const f = this.fainted[side];
      el.replaceChildren(...Array.from({ length: n }, (_, i) => h('i', { class: i < n - f ? 'ball' : 'ball off' })));
    };
    mk(this.foe, this.trayFoe);
    mk(this.me, this.trayMe);
  }

  // ---------- Texto ----------
  async say(text, hold = 520) {
    if (!text || this.dead) return;
    this.history.push(text);
    if (this.history.length > 400) this.history.shift();
    this.textBox.classList.remove('wait');
    if (this.skip || reduced()) { this.textEl.textContent = text; await this.sleep(hold * 0.6); return; }
    this.textEl.textContent = '';
    this.skipType = false;
    const per = 16 / this.speed;
    for (let i = 1; i <= text.length; i++) {
      if (this.skipType || this.skip || this.dead) break;
      this.textEl.textContent = text.slice(0, i);
      await sleepRaw(per);
    }
    this.textEl.textContent = text;
    await this.sleep(hold);
  }
  openLog() {
    const body = h('div', { class: 'bt2-logmodal' }, this.history.length ? this.history.map((t) => h('p', {}, t)) : h('p', { class: 'muted' }, 'Aún no ha pasado nada.'));
    const m = modal(body, { title: '📜 Registro del combate' });
    setTimeout(() => { const el = m.el.querySelector('.bt2-logmodal'); if (el) el.scrollTop = el.scrollHeight; }, 0);
  }

  // ---------- Entrada ----------
  /** Procesa líneas del protocolo (lote del servidor). */
  feed(lines, { instant = false } = {}) {
    const evs = [];
    for (const line of lines) {
      if (line.startsWith('|error|')) { evs.push({ k: 'error', msg: line.slice(7) }); continue; }
      evs.push(...this.proto.parse(line));
    }
    for (const e of evs) { if (instant) e.instant = true; this.queue.push(e); }
    this.pump();
  }
  setRequest(req, { chosen = false, deadline = 0 } = {}) {
    this.req = req || null;
    this.reqChosen = chosen;
    this.deadline = deadline || 0;
    this.startClock();
    if (!this.running) this.renderMenu();
    else this.menu.replaceChildren();
  }
  end(info) {
    this.endInfo = info;
    this.over = true;
    this.startClock();
    if (!this.running && !this.queue.length) this.showEnd();
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.dead) {
        const e = this.queue.shift();
        const fast = e.instant === true;
        const prev = this.skip;
        if (fast) this.skip = true;
        try { await this.exec(e); } catch (err) { console.error('combate', err); }
        this.skip = prev;
      }
    } finally {
      this.running = false;
    }
    if (this.dead) return;
    if (this.over && this.endInfo) this.showEnd();
    else if (!this.over) this.renderMenu();
  }

  // ---------- Ejecución de eventos ----------
  async exec(e) {
    switch (e.k) {
      case 'start': await this.say(e.msg, 700); break;
      case 'turn': this.turnEl.textContent = `Turno ${e.n}`; this.menu.replaceChildren(); break;
      case 'switch': await this.doSwitch(e); break;
      case 'move': await this.doMove(e); break;
      case 'hp': await this.doHp(e); break;
      case 'faint': await this.doFaint(e); break;
      case 'status': await this.doStatus(e); break;
      case 'boost': await this.doBoost(e); break;
      case 'forme': await this.doForme(e); break;
      case 'effect': await this.doEffect(e); break;
      case 'weather': this.setWeather(e.weather); if (e.msg) await this.say(e.msg, 420); break;
      case 'field': this.setField(e); if (e.msg) await this.say(e.msg, 420); break;
      case 'win': await this.doWin(e); break;
      case 'ability': { const sl = this.slotOf(e.slot); if (sl) this.pulse(sl.hb); await this.say(e.msg, 420); break; }
      case 'error': {
        const t = String(e.msg || '').replace(/^\[[^\]]*\]\s*/, '');
        toast('No se puede hacer eso' + (t ? ': ' + translateError(t) : '.'), 'error');
        sfx('error');
        this.reqChosen = false;
        break;
      }
      case 'msg': {
        if (e.mega) await this.megaFlash(e.slot);
        if (e.msg) await this.say(e.msg, e.warn ? 900 : 480);
        break;
      }
      default: break;
    }
  }

  async doSwitch(e) {
    const sl = this.slotOf(e.slot);
    if (!sl) return;
    const first = !sl.mon;
    if (!first && sl.img && !e.drag && !sl.fainted) {
      // El anterior vuelve a su Poké Ball.
      if (!this.skip && !reduced()) { sl.wrap.classList.add('recall'); await this.sleep(280); sl.wrap.classList.remove('recall'); }
    }
    sl.fainted = false;
    sl.mon = e.mon;
    sl.boosts = {};
    sl.status = '';
    sl.wrap.replaceChildren();
    sl.img = this.spriteFor(e.mon, sl.own);
    sl.wrap.append(sl.img);
    sl.el.classList.remove('empty', 'down');
    sl.hb.classList.remove('empty');
    sl.nm.textContent = e.mon.name + (e.mon.shiny ? ' ✨' : '');
    const g = GENDER[e.mon.gender];
    sl.gd.textContent = g ? g[0] : '';
    sl.gd.className = 'gd ' + (g ? g[1] : '');
    sl.lv.textContent = `Nv${e.mon.level}`;
    this.paintHp(sl, e.hp, true);
    this.paintStatus(sl, e.hp.status);
    this.paintBoosts(sl);
    if (!this.skip && !reduced()) { sl.wrap.classList.add('enter'); this.ball(sl); }
    if (e.msg) await this.say(e.msg, 520);
    sl.wrap.classList.remove('enter');
  }

  ball(sl) {
    const r = sl.el.getBoundingClientRect();
    const f = this.fieldEl.getBoundingClientRect();
    const d = h('div', { class: 'burst-ball', style: { left: (r.left - f.left + r.width / 2) + 'px', top: (r.top - f.top + r.height * 0.5) + 'px' } });
    this.fxLayer.append(d);
    setTimeout(() => d.remove(), 700);
    sfx('click');
  }

  paintHp(sl, hp, instant = false) {
    sl.hp = hp;
    const set = () => {
      sl.fill.style.width = hp.pct + '%';
      sl.fill.className = barClass(hp.pct);
    };
    if (instant) { sl.fill.style.transition = 'none'; set(); void sl.fill.offsetWidth; sl.fill.style.transition = ''; } else set();
    if (sl.own) sl.num.textContent = hp.max ? `${hp.cur}/${hp.max}` : '';
    sl.hb.classList.toggle('low', hp.pct <= 20 && hp.pct > 0);
  }
  paintStatus(sl, status) {
    sl.status = status || '';
    sl.st.textContent = STATUS_ES[status] || '';
    sl.st.className = 'stt' + (status ? ' s-' + status : ' hidden');
    sl.st.title = STATUS_LONG[status] || '';
    sl.img && sl.img.classList.toggle('slp', status === 'slp');
  }
  paintBoosts(sl) {
    const chips = Object.entries(sl.boosts).filter(([, n]) => n).map(([s, n]) => h('span', { class: 'bc ' + (n > 0 ? 'up' : 'dn'), title: `${STAT_ES[s] || s} ${n > 0 ? '+' : ''}${n}` }, `${(STAT_ES[s] || s).slice(0, 3)} ${n > 0 ? '+' : ''}${n}`));
    sl.bst.replaceChildren(...chips);
  }

  pulse(el) { if (!el || this.skip || reduced()) return; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); }

  async doMove(e) {
    const at = this.slotOf(e.slot);
    const tg = this.slotOf(e.target);
    const meta = moveMeta(e.moveId);
    if (at && at.mon) at.mon.lastMove = e.moveId;
    const anim = !this.skip && !reduced();
    const textP = this.say(e.msg, 280);
    if (anim && at && at.img) {
      const dir = at.own ? 'up' : 'down';
      if (!meta || meta.cat === 'p') {
        at.wrap.classList.add('lunge-' + dir);
        await sleepRaw(210 / this.speed);
        at.wrap.classList.remove('lunge-' + dir);
      } else {
        at.wrap.classList.add('cast');
        this.cast(at, meta, tg);
        await sleepRaw(260 / this.speed);
        at.wrap.classList.remove('cast');
      }
    }
    await textP;
    this.pendingMove = { type: meta ? meta.type : 'normal', cat: meta ? meta.cat : 'p', target: e.target, slot: e.slot };
    if (anim && tg && tg.img && meta && meta.cat !== 'x' && tg !== at) this.cast(tg, meta, null, true);
  }

  // Destello del color del tipo sobre el objetivo (o sobre el lanzador en movimientos de estado).
  cast(sl, meta, tg, onTarget = false) {
    const col = TYPE_COLOR[(meta && meta.type) || 'normal'] || '#fff';
    const r = sl.el.getBoundingClientRect();
    const f = this.fieldEl.getBoundingClientRect();
    const cx = r.left - f.left + r.width / 2;
    const cy = r.top - f.top + r.height * 0.45;
    const d = h('div', { class: 'fx-pulse' + (onTarget ? ' hit' : ''), style: { left: cx + 'px', top: cy + 'px', '--c': col } });
    this.fxLayer.append(d);
    setTimeout(() => d.remove(), 700);
    if (tg && tg.img) {
      const t = tg.el.getBoundingClientRect();
      const bolt = h('div', { class: 'fx-shot', style: { left: cx + 'px', top: cy + 'px', '--c': col, '--dx': (t.left - r.left) + 'px', '--dy': (t.top - r.top) + 'px' } });
      this.fxLayer.append(bolt);
      setTimeout(() => bolt.remove(), 520);
    }
  }

  async doEffect(e) {
    const sl = this.slotOf(e.slot);
    if (sl && !this.skip && !reduced()) {
      if (e.kind === 'miss') { sl.wrap.classList.add('dodge'); setTimeout(() => sl.wrap.classList.remove('dodge'), 450); }
      if (e.kind === 'crit') this.flash();
      if (e.kind === 'super') sfx('boom');
    }
    await this.say(e.msg, 420);
  }

  flash() {
    this.fieldEl.classList.remove('flash');
    void this.fieldEl.offsetWidth;
    this.fieldEl.classList.add('flash');
  }

  async doHp(e) {
    const sl = this.slotOf(e.slot);
    if (!sl) return;
    const prev = sl.hp;
    const anim = !this.skip && !reduced();
    if (e.kind === 'damage' && anim && sl.img) {
      sl.wrap.classList.add('hit');
      this.float(sl, sl.own && prev && e.hp.max ? `-${Math.max(0, prev.cur - e.hp.cur)}` : `-${Math.max(0, Math.round((prev ? prev.pct : 100) - e.hp.pct))}%`, 'dmg');
      sfx('flip');
    } else if (e.kind === 'heal' && anim) this.float(sl, '+', 'heal');
    this.paintHp(sl, { ...e.hp, status: sl.status });
    if (e.hp.status && e.hp.status !== sl.status) this.paintStatus(sl, e.hp.status);
    if (anim) await sleepRaw(680 / this.speed);
    sl.wrap.classList.remove('hit');
    if (e.msg) await this.say(e.msg, 420);
  }
  float(sl, text, cls) {
    if (!text || text === '+') { if (cls === 'heal') text = '＋'; else return; }
    const r = sl.el.getBoundingClientRect();
    const f = this.fieldEl.getBoundingClientRect();
    const d = h('div', { class: 'fx-float ' + cls, style: { left: (r.left - f.left + r.width / 2) + 'px', top: (r.top - f.top + r.height * 0.2) + 'px' } }, text);
    this.fxLayer.append(d);
    setTimeout(() => d.remove(), 1000);
  }

  async doFaint(e) {
    const sl = this.slotOf(e.slot);
    if (sl) {
      this.fainted[sl.own ? this.me : this.foe]++;
      this.updateTray();
      sl.fainted = true;
      this.paintHp(sl, { cur: 0, max: sl.hp ? sl.hp.max : 0, pct: 0, status: '' });
      this.paintStatus(sl, '');
      sl.el.classList.add('down');
      if (!this.skip && !reduced()) { sfx('lose'); await sleepRaw(500 / this.speed); }
      sl.hb.classList.add('empty');
    }
    await this.say(e.msg, 560);
  }

  async doStatus(e) {
    const sl = this.slotOf(e.slot);
    if (sl) { this.paintStatus(sl, e.status); this.pulse(sl.hb); if (e.status && !this.skip && !reduced()) { sl.wrap.classList.add('status-flash', 'sf-' + e.status); setTimeout(() => sl.wrap.classList.remove('status-flash', 'sf-' + e.status), 700); } }
    if (e.msg) await this.say(e.msg, 480);
  }

  async doBoost(e) {
    const sl = this.slotOf(e.slot);
    if (sl) {
      sl.boosts[e.stat] = Math.max(-6, Math.min(6, (sl.boosts[e.stat] || 0) + e.delta));
      this.paintBoosts(sl);
      if (!this.skip && !reduced() && e.delta) {
        const d = h('div', { class: 'fx-arrow ' + (e.delta > 0 ? 'up' : 'dn') }, e.delta > 0 ? '▲' : '▼');
        sl.el.append(d);
        setTimeout(() => d.remove(), 900);
      }
    }
    if (e.msg) await this.say(e.msg, 480);
  }

  async doForme(e) {
    const sl = this.slotOf(e.slot);
    if (!sl || !sl.mon) return;
    sl.mon.mega = e.mega || 0;
    sl.mon.species = e.species;
    if (e.mega || /-Mega/i.test(e.species)) {
      sl.wrap.replaceChildren();
      sl.img = this.spriteFor(sl.mon, sl.own);
      sl.wrap.append(sl.img);
      sl.nm.textContent = '💠 ' + sl.mon.name;
      if (!this.skip) { this.flash(); sfx('sparkle'); }
    }
  }

  async megaFlash(slot) {
    const sl = this.slotOf(slot);
    if (sl && !this.skip && !reduced()) {
      this.pulse(sl.hb);
      sl.wrap.classList.add('mega-glow');
      setTimeout(() => sl.wrap.classList.remove('mega-glow'), 1300);
      sfx('levelup');
    }
  }

  setWeather(w) {
    for (const c of Object.values(WEATHER_CLASS)) this.fieldEl.classList.remove(c);
    if (WEATHER_CLASS[w]) this.fieldEl.classList.add(WEATHER_CLASS[w]);
  }
  setField(e) {
    const map = { electricterrain: 'f-electric', grassyterrain: 'f-grassy', mistyterrain: 'f-misty', psychicterrain: 'f-psychic', trickroom: 'f-trick' };
    const c = map[e.field];
    if (c) this.fieldEl.classList.toggle(c, e.on);
  }

  async doWin(e) {
    this.turnEl.textContent = 'Fin del combate';
    this.over = true;
    this.menu.replaceChildren();
    clearInterval(this.clock);
    this.timerEl.classList.add('hidden');
    await this.say(e.msg, 900);
    if (e.winner === null) { this.banner.textContent = 'EMPATE'; this.banner.className = 'bf-banner show'; } else if (this.replay) { this.banner.textContent = `¡Gana ${e.winner}!`; this.banner.className = 'bf-banner show win'; } else if (e.you) { sfx('big'); this.banner.textContent = '¡VICTORIA!'; this.banner.className = 'bf-banner show win'; } else { this.banner.textContent = 'DERROTA'; this.banner.className = 'bf-banner show lose'; }
    await this.sleep(900);
  }

  // ---------- Reloj ----------
  startClock() {
    clearInterval(this.clock);
    const tick = () => {
      if (this.dead) return;
      const left = Math.ceil((this.deadline - Date.now()) / 1000);
      if (!this.deadline || this.reqChosen || this.over || !this.req || this.req.wait || left < 0) { this.timerEl.classList.add('hidden'); return; }
      this.timerEl.classList.remove('hidden');
      this.timerEl.textContent = `⏱ ${left}s`;
      this.timerEl.classList.toggle('hurry', left <= 10);
    };
    tick();
    this.clock = setInterval(tick, 500);
  }

  // ---------- Fin ----------
  showEnd() {
    if (this.shownEnd) return;
    this.shownEnd = true;
    const i = this.endInfo || {};
    const you = i.winner === 'you';
    const tie = i.winner === 'tie';
    const parts = [];
    if (i.aborted) parts.push(h('p', {}, i.text || 'El combate se interrumpió.'));
    if (i.trainer && you) parts.push(h('p', { class: 'muted small' }, `«${i.trainer.quote}»`));
    if (i.reward) {
      const r = i.reward;
      if (r.capped) parts.push(h('p', { class: 'muted' }, 'Hoy ya has cobrado el máximo de victorias premiadas. ¡Vuelve mañana!'));
      else {
        parts.push(h('div', { class: 'bt2-rewards' },
          h('span', { class: 'rw' }, `🪙 +${r.coins}`),
          r.candy.length ? h('span', { class: 'rw' }, `🍬 +2 de ${r.candy.slice(0, 3).join(', ')}${r.candy.length > 3 ? '…' : ''}`) : null,
          r.friend ? h('span', { class: 'rw' }, `💗 +${r.friend} amistad`) : null,
          ...Object.entries(r.mats || {}).map(([id, q]) => h('span', { class: 'rw' }, `🧩 +${q} ${(S.data.items[id] || {}).name || id}`)),
          r.bp ? h('span', { class: 'rw' }, `🎖️ +${r.bp} PB`) : null,
          r.tm ? h('span', { class: 'rw' }, `💿 ¡${(S.data.items[r.tm] || {}).name || r.tm}!`) : null,
          h('span', { class: 'rw muted' }, `Premios de hoy: te quedan ${r.winsLeft}`)));
      }
    }
    if (i.bp) parts.push(h('p', {}, `🎖️ +${i.bp} PB (Puntos de Batalla)`));
    if (i.wager) {
      parts.push(h('p', {}, you ? `Has ganado ${(i.prize || 0).toLocaleString('es-ES')} monedas (apuesta ${i.wager.toLocaleString('es-ES')} cada uno, comisión del 5 %).` : tie ? 'Empate: se te devuelve la apuesta.' : `Has perdido ${i.wager.toLocaleString('es-ES')} monedas.`));
    }
    if (i.forfeited) parts.push(h('p', { class: 'muted small' }, 'Perdiste por rendirte o por inactividad.'));
    this.menu.replaceChildren(h('div', { class: 'bt2-end' },
      h('h2', { class: you ? 'good' : tie ? '' : 'bad' }, i.aborted ? 'Combate interrumpido' : you ? '🏆 ¡Has ganado!' : tie ? '🤝 Empate' : 'Has perdido'),
      ...parts,
      h('div', { class: 'row gap wrap bt2-end-actions' },
        this.onRematch ? h('button', { class: 'btn primary', type: 'button', onclick: () => this.onRematch() }, '🔁 Revancha') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => this.openLog() }, '📜 Registro'),
        h('button', { class: 'btn gold', type: 'button', onclick: () => this.onExit && this.onExit() }, 'Volver al menú'))));
  }

  // ---------- Menú de acciones ----------
  renderMenu() {
    if (this.dead || this.replay || this.offline) return;
    const req = this.req;
    if (this.over) return;
    if (!req) { this.menu.replaceChildren(h('div', { class: 'bt2-wait' }, 'Esperando…')); return; }
    if (req.wait || this.reqChosen) {
      this.menu.replaceChildren(h('div', { class: 'bt2-wait' }, h('span', { class: 'dots' }, ''), this.reqChosen ? 'Esperando al rival…' : 'Esperando al rival…',
        this.forfeitButton()));
      return;
    }
    if (req.teamPreview) return this.menuPreview(req);
    if (req.forceSwitch) return this.menuForced(req);
    if (req.active) return this.menuActions(req);
    this.menu.replaceChildren();
  }

  forfeitButton() {
    return h('button', { class: 'btn small danger', type: 'button', onclick: () => this.confirmForfeit() }, '🏳️ Rendirse');
  }
  async confirmForfeit() {
    const m = modal(h('div', { class: 'stack' }, h('p', {}, '¿Seguro que quieres rendirte? Contará como derrota (y perderás la apuesta si la hay).'),
      h('div', { class: 'row gap' }, h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Seguir luchando'),
        h('button', { class: 'btn danger', type: 'button', onclick: async () => { m.close(); try { await emit('battle:forfeit', { id: this.view.id }); } catch (err) { toast(err.message, 'error'); } } }, 'Rendirme'))), { title: 'Rendirse' });
  }

  async send(choice) {
    this.menu.replaceChildren(h('div', { class: 'bt2-wait' }, 'Enviando…'));
    try {
      await emit('battle:choose', { id: this.view.id, choice });
      this.reqChosen = true;
      this.renderMenu();
    } catch (e) {
      toast(e.message, 'error');
      this.renderMenu();
    }
  }

  partyCard(p, i, { disabled = false, onPick, tag } = {}) {
    const st = stateOfCondition(p.condition);
    const sp = detailsSpecies(p.details);
    const mon = this.guessMon(p);
    return h('button', { class: 'pty' + (disabled ? ' off' : '') + (st.fnt ? ' fnt' : ''), type: 'button', disabled, onclick: () => onPick && onPick(i) },
      mon ? h('img', { class: 'pixel', src: sprite(mon.id, mon.shiny), alt: '' }) : h('span', { class: 'ph' }, sp.slice(0, 2)),
      h('span', { class: 'pty-t' }, h('b', {}, p.ident.replace(/^p\d: /, '')), h('span', { class: 'small muted' }, `${/L(\d+)/.exec(p.details) ? 'Nv' + /L(\d+)/.exec(p.details)[1] : ''}${tag ? ' · ' + tag : ''}`)),
      h('span', { class: 'pty-hp' }, h('i', { class: barClass(st.pct), style: { width: st.pct + '%' } })),
      st.status ? h('span', { class: 'stt s-' + st.status }, STATUS_ES[st.status]) : null,
      h('span', { class: 'small hpn' }, st.fnt ? 'Debilitado' : `${st.cur}/${st.max}`));
  }
  guessMon(p) {
    const name = p.ident.replace(/^p\d: /, '');
    const r = (this.view.roster[this.me] || []).find((x) => x.name === name);
    return r ? { id: r.id, shiny: r.shiny } : null;
  }

  menuPreview(req) {
    const mine = req.side.pokemon;
    const need = req.maxChosenTeamSize || mine.length;
    const picked = [];
    const foeRoster = this.view.roster[this.foe] || [];
    const info = h('div', { class: 'bt2-pv-t' });
    const grid = h('div', { class: 'pty-grid' });
    const go = h('button', { class: 'btn primary big', type: 'button' }, '¡Listo!');
    const render = () => {
      info.textContent = need >= mine.length ? 'Elige el orden: el primero sale al combate' + (this.doubles ? ' (los dos primeros)' : '') + '.' : `Elige ${need} Pokémon (${picked.length}/${need}). Los ${this.doubles ? 'dos primeros' : 'primero'} salen al combate.`;
      grid.replaceChildren(...mine.map((p, i) => {
        const at = picked.indexOf(i);
        return this.partyCard(p, i, { tag: at >= 0 ? `#${at + 1}` : '', disabled: false, onPick: (ix) => {
          const k = picked.indexOf(ix);
          if (k >= 0) picked.splice(k, 1); else if (picked.length < need) picked.push(ix);
          render();
        } });
      }));
      grid.querySelectorAll('.pty').forEach((b, i) => b.classList.toggle('sel', picked.includes(i)));
      go.disabled = picked.length !== need;
    };
    go.addEventListener('click', () => this.send('team ' + picked.map((i) => i + 1).join('')));
    const auto = h('button', { class: 'btn', type: 'button', onclick: () => { picked.length = 0; for (let i = 0; i < Math.min(need, mine.length); i++) picked.push(i); render(); } }, 'Orden actual');
    const foes = h('div', { class: 'bt2-pv-foes' }, h('span', { class: 'small muted' }, 'Rival:'), ...foeRoster.map((r) => h('img', { class: 'pixel', src: sprite(r.id, r.shiny), alt: '', title: dexName(r.id) })));
    this.menu.replaceChildren(h('div', { class: 'bt2-pv' }, foes, info, grid, h('div', { class: 'row gap wrap' }, auto, go, this.forfeitButton())));
    render();
    // Pantalla de vista previa en el campo.
    if (!this.shown) { this.shown = true; this.say(`¡${this.view.foe} quiere combatir!`, 200); }
  }

  menuForced(req) {
    const mine = req.side.pokemon;
    const need = req.forceSwitch;
    const chosen = [];
    const slotsNeeded = need.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
    const title = h('div', { class: 'bt2-pv-t' });
    const grid = h('div', { class: 'pty-grid' });
    const render = () => {
      const idx = chosen.length;
      title.textContent = slotsNeeded.length > 1 ? `Elige el relevo ${idx + 1} de ${slotsNeeded.length}` : '¿Qué Pokémon sale ahora?';
      grid.replaceChildren(...mine.map((p, i) => {
        const st = stateOfCondition(p.condition);
        const dis = p.active || st.fnt || chosen.some((c) => c.i === i);
        return this.partyCard(p, i, { disabled: dis, onPick: (ix) => {
          chosen.push({ i: ix });
          if (chosen.length >= slotsNeeded.length || !mine.some((q, j) => !q.active && !stateOfCondition(q.condition).fnt && !chosen.some((c) => c.i === j))) {
            const parts = need.map((n) => (n && chosen.length ? `switch ${chosen.shift().i + 1}` : 'pass'));
            this.send(parts.join(', '));
          } else render();
        } });
      }));
    };
    this.menu.replaceChildren(h('div', { class: 'bt2-pv' }, title, grid, h('div', { class: 'row gap' }, this.forfeitButton())));
    render();
  }

  menuActions(req) {
    const mine = req.side.pokemon;
    const actives = mine.map((p, i) => ({ p, i })).filter((x) => x.p.active);
    const picks = []; // 'move 1 2' | 'switch 3' | 'pass'
    const taken = new Set(); // relevos ya elegidos por otro compañero
    let megaUsed = false;
    const step = (s) => {
      if (s >= req.active.length) return this.send(picks.join(', '));
      const act = req.active[s];
      const me = actives[s];
      if (!act || !me || stateOfCondition(me.p.condition).fnt) { picks[s] = 'pass'; return step(s + 1); }
      const name = me.p.ident.replace(/^p\d: /, '');
      // Interruptor de Megaevolución: un botón grande que cambia de estado (antes era una casilla pequeña).
      const mega = { checked: false };
      const megaBtn = h('button', { class: 'mega-btn', type: 'button', 'aria-pressed': 'false', onclick: () => {
        mega.checked = !mega.checked;
        megaBtn.classList.toggle('on', mega.checked);
        megaBtn.setAttribute('aria-pressed', String(mega.checked));
        megaLbl.textContent = mega.checked ? `¡${name} megaevolucionará este turno!` : `Megaevolucionar a ${name}`;
        megaSub.textContent = mega.checked ? 'Ahora elige el movimiento · toca para cancelar' : 'Actívalo y luego elige un movimiento';
      } });
      const megaLbl = h('b', {});
      const megaSub = h('small', {});
      const canMega = !!act.canMegaEvo && !megaUsed;
      const head = h('div', { class: 'bt2-ask' }, h('b', {}, `¿Qué hará ${name}?`), req.active.length > 1 ? h('span', { class: 'muted small' }, ` (Pokémon ${s + 1} de ${req.active.length})`) : null);
      const moves = h('div', { class: 'mv-grid' }, act.moves.map((mv, mi) => {
        const meta = moveMeta(mv.id) || { type: 'normal', cat: 'p', bp: 0, acc: 0, pp: mv.maxpp };
        const dis = mv.disabled || mv.pp === 0;
        return h('button', { class: `mv t-${meta.type}`, type: 'button', disabled: dis, onclick: () => {
          const tk = mv.target || 'normal';
          const mg = canMega && mega.checked ? ' mega' : '';
          const done = (t) => { if (canMega && mega.checked) megaUsed = true; picks[s] = `move ${mi + 1}${t !== null ? ' ' + t : ''}${mg}`; step(s + 1); };
          if (this.doubles && NEEDS_TARGET.has(tk)) this.askTarget(s, tk, mv, done, () => step(s));
          else done(null);
        } },
        h('span', { class: 'mv-n' }, moveEs(mv.id) || mv.move),
        h('span', { class: 'mv-m' }, h('span', { class: 'mv-ty' }, TYPE_ES[meta.type] || meta.type), h('span', { class: 'mv-c', title: CAT[meta.cat][0] }, CAT[meta.cat][1]), meta.bp ? h('span', {}, `${meta.bp}`) : null),
        h('span', { class: 'mv-pp' }, `PP ${mv.pp}/${mv.maxpp}`));
      }));
      const bench = mine.map((p, i) => ({ p, i })).filter((x) => !x.p.active && !stateOfCondition(x.p.condition).fnt && !taken.has(x.i));
      const trapped = act.trapped || act.maybeTrapped;
      const row = h('div', { class: 'bt2-row' },
        h('button', { class: 'btn', type: 'button', disabled: !bench.length || trapped, title: trapped ? 'No puede cambiar: está atrapado' : '', onclick: () => this.askSwitch(me.p, bench, (i) => { taken.add(i); picks[s] = `switch ${i + 1}`; step(s + 1); }, () => step(s)) }, '🔄 Cambiar'),
        s > 0 ? h('button', { class: 'btn', type: 'button', onclick: () => { picks.length = s - 1; step(s - 1); } }, '↩ Atrás') : null,
        this.forfeitButton());
      if (canMega) { megaLbl.textContent = `Megaevolucionar a ${name}`; megaSub.textContent = 'Actívalo y luego elige un movimiento'; megaBtn.append(h('span', { class: 'mega-btn-ico' }, '💠'), h('span', { class: 'mega-btn-t' }, megaLbl, megaSub)); }
      this.menu.replaceChildren(h('div', { class: 'bt2-act' }, head, canMega ? megaBtn : '', moves, row));
    };
    step(0);
  }

  askTarget(s, kind, mv, done, back) {
    const mk = (key, t) => {
      const sl = this.slots[key];
      const alive = sl && sl.mon && !sl.fainted;
      return h('button', { class: 'tgt ' + (sl && sl.own ? 'ally' : 'foe'), type: 'button', disabled: !alive, onclick: () => done(t) },
        alive ? h('span', {}, h('b', {}, sl.mon.name), h('span', { class: 'small muted' }, sl.own ? ' (aliado)' : ' (rival)')) : '—');
    };
    const targets = [];
    if (kind !== 'adjacentAlly') { targets.push(mk(this.foe + 'a', 1), mk(this.foe + 'b', 2)); }
    if (kind === 'any' || kind === 'normal' || kind === 'adjacentAlly') {
      const mySlot = this.me + 'ab'[s];
      const other = this.me + 'ab'[1 - s];
      if (other !== mySlot) targets.push(mk(other, -(1 - s + 1)));
    }
    this.menu.replaceChildren(h('div', { class: 'bt2-act' }, h('div', { class: 'bt2-ask' }, h('b', {}, `${moveEs(mv.id)}: ¿contra quién?`)), h('div', { class: 'tgt-grid' }, targets),
      h('div', { class: 'bt2-row' }, h('button', { class: 'btn', type: 'button', onclick: back }, '↩ Atrás'))));
  }

  askSwitch(cur, bench, done, back) {
    const mine = this.req.side.pokemon;
    this.menu.replaceChildren(h('div', { class: 'bt2-pv' }, h('div', { class: 'bt2-pv-t' }, '¿Qué Pokémon entra?'),
      h('div', { class: 'pty-grid' }, bench.map((x) => this.partyCard(mine[x.i], x.i, { onPick: (i) => done(i) }))),
      h('div', { class: 'row gap' }, h('button', { class: 'btn', type: 'button', onclick: back }, '↩ Atrás'))));
  }
}

function translateError(t) {
  if (/not your turn|Can't do anything|already/i.test(t)) return 'ya has elegido o no es tu turno.';
  if (/disabled|can't use|Can't move/i.test(t)) return 'ese movimiento no se puede usar ahora.';
  if (/trapped|can't switch/i.test(t)) return 'no puede cambiar de Pokémon.';
  if (/target/i.test(t)) return 'falta elegir el objetivo.';
  return t;
}
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }
export { toID };

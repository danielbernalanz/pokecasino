'use strict';
// IA de los entrenadores CPU: heurística de daño esperado (tipos, STAB, potencia, precisión) con algo de
// criterio para cambiar de Pokémon y para repartir ataques en dobles. No es aleatoria: siempre intenta lo mejor,
// con un pequeño ruido para no ser 100 % predecible. Lee el `|request|` del simulador (lo suyo, exacto) y lo que
// el protocolo cuenta del rival (especie, PS en %, estado).
const { ps, toID } = require('./sdmap');

const NEEDS_TARGET = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly']);

// Habilidades que anulan un tipo si la especie solo tiene esa (o todas las suyas).
const ABSORB = { ground: ['levitate'], electric: ['voltabsorb', 'lightningrod', 'motordrive'], water: ['waterabsorb', 'stormdrain', 'dryskin'], fire: ['flashfire', 'wellbakedbody'], grass: ['sapsipper'] };

const jitter = () => 1 + (Math.random() - 0.5) * 0.12;

class Brain {
  /** @param {'p1'|'p2'} side @param {{doubles: boolean}} opts */
  constructor(side, { doubles = false } = {}) {
    this.side = side;
    this.foeSide = side === 'p1' ? 'p2' : 'p1';
    this.doubles = doubles;
    this.foes = {}; // 'a'|'b' → { species, level, hp (0-1), status, fainted }
    this.foeTeam = []; // especies vistas en la vista previa
    this.setupCount = {}; // ident → veces que ha usado un movimiento de mejora desde que entró
    this.lastMove = {}; // posición → id del último movimiento (Protección no dos veces seguidas)
    this.age = {}; // posición → turnos desde que entró (Sorpresa solo funciona el primero)
  }

  // ---- Lo que cuenta el protocolo ----
  feed(lines) {
    const { Dex } = ps();
    for (const line of lines) {
      if (line[0] !== '|') continue;
      const p = line.split('|');
      const cmd = p[1];
      if (cmd === 'poke' && p[2] === this.foeSide) {
        const sp = Dex.species.get(p[3].split(',')[0]);
        const lv = /L(\d+)/.exec(p[3]);
        if (sp.exists) this.foeTeam.push({ species: sp, level: lv ? Number(lv[1]) : 100 });
      } else if (cmd === 'switch' || cmd === 'drag') {
        const m = /^(p[12])([ab]): /.exec(p[2]);
        if (!m) continue;
        const key = m[1] + m[2];
        if (m[1] === this.side) { this.setupCount[key] = 0; this.lastMove[key] = ''; this.age[key] = 0; continue; }
        const sp = Dex.species.get(p[3].split(',')[0]);
        const lv = /L(\d+)/.exec(p[3]);
        this.foes[m[2]] = { species: sp, level: lv ? Number(lv[1]) : 100, hp: this.parseHp(p[4]), status: this.parseStatus(p[4]), fainted: false };
      } else if (cmd === 'detailschange' || cmd === '-formechange') {
        const m = /^(p[12])([ab]): /.exec(p[2]);
        if (m && m[1] === this.foeSide && this.foes[m[2]]) {
          const sp = Dex.species.get(p[3].split(',')[0]);
          if (sp.exists) this.foes[m[2]].species = sp;
        }
      } else if (cmd === '-damage' || cmd === '-heal' || cmd === '-sethp') {
        const m = /^(p[12])([ab]): /.exec(p[2]);
        if (m && m[1] === this.foeSide && this.foes[m[2]]) {
          this.foes[m[2]].hp = this.parseHp(p[3]);
          this.foes[m[2]].status = this.parseStatus(p[3]) || this.foes[m[2]].status;
          if (this.foes[m[2]].hp <= 0) this.foes[m[2]].fainted = true;
        }
      } else if (cmd === '-status' || cmd === '-curestatus') {
        const m = /^(p[12])([ab]): /.exec(p[2]);
        if (m && m[1] === this.foeSide && this.foes[m[2]]) this.foes[m[2]].status = cmd === '-status' ? p[3] : '';
      } else if (cmd === 'faint') {
        const m = /^(p[12])([ab]): /.exec(p[2]);
        if (m && m[1] === this.foeSide && this.foes[m[2]]) { this.foes[m[2]].fainted = true; this.foes[m[2]].hp = 0; }
      } else if (cmd === 'move') {
        const m = /^(p[12])([ab]): /.exec(p[2]);
        if (m && m[1] === this.side) {
          const key = m[1] + m[2];
          this.lastMove[key] = toID(p[3]);
          const mv = Dex.moves.get(p[3]);
          if (mv.exists && mv.category === 'Status' && ((mv.boosts && mv.target === 'self') || (mv.self && mv.self.boosts))) this.setupCount[key] = (this.setupCount[key] || 0) + 1;
        }
      } else if (cmd === 'turn') {
        for (const k of Object.keys(this.age)) this.age[k]++;
      }
    }
  }
  parseHp(s) {
    if (!s) return 1;
    const t = String(s).split(' ')[0];
    if (t === '0') return 0;
    const [a, b] = t.split('/').map(Number);
    return b ? a / b : 1;
  }
  parseStatus(s) {
    const t = String(s || '').split(' ')[1];
    return t && t !== 'fnt' ? t : '';
  }

  // ---- Cálculo de daño ----
  foeStats(f) {
    const b = f.species.baseStats;
    const L = f.level;
    const st = (base) => Math.floor(((2 * base + 31 + 21) * L) / 100) + 5;
    return { hp: Math.floor(((2 * b.hp + 31 + 21) * L) / 100) + L + 10, atk: st(b.atk), def: st(b.def), spa: st(b.spa), spd: st(b.spd), spe: st(b.spe) };
  }
  immuneByAbility(species, type) {
    const list = ABSORB[type.toLowerCase()];
    if (!list) return false;
    const regular = [species.abilities[0], species.abilities[1]].filter(Boolean).map(toID);
    return regular.length > 0 && regular.every((a) => list.includes(a));
  }
  // Fracción de PS máximos del defensor que quita el movimiento (esperada, con precisión).
  damage(mv, atk, def, { spread = false } = {}) {
    const { Dex } = ps();
    if (mv.category === 'Status') return 0;
    const types = def.types;
    if (!Dex.getImmunity(mv.type, types)) return 0;
    if (def.species && this.immuneByAbility(def.species, mv.type)) return 0;
    const eff = Math.pow(2, Dex.getEffectiveness(mv.type, types));
    let fixed = 0;
    if (mv.damageCallback || mv.ohko) fixed = mv.ohko ? 0.15 * def.maxHp : 0;
    if (mv.damage === 'level') fixed = atk.level;
    else if (typeof mv.damage === 'number') fixed = mv.damage;
    let dmg;
    if (fixed) dmg = fixed * eff;
    else {
      let bp = mv.basePower || (mv.category === 'Status' ? 0 : 60);
      if (mv.multihit) bp *= Array.isArray(mv.multihit) ? 3 : mv.multihit;
      if (!bp) return 0;
      const physical = mv.category === 'Physical';
      const A = mv.overrideOffensiveStat ? atk[mv.overrideOffensiveStat] : (physical ? atk.atk : atk.spa);
      const D = mv.overrideDefensivePokemon || mv.overrideDefensiveStat ? def[mv.overrideDefensiveStat || 'def'] : (physical ? def.def : def.spd);
      const base = Math.floor(Math.floor((Math.floor((2 * atk.level) / 5) + 2) * bp * A / Math.max(1, D)) / 50) + 2;
      const stab = atk.types.includes(mv.type) ? 1.5 : 1;
      dmg = base * stab * eff * 0.925 * (spread ? 0.75 : 1);
      if (physical && atk.status === 'brn') dmg *= 0.5;
    }
    const acc = mv.accuracy === true ? 1 : (mv.accuracy || 100) / 100;
    return (dmg * acc) / def.maxHp;
  }

  // ---- Interpretación del request ----
  ownInfo(p) {
    const { Dex } = ps();
    const sp = Dex.species.get(p.details.split(',')[0]);
    const lv = /L(\d+)/.exec(p.details);
    const [cur, rest] = p.condition.split('/');
    const maxHp = Number(String(rest || '1').split(' ')[0]) || 1;
    const hpAbs = p.condition.startsWith('0') ? 0 : Number(cur);
    return {
      species: sp, level: lv ? Number(lv[1]) : 100, types: sp.types, maxHp, hp: hpAbs, hpFrac: hpAbs / maxHp,
      atk: p.stats.atk, def: p.stats.def, spa: p.stats.spa, spd: p.stats.spd, spe: p.stats.spe,
      status: (p.condition.split(' ')[1] || '').replace('fnt', ''), moves: p.moves, ability: p.ability, item: p.item,
    };
  }
  foeInfo(f) {
    const st = this.foeStats(f);
    return { species: f.species, level: f.level, types: f.species.types, maxHp: st.hp, hpFrac: f.hp, ...st, status: f.status };
  }
  liveFoes() {
    return Object.entries(this.foes).filter(([, f]) => f && !f.fainted && f.hp > 0).map(([slot, f]) => ({ slot, f }));
  }

  // Cuánto daño haría un Pokémon propio sobre los rivales activos, y lo que ellos le harían a él.
  matchup(me, foesList) {
    const { Dex } = ps();
    let off = 0, def = 0;
    for (const { f } of foesList) {
      const fi = this.foeInfo(f);
      let best = 0;
      for (const id of me.moves) {
        const mv = Dex.moves.get(id);
        if (mv.category === 'Status') continue;
        best = Math.max(best, this.damage(mv, me, fi) / Math.max(0.05, fi.hpFrac || 1) * (fi.hpFrac || 1));
      }
      off = Math.max(off, best);
      // Lo peor que podría hacernos: ataque STAB con su mejor estadística, potencia 90.
      let worst = 0;
      for (const t of fi.types) {
        const stat = fi.atk >= fi.spa ? 'Physical' : 'Special';
        worst = Math.max(worst, this.damage({ category: stat, type: t, basePower: 90, accuracy: 100 }, fi, me));
      }
      def = Math.max(def, worst);
    }
    return { off, def };
  }

  // ---- Decisión ----
  decide(req) {
    if (!req || req.wait) return null;
    try {
      if (req.teamPreview) return this.chooseTeam(req);
      if (req.forceSwitch) return this.chooseForced(req);
      if (req.active) return this.chooseMoves(req);
    } catch (e) {
      if (process.env.SD_DEBUG) console.error('IA:', e);
    }
    return 'default';
  }

  chooseTeam(req) {
    const mine = req.side.pokemon.map((p, i) => ({ i, p, info: this.ownInfo(p) }));
    const max = req.maxChosenTeamSize || mine.length;
    const foes = this.foeTeam.map((f) => ({ f: { species: f.species, level: f.level, hp: 1, status: '' } }));
    const scored = mine.map((m) => {
      const { off, def } = foes.length ? this.matchup(m.info, foes) : { off: 0.3, def: 0.3 };
      const bst = Object.values(m.info.species.baseStats).reduce((a, b) => a + b, 0);
      return { ...m, score: off * 100 - def * 60 + bst / 20 };
    }).sort((a, b) => b.score - a.score).slice(0, max);
    return 'team ' + scored.map((m) => m.i + 1).join('');
  }

  benchScore(m, foes) {
    const { off, def } = this.matchup(m.info, foes);
    return off * 100 - def * 70 + m.info.hpFrac * 40;
  }

  chooseForced(req) {
    const need = req.forceSwitch;
    const used = new Set();
    const foes = this.liveFoes();
    const mine = req.side.pokemon.map((p, i) => ({ i, p, info: this.ownInfo(p) }));
    const parts = [];
    for (let s = 0; s < need.length; s++) {
      if (!need[s]) { parts.push('pass'); continue; }
      const cands = mine.filter((m) => !m.p.active && m.info.hp > 0 && !used.has(m.i)).sort((a, b) => this.benchScore(b, foes) - this.benchScore(a, foes));
      if (!cands.length) { parts.push('pass'); continue; }
      used.add(cands[0].i);
      parts.push('switch ' + (cands[0].i + 1));
    }
    return parts.join(', ');
  }

  chooseMoves(req) {
    const { Dex } = ps();
    const mine = req.side.pokemon.map((p, i) => ({ i, p, info: this.ownInfo(p) }));
    const actives = mine.filter((m) => m.p.active);
    const foesList = this.liveFoes();
    const parts = [];
    const switched = new Set();
    for (let s = 0; s < req.active.length; s++) {
      const act = req.active[s];
      const me = actives[s];
      if (!me || me.info.hp <= 0 || !act) { parts.push('pass'); continue; }
      const key = this.side + 'ab'[s];
      const allyAlive = actives.some((a, j) => j !== s && a.info.hp > 0);
      // ¿Cambio?
      const trapped = act.trapped || act.maybeTrapped;
      const options = [];
      const moves = act.moves || [];
      moves.forEach((mvReq, mi) => {
        if (mvReq.disabled || mvReq.pp === 0) return;
        const mv = Dex.moves.get(mvReq.id);
        if (!mv.exists) return;
        const tgtKind = mvReq.target || mv.target;
        if (this.doubles && NEEDS_TARGET.has(tgtKind)) {
          const targets = [];
          for (const { slot, f } of foesList) targets.push({ t: slot === 'a' ? 1 : 2, foe: f });
          if (tgtKind === 'adjacentAlly') { if (allyAlive) { const ally = actives.find((a, j) => j !== s && a.info.hp > 0); targets.length = 0; targets.push({ t: -(actives.indexOf(ally) + 1), ally }); } }
          if (!targets.length) targets.push({ t: 1, foe: null });
          for (const tg of targets) options.push({ mi: mi + 1, mv, target: tg.t, score: this.scoreMove(mv, me, tg.foe ? [{ f: tg.foe }] : [], { single: true, ally: tg.ally, allyAlive, key, act }) });
        } else {
          const live = this.doubles ? foesList : foesList.slice(0, 1);
          options.push({ mi: mi + 1, mv, target: null, score: this.scoreMove(mv, me, live, { single: false, allyAlive, key, act, actives, mine }) });
        }
      });
      options.sort((a, b) => b.score - a.score);
      let best = options[0];
      // Cambiar si nuestro mejor ataque apenas hace daño y el rival nos va a destrozar, y hay un relevo claramente mejor.
      const bench = mine.filter((m) => !m.p.active && m.info.hp > 0 && !switched.has(m.i));
      if (best && bench.length && !trapped && foesList.length) {
        const mu = this.matchup(me.info, this.doubles ? foesList : foesList.slice(0, 1));
        const bestDmg = best.score >= 0 ? Math.max(0, best.score) / 100 : 0;
        if (bestDmg < 0.28 && mu.def > 0.45 && Math.random() < 0.55) {
          const cands = bench.map((m) => ({ m, sc: this.benchScore(m, foesList) })).sort((a, b) => b.sc - a.sc);
          const cur = this.benchScore(me, foesList);
          if (cands[0].sc > cur + 25) { switched.add(cands[0].m.i); parts.push('switch ' + (cands[0].m.i + 1)); continue; }
        }
      }
      if (!best) { parts.push('default'); continue; }
      let c = 'move ' + best.mi;
      if (best.target !== null) c += ' ' + best.target;
      if (act.canMegaEvo) c += ' mega';
      parts.push(c);
    }
    return parts.join(', ');
  }

  // Puntuación (≈ % de PS del rival que quita; los movimientos de estado dan valores comparables).
  scoreMove(mv, me, foes, ctx) {
    const { Dex } = ps();
    const spreadFoes = mv.target === 'allAdjacentFoes' || mv.target === 'allAdjacent';
    if (mv.category !== 'Status') {
      if (ctx.ally && !ctx.single) return -1;
      if (ctx.ally) return -50; // nunca golpear al aliado a propósito
      let total = 0;
      for (const { f } of foes) {
        const fi = this.foeInfo(f);
        const d = this.damage(mv, me.info, fi, { spread: spreadFoes && foes.length > 1 });
        const capped = Math.min(d, fi.hpFrac || 1);
        let sc = capped * 100;
        if (d >= (fi.hpFrac || 1)) sc += 25 + (mv.priority > 0 ? 15 : 0); // remata
        total += sc;
      }
      if (!foes.length) total = 5;
      // Ataques que también golpean al aliado en dobles.
      if (mv.target === 'allAdjacent' && ctx.allyAlive) total *= 0.45;
      if (mv.selfdestruct) total *= me.info.hpFrac < 0.3 ? 0.9 : 0.12;
      if (mv.recoil) total *= 0.92;
      if (mv.self && mv.self.volatileStatus === 'mustrecharge') total *= 0.7;
      if (mv.flags && mv.flags.charge && !mv.flags.protect) total *= 0.6;
      if (mv.id === 'fakeout') total = foes.length ? ((this.age[ctx.key] || 0) > 0 ? 0 : 55) : 0;
      if (mv.id === 'suckerpunch') total *= 0.8;
      if (mv.id === 'dreameater' || mv.id === 'focuspunch' || mv.id === 'lastresort') total *= 0.1;
      if (mv.drain) total += mv.drain[0] / mv.drain[1] * total * 0.3;
      return total * jitter();
    }
    // ---- Estado ----
    const foe = foes[0] && foes[0].f;
    const hp = me.info.hpFrac;
    if (mv.heal || mv.id === 'rest') {
      if (hp < 0.45) return mv.id === 'rest' && me.info.status ? 66 : 70;
      return 0;
    }
    if (mv.id === 'protect' || mv.id === 'detect' || mv.id === 'spikyshield' || mv.id === 'kingsshield' || mv.id === 'banefulbunker' || mv.id === 'obstruct' || mv.id === 'silktrap') {
      if (this.lastMove[ctx.key] === mv.id) return 0;
      return this.doubles ? 22 : 8;
    }
    if (mv.status && foe && !foe.status && foe.hp > 0.5) {
      const fi = this.foeInfo(foe);
      const imm = {
        brn: fi.types.includes('Fire'), par: fi.types.includes('Electric') || (mv.type === 'Electric' && fi.types.includes('Ground')), psn: fi.types.includes('Poison') || fi.types.includes('Steel'),
        tox: fi.types.includes('Poison') || fi.types.includes('Steel'), slp: false, frz: fi.types.includes('Ice'),
      };
      if (imm[mv.status]) return 0;
      if (!Dex.getImmunity(mv.type, fi.types)) return 0;
      const v = { slp: 60, par: 38, brn: fi.atk > fi.spa ? 42 : 18, tox: 40, psn: 25, frz: 0 }[mv.status] || 15;
      return v * ((mv.accuracy === true ? 100 : mv.accuracy || 100) / 100);
    }
    if (mv.boosts && (mv.target === 'self' || (mv.self && mv.self.boosts) || mv.target === 'adjacentAllyOrSelf')) {
      const used = this.setupCount[ctx.key] || 0;
      if (used >= 2 || hp < 0.6) return 0;
      const useful = (mv.boosts.atk || mv.boosts.spa || mv.boosts.spe) ? 1 : 0.5;
      return (used === 0 ? 46 : 30) * useful;
    }
    if (mv.self && mv.self.boosts) {
      const used = this.setupCount[ctx.key] || 0;
      return used >= 2 || hp < 0.6 ? 0 : 40;
    }
    if (mv.sideCondition && foes.length && !ctx.allyAlive) return 18;
    return 4;
  }
}

module.exports = { Brain, NEEDS_TARGET };

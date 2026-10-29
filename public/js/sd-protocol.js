// Intérprete del protocolo de Pokémon Showdown (lo que el servidor reenvía de su simulador) → eventos con
// mensajes en español, al estilo de los juegos. Sin DOM: la pantalla de combates (views/battle.js) ejecuta los eventos
// uno a uno con pausas y animaciones. Documentación del protocolo: node_modules/pokemon-showdown/PROTOCOL.md
//
// Eventos (campo `k`): players, poke, preview, start, switch, move, hp, status, faint, boost, forme, weather, field,
// side, effect, turn, win, msg. Todos pueden llevar `msg` (texto para el cuadro de diálogo).

export const toID = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export const STAT_ES = { atk: 'Ataque', def: 'Defensa', spa: 'At. Esp.', spd: 'Def. Esp.', spe: 'Velocidad', accuracy: 'Precisión', evasion: 'Evasión', hp: 'PS' };
export const STATUS_ES = { par: 'PAR', brn: 'QUE', psn: 'ENV', tox: 'ENV', slp: 'DOR', frz: 'CON' };
export const STATUS_LONG = { par: 'Paralizado', brn: 'Quemado', psn: 'Envenenado', tox: 'Gravemente envenenado', slp: 'Dormido', frz: 'Congelado' };

const WEATHER = {
  raindance: ['Ha empezado a llover.', 'Ha dejado de llover.', 'Sigue lloviendo.'],
  sunnyday: ['El sol brilla intensamente.', 'El sol vuelve a la normalidad.', 'Sigue brillando el sol.'],
  sandstorm: ['Se acerca una tormenta de arena.', 'La tormenta de arena amainó.', 'La tormenta de arena arrecia.'],
  hail: ['Ha empezado a granizar.', 'Ha dejado de granizar.', 'Sigue granizando.'],
  snowscape: ['Ha empezado a nevar.', 'Ha dejado de nevar.', 'Sigue nevando.'],
  desolateland: ['¡El sol se ha vuelto abrasador!', 'El sol abrasador se ha extinguido.', ''],
  primordialsea: ['¡Ha empezado a caer un diluvio!', 'El diluvio ha cesado.', ''],
  deltastream: ['¡Una misteriosa corriente de aire protege a los Pokémon voladores!', 'La corriente de aire misteriosa se ha disipado.', ''],
};
const TERRAIN = {
  electricterrain: ['El campo se llenó de electricidad.', 'La electricidad del campo desapareció.'],
  grassyterrain: ['¡Ha crecido hierba por todo el campo!', 'La hierba del campo ha desaparecido.'],
  mistyterrain: ['Una niebla se ha esparcido por el campo.', 'La niebla del campo se ha disipado.'],
  psychicterrain: ['El campo se volvió extraño.', 'La rareza del campo ha desaparecido.'],
  trickroom: ['¡Se ha distorsionado el espacio-tiempo!', 'El espacio-tiempo ha vuelto a la normalidad.'],
  gravity: ['¡La gravedad se ha intensificado!', 'La gravedad ha vuelto a la normalidad.'],
  magicroom: ['Se crea una zona en la que los objetos pierden su efecto.', 'La zona mágica ha desaparecido.'],
  wonderroom: ['Se crea una zona en la que Defensa y Def. Esp. se intercambian.', 'La zona extraña ha desaparecido.'],
  mudsport: ['Se debilita el poder de los movimientos eléctricos.', ''],
  watersport: ['Se debilita el poder de los movimientos de fuego.', ''],
};
const SIDE = {
  stealthrock: ['¡Unas piedras puntiagudas flotan alrededor de {team}!', '¡Las piedras puntiagudas de {team} desaparecieron!'],
  spikes: ['¡Se han esparcido púas alrededor de {team}!', '¡Las púas de {team} desaparecieron!'],
  toxicspikes: ['¡Se han esparcido púas venenosas alrededor de {team}!', '¡Las púas venenosas de {team} desaparecieron!'],
  stickyweb: ['¡Una red viscosa se extiende alrededor de {team}!', '¡La red viscosa de {team} desapareció!'],
  reflect: ['¡Reflejo fortalece la defensa de {team}!', 'El efecto de Reflejo de {team} se ha acabado.'],
  lightscreen: ['¡Pantalla de Luz protege a {team}!', 'El efecto de Pantalla de Luz de {team} se ha acabado.'],
  auroraveil: ['¡Velo Aurora protege a {team}!', 'El efecto de Velo Aurora de {team} se ha acabado.'],
  tailwind: ['¡Sopla un viento a favor de {team}!', 'El viento a favor de {team} ha cesado.'],
  safeguard: ['¡Velo Sagrado envuelve a {team}!', 'El efecto de Velo Sagrado de {team} se ha acabado.'],
  mist: ['¡Neblina envuelve a {team}!', 'La neblina de {team} se ha disipado.'],
};
const STATUS_START = {
  par: '¡{m} sufre parálisis! Quizá no pueda moverse.', brn: '¡{m} sufre quemaduras!', psn: '¡{m} fue envenenado!', tox: '¡{m} fue gravemente envenenado!',
  slp: '¡{m} se durmió!', frz: '¡{m} se congeló!',
};
const STATUS_CURE = {
  par: '¡{m} se libró de la parálisis!', brn: '¡{m} se curó de las quemaduras!', psn: '¡{m} se curó del envenenamiento!', tox: '¡{m} se curó del envenenamiento!',
  slp: '¡{m} se despertó!', frz: '¡{m} se descongeló!',
};
const CANT = {
  par: '¡{m} está paralizado! ¡No se puede mover!', slp: '{m} está profundamente dormido.', frz: '¡{m} está congelado!', flinch: '¡{m} se amedrentó!',
  recharge: '¡{m} debe recuperarse de su ataque!', taunt: '¡{m} no puede usar ese movimiento tras la provocación!', disable: '¡El movimiento de {m} está anulado!',
  confusion: '¡{m} está confuso!', attract: '¡{m} está enamorado y no se puede mover!', truant: '¡{m} está holgazaneando!',
};
const STARTS = {
  confusion: '¡{m} está confuso!', substitute: '¡{m} creó un sustituto!', leechseed: '¡{m} fue infectado!', taunt: '¡{m} cayó en la provocación!',
  encore: '¡{m} sufre los efectos de Otra Vez!', yawn: '¡{m} empezó a sentir sueño!', attract: '¡{m} se enamoró!', curse: '¡{m} se maldijo a sí mismo!',
  perish3: '', perish2: '', perish1: '', perish0: '', flashfire: '¡{m} potenció sus movimientos de fuego!', focusenergy: '¡{m} se está preparando para luchar!',
  protect: '', torment: '¡{m} sufre tormento!', ingrain: '¡{m} echó raíces!', aquaring: '¡{m} se rodeó de un velo de agua!', smackdown: '¡{m} fue derribado!',
  telekinesis: '¡{m} fue elevado por telequinesis!', magnetrise: '¡{m} levita gracias al magnetismo!', healblock: '¡{m} no puede curarse!', embargo: '¡{m} no puede usar objetos!',
  nightmare: '¡{m} sufre una pesadilla!', bide: '¡{m} acumula energía!', minimize: '', skydrop: '', dynamax: '',
};
const ENDS = {
  confusion: '¡{m} ya no está confuso!', substitute: '¡El sustituto de {m} se desvaneció!', taunt: '¡{m} ya no está provocado!', encore: '¡{m} ya no sufre Otra Vez!',
  leechseed: '', attract: '¡{m} ya no está enamorado!', disable: '¡{m} ya no tiene el movimiento anulado!', yawn: '', torment: '¡{m} ya no sufre tormento!',
  magnetrise: '¡{m} ya no levita!', telekinesis: '¡{m} ya no levita por telequinesis!', healblock: '¡{m} ya puede curarse!', embargo: '¡{m} ya puede usar objetos!',
};

// Parte `p1a: Nombre` → { side, pos, name, key }.
export function ref(s) {
  const m = /^(p[1-4])([a-f])?: (.*)$/.exec(String(s || ''));
  if (!m) return null;
  return { side: m[1], pos: m[2] || '', name: m[3], key: m[1] + (m[2] || '') };
}

// Salud: «112/164», «56/100 par», «0 fnt».
export function parseHp(s) {
  const t = String(s || '').trim().split(' ');
  const status = t[1] && t[1] !== 'fnt' ? t[1] : '';
  if (t[0] === '0') return { cur: 0, max: 0, pct: 0, status: '', fnt: true };
  const [a, b] = t[0].split('/').map(Number);
  const max = b || 100;
  return { cur: a, max, pct: Math.max(0, Math.min(100, (a / max) * 100)), status, fnt: t[1] === 'fnt' };
}

export class Protocol {
  /**
   * @param {{me: 'p1'|'p2', names?: {moves?: object, abilities?: object, items?: object}, roster: {p1: object[], p2: object[]}, players?: {p1: string, p2: string}, megaName?: (formId:number)=>string}} o
   */
  constructor({ me, names = {}, roster = { p1: [], p2: [] }, players = {}, megaName = () => '' }) {
    this.me = me;
    this.names = names;
    this.roster = roster;
    this.players = { p1: players.p1 || 'Jugador 1', p2: players.p2 || 'Jugador 2' };
    this.megaName = megaName;
    this.active = {}; // 'p1a' → { name, id, shiny, level, gender, mega, species }
    this.weather = '';
    this.fields = new Set();
    this.doubles = false;
    this.lastMove = null;
    this.preview = { p1: [], p2: [] };
    this.turn = 0;
  }

  // ---- Nombres ----
  move(n) { const id = toID(n); return (this.names.moves && this.names.moves[id]) || n; }
  ability(n) { const id = toID(n); return (this.names.abilities && this.names.abilities[id]) || n; }
  item(n) { const id = toID(n); return (this.names.items && this.names.items[id]) || n; }
  own(side) { return side === this.me; }
  trainer(side) { return this.players[side]; }
  /** «Pikachu» (propio) o «el Pikachu rival»; `cap` pone mayúscula inicial. */
  label(key, cap = false) {
    const r = typeof key === 'string' && key.includes(':') ? ref(key) : null;
    const k = r ? r.key : key;
    const side = k.slice(0, 2);
    const mon = this.active[k];
    const name = mon ? mon.name : (r ? r.name : '?');
    if (this.own(side)) return name;
    return `${cap ? 'El' : 'el'} ${name} rival`;
  }
  // Con preposición: «de Pikachu» / «del Pikachu rival».
  prep(p, key) {
    const l = this.label(key, false);
    if (!l.startsWith('el ')) return `${p} ${l}`;
    return p === 'de' ? `del ${l.slice(3)}` : p === 'a' ? `al ${l.slice(3)}` : `${p} ${l}`;
  }
  teamName(side) { return this.own(side) ? 'tu equipo' : 'el equipo rival'; }
  // Rellena la plantilla; si {m} va al principio de la frase, con mayúscula inicial.
  say(tpl, key) {
    if (!tpl) return '';
    const idx = tpl.indexOf('{m}');
    return tpl.replace('{m}', this.label(key, idx <= 1));
  }

  rosterOf(side, name) { return (this.roster[side] || []).find((r) => r.name === name) || null; }

  // ---- Parser ----
  /** @returns {object[]} eventos */
  parse(line) {
    if (!line || line[0] !== '|') return [];
    const p = line.split('|');
    const cmd = p[1];
    const kw = {};
    for (let i = p.length - 1; i >= 2; i--) {
      const m = /^\[(\w+)\](?: (.*))?$/.exec(p[i]);
      if (m) kw[m[1]] = m[2] === undefined ? true : m[2];
    }
    switch (cmd) {
      case 'player':
        if (p[3]) this.players[p[2]] = p[3];
        return [{ k: 'players', players: { ...this.players } }];
      case 'gametype': this.doubles = p[2] === 'doubles'; return [{ k: 'gametype', doubles: this.doubles }];
      case 'poke': {
        const sp = String(p[3] || '').split(',')[0];
        (this.preview[p[2]] ||= []).push(sp);
        return [];
      }
      case 'teampreview': return [{ k: 'preview', species: this.preview }];
      case 'start': return [{ k: 'start', msg: this.startMsg() }];
      case 'switch': case 'drag': case 'replace': {
        const r = ref(p[2]);
        if (!r) return [];
        const det = String(p[3] || '');
        const hp = parseHp(p[4]);
        const entry = this.rosterOf(r.side, r.name);
        const species = det.split(',')[0];
        const lv = /L(\d+)/.exec(det);
        const mon = {
          name: r.name, id: entry ? entry.id : 0, shiny: /shiny/.test(det) || !!(entry && entry.shiny), level: lv ? Number(lv[1]) : (entry ? entry.level : 100),
          gender: /, ([MF])\b/.test(det) ? /, ([MF])\b/.exec(det)[1] : null, mega: 0, species, key: r.key, side: r.side,
        };
        this.active[r.key] = mon;
        let msg;
        if (cmd === 'drag') msg = `¡${this.label(r.key, true)} fue arrastrado al combate!`;
        else if (this.own(r.side)) msg = `¡Adelante, ${r.name}!`;
        else msg = `${this.trainer(r.side)} sacó a ${r.name}.`;
        return [{ k: 'switch', slot: r.key, side: r.side, mon, hp, msg, drag: cmd === 'drag' }];
      }
      case 'detailschange': case '-formechange': {
        const r = ref(p[2]);
        if (!r) return [];
        const mon = this.active[r.key];
        const species = String(p[3] || '').split(',')[0];
        if (!mon) return [];
        mon.species = species;
        const entry = this.rosterOf(r.side, mon.name);
        const isMega = /-Mega/i.test(species);
        if (isMega && entry && entry.mega) mon.mega = entry.mega;
        return [{ k: 'forme', slot: r.key, species, mega: isMega ? mon.mega : 0, id: mon.id, shiny: mon.shiny }];
      }
      case '-mega': {
        const r = ref(p[2]);
        if (!r) return [];
        const mon = this.active[r.key];
        const entry = mon && this.rosterOf(r.side, mon.name);
        const form = entry && entry.mega ? this.megaName(entry.mega) : '';
        const stone = p[4] ? this.item(p[4]) : '';
        return [{ k: 'msg', slot: r.key, big: true, msg: stone ? `¡La ${stone} ${this.prep('de', r.key)} reacciona!` : `¡${this.label(r.key, true)} está reaccionando!`, mega: true },
          { k: 'msg', slot: r.key, big: true, msg: `¡${this.label(r.key, true)} ha megaevolucionado${form ? ' en ' + form : ''}!` }];
      }
      case 'move': {
        const r = ref(p[2]);
        if (!r) return [];
        const tgt = ref(p[4]);
        this.lastMove = { slot: r.key, move: p[3], id: toID(p[3]), target: tgt ? tgt.key : null };
        const name = this.move(p[3]);
        const msg = `¡${this.label(r.key, true)} usó ${name}!`;
        return [{ k: 'move', slot: r.key, target: tgt ? tgt.key : null, move: p[3], moveId: toID(p[3]), name, msg, miss: !!kw.miss, spread: kw.spread ? String(kw.spread).split(',') : null }];
      }
      case 'cant': {
        const r = ref(p[2]);
        if (!r) return [];
        const why = toID(p[3]);
        let msg = CANT[why] ? this.say(CANT[why], r.key) : `¡${this.label(r.key, true)} no puede usar ${p[4] ? this.move(p[4]) : 'su movimiento'}!`;
        if (!CANT[why] && why.startsWith('ability')) msg = `¡${this.label(r.key, true)} no puede moverse!`;
        return [{ k: 'msg', slot: r.key, msg }];
      }
      case 'faint': {
        const r = ref(p[2]);
        if (!r) return [];
        return [{ k: 'faint', slot: r.key, msg: `${this.label(r.key, true)} se debilitó.` }];
      }
      case '-damage': case '-heal': case '-sethp': {
        const r = ref(p[2]);
        if (!r) return [];
        const hp = parseHp(p[3]);
        const from = kw.from ? String(kw.from) : '';
        const of = kw.of ? ref(kw.of) : null;
        const msg = cmd === '-damage' ? this.damageMsg(r.key, from, of) : cmd === '-heal' ? this.healMsg(r.key, from, of) : '';
        return [{ k: 'hp', slot: r.key, hp, kind: cmd === '-damage' ? 'damage' : cmd === '-heal' ? 'heal' : 'set', from, msg, direct: !from && cmd === '-damage', move: this.lastMove }];
      }
      case '-status': {
        const r = ref(p[2]);
        if (!r) return [];
        return [{ k: 'status', slot: r.key, status: p[3], msg: this.say(STATUS_START[p[3]], r.key) }];
      }
      case '-curestatus': {
        const r = ref(p[2]);
        if (!r) return [];
        return [{ k: 'status', slot: r.key, status: '', msg: this.say(STATUS_CURE[p[3]], r.key) }];
      }
      case '-cureteam': return [{ k: 'msg', msg: `¡Los problemas de estado de ${this.teamName(p[2].slice(0, 2))} se curaron!` }];
      case '-boost': case '-unboost': case '-setboost': {
        const r = ref(p[2]);
        if (!r) return [];
        const n = Number(p[4]) || 0;
        const up = cmd === '-boost';
        let msg = '';
        if (cmd === '-setboost') msg = `¡${this.label(r.key, true)} sacrificó PS y maximizó su ${STAT_ES[p[3]] || p[3]}!`;
        else if (n > 0) {
          const art = p[3] === 'atk' || p[3] === 'spa' ? 'El' : 'La';
          msg = `¡${art} ${STAT_ES[p[3]] || p[3]} ${this.prep('de', r.key)} ${up ? 'ha subido' : 'ha bajado'}${n >= 3 ? ' muchísimo' : n === 2 ? ' mucho' : ''}!`;
        }
        return [{ k: 'boost', slot: r.key, stat: p[3], delta: up ? n : cmd === '-unboost' ? -n : 0, msg }];
      }
      case '-clearallboost': return [{ k: 'msg', msg: '¡Todos los cambios de características fueron eliminados!' }];
      case '-clearboost': case '-clearnegativeboost': { const r = ref(p[2]); return r ? [{ k: 'msg', msg: `¡Los cambios de características ${this.prep('de', r.key)} fueron eliminados!` }] : []; }
      case '-supereffective': return [{ k: 'effect', kind: 'super', slot: (ref(p[2]) || {}).key, msg: '¡Es muy eficaz!' }];
      case '-resisted': return [{ k: 'effect', kind: 'resist', slot: (ref(p[2]) || {}).key, msg: 'No es muy eficaz…' }];
      case '-crit': return [{ k: 'effect', kind: 'crit', slot: (ref(p[2]) || {}).key, msg: '¡Un golpe crítico!' }];
      case '-immune': {
        const r = ref(p[2]);
        return [{ k: 'effect', kind: 'immune', slot: r && r.key, msg: r ? `No afecta ${this.prep('a', r.key)}…` : 'No afecta…' }];
      }
      case '-miss': {
        const r = ref(p[2]);
        return [{ k: 'effect', kind: 'miss', slot: (ref(p[3]) || {}).key, msg: r ? `¡El ataque ${this.prep('de', r.key)} falló!` : '¡Falló!' }];
      }
      case '-fail': {
        const r = ref(p[2]);
        return [{ k: 'msg', slot: r && r.key, msg: '¡Pero falló!' }];
      }
      case '-notarget': return [{ k: 'msg', msg: '¡Pero no había ningún objetivo!' }];
      case '-nothing': return [{ k: 'msg', msg: 'Pero no pasó nada…' }];
      case '-hitcount': return Number(p[3]) > 1 ? [{ k: 'msg', msg: `¡Golpeó ${p[3]} veces!` }] : [];
      case '-ohko': return [{ k: 'msg', msg: '¡Es un golpe KO!' }];
      case '-block': return [{ k: 'msg', msg: `¡${p[3] ? this.move(p[3]) : 'Una protección'} bloqueó el efecto!` }];
      case '-prepare': { const r = ref(p[2]); return r ? [{ k: 'msg', slot: r.key, msg: `¡${this.label(r.key, true)} se prepara para ${this.move(p[3])}!` }] : []; }
      case '-weather': {
        const w = toID(p[2]);
        const t = WEATHER[w];
        if (w === 'none') { const old = WEATHER[this.weather]; const msg = old ? old[1] : ''; this.weather = ''; return [{ k: 'weather', weather: '', msg }]; }
        if (kw.upkeep) return [{ k: 'weather', weather: w, msg: t ? t[2] : '', upkeep: true }];
        this.weather = w;
        return [{ k: 'weather', weather: w, msg: t ? t[0] : '' }];
      }
      case '-fieldstart': case '-fieldend': {
        const id = toID(String(p[2]).replace(/^move: /, ''));
        const t = TERRAIN[id];
        const start = cmd === '-fieldstart';
        if (start) this.fields.add(id); else this.fields.delete(id);
        return [{ k: 'field', field: id, on: start, msg: t ? (start ? t[0] : t[1]) : '' }];
      }
      case '-sidestart': case '-sideend': {
        const side = String(p[2]).slice(0, 2);
        const id = toID(String(p[3]).replace(/^move: /, ''));
        const t = SIDE[id];
        const start = cmd === '-sidestart';
        const team = this.teamName(side);
        return [{ k: 'side', side, cond: id, on: start, msg: t ? (start ? t[0] : t[1]).replace('{team}', team) : '' }];
      }
      case '-start': {
        const r = ref(p[2]);
        if (!r) return [];
        const id = toID(String(p[3]).replace(/^(move|ability): /, ''));
        if (id === 'typechange' || id === 'typeadd') return [{ k: 'msg', slot: r.key, msg: `¡${this.label(r.key, true)} cambió de tipo!` }];
        const t = STARTS[id];
        return t ? [{ k: 'msg', slot: r.key, msg: this.say(t, r.key), volatile: id }] : [{ k: 'volatile', slot: r.key, volatile: id, on: true }];
      }
      case '-end': {
        const r = ref(p[2]);
        if (!r) return [];
        const id = toID(String(p[3]).replace(/^(move|ability): /, ''));
        const t = ENDS[id];
        return t ? [{ k: 'msg', slot: r.key, msg: this.say(t, r.key), volatile: id }] : [];
      }
      case '-activate': {
        const r = ref(p[2]);
        if (!r) return [];
        const id = toID(String(p[3]).replace(/^(move|ability|item): /, ''));
        if (/^(protect|detect|spikyshield|kingsshield|banefulbunker|obstruct|silktrap|burningbulwark)$/.test(id)) return [{ k: 'msg', slot: r.key, msg: `¡${this.label(r.key, true)} se protegió!` }];
        if (id === 'substitute') return [{ k: 'msg', slot: r.key, msg: `¡El sustituto recibió el daño por ${this.label(r.key, false)}!` }];
        if (id === 'endure') return [{ k: 'msg', slot: r.key, msg: `¡${this.label(r.key, true)} aguantó el golpe!` }];
        if (id === 'focussash') return [{ k: 'msg', slot: r.key, msg: `¡${this.label(r.key, true)} aguantó el golpe con su Banda Focus!` }];
        if (id === 'confusion') return [{ k: 'msg', slot: r.key, msg: '¡Está tan confuso que se hirió a sí mismo!' }];
        if (id === 'sturdy') return [{ k: 'msg', slot: r.key, msg: `¡${this.label(r.key, true)} resistió gracias a Robustez!` }];
        return [];
      }
      case '-ability': {
        const r = ref(p[2]);
        if (!r) return [];
        return [{ k: 'ability', slot: r.key, ability: p[3], msg: `¡${this.label(r.key, true)} activó su habilidad ${this.ability(p[3])}!`, from: kw.from || '' }];
      }
      case '-item': {
        const r = ref(p[2]);
        if (!r) return [];
        return [{ k: 'msg', slot: r.key, msg: `${this.label(r.key, true)} obtuvo ${this.item(p[3])}.` }];
      }
      case '-enditem': {
        const r = ref(p[2]);
        if (!r) return [];
        const it = this.item(p[3]);
        const eaten = kw.eat;
        return [{ k: 'msg', slot: r.key, msg: eaten ? `¡${this.label(r.key, true)} comió su ${it}!` : `¡${it} ${this.prep('de', r.key)} se usó!` }];
      }
      case '-transform': { const r = ref(p[2]); return r ? [{ k: 'msg', slot: r.key, msg: `¡${this.label(r.key, true)} se transformó!` }] : []; }
      case '-terastallize': return [];
      case 'turn': this.turn = Number(p[2]) || 0; return [{ k: 'turn', n: this.turn }];
      case 'win': {
        const winner = p[2];
        const side = Object.keys(this.players).find((s) => this.players[s] === winner) || null;
        return [{ k: 'win', winner, side, you: side === this.me, msg: side === this.me ? `¡Has ganado el combate contra ${this.trainer(this.me === 'p1' ? 'p2' : 'p1')}!` : `Has perdido el combate… ¡${winner} es el vencedor!` }];
      }
      case 'tie': return [{ k: 'win', winner: null, side: null, you: false, msg: '¡El combate ha terminado en empate!' }];
      case 'inactive': return [{ k: 'msg', msg: String(p[2] || ''), warn: true }];
      case '-message': return [{ k: 'msg', msg: String(p[2] || '') }];
      case 'swap': {
        const r = ref(p[2]);
        return r ? [{ k: 'msg', slot: r.key, msg: `¡${this.label(r.key, true)} cambió de posición!` }] : [];
      }
      default: return [];
    }
  }

  startMsg() {
    const foe = this.trainer(this.me === 'p1' ? 'p2' : 'p1');
    return `¡${foe} quiere combatir!`;
  }

  damageMsg(key, from, of) {
    const l = this.label(key, true);
    const f = String(from || '');
    if (!f) return '';
    const id = toID(f.replace(/^(item|ability|move): /, ''));
    if (/psn|tox/.test(id)) return `¡${l} sufre por el envenenamiento!`;
    if (id === 'brn') return `¡${l} sufre quemaduras!`;
    if (id === 'sandstorm') return `¡La tormenta de arena zarandea ${this.prep('a', key)}!`;
    if (id === 'hail') return `¡El granizo golpea ${this.prep('a', key)}!`;
    if (id === 'recoil') return `¡${l} sufre daño por el retroceso!`;
    if (id === 'stealthrock') return `¡Unas piedras puntiagudas se clavan en ${this.label(key, false)}!`;
    if (id === 'spikes') return `¡Las púas hieren ${this.prep('a', key)}!`;
    if (id === 'leechseed') return `¡Las drenadoras restan salud ${this.prep('a', key)}!`;
    if (id === 'confusion') return '¡Está tan confuso que se hirió a sí mismo!';
    if (id === 'lifeorb') return `¡${l} perdió algunos PS por su ${this.item('Life Orb')}!`;
    if (id === 'curse') return `¡${l} sufre la maldición!`;
    if (id === 'roughskin' || id === 'ironbarbs') return `¡${l} fue herido por ${this.ability(id === 'roughskin' ? 'Rough Skin' : 'Iron Barbs')}!`;
    if (id === 'rockyhelmet') return `¡${l} fue herido por el ${this.item('Rocky Helmet')}!`;
    if (id === 'gmaxwildfire' || id === 'firespin' || id === 'whirlpool' || id === 'bind' || id === 'wrap' || id === 'sandtomb' || id === 'magmastorm' || id === 'infestation' || id === 'clamp') return `¡${l} es atacado por el movimiento atrapante!`;
    if (id === 'perish3' || id === 'perish0') return '';
    void of;
    return '';
  }
  healMsg(key, from, of) {
    const l = this.label(key, true);
    const f = String(from || '');
    if (!f) return `¡${l} recuperó PS!`;
    const id = toID(f.replace(/^(item|ability|move): /, ''));
    if (id === 'leftovers') return `¡${l} recuperó PS con ${this.item('Leftovers')}!`;
    if (id === 'drain') return of ? `¡${this.label(of.key, true)} perdió energía!` : '';
    if (id === 'wish') return `¡Se hizo realidad el deseo ${this.prep('de', key)}!`;
    if (id === 'ingrain') return `¡${l} absorbió nutrientes con sus raíces!`;
    if (id === 'aquaring') return `¡El velo de agua restauró los PS ${this.prep('de', key)}!`;
    if (id === 'grassyterrain') return `¡La hierba restauró los PS ${this.prep('de', key)}!`;
    if (id === 'rest') return '';
    if (id === 'sitrusberry' || /berry/.test(id)) return `¡${l} recuperó PS con su baya!`;
    if (/ability/.test(f)) return `¡${l} recuperó PS gracias a su habilidad!`;
    return `¡${l} recuperó PS!`;
  }
}

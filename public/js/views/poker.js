import { S, h, fmt, act, sfx, bus, playingCard, modal, avatar, titleTag } from '../core.js';
import { winFx, burstEl } from '../fx.js';

let currentTable = null;

export default {
  id: 'poker', title: "Texas Hold'em", icon: '♠️',
  async mount(root) {
    const lobbyBox = h('div', { class: 'poker-lobby' });
    const tableBox = h('div', {});
    let t = null;
    let hole = null;
    let lastNo = null;
    let tick = null;
    let wasMyTurn = false;
    let wonNo = null;

    const mySeat = () => (t ? t.seats.findIndex((s) => s && s.username === S.me.username) : -1);

    function renderLobby(list) {
      const myBadges = S.me.progress.badges.filter((b) => b.got).length;
      lobbyBox.replaceChildren(...(list || []).map((x) => h('button', { class: 'poker-room' + (x.id === currentTable ? ' active' : ''), onclick: () => watch(x.id) },
        h('b', {}, x.name, myBadges < x.badges ? ` 🔒 ${x.badges} medallas` : ''), h('span', { class: 'muted small' }, `Ciegas ${fmt(x.sb)}/${fmt(x.bb)} · Compra ${fmt(x.min)}–${fmt(x.max)}`),
        h('span', { class: 'chip' }, `${x.players}/${x.seats} jugadores`))));
    }

    async function watch(id) {
      const r = await act('poker:watch', { table: id });
      if (!r) return;
      currentTable = id;
      hole = r.hole;
      if (r.table) render(r.table);
      renderLobby(S.poker);
    }

    function sitDialog(seat) {
      const input = h('input', { type: 'number', min: t.min, max: t.max, value: Math.min(t.max, Math.max(t.min, t.bb * 50)), step: t.bb });
      const m = modal(h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault();
        const r = await act('poker:sit', { table: t.id, seat, buyIn: Number(input.value) });
        if (r) { m.close(); sfx('click'); render(r.table); }
      } }, h('p', {}, `Compra fichas para sentarte (${fmt(t.min)} – ${fmt(t.max)}). Se convierten de nuevo en monedas al levantarte.`), input,
      h('button', { class: 'btn primary' }, 'Sentarme')), { title: t.name });
    }

    function render(table) {
      t = table;
      const hd = t.hand;
      if (hd && hd.no !== lastNo) { lastNo = hd.no; if (!hole || hole.no !== hd.no) hole = null; sfx('flip'); }
      const me = mySeat();
      // Sentado, la lista de mesas sobra (en el móvil se oculta para que la mesa quepa).
      document.querySelector('#view').classList.toggle('seated', me !== -1);
      const myTurn = !!(hd && me !== -1 && hd.toAct === me);
      if (myTurn && !wasMyTurn) sfx('chat');
      wasMyTurn = myTurn;
      const seats = t.seats.map((s, i) => {
        const pos = 'seat-' + i;
        if (!s) {
          const locked = S.me.progress.badges.filter((b) => b.got).length < (t.badges || 0);
          if (locked) return h('div', { class: 'p-seat empty ' + pos }, h('span', { class: 'muted small' }, '🔒'));
          return h('div', { class: 'p-seat empty ' + pos }, me === -1 ? h('button', { class: 'btn small', onclick: () => sitDialog(i) }, 'Sentarse') : h('span', { class: 'muted small' }, 'Libre'));
        }
        const turn = hd && hd.toAct === i;
        const isMe = i === me;
        let cards = null;
        if (s.cards) cards = s.cards.map((c) => playingCard(c, { cls: 'small' }));
        else if (isMe && hole && s.inHand && !s.folded) cards = hole.cards.map((c) => playingCard(c, { cls: 'small' }));
        else if (s.inHand && !s.folded) cards = [playingCard(null, { cls: 'small', back: s.cardback }), playingCard(null, { cls: 'small', back: s.cardback })];
        const won = hd && hd.winners && hd.winners.find((w) => w.seat === i);
        return h('div', { class: `p-seat ${pos}${turn ? ' turn' : ''}${s.folded ? ' folded' : ''}${isMe ? ' me' : ''}${won ? ' winner' : ''}${s.sittingOut ? ' out' : ''}` },
          h('div', { class: 'p-cards' }, cards),
          h('div', { class: 'p-info' },
            avatar(s.buddy, s),
            h('div', {}, h('b', {}, s.username), s.title ? h('div', {}, titleTag(s.title)) : null, h('div', { class: 'p-stack' }, fmt(s.stack)), s.handName ? h('div', { class: 'small good' }, s.handName) : null,
              s.allIn ? h('div', { class: 'small bad' }, 'ALL-IN') : s.sittingOut ? h('div', { class: 'small muted' }, 'Ausente') : null)),
          turn ? h('div', { class: 'p-timer' }, h('i', { 'data-deadline': hd.deadline })) : null,
          s.bet ? h('div', { class: 'p-bet' }, fmt(s.bet)) : null,
          t.dealer === i ? h('span', { class: 'p-dealer' }, 'D') : null,
          won ? h('div', { class: 'p-won' }, `+${fmt(won.amount)}`) : null);
      });
      const center = h('div', { class: 'p-center' },
        h('div', { class: 'p-board' }, (hd ? hd.board : []).map((c) => playingCard(c, { cls: 'deal' }))),
        hd ? h('div', { class: 'p-pot' }, `Bote ${fmt(hd.pot)}`) : h('div', { class: 'muted' }, t.seats.filter(Boolean).length < 2 ? 'Esperando jugadores…' : 'Nueva mano en breve…'));
      const needs = (t.badges || 0) - S.me.progress.badges.filter((b) => b.got).length;
      tableBox.replaceChildren(
        h('div', { class: 'row between wrap gap' }, h('h2', {}, t.name), h('span', { class: 'muted' }, `Ciegas ${fmt(t.sb)}/${fmt(t.bb)}`)),
        needs > 0 ? h('a', { class: 'card lock-note', href: '#/trainer' }, `🔒 Puedes mirar, pero para jugar aquí necesitas ${t.badges} medallas de gimnasio (te faltan ${needs}). Míralas en «Mi Entrenador».`) : '',
        h('div', { class: 'p-table' }, h('div', { class: 'p-felt' }, center), seats),
        ...controls(me),
        h('div', { class: 'p-log' }, t.log.slice().reverse().map((l) => h('div', {}, l.text))));
      // Premio de la mano: ráfaga en cada ganador y, si el bote es mío, monedas hacia el contador.
      if (hd && hd.winners && hd.winners.length && wonNo !== hd.no) {
        wonNo = hd.no;
        tableBox.querySelectorAll('.p-seat.winner').forEach((el) => burstEl(el, '#ffd54f', 14, { spread: 120, stars: 0.7 }));
        const mine = me !== -1 && hd.winners.find((w) => w.seat === me);
        if (mine) winFx(mine.amount, t.bb * 4, { el: tableBox.querySelector('.p-seat.me') || undefined, icon: '♠️' });
      }
      timerLoop();
    }

    function controls(me) {
      if (me === -1) return [h('p', { class: 'muted center' }, 'Elige un asiento libre para jugar o mira la partida.')];
      const s = t.seats[me];
      const hd = t.hand;
      const out = [];
      const mgmt = h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn small', onclick: () => act('poker:sitout', { table: t.id, out: !s.sittingOut }) }, s.sittingOut ? 'Volver a la mesa' : 'Ausentarme'),
        h('button', { class: 'btn small', onclick: async () => {
          const v = prompt(`¿Cuántas fichas añadir? (máx. ${fmt(t.max - s.stack)})`, String(t.bb * 50));
          if (v) await act('poker:rebuy', { table: t.id, amount: Number(v) });
        } }, 'Recomprar'),
        h('button', { class: 'btn small danger', onclick: () => act('poker:stand', { table: t.id }) }, 'Levantarse'));
      if (hd && hd.toAct === me) {
        const myBet = s.bet;
        const toCall = hd.currentBet - myBet;
        const minTo = Math.min(hd.currentBet + hd.minRaise, s.stack + myBet);
        const maxTo = s.stack + myBet;
        const raise = h('input', { type: 'range', min: minTo, max: maxTo, step: t.sb, value: minTo });
        const raiseLbl = h('b', {}, fmt(minTo));
        raise.addEventListener('input', () => { raiseLbl.textContent = fmt(raise.value); });
        const send = (type, amount) => act('poker:action', { table: t.id, type, amount }).then((r) => r && sfx('click'));
        const pot = hd.pot;
        const canRaise = maxTo > hd.currentBet && hd.canRaise;
        out.push(h('div', { class: 'p-controls my-turn' },
          canRaise ? h('div', { class: 'raise-box' },
            ...[0.5, 1].map((f) => h('button', { class: 'chip', onclick: () => { raise.value = Math.max(minTo, Math.min(maxTo, Math.round(hd.currentBet + pot * f))); raiseLbl.textContent = fmt(raise.value); } }, f === 1 ? 'Bote' : '½ bote')), raise, raiseLbl) : '',
          h('div', { class: 'p-actions' },
            h('button', { class: 'btn big danger', onclick: () => send('fold') }, 'Retirarse'),
            toCall > 0 ? h('button', { class: 'btn big', onclick: () => send('call') }, `Igualar ${fmt(Math.min(toCall, s.stack))}`) : h('button', { class: 'btn big', onclick: () => send('check') }, 'Pasar'),
            canRaise ? h('button', { class: 'btn big primary', onclick: () => send(Number(raise.value) >= maxTo ? 'allin' : 'raise', Number(raise.value)) }, hd.currentBet ? 'Subir' : 'Apostar') : '',
            hd.canRaise || toCall >= s.stack ? h('button', { class: 'btn big gold', onclick: () => send('allin') }, 'All-in') : '')));
      }
      out.push(h('div', { class: 'p-controls' }, mgmt));
      return out;
    }

    function timerLoop() {
      clearInterval(tick);
      tick = setInterval(() => {
        tableBox.querySelectorAll('.p-timer i').forEach((el) => {
          const left = Math.max(0, Number(el.dataset.deadline) - Date.now());
          el.style.width = (left / 25000) * 100 + '%';
        });
      }, 200);
    }

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, "♠️ Texas Hold'em"), h('p', { class: 'muted' }, 'No-Limit entre jugadores, sin comisión de la casa. 25 s por turno.')),
      lobbyBox, tableBox);
    this.offs = [
      bus.on('poker:lobby', renderLobby),
      bus.on('poker:table', (x) => { if (x.id === currentTable) render(x); }),
      bus.on('poker:hole', (x) => { if (x.table === currentTable) { hole = x; if (t) render(t); } }),
    ];
    renderLobby(S.poker);
    watch(currentTable || (S.poker && S.poker[0] && S.poker[0].id) || 'pallet');
    this.stop = () => clearInterval(tick);
  },
  unmount() { this.offs.forEach((f) => f()); this.stop(); },
};

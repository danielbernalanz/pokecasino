import { S, h, fmt, emit, sfx, toast, item, TYPE_ES, sleep } from '../core.js';
import { winFx, burstEl, glow, pop, vibrate, reduced } from '../fx.js';

const COLORS = {
  pokeball: '#e3350d', normal: '#a8a77a', fire: '#ee8130', water: '#6390f0', electric: '#f7d02c', grass: '#7ac74c', ice: '#96d9d6',
  fighting: '#c22e28', poison: '#a33ea1', ground: '#e2bf65', flying: '#a98ff3', psychic: '#f95587', bug: '#a6b91a', rock: '#b6a136',
  ghost: '#735797', dragon: '#6f35fc', dark: '#705746', steel: '#b7b7ce', fairy: '#d685ad',
};
const GROUP_NAMES = { ofensivo: '🔥 Ofensivo', elemental: '💧 Elemental', mistico: '🌿 Místico' };

export default {
  id: 'roulette', title: 'Ruleta de Tipos', icon: '🎡',
  mount(root) {
    const { wheel, groups, payout } = S.data.roulette;
    const n = wheel.length;
    const seg = 360 / n;
    let chip = 50;
    let bets = new Map(); // clave kind:value -> importe
    let rotation = 0;
    let spinning = false;

    const grad = wheel.map((t, i) => `${COLORS[t]} ${i * seg}deg ${(i + 1) * seg}deg`).join(',');
    const disc = h('div', { class: 'wheel-disc', style: { background: `conic-gradient(${grad})` } },
      wheel.map((t, i) => h('div', { class: 'wheel-label', style: { transform: `rotate(${i * seg + seg / 2}deg)` } },
        t === 'pokeball' ? h('img', { class: 'pixel', src: item('poke-ball'), alt: '' }) : h('span', {}, TYPE_ES[t].slice(0, 3).toUpperCase()))));
    const orbit = h('div', { class: 'rball-orbit' }, h('i', { class: 'rball' }));
    const resultEl = h('div', { class: 'wheel-result' }, 'Haz tus apuestas');
    const total = h('b', {}, '0');

    const chipBtns = [10, 50, 100, 500, 1000, 5000].map((v) => h('button', { class: 'chip-btn' + (v === chip ? ' active' : ''), onclick: (e) => {
      chip = v; chipBtns.forEach((b) => b.classList.toggle('active', b === e.currentTarget)); sfx('click');
    } }, v >= 1000 ? v / 1000 + 'k' : v));

    const cells = new Map();
    function cell(kind, value, label, cls, style) {
      const key = kind + ':' + value;
      const amt = h('span', { class: 'bet-amt' });
      const el = h('button', { class: 'bcell ' + cls, style, title: `Paga ×${payout[kind]}`,
        onclick: () => { if (spinning) return; bets.set(key, (bets.get(key) || 0) + chip); sfx('click'); refresh(); },
        oncontextmenu: (e) => { e.preventDefault(); bets.delete(key); refresh(); } }, label, amt);
      cells.set(key, amt);
      return el;
    }
    function refresh() {
      let sum = 0;
      for (const [k, amt] of cells) {
        const v = bets.get(k) || 0;
        sum += v;
        amt.textContent = v ? fmt(v) : '';
        amt.parentElement.classList.toggle('has', v > 0);
      }
      total.textContent = fmt(sum);
    }

    const board = h('div', { class: 'rboard' },
      h('div', { class: 'rtypes' }, wheel.map((t, i) => cell('type', t,
        t === 'pokeball' ? h('img', { class: 'pixel', src: item('poke-ball'), alt: 'Poké Ball' }) : h('span', {}, h('small', {}, i + ' '), TYPE_ES[t]),
        'rt', { background: COLORS[t] }))),
      h('div', { class: 'rgroups' }, Object.keys(groups).map((g) => cell('group', g, h('span', {}, GROUP_NAMES[g], h('small', {}, groups[g].map((t) => TYPE_ES[t]).join(', '))), 'rg'))),
      h('div', { class: 'rgroups' }, cell('parity', 'par', 'PAR', 'rg'), cell('parity', 'impar', 'IMPAR', 'rg')));

    const spinBtn = h('button', { class: 'btn primary huge', onclick: spin }, 'GIRAR');
    async function spin() {
      if (spinning) return;
      const list = [...bets].map(([k, amount]) => { const [kind, value] = k.split(':'); return { kind, value, amount }; });
      if (!list.length) return toast('Coloca alguna ficha en el tapete.', 'error');
      const stake = list.reduce((a, b) => a + b.amount, 0);
      spinning = true; spinBtn.disabled = true;
      let res;
      try { res = await emit('roulette:spin', { bets: list }); } catch (e) { toast(e.message, 'error'); sfx('error'); spinning = false; spinBtn.disabled = false; return; }
      // Gira para que el segmento ganador quede bajo el puntero (arriba).
      const target = 360 - (res.slot * seg + seg / 2);
      rotation += 360 * 5 + ((target - (rotation % 360)) + 360) % 360;
      disc.style.transform = `rotate(${rotation}deg)`;
      // La bola corre en sentido contrario por el borde y frena junto con la ruleta hasta quedar bajo el puntero.
      orbit.classList.add('on');
      if (!reduced()) orbit.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(-1800deg)' }], { duration: 4200, easing: 'cubic-bezier(.12,.7,.1,1)' });
      resultEl.textContent = '…';
      for (let i = 0; i < 12; i++) { sfx('tick'); await sleep(120 + i * 25); }
      await sleep(Math.max(0, 4200 - 12 * 120 - 66 * 25));
      const t = res.type;
      resultEl.replaceChildren(h('span', { class: 'type t-' + t }, `${res.slot} · ${TYPE_ES[t]}`),
        res.paid ? h('b', { class: 'good' }, ` +${fmt(res.paid)}`) : h('span', { class: 'muted' }, ' sin premio'));
      sfx(res.paid ? 'win' : 'lose');
      pop(orbit.firstChild, 1.8);
      glow(disc.parentElement, COLORS[t], 900);
      if (res.paid) { burstEl(orbit.firstChild, COLORS[t], 22, { spread: 130 }); vibrate(30); winFx(res.paid, stake, { el: disc.parentElement, icon: '🎡' }); }
      spinning = false; spinBtn.disabled = false;
    }

    root.append(
      h('div', { class: 'game-head' }, h('h1', {}, '🎡 Ruleta de Tipos'), h('p', { class: 'muted' }, 'Tipo exacto ×18 · Grupo ×3 · Par/Impar ×2 · La Poké Ball solo paga a quien apuesta por ella.')),
      h('div', { class: 'roulette-layout' },
        h('div', { class: 'wheel-wrap' }, h('div', { class: 'wheel-pointer' }), disc, orbit, h('div', { class: 'wheel-hub' }, h('img', { class: 'pixel', src: item('master-ball'), alt: '' }))),
        h('div', { class: 'stack' },
          resultEl,
          h('div', { class: 'card' },
            h('div', { class: 'row between wrap gap' }, h('div', { class: 'chips' }, chipBtns),
              h('div', {}, 'Total: ', total)),
            board,
            h('p', { class: 'muted small' }, 'Clic para añadir ficha · clic derecho para quitarla.'),
            h('div', { class: 'row gap sticky-actions' }, h('button', { class: 'btn', onclick: () => { bets = new Map(); refresh(); } }, 'Limpiar'), spinBtn)))),
    );
  },
};

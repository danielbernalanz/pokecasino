// Chat, actividad en vivo y jugadores conectados.
import { S, h, $, fmt, sprite, sfx, act, bus, modal, pokeImg, typeBadge, rarityName, RARITY_ORDER } from './core.js';

const time = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const buddyIco = (b) => (b ? h('img', { class: 'pixel mini', src: sprite(b.id, b.shiny), alt: '' }) : h('span', { class: 'mini' }));

export function addChat(m, silent) {
  const log = $('#chat-log');
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const mention = S.me && m.text.toLowerCase().includes('@' + S.me.username.toLowerCase());
  log.append(h('div', { class: 'msg' + (mention ? ' mention' : '') },
    buddyIco(m.buddy),
    h('div', {},
      h('div', { class: 'msg-head' }, h('a', { class: 'uname' + (m.admin ? ' admin' : ''), onclick: () => showPlayer(m.user) }, m.user), h('span', { class: 'muted' }, time(m.at))),
      h('div', { class: 'msg-text' }, m.text))));
  while (log.children.length > 120) log.firstChild.remove();
  if (near || silent) log.scrollTop = log.scrollHeight;
  if (!silent && m.user !== S.me?.username) {
    sfx('chat');
    if (!document.body.classList.contains('social-open') && window.innerWidth < 1200) $('#chat-dot').classList.remove('hidden');
  }
}

const FEED_ICON = { win: '💰', jackpot: '💥', gacha: '✨', duel: '⚔️', join: '🎉', level: '⭐', trade: '🤝' };
export function addFeed(f, silent) {
  const box = $('#feed');
  box.prepend(h('div', { class: `feed-item fk-${f.kind}` },
    f.pokeId ? h('img', { class: 'pixel mini', src: sprite(f.pokeId, f.shiny), alt: '' }) : h('span', { class: 'feed-ico' }, FEED_ICON[f.kind] || '•'),
    h('div', {}, h('div', {}, f.text), h('div', { class: 'muted small' }, time(f.at)))));
  while (box.children.length > 60) box.lastChild.remove();
  if (!silent && (f.kind === 'jackpot' || f.kind === 'gacha')) sfx('shiny');
}

export function renderOnline(list) {
  S.online = list;
  $('#online-count').textContent = list.length;
  const box = $('#online');
  box.replaceChildren(...list.map((u) => h('div', { class: 'online-row', onclick: () => showPlayer(u.username) },
    buddyIco(u.buddy),
    h('div', { class: 'grow' }, h('b', { class: u.isAdmin ? 'admin' : '' }, u.username), h('div', { class: 'muted small' }, `Nv ${u.level} · Pokédex ${u.dex}${u.shinies ? ' · ✨' + u.shinies : ''}`)),
    h('span', { class: 'online-dot' }))));
}

export async function showPlayer(username) {
  const res = await act('player:view', { username });
  if (!res) return;
  const p = res.player;
  const owned = Object.entries(p.collection).map(([id, c]) => ({ ...S.dexById.get(Number(id)), ...c }))
    .filter((x) => x.id).sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.id - b.id);
  const isMe = S.me && p.username === S.me.username;
  const giftCoins = h('form', { class: 'row gap', onsubmit: async (e) => {
    e.preventDefault();
    const amount = Number(e.target.amount.value);
    if (await act('gift:coins', { to: p.username, amount })) { e.target.reset(); bus.emit('toast', `Enviaste ${fmt(amount)} monedas a ${p.username}`); }
  } }, h('input', { name: 'amount', type: 'number', min: 1, placeholder: 'Monedas', required: true }), h('button', { class: 'btn' }, '🎁 Regalar monedas'));
  const body = h('div', { class: 'player-card' },
    h('div', { class: 'player-hero' },
      p.buddy ? pokeImg(p.buddy.id, p.buddy.shiny, 'player-buddy') : h('div', { class: 'player-buddy empty' }, '?'),
      h('div', {},
        h('h2', {}, p.username, p.isAdmin ? h('span', { class: 'tag' }, 'ANFITRIÓN') : null),
        h('p', { class: 'muted' }, `Nivel ${p.level} · Desde ${new Date(p.createdAt).toLocaleDateString('es-ES')}`),
        h('div', { class: 'stat-row' },
          stat('Pokédex', `${p.dex}/${S.data.dex.length}`), stat('Variocolor', p.shinies), stat('Tiradas', fmt(p.stats.pulls)),
          stat('Duelos', `${p.stats.duelsWon}V / ${p.stats.duelsLost}D`), stat('Mayor premio', fmt(p.stats.biggestWin))))),
    !isMe ? giftCoins : null,
    !isMe ? h('p', { class: 'muted small' }, 'Para regalar o retar con un Pokémon usa la Pokédex o los Duelos.') : null,
    h('div', { class: 'mini-grid' }, owned.map((x) => h('div', { class: `mini-card r-${x.rarity}`, title: `${x.name} · ${rarityName(x.rarity)}` },
      h('img', { class: 'pixel', src: sprite(x.id, x.s > 0), alt: x.name, loading: 'lazy' }),
      h('span', { class: 'stars' }, '★'.repeat(Math.min(5, x.n))))))
  );
  modal(body, { title: 'Ficha de entrenador', wide: true });
}

function stat(label, value) { return h('div', { class: 'stat' }, h('span', { class: 'muted small' }, label), h('b', {}, value)); }
export { stat, typeBadge };

export function initSocial() {
  $('#chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await act('chat:send', { text });
  });
  document.querySelectorAll('.stab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'pane-' + b.dataset.pane));
  }));
  $('#social-btn').addEventListener('click', () => {
    document.body.classList.toggle('social-open');
    $('#chat-dot').classList.add('hidden');
  });
}

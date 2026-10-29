// Chat, actividad en vivo y jugadores conectados.
import { S, h, $, fmt, sprite, sfx, act, bus, modal, pokeImg, typeBadge, rarityName, RARITY_ORDER, avatar, titleTag, badgeImg, notify, toast, confirmRisk, fmtPlay } from './core.js';

// ---------- Emotes: «:pikachu:» se pinta con el sprite del Pokémon ----------
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
let emoteMap = null;
function emotes() {
  if (!emoteMap) { emoteMap = new Map(); for (const p of S.data.dex) emoteMap.set(norm(p.name), p.id); }
  return emoteMap;
}
export const emoteCode = (id) => ':' + norm(S.dexById.get(id).name) + ':';
// Devuelve nodos seguros (texto + <img>), nunca HTML.
function richText(text) {
  const out = [];
  let last = 0, count = 0;
  for (const m of text.matchAll(/:([a-z0-9\u00c0-\u017f.'\- ]{2,20}):/gi)) {
    const id = count < 8 && emotes().get(norm(m[1]));
    if (!id) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('img', { class: 'pixel emote', src: sprite(id), alt: m[0], title: m[0], loading: 'lazy' }));
    last = m.index + m[0].length; count++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function replyTo(name) {
  const input = $('#chat-input');
  input.value = `/w ${name} `;
  document.body.classList.add('social-open');
  document.querySelector('.stab[data-pane="chat"]')?.click();
  input.focus();
}

const time = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

export function addChat(m, silent) {
  const log = $('#chat-log');
  const near = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const mine = m.user === S.me?.username;
  const mention = S.me && !mine && m.text.toLowerCase().includes('@' + S.me.username.toLowerCase());
  const other = m.private ? (mine ? m.to : m.user) : null;
  log.append(h('div', { class: 'msg' + (mention ? ' mention' : '') + (m.private ? ' private' : '') },
    avatar(m.buddy, m, 'sm'),
    h('div', {},
      h('div', { class: 'msg-head' }, h('a', { class: 'uname' + (m.admin ? ' admin' : ''), onclick: () => showPlayer(m.user) }, m.user), titleTag(m.title),
        m.private ? h('a', { class: 'dm-tag', title: 'Responder en privado', onclick: () => replyTo(other) }, mine ? `✉️ a ${m.to}` : '✉️ privado') : null,
        h('span', { class: 'muted' }, time(m.at))),
      h('div', { class: 'msg-text' }, richText(m.text)))));
  while (log.children.length > 120) log.firstChild.remove();
  if (near || silent) log.scrollTop = log.scrollHeight;
  if (!silent && !mine) {
    sfx('chat');
    if (m.private) notify(`✉️ ${m.user}: ${m.text}`, { link: '' });
    else if (mention) notify(`💬 ${m.user} te mencionó: ${m.text}`);
    if (!document.body.classList.contains('social-open') && window.innerWidth < 1200) $('#chat-dot').classList.remove('hidden');
  }
}

const FEED_ICON = { event: '🎉', win: '💰', jackpot: '💥', gacha: '✨', duel: '⚔️', join: '🎉', level: '⭐', trade: '🤝', mega: '💠' };
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
    avatar(u.buddy, u, 'sm'),
    h('div', { class: 'grow' }, h('b', { class: u.isAdmin ? 'admin' : '' }, u.username), titleTag(u.title), h('div', { class: 'muted small' }, `Nv ${u.level} · 🏅${u.badges} · Pokédex ${u.dex}${u.shinies ? ' · ✨' + u.shinies : ''}`)),
    h('span', { class: 'online-dot' }))));
}

export async function showPlayer(username) {
  const res = await act('player:view', { username });
  if (!res) return;
  const p = res.player;
  const owned = Object.entries(p.collection).map(([id, c]) => ({ ...S.dexById.get(Number(id)), ...c }))
    .filter((x) => x.id).sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.id - b.id);
  const isMe = S.me && p.username === S.me.username;
  const canTalk = !isMe && !p.npc; // los comerciantes NPC no leen mensajes ni aceptan regalos
  const giftCoins = h('form', { class: 'row gap', onsubmit: async (e) => {
    e.preventDefault();
    const amount = Number(e.target.amount.value);
    if (S.me && amount >= S.me.coins * 0.5 && !(await confirmRisk('gift-big', { title: 'Regalo muy grande', danger: 'Regalar igualmente', safe: 'Cancelar',
      text: `Vas a regalar ${fmt(amount)} de tus ${fmt(S.me.coins)} monedas (${Math.round(amount / Math.max(1, S.me.coins) * 100)} %) a ${p.username}. Los regalos no se pueden recuperar.` }))) return;
    if (await act('gift:coins', { to: p.username, amount })) { e.target.reset(); bus.emit('toast', `Enviaste ${fmt(amount)} monedas a ${p.username}`); }
  } }, h('input', { name: 'amount', type: 'number', min: 1, placeholder: 'Monedas', required: true }), h('button', { class: 'btn' }, '🎁 Regalar monedas'));
  const body = h('div', { class: 'player-card' },
    h('div', { class: 'player-hero' },
      h('div', { class: 'avatar xl ' + (p.frame ? 'fr ' + p.frame : '') }, p.buddy ? pokeImg(p.buddy.id, p.buddy.shiny, 'player-buddy', p.buddy.mega) : h('div', { class: 'player-buddy empty' }, '?')),
      h('div', {},
        h('h2', {}, p.username, p.isAdmin ? h('span', { class: 'tag' }, 'ANFITRIÓN') : null, ' ', titleTag(p.title)),
        h('div', { class: 'row gap' }, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => badgeImg(n, p.badges >= n, 'tiny'))),
        h('p', { class: 'muted' }, `Nivel ${p.level} · Desde ${new Date(p.createdAt).toLocaleDateString('es-ES')}`),
        h('div', { class: 'stat-row' },
          stat('Pokédex', `${p.dex}/${S.data.dex.length}`), stat('Variocolor', p.shinies), stat('Tiradas', fmt(p.stats.pulls)),
          stat('Duelos', `${p.stats.duelsWon}V / ${p.stats.duelsLost}D`), stat('Mayor premio', fmt(p.stats.biggestWin)),
          stat('Tiempo de juego', p.playMs === null ? '🔒 Privado' : fmtPlay(p.playMs))))),
    canTalk ? h('div', { class: 'row gap wrap' }, h('button', { class: 'btn', onclick: () => { mm.close(); replyTo(p.username); } }, '✉️ Mensaje privado')) : null,
    canTalk ? giftCoins : null,
    canTalk ? h('p', { class: 'muted small' }, 'Para regalar o retar con un Pokémon usa la Pokédex o los Duelos.') : null,
    h('div', { class: 'mini-grid' }, owned.map((x) => h('div', { class: `mini-card r-${x.rarity}`, title: `${x.name} · ${rarityName(x.rarity)}` },
      h('img', { class: 'pixel', src: sprite(x.id, x.s > 0), alt: x.name, loading: 'lazy' }),
      h('span', { class: 'stars' }, '★'.repeat(Math.min(5, x.n))))))
  );
  const mm = modal(body, { title: 'Ficha de entrenador', wide: true });
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
  $('#emote-btn').addEventListener('click', openEmotes);
  document.querySelectorAll('.stab').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.id !== 'pane-' + b.dataset.pane));
  }));
  $('#social-btn').addEventListener('click', () => {
    document.body.classList.toggle('social-open');
    $('#chat-dot').classList.add('hidden');
  });
}

// Selector de emotes: tu compañero y tus Pokémon atrapados primero; con buscador para el resto.
function openEmotes() {
  const input = $('#chat-input');
  const own = Object.keys(S.me.collection).map(Number);
  const base = [...new Set([S.me.buddy?.id, ...own, 25, 133, 143, 39, 52, 54, 94, 150].filter(Boolean))];
  const grid = h('div', { class: 'emote-grid' });
  const fill = (q) => {
    const list = q ? S.data.dex.filter((p) => norm(p.name).includes(norm(q))).map((p) => p.id).slice(0, 60) : base.slice(0, 60);
    grid.replaceChildren(...list.map((id) => h('button', { type: 'button', class: 'emote-pick', title: emoteCode(id), onclick: () => {
      input.value = (input.value && !input.value.endsWith(' ') ? input.value + ' ' : input.value) + emoteCode(id) + ' ';
      close();
      input.focus();
    } }, h('img', { class: 'pixel', src: sprite(id), alt: S.dexById.get(id).name, loading: 'lazy' }))));
    if (!list.length) grid.append(h('p', { class: 'muted small' }, 'Ningún Pokémon con ese nombre.'));
  };
  const search = h('input', { placeholder: 'Buscar Pokémon…', oninput: (e) => fill(e.target.value) });
  const wrap = h('div', { class: 'popover emote-pop', onclick: (e) => e.stopPropagation() },
    search, grid, h('p', { class: 'muted small' }, 'También puedes escribir :nombre: (por ejemplo :pikachu:).'));
  const close = () => { wrap.remove(); document.removeEventListener('click', close); };
  fill('');
  document.body.append(wrap);
  setTimeout(() => document.addEventListener('click', close), 0);
  if (!matchMedia('(pointer: coarse)').matches) search.focus();
}

import { S, h, fmt, act, toast } from '../core.js';

export default {
  id: 'admin', title: 'Anfitrión', icon: '👑',
  async mount(root) {
    if (!S.me.isAdmin) { root.append(h('p', {}, 'Solo para el anfitrión.')); return; }
    const box = h('div', { class: 'stack' });
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '👑 Panel del anfitrión')), box);
    async function load() {
      const r = await act('admin:users');
      if (!r) return;
      box.replaceChildren(
        h('div', { class: 'cards3' },
          h('div', { class: 'card stack' }, h('h3', {}, '🔑 Código maestro'),
            h('code', { class: 'code' }, r.accessKey),
            h('p', { class: 'muted small' }, 'Sirve para registrarse siempre. Cámbialo con la variable ACCESS_KEY o borrando data/config.json.')),
          h('div', { class: 'card stack' }, h('h3', {}, '🎟️ Invitaciones de un solo uso'),
            h('button', { class: 'btn primary', onclick: async (e) => { const x = await act('admin:invite', {}, e.target); if (x) { toast('Invitación: ' + x.code, 'success', 8000); load(); } } }, 'Generar invitación'),
            h('div', { class: 'invites' }, r.invites.slice(-12).reverse().map((i) => h('div', { class: 'row between small' }, h('code', {}, i.code), h('span', { class: i.usedBy ? 'muted' : 'good' }, i.usedBy ? 'usada por ' + i.usedBy : 'libre'))))),
          h('div', { class: 'card stack' }, h('h3', {}, '💥 Bote actual'), h('b', { class: 'big-num' }, fmt(r.jackpot)))),
        h('div', { class: 'table-wrap' }, h('table', { class: 'admin-table' },
          h('thead', {}, h('tr', {}, ['Entrenador', 'Monedas', '✦', 'Nv', 'Dex', 'Estado', 'Acciones'].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.users.map((u) => h('tr', { class: u.banned ? 'banned' : '' },
            h('td', {}, u.online ? '🟢 ' : '⚪ ', h('b', {}, u.username), u.isAdmin ? ' 👑' : ''),
            h('td', {}, fmt(u.coins)), h('td', {}, fmt(u.dust)), h('td', {}, u.level), h('td', {}, u.dex),
            h('td', {}, u.banned ? 'Suspendido' : 'Activo'),
            h('td', {}, h('div', { class: 'row gap wrap' },
              h('button', { class: 'btn small', onclick: async () => {
                const v = prompt(`Monedas a sumar (negativo para restar) a ${u.username}:`, '1000');
                if (v !== null && await act('admin:coins', { username: u.username, delta: Number(v) })) load();
              } }, '±💰'),
              u.username !== S.me.username ? h('button', { class: 'btn small', onclick: async () => {
                if (await act('admin:ban', { username: u.username, banned: !u.banned })) load();
              } }, u.banned ? 'Readmitir' : 'Suspender') : null,
              h('button', { class: 'btn small', onclick: async () => {
                const pw = prompt(`Nueva contraseña para ${u.username} (mín. 6):`);
                if (pw && await act('admin:reset', { username: u.username, password: pw })) toast('Contraseña cambiada', 'success');
              } }, '🔑'),
              u.username !== S.me.username ? h('button', { class: 'btn small', onclick: async () => {
                if (await act('admin:admin', { username: u.username, isAdmin: !u.isAdmin })) load();
              } }, u.isAdmin ? 'Quitar 👑' : 'Hacer 👑') : null))))))));
    }
    load();
  },
};

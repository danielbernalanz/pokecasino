import { S, h, fmt, act, toast } from '../core.js';
import { economyPanel } from './econ.js';

export default {
  id: 'admin', title: 'Anfitrión', icon: '👑',
  async mount(root) {
    if (!S.me.isAdmin) { root.append(h('p', {}, 'Solo para el anfitrión.')); return; }
    const box = h('div', { class: 'stack' });
    let tab = 'players';
    const tabs = h('div', { class: 'seg' });
    root.append(h('div', { class: 'game-head' }, h('h1', {}, '👑 Panel del anfitrión')), tabs, box);
    const paintTabs = () => tabs.replaceChildren(...[['players', '👥 Jugadores'], ['economy', '🏦 Economía']].map(([id, l]) =>
      h('button', { class: 'btn' + (tab === id ? ' primary' : ''), onclick: () => { tab = id; paintTabs(); load(); } }, l)));
    paintTabs();
    async function load() {
      if (tab === 'economy') { box.replaceChildren(h('p', { class: 'muted' }, 'Cargando…')); const p = await economyPanel(); if (tab === 'economy') box.replaceChildren(p); return; }
      const r = await act('admin:users');
      if (!r) return;
      box.replaceChildren(
        h('div', { class: 'cards3' },
          S.data.openRegistration
            ? h('div', { class: 'card stack' }, h('h3', {}, '🔓 Registro abierto'),
              h('p', { class: 'muted small' }, 'Cualquiera con el enlace puede crearse cuenta (máx. 3 por conexión al día). Para volver a pedir código, quita la variable OPEN_REGISTRATION.'))
            : h('div', { class: 'card stack' }, h('h3', {}, '🔑 Código maestro'),
              h('code', { class: 'code' }, r.accessKey),
              h('p', { class: 'muted small' }, 'Sirve para registrarse siempre. Cámbialo con la variable ACCESS_KEY o borrando data/config.json.')),
          h('div', { class: 'card stack' }, h('h3', {}, '🎟️ Invitaciones de un solo uso'),
            h('button', { class: 'btn primary', onclick: async (e) => { const x = await act('admin:invite', {}, e.target); if (x) { toast('Invitación: ' + x.code, 'success', 8000); load(); } } }, 'Generar invitación'),
            h('div', { class: 'invites' }, r.invites.slice(-12).reverse().map((i) => h('div', { class: 'row between small' }, h('code', {}, i.code), h('span', { class: i.usedBy ? 'muted' : 'good' }, i.usedBy ? 'usada por ' + i.usedBy : 'libre'))))),
          h('div', { class: 'card stack' }, h('h3', {}, '💥 Bote actual'), h('b', { class: 'big-num' }, fmt(r.jackpot))),
          eventBox(), megaBox()),
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
    // Lanzar un evento durante unas horas (además del calendario semanal).
    function eventBox() {
      const ev = S.events || { all: [], active: [] };
      const sel = h('select', {}, ev.all.map((e) => h('option', { value: e.id }, `${e.icon} ${e.name}`)));
      const hours = h('input', { type: 'number', min: 0, max: 72, value: 3, style: { width: '80px' } });
      return h('div', { class: 'card stack' }, h('h3', {}, '🎉 Eventos'),
        h('p', { class: 'muted small' }, ev.active.length ? 'Activos: ' + ev.active.map((e) => `${e.icon} ${e.name}`).join(', ') : 'Ningún evento activo ahora.'),
        h('div', { class: 'row gap wrap' }, sel, hours, h('span', { class: 'muted small' }, 'horas')),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn primary', onclick: async (e) => { if (await act('admin:event', { id: sel.value, hours: Number(hours.value) }, e.target)) { toast('Evento actualizado', 'success'); setTimeout(load, 300); } } }, 'Lanzar'),
          h('button', { class: 'btn', onclick: async (e) => { if (await act('admin:event', { id: sel.value, hours: 0 }, e.target)) { toast('Evento cancelado (si era del calendario, sigue hasta medianoche)', 'info'); setTimeout(load, 300); } } }, 'Cancelar el lanzado')),
        h('p', { class: 'muted small' }, 'Calendario fijo: lunes Duelos, miércoles Misiones, viernes Mercado, sábado y domingo Variocolor + Compañero.'));
    }
    // Evento Megaevolución: reiniciar, alargar, terminar, Hora Mega y dar 💠 (pruebas).
    function megaBox() {
      const m = S.mega || {};
      const days = h('input', { type: 'number', min: 1, max: 30, value: 7, style: { width: '70px' } });
      const who = h('input', { placeholder: 'jugador', style: { width: '110px' } });
      const fr = h('input', { type: 'number', value: 100, style: { width: '80px' } });
      const run = (op, extra = {}) => async (e) => { if (await act('admin:mega', { op, days: Number(days.value), ...extra }, e.target)) { toast('Megaevolución actualizada', 'success'); setTimeout(load, 300); } };
      return h('div', { class: 'card stack' }, h('h3', {}, '💠 Megaevolución'),
        h('p', { class: 'muted small' }, m.active ? `Activa hasta ${new Date(m.endsAt).toLocaleString('es-ES')}` : 'Terminada (la siguiente empieza sola 7 días después).'),
        h('div', { class: 'row gap wrap' }, days, h('span', { class: 'muted small' }, 'días'),
          h('button', { class: 'btn primary', onclick: run('start') }, 'Nueva edición'), h('button', { class: 'btn', onclick: run('extend') }, 'Alargar'),
          h('button', { class: 'btn', onclick: run('stop') }, 'Terminar'), h('button', { class: 'btn', onclick: run('hour') }, '⚡ Hora Mega ya')),
        h('div', { class: 'row gap wrap' }, who, fr, h('button', { class: 'btn', onclick: (e) => run('give', { username: who.value, frags: Number(fr.value), earned: true })(e) }, 'Dar 💠')));
    }
    load();
  },
};

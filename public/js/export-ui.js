// Diálogo de exportación (Caja PC y equipos de Combates): copiar JSON / descargar .json / copiar para Showdown.
import { h, toast, sfx, modal } from './core.js';

const today = () => new Date().toISOString().slice(0, 10);
export const fileName = (what, user) => `pokecasino-${what}-${String(user || 'jugador').replace(/[^A-Za-z0-9_-]/g, '')}-${today()}.json`;

// Copia al portapapeles; false si el navegador no lo permite (se usa el área de texto como alternativa).
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* sin permiso: alternativa */ }
  return false;
}

// Descarga con Blob + a[download] (no necesita ajustes de CSP: no es una carga de recursos).
export function downloadText(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
  const a = h('a', { href: url, download: name, class: 'hidden' });
  document.body.append(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

const frame = () => new Promise((r) => setTimeout(r, 0)); // deja pintar «Preparando…» antes de un trabajo largo

// opts: { title, intro, choices: [{ id, label }] | null, load(choiceId) → { obj, count, label? }, file(obj), showdown: bool }
// `obj` es el objeto de exportación; si trae `showdown` (texto) se ofrece «Copiar para Showdown» y no se mete en el JSON.
export function exportDialog(opts) {
  let choice = opts.choices ? opts.choices[0].id : null;
  let data = null; // { json, showdown, obj, count }
  let seq = 0;
  const status = h('p', { class: 'small muted', 'data-testid': 'export-status' }, 'Preparando…');
  const fallback = h('div', { class: 'hidden stack' });
  const mk = (text, cls, fn, tid) => h('button', { class: 'btn ' + cls, type: 'button', disabled: true, 'data-testid': tid, onclick: fn }, text);
  const showFallback = (text, why) => {
    const ta = h('textarea', { readonly: true, rows: 6, class: 'export-text', 'aria-label': 'Texto para copiar' });
    ta.value = text;
    fallback.classList.remove('hidden');
    fallback.replaceChildren(h('p', { class: 'small' }, why), ta);
    ta.focus(); ta.select();
  };
  const copy = async (text, what) => {
    if (await copyText(text)) { sfx('click'); fallback.classList.add('hidden'); toast(`${what} copiado al portapapeles.`, 'success'); }
    else showFallback(text, 'El navegador no deja copiar solo: el texto está seleccionado, pulsa Ctrl+C (o mantén pulsado y Copiar).');
  };
  const bCopy = mk('📋 Copiar JSON', 'primary', () => copy(data.json, 'JSON'), 'export-copy');
  const bDown = mk('💾 Descargar .json', '', () => { downloadText(opts.file(data.obj), data.json); sfx('click'); toast('Archivo descargado.', 'success'); }, 'export-download');
  const bSd = opts.showdown ? mk('🎮 Copiar para Showdown', '', () => copy(data.showdown, 'Texto de Showdown'), 'export-showdown') : null;
  const btns = [bCopy, bDown, bSd].filter(Boolean);

  async function refresh() {
    const my = ++seq;
    btns.forEach((b) => { b.disabled = true; });
    status.textContent = 'Preparando…';
    fallback.classList.add('hidden');
    try {
      const r = await opts.load(choice);
      await frame();
      if (my !== seq) return;
      const { showdown, ...clean } = r.obj;
      const json = JSON.stringify(clean, null, 2);
      data = { obj: clean, json, showdown: showdown || '', count: r.count };
      status.textContent = `${r.count} ejemplar${r.count === 1 ? '' : 'es'} · ${(json.length / 1024).toFixed(json.length > 10240 ? 0 : 1)} kB`;
      btns.forEach((b) => { b.disabled = !r.count || (b === bSd && !data.showdown); });
      if (!r.count) status.textContent = 'No hay nada que exportar con esa selección.';
    } catch (e) {
      if (my === seq) status.textContent = e.message || 'No se pudo preparar la exportación.';
    }
  }
  const radios = opts.choices ? h('div', { class: 'stack export-choices' }, opts.choices.map((c, i) =>
    h('label', { class: 'pc-check' }, h('input', { type: 'radio', name: 'export-what', value: c.id, checked: i === 0, onchange: () => { choice = c.id; refresh(); } }), c.label))) : null;
  const body = h('div', { class: 'stack' }, opts.intro ? h('p', { class: 'small muted' }, opts.intro) : null, radios, status,
    h('div', { class: 'row gap wrap' }, ...btns), fallback);
  const m = modal(body, { title: opts.title });
  refresh();
  return m;
}

// Tema día / «Modo noche». Se carga antes de pintar para evitar el parpadeo.
// Sin preferencia guardada sigue al sistema (prefers-color-scheme).
(function () {
  var KEY = 'theme';
  function saved() { try { var v = localStorage.getItem(KEY); return v === 'night' || v === 'day' ? v : null; } catch (e) { return null; } }
  function system() { try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day'; } catch (e) { return 'day'; } }
  function apply(t) {
    document.documentElement.setAttribute('data-theme', t);
    var m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', t === 'night' ? '#8f2412' : '#e3350d');
  }
  window.PCTheme = {
    get: function () { return document.documentElement.getAttribute('data-theme') || 'day'; },
    saved: saved,
    set: function (t) { try { localStorage.setItem(KEY, t); } catch (e) { /* no se recuerda */ } apply(t); },
    auto: function () { try { localStorage.removeItem(KEY); } catch (e) { /* nada */ } apply(system()); },
  };
  apply(saved() || system());
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (!saved()) apply(system()); }); } catch (e) { /* navegador antiguo */ }
})();

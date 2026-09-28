// Runs before the first paint (a classic, blocking script — the CSP allows no
// inline script), so a light-theme viewer never sees a dark flash.
// The same rules as portal/src/lib/theme.ts; keep the two in step.
(function () {
  var pref = 'system';
  try { pref = localStorage.getItem('stratos.portal.theme') || 'system'; } catch (e) { /* storage blocked */ }
  if (pref !== 'light' && pref !== 'dark') pref = 'system';
  var dark = true;
  try { dark = !window.matchMedia('(prefers-color-scheme: light)').matches; } catch (e) { /* keep dark */ }
  var root = document.documentElement;
  root.setAttribute('data-theme', pref === 'system' ? (dark ? 'dark' : 'light') : pref);
  root.setAttribute('data-theme-pref', pref);
})();

// Runs before first paint so a saved light/dark choice never flashes.
// Kept as a same-origin file because the CSP forbids inline scripts.
try {
  var t = JSON.parse(localStorage.getItem('redline:settings:v1') || '{}').theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}

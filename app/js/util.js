export const $ = id => document.getElementById(id);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, m =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

export const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);

export function randInt(n) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}

export const rollOnce = () => randInt(6) + 1;

export function rollPair() {
  let a, b;
  do { a = rollOnce(); b = rollOnce(); } while (a === b);
  return [a, b];
}

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function screenFromPath(path) {
  const map = { '/': 'sc-menu', '/settings': 'sc-settings', '/edit': 'sc-edit', '/battle': 'sc-battle', '/select': 'sc-pick', '/lan': 'sc-lan', '/dice': 'sc-dice', '/mods': 'sc-mods', '/library': 'sc-library' };
  return map[path] || 'sc-menu';
}

export function show(id) {
  window.scrollTo(0, 0);
  document.documentElement.className = document.documentElement.className.replace(/\binit-\S+/g, '').trim();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  const el = $(id);
  el.classList.add('on');
  el.scrollTop = 0;
  const route = { 'sc-menu': '/', 'sc-settings': '/settings', 'sc-edit': '/edit', 'sc-battle': '/battle', 'sc-pick': '/select', 'sc-lan': '/lan', 'sc-dice': '/dice', 'sc-mods': '/mods', 'sc-library': '/library' }[id];
  if (route && location.pathname !== route) history.pushState({ screen: id }, '', route);
  window.dispatchEvent(new CustomEvent('screen-changed', { detail: { screen: id } }));
}

// 浏览器前进/后退
window.addEventListener('popstate', () => {
  const id = screenFromPath(location.pathname);
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  const el = $(id);
  if (el) { el.classList.add('on'); el.scrollTop = 0; }
  window.dispatchEvent(new CustomEvent('screen-changed', { detail: { screen: id } }));
});

export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}
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

export function show(id) {
  window.scrollTo(0, 0);
  document.documentElement.classList.remove('init-menu', 'init-sc-settings', 'init-sc-edit');
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  const el = $(id);
  el.classList.add('on');
  el.scrollTop = 0;
  // 保存可恢复的屏幕到 sessionStorage（按标签页隔离，新标签页从主界面开始）
  const saveable = ['sc-settings', 'sc-edit'];
  if (saveable.includes(id)) sessionStorage.setItem('saved_screen', id);
  else sessionStorage.removeItem('saved_screen');
  window.dispatchEvent(new CustomEvent('screen-changed', { detail: { screen: id } }));
}

export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 1800);
}
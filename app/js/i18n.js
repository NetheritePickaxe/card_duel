let strings = {};
let lang = 'zh_cn';

export function t(key, params) {
  let s = strings[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = String(s).replaceAll(`{${k}}`, v);
    }
  }
  return s;
}

export function getLang() { return lang; }

export async function setLocale(code) {
  lang = code;
  strings = (await import(`../locales/${code}.js`)).default;
  localStorage.setItem('locale', code);
  document.documentElement.lang = code.replace('_', '-');
  window.dispatchEvent(new CustomEvent('locale-changed'));
}

export async function initLocale() {
  const saved = localStorage.getItem('locale');
  let detected = 'zh_cn';
  try {
    if (navigator && navigator.language) detected = navigator.language.startsWith('zh') ? 'zh_cn' : 'en_us';
  } catch (e) { /* ignore */ }
  const code = saved || detected;
  await setLocale(code);
}
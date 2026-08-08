let strings = {};
let lang = 'zh_cn';
let extraLangs = {};

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

export function clearTranslations() {
  strings = {};
  extraLangs = {};
}

export function addTranslation(code, dict) {
  if (!extraLangs[code]) extraLangs[code] = {};
  Object.assign(extraLangs[code], dict);
  if (code === lang) Object.assign(strings, dict);
}

export async function setLocale(code) {
  lang = code;
  strings = {};
  // 加载 vanilla 模组的翻译
  try {
    const res = await fetch(`card_duel/assets/lang/${code}.json`);
    if (res.ok) strings = await res.json();
  } catch (e) { /* ignore */ }
  // 合并模组额外翻译
  if (extraLangs[code]) Object.assign(strings, extraLangs[code]);
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
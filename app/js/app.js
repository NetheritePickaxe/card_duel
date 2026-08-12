import { $, show, toast, screenFromPath } from './util.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { t, initLocale, setLocale, getLang } from './i18n.js?v=__VERSION__';
import { initAudio, setTypeVolume, getTypeVolume, setMasterVolume, getMasterVolume, updateBGM } from './sound.js?v=__VERSION__';
import { loadMods, reloadMods, getMods, getModConfigSchema, renderModConfig, importMod, deleteMod, getModOrder, setModOrder, setModEnabled, isModEnabled } from './modloader.js?v=__VERSION__';
import { initEffectMeta } from './data.js?v=__VERSION__';
import { loadEngine } from './engine.js?v=__VERSION__';
import { startSkirmish, startCampaign, openLAN, backMenu, quitBattle, pickRole, closeModal, setPick, setPickRandom, goDice, updatePlayerCount, togglePickTeam, togglePickHuman } from './pick.js?v=__VERSION__';
import { openEditor, setTab, editorActions } from './editor.js?v=__VERSION__';
import { openLibrary, libraryActions } from './library.js?v=__VERSION__';
import { playCardClick, endTurnClick } from './battle.js?v=__VERSION__';
import { lanCreate, lanJoinRoom, lanConnect, lanDisconnect, addServer, removeServer, renderServerList, normalizeServerUrl, scanLan, lanSetTeam, lanSetReady, lanAddCpu } from './lan.js?v=__VERSION__';

/* Tauri 原生窗口无网页地址相关行为（仅 web 端复制） */
const IS_TAURI = '__TAURI__' in window;

/* ============ i18n ============ */

function updateI18nElements() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (val !== key) el.textContent = val;
  });
  document.title = t('menu.title');
  const sel = $('lang-select');
  if (sel) sel.value = getLang();
}

window.addEventListener('locale-changed', () => {
  updateI18nElements();
  // Re-render current screen with new language
  if (state.PHASE_BATTLE && state.BATTLE) {
    renderBattle();
  } else if ($('sc-edit').classList.contains('on')) {
    renderEditList();
  } else if ($('sc-pick').classList.contains('on')) {
    renderSlots();
  }
});

/* ============ 事件委托 ============ */

const actionMap = {
  'start-skirmish': () => startSkirmish(),
  'start-campaign': () => startCampaign(),
  'open-lan': () => openLAN(),
  'open-editor': () => openEditor(),
  'open-library': () => openLibrary(),
  'open-mods': () => { show('sc-mods'); renderModList(); },
  'open-settings': () => openSettings(),
  'set-accent': (el) => setAccent(el.dataset.color),
  'pick-custom': (el) => openColorPop(el),
  'cp-ok': () => applyCp(),
  'cp-reset': () => resetCp(),
  'cp-cancel': () => closeCp(),
  'back-menu': () => backMenu(),
  'quit-battle': () => quitBattle(),
  'tab-subfaction': () => setTab('subfaction'),
  'tab-card': () => setTab('card'),
  'close-modal': () => closeModal(),
  'go-dice': () => goDice(),
  'lan-create': () => lanCreate(),
  'pick-role': (el) => pickRole(parseInt(el.dataset.slot)),
  'play-card': (el) => playCardClick(parseInt(el.dataset.pi), parseInt(el.dataset.index)),
  'end-turn': (el) => endTurnClick(parseInt(el.dataset.pi)),
  'lan-join-room': (el) => lanJoinRoom(el.dataset.room),
  'server-add': () => {
    const val = $('server-input').value;
    if (val && addServer(val)) { renderServerList(); $('server-input').value = ''; }
  },
  'server-connect': (el) => lanConnect(el.dataset.url),
  'server-connect-input': () => lanConnect($('server-input').value),
  'server-del': (el) => removeServer(el.dataset.url),
  'lan-scan': () => scanLan(),
  'lan-disconnect': () => lanDisconnect(),
  'lan-add-cpu': (el) => lanAddCpu(parseInt(el.dataset.side)),
  'lan-set-team': (el) => lanSetTeam(parseInt(el.dataset.side), parseInt(el.dataset.team)),
  'lan-trigger-ready': () => {
    const mySide = state.LAN.side;
    const myReady = state.LAN.ready[mySide];
    lanSetReady(mySide, !myReady);
  },
  'set-pick': (el) => setPick(parseInt(el.dataset.slot), parseInt(el.dataset.index)),
  'pick-random': (el) => setPickRandom(parseInt(el.dataset.slot)),
  ...editorActions,
  ...libraryActions,
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const handler = actionMap[action];
  if (handler) {
    e.preventDefault();
    handler(el);
  }
});

/* 语言切换 */
$('lang-select').addEventListener('change', (e) => {
  setLocale(e.target.value);
});

/* 主题切换 */
function setTheme(theme) {
  if (theme === 'system') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (e) => { document.documentElement.dataset.theme = e.matches ? '' : 'light'; };
    apply(mq);
    mq.addEventListener('change', apply);
  } else {
    document.documentElement.dataset.theme = theme === 'dark' ? '' : 'light';
  }
  localStorage.setItem('theme', theme);
}
const savedTheme = localStorage.getItem('theme') || 'system';
$('theme-select').value = savedTheme;
setTheme(savedTheme);
$('theme-select').addEventListener('change', (e) => setTheme(e.target.value));

// 主界面标语开关
const splashToggle = $('splash-toggle');
if (splashToggle) {
  splashToggle.checked = localStorage.getItem('_show_splash') !== '0';
  splashToggle.addEventListener('change', () => {
    localStorage.setItem('_show_splash', splashToggle.checked ? '1' : '0');
    renderMenuAddr();
  });
}

/* ============ 主题色 ============ */
const ACCENTS = ['#d9a441', '#e8833f', '#6fae4e', '#4d8fd4', '#9a6fd6', '#e96ba3', '#37a3a0'];
const ACCENT_NAMES = {
  '#d9a441': '金色', '#e8833f': '橙色', '#6fae4e': '绿色',
  '#4d8fd4': '蓝色', '#9a6fd6': '紫色', '#e96ba3': '粉色', '#37a3a0': '青色',
};
const ACCENT_DEFAULT = '#d9a441';
const ACCENT_CUSTOM_KEY = 'accent_custom';

function getSavedAccent() {
  return localStorage.getItem('accent') || ACCENT_DEFAULT;
}

function getCustomAccent() {
  return localStorage.getItem(ACCENT_CUSTOM_KEY) || ACCENT_DEFAULT;
}

function setAccent(color) {
  document.documentElement.style.setProperty('--acc', color);
  localStorage.setItem('accent', color);
  if (!accentDragging) renderAccentRow();
}

function pickCustomAccent(color) {
  localStorage.setItem(ACCENT_CUSTOM_KEY, color);
  setAccent(color);
}

function renderAccentRow() {
  const row = $('accent-row');
  if (!row) return;
  const current = getSavedAccent();
  const custom = getCustomAccent();
  const isPreset = ACCENTS.includes(current);
  const hasCustom = localStorage.getItem(ACCENT_CUSTOM_KEY) !== null;
  const customBg = hasCustom ? custom : '#555';
  row.innerHTML = ACCENTS.map(c =>
    `<button class="accent-swatch ${c === current ? 'on' : ''}" data-action="set-accent" data-color="${c}" style="background:${c}" title="${ACCENT_NAMES[c] || c}"></button>`
  ).join('')
    + `<button class="accent-swatch custom ${custom === current && !isPreset ? 'on' : ''}" data-action="pick-custom" title="自定义" style="background:${customBg}"></button>`;
}

/* 拖拽连续选色 */
let accentDragging = false;
document.addEventListener('mousedown', (e) => {
  const b = e.target.closest('button.accent-swatch');
  if (!b || !b.dataset.color) return;
  accentDragging = true;
  e.preventDefault();
  setAccent(b.dataset.color);
});
document.addEventListener('mousemove', (e) => {
  if (!accentDragging) return;
  const b = e.target.closest('button.accent-swatch');
  if (b && b.dataset.color) setAccent(b.dataset.color);
});
document.addEventListener('mouseup', () => {
  if (accentDragging) {
    accentDragging = false;
    renderAccentRow();
  }
});

/* ============ 主界面标题：点标题变色 + web 端复制地址 ============ */
function copyTextFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true, () => copyTextFallback(text));
  }
  return Promise.resolve(copyTextFallback(text));
}

function isPrivateIp(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip || '');
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// 服务端注入的占位符是顶层 const（词法作用域），不会挂到 window 上，需用裸标识符读取
function ipListGlobal() {
  try { return Array.isArray(__IP_LIST__) ? __IP_LIST__ : []; } catch (e) { return []; }
}
function phoneIpGlobal() {
  try { return typeof __PHONE_IP__ === 'string' ? __PHONE_IP__ : ''; } catch (e) { return ''; }
}

function getLanIp(cb) {
  let done = false;
  const finish = (ip) => { if (!done) { done = true; cb(ip || null); } };

  // Tauri：直接调用 Rust 的 lan_ip（src-tauri/src/net.rs）
  if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
    window.__TAURI__.core.invoke('lan_ip')
      .then(ip => { if (isPrivateIp(ip)) finish(ip); else webrtcLanIp(finish); })
      .catch(() => webrtcLanIp(finish));
    return;
  }
  // 服务端注入（server.rs）：__PHONE_IP__ = 最优局域网 IP
  const phoneIp = phoneIpGlobal();
  if (isPrivateIp(phoneIp)) {
    finish(phoneIp);
    return;
  }
  const ipList = ipListGlobal();
  const hit = ipList.find(ip => isPrivateIp(ip));
  if (hit) { finish(hit); return; }
  // 页面已通过局域网地址打开
  if (isPrivateIp(location.hostname)) { finish(location.hostname); return; }

  // WebRTC 兜底（非 localhost 的局域网 HTTP 页面可正常获取）
  webrtcLanIp(finish);
}

function webrtcLanIp(finish) {
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    window.__lanPc = pc;
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(e.candidate.candidate || '');
      if (m && isPrivateIp(m[1])) finish(m[1]);
    };
    pc.createDataChannel('lan');
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => finish(null));
    setTimeout(() => finish(null), 1200);
  } catch (e) {
    finish(null);
  }
}

function buildShareUrl(ip) {
  const host = ip || location.hostname || 'localhost';
  const port = location.port || '8788';
  const scheme = (location.protocol === 'http:' || location.protocol === 'https:')
    ? location.protocol
    : 'http:';
  const portPart = (port && port !== '80' && port !== '443') ? ':' + port : '';
  return scheme + '//' + host + portPart + '/';
}

const menuTitle = document.querySelector('#sc-menu .m-title');
if (menuTitle) {
  menuTitle.addEventListener('click', () => {
    menuTitle.classList.add('anim');
    clearTimeout(menuTitle._animT);
    menuTitle._animT = setTimeout(() => menuTitle.classList.remove('anim'), 900);
  });
}

// 从本地 splash.txt 随机取一行作为提示文本
function showSplash(label) {
  fetch('card_duel/assets/splash.txt', { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('fail'); return r.text(); })
    .then(text => {
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      if (lines.length && label) {
        label.textContent = lines[Math.floor(Math.random() * lines.length)];
      }
    })
    .catch(() => { /* ignore */ });
}

// 菜单下方显示地址（点击一言切换展开，点击地址复制）
function renderMenuAddr() {
  const el = $('maddr');
  if (!el) return;
  el.classList.remove('open');
  el.innerHTML = '<div class="addr-label">' + t('menu.addr') + '</div><div class="addr-body"></div>';
  const label = el.querySelector('.addr-label');
  if (localStorage.getItem('_show_splash') !== '0') {
    el.style.display = '';
    showSplash(label);
  } else {
    el.style.display = 'none';
    return;
  }
  el.querySelector('.addr-label').addEventListener('click', (e) => {
    e.stopPropagation();
    el.classList.toggle('open');
  });
  getLanIp(ip => {
    const pi = ip || location.hostname || 'localhost';
    const port = location.port || '8788';
    const url = (h) => 'http://' + h + ':' + port + '/';
    const extra = ipListGlobal().filter(h => h && h !== pi);
    const extraHtml = extra.length ? '<div class="addr-extra">' + extra.map(url).join(' · ') + '</div>' : '';
    const body = el.querySelector('.addr-body');
    body.innerHTML = url(pi) + extraHtml;
    body.addEventListener('click', (e) => {
      e.stopPropagation();
      getLanIp(ip2 => {
        copyToClipboard(buildShareUrl(ip2)).then(ok => { if (ok) toast(t('menu.url_copied')); });
      });
    });
  });
}

/* ============ 自定义色取色面板 ============ */
const cpEl = $('cp-pop');
const cpBox = cpEl.querySelector('.cp-box');
const cpPad = cpEl.querySelector('#cp-pad');
const cpHue = cpEl.querySelector('#cp-hue');
const cpPrev = cpEl.querySelector('#cp-preview');
const cpHex = cpEl.querySelector('#cp-hex');
const cpX = cpPad.getContext('2d');
const cpY = cpHue.getContext('2d');
let cpCur = { h: 40, s: 1, v: 1 };

function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgb.map(n => Math.round((n + m) * 255));
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  if (!m) return [154, 154, 154];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(rgb) {
  return '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('');
}

function rgbToHsv(rgb) {
  let [r, g, b] = rgb.map(n => n / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: h < 0 ? h + 360 : h, s: mx === 0 ? 0 : d / mx, v: mx };
}

function cpColor() {
  const rgb = hsvToRgb(cpCur.h, cpCur.s, cpCur.v);
  return { rgb: `rgb(${rgb.join(',')})`, hex: rgbToHex(rgb) };
}

function drawPad() {
  const w = cpPad.width, h = cpPad.height;
  const base = hsvToRgb(cpCur.h, 1, 1);
  cpX.fillStyle = `rgb(${base.join(',')})`;
  cpX.fillRect(0, 0, w, h);
  let g = cpX.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
  cpX.fillStyle = g; cpX.fillRect(0, 0, w, h);
  let g2 = cpX.createLinearGradient(0, 0, 0, h);
  g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000');
  cpX.fillStyle = g2; cpX.fillRect(0, 0, w, h);
  const px = Math.round(cpCur.s * w), py = Math.round((1 - cpCur.v) * h);
  cpX.beginPath();
  cpX.arc(px, py, 6, 0, Math.PI * 2);
  cpX.lineWidth = 2;
  cpX.strokeStyle = '#fff';
  cpX.stroke();
  cpX.beginPath();
  cpX.arc(px, py, 5, 0, Math.PI * 2);
  cpX.lineWidth = 1;
  cpX.strokeStyle = 'rgba(0,0,0,.6)';
  cpX.stroke();
}

function drawHue() {
  const w = cpHue.width, h = cpHue.height;
  for (let x = 0; x < w; x++) {
    const rgb = hsvToRgb(x / w * 360, 1, 1);
    cpY.fillStyle = `rgb(${rgb.join(',')})`;
    cpY.fillRect(x, 0, 2, h);
  }
  const kx = Math.round(cpCur.h / 360 * w);
  cpY.fillStyle = 'rgba(0,0,0,.55)';
  cpY.fillRect(kx - 1, 0, 2, h);
  cpY.fillStyle = 'rgba(255,255,255,.8)';
  cpY.fillRect(kx + 1, 0, 1, h);
  cpY.fillRect(kx - 2, 0, 1, h);
}

function cpRefresh() {
  const c = cpColor();
  cpPrev.style.background = c.rgb;
  cpHex.value = c.hex;
  const btn = $('cp-ok-btn');
  if (btn) btn.style.background = c.hex;
  drawHue();
  drawPad();
}

function openColorPop(el) {
  const rgb = hexToRgb(getCustomAccent());
  const hsv = rgbToHsv(rgb);
  cpCur = { h: hsv.h, s: hsv.s, v: hsv.v };
  const br = el.getBoundingClientRect();
  cpBox.style.left = Math.max(8, Math.min(br.left, innerWidth - 256)) + 'px';
  cpBox.style.top = Math.min(br.top + br.height + 10, innerHeight - 240) + 'px';
  cpEl.style.display = 'block';
  cpRefresh();
}

function closeCp() {
  cpEl.style.display = 'none';
}

function applyCp() {
  pickCustomAccent(cpColor().hex);
  closeCp();
}

function resetCp() {
  localStorage.removeItem(ACCENT_CUSTOM_KEY);
  setAccent(ACCENT_DEFAULT);
  closeCp();
}

function padPos(e) {
  const r = cpPad.getBoundingClientRect();
  cpCur.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  cpCur.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
  cpRefresh();
}

function huePos(e) {
  const r = cpHue.getBoundingClientRect();
  cpCur.h = Math.max(0, Math.min(360, (e.clientX - r.left) / r.width * 360));
  cpRefresh();
}

let cpDrag = null;
cpPad.addEventListener('pointerdown', (e) => { cpDrag = 'pad'; cpPad.setPointerCapture(e.pointerId); padPos(e); });
cpPad.addEventListener('pointermove', (e) => { if (cpDrag === 'pad') padPos(e); });
cpPad.addEventListener('pointerup', () => { cpDrag = null; });
cpHue.addEventListener('pointerdown', (e) => { cpDrag = 'hue'; cpHue.setPointerCapture(e.pointerId); huePos(e); });
cpHue.addEventListener('pointermove', (e) => { if (cpDrag === 'hue') huePos(e); });
cpHue.addEventListener('pointerup', () => { cpDrag = null; });

// 手动输入 hex 值
cpHex.addEventListener('change', () => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(cpHex.value.trim());
  if (!m) return;
  const rgb = hexToRgb('#' + m[1]);
  const hsv = rgbToHsv(rgb);
  cpCur = { h: hsv.h, s: hsv.s, v: hsv.v };
  cpRefresh();
});

function applyAccent() {
  document.documentElement.style.setProperty('--acc', getSavedAccent());
}

/* ============ 设置页打开：tab 重置为默认 ============ */
function resetSettingsTab() {
  document.querySelectorAll('#sc-settings .tabs .tab').forEach((b, i) => b.classList.toggle('on', i === 0));
  ['lang', 'sound'].forEach((id, i) => {
    const el = $('settings-' + id);
    if (el) el.style.display = i === 0 ? 'block' : 'none';
  });
}

function openSettings() {
  localStorage.removeItem('saved_settings_tab');
  resetSettingsTab();
  renderAccentRow();
  show('sc-settings');
}

/* ============ textarea 自动增高 ============ */
function autoGrowTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el && el.tagName === 'TEXTAREA') autoGrowTextarea(el);
});

/* 设置标签切换 */
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-action="settings-tab"]');
  if (!tab) return;
  const t = tab.dataset.tab;
  document.querySelectorAll('#sc-settings .tabs .tab').forEach(b => b.classList.toggle('on', b === tab));
  ['lang', 'sound'].forEach(id => {
    const el = $('settings-' + id);
    if (el) el.style.display = id === t ? 'block' : 'none';
  });
});

// 音量切换
document.querySelectorAll('.vol-slider').forEach(slider => {
  const type = slider.dataset.type;
  if (type === 'master') {
    slider.value = getMasterVolume();
  } else {
    slider.value = getTypeVolume(type);
  }
  const valueSpan = slider.nextElementSibling;
  const setFill = (v) => slider.style.setProperty('--fill', Math.round(v * 100) + '%');
  setFill(slider.value);
  if (valueSpan) valueSpan.textContent = Math.round(slider.value * 100) + '%';
  slider.addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    if (type === 'master') {
      setMasterVolume(v);
    } else {
      setTypeVolume(type, v);
    }
    setFill(v);
    if (valueSpan) valueSpan.textContent = Math.round(v * 100) + '%';
  });
  // 点击标签或数值切换静音/恢复
  const row = slider.closest('.frow');
  if (row) {
    const label = row.querySelector('label');
    const toggleMute = () => {
      const cur = parseFloat(slider.value);
      if (cur > 0) {
        slider.dataset.prev = cur;
        const v = 0;
        if (type === 'master') setMasterVolume(v); else setTypeVolume(type, v);
        slider.value = v; setFill(v);
        if (valueSpan) valueSpan.textContent = '0%';
      } else {
        const prev = parseFloat(slider.dataset.prev) || 0.5;
        const v = Math.min(1, Math.max(0, prev));
        if (type === 'master') setMasterVolume(v); else setTypeVolume(type, v);
        slider.value = v; setFill(v);
        if (valueSpan) valueSpan.textContent = Math.round(v * 100) + '%';
      }
    };
    if (label) label.addEventListener('click', toggleMute);
    if (valueSpan) valueSpan.addEventListener('click', toggleMute);
  }
});

/* BGM 开关 */

/* 多人混战人数选择 */
document.addEventListener('change', e => {
  if (e.target.id === 'pk-player-count') {
    updatePlayerCount();
  }
});

document.addEventListener('click', e => {
  if (e.target.closest('[data-action="toggle-pick-team"]')) {
    const el = e.target.closest('[data-action="toggle-pick-team"]');
    togglePickTeam(parseInt(el.dataset.slot));
  }
  if (e.target.closest('[data-action="toggle-pick-human"]')) {
    const el = e.target.closest('[data-action="toggle-pick-human"]');
    togglePickHuman(parseInt(el.dataset.slot));
  }
});

/* 模组管理 */
function renderModList() {
  const list = $('mod-list');
  if (!list) return;
  const mods = getMods();
  list.innerHTML = mods.map((m, i) => `
    <div class="mod-item" data-mod-id="${m.id}">
      <span class="mod-drag" data-action="mod-drag">☰</span>
      <span class="mod-name">${m.meta.name || m.id}</span>
      <span class="dim" style="font-size:11px">v${m.meta.version || '?'} ${m.builtin ? '(' + t('settings.mods_builtin') + ')' : ''}</span>
      <span class="sp"></span>
      ${m.builtin ? '' : `<button class="mod-up" data-action="mod-up" data-idx="${i}" style="padding:2px 6px">▲</button>
      <button class="mod-dn" data-action="mod-dn" data-idx="${i}" style="padding:2px 6px">▼</button>
      <button class="mod-del" data-action="mod-del" data-idx="${i}" style="padding:2px 6px;color:var(--red)">✕</button>`}
      <label class="mod-toggle"><input type="checkbox" ${m.enabled ? 'checked' : ''} ${m.builtin ? 'disabled' : ''} data-action="mod-toggle" data-idx="${i}"></label>
    </div>
    <div class="mod-config" id="mod-config-${m.id}" style="display:none"></div>`).join('');
}

$('mod-list').addEventListener('click', (e) => {
  const item = e.target.closest('.mod-item');
  if (!item) return;
  const id = item.dataset.modId;
  const cfgDiv = $('mod-config-' + id);
  if (e.target.closest('[data-action="mod-up"]')) {
    const idx = parseInt(e.target.dataset.idx);
    const order = getModOrder();
    if (idx > 0) [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
    setModOrder(order);
    renderModList();
  } else if (e.target.closest('[data-action="mod-dn"]')) {
    const idx = parseInt(e.target.dataset.idx);
    const order = getModOrder();
    if (idx < order.length - 1) [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
    setModOrder(order);
    renderModList();
  } else if (e.target.closest('[data-action="mod-del"]')) {
    const idx = parseInt(e.target.dataset.idx);
    const mods = getMods();
    deleteMod(mods[idx].id).then(() => renderModList());
  } else if (e.target.closest('[data-action="mod-toggle"]')) {
    const idx = parseInt(e.target.dataset.idx);
    const mods = getMods();
    setModEnabled(mods[idx].id, e.target.checked);
  } else {
    // 点击模组名称展开/收起配置
    const wasVisible = cfgDiv.style.display !== 'none';
    cfgDiv.style.display = wasVisible ? 'none' : 'block';
    if (!wasVisible) renderModConfig(id, cfgDiv);
  }
});

$('mod-import-btn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      await importMod(file);
      alert(t('settings.mods_imported'));
      renderModList();
    } catch (e) {
      alert(t('settings.mods_invalid') + ': ' + e.message);
    }
  };
  input.click();
});

$('mod-apply-btn').addEventListener('click', async () => {
  if (state.PHASE_BATTLE && state.BATTLE && !state.BATTLE.winner) {
    if (!confirm(t('settings.mods_confirm_quit'))) return;
  }
  state.BATTLE = null;
  state.PHASE_BATTLE = false;
  state.LAN = null;
  show('sc-menu');
  await reloadMods();
});

window.addEventListener('screen-changed', () => updateBGM());

/* ============ 启动 ============ */
initAudio();
applyAccent();
renderAccentRow();
function showInitScreen() {
  const initScreen = screenFromPath(location.pathname);
  if (initScreen === 'sc-settings') {
    show('sc-settings');
  } else if (initScreen === 'sc-edit') {
    const savedEdit = JSON.parse(localStorage.getItem('saved_edit') || '{}');
    if (savedEdit.tab) setTab(savedEdit.tab);
    show('sc-edit');
  } else if (initScreen === 'sc-pick') {
    show('sc-pick');
    renderSlots();
  } else {
    show(initScreen);
  }
}

const initLocaleLoaded = initLocale();
const loadModsLoaded = loadMods().then(() => {
  updateBGM();
  renderModList();
});
const engineLoaded = loadEngine().then(() => {
  initEffectMeta();
});
// 等 locale 与 mod 翻译就绪后再显示首屏并统一应用 i18n，
// 避免刷新瞬间出现 HTML 兜底文本或翻译键。
// 不等待 wasm 引擎，不阻塞首屏显示。
Promise.allSettled([initLocaleLoaded, loadModsLoaded]).then(() => {
  updateI18nElements();
  renderMenuAddr();
  showInitScreen();
});

window.addEventListener('mods-reloaded', () => {
  initEffectMeta();
  updateI18nElements();
  updateBGM();
  renderModList();
});

import { renderBattle, renderSlots } from './render.js?v=__VERSION__';
import { renderEditList } from './editor.js?v=__VERSION__';
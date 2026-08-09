import { $, show, toast } from './util.js';
import { state } from './state.js';
import { t, initLocale, setLocale, getLang } from './i18n.js';
import { initAudio, setTypeVolume, getTypeVolume, setMasterVolume, getMasterVolume, updateBGM } from './sound.js';
import { loadMods, reloadMods, getMods, getModConfigSchema, renderModConfig, importMod, deleteMod, getModOrder, setModOrder, setModEnabled, isModEnabled } from './modloader.js';
import { updateEffTypes } from './data.js';
import { startVsAI, startLocal, openLAN, backMenu, quitBattle, pickRole, closeModal, setPick, setPickRandom, goDice } from './pick.js';
import { openEditor, setTab, editorActions } from './editor.js';
import { playCardClick, endTurnClick } from './battle.js';
import { lanCreate, lanJoinRoom, lanConnect, lanDisconnect, addServer, removeServer, renderServerList, normalizeServerUrl } from './lan.js';

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
  const mt = document.querySelector('#sc-menu .m-title');
  if (mt && !IS_TAURI) mt.title = t('menu.url_hint');
  const sel = $('lang-select');
  if (sel) sel.value = getLang();
}

window.addEventListener('locale-changed', () => {
  updateI18nElements();
  renderMenuAddr();
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
  'start-ai': () => startVsAI(),
  'start-local': () => startLocal(),
  'open-lan': () => openLAN(),
  'open-editor': () => openEditor(),
  'open-settings': () => openSettings(),
  'set-accent': (el) => setAccent(el.dataset.color),
  'pick-custom': (el) => openColorPop(el),
  'cp-ok': () => applyCp(),
  'cp-cancel': () => closeCp(),
  'back-menu': () => backMenu(),
  'quit-battle': () => quitBattle(),
  'tab-role': () => setTab('role'),
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
  'lan-disconnect': () => lanDisconnect(),
  'set-pick': (el) => setPick(parseInt(el.dataset.slot), parseInt(el.dataset.index)),
  'pick-random': (el) => setPickRandom(parseInt(el.dataset.slot)),
  ...editorActions,
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
const savedTheme = localStorage.getItem('theme') || 'dark';
$('theme-select').value = savedTheme;
setTheme(savedTheme);
$('theme-select').addEventListener('change', (e) => setTheme(e.target.value));

/* ============ 主题色 ============ */
const ACCENTS = ['#d9a441', '#e8833f', '#6fae4e', '#4d8fd4', '#9a6fd6', '#e96ba3', '#37a3a0'];
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
  row.innerHTML = ACCENTS.map(c =>
    `<button class="accent-swatch ${c === current ? 'on' : ''}" data-action="set-accent" data-color="${c}" style="background:${c}" title="${c}"></button>`
  ).join('')
    + `<button class="accent-swatch custom ${custom === current && !isPreset ? 'on' : ''}" data-action="pick-custom" title="自定义" style="background:${custom}"></button>`;
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
    toast(t('menu.url_copied'));
    getLanIp(ip => {
      copyToClipboard(buildShareUrl(ip)).then(ok => {
        if (!ok) toast(t('menu.url_copy_failed'));
      });
    });
    menuTitle.classList.add('anim');
    clearTimeout(menuTitle._animT);
    menuTitle._animT = setTimeout(() => menuTitle.classList.remove('anim'), 900);
  });
}

// 菜单下方显示本机局域网地址（旧版功能回归）
function renderMenuAddr() {
  const el = $('maddr');
  if (!el) return;
  getLanIp(ip => {
    const pi = ip || location.hostname || 'localhost';
    const port = location.port || '8788';
    const url = (h) => 'http://' + h + ':' + port + '/';
    const extra = ipListGlobal().filter(h => h && h !== pi);
    let html = t('menu.addr') + '<br><b style="font-size:17px">' + url(pi) + '</b>';
    if (extra.length) {
      html += '<br><span class="dim" style="font-size:11px">' + extra.map(url).join(' · ') + '</span>';
    }
    el.innerHTML = html;
  });
}
renderMenuAddr();

/* ============ 自定义色取色面板（方形预览，替换原生圆形） ============ */
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
  if (!m) return [217, 164, 65];
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
  cpHex.textContent = c.hex;
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

function applyAccent() {
  document.documentElement.style.setProperty('--acc', getSavedAccent());
}

/* ============ 设置页打开：tab 重置为默认 ============ */
function resetSettingsTab() {
  document.querySelectorAll('#sc-settings .tabs .tab').forEach((b, i) => b.classList.toggle('on', i === 0));
  ['lang', 'sound', 'mods'].forEach((id, i) => {
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
  ['lang', 'sound', 'mods'].forEach(id => {
    const el = $('settings-' + id);
    if (el) el.style.display = id === t ? 'block' : 'none';
  });
  if (t === 'mods') renderModList();
});

/* 音量切换 */
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
});

/* BGM 开关 */

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
initLocale().then(() => {
  updateI18nElements();
  renderMenuAddr();
});
loadMods().then(() => {
  updateEffTypes();
  updateI18nElements();
  updateBGM();
  renderModList();
}).finally(() => restoreSavedScreen());
// 兜底：5 秒后若还没恢复则强制执行
setTimeout(() => {
  const saved = sessionStorage.getItem('saved_screen');
  if (saved) restoreSavedScreen();
}, 5000);

function restoreSavedScreen() {
  const saved = sessionStorage.getItem('saved_screen');
  if (saved === 'sc-settings') {
    show('sc-settings');
  } else if (saved === 'sc-edit') {
    const savedEdit = JSON.parse(localStorage.getItem('saved_edit') || '{}');
    if (savedEdit.tab) setTab(savedEdit.tab);
    show('sc-edit');
  } else {
    show('sc-menu');
  }
}

window.addEventListener('mods-reloaded', () => {
  updateEffTypes();
  updateI18nElements();
  updateBGM();
  renderModList();
});

import { renderBattle, renderSlots } from './render.js';
import { renderEditList } from './editor.js';
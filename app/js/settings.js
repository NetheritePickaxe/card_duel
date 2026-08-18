import { $, show, toast } from './util.js?v=__VERSION__';
import { setTypeVolume, getTypeVolume, setMasterVolume, getMasterVolume, updateBGM, initAudio } from './sound.js?v=__VERSION__';
import { renderMenuAddr } from './share.js?v=__VERSION__';
import { getMods, getModOrder, deleteMod, importModFromUrl, reloadMods } from './modloader.js?v=__VERSION__';
import { getPlayerName, savePlayerName } from './profile.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';

// ============================================================================
// 设置组件：主题 / 主题色（含取色器）/ 设置页签 / 音量 / 标语开关
// ============================================================================

/* 玩家名字 */
function initNameInput() {
  const input = $('player-name-input');
  if (!input) return;
  input.value = getPlayerName();
  input.placeholder = t('name.input_placeholder');
  input.addEventListener('change', () => {
    savePlayerName(input.value);
    input.value = getPlayerName();
    toast(t('name.changed'));
  });
}

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

// 主界面标语开关
function initSplashToggle() {
  const splashToggle = $('splash-toggle');
  if (!splashToggle) return;
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

/* 设置标签切换 */
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-action="settings-tab"]');
  if (!tab) return;
  const tname = tab.dataset.tab;
  document.querySelectorAll('#sc-settings .tabs .tab').forEach(b => b.classList.toggle('on', b === tab));
  ['lang', 'sound'].forEach(id => {
    const el = $('settings-' + id);
    if (el) el.style.display = id === tname ? 'block' : 'none';
  });
});

// 音量切换
function initVolumeSliders() {
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
}

/* ============ 动作注册（app.js actionMap 合并） ============ */

export const settingsActions = {
  'open-settings': () => openSettings(),
  'set-accent': (el) => setAccent(el.dataset.color),
  'pick-custom': (el) => openColorPop(el),
  'cp-ok': () => applyCp(),
  'cp-reset': () => resetCp(),
  'cp-cancel': () => closeCp(),
};

/** 启动初始化（app.js 调用一次） */
export function initSettings() {
  initAudio();
  applyAccent();
  renderAccentRow();
  initSplashToggle();
  initNameInput();
  initVolumeSliders();
  const savedTheme = localStorage.getItem('theme') || 'dark';
  const themeSelect = $('theme-select');
  if (themeSelect) {
    themeSelect.value = savedTheme;
    themeSelect.addEventListener('change', (e) => setTheme(e.target.value));
  }
  setTheme(savedTheme);
  // BGM 随屏幕切换
  window.addEventListener('screen-changed', () => updateBGM());
  // 音乐包下载按钮
  const musicBtn = $('music-pack-download-btn');
  if (musicBtn) {
    const MUSIC_PACK_URL = 'https://github.com/NetheritePickaxe/card_duel/releases/download/music-pack/music-pack.zip';
    async function refreshMusicBtn() {
      const mods = getMods();
      const installed = mods.some(m => m.id === 'card_duel_music');
      if (installed) {
        musicBtn.textContent = '已安装';
        musicBtn.disabled = true;
        musicBtn.title = '音乐包已安装，可前往模组页删除或开关';
      } else {
        musicBtn.textContent = t('settings.music_download_btn');
        musicBtn.disabled = false;
        musicBtn.title = '';
      }
    }
    musicBtn.addEventListener('click', async () => {
      if (musicBtn.disabled) return;
      musicBtn.disabled = true;
      musicBtn.textContent = t('settings.music_downloading');
      try {
        await importModFromUrl(MUSIC_PACK_URL, 'music-pack.zip');
        await reloadMods();
        musicBtn.textContent = t('settings.music_downloaded');
        musicBtn.disabled = true;
        musicBtn.title = '音乐包已安装，可前往模组页删除或开关';
      } catch (e) {
        musicBtn.textContent = t('settings.music_download_btn');
        musicBtn.disabled = false;
        alert(t('settings.music_download_fail') + ': ' + e.message);
      }
    });
    window.addEventListener('mods-reloaded', refreshMusicBtn);
    refreshMusicBtn();
  }
}


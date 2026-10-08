import { $, show, toast, screenFromPath, IS_MOBILE } from './util.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { t, initLocale, setLocale, getLang } from './i18n.js?v=__VERSION__';
import { updateBGM } from './sound.js?v=__VERSION__';
import { loadMods, reloadMods, importModFromUrl, importMod, getMods } from './modloader.js?v=__VERSION__';
import { initEffectMeta } from './data.js?v=__VERSION__';
import { loadEngine } from './engine.js?v=__VERSION__';
import { startSkirmish, startCampaign, openLAN, backMenu, quitBattle, pickRole, closeModal, setPick, setPickRandom, goDice, updatePlayerCount, updateGameMode, pickTeamModal, pickHumanModal, setTeam, setHuman } from './pick.js?v=__VERSION__';
import { openEditor, setTab, editorActions } from './editor.js?v=__VERSION__';
import { openLibrary, libraryActions } from './library.js?v=__VERSION__';
import { playCardClick, endTurnClick } from './battle.js?v=__VERSION__';
import { lanCreate, lanJoinRoom, lanConnect, lanDisconnect, addServer, removeServer, renderServerList, normalizeServerUrl, scanLan, lanSetTeam, lanSetReady, lanAddCpu, openAddServerModal } from './lan.js?v=__VERSION__';
import { renderBattle, renderSlots } from './render.js?v=__VERSION__';
import { renderEditList } from './editor.js?v=__VERSION__';
import { settingsActions, initSettings } from './settings.js?v=__VERSION__';
import { hasPlayerName, savePlayerName } from './profile.js?v=__VERSION__';
import { renderMenuAddr } from './share.js?v=__VERSION__';
import { renderModList, initMods } from './mods-ui.js?v=__VERSION__';
import { initConsole } from './console.js?v=__VERSION__';

// ============================================================================
// 入口与路由：页面初始化、事件委托（actionMap）、屏幕路由。
// 各功能组件（settings/share/mods-ui/pick/editor/library）只注册自身动作，
// 统一在这里合并分发，禁止在 app.js 实现业务逻辑。
// ============================================================================

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
  const nameInput = $('name-input');
  if (nameInput) nameInput.placeholder = t('name.input_placeholder');
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
  'save-name': () => {
    const val = ($('name-input')?.value || '').trim();
    savePlayerName(val || t('name.default'));
    show('sc-menu');
  },
  'start-skirmish': () => startSkirmish(),
  'start-campaign': () => startCampaign(),
  'open-lan': () => openLAN(),
  'open-editor': () => openEditor(),
  'open-library': () => openLibrary(),
  'open-mods': () => { show('sc-mods'); renderModList(); },
  'back-menu': () => backMenu(),
  'quit-battle': () => quitBattle(),
  'tab-subfaction': () => setTab('subfaction'),
  'tab-card': () => setTab('card'),
  'close-modal': () => closeModal(),
  'go-dice': () => goDice(),
  'update-game-mode': (el) => updateGameMode(el.dataset.mode),
  'lan-create': () => lanCreate(),
  'pick-role': (el) => pickRole(parseInt(el.dataset.slot)),
  'play-card': (el) => playCardClick(parseInt(el.dataset.pi), parseInt(el.dataset.index)),
  'end-turn': (el) => endTurnClick(parseInt(el.dataset.pi)),
  'lan-join-room': (el) => lanJoinRoom(el.dataset.room),
  'open-add-server-modal': () => openAddServerModal(),
  'server-connect': (el) => lanConnect(el.dataset.url),
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
  'pick-team': (el) => pickTeamModal(parseInt(el.dataset.slot)),
  'pick-human': (el) => pickHumanModal(parseInt(el.dataset.slot)),
  'set-team': (el) => setTeam(parseInt(el.dataset.slot), parseInt(el.dataset.team)),
  'set-human': (el) => setHuman(parseInt(el.dataset.slot), parseInt(el.dataset.human)),
  ...settingsActions,
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

/* textarea 自动增高 */
function autoGrowTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el && el.tagName === 'TEXTAREA') autoGrowTextarea(el);
});

/* 多人混战人数选择 */
document.addEventListener('change', e => {
  if (e.target.id === 'pk-player-count') {
    updatePlayerCount();
  }
});

/* ============ 移动端安全区域 ============ */
function initSafeArea() {
  const html = document.documentElement;
  function measure() {
    const vb = window.visualViewport;
    const top = vb ? Math.max(0, Math.round(vb.offsetTop)) : 0;
    if (top > 0) {
      html.style.setProperty('--safe-top', Math.min(120, top) + 'px');
    } else if (IS_MOBILE) {
      html.style.setProperty('--safe-top', '48px');
    }
  }
  measure();
  window.visualViewport?.addEventListener('resize', measure);
}

/* ============ 启动 ============ */
initSafeArea();
initSettings();
initMods();
initConsole();

/* ============ 横屏旋转控制 ============ */
function applyOrientation() {
  const allow = localStorage.getItem('_allow_rotate') === '1';
  const isTauri = !!(window.__TAURI__ && window.__TAURI__.core);
  try {
    if (allow) {
      if (isTauri) {
        screen.orientation?.unlock();
      } else {
        screen.orientation?.lock('landscape');
      }
    } else {
      screen.orientation?.lock('portrait');
    }
  } catch(e) {}
  const isLandscape = window.innerWidth > window.innerHeight;
  document.body.classList.toggle('landscape', allow && (isTauri ? isLandscape : true));
}

function initOrientation() {
  applyOrientation();
  window.addEventListener('orientationchange', () => setTimeout(applyOrientation, 300));
  window.addEventListener('resize', () => {
    if (localStorage.getItem('_allow_rotate') === '1' && !!(window.__TAURI__ && window.__TAURI__.core)) {
      applyOrientation();
    }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) applyOrientation(); });
}
window.__applyOrientation = applyOrientation;
initOrientation();

function showInitScreen() {
  const initScreen = screenFromPath(location.pathname);
  if (initScreen === 'sc-settings') {
    show('sc-settings');
  } else if (initScreen === 'sc-edit') {
    const savedEdit = JSON.parse(localStorage.getItem('saved_edit') || '{}');
    if (savedEdit.tab) setTab(savedEdit.tab);
    show('sc-edit');
    renderEditList();
  } else if (initScreen === 'sc-library') {
    show('sc-library');
    openLibrary();
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
}).catch(e => console.error('[app] loadMods 失败', e));
const engineLoaded = loadEngine().then(() => {
  initEffectMeta();
});
// 等 locale 与 mod 翻译就绪后再显示首屏并统一应用 i18n，
// 避免刷新瞬间出现 HTML 兜底文本或翻译键。
// 不等待 wasm 引擎，不阻塞首屏显示。
Promise.allSettled([initLocaleLoaded, loadModsLoaded]).then(() => {
  updateI18nElements();
  renderMenuAddr();
  if (!hasPlayerName()) {
    show('sc-name');
    const input = $('name-input');
    input.placeholder = t('name.input_placeholder');
    input.focus();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('save-name')?.click(); });
    initMusicDownload();
    return;
  }
  showInitScreen();
});

function initMusicDownload() {
  const btn = $('music-dl-btn');
  if (!btn) return;
  const wrap = $('music-progress-wrap');
  const bar = $('music-progress-bar');
  const ptext = $('music-progress-text');
  const MUSIC_URLS = [
    'https://github.com/NetheritePickaxe/card_duel/releases/download/music-pack/music-pack.zip',
    'https://mirror.ghproxy.com/https://github.com/NetheritePickaxe/card_duel/releases/download/music-pack/music-pack.zip',
  ];
  async function setProgress(pct, msg) {
    if (bar) bar.style.width = (pct || 0) + '%';
    if (ptext) ptext.textContent = msg || '';
  }
  async function downloadWithProgress(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = parseInt(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total > 0) setProgress(Math.round(received / total * 100));
    }
    const blob = new Blob(chunks);
    const file = new File([blob], 'music-pack.zip', { type: blob.type });
    return file;
  }
  async function refresh() {
    const mods = getMods();
    const installed = mods.some(m => m.id === 'card_duel_music');
    if (installed) {
      btn.textContent = t('settings.music_downloaded');
      btn.disabled = true;
    } else {
      btn.textContent = t('settings.music_download_btn');
      btn.disabled = false;
    }
  }
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = t('settings.music_downloading');
    if (wrap) wrap.style.display = '';
    setProgress(0, t('settings.music_downloading'));
    let lastErr;
    for (const url of MUSIC_URLS) {
      try {
        const file = await downloadWithProgress(url);
        setProgress(100, t('settings.music_downloading'));
        await importMod(file);
        await reloadMods();
        if (wrap) wrap.style.display = 'none';
        setProgress(0, '');
        btn.textContent = t('settings.music_downloaded');
        btn.title = '';
        return;
      } catch (e) {
        lastErr = e;
        setProgress(0, '下载失败，尝试镜像…');
        await new Promise(r => setTimeout(r, 500));
      }
    }
    btn.textContent = t('settings.music_download_btn');
    btn.disabled = false;
    if (wrap) wrap.style.display = 'none';
    setProgress(0, '');
    alert(t('settings.music_download_fail') + ': ' + lastErr.message);
  });
  window.addEventListener('mods-reloaded', refresh);
  window.addEventListener('locale-changed', refresh);
  refresh();
}

window.addEventListener('mods-reloaded', () => {
  initEffectMeta();
  updateI18nElements();
  updateBGM();
  renderModList();
});

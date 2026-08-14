import { $, show, toast, screenFromPath } from './util.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { t, initLocale, setLocale, getLang } from './i18n.js?v=__VERSION__';
import { updateBGM } from './sound.js?v=__VERSION__';
import { loadMods, reloadMods } from './modloader.js?v=__VERSION__';
import { initEffectMeta } from './data.js?v=__VERSION__';
import { loadEngine } from './engine.js?v=__VERSION__';
import { startSkirmish, startCampaign, openLAN, backMenu, quitBattle, pickRole, closeModal, setPick, setPickRandom, goDice, updatePlayerCount, togglePickTeam, togglePickHuman } from './pick.js?v=__VERSION__';
import { openEditor, setTab, editorActions } from './editor.js?v=__VERSION__';
import { openLibrary, libraryActions } from './library.js?v=__VERSION__';
import { playCardClick, endTurnClick } from './battle.js?v=__VERSION__';
import { lanCreate, lanJoinRoom, lanConnect, lanDisconnect, addServer, removeServer, renderServerList, normalizeServerUrl, scanLan, lanSetTeam, lanSetReady, lanAddCpu } from './lan.js?v=__VERSION__';
import { renderBattle, renderSlots } from './render.js?v=__VERSION__';
import { renderEditList } from './editor.js?v=__VERSION__';
import { settingsActions, initSettings } from './settings.js?v=__VERSION__';
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

/* ============ 启动 ============ */
initSettings();
initMods();
initConsole();

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

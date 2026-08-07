import { $, show } from './util.js';
import { state } from './state.js';
import { t, initLocale, setLocale, getLang } from './i18n.js';
import { initAudio, setVolume, updateBGM } from './audio.js';
import { startVsAI, startLocal, openLAN, backMenu, quitBattle, pickRole, closeModal, setPick, setPickRandom, goDice } from './pick.js';
import { openEditor, setTab, editorActions } from './editor.js';
import { playCardClick, endTurnClick } from './battle.js';
import { lanCreate, lanJoin, lanJoinRoom } from './lan.js';

/* ============ i18n ============ */

function updateI18nElements() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const val = t(key);
    if (val !== key) el.textContent = val;
  });
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
  'start-ai': () => startVsAI(),
  'start-local': () => startLocal(),
  'open-lan': () => openLAN(),
  'open-editor': () => openEditor(),
  'open-settings': () => show('sc-settings'),
  'back-menu': () => backMenu(),
  'quit-battle': () => quitBattle(),
  'tab-role': () => setTab('role'),
  'tab-card': () => setTab('card'),
  'close-modal': () => closeModal(),
  'go-dice': () => goDice(),
  'lan-create': () => lanCreate(),
  'lan-join': () => lanJoin(),
  'pick-role': (el) => pickRole(parseInt(el.dataset.slot)),
  'play-card': (el) => playCardClick(parseInt(el.dataset.pi), parseInt(el.dataset.index)),
  'end-turn': (el) => endTurnClick(parseInt(el.dataset.pi)),
  'lan-join-room': (el) => lanJoinRoom(el.dataset.room),
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

/* 音量切换 */
$('volume-slider').addEventListener('input', (e) => {
  setVolume(parseFloat(e.target.value));
  updateBGM();
});

window.addEventListener('screen-changed', () => updateBGM());

/* ============ IP 检测 ============ */

const __IP_LIST__ = [];
const __PHONE_IP__ = '';

function renderIp(ips, phoneIp, isTauri) {
  const ip = phoneIp || ips[0] || '127.0.0.1';
  const port = 8788;
  const list = ips.length > 1
    ? `<span class="dim" style="font-size:11px">${t('menu.phone_other')}${ips.filter(x => x !== ip).map(a => 'http://' + a + ':' + port).join(' · ')}</span>`
    : '';
  $('maddr').innerHTML = `${t('menu.phone_hint')}<br><b style="font-size:17px">http://${ip}:${port}</b>${list}`;
  $('lan-addr').innerHTML = `http://${ip}:${port}`;
  $('lan-url').value = `http://${ip}:${port}`;
}

try {
  const pi = __PHONE_IP__ || __IP_LIST__[0] || location.hostname;
  renderIp(__IP_LIST__, pi);
} catch (e) { /* ignore */ }

// Tauri: override with native IP detection via IPC
if (typeof window.__TAURI__ !== 'undefined' && window.__TAURI__.core) {
  window.__TAURI__.core.invoke('get_lan_info').then(info => {
    renderIp(info.ips || [], info.phone_ip || '');
  }).catch(() => { });
}

/* ============ 启动 ============ */
initAudio();
initLocale().then(() => updateI18nElements());

import { renderBattle, renderSlots } from './render.js';
import { renderEditList } from './editor.js';
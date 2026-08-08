import { $, show } from './util.js';
import { state } from './state.js';
import { t, initLocale, setLocale, getLang } from './i18n.js';
import { initAudio, setTypeVolume, getTypeVolume, updateBGM } from './sound.js';
import { loadMods, reloadMods, getMods, getModConfigSchema, renderModConfig, importMod, deleteMod, getModOrder, setModOrder, setModEnabled, isModEnabled } from './modloader.js';
import { updateEffTypes } from './data.js';
import { startVsAI, startLocal, openLAN, backMenu, quitBattle, pickRole, closeModal, setPick, setPickRandom, goDice } from './pick.js';
import { openEditor, setTab, editorActions } from './editor.js';
import { playCardClick, endTurnClick } from './battle.js';
import { lanCreate, lanJoin, lanJoinRoom, lanConnect, lanDisconnect, addServer, removeServer, renderServerList, normalizeServerUrl } from './lan.js';

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

/* 设置标签切换 */
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-action="settings-tab"]');
  if (!tab) return;
  const t = tab.dataset.tab;
  document.querySelectorAll('#sc-settings .tabs .tab').forEach(b => b.classList.toggle('on', b === tab));
  ['lang', 'volume', 'mods'].forEach(id => {
    const el = $('settings-' + id);
    if (el) el.style.display = id === t ? 'block' : 'none';
  });
  if (t === 'mods') renderModList();
});

/* 音量切换 */
document.querySelectorAll('.vol-slider').forEach(slider => {
  const type = slider.dataset.type;
  slider.value = getTypeVolume(type);
  slider.addEventListener('input', (e) => {
    setTypeVolume(type, parseFloat(e.target.value));
  });
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
loadMods().then(() => {
  updateEffTypes();
  updateI18nElements();
});

window.addEventListener('mods-reloaded', () => {
  updateEffTypes();
  updateI18nElements();
  updateBGM();
  renderModList();
});

import { renderBattle, renderSlots } from './render.js';
import { renderEditList } from './editor.js';
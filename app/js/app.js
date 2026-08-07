import { $, show } from './util.js';
import { state } from './state.js';
import { startVsAI, startLocal, openLAN, backMenu, quitBattle, pickRole, closeModal, setPick, setPickRandom, goDice } from './pick.js';
import { openEditor, setTab, editorActions } from './editor.js';
import { playCardClick, endTurnClick } from './battle.js';
import { lanCreate, lanJoin, lanJoinRoom, lanPost } from './lan.js';
import { renderLanPick } from './lan.js';

/* ============ 事件委托 ============ */

const actionMap = {
  'start-ai': () => startVsAI(),
  'start-local': () => startLocal(),
  'open-lan': () => openLAN(),
  'open-editor': () => openEditor(),
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

/* ============ IP 检测 ============ */

const __IP_LIST__ = [];
const __PHONE_IP__ = '';
try {
  const pi = __PHONE_IP__ || __IP_LIST__[0] || location.hostname;
  $('maddr').innerHTML = '手机浏览器打开：<br><b style="font-size:17px">http://' + pi + ':' + (location.port || '8788') + '</b>'
    + (__IP_LIST__.length > 1 ? '<br><span class="dim" style="font-size:11px">其他：' + __IP_LIST__.filter(x => x !== pi).map(a => 'http://' + a + ':' + (location.port || '8788')).join(' · ') + '</span>' : '');
  $('lan-addr').innerHTML = 'http://' + pi + ':' + (location.port || '8788');
  $('lan-url').value = location.origin || 'http://' + pi + ':8788';
} catch (e) { /* ignore */ }

// Tauri: override with native IP detection via IPC
if (typeof window.__TAURI__ !== 'undefined' && window.__TAURI__.core) {
  window.__TAURI__.core.invoke('get_lan_info').then(info => {
    const ips = info.ips || [];
    const ip = info.phone_ip || ips[0] || '127.0.0.1';
    const port = info.port || 8788;
    $('maddr').innerHTML = '手机浏览器打开：<br><b style="font-size:17px">http://' + ip + ':' + port + '</b>'
      + (ips.length > 1 ? '<br><span class="dim" style="font-size:11px">其他：' + ips.filter(x => x !== ip).map(a => 'http://' + a + ':' + port).join(' · ') + '</span>' : '');
    $('lan-addr').innerHTML = 'http://' + ip + ':' + port;
    $('lan-url').value = 'http://' + ip + ':' + port;
  }).catch(() => { });
}
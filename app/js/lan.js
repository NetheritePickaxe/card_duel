import { $, show, esc } from './util.js';
import { state } from './state.js';
import { DB, getDefaultCardIds } from './data.js';
import { t } from './i18n.js';
import { newBattle, logT, forceDiscard } from './core.js';
import { renderBattle, showBattle, renderSlots, slotHTML, playCardAnim } from './render.js';
import { startTurn } from './battle.js';
import { goDice, openPick } from './pick.js';

const STORAGE_KEY = 'saved_servers';
const IS_HTTPS = location.protocol === 'https:';
let currentServer = '';
let cachedRooms = [];

/* ============ 服务器地址管理 ============ */

export function normalizeServerUrl(input) {
  input = input.trim();
  if (!input) return '';
  // 已包含协议
  if (input.startsWith('http://') || input.startsWith('https://')) {
    // 确保有端口
    if (!input.includes(':', 8)) return input + ':8788';
    return input.replace(/\/+$/, '');
  }
  // 纯 IP 或域名
  return `http://${input}:8788`;
}

export function lanBase() {
  return currentServer || 'http://127.0.0.1:8788';
}

export function getServers() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (e) { return []; }
}

function saveServers(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function addServer(url) {
  const normalized = normalizeServerUrl(url);
  if (!normalized) return false;
  const list = getServers();
  if (!list.includes(normalized)) {
    list.push(normalized);
    saveServers(list);
  }
  return true;
}

export function removeServer(url) {
  const list = getServers().filter(s => s !== url);
  saveServers(list);
  renderServerList();
}

export function renderServerList() {
  const list = $('server-list');
  if (!list) return;
  const servers = getServers();
  list.innerHTML = servers.length
    ? servers.map(s => `
      <div class="server-item" data-url="${s}">
        <span class="server-status ${currentServer === s ? 'connected' : ''}">${currentServer === s ? '●' : '○'}</span>
        <span class="server-url">${s}</span>
        <span class="sp"></span>
        <button class="server-connect" data-action="server-connect" data-url="${s}" style="padding:2px 8px">${t('lan.connect')}</button>
        <button class="server-del" data-action="server-del" data-url="${s}" style="padding:2px 6px;color:var(--red)">✕</button>
      </div>`).join('')
    : `<div class="dim" style="padding:8px;text-align:center">${t('lan.no_servers')}</div>`;
}

/* ============ 连接管理 ============ */

export function lanConnect(url) {
  const base = normalizeServerUrl(url);
  if (!base) { alert(t('lan.connect_fail')); return; }
  // 混合内容提示
  if (IS_HTTPS && base.startsWith('http://')) {
    $('mixed-content-warning').style.display = 'block';
  } else {
    $('mixed-content-warning').style.display = 'none';
  }
  fetch(base + '/ping', { cache: 'no-store' }).then(r => r.json()).then(d => {
    if (!d.ok) { alert(t('lan.connect_fail')); return; }
    currentServer = base;
    addServer(base);
    renderServerList();
    showServerPanel();
    $('connected-label').textContent = t('lan.connected_to', { server: base });
    startRoomList();
  }).catch(() => {
    if (IS_HTTPS && base.startsWith('http://') && $('mixed-content-warning').style.display !== 'block') {
      $('mixed-content-warning').style.display = 'block';
    }
    alert(t('lan.connect_fail'));
  });
}

export function lanDisconnect() {
  currentServer = '';
  stopRoomList();
  state.LAN = null;
  state.BATTLE = null;
  state.PHASE_BATTLE = false;
  hideServerPanel();
  renderServerList();
}

/* ============ UI 控制 ============ */

function showServerPanel() {
  $('server-panel').style.display = 'block';
  $('server-list-section').style.display = 'none';
  $('add-server-section').style.display = 'none';
}

function hideServerPanel() {
  $('server-panel').style.display = 'none';
  $('server-list-section').style.display = 'block';
  $('add-server-section').style.display = 'block';
}

/* ============ 房间操作 ============ */

export function lanCreate() {
  const gameName = t('lan.new_game_name') || '卡牌对决';
  const modsEnabled = $('mods-toggle')?.checked ?? false;
  fetch(currentServer + '/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: gameName, mods: modsEnabled }), cache: 'no-store',
  }).then(r => r.json()).then(d => {
    if (!d.ok) { alert(t('lan.alert_create_fail')); return; }
    state.LAN = { base: currentServer, room: d.room, gameName, mods: modsEnabled, side: 0, lastSeq: 0, timer: null, picks: [null, null], hostData: null };
    state.MODE = 'lan';
    stopRoomList();
    $('lan-info').textContent = t('lan.waiting');
    openPick();
    $('pk-title').textContent = t('pick.lan_p0_title');
    renderSlots();
    lanPoll();
  }).catch(() => alert(t('lan.alert_conn_fail')));
}

export function lanJoinRoom(room) {
  fetch(currentServer + '/join?room=' + room, { cache: 'no-store' }).then(r => r.json()).then(d => {
    if (!d.ok) { alert(t('lan.alert_join_fail', { err: d.err })); return; }
    // 从房间列表缓存中找到该房间的 mods 标志
    const roomData = cachedRooms.find(r => r.room === room);
    const mods = roomData?.mods ?? true;
    state.LAN = { base: currentServer, room, mods, side: 1, lastSeq: 0, timer: null, picks: [null, null], hostData: null };
    state.MODE = 'lan';
    stopRoomList();
    $('lan-info').textContent = t('lan.waiting');
    openPick();
    $('pk-title').textContent = t('pick.lan_p1_title');
    renderSlots();
    lanPoll();
  }).catch(() => alert(t('lan.alert_conn_fail2')));
}

export function lanJoin() {
  const row = $('lan-join-row');
  if (row.style.display === 'none') { row.style.display = 'flex'; return; }
  lanJoinRoom($('lan-room').value);
}

export function lanPoll() {
  clearTimeout(state.LAN.timer);
  fetch(state.LAN.base + '/state?room=' + state.LAN.room, { cache: 'no-store' }).then(r => r.json()).then(d => {
    if (!d.ok) {
      if (state.PHASE_BATTLE || $('sc-pick').classList.contains('on')) alert(t('lan.room_closed'));
      if (state.LAN && state.LAN.timer) { clearTimeout(state.LAN.timer); state.LAN.timer = null; }
      stopRoomList();
      state.LAN = null; state.BATTLE = null; state.PHASE_BATTLE = false;
      show('sc-menu');
      return;
    }
    state.LAN.picks = d.picks || [null, null];
    if (d.state && d.state.seq !== state.LAN.lastSeq) {
      state.LAN.lastSeq = d.state.seq;
      if (!state.BATTLE || state.BATTLE.seq === 0) enterBattleFromState(d.state);
      else applyPublic(d.state);
    }
    if (state.PHASE_BATTLE === false && $('sc-pick').classList.contains('on')) renderLanPick();
  }).catch(() => { });
  state.LAN.timer = setTimeout(lanPoll, 500);
}

export function renderLanPick() {
  const mySide = state.LAN.side;
  const both = state.LAN.picks[0] && state.LAN.picks[1];
  $('lan-hint').innerHTML = `${mySide === 0 ? t('pick.lan_p0') : t('pick.lan_p1')}<br><span style="font-size:12px">${t('pick.lan_status')}P0 ${state.LAN.picks[0] ? t('pick.lan_ready') : t('pick.lan_pending')} · P1 ${state.LAN.picks[1] ? t('pick.lan_ready') : t('pick.lan_pending')}${both ? ` · ${t('pick.lan_ready2')}` : ''}</span>`;
  const p0 = mySide === 0 ? state.PICK[0] : (state.LAN.picks[0] ? state.LAN.picks[0].role : null);
  $('slot-0').innerHTML = p0 ? slotHTML(p0) : `<div class="av" style="opacity:.4">?</div><div class="dim">${mySide === 0 ? t('pick.slot_choose') : t('pick.slot_wait_host')}</div>`;
  const p1 = mySide === 1 ? state.PICK[1] : (state.LAN.picks[1] ? state.LAN.picks[1].role : null);
  $('slot-1').innerHTML = p1 ? slotHTML(p1) : `<div class="av" style="opacity:.4">?</div><div class="dim">${mySide === 1 ? t('pick.slot_choose') : t('pick.slot_wait_guest')}</div>`;
  if (mySide === 0 && both) {
    $('pk-go').style.display = '';
    $('pk-go').textContent = t('pick.lan_both_ready');
    if (!state.LAN._auto) { state.LAN._auto = true; setTimeout(() => { if (state.LAN && state.LAN.picks && state.LAN.picks[0] && state.LAN.picks[1] && !state.BATTLE) goDice(); }, 1500); }
  } else {
    $('pk-go').style.display = 'none';
  }
}

export function lanPickPost(side, role) {
  const deckIds = (role.deck && role.deck.length) ? role.deck : null;
  let cards = deckIds ? deckIds.map(id => DB.cards.find(c => c.id === id)).filter(Boolean) : [...DB.cards];
  // 模组关闭时只保留原版卡牌
  if (!state.LAN.mods) {
    const vanillaIds = getDefaultCardIds();
    cards = cards.filter(c => vanillaIds.has(c.id));
  }
  const effectTypes = [...new Set(cards.flatMap(c => (c.effects || []).map(e => e.type)))];
  fetch(state.LAN.base + '/pick', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: state.LAN.room, side, role, cards, effects: effectTypes }),
  }).then(r => r.json()).then(d => {
    if (d && !d.ok) alert(t('lan.alert_upload_fail', { err: d.err }));
  }).catch(() => alert(t('lan.alert_upload_fail2')));
}

/* ============ 战斗同步 ============ */

function publicState(b) {
  const play = b.lastPlay ? { seq: b.lastPlay.atSeq, pi: b.lastPlay.pi, card: b.lastPlay.card, events: b.lastPlay.events } : null;
  const fd = b.pendingFD ? { seq: b.pendingFD.atSeq, side: b.pendingFD.side, count: b.pendingFD.count } : null;
  return {
    seq: b.seq, turn: b.turn, actor: b.actor, winner: b.winner, phase: b.phase, defs: b.defs,
    p: b.players.map(P => ({ hp: P.hp, def: P.def, energy: P.energy, buffs: P.buffs,
      drawCount: P.draw.length, handCount: Array.isArray(P.hand) ? P.hand.length : 0, discard: P.discard.slice(-14) })),
    log: b.log.slice(-80), play, fd,
  };
}

export function lanPost() {
  if (!state.LAN) return;
  state.BATTLE.seq++;
  fetch(state.LAN.base + '/state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: state.LAN.room, state: publicState(state.BATTLE) }),
  }).then(r => r.json()).then(d => {
    if (d && !d.ok && d.err) logT(state.BATTLE, 'lan.sync_prefix', { err: d.err });
  }).catch(() => { });
}

function enterBattleFromState(pub) {
  state.PHASE_BATTLE = true;
  state.BATTLE = newBattle('lan', pub.defs);
  applyPublic(pub);
}

function applyPublic(pub) {
  const b = state.BATTLE;
  b.seq = pub.seq; b.turn = pub.turn; b.actor = pub.actor; b.winner = pub.winner; b.phase = pub.phase; b.log = pub.log;
  b.players.forEach((P, i) => {
    P.hp = pub.p[i].hp; P.def = pub.p[i].def; P.energy = pub.p[i].energy; P.buffs = pub.p[i].buffs;
    if (i !== state.LAN.side) { P.drawCount = pub.p[i].drawCount; P.handCount = pub.p[i].handCount; P.discard = pub.p[i].discard; P.hand = null; }
  });
  if (!$('sc-battle').classList.contains('on')) showBattle(); else renderBattle();
  if (pub.play && pub.play.seq === pub.seq && pub.play.card && pub.play.pi !== state.LAN.side) playCardAnim(pub.play.pi, pub.play.card, pub.play.events, () => { });
  if (pub.fd && pub.fd.seq === pub.seq && pub.fd.side === state.LAN.side) {
    const pre = b.seq;
    forceDiscard(b, state.LAN.side, pub.fd.count);
    renderBattle();
    if (b.seq === pre) lanPost();
  }
  if (!b.winner && b.phase === 'awaiting' && b.actor === state.LAN.side) {
    b.phase = 'playing';
    const preSeq = b.seq;
    startTurn(b);
    if (b.seq === preSeq) lanPost();
  }
}

/* ============ 房间列表 ============ */

export function startRoomList() {
  stopRoomList();
  roomListTick();
  state.ROOM_TICKER = setInterval(roomListTick, 2000);
}

export function stopRoomList() {
  if (state.ROOM_TICKER) { clearInterval(state.ROOM_TICKER); state.ROOM_TICKER = null; }
}

function roomListTick() {
  if (!currentServer) return;
  fetch(currentServer + '/rooms', { cache: 'no-store' }).then(r => r.json()).then(d => {
    if (!d.ok) return;
    cachedRooms = d.rooms || [];
    const list = $('room-list');
    if (!cachedRooms.length) {
      list.innerHTML = `<div class="dim" style="padding:12px;text-align:center">${t('lan.no_rooms')}</div>`;
      return;
    }
    list.innerHTML = cachedRooms.map(r => {
      const modsLabel = r.mods ? '' : `<span class="dim" style="font-size:10px">[模组关闭]</span>`;
      return `<div class="room-row">
        <div><b>${esc(r.name || r.room)}</b> ${modsLabel}<span class="dim" style="font-size:11px"> · ${r.picks}/2 ${t('lan.ready')}</span></div>
        <span style="display:flex;align-items:center;gap:8px">
          <span class="dim" style="font-size:11px">${r.playing ? t('lan.playing') : t('lan.wait_join')}</span>
          ${r.playing ? '' : `<button class="primary" data-action="lan-join-room" data-room="${r.room}">${t('lan.join')}</button>`}
        </span>
      </div>`;
    }).join('');
  }).catch(() => { });
}
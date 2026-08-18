import { $, show, esc, toast } from './util.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { DB, getDefaultCardIds } from './data.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { newBattle, lanMyIndex } from './core.js?v=__VERSION__';
import { getPlayerName, cpuLabel } from './profile.js?v=__VERSION__';
import { renderSlots, slotHTML } from './render.js?v=__VERSION__';

// ============================================================================
// LAN 客户端（网络适配器，Layer 4 Control 的客户端侧）
//
// 职责边界：
// - 连接管理 / 房间列表 / 大厅操作（创建、加入、选择、队伍、就绪）
// - 战斗意图提交（lanAct）与公开状态轮询（lanPoll）
// - 公开状态 → 本地状态对象的数据同步（applyPublic）
//
// 禁止：
// - 本地结算任何战斗规则（唯一权威是服务端 game::Battle）
// - 驱动 UI/动画（通过 'lan-battle-state' 事件交给 battle.js 表现层）
// - 反向依赖 battle.js / pick.js（避免循环依赖）
// ============================================================================

const STORAGE_KEY = 'saved_servers';
const IS_HTTPS = location.protocol === 'https:';
let currentServer = '';
let cachedRooms = [];
let roomCounts = {}; // 扫描时记录每个服务器的房间数
const CAPACITY = 4;

/* ============ 服务器地址管理 ============ */

export function normalizeServerUrl(input) {
  input = input.trim();
  if (!input) return '';
  if (input.startsWith('http://') || input.startsWith('https://')) {
    if (!input.includes(':', 8)) return input + ':8788';
    return input.replace(/\/+$/, '');
  }
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
        ${roomCounts[s] != null ? `<span class="dim" style="font-size:11px">${roomCounts[s]} ${t('lan.room_word')}</span>` : ''}
        <span class="sp"></span>
        <button class="server-connect" data-action="server-connect" data-url="${s}" style="padding:2px 8px">${t('lan.connect')}</button>
        <button class="server-del" data-action="server-del" data-url="${s}" style="padding:2px 6px;color:var(--red)">✕</button>
      </div>`).join('')
    : `<div class="dim" style="padding:8px;text-align:center">${t('lan.no_servers')}</div>`;
}

function isPrivateIp(ip) {
  return /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^192\.168\./.test(ip);
}

export function scanLan() {
  const list = $('server-list');
  if (!list) return;
  const status = list.querySelector('.dim');
  if (status) status.textContent = t('lan.scanning');
  fetch('/discover', { cache: 'no-store' })
    .then(r => r.json())
    .then(d => {
      if (d.ok && Array.isArray(d.servers)) {
        let added = 0;
        const found = d.servers.filter(isPrivateIp);
        found.forEach(ip => { if (addServer('http://' + ip + ':8788')) added++; });
        renderServerList();
        if (added) toast(t('lan.scan_found', { n: added }));
        found.forEach(ip => {
          const url = 'http://' + ip + ':8788';
          fetch(url + '/rooms', { cache: 'no-store' })
            .then(r => r.json())
            .then(rd => {
              if (rd.ok && Array.isArray(rd.rooms)) {
                roomCounts[url] = rd.rooms.length;
                renderServerList();
              }
            })
            .catch(() => {});
        });
      }
    })
    .catch(() => renderServerList());
}

/* ============ 连接管理 ============ */

export function lanConnect(url) {
  const base = normalizeServerUrl(url);
  if (!base) { alert(t('lan.connect_fail')); return; }
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

function initLan() {
  return {
    picks: new Array(CAPACITY).fill(null),
    teams: new Array(CAPACITY).fill(null),
    ready: new Array(CAPACITY).fill(false),
    capacity: CAPACITY,
  };
}

/** 该席位之前由电脑占位的个数（用于 电脑1/电脑2… 编号），房主视角）
 */
function cpuOf(side) {
  const picks = state.LAN && state.LAN.picks ? state.LAN.picks : [];
  const teamsArr = state.LAN && state.LAN.teams ? state.LAN.teams : [];
  let n = 0;
  for (let i = 0; i < side; i++) {
    const isCpu = picks[i] && picks[i].is_human === false;
    if (isCpu) n++;
  }
  return n + 1;
}

function lanMeta() {
  // 从 LAN 状态合并 meta（picks/teams/ready），供选择界面使用
  state.LAN.teamsArr = state.LAN.teams || new Array(CAPACITY).fill(null);
  state.LAN.readyArr = state.LAN.ready || new Array(CAPACITY).fill(false);
}

export function lanCreate() {
  const gameName = t('lan.new_game_name') || '卡牌对决';
  const modsEnabled = $('mods-toggle')?.checked ?? false;
  const capacity = parseInt($('lan-player-count')?.value) || 4;
  fetch(currentServer + '/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: gameName, mods: modsEnabled, capacity }), cache: 'no-store',
  }).then(r => r.json()).then(d => {
    if (!d.ok) { alert(t('lan.alert_create_fail')); return; }
    state.LAN = { base: currentServer, room: d.room, gameName, mods: modsEnabled, side: 0, lastSeq: 0, timer: null, ...initLan(), capacity, hostData: null };
    state.MODE = 'lan';
    stopRoomList();
    lanMeta();
    $('lan-info').textContent = t('lan.waiting');
    window.dispatchEvent(new CustomEvent('lan-room-ready'));
    lanPoll();
  }).catch(() => alert(t('lan.alert_conn_fail')));
}

export function lanJoinRoom(room) {
  fetch(currentServer + '/join?room=' + room, { cache: 'no-store' }).then(r => r.json()).then(d => {
    if (!d.ok) { alert(t('lan.alert_join_fail', { err: d.err })); return; }
    const roomData = cachedRooms.find(r => r.room === room);
    const mods = roomData?.mods ?? true;
    const cap = roomData?.capacity || CAPACITY;
    const side = d.side ?? 1;
    state.LAN = { base: currentServer, room, mods, side, lastSeq: 0, timer: null, ...initLan(), capacity: cap, hostData: null };
    state.MODE = 'lan';
    stopRoomList();
    lanMeta();
    $('lan-info').textContent = t('lan.waiting');
    window.dispatchEvent(new CustomEvent('lan-room-ready'));
    lanPoll();
  }).catch(() => alert(t('lan.alert_conn_fail2')));
}

export function lanJoin() {
  const row = $('lan-join-row');
  if (row.style.display === 'none') { row.style.display = 'flex'; return; }
  lanJoinRoom($('lan-room').value);
}

/* ============ 状态轮询 ============ */

export function lanPoll() {
  clearTimeout(state.LAN.timer);
  fetch(state.LAN.base + '/state?room=' + state.LAN.room + '&side=' + state.LAN.side, { cache: 'no-store' })
    .then(r => r.json()).then(d => {
      if (!d.ok) {
        if (state.PHASE_BATTLE || $('sc-pick').classList.contains('on')) alert(t('lan.room_closed'));
        if (state.LAN && state.LAN.timer) { clearTimeout(state.LAN.timer); state.LAN.timer = null; }
        stopRoomList();
        state.LAN = null; state.BATTLE = null; state.PHASE_BATTLE = false;
        show('sc-menu');
        return;
      }
      state.LAN.picks = d.picks || new Array(CAPACITY).fill(null);
      state.LAN.teams = d.teams || new Array(CAPACITY).fill(null);
      state.LAN.ready = d.ready || new Array(CAPACITY).fill(false);
      state.LAN.capacity = d.capacity || CAPACITY;
      // 同步 PICK 长度到当前容量
      if (state.PICK && state.PICK.length !== state.LAN.capacity) {
        const old = state.PICK;
        state.PICK = new Array(state.LAN.capacity).fill(null);
        for (let i = 0; i < Math.min(old.length, state.LAN.capacity); i++) state.PICK[i] = old[i];
      }
      lanMeta();
      if (d.state && d.state.seq !== state.LAN.lastSeq) {
        lanSyncState(d.state);
      }
      if (state.PHASE_BATTLE === false && $('sc-pick').classList.contains('on')) {
        renderLanPick();
        renderSlots();
      }
    }).catch(() => { });
  state.LAN.timer = setTimeout(lanPoll, 500);
}

/* ============ 战斗意图提交（Layer 1 Action 的客户端入口） ============ */

/**
 * 向服务端提交战斗意图（start / play / endturn）。
 * 成功后立即应用响应中的公开状态（含本人手牌）并触发表现事件。
 * @returns {Promise<object>} 服务端响应 JSON
 */
export function lanAct(side, action) {
  if (!state.LAN) return Promise.resolve({ err: t('lan.room_closed') });
  return fetch(state.LAN.base + '/act', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: state.LAN.room, side, action }), cache: 'no-store',
  }).then(r => r.json()).then(d => {
    if (d && d.ok && d.state) {
      lanSyncState(d.state);
    } else if (d && d.err && !d.ok) {
      toast(d.err);
    }
    return d;
  }).catch(() => ({ err: t('lan.alert_conn_fail2') }));
}

/* ============ 公开状态 → 本地对象 ============ */

/** 应用一份公开状态（去重后），本地对象仅做数据同步，不结算规则 */
function lanSyncState(pub) {
  state.LAN.lastSeq = pub.seq;
  if (!state.BATTLE || state.BATTLE.seq === 0) {
    state.PHASE_BATTLE = true;
    state.BATTLE = newBattle('lan', pub.defs);
  }
  applyPublic(pub);
}

/**
 * 把服务端公开状态同步到本地状态对象。
 * 数据同步完成后派发 'lan-battle-state' 事件，由 battle.js（表现层）
 * 负责渲染、动画与屏幕切换 —— 本函数禁止触碰 UI。
 */
function applyPublic(pub) {
  const b = state.BATTLE;
  if (!b) return;
  const myIdx = lanMyIndex(b);
  b.seq = pub.seq; b.turn = pub.turn; b.actor = pub.actor; b.winner = pub.winner; b.phase = pub.phase; b.log = pub.log;
  b.players.forEach((P, i) => {
    const s = pub.p[i];
    if (!s) return;
    P.name = s.name || P.name || P.role?.name;
    P.hp = s.hp; P.def = s.def; P.energy = s.energy; P.buffs = s.buffs;
    P.drawCount = s.draw_count; P.handCount = s.hand_count; P.discard = s.discard;
    if (i === myIdx) {
      // 本人席位：服务端投影本人手牌（含 curCost）
      P.hand = s.hand || [];
    } else {
      P.hand = null;
    }
  });
  // 强制弃牌：本人手牌随机弃置 count 张（与服务端随机弃置同分布）
  if (pub.fd && pub.fd.seq === pub.seq && pub.fd.side === myIdx) {
    const hand = b.players[myIdx].hand || [];
    const drop = Math.min(pub.fd.count, hand.length);
    for (let n = 0; n < drop; n++) {
      const idx = Math.floor(Math.random() * hand.length);
      const [c] = hand.splice(idx, 1);
      if (c) b.players[myIdx].discard.push(c);
    }
  }
  window.dispatchEvent(new CustomEvent('lan-battle-state', { detail: pub }));
}

export function renderLanPick() {
  const mySide = state.LAN.side;
  const picks = state.LAN.picks;
  const teams = state.LAN.teams;
  const ready = state.LAN.ready;
  const cap = state.LAN.capacity || CAPACITY;

  // 隐藏超出容量的席位
  for (let i = cap; i < CAPACITY; i++) {
    const slot = $('slot-' + i);
    if (slot) slot.style.display = 'none';
  }

  // 渲染 4 席
  for (let i = 0; i < cap; i++) {
    const slot = $('slot-' + i);
    if (!slot) continue;
    const pick = mySide === i ? state.PICK[i] : (picks[i] ? picks[i].role : null);
    const isHuman = picks[i] ? picks[i].is_human !== false : (mySide === i);
    const seatName = picks[i] && picks[i].name ? picks[i].name : (mySide === i ? getPlayerName() : (isHuman ? '' : cpuLabel(cpuOf(i))));
    const team = teams[i];
    const teamLabel = team != null ? `<span class="team-badge t${team}">${t('pick.team')} ${(team + 1)}</span>` : '';
    const cpuLabel = isHuman ? '' : `<span class="dim" style="font-size:10px">${t('pick.cpu_label')}</span>`;
    const readyLabel = (i !== 0 && ready[i]) ? `<span class="dim" style="font-size:10px;color:var(--green)">✓ ${t('pick.ready')}</span>` : '';
    let body;
    if (pick) {
      body = slotHTML(pick, seatName) + `<div style="display:flex;align-items:center;gap:4px;margin-top:4px">${teamLabel}${cpuLabel}${readyLabel}</div>`;
    } else if (!isHuman && i !== 0) {
      body = `<div class="av" style="opacity:.4">?</div><div class="dim" style="font-size:11px">${t('pick.slot_empty')}</div>`;
    } else {
      const hint = i === mySide ? t('pick.slot_choose') : (i === 0 ? t('pick.slot_wait_host') : (isHuman ? t('pick.slot_wait_guest') : t('pick.slot_empty')));
      body = `<div class="av" style="opacity:.4">?</div><div class="dim" style="font-size:11px">${hint}</div>`;
    }
    slot.innerHTML = body;
  }

  // 房主：可标记空席为电脑
  if (mySide === 0) {
    for (let i = 1; i < cap; i++) {
      if (!picks[i]) {
        const btn = $('slot-' + i).querySelector('.slot-cpu-btn');
        if (!btn) {
          const b = document.createElement('button');
          b.className = 'slot-cpu-btn';
          b.textContent = t('pick.add_cpu');
          b.dataset.action = 'lan-add-cpu';
          b.dataset.side = i;
          $('slot-' + i).appendChild(b);
        }
      }
    }
  }

  // 底部状态 + 就绪/开始按钮
  const filled = picks.filter(Boolean).length;
  const hint = $('lan-hint');
  hint.innerHTML = `<span style="font-size:12px">${filled}/${cap} ${t('pick.lan_status')}<br>${t('pick.lan_team_hint')}</span>`;

  if (mySide === 0) {
    // 房主：开始按钮
    const canStart = canStartRoom();
    let go = $('pk-go');
    go.style.display = '';
    go.textContent = t('pick.lan_host_start');
    go.disabled = !canStart;
    go.className = canStart ? 'primary' : '';
    go.dataset.action = 'go-dice';
  } else {
    // 非房主：就绪按钮
    const myReady = ready[mySide];
    let go = $('pk-go');
    go.style.display = '';
    go.textContent = myReady ? t('pick.lan_cancel_ready') : t('pick.lan_ready_btn');
    go.className = myReady ? '' : 'primary';
    go.dataset.action = 'lan-trigger-ready';
  }
}

function canStartRoom() {
  const picks = state.LAN.picks;
  const teams = state.LAN.teams;
  const ready = state.LAN.ready;
  const cap = state.LAN.capacity || CAPACITY;
  let filled = 0, t0 = 0, t1 = 0, allReady = true;
  for (let i = 0; i < cap; i++) {
    if (!picks[i]) continue;
    filled++;
    if (i !== 0 && !ready[i] && picks[i].is_human !== false) allReady = false;
    const team = teams[i];
    if (team === 0) t0++; else if (team === 1) t1++;
  }
  return filled >= 2 && t0 >= 1 && t1 >= 1 && allReady;
}

export function lanPickPost(side, role, isHuman) {
  const deckIds = (role.deck && role.deck.length) ? role.deck : null;
  let cards = deckIds ? deckIds.map(id => DB.cards.find(c => c.id === id)).filter(Boolean) : [...DB.cards];
  if (!state.LAN.mods) {
    const vanillaIds = getDefaultCardIds();
    cards = cards.filter(c => vanillaIds.has(c.id));
  }
  const effectTypes = [...new Set(cards.flatMap(c => (c.effects || []).map(e => e.type)))];
  const team = state.LAN.teams ? state.LAN.teams[side] : null;
  // 真人席位携带自己的昵称；电脑席位由房主发对应 电脑N 标签
  const name = isHuman === false ? cpuLabel(cpuOf(side)) : getPlayerName();
  fetch(state.LAN.base + '/pick', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: state.LAN.room, side, role, cards, effects: effectTypes, is_human: isHuman !== false, team, name }),
  }).then(r => r.json()).then(d => {
    if (d && !d.ok) alert(t('lan.alert_upload_fail', { err: d.err }));
  }).catch(() => alert(t('lan.alert_upload_fail2')));
}

export function lanSetTeam(side, team) {
  fetch(state.LAN.base + '/team', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: state.LAN.room, side, team }),
  }).then(r => r.json()).catch(() => {});
}

export function lanSetReady(side, ready) {
  fetch(state.LAN.base + '/ready', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: state.LAN.room, side, ready }),
  }).then(r => r.json()).catch(() => {});
}

export function lanAddCpu(side) {
  // 房主为空席随机选一个角色并标记为电脑
  const opts = state.PICK_OPTIONS[side] || DB.subfactions;
  const r = opts[Math.floor(Math.random() * opts.length)];
  state.PICK[side] = JSON.parse(JSON.stringify(r));
  state.LAN.teams[side] = state.LAN.teams[side] ?? (side % 2 === 0 ? 0 : 1);
  lanPickPost(side, state.PICK[side], false);
  lanSetReady(side, true);
  renderSlots();
  renderLanPick();
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
        <div><b>${esc(r.name || r.room)}</b> ${modsLabel}<span class="dim" style="font-size:11px"> · ${r.picks}/${r.capacity || 4} ${t('lan.ready')}</span></div>
        <span style="display:flex;align-items:center;gap:8px">
          <span class="dim" style="font-size:11px">${r.playing ? t('lan.playing') : t('lan.wait_join')}</span>
          ${r.playing ? '' : `<button class="primary" data-action="lan-join-room" data-room="${r.room}">${t('lan.join')}</button>`}
        </span>
      </div>`;
    }).join('');
  }).catch(() => { });
}

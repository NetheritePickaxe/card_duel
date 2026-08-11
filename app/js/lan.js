import { $, show, esc, toast } from './util.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { DB, getDefaultCardIds } from './data.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { newBattle, logT, forceDiscard, checkTeamWinner, lanMyIndex } from './core.js?v=__VERSION__';
import { renderBattle, showBattle, renderSlots, slotHTML, playCardAnim } from './render.js?v=__VERSION__';
import { startTurn } from './battle.js?v=__VERSION__';
import { goDice, openPick } from './pick.js?v=__VERSION__';

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

function lanMeta() {
  // 从 LAN 状态合并 meta（picks/teams/ready），供 buildDefs 使用
  state.LAN.teamsArr = state.LAN.teams || new Array(CAPACITY).fill(null);
  state.LAN.readyArr = state.LAN.ready || new Array(CAPACITY).fill(false);
}

export function lanCreate() {
  const gameName = t('lan.new_game_name') || '卡牌对决';
  const modsEnabled = $('mods-toggle')?.checked ?? false;
  fetch(currentServer + '/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: gameName, mods: modsEnabled }), cache: 'no-store',
  }).then(r => r.json()).then(d => {
    if (!d.ok) { alert(t('lan.alert_create_fail')); return; }
    state.LAN = { base: currentServer, room: d.room, gameName, mods: modsEnabled, side: 0, lastSeq: 0, timer: null, ...initLan(), hostData: null };
    state.MODE = 'lan';
    stopRoomList();
    lanMeta();
    $('lan-info').textContent = t('lan.waiting');
    openPick();
    renderSlots();
    lanPoll();
  }).catch(() => alert(t('lan.alert_conn_fail')));
}

export function lanJoinRoom(room) {
  fetch(currentServer + '/join?room=' + room, { cache: 'no-store' }).then(r => r.json()).then(d => {
    if (!d.ok) { alert(t('lan.alert_join_fail', { err: d.err })); return; }
    const roomData = cachedRooms.find(r => r.room === room);
    const mods = roomData?.mods ?? true;
    const side = d.side ?? 1;
    state.LAN = { base: currentServer, room, mods, side, lastSeq: 0, timer: null, ...initLan(), hostData: null };
    state.MODE = 'lan';
    stopRoomList();
    lanMeta();
    $('lan-info').textContent = t('lan.waiting');
    openPick();
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
    state.LAN.picks = d.picks || new Array(CAPACITY).fill(null);
    state.LAN.teams = d.teams || new Array(CAPACITY).fill(null);
    state.LAN.ready = d.ready || new Array(CAPACITY).fill(false);
    state.LAN.capacity = d.capacity || CAPACITY;
    lanMeta();
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
  const picks = state.LAN.picks;
  const teams = state.LAN.teams;
  const ready = state.LAN.ready;
  const cap = state.LAN.capacity || CAPACITY;

  // 渲染 4 席
  for (let i = 0; i < cap; i++) {
    const slot = $('slot-' + i);
    if (!slot) continue;
    const pick = mySide === i ? state.PICK[i] : (picks[i] ? picks[i].role : null);
    const isHuman = picks[i] ? picks[i].is_human !== false : (mySide === i);
    const team = teams[i];
    const teamLabel = team != null ? `<span class="team-badge t${team}">${t('pick.team')} ${(team + 1)}</span>` : '';
    const cpuLabel = isHuman ? '' : `<span class="dim" style="font-size:10px">${t('pick.cpu_label')}</span>`;
    const readyLabel = (i !== 0 && ready[i]) ? `<span class="dim" style="font-size:10px;color:var(--green)">✓ ${t('pick.ready')}</span>` : '';
    let body;
    if (pick) {
      body = slotHTML(pick) + `<div style="display:flex;align-items:center;gap:4px;margin-top:4px">${teamLabel}${cpuLabel}${readyLabel}</div>`;
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
  fetch(state.LAN.base + '/pick', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: state.LAN.room, side, role, cards, effects: effectTypes, is_human: isHuman !== false, team }),
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

/* ============ 战斗同步 ============ */

function isCpuSeat(b, i) {
  return b.humans && !b.humans[i];
}

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
  const myIdx = lanMyIndex(b);
  b.seq = pub.seq; b.turn = pub.turn; b.actor = pub.actor; b.winner = pub.winner; b.phase = pub.phase; b.log = pub.log;
  b.players.forEach((P, i) => {
    P.hp = pub.p[i].hp; P.def = pub.p[i].def; P.energy = pub.p[i].energy; P.buffs = pub.p[i].buffs;
    if (i !== myIdx) { P.drawCount = pub.p[i].drawCount; P.handCount = pub.p[i].handCount; P.discard = pub.p[i].discard; P.hand = null; }
  });
  if (!$('sc-battle').classList.contains('on')) showBattle(); else renderBattle();
  if (pub.play && pub.play.seq === pub.seq && pub.play.card && pub.play.pi !== myIdx) playCardAnim(pub.play.pi, pub.play.card, pub.play.events, () => { });
  if (pub.fd && pub.fd.seq === pub.seq && pub.fd.side === myIdx) {
    const pre = b.seq;
    forceDiscard(b, myIdx, pub.fd.count);
    renderBattle();
    if (b.seq === pre) lanPost();
  }
  if (!b.winner && b.phase === 'awaiting' && b.actor === myIdx) {
    b.phase = 'playing';
    const preSeq = b.seq;
    startTurn(b);
    if (b.seq === preSeq) lanPost();
  }
  // 房主代跑空席电脑
  if (state.LAN.side === 0 && !b.winner && isCpuSeat(b, b.actor) && b.phase === 'awaiting') {
    import('./battle.js?v=__VERSION__').then(m => {
      b.phase = 'playing';
      const preSeq = b.seq;
      m.cpuActOnce(b);
      if (b.seq === preSeq) lanPost();
    });
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
        <div><b>${esc(r.name || r.room)}</b> ${modsLabel}<span class="dim" style="font-size:11px"> · ${r.picks}/${r.capacity || 4} ${t('lan.ready')}</span></div>
        <span style="display:flex;align-items:center;gap:8px">
          <span class="dim" style="font-size:11px">${r.playing ? t('lan.playing') : t('lan.wait_join')}</span>
          ${r.playing ? '' : `<button class="primary" data-action="lan-join-room" data-room="${r.room}">${t('lan.join')}</button>`}
        </span>
      </div>`;
    }).join('');
  }).catch(() => { });
}
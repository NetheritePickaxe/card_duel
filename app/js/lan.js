import { $, show } from './util.js';
import { state } from './state.js';
import { DB } from './data.js';
import { newBattle, log, forceDiscard } from './core.js';
import { renderBattle, showBattle, renderSlots, slotHTML, playCardAnim } from './render.js';
import { startTurn } from './battle.js';
import { goDice, openPick } from './pick.js';

export function lanBase() {
  const v = $('lan-url').value.trim();
  return (v || location.origin || 'http://127.0.0.1:8788').replace(/\/+$/, '');
}

export function lanCreate() {
  fetch(lanBase() + '/create', { cache: 'no-store' }).then(r => r.json()).then(d => {
    if (!d.ok) { alert('创建失败'); return; }
    state.LAN = { base: lanBase(), room: d.room, side: 0, lastSeq: 0, timer: null, picks: [null, null], hostData: null };
    state.MODE = 'lan';
    stopRoomList();
    fetch(lanBase() + '/hostdata', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: d.room, data: DB }), cache: 'no-store',
    }).catch(() => { });
    $('lan-info').innerHTML = `房间号 <b style="color:var(--acc);font-size:18px">${d.room}</b><br>等待对方加入…`;
    openPick();
    $('pk-title').textContent = '选择角色 · 局域网（你是房主 P0）';
    renderSlots();
    lanPoll();
  }).catch(() => alert('无法连接服务器，请确认电脑端正在运行'));
}

export function lanJoinRoom(room) {
  room = (room || '').trim().toUpperCase();
  if (!room) { alert('请输入房间号'); return; }
  fetch(lanBase() + '/join?room=' + room, { cache: 'no-store' }).then(r => r.json()).then(d => {
    if (!d.ok) { alert('加入失败：' + d.err); return; }
    state.LAN = { base: lanBase(), room, side: 1, lastSeq: 0, timer: null, picks: [null, null], hostData: null };
    state.MODE = 'lan';
    stopRoomList();
    fetch(lanBase() + '/hostdata?room=' + room, { cache: 'no-store' }).then(r => r.json()).then(dd => {
      if (dd && dd.ok && dd.data) state.LAN.hostData = dd.data;
    }).catch(() => { });
    $('lan-info').textContent = '已加入房间 ' + room + '，等待房主…';
    openPick();
    $('pk-title').textContent = '选择角色 · 局域网（你是 P1）';
    renderSlots();
    lanPoll();
  }).catch(() => alert('无法连接服务器'));
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
      if (state.PHASE_BATTLE || $('sc-pick').classList.contains('on')) alert('房间已关闭（对方已退出）');
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
  $('lan-hint').innerHTML = `房间号 <b style="color:var(--acc);font-size:18px">${state.LAN.room}</b> · ${mySide === 0 ? '你是房主(P0)' : '你是加入方(P1)'}<br><span style="font-size:12px">服务器状态：P0 ${state.LAN.picks[0] ? '已选' : '未选'} · P1 ${state.LAN.picks[1] ? '已选' : '未选'}${both ? ' · 即将开始' : ''}</span>`;
  const p0 = mySide === 0 ? state.PICK[0] : (state.LAN.picks[0] ? state.LAN.picks[0].role : null);
  $('slot-0').innerHTML = p0 ? slotHTML(p0) : `<div class="av" style="opacity:.4">?</div><div class="dim">${mySide === 0 ? '点击选择' : '等待房主选择…'}</div>`;
  const p1 = mySide === 1 ? state.PICK[1] : (state.LAN.picks[1] ? state.LAN.picks[1].role : null);
  $('slot-1').innerHTML = p1 ? slotHTML(p1) : `<div class="av" style="opacity:.4">?</div><div class="dim">${mySide === 1 ? '点击选择' : '等待对方选择…'}</div>`;
  if (mySide === 0 && both) {
    $('pk-go').style.display = '';
    $('pk-go').textContent = '双方已就绪，即将开始…';
    if (!state.LAN._auto) { state.LAN._auto = true; setTimeout(() => { if (state.LAN && state.LAN.picks && state.LAN.picks[0] && state.LAN.picks[1] && !state.BATTLE) goDice(); }, 1500); }
  } else {
    $('pk-go').style.display = 'none';
  }
}

export function lanPickPost(side, role) {
  fetch(state.LAN.base + '/pick', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: state.LAN.room, side, role, cards: DB.cards }),
  }).then(r => r.json()).then(d => {
    if (d && !d.ok) alert('上传角色选择失败：' + (d.err || ''));
  }).catch(() => alert('上传角色选择失败，请检查网络连接'));
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
    if (d && !d.ok && d.err) log(state.BATTLE, '[同步] ' + d.err);
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

/* 可加入房间列表 */
export function startRoomList() {
  stopRoomList();
  roomListTick();
  state.ROOM_TICKER = setInterval(roomListTick, 2000);
}

export function stopRoomList() {
  if (state.ROOM_TICKER) { clearInterval(state.ROOM_TICKER); state.ROOM_TICKER = null; }
}

function roomListTick() {
  fetch(lanBase() + '/rooms', { cache: 'no-store' }).then(r => r.json()).then(d => {
    if (!d.ok) return;
    const list = $('room-list');
    if (!d.rooms || !d.rooms.length) {
      list.innerHTML = '<div class="dim" style="padding:12px;text-align:center">暂无房间，点击上方「创建房间」</div>';
      return;
    }
    list.innerHTML = d.rooms.map(r => `
      <div class="room-row">
        <div><b style="letter-spacing:1px">${r.room}</b><span class="dim" style="font-size:11px"> · ${r.picks}/2 已就绪</span></div>
        <span style="display:flex;align-items:center;gap:8px">
          <span class="dim" style="font-size:11px">${r.playing ? '对战中' : '等待加入'}</span>
          ${r.playing ? '' : `<button class="primary" data-action="lan-join-room" data-room="${r.room}">加入</button>`}
        </span>
      </div>`).join('');
  }).catch(() => { });
}
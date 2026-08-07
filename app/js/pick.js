import { $, show, esc, rollPair, rollOnce } from './util.js';
import { state } from './state.js';
import { DB } from './data.js';
import { newBattle, log } from './core.js';
import { renderBattle, showBattle, renderSlots, slotHTML } from './render.js';
import { startTurn } from './battle.js';
import { stopRoomList, lanPickPost, lanPost, lanBase, renderLanPick, startRoomList } from './lan.js';

export function startVsAI() { state.MODE = 'ai'; openPick(); }
export function startLocal() { state.MODE = 'local'; openPick(); }

export function openLAN() {
  show('sc-lan');
  $('lan-info').textContent = '';
  $('lan-join-row').style.display = 'none';
  startRoomList();
}

export function backMenu() {
  if (state.PHASE_BATTLE && state.BATTLE && !state.BATTLE.winner && !confirm('确定退出当前对局？')) return;
  if (state.LAN) {
    if (state.LAN.timer) { clearTimeout(state.LAN.timer); state.LAN.timer = null; }
    try {
      fetch((state.LAN.base || lanBase()) + '/leave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: state.LAN.room, side: state.LAN.side }),
      });
    } catch (e) { /* ignore */ }
    state.LAN = null;
  }
  stopRoomList();
  state.BATTLE = null;
  state.PHASE_BATTLE = false;
  state.DICING = false;
  show('sc-menu');
}

export function quitBattle() { backMenu(); }

export function openPick() {
  state.PICK = [null, null];
  $('pk-title').textContent = state.MODE === 'ai' ? '选择角色 · 对战AI' : state.MODE === 'local' ? '选择角色 · 本地对战' : '选择角色 · 局域网';
  $('lan-hint').textContent = state.MODE === 'lan' && state.LAN ? (`房间号 <b style="color:var(--acc);font-size:18px">${state.LAN.room}</b> · ` + (state.LAN.side === 0 ? '你是房主(P0)，把房间号发给对方' : '你是加入方(P1)，已加入房间')) : '';
  renderSlots();
  show('sc-pick');
}

export function pickRole(i) {
  if (state.MODE === 'lan' && i !== state.LAN.side) return;
  const hr = (state.LAN && state.LAN.hostData && state.LAN.hostData.roles) || [];
  const seen = {}, all = [];
  for (const r of [...hr, ...DB.roles]) { if (!seen[r.id]) { seen[r.id] = 1; all.push(r); } }
  state.PICK_OPTIONS[i] = all;
  const m = $('mbox');
  m.innerHTML = `<div class="mhead">为 ${i === 0 ? 'P0' : 'P1'} 选择角色${state.MODE === 'ai' && i === 0 ? '（AI 对手）' : state.MODE === 'ai' && i === 1 ? '（你）' : ''}</div>
    ${all.map((r, j) => `<div class="mrole" data-action="set-pick" data-slot="${i}" data-index="${j}"><div class="av sm">${r.img ? `<img src="${r.img}">` : esc(r.name[0])}</div><div><b>${esc(r.name)}</b>${state.LAN && state.LAN.hostData && state.LAN.hostData.roles.some(h => h.id === r.id) ? '<span class="dim" style="font-size:10px"> · 房主自定义</span>' : ''}<div class="dim" style="font-size:11px">HP${r.hp} · 防${r.def} · 能${r.eng} · 牌组${(r.deck || []).length}张</div></div></div>`).join('')}
    <div style="text-align:center;margin-top:10px"><button data-action="pick-random" data-slot="${i}">随机选择</button></div>`;
  $('modal').classList.add('on');
}

export function closeModal() { $('modal').classList.remove('on'); }

export function setPick(i, j) {
  if (state.MODE === 'lan' && i !== state.LAN.side) return;
  const r = JSON.parse(JSON.stringify((state.PICK_OPTIONS[i] || DB.roles)[j]));
  state.PICK[i] = r;
  if (state.MODE === 'lan') lanPickPost(i, r);
  closeModal();
  renderSlots();
  if (state.MODE === 'lan') renderLanPick();
}

export function setPickRandom(i) {
  if (state.MODE === 'lan' && i !== state.LAN.side) return;
  const opts = state.PICK_OPTIONS[i] || DB.roles;
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  state.PICK[i] = JSON.parse(JSON.stringify(opts[r[0] % opts.length]));
  if (state.MODE === 'lan') lanPickPost(i, state.PICK[i]);
  closeModal();
  renderSlots();
  if (state.MODE === 'lan') renderLanPick();
}

export function goDice() {
  if (state.DICING) return;
  state.DICING = true;
  const [a, b] = rollPair();
  $('dice-name0').textContent = state.PICK[0] ? state.PICK[0].name : 'P0';
  $('dice-name1').textContent = state.PICK[1] ? state.PICK[1].name : 'P1';
  $('die-0').textContent = '·'; $('die-1').textContent = '·';
  $('dice-msg').textContent = '掷骰中…';
  $('die-0').className = 'die rolling'; $('die-1').className = 'die rolling';
  show('sc-dice');
  setTimeout(() => {
    $('die-0').className = 'die'; $('die-1').className = 'die';
    $('die-0').textContent = a; $('die-1').textContent = b;
    const first = a > b ? 0 : 1;
    $('dice-msg').textContent = `${a} : ${b}　${(first === 0 ? $('dice-name0').textContent : $('dice-name1').textContent)} 先手`;
    setTimeout(() => startBattleFromDice(first, a, b), 1000);
  }, 800);
}

function startBattleFromDice(first, a, b) {
  state.PHASE_BATTLE = true;
  if (state.MODE === 'lan') {
    if (state.LAN.side !== 0) return;
    state.BATTLE = newBattle('lan', buildDefs());
    state.BATTLE.actor = first;
    state.BATTLE.phase = 'awaiting';
    state.BATTLE.log.push(`骰子 ${a} : ${b}，${state.BATTLE.players[first].role.name} 先手`);
    lanPost();
    showBattle();
    if (first === 0) { state.BATTLE.phase = 'playing'; startTurn(state.BATTLE); lanPost(); }
  } else {
    state.BATTLE = newBattle(state.MODE, buildDefs());
    state.BATTLE.actor = first;
    state.BATTLE.phase = 'playing';
    state.BATTLE.log.push(`骰子 ${a} : ${b}，${state.BATTLE.players[first].role.name} 先手`);
    startTurn(state.BATTLE);
    showBattle();
  }
}

function buildDefs() {
  if (state.MODE === 'lan') {
    const p0 = state.LAN.picks[0], p1 = state.LAN.picks[1];
    const roles = [p0.role, p1.role];
    const need = new Set();
    roles.forEach(r => (r.deck || []).forEach(id => need.add(id)));
    const seen = {}, m = [];
    for (const c of [...DB.cards, ...(p1.cards || [])]) {
      if (!seen[c.id]) { seen[c.id] = 1; if (need.size === 0 || need.has(c.id)) m.push(c); }
    }
    return { roles, cards: m };
  }
  return { roles: [state.PICK[0], state.PICK[1]], cards: DB.cards };
}
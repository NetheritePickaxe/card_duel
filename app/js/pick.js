import { $, show, toast, esc, rollOnce, shuffle } from './util.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { DB, getDefaultSubfactionIds, getFaction } from './data.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { newBattle, logT } from './core.js?v=__VERSION__';
import { renderBattle, showBattle, renderSlots, slotHTML } from './render.js?v=__VERSION__';
import { stopRoomList, lanPickPost, lanBase, renderLanPick, startRoomList, renderServerList, scanLan, lanAct } from './lan.js?v=__VERSION__';
import { startBattleFlow } from './battle.js?v=__VERSION__';

export function startSkirmish() {
  state.GAME_MODE = 'random';
  state.MODE = 'skirmish';
  state.MULTI = false;
  state.PICK = [null];
  state.PICK_HUMAN = [true];
  state.PICK_TEAMS = [0];
  openPick(1);
}

export function startCampaign() {
  toast(t('menu.campaign_soon'));
}

export function updateGameMode(mode) {
  state.GAME_MODE = mode;
  if (mode === 'random') {
    // 遭遇战：选人阶段只显示玩家自己的座位，AI 数量/角色进战斗才随机生成
    state.MODE = 'skirmish';
    state.MULTI = false;
    state.PICK = [null];
    state.PICK_HUMAN = [true];
    state.PICK_TEAMS = [0];
    openPick(1);
    return;
  }
  const n = parseInt($('pk-player-count')?.value) || 2;
  state.MODE = 'local';
  state.MULTI = true;
  state.PICK = new Array(n).fill(null);
  if (!state.PICK_HUMAN || state.PICK_HUMAN.length !== n) state.PICK_HUMAN = new Array(n).fill(true);
  if (!state.PICK_TEAMS || state.PICK_TEAMS.length !== n) state.PICK_TEAMS = new Array(n).fill(0).map((_, i) => i < n / 2 ? 0 : 1);
  openPick(n);
}

function renderModeBar() {
  const modes = [
    { v: 'random', key: 'pick.mode_random' },
    { v: 'custom', key: 'pick.mode_custom' },
    { v: 'multi', key: 'pick.mode_multi' },
  ];
  const bar = $('pk-mode-bar');
  if (!bar) return;
  bar.innerHTML = modes.map(m =>
    `<button class="mode-btn ${m.v === state.GAME_MODE ? 'on' : ''}" data-action="update-game-mode" data-mode="${m.v}">${t(m.key)}</button>`
  ).join('');
  $('pk-multi-opts').style.display = (state.GAME_MODE === 'multi' || state.GAME_MODE === 'custom') ? 'flex' : 'none';
}

export function updatePlayerCount() {
  if (state.GAME_MODE === 'random') return;
  const sel = $('pk-player-count');
  if (!sel) return;
  const n = parseInt(sel.value) || 2;
  state.MODE = 'local';
  state.MULTI = true;
  state.PICK = new Array(n).fill(null);
  state.PICK_HUMAN = new Array(n).fill(true);
  state.PICK_TEAMS = new Array(n).fill(0).map((_, i) => i < n / 2 ? 0 : 1);
  renderSlots();
  renderModeBar();
  renderTeamSelect();
}

export function openLAN() {
  show('sc-lan');
  renderServerList();
  $('mixed-content-warning').style.display = 'none';
  $('server-panel').style.display = 'none';
  $('server-list-section').style.display = 'block';
  $('add-server-section').style.display = 'block';
  setTimeout(() => scanLan(), 500);
}

export function backMenu() {
  if (state.PHASE_BATTLE && state.BATTLE && !state.BATTLE.winner && !confirm(t('alert.confirm_quit'))) return;
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
  state.MULTI = false;
  show('sc-menu');
}

export function quitBattle() { backMenu(); }

// lan.js 完成建房/加入后派发，这里统一进入选人界面（断环：lan → pick）
window.addEventListener('lan-room-ready', () => {
  if (state.MODE === 'lan') openPick();
});

export function openPick(count) {
  // 遭遇战：1 座位（玩家），随机 AI 进战斗才生成；自定义/多人：count 或已有 PICK 长度
  const n = state.GAME_MODE === 'random'
    ? (count || 1)
    : (state.MODE === 'lan' ? (state.LAN?.capacity || 4) : (count || state.PICK?.length || 2));
  // 保留已有选择（startSkirmish 预选的随机对手/玩家已选角色），LAN 模式重置避免污染
  const prev = state.MODE === 'lan' ? [] : (state.PICK || []);
  state.PICK = new Array(n).fill(null).map((_, i) => prev[i] ?? null);
  if (!state.PICK_HUMAN || state.PICK_HUMAN.length !== n) {
    state.PICK_HUMAN = new Array(n).fill(true);
    if (state.GAME_MODE !== 'multi' && state.GAME_MODE !== 'random' && state.GAME_MODE !== 'custom') state.PICK_HUMAN[0] = false;
  }
  if (!state.PICK_TEAMS || state.PICK_TEAMS.length !== n) {
    state.PICK_TEAMS = new Array(n).fill(0).map((_, i) => i < n / 2 ? 0 : 1);
  }
  const sel = $('pk-player-count');
  if (sel) sel.value = String(n);
  const title = state.MODE === 'lan' ? t('pick.title_lan') : (state.GAME_MODE === 'random' ? t('pick.title_cpu') : t('pick.title_local'));
  $('pk-title').textContent = title;
  $('lan-hint').innerHTML = '';
  renderSlots();
  renderModeBar();
  renderTeamSelect();
  show('sc-pick');
}

// LAN 只能操作自己席位；本地模式 AI 席位锁定；遭遇战仅玩家（1 座）可选
function seatPickable(i) {
  if (state.MODE === 'lan') return i === state.LAN.side;
  if (state.GAME_MODE === 'random') return i === 0;
  if (state.MODE === 'local') return !state.PICK_HUMAN || state.PICK_HUMAN[i];
  return true;
}

export function pickRole(i) {
  if (!seatPickable(i)) return;
  let all = state.MODE === 'lan' ? DB.subfactions : [...(state.LAN?.hostData?.subfactions || []), ...DB.subfactions];
  if (state.MODE === 'lan' && !state.LAN.mods) {
    const vanillaIds = getDefaultSubfactionIds();
    all = all.filter(r => vanillaIds.has(r.id));
  }
  state.PICK_OPTIONS[i] = all;
  const groups = getPickGroups(all);
  const m = $('mbox');
  const sideLabel = state.MODE === 'cpu' ? (i === 0 ? t('pick.cpu_opponent') : t('pick.you')) : (state.GAME_MODE === 'random' ? t('pick.you') : t('pick.side', { n: i + 1 }));
  m.innerHTML = `<div class="mhead">${esc(sideLabel)}</div>
    ${groups.map(g => `
      <div class="pick-faction-header">${esc(g.name)}</div>
      ${g.roles.map((r, j) => {
        const idx = all.indexOf(r);
        return `<div class="mrole" data-action="set-pick" data-slot="${i}" data-index="${idx}"><div class="av sm">${r.img ? `<img src="${r.img}">` : esc(r.name[0])}</div><div><b>${esc(r.name)}</b><div class="dim" style="font-size:11px">${t('edit.stat_hp')}${r.hp} · ${t('edit.stat_def')}${r.def} · ${t('edit.stat_eng')}${r.eng} · ${t('edit.stat_deck')}${(r.deck || []).length}${t('edit.stat_count')}</div></div></div>`;
      }).join('')}
    `).join('')}
    <div style="text-align:center;margin-top:10px"><button data-action="pick-random" data-slot="${i}">${t('pick.random')}</button></div>`;
  $('modal').classList.add('on');
}

function getPickGroups(roles) {
  const fid = new Set(DB.factions.map(f => f.id));
  const groups = [];
  for (const f of DB.factions) {
    const fr = roles.filter(r => r.faction === f.id);
    if (fr.length) groups.push({ name: f.name, roles: fr });
  }
  const freelancers = roles.filter(r => !r.faction || !fid.has(r.faction));
  if (freelancers.length) groups.push({ name: t('edit.faction_none'), roles: freelancers });
  return groups;
}

export function closeModal() { $('modal').classList.remove('on'); }

export function setPick(i, j) {
  if (!seatPickable(i)) return;
  const r = JSON.parse(JSON.stringify((state.PICK_OPTIONS[i] || DB.subfactions)[j]));
  state.PICK[i] = r;
  if (state.MODE === 'lan') lanPickPost(i, r);
  closeModal();
  renderSlots();
  if (state.MODE === 'lan') renderLanPick();
}

export function setPickRandom(i) {
  if (!seatPickable(i)) return;
  const opts = state.PICK_OPTIONS[i] || DB.subfactions;
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  state.PICK[i] = JSON.parse(JSON.stringify(opts[r[0] % opts.length]));
  if (state.MODE === 'lan') lanPickPost(i, state.PICK[i]);
  closeModal();
  renderSlots();
  if (state.MODE === 'lan') renderLanPick();
}

export function renderTeamRows(wrap, n) {
  if (!wrap) return;
  if (n <= 0) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  wrap.style.display = 'flex';
  wrap.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const team = state.PICK_TEAMS ? state.PICK_TEAMS[i] : (i < n / 2 ? 0 : 1);
    const isHuman = !state.PICK_HUMAN || state.PICK_HUMAN[i];
    const name = state.PICK[i]?.name || 'P' + (i + 1);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px';
    row.innerHTML = `<span class="dim">${esc(name)}</span>
      <button data-action="toggle-pick-team" data-slot="${i}" style="padding:2px 8px;font-size:11px">${t('pick.team')} ${team + 1}</button>
      <button data-action="toggle-pick-human" data-slot="${i}" style="padding:2px 8px;font-size:11px">${isHuman ? t('pick.you') : t('pick.cpu_label')}</button>`;
    wrap.appendChild(row);
  }
}

export function renderTeamSelect() {
  const wrap = $('pk-team-select');
  if (!wrap) return;
  const n = state.PICK ? state.PICK.length : 0;
  // 遭遇战（random）不显示队伍/人电切换；自定义与本地多人在 openPick 时显示（隐藏由 mode bar / player count 触发）
  if (state.GAME_MODE === 'random' || state.MODE === 'lan' || state.MODE === 'skirmish') { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  renderTeamRows(wrap, n);
}

export function togglePickTeam(i) {
  // 队伍 0~3 循环
  state.PICK_TEAMS[i] = ((state.PICK_TEAMS[i] ?? 0) + 1) % 4;
  renderTeamSelect();
  renderSlots();
}

export function togglePickHuman(i) {
  state.PICK_HUMAN[i] = !state.PICK_HUMAN[i];
  if (!state.PICK_HUMAN[i]) {
    if (!state.PICK[i]) {
      const opts = state.PICK_OPTIONS[i] || DB.subfactions;
      const r = new Uint32Array(1);
      crypto.getRandomValues(r);
      state.PICK[i] = JSON.parse(JSON.stringify(opts[r[0] % opts.length]));
    }
  }
  renderTeamSelect();
  renderSlots();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 渲染 N 颗骰子布局（2=左右围着VS，3=上二下一，4=上下左右围着VS）
function renderDiceWrap(names) {
  const n = names.length;
  const wrap = $('dice-wrap');
  wrap.dataset.n = String(n);
  wrap.innerHTML = names.map((nm, i) =>
    `<div class="dice-cell d${i}"><div class="die" id="die-${i}">·</div><div class="dname" id="dname-${i}"></div></div>`
  ).join('') + (n === 3 ? '' : '<div class="dice-vs">VS</div>');
  names.forEach((nm, i) => { const el = $('dname-' + i); if (el) el.textContent = nm; });
}

// 逐轮比大小排序：一轮全部掷出，平局者单独重掷，其余保持不变，直到全部定序
async function resolveDiceOrder(n) {
  const vals = new Array(n).fill(0);
  for (let i = 0; i < n; i++) { vals[i] = rollOnce(); }
  for (let i = 0; i < n; i++) {
    const el = $('die-' + i);
    el.className = 'die rolling';
    el.textContent = '·';
  }
  await sleep(750);
  for (let i = 0; i < n; i++) {
    const el = $('die-' + i);
    el.className = 'die';
    el.textContent = vals[i];
  }
  const order = [];
  let pending = [...Array(n).keys()];
  let guard = 0;
  while (pending.length) {
    if (++guard > 100) { order.push(...pending); break; }
    const maxVal = Math.max(...pending.map(i => vals[i]));
    const tops = pending.filter(i => vals[i] === maxVal);
    if (tops.length === 1) {
      const seat = tops[0];
      order.push(seat);
      pending = pending.filter(i => i !== seat);
      const el = $('die-' + seat);
      if (el) { el.classList.add('winner'); }
      await sleep(550);
      continue;
    }
    // 平局：并列者重掷，其余保持不变
    for (const i of tops) {
      vals[i] = rollOnce();
      const el = $('die-' + i);
      el.className = 'die rolling';
      el.textContent = '·';
    }
    await sleep(700);
    for (const i of tops) {
      const el = $('die-' + i);
      el.className = 'die';
      el.textContent = vals[i];
    }
    await sleep(450);
  }
  return order;
}

export async function goDice() {
  if (state.DICING) return;
  state.DICING = true;
  // 骰子参与方：遭遇战 = 玩家 + AI 方；自定义/多人 = 每座位；LAN = 队伍代表
  let names, seatOf;
  if (state.MODE === 'lan') {
    const teams = state.LAN.teams.map((t, i) => t ?? 0);
    const reps = [...new Set(teams)].map(team => teams.indexOf(team));
    names = reps.map(r => state.LAN.picks?.[r]?.role?.name || ('队 ' + (teams[r] + 1)));
    seatOf = reps;
  } else if (state.GAME_MODE === 'random') {
    names = [state.PICK[0]?.name || t('pick.you'), t('pick.cpu_label')];
    seatOf = [0, 1];
  } else {
    const n = state.PICK ? state.PICK.length : 2;
    names = state.PICK.map((p, i) => p?.name || ('P' + (i + 1)));
    seatOf = [...Array(n).keys()];
  }
  renderDiceWrap(names);
  $('dice-msg').textContent = t('pick.roll_ing');
  show('sc-dice');
  const order = await resolveDiceOrder(names.length);
  // 完整行动顺序（先手→后手），映射为座位
  const fullOrder = order.map(i => seatOf[i]);
  const firstName = names[order[0]];
  $('dice-msg').textContent = t('pick.roll_first', { name: firstName });
  state.DICING = false;
  setTimeout(() => startBattleFromDice(fullOrder), 1000);
}

function startBattleFromDice(fullOrder) {
  state.PHASE_BATTLE = true;
  if (state.MODE === 'lan') {
    // 服务端权威开局：提交 start 意图（first = 先手队伍次序），状态回传后自动进入战斗
    const teams = state.LAN.teams.map((t, i) => t ?? 0);
    const reps = [...new Set(teams)].map(team => teams.indexOf(team));
    const firstSeat = fullOrder && fullOrder.length ? fullOrder[0] : reps[0];
    const first = Math.max(0, teams[firstSeat] ?? 0);
    if (state.LAN.side !== 0) return;
    lanAct(0, { type: 'start', first }).then(d => {
      if (d && d.err && !d.ok) state.PHASE_BATTLE = false;
    });
    return;
  }
  const defs = state.GAME_MODE === 'random' ? buildSkirmishDefs() : buildDefs();
  const hasAI = defs.humans.some(h => !h);
  const battleMode = hasAI ? 'cpu' : 'local';
  // 遭遇战：骰子只分出玩家/AI 方先后；生成后玩家固定座位 0，AI 为 1..k
  let first, order;
  if (state.GAME_MODE === 'random') {
    const playerSeat = 0;
    const aiFirst = fullOrder[0] === 1;
    const aiSeats = defs.subfactions.map((_, i) => i).filter(i => i !== playerSeat);
    const aisShuffled = shuffle([...aiSeats]);
    order = aiFirst ? [...aisShuffled, playerSeat] : [playerSeat, ...aisShuffled];
    first = order[0];
  } else {
    order = fullOrder;
    first = order && order.length ? order[0] : 0;
  }
  console.log('[startBattleFromDice] mode=' + battleMode + ', first=' + first + ', order=' + JSON.stringify(order) + ', humans=' + JSON.stringify(defs.humans) + ', n=' + defs.subfactions.length);
  state.BATTLE = newBattle(battleMode, defs, first, order);
  state.BATTLE.actor = first;
  state.BATTLE.phase = 'playing';
  console.log('[startBattleFromDice] BATTLE actor=' + state.BATTLE.actor + ', humans=' + JSON.stringify(state.BATTLE.humans) + ', players=' + state.BATTLE.players.length);
  const firstName = defs.subfactions[first]?.name || '队';
  logT(state.BATTLE, 'pick.roll_first', { name: firstName });
  showBattle();
  startBattleFlow();
}

// 遭遇战：玩家 + 随机 1~3 个 AI（不重复），AI 全归队 1
function buildSkirmishDefs() {
  const player = state.PICK[0];
  const opts = DB.subfactions;
  const pool = opts.filter(r => r.id !== player?.id);
  const k = 1 + Math.floor(Math.random() * 3); // 1~3 个 AI
  const ais = [];
  for (let i = 0; i < k && pool.length; i++) {
    const r = Math.floor(Math.random() * pool.length);
    ais.push(JSON.parse(JSON.stringify(pool.splice(r, 1)[0])));
  }
  const subfactions = [player, ...ais];
  const teams = subfactions.map((_, i) => i === 0 ? 0 : 1);
  const humans = subfactions.map((_, i) => i === 0);
  return { subfactions, cards: DB.cards, factions: DB.factions, teams, humans };
}

// 本地模式定义构建（LAN 由服务端从房间选择构建，客户端不再本地组卡）
function buildDefs() {
  const subfactions = [...state.PICK];
  const teams = subfactions.length === 2 ? [0, 1] : (state.PICK_TEAMS || subfactions.map((_, i) => i < subfactions.length / 2 ? 0 : 1));
  const humans = state.PICK_HUMAN || subfactions.map((_, i) => state.MODE === 'cpu' ? i !== 0 : true);
  return { subfactions, cards: DB.cards, factions: DB.factions, teams, humans };
}
import { $, show, esc, rollPair } from './util.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { DB, getDefaultSubfactionIds, getFaction } from './data.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { newBattle, logT, buildOrder } from './core.js?v=__VERSION__';
import { renderBattle, showBattle, renderSlots, slotHTML } from './render.js?v=__VERSION__';
import { stopRoomList, lanPickPost, lanPost, lanBase, renderLanPick, startRoomList, renderServerList, scanLan } from './lan.js?v=__VERSION__';

export function startVsCPU() { state.MODE = 'cpu'; state.MULTI = false; openPick(); }
export function startLocal() { state.MODE = 'local'; state.MULTI = false; openPick(); }
export function startLocalMulti() { state.MODE = 'local'; state.MULTI = true; openPick(); }

/* ============ 自定义游戏 ============ */
let customMode = 'cpu';

function initCustomState() {
  const n = customMode === 'multi' ? (parseInt($('custom-player-count')?.value) || 2) : 2;
  state.PICK = new Array(n).fill(null);
  state.PICK_HUMAN = new Array(n).fill(true);
  state.PICK_TEAMS = new Array(n).fill(0).map((_, i) => i < n / 2 ? 0 : 1);
  if (customMode === 'cpu') state.PICK_HUMAN[0] = false;
}

function renderCustomScreen() {
  const modes = [
    { v: 'cpu', key: 'custom.mode_cpu' },
    { v: 'local', key: 'custom.mode_local' },
    { v: 'multi', key: 'custom.mode_multi' },
    { v: 'rogue', key: 'custom.mode_rogue' },
  ];
  $('custom-modes').innerHTML = modes.map(m =>
    `<button class="mode-btn ${m.v === customMode ? 'on' : ''}" data-action="custom-mode" data-mode="${m.v}">${t(m.key)}</button>`
  ).join('');
  const isMulti = customMode === 'multi';
  $('custom-count-sec').style.display = isMulti ? 'block' : 'none';
  initCustomState();
  renderTeamRows($('custom-team-select'), isMulti ? state.PICK.length : 0);
  const go = $('custom-go');
  go.disabled = customMode === 'rogue';
  go.textContent = customMode === 'rogue' ? t('custom.rogue_soon') : t('custom.next');
}

export function refreshCustomScreen() {
  if ($('sc-custom') && $('sc-custom').classList.contains('on')) renderCustomScreen();
}

export function startCustom() {
  customMode = 'cpu';
  renderCustomScreen();
  show('sc-custom');
}

export function setCustomMode(mode) {
  customMode = mode;
  renderCustomScreen();
}

export function customPlayerCount() {
  renderCustomScreen();
}

export function customNext() {
  if (customMode === 'rogue') { toast(t('custom.rogue_soon')); return; }
  if (customMode === 'cpu') { state.MODE = 'cpu'; state.MULTI = false; }
  else if (customMode === 'local') { state.MODE = 'local'; state.MULTI = false; }
  else { state.MODE = 'local'; state.MULTI = true; }
  openPick(state.PICK ? state.PICK.length : undefined);
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

export function openPick(count) {
  const n = state.MODE === 'lan' ? (state.LAN?.capacity || 4) : (state.MULTI ? (count || 4) : 2);
  state.PICK = new Array(n).fill(null);
  if (!state.PICK_HUMAN || state.PICK_HUMAN.length !== n) {
    state.PICK_HUMAN = new Array(n).fill(true);
    if (state.MODE === 'cpu') state.PICK_HUMAN[0] = false;
  }
  if (!state.PICK_TEAMS || state.PICK_TEAMS.length !== n) {
    state.PICK_TEAMS = new Array(n).fill(0).map((_, i) => i < n / 2 ? 0 : 1);
  }
  const sel = $('pk-player-count');
  if (sel) sel.value = String(n);
  const title = state.MODE === 'cpu' ? t('pick.title_cpu') : state.MODE === 'local' ? t('pick.title_local') : t('pick.title_lan');
  $('pk-title').textContent = title;
  $('lan-hint').innerHTML = '';
  renderSlots();
  renderTeamSelect();
  show('sc-pick');
}

export function pickRole(i) {
  if (state.MODE === 'lan' && i !== state.LAN.side) return;
  if (state.PICK_HUMAN && !state.PICK_HUMAN[i]) return;
  let all = state.MODE === 'lan' ? DB.subfactions : [...(state.LAN?.hostData?.subfactions || []), ...DB.subfactions];
  if (state.MODE === 'lan' && !state.LAN.mods) {
    const vanillaIds = getDefaultSubfactionIds();
    all = all.filter(r => vanillaIds.has(r.id));
  }
  state.PICK_OPTIONS[i] = all;
  const groups = getPickGroups(all);
  const m = $('mbox');
  const sideLabel = state.MODE === 'cpu' ? (i === 0 ? t('pick.cpu_opponent') : t('pick.you')) : t('pick.side', { n: i + 1 });
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
  if (state.MODE === 'lan' && i !== state.LAN.side) return;
  if (state.PICK_HUMAN && !state.PICK_HUMAN[i]) return;
  const r = JSON.parse(JSON.stringify((state.PICK_OPTIONS[i] || DB.subfactions)[j]));
  state.PICK[i] = r;
  if (state.MODE === 'lan') lanPickPost(i, r);
  closeModal();
  renderSlots();
  if (state.MODE === 'lan') renderLanPick();
}

export function setPickRandom(i) {
  if (state.MODE === 'lan' && i !== state.LAN.side) return;
  if (state.PICK_HUMAN && !state.PICK_HUMAN[i]) return;
  const opts = state.PICK_OPTIONS[i] || DB.subfactions;
  const r = new Uint32Array(1);
  crypto.getRandomValues(r);
  state.PICK[i] = JSON.parse(JSON.stringify(opts[r[0] % opts.length]));
  if (state.MODE === 'lan') lanPickPost(i, state.PICK[i]);
  closeModal();
  renderSlots();
  if (state.MODE === 'lan') renderLanPick();
}

export function updatePlayerCount() {
  const sel = $('pk-player-count');
  if (!sel) return;
  const n = parseInt(sel.value) || 2;
  state.MULTI = n > 2 || state.MULTI;
  state.PICK = new Array(n).fill(null);
  state.PICK_HUMAN = new Array(n).fill(true);
  state.PICK_TEAMS = new Array(n).fill(0).map((_, i) => i < n / 2 ? 0 : 1);
  renderSlots();
  renderTeamSelect();
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
  if (state.MODE !== 'local' || !state.MULTI) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  renderTeamRows(wrap, n);
}

function customTeamVisible() {
  return $('sc-custom') && $('sc-custom').classList.contains('on') && customMode === 'multi';
}

export function togglePickTeam(i) {
  state.PICK_TEAMS[i] = state.PICK_TEAMS[i] === 0 ? 1 : 0;
  renderTeamSelect();
  if (customTeamVisible()) renderTeamRows($('custom-team-select'), state.PICK ? state.PICK.length : 0);
  renderSlots();
}

export function togglePickHuman(i) {
  state.PICK_HUMAN[i] = !state.PICK_HUMAN[i];
  if (!state.PICK_HUMAN[i]) {
    // 切到电脑：若未选角色则随机选一个
    if (!state.PICK[i]) {
      const opts = state.PICK_OPTIONS[i] || DB.subfactions;
      const r = new Uint32Array(1);
      crypto.getRandomValues(r);
      state.PICK[i] = JSON.parse(JSON.stringify(opts[r[0] % opts.length]));
    }
  }
  renderTeamSelect();
  if (customTeamVisible()) renderTeamRows($('custom-team-select'), state.PICK ? state.PICK.length : 0);
  renderSlots();
}

export function goDice() {
  if (state.DICING) return;
  state.DICING = true;
  const [a, b] = rollPair();
  // 队伍代表
  const teams = buildDefs().teams;
  const rep0 = teams.indexOf(0);
  const rep1 = teams.indexOf(1);
  const n0 = state.PICK[rep0]?.name || '队 1';
  const n1 = state.PICK[rep1]?.name || '队 2';
  $('dice-name0').textContent = n0;
  $('dice-name1').textContent = n1;
  $('die-0').textContent = '·'; $('die-1').textContent = '·';
  $('die-0').className = 'die rolling'; $('die-1').className = 'die rolling';
  $('dice-msg').textContent = t('pick.roll_ing');
  show('sc-dice');
  setTimeout(() => {
    $('die-0').className = 'die'; $('die-1').className = 'die';
    $('die-0').textContent = a; $('die-1').textContent = b;
    const first = a > b ? 0 : 1;
    const name = first === 0 ? n0 : n1;
    $('dice-msg').textContent = t('pick.roll_result', { a, b, name });
    setTimeout(() => startBattleFromDice(first, a, b), 1000);
  }, 800);
}

function startBattleFromDice(first, a, b) {
  state.PHASE_BATTLE = true;
  const defs = buildDefs();
  const rep0 = defs.teams.indexOf(0);
  const rep1 = defs.teams.indexOf(1);
  const repName = first === 0 ? (state.PICK[rep0]?.name || '队 1') : (state.PICK[rep1]?.name || '队 2');
  if (state.MODE === 'lan') {
    if (state.LAN.side !== 0) return;
    state.BATTLE = newBattle('lan', defs);
    state.BATTLE.actor = state.BATTLE.order[first];
    state.BATTLE.phase = 'awaiting';
    logT(state.BATTLE, 'pick.roll_log', { a, b, name: repName });
    lanPost();
    showBattle();
    if (first === 0) { state.BATTLE.phase = 'playing'; startTurn(state.BATTLE); lanPost(); }
  } else {
    const order = buildOrder(defs.teams);
    state.BATTLE = newBattle(state.MODE, defs, order[first]);
    state.BATTLE.actor = order[first];
    state.BATTLE.phase = 'playing';
    logT(state.BATTLE, 'pick.roll_log', { a, b, name: repName });
    showBattle();
  }
}

function buildDefs() {
  if (state.MODE === 'lan') {
    const picks = state.LAN.picks;
    // 只包含已选席位，按席位顺序压缩
    const seats = [];
    for (let i = 0; i < picks.length; i++) {
      if (picks[i]) seats.push(i);
    }
    const subfactions = seats.map(i => picks[i].role);
    const need = new Set();
    subfactions.forEach(r => (r.deck || []).forEach(id => need.add(id)));
    const seen = {}, m = [];
    for (const i of seats) {
      for (const c of (picks[i].cards || [])) {
        if (!seen[c.id]) { seen[c.id] = 1; if (need.size === 0 || need.has(c.id)) m.push(c); }
      }
    }
    const allEffects = [...new Set(seats.flatMap(i => picks[i].effects || []))];
    const teams = seats.map(i => state.LAN.teams[i] ?? 0);
    const humans = seats.map(i => picks[i].is_human !== false);
    return { subfactions, cards: m, effects: allEffects, teams, humans, seatMap: seats };
  }
  const subfactions = [...state.PICK];
  const teams = subfactions.length === 2 ? [0, 1] : (state.PICK_TEAMS || subfactions.map((_, i) => i < subfactions.length / 2 ? 0 : 1));
  const humans = state.PICK_HUMAN || subfactions.map((_, i) => state.MODE === 'cpu' ? i !== 0 : true);
  return { subfactions, cards: DB.cards, teams, humans };
}
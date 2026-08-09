import { $, show, esc, rollPair } from './util.js';
import { state } from './state.js';
import { DB, getDefaultRoleIds, getFaction } from './data.js';
import { t } from './i18n.js';
import { newBattle, logT } from './core.js';
import { renderBattle, showBattle, renderSlots, slotHTML } from './render.js';
import { startTurn } from './battle.js';
import { stopRoomList, lanPickPost, lanPost, lanBase, renderLanPick, startRoomList, renderServerList, scanLan } from './lan.js';

export function startVsAI() { state.MODE = 'ai'; openPick(); }
export function startLocal() { state.MODE = 'local'; openPick(); }

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
  show('sc-menu');
}

export function quitBattle() { backMenu(); }

export function openPick() {
  state.PICK = [null, null];
  $('pk-title').textContent = state.MODE === 'ai' ? t('pick.title_ai') : state.MODE === 'local' ? t('pick.title_local') : t('pick.title_lan');
  $('lan-hint').innerHTML = '';
  renderSlots();
  show('sc-pick');
}

export function pickRole(i) {
  if (state.MODE === 'lan' && i !== state.LAN.side) return;
  let all = state.MODE === 'lan' ? DB.roles : [...(state.LAN?.hostData?.roles || []), ...DB.roles];
  // 模组关闭时只显示原版角色
  if (state.MODE === 'lan' && !state.LAN.mods) {
    const vanillaIds = getDefaultRoleIds();
    all = all.filter(r => vanillaIds.has(r.id));
  }
  state.PICK_OPTIONS[i] = all;
  const groups = getPickGroups(all);
  const m = $('mbox');
  m.innerHTML = `<div class="mhead">${t('pick.for', { side: i === 0 ? 'P0' : 'P1' })}${state.MODE === 'ai' && i === 0 ? t('pick.ai_opponent') : state.MODE === 'ai' && i === 1 ? t('pick.you') : ''}</div>
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
  $('die-0').className = 'die rolling'; $('die-1').className = 'die rolling';
  $('dice-msg').textContent = t('pick.roll_ing');
  show('sc-dice');
  setTimeout(() => {
    $('die-0').className = 'die'; $('die-1').className = 'die';
    $('die-0').textContent = a; $('die-1').textContent = b;
    const first = a > b ? 0 : 1;
    const name = first === 0 ? $('dice-name0').textContent : $('dice-name1').textContent;
    $('dice-msg').textContent = t('pick.roll_result', { a, b, name });
    setTimeout(() => startBattleFromDice(first, a, b), 1000);
  }, 800);
}

function startBattleFromDice(first, a, b) {
  state.PHASE_BATTLE = true;
  const names = [state.PICK[0]?.name || 'P0', state.PICK[1]?.name || 'P1'];
  if (state.MODE === 'lan') {
    if (state.LAN.side !== 0) return;
    state.BATTLE = newBattle('lan', buildDefs());
    state.BATTLE.actor = first;
    state.BATTLE.phase = 'awaiting';
    logT(state.BATTLE, 'pick.roll_log', { a, b, name: names[first] });
    lanPost();
    showBattle();
    if (first === 0) { state.BATTLE.phase = 'playing'; startTurn(state.BATTLE); lanPost(); }
  } else {
    state.BATTLE = newBattle(state.MODE, buildDefs());
    state.BATTLE.actor = first;
    state.BATTLE.phase = 'playing';
    logT(state.BATTLE, 'pick.roll_log', { a, b, name: names[first] });
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
    for (const c of [...(p0.cards || []), ...(p1.cards || [])]) {
      if (!seen[c.id]) { seen[c.id] = 1; if (need.size === 0 || need.has(c.id)) m.push(c); }
    }
    // 收集双方效果定义（效果类型字符串，由房主注册）
    const allEffects = [...new Set([...(p0.effects || []), ...(p1.effects || [])])];
    return { roles, cards: m, effects: allEffects };
  }
  return { roles: [state.PICK[0], state.PICK[1]], cards: DB.cards };
}
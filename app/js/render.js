import { $, esc, show } from './util.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { genDesc, buffName, effFx } from './data.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { cardCost, canOperate, lanMyIndex } from './core.js?v=__VERSION__';
import { updateBGM } from './sound.js?v=__VERSION__';

export function flyCardHTML(c) {
  return `<div class="cost">${c.cost}</div><div class="cname">${esc(c.name)}</div>
    <div class="cimg">${c.img ? `<img src="${c.img}">` : esc((c.name || '?')[0])}</div>
    <div class="cdesc">${esc(c.desc || genDesc(c.effects))}</div>`;
}

export function playFx(pi, fx) {
  const el = $('pzone-' + pi)?.querySelector('.avatar');
  if (!el) return;
  el.style.setProperty('--fx-color', fx.color || '#ff3b30');
  el.classList.remove('fx', 'fx-flash', 'fx-overlay', 'fx-pulse', 'hit');
  void el.offsetWidth;
  el.classList.add('fx', 'fx-' + fx.form);
  if (fx.form === 'flash') el.classList.add('hit');
  setTimeout(() => el.classList.remove('fx', 'fx-flash', 'fx-overlay', 'fx-pulse', 'hit'), 1200);
}

export function playCardAnim(pi, card, events, done) {
  const layer = $('fx-layer');
  $('fly-card').innerHTML = flyCardHTML(card);
  layer.style.display = 'flex';
  requestAnimationFrame(() => { $('fly-card').style.transform = 'scale(1)'; });
  events.forEach((ev, i) => {
    setTimeout(() => playFx(ev.target, ev.fx), 300 + i * 260);
  });
  const total = 300 + events.length * 260 + 1150;
  setTimeout(() => {
    $('fly-card').style.transform = 'scale(0)';
    setTimeout(() => { layer.style.display = 'none'; done && done(); }, 280);
  }, total - 280);
}

export function renderP(pi, el) {
  const b = state.BATTLE, P = b.players[pi];
  const acting = pi === b.actor && !b.winner;
  el.className = 'pzone' + (acting ? ' acting' : '');
  el.id = 'pzone-' + pi;
  const canAct = acting && canOperate(pi);
  const reveal = Array.isArray(P.hand) && (pi === b.actor || (b.mode === 'lan' && canOperate(pi))) && !(b.mode === 'cpu' && !b.humans[pi]);
  const handN = Array.isArray(P.hand) ? P.hand.length : (P.handCount || 0);
  const drawN = Array.isArray(P.draw) ? P.draw.length : (P.drawCount || 0);
  let handHTML;
  if (reveal) {
    handHTML = P.hand.map((c, i) => `<div class="card ${canAct && !state.animBusy && cardCost(b, pi, c) <= P.energy ? '' : 'locked'}" ${canAct && !state.animBusy && cardCost(b, pi, c) <= P.energy ? `data-action="play-card" data-pi="${pi}" data-index="${i}"` : ''}>
      <div class="cost">${cardCost(b, pi, c)}</div><div class="cname">${esc(c.name)}</div>
      <div class="cimg">${c.img ? `<img src="${c.img}">` : esc((c.name || '?')[0])}</div>
      <div class="cdesc">${esc(c.desc || genDesc(c.effects))}</div></div>`).join('');
  } else if (handN > 0) {
    handHTML = `<div class="card back">${t('battle.opponent_hand', { n: handN })}</div>`;
  } else {
    handHTML = `<div class="card back" style="opacity:.35">${t('battle.no_hand')}</div>`;
  }
  const cpuLabel = b.mode === 'cpu' && !b.humans[pi] ? `<span class="dim" style="font-size:10px">（${t('battle.mode_cpu')}）</span>` : '';
  el.innerHTML = `
    <div class="panel">
      <div class="avatar">${P.role.img ? `<img src="${P.role.img}">` : esc((P.role.name || '?')[0])}</div>
      <div style="flex:1">
        <div style="display:flex;gap:8px;align-items:baseline"><b>${esc(P.role.name)}</b>${cpuLabel}<span class="dim" style="font-size:11px">${esc(P.role.intro || '')}</span></div>
        <div class="bar"><i style="width:${Math.max(0, P.hp) / P.role.hp * 100}%"></i></div>
        <div class="stat">
          <span>${t('battle.hp')} <b>${P.hp}/${P.role.hp}</b></span>
          <span>${t('battle.def')} <b>${P.def}</b></span>
          <span>${t('battle.energy')} <b>${P.energy}/${P.role.eng}</b></span>
          <span>${t('battle.hand')} <b>${handN}/${state.HAND_MAX}</b></span>
          <span>${t('battle.draw')} <b>${drawN}</b></span>
          <span>${t('battle.discard')} <b>${P.discard.length}</b></span>
        </div>
        <div class="buffs">${P.buffs.map(x => `<span class="buff">${buffName(x)}${x.duration != null ? ' ×' + x.duration : ''}</span>`).join('') || ''}</div>
      </div>
    </div>
    <div class="hand">${handHTML}</div>
    ${canAct && !state.animBusy ? `<div style="margin-top:8px;text-align:right"><button class="primary" data-action="end-turn" data-pi="${pi}">${t('battle.end_turn')}</button></div>` : ''}`;
}

function formatLog(entry) {
  if (typeof entry === 'string') return esc(entry);
  return esc(t(entry.key, entry.params));
}

export function renderBattle() {
  const b = state.BATTLE;
  if (!b) return;

  if (b.players.length === 2) {
    // Legacy 2-player layout
    $('battle-teams').style.display = 'none';
    $('battle-grid').style.display = 'grid';
    renderP(0, $('pzone-up'));
    renderP(1, $('pzone-dn'));
    $('bt-title').textContent = t('battle.title', { mode: modeLabel(b) });
    renderTurnInfo(b, $('battle-log'));
    updateBGM();
    return;
  }

  // Multi-player team layout
  $('battle-grid').style.display = 'none';
  $('battle-teams').style.display = 'flex';

  // Determine myTeam: for LAN, local side's team; for local, team 0
  let myTeam = 0;
  if (b.mode === 'lan' && state.LAN) {
    myTeam = b.teams[lanMyIndex(b)];
  } else {
    for (let i = 0; i < b.players.length; i++) {
      if (b.humans && b.humans[i]) { myTeam = b.teams[i]; break; }
    }
  }
  const enemyTeam = myTeam === 0 ? 1 : 0;

  // Render top = enemy team, bottom = my team
  const topEl = $('team-top');
  const botEl = $('team-bot');
  topEl.innerHTML = '';
  botEl.innerHTML = '';
  const topPlayers = [];
  const botPlayers = [];
  for (let i = 0; i < b.players.length; i++) {
    if (b.teams[i] === enemyTeam) topPlayers.push(i);
    else botPlayers.push(i);
  }

  // Top team (enemy) — compact, no hands
  for (const pi of topPlayers) {
    const P = b.players[pi];
    const acting = pi === b.actor && !b.winner;
    const div = document.createElement('div');
    div.className = 'pzone compact' + (acting ? ' acting' : '');
    div.id = 'pzone-' + pi;
    div.innerHTML = `<div class="panel compact">
      <div class="avatar">${P.role.img ? `<img src="${P.role.img}">` : esc((P.role.name || '?')[0])}</div>
      <div class="cp-info">
        <b>${esc(P.role.name)}</b>
        <div class="bar"><i style="width:${Math.max(0, P.hp) / P.role.hp * 100}%"></i></div>
        <div class="stat tiny">
          <span>${t('battle.hp')} ${P.hp}/${P.role.hp}</span>
          <span>${t('battle.def')} ${P.def}</span>
          <span>${t('battle.energy')} ${P.energy}/${P.role.eng}</span>
        </div>
        <div class="buffs">${P.buffs.map(x => `<span class="buff">${buffName(x)}</span>`).join('') || ''}</div>
      </div>
    </div>`;
    topEl.appendChild(div);
  }

  // Bottom team (my team) — full panels with hands
  for (const pi of botPlayers) {
    const div = document.createElement('div');
    div.id = 'pzone-' + pi;
    renderP(pi, div);
    botEl.appendChild(div);
  }

  $('bt-title').textContent = t('battle.title', { mode: modeLabel(b) });
  renderTurnInfo(b, $('battle-log-teams'));
  updateBGM();
}

function modeLabel(b) {
  if (b.mode === 'cpu') return t('battle.mode_cpu');
  if (b.mode === 'local') return t('battle.mode_local');
  return t('battle.mode_lan');
}

function renderTurnInfo(b, logEl) {
  $('bt-turn').textContent = b.winner != null
    ? t('battle.win', { name: b.players[b.winner].role.name })
    : (b.phase === 'awaiting' && b.mode === 'lan' ? t('battle.waiting') : t('battle.turn', { n: b.turn, name: b.players[b.actor].role.name }));
  const el = logEl;
  el.innerHTML = b.log.slice(-80).map(l => `<div class="${l.includes('获胜') || l.includes('回合') || l.includes('wins') || l.includes('Turn') ? 't' : ''}">${formatLog(l)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
  if (b.winner != null && !state._bannerShown) {
    state._bannerShown = true;
    const winnerNames = b.players.filter((p, i) => b.teams[i] === b.teams[b.winner]).map(p => p.role.name).join(' / ');
    el.insertAdjacentHTML('beforeend', `<div class="win-banner">${t('battle.winner', { name: winnerNames })}</div>`);
  }
}

export function showBattle() {
  show('sc-battle');
  renderBattle();
}

export function slotHTML(r) {
  return r
    ? `<div class="av">${r.img ? `<img src="${r.img}">` : esc((r.name || '?')[0])}</div><b>${esc(r.name)}</b><div class="dim" style="font-size:12px">${t('edit.stat_hp')}${r.hp} · ${t('edit.stat_def')}${r.def} · ${t('edit.stat_eng')}${r.eng} · ${t('edit.stat_deck')}${(r.deck || []).length}${t('edit.stat_count')}</div>${r.intro ? `<div class="dim" style="font-size:11px;margin-top:4px">${esc(r.intro)}</div>` : ''}`
    : `<div class="av" style="opacity:.4">?</div><div class="dim">${t('pick.click_to_choose')}</div>`;
}

export function renderSlots() {
  let n = state.PICK ? state.PICK.length : 2;
  if (state.MODE === 'lan' && state.LAN?.capacity) n = state.LAN.capacity;
  for (let i = 0; i < 4; i++) {
    const slot = $('slot-' + i);
    if (!slot) continue;
    if (i < n) {
      slot.style.display = '';
      slot.innerHTML = slotHTML(state.PICK[i]);
    } else {
      slot.style.display = 'none';
    }
  }
  // Show player count selector for custom / multi mode
  const multiOpts = $('pk-multi-opts');
  if (state.MULTI || state.GAME_MODE === 'custom') {
    multiOpts.style.display = 'flex';
  } else {
    multiOpts.style.display = 'none';
  }
  // Show go button only when all seats filled
  const allFilled = state.PICK && state.PICK.every(p => p != null);
  $('pk-go').style.display = allFilled && state.MODE !== 'lan' ? '' : 'none';
}

export function openTargetModal(opponents, callback) {
  const box = $('target-box');
  box.innerHTML = `<div class="mhead">${t('battle.select_target')}</div>
    ${opponents.map(i => {
      const P = state.BATTLE.players[i];
      return `<div class="mrole" data-target="${i}">
        <div class="av sm">${P.role.img ? `<img src="${P.role.img}">` : esc((P.role.name || '?')[0])}</div>
        <div><b>${esc(P.role.name)}</b><div class="dim" style="font-size:11px">${t('battle.hp')}${P.hp}/${P.role.hp}</div></div>
      </div>`;
    }).join('')}`;
  box.onclick = e => {
    const el = e.target.closest('[data-target]');
    if (!el) return;
    const tgt = parseInt(el.dataset.target);
    $('target-modal').style.display = 'none';
    callback(tgt);
  };
  $('target-modal').style.display = 'block';
}

// Close target modal
document.addEventListener('click', e => {
  if (e.target.closest('[data-action="close-target-modal"]')) {
    $('target-modal').style.display = 'none';
  }
});
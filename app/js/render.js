import { $, esc, show } from './util.js';
import { state } from './state.js';
import { genDesc, buffName, effFx } from './data.js';
import { cardCost, canOperate } from './core.js';

export function flyCardHTML(c) {
  return `<div class="cost">${c.cost}</div><div class="cname">${esc(c.name)}</div>
    <div class="cimg">${c.img ? `<img src="${c.img}">` : esc((c.name || '?')[0])}</div>
    <div class="cdesc">${esc(c.desc || genDesc(c.effects))}</div>`;
}

export function playFx(pi, fx) {
  const el = $('pzone-' + (pi === 0 ? 'up' : 'dn')).querySelector('.avatar');
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
  const canAct = acting && canOperate(pi);
  const reveal = Array.isArray(P.hand) && pi === b.actor && !(b.mode === 'ai' && pi === 0);
  const handN = Array.isArray(P.hand) ? P.hand.length : (P.handCount || 0);
  const drawN = Array.isArray(P.draw) ? P.draw.length : (P.drawCount || 0);
  let handHTML;
  if (reveal) {
    handHTML = P.hand.map((c, i) => `<div class="card ${canAct && !state.animBusy && cardCost(b, pi, c) <= P.energy ? '' : 'locked'}" ${canAct && !state.animBusy && cardCost(b, pi, c) <= P.energy ? `data-action="play-card" data-pi="${pi}" data-index="${i}"` : ''}>
      <div class="cost">${cardCost(b, pi, c)}</div><div class="cname">${esc(c.name)}</div>
      <div class="cimg">${c.img ? `<img src="${c.img}">` : esc((c.name || '?')[0])}</div>
      <div class="cdesc">${esc(c.desc || genDesc(c.effects))}</div></div>`).join('');
  } else if (handN > 0) {
    handHTML = `<div class="card back">对方手牌 ×${handN}</div>`;
  } else {
    handHTML = `<div class="card back" style="opacity:.35">无手牌</div>`;
  }
  el.innerHTML = `
    <div class="panel">
      <div class="avatar">${P.role.img ? `<img src="${P.role.img}">` : esc((P.role.name || '?')[0])}</div>
      <div style="flex:1">
        <div style="display:flex;gap:8px;align-items:baseline"><b>${esc(P.role.name)}</b><span class="dim" style="font-size:11px">${b.mode === 'ai' && pi === 0 ? '（AI）' : ''}${esc(P.role.intro || '')}</span></div>
        <div class="bar"><i style="width:${Math.max(0, P.hp) / P.role.hp * 100}%"></i></div>
        <div class="stat">
          <span>生命 <b>${P.hp}/${P.role.hp}</b></span>
          <span>防御 <b>${P.def}</b></span>
          <span>能量 <b>${P.energy}/${P.role.eng}</b></span>
          <span>手牌 <b>${handN}/${state.HAND_MAX}</b></span>
          <span>牌堆 <b>${drawN}</b></span>
          <span>弃牌 <b>${P.discard.length}</b></span>
        </div>
        <div class="buffs">${P.buffs.map(x => `<span class="buff">${buffName(x)}${x.duration != null ? ' ×' + x.duration : ''}</span>`).join('') || ''}</div>
      </div>
    </div>
    <div class="hand">${handHTML}</div>
    ${canAct && !state.animBusy ? `<div style="margin-top:8px;text-align:right"><button class="primary" data-action="end-turn" data-pi="${pi}">结束回合</button></div>` : ''}`;
}

export function renderBattle() {
  const b = state.BATTLE;
  if (!b) return;
  renderP(0, $('pzone-up'));
  renderP(1, $('pzone-dn'));
  $('bt-title').textContent = `对战 · ${b.mode === 'ai' ? 'AI' : b.mode === 'local' ? '本地' : '局域网'}`;
  $('bt-turn').textContent = b.winner != null
    ? `对战结束 · ${b.players[b.winner].role.name} 获胜`
    : (b.phase === 'awaiting' && b.mode === 'lan' ? '等待对方行动…' : `回合 ${b.turn} · ${b.players[b.actor].role.name} 行动`);
  const el = $('battle-log');
  el.innerHTML = b.log.slice(-80).map(l => `<div class="${l.includes('获胜') || l.includes('回合') ? 't' : ''}">${esc(l)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
  if (b.winner != null && !state._bannerShown) {
    state._bannerShown = true;
    el.insertAdjacentHTML('beforeend', `<div class="win-banner">胜者：${esc(b.players[b.winner].role.name)}</div>`);
  }
}

export function showBattle() {
  show('sc-battle');
  renderBattle();
}

export function slotHTML(r) {
  return r
    ? `<div class="av">${r.img ? `<img src="${r.img}">` : esc((r.name || '?')[0])}</div><b>${esc(r.name)}</b><div class="dim" style="font-size:12px">HP${r.hp} · 防${r.def} · 能${r.eng} · 牌组${(r.deck || []).length}张</div>${r.intro ? `<div class="dim" style="font-size:11px;margin-top:4px">${esc(r.intro)}</div>` : ''}`
    : `<div class="av" style="opacity:.4">?</div><div class="dim">点击选择角色</div>`;
}

export function renderSlots() {
  for (let i = 0; i < 2; i++) $('slot-' + i).innerHTML = slotHTML(state.PICK[i]);
  $('pk-go').style.display = (state.PICK[0] && state.PICK[1]) ? '' : 'none';
}
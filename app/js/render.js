import { $, esc, show } from './util.js';
import { state } from './state.js';
import { genDesc, buffName, effFx } from './data.js';
import { t } from './i18n.js';
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
    handHTML = `<div class="card back">${t('battle.opponent_hand', { n: handN })}</div>`;
  } else {
    handHTML = `<div class="card back" style="opacity:.35">${t('battle.no_hand')}</div>`;
  }
  el.innerHTML = `
    <div class="panel">
      <div class="avatar">${P.role.img ? `<img src="${P.role.img}">` : esc((P.role.name || '?')[0])}</div>
      <div style="flex:1">
        <div style="display:flex;gap:8px;align-items:baseline"><b>${esc(P.role.name)}</b><span class="dim" style="font-size:11px">${b.mode === 'ai' && pi === 0 ? '（AI）' : ''}${esc(P.role.intro || '')}</span></div>
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
  renderP(0, $('pzone-up'));
  renderP(1, $('pzone-dn'));
  const modeLabel = b.mode === 'ai' ? t('battle.mode_ai') : b.mode === 'local' ? t('battle.mode_local') : t('battle.mode_lan');
  $('bt-title').textContent = t('battle.title', { mode: modeLabel });
  $('bt-turn').textContent = b.winner != null
    ? t('battle.win', { name: b.players[b.winner].role.name })
    : (b.phase === 'awaiting' && b.mode === 'lan' ? t('battle.waiting') : t('battle.turn', { n: b.turn, name: b.players[b.actor].role.name }));
  const el = $('battle-log');
  el.innerHTML = b.log.slice(-80).map(l => `<div class="${l.includes('获胜') || l.includes('回合') || l.includes('wins') || l.includes('Turn') ? 't' : ''}">${formatLog(l)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
  if (b.winner != null && !state._bannerShown) {
    state._bannerShown = true;
    el.insertAdjacentHTML('beforeend', `<div class="win-banner">${t('battle.winner', { name: b.players[b.winner].role.name })}</div>`);
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
  for (let i = 0; i < 2; i++) $('slot-' + i).innerHTML = slotHTML(state.PICK[i]);
  $('pk-go').style.display = (state.PICK[0] && state.PICK[1]) ? '' : 'none';
}
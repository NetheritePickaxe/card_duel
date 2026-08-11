import { state } from './state.js?v=__VERSION__';
import { $, show } from './util.js?v=__VERSION__';
import { rollPair } from './util.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { log, logT, cardCost, drawCards, resolveEffects, tickBuffs } from './core.js?v=__VERSION__';
import { renderBattle, showBattle, renderSlots, playCardAnim } from './render.js?v=__VERSION__';
import { lanPost } from './lan.js?v=__VERSION__';

export function startTurn(b) {
  const pi = b.actor, P = b.players[pi];
  if (P.hp <= 0) { b.winner = 1 - pi; renderBattle(); return; }
  const sk = P.buffs.findIndex(x => x.type === 'skip_turn');
  if (sk >= 0) {
    P.buffs.splice(sk, 1);
    logT(b, 'log.blocked', { name: P.role.name });
    b.actor = 1 - pi;
    b.turn++;
    if (b.mode === 'lan') { lanPost(); return; }
    startTurn(b);
    return;
  }
  tickBuffs(b, pi);
  P.energy = P.role.eng;
  drawCards(b, pi, b.turn === 1 ? 5 : 2);
  logT(b, 'log.turn', { n: b.turn, name: P.role.name });
  renderBattle();
  if (b.mode === 'ai' && b.actor === 0 && !b.winner) aiThink();
}

export function playCard(b, pi, idx) {
  const P = b.players[pi];
  const card = P.hand[idx];
  const cost = cardCost(b, pi, card);
  if (P.energy < cost || b.winner || state.animBusy) return;
  state.animBusy = true;
  P.energy -= cost;
  P.hand.splice(idx, 1);
  const events = resolveEffects(b, pi, card);
  b.lastPlay = { pi, card, events, atSeq: b.seq + 1 };
  P.discard.push(card);
  if (!b.winner) logT(b, 'log.play_card', { name: P.role.name, card: card.name });
  renderBattle();
  playCardAnim(pi, card, events, () => {
    state.animBusy = false;
    renderBattle();
    if (b.mode === 'lan') { lanPost(); return; }
    if (b.mode === 'ai' && pi === 0 && !b.winner) setTimeout(() => aiActOnce(b), 450);
  });
}

export function endTurn(b, pi) {
  const P = b.players[pi];
  const ex = P.buffs.findIndex(x => x.type === 'extra_turn');
  if (ex >= 0) {
    P.buffs.splice(ex, 1);
    logT(b, 'log.haste', { name: P.role.name });
    if (b.mode === 'lan') { const pre = b.seq; startTurn(b); if (b.seq === pre) lanPost(); return; }
    startTurn(b);
    return;
  }
  b.actor = 1 - pi;
  b.turn++;
  if (b.mode === 'lan') { b.phase = 'awaiting'; lanPost(); return; }
  startTurn(b);
}

export function playCardClick(pi, idx) {
  if (!canOperate(pi)) return;
  playCard(state.BATTLE, pi, idx);
}

export function endTurnClick(pi) {
  if (!canOperate(pi)) return;
  endTurn(state.BATTLE, pi);
}

function scoreCard(b, c) {
  let s = 0;
  for (const e of c.effects) {
    switch (e.type) {
      case 'damage': s += e.value * (e.pierce ? 1.4 : 1); break;
      case 'heal': s += (b.players[0].hp < b.players[0].role.hp * 0.7) ? e.value * 0.9 : -2; break;
      case 'gain_def': s += e.value * 0.8; break;
      case 'gain_atk': s += e.value * 0.6; break;
      case 'weaken_def': s += e.value * 0.5; break;
      case 'cost_up': s += e.value * 1.3; break;
      case 'dmg_reduce': s += e.value * 0.4; break;
      case 'skip_turn': s += 3.5; break;
      case 'extra_turn': s += 4; break;
      case 'draw': s += e.value * 1.6; break;
      case 'force_discard': s += e.value * 1.2; break;
      case 'energy': s += e.value * 0.5; break;
    }
  }
  return s;
}

function aiThink() {
  const b = state.BATTLE;
  if (!b || b.winner) return;
  $('bt-turn').textContent = t('battle.thinking');
  setTimeout(() => aiActOnce(b), 750);
}

function aiActOnce(b) {
  if (!b || b.winner) return;
  const P = b.players[0];
  if (P.hand.length === 0) { setTimeout(() => endTurn(b, 0), 350); return; }
  let bi = -1, bs = -1e9;
  for (let i = 0; i < P.hand.length; i++) {
    const c = P.hand[i];
    if (cardCost(b, 0, c) <= P.energy) { const s = scoreCard(b, c); if (s > bs) { bs = s; bi = i; } }
  }
  if (bi < 0) { setTimeout(() => endTurn(b, 0), 350); return; }
  playCard(b, 0, bi);
}

import { canOperate } from './core.js?v=__VERSION__';
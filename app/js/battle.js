import { state } from './state.js?v=__VERSION__';
import { $, show } from './util.js?v=__VERSION__';
import { rollPair } from './util.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { log, logT, cardCost, resolveEffects, canOperate, advanceActor, checkTeamWinner, playCard as corePlayCard, endTurn as coreEndTurn, startTurn as coreStartTurn, cpuStep as coreCpuStep } from './core.js?v=__VERSION__';
import { renderBattle, showBattle, renderSlots, playCardAnim, openTargetModal } from './render.js?v=__VERSION__';
import { lanPost } from './lan.js?v=__VERSION__';

export function startTurn(b) {
  if (b.winner) { renderBattle(); return; }
  coreStartTurn();
  renderBattle();
  if (b.mode === 'cpu' && b.humans && !b.humans[b.actor] && !b.winner) cpuThink();
}

export function playCard(b, pi, idx, target) {
  const P = b.players[pi];
  const card = P.hand[idx];
  const cost = cardCost(b, pi, card);
  if (P.energy < cost || b.winner || state.animBusy) return;
  state.animBusy = true;
  const events = corePlayCard(b, pi, idx, target);
  b.lastPlay = { pi, card, events, atSeq: b.seq + 1 };
  renderBattle();
  playCardAnim(pi, card, events, () => {
    state.animBusy = false;
    renderBattle();
    if (b.mode === 'lan') { lanPost(); return; }
    if (b.mode === 'cpu' && b.humans && !b.humans[pi] && !b.winner) setTimeout(() => cpuActOnce(b), 450);
  });
}

export function endTurn(b, pi) {
  coreEndTurn(pi);
  renderBattle();
  if (b.mode === 'lan') { b.phase = 'awaiting'; lanPost(); return; }
  if (b.mode === 'cpu' && b.humans && !b.humans[b.actor] && !b.winner) cpuThink();
}

function needsTarget(b, pi, card) {
  const opps = b.players.map((p, i) => i).filter(i => i !== pi && b.teams[i] !== b.teams[pi] && b.players[i].hp > 0);
  if (opps.length <= 1) return null;
  const hasEnemy = card.effects.some(e => e.target !== 'self');
  return hasEnemy ? opps : null;
}

export function playCardClick(pi, idx) {
  if (!canOperate(pi)) return;
  const b = state.BATTLE;
  const card = b.players[pi].hand[idx];
  const opps = needsTarget(b, pi, card);
  if (opps) {
    openTargetModal(opps, tgt => playCard(b, pi, idx, tgt));
    return;
  }
  playCard(b, pi, idx);
}

export function endTurnClick(pi) {
  if (!canOperate(pi)) return;
  endTurn(state.BATTLE, pi);
}

function cpuThink() {
  const b = state.BATTLE;
  if (!b || b.winner) return;
  $('bt-turn').textContent = t('battle.thinking');
  setTimeout(() => cpuActOnce(b), 750);
}

function cpuActOnce(b) {
  if (!b || b.winner) return;
  const pi = b.actor;
  const P = b.players[pi];
  if (P.hand.length === 0) { setTimeout(() => endTurn(b, pi), 350); return; }
  coreCpuStep();
  renderBattle();
  if (b.mode === 'cpu' && b.humans && !b.humans[b.actor] && !b.winner) setTimeout(() => cpuActOnce(b), 350);
}
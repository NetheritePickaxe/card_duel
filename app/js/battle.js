import { state } from './state.js?v=__VERSION__';
import { $ } from './util.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { cardCost, canOperate, playCard as corePlayCard, endTurn as coreEndTurn, cpuStep as coreCpuStep } from './core.js?v=__VERSION__';
import { renderBattle, showBattle, playCardAnim, openTargetModal } from './render.js?v=__VERSION__';
import { lanAct } from './lan.js?v=__VERSION__';

// ============================================================================
// 战斗控制（Layer 4 Control 的浏览器形态）
//
// 职责：
// - 接收玩家输入（出牌 / 结束回合 / CPU 思考），构造 Layer 1 Action
// - 本地模式：经 core.js → WASM（bindings）结算
// - LAN 模式：经 lanAct 提交意图，服务端权威结算，公开状态回传
// - 监听 'lan-battle-state' 事件驱动表现层（渲染 / 动画 / 屏幕切换）
//
// 禁止：直接修改游戏状态（必须经 core.js API 或服务端状态回传）。
// ============================================================================

export function playCard(b, pi, idx, target) {
  const P = b.players[pi];
  const card = P.hand[idx];
  const cost = cardCost(b, pi, card);
  if (P.energy < cost || b.winner || state.animBusy) return;

  // LAN：提交意图，服务端权威结算；状态回传后由事件驱动渲染
  if (b.mode === 'lan') {
    state.animBusy = true;
    lanAct(state.LAN.side, { type: 'play', idx, target: target != null ? target : -1 }).then(() => {
      state.animBusy = false;
      renderBattle();
    });
    return;
  }

  state.animBusy = true;
  const events = corePlayCard(b, pi, idx, target);
  b.lastPlay = { pi, card, events, atSeq: b.seq + 1 };
  renderBattle();
  playCardAnim(pi, card, events, () => {
    state.animBusy = false;
    renderBattle();
    if (b.mode === 'cpu' && b.humans && !b.humans[pi] && !b.winner) setTimeout(() => cpuActOnce(b), 450);
  });
}

export function endTurn(b, pi) {
  // LAN：提交意图，服务端结算并推进回合
  if (b.mode === 'lan') {
    lanAct(state.LAN.side, { type: 'endturn' });
    return;
  }
  coreEndTurn(pi);
  renderBattle();
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

export function startBattleFlow() {
  const b = state.BATTLE;
  if (!b || b.winner) return;
  if (b.mode === 'cpu' && b.humans && !b.humans[b.actor]) setTimeout(() => cpuActOnce(b), 450);
}

/* ============ LAN 表现事件（Layer 3 表现处理器入口） ============ */

// lan.js 完成公开状态同步后派发；这里只做只读渲染与动画，禁止改状态
window.addEventListener('lan-battle-state', (e) => {
  const pub = e.detail;
  const b = state.BATTLE;
  if (!b) return;
  if (!$('sc-battle').classList.contains('on')) showBattle(); else renderBattle();
  if (pub.play && pub.play.seq === pub.seq && pub.play.card) {
    // 表现事件：播放对方（或自己回显的）出牌动画
    playCardAnim(pub.play.pi, pub.play.card, pub.play.events, () => { });
  }
});

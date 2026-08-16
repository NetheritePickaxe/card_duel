import { state } from './state.js?v=__VERSION__';
import { shuffle } from './util.js?v=__VERSION__';
import * as engine from './engine.js?v=__VERSION__';

export const log = (b, msg) => b.log.push(msg);

export function logT(b, key, params) {
  b.log.push({ key, params });
}

function applyState(json) {
  const s = JSON.parse(json);
  const b = state.BATTLE;
  b.mode = s.mode;
  b.seq = s.seq;
  b.turn = s.turn;
  b.actor = s.actor;
  b.phase = s.phase;
  b.winner = s.winner;
  b.players = s.players;
  b.teams = s.teams;
  b.order = s.order;
  b.humans = s.humans;
  b.seatMap = s.seatMap;
  b.defs = s.defs;
  b.log = s.log;
  b._events = s._events || [];
}

export function newBattle(mode, defs, firstActor, order) {
  const n = defs.subfactions.length;
  const teams = defs.teams || Array.from({ length: n }, (_, i) => i < n / 2 ? 0 : 1);
  const defaultOrder = buildOrder(teams);
  const humans = defs.humans || (mode === 'cpu' ? Array.from({ length: n }, (_, i) => i !== 0) : Array.from({ length: n }, () => true));

  if (mode === 'lan') {
    state.BATTLE = {
      mode, seq: 0, turn: 1, actor: order ? order[0] : defaultOrder[0], phase: 'awaiting', winner: null, defs, log: [],
      players: defs.subfactions.map(r => ({
        role: r, hp: r.hp, def: r.def, energy: 0, buffs: [],
        draw: shuffle([...defs.cards, ...defs.cards]),
        hand: [], discard: [],
      })),
      teams, order: order || defaultOrder, humans, seatMap: defs.seatMap || [],
    };
    return state.BATTLE;
  }

  const seed = BigInt(Date.now()) * 1000000n + BigInt(Math.floor(Math.random() * 1000000));
  const indices = defs.subfactions.map((_, i) => i);
  const json = engine.newBattle(
    mode,
    JSON.stringify(defs),
    JSON.stringify(indices),
    JSON.stringify(teams),
    JSON.stringify(humans),
    seed,
    (order ? order[0] : (firstActor != null ? firstActor : -1)),
    order,
  );
  state.BATTLE = JSON.parse(json);
  state.BATTLE._events = state.BATTLE._events || [];
  return state.BATTLE;
}

export function playCard(b, pi, idx, target) {
  const json = engine.playCard(pi, idx, target != null ? target : -1);
  applyState(json);
  return b._events;
}

export function endTurn(b, pi) {
  const json = engine.endTurn(pi);
  applyState(json);
}

export function startTurn() {
  const json = engine.startTurn();
  applyState(json);
}

export function cpuStep() {
  const json = engine.cpuStep();
  applyState(json);
}

export function buildOrder(teams) {
  const team0 = [], team1 = [];
  for (let i = 0; i < teams.length; i++) {
    if (teams[i] === 0) team0.push(i);
    else team1.push(i);
  }
  const order = [];
  const maxLen = Math.max(team0.length, team1.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < team0.length) order.push(team0[i]);
    if (i < team1.length) order.push(team1[i]);
  }
  return order;
}

export function checkTeamWinner(b) {
  if (b.winner !== null) return true;
  const aliveTeams = new Set();
  for (let i = 0; i < b.players.length; i++) {
    if (b.players[i].hp > 0) aliveTeams.add(b.teams[i]);
  }
  if (aliveTeams.size <= 1) {
    for (let i = 0; i < b.players.length; i++) {
      if (b.players[i].hp > 0) { b.winner = i; return true; }
    }
  }
  return false;
}

export function advanceActor(b) {
  if (!b.players.length || !b.order.length) return;
  const pos = b.order.indexOf(b.actor);
  for (let i = 1; i < b.order.length; i++) {
    const next = b.order[(pos + i) % b.order.length];
    if (b.players[next].hp > 0) { b.actor = next; return; }
  }
}

export function sumBuff(P, type) {
  return P.buffs.filter(x => x.type === type).reduce((s, x) => s + x.value, 0);
}

export function cardCost(b, pi, card) {
  // LAN：手牌由服务端投影，curCost 由服务端（单一规则源）计算
  if (card && card.curCost != null) return card.curCost;
  const idx = b.players[pi].hand.indexOf(card);
  if (idx >= 0) return engine.cardCost(pi, idx);
  return Math.max(0, card.cost + sumBuff(b.players[pi], 'cost_up'));
}

export function calcDamage(att, tgt, value, pierce) {
  let v = value + sumBuff(att, 'gain_atk');
  let dmg = pierce ? v : Math.max(0, v - Math.max(0, tgt.def - sumBuff(tgt, 'weaken_def')));
  const red = sumBuff(tgt, 'dmg_reduce');
  if (red > 0) dmg = Math.max(0, Math.round(dmg * (100 - red) / 100));
  return dmg;
}

export function drawCards(b, pi, n, overflow) {
  // no-op: engine handles drawing
}

export function forceDiscard(b, t, n) {
  // no-op for local: engine handles force_discard
  // For LAN, the server sends fd events
}

export function resolveEffects(b, pi, card, target) {
  return b._events || [];
}

export function tickBuffs(b, pi) {
  // no-op: engine handles buffs
}

export function canOperate(pi) {
  if (state.BATTLE.mode === 'lan') {
    const myIdx = state.BATTLE.seatMap && state.BATTLE.seatMap.length ? state.BATTLE.seatMap.indexOf(state.LAN.side) : state.LAN.side;
    return pi === (myIdx === -1 ? state.LAN.side : myIdx);
  }
  if (state.BATTLE.humans && !state.BATTLE.humans[pi]) return false;
  return true;
}

export function lanMyIndex(b) {
  if (b.seatMap && b.seatMap.length) {
    const idx = b.seatMap.indexOf(state.LAN.side);
    return idx === -1 ? state.LAN.side : idx;
  }
  return state.LAN.side;
}
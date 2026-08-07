import { state } from './state.js';
import { shuffle } from './util.js';
import { effFx } from './data.js';

export const log = (b, msg) => b.log.push(msg);

export function logT(b, key, params) {
  b.log.push({ key, params });
}

export function newBattle(mode, defs) {
  const b = {
    mode, seq: 0, turn: 1, actor: 0, phase: 'awaiting', winner: null, defs, log: [],
    players: [0, 1].map(i => {
      const r = defs.roles[i];
      const d = [];
      const deck = Array.isArray(r.deck) && r.deck.length ? r.deck : null;
      if (deck) {
        for (const cid of deck) {
          const c = defs.cards.find(x => x.id === cid);
          if (c) d.push(c);
        }
      } else {
        for (const c of defs.cards) d.push(c, c);
      }
      return { role: r, hp: r.hp, def: r.def, energy: 0, buffs: [], draw: shuffle(d), hand: [], discard: [] };
    }),
  };
  return b;
}

export function sumBuff(P, type) {
  return P.buffs.filter(x => x.type === type).reduce((s, x) => s + x.value, 0);
}

export function cardCost(b, pi, card) {
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
  const P = b.players[pi];
  for (let i = 0; i < n; i++) {
    if (P.hand.length >= state.HAND_MAX && !overflow) break;
    if (P.draw.length === 0) {
      if (P.discard.length === 0) break;
      P.draw = shuffle(P.discard.splice(0));
    }
    const c = P.draw.pop();
    if (P.hand.length >= state.HAND_MAX) { P.discard.push(c); continue; }
    P.hand.push(c);
  }
}

export function forceDiscard(b, t, n) {
  const P = b.players[t];
  for (let i = 0; i < n && P.hand.length > 0; i++) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    const idx = a[0] % P.hand.length;
    P.discard.push(P.hand.splice(idx, 1)[0]);
  }
}

export function applyEffect(b, a, t, e) {
  const P = b.players;
  const an = P[a].role.name, tn = P[t].role.name;
  switch (e.type) {
    case 'damage': {
      const dmg = calcDamage(P[a], P[t], e.value, !!e.pierce);
      P[t].hp -= dmg;
      logT(b, e.pierce ? 'log.damage_pierce' : 'log.damage', { attacker: an, target: tn, dmg });
      if (P[t].hp <= 0) { P[t].hp = 0; b.winner = a; logT(b, 'log.win', { winner: an, loser: tn }); }
      break;
    }
    case 'heal': P[t].hp = Math.min(P[t].role.hp, P[t].hp + e.value); logT(b, 'log.heal', { target: tn, value: e.value }); break;
    case 'gain_def': P[t].def += e.value; P[t].buffs.push({ type: 'gain_def', value: e.value, duration: e.duration ?? 999 }); logT(b, 'log.def_up', { target: tn, value: e.value }); break;
    case 'gain_atk': P[t].buffs.push({ type: 'gain_atk', value: e.value, duration: e.duration ?? 999 }); logT(b, 'log.atk_up', { target: tn, value: e.value }); break;
    case 'weaken_def': P[t].buffs.push({ type: 'weaken_def', value: e.value, duration: e.duration ?? 3 }); logT(b, 'log.def_down', { target: tn, value: e.value, dur: e.duration ?? 3 }); break;
    case 'cost_up': P[t].buffs.push({ type: 'cost_up', value: e.value, duration: e.duration ?? 2 }); logT(b, 'log.cost_up', { target: tn, value: e.value, dur: e.duration ?? 2 }); break;
    case 'dmg_reduce': P[t].buffs.push({ type: 'dmg_reduce', value: e.value, duration: e.duration ?? 3 }); logT(b, 'log.dmg_reduce', { target: tn, value: e.value, dur: e.duration ?? 3 }); break;
    case 'skip_turn': P[t].buffs.push({ type: 'skip_turn' }); logT(b, 'log.skip_turn', { target: tn }); break;
    case 'extra_turn': P[a].buffs.push({ type: 'extra_turn' }); logT(b, 'log.extra_turn', { target: an }); break;
    case 'draw': drawCards(b, a, e.value, true); logT(b, 'log.draw', { target: an, value: e.value }); break;
    case 'force_discard':
      if (Array.isArray(P[t].hand)) forceDiscard(b, t, e.value);
      else b.pendingFD = { side: t, count: e.value, atSeq: b.seq + 1 };
      logT(b, 'log.force_discard', { target: tn, value: e.value }); break;
    case 'energy': P[a].energy = Math.max(0, P[a].energy + e.value); logT(b, 'log.energy', { target: an, sign: e.value >= 0 ? '+' : '', value: e.value }); break;
  }
}

export function resolveEffects(b, pi, card) {
  const foe = 1 - pi, events = [];
  for (const e of card.effects) {
    if (b.winner) break;
    const tgt = (e.target === 'self') ? pi : foe;
    applyEffect(b, pi, tgt, e);
    events.push({ target: tgt, fx: effFx(e) });
  }
  return events;
}

export function tickBuffs(b, pi) {
  const P = b.players[pi];
  for (let i = P.buffs.length - 1; i >= 0; i--) {
    const x = P.buffs[i];
    if (x.type === 'skip_turn' || x.type === 'extra_turn') continue;
    x.duration--;
    if (x.duration <= 0) {
      if (x.type === 'gain_def') P.def = Math.max(0, P.def - x.value);
      P.buffs.splice(i, 1);
    }
  }
}

export function canOperate(pi) {
  if (state.BATTLE.mode === 'lan') return pi === state.LAN.side;
  if (state.BATTLE.mode === 'ai') return pi === 1;
  return true;
}
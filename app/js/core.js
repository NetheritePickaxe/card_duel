import { state } from './state.js?v=__VERSION__';
import { shuffle } from './util.js?v=__VERSION__';
import { applyEffect, effFx } from './effect_registry.js?v=__VERSION__';

export const log = (b, msg) => b.log.push(msg);

export function logT(b, key, params) {
  b.log.push({ key, params });
}

export function newBattle(mode, defs) {
  const b = {
    mode, seq: 0, turn: 1, actor: 0, phase: 'awaiting', winner: null, defs, log: [],
    players: [0, 1].map(i => {
      const r = defs.subfactions[i];
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

export { applyEffect };

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
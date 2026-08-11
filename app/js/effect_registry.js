import { t } from './i18n.js?v=__VERSION__';
import { calcDamage, drawCards, forceDiscard, logT } from './core.js?v=__VERSION__';

const EFFECTS = {};

export function registerEffect(type, config) {
  EFFECTS[type] = config;
}

export function getEffect(type) {
  return EFFECTS[type];
}

export function getEffectTypes() {
  return Object.keys(EFFECTS);
}

/* ============ 特效/描述/名称工具 ============ */

const FX_MAP = {
  damage: { form: 'flash', color: '#ff3b30' },
  heal: { form: 'flash', color: '#34c759' },
  energy: { form: 'flash', color: '#0a84ff' },
  draw: { form: 'flash', color: '#0a84ff' },
  gain_def: { form: 'overlay', color: '#e6b800' },
  gain_atk: { form: 'pulse', color: '#e6b800' },
  dmg_reduce: { form: 'overlay', color: '#e6b800' },
  extra_turn: { form: 'pulse', color: '#e6b800' },
  weaken_def: { form: 'overlay', color: '#bf5af2' },
  cost_up: { form: 'overlay', color: '#bf5af2' },
  force_discard: { form: 'overlay', color: '#bf5af2' },
  skip_turn: { form: 'pulse', color: '#bf5af2' },
};

export const defaultFx = type => FX_MAP[type] || { form: 'flash', color: '#ffffff' };

export const effFx = e => (e.fx && e.fx.form) ? { form: e.fx.form, color: e.fx.color || defaultFx(e.type).color } : defaultFx(e.type);

export function genDesc(effs) {
  return effs.map(e => {
    const eff = EFFECTS[e.type];
    if (eff && eff.description) return eff.description(e);
    return '';
  }).filter(Boolean).join(t('desc.separator'));
}

export function buffName(x) {
  const eff = EFFECTS[x.type];
  if (eff && eff.buffName) return eff.buffName(x);
  return x.type;
}

export function applyEffect(b, a, t, e) {
  const eff = EFFECTS[e.type];
  if (eff && eff.apply) eff.apply(b, a, t, e);
}

/* ============ 原版效果注册 ============ */

registerEffect('damage', {
  hasValue: true, hasDuration: false, hasPierce: true,
  fx: { form: 'flash', color: '#ff3b30' },
  description: e => t(e.pierce ? 'desc.damage_pierce' : 'desc.damage', { value: e.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    const dmg = calcDamage(P[a], P[tp], e.value, !!e.pierce);
    P[tp].hp -= dmg;
    logT(b, e.pierce ? 'log.damage_pierce' : 'log.damage', { attacker: P[a].role.name, target: P[tp].role.name, dmg });
    if (P[tp].hp <= 0) { P[tp].hp = 0; b.winner = a; logT(b, 'log.win', { winner: P[a].role.name, loser: P[tp].role.name }); }
  },
});

registerEffect('heal', {
  hasValue: true, hasDuration: false,
  fx: { form: 'flash', color: '#34c759' },
  description: e => t('desc.heal', { value: e.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    P[tp].hp = Math.min(P[tp].role.hp, P[tp].hp + e.value);
    logT(b, 'log.heal', { target: P[tp].role.name, value: e.value });
  },
});

registerEffect('gain_def', {
  hasValue: true, hasDuration: true,
  fx: { form: 'overlay', color: '#e6b800' },
  description: e => t('desc.gain_def', { value: e.value, dur: durStr(e) }),
  buffName: x => t('buff.def_up', { value: x.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    P[tp].def += e.value;
    P[tp].buffs.push({ type: 'gain_def', value: e.value, duration: e.duration ?? 999 });
    logT(b, 'log.def_up', { target: P[tp].role.name, value: e.value });
  },
});

registerEffect('gain_atk', {
  hasValue: true, hasDuration: true,
  fx: { form: 'pulse', color: '#e6b800' },
  description: e => t('desc.gain_atk', { value: e.value, dur: durStr(e) }),
  buffName: x => t('buff.atk_up', { value: x.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    P[tp].buffs.push({ type: 'gain_atk', value: e.value, duration: e.duration ?? 999 });
    logT(b, 'log.atk_up', { target: P[tp].role.name, value: e.value });
  },
});

registerEffect('weaken_def', {
  hasValue: true, hasDuration: true,
  fx: { form: 'overlay', color: '#bf5af2' },
  description: e => t('desc.weaken_def', { value: e.value, dur: durStr(e) }),
  buffName: x => t('buff.armor_break', { value: x.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    const dur = e.duration ?? 3;
    P[tp].buffs.push({ type: 'weaken_def', value: e.value, duration: dur });
    logT(b, 'log.def_down', { target: P[tp].role.name, value: e.value, dur });
  },
});

registerEffect('cost_up', {
  hasValue: true, hasDuration: true,
  fx: { form: 'overlay', color: '#bf5af2' },
  description: e => t('desc.cost_up', { value: e.value, dur: durStr(e) }),
  buffName: x => t('buff.cost_up', { value: x.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    const dur = e.duration ?? 2;
    P[tp].buffs.push({ type: 'cost_up', value: e.value, duration: dur });
    logT(b, 'log.cost_up', { target: P[tp].role.name, value: e.value, dur });
  },
});

registerEffect('dmg_reduce', {
  hasValue: true, hasDuration: true,
  fx: { form: 'overlay', color: '#e6b800' },
  description: e => t('desc.dmg_reduce', { value: e.value, dur: durStr(e) }),
  buffName: x => t('buff.dmg_reduce', { value: x.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    const dur = e.duration ?? 3;
    P[tp].buffs.push({ type: 'dmg_reduce', value: e.value, duration: dur });
    logT(b, 'log.dmg_reduce', { target: P[tp].role.name, value: e.value, dur });
  },
});

registerEffect('skip_turn', {
  hasValue: false, hasDuration: false,
  fx: { form: 'pulse', color: '#bf5af2' },
  description: () => t('desc.skip_turn'),
  buffName: () => t('buff.skip_turn'),
  apply(b, a, tp, e) {
    const P = b.players;
    P[tp].buffs.push({ type: 'skip_turn' });
    logT(b, 'log.skip_turn', { target: P[tp].role.name });
  },
});

registerEffect('extra_turn', {
  hasValue: false, hasDuration: false,
  fx: { form: 'pulse', color: '#e6b800' },
  description: () => t('desc.extra_turn'),
  buffName: () => t('buff.extra_turn'),
  apply(b, a, tp, e) {
    const P = b.players;
    P[a].buffs.push({ type: 'extra_turn' });
    logT(b, 'log.extra_turn', { target: P[a].role.name });
  },
});

registerEffect('draw', {
  hasValue: true, hasDuration: false,
  fx: { form: 'flash', color: '#0a84ff' },
  description: e => t('desc.draw', { value: e.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    drawCards(b, a, e.value, true);
    logT(b, 'log.draw', { target: P[a].role.name, value: e.value });
  },
});

registerEffect('force_discard', {
  hasValue: true, hasDuration: false,
  fx: { form: 'overlay', color: '#bf5af2' },
  description: e => t('desc.force_discard', { value: e.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    if (Array.isArray(P[tp].hand)) forceDiscard(b, tp, e.value);
    else b.pendingFD = { side: tp, count: e.value, atSeq: b.seq + 1 };
    logT(b, 'log.force_discard', { target: P[tp].role.name, value: e.value });
  },
});

registerEffect('energy', {
  hasValue: true, hasDuration: false,
  fx: { form: 'flash', color: '#0a84ff' },
  description: e => t('desc.energy', { sign: e.value >= 0 ? '+' : '', value: e.value }),
  apply(b, a, tp, e) {
    const P = b.players;
    P[a].energy = Math.max(0, P[a].energy + e.value);
    logT(b, 'log.energy', { target: P[a].role.name, sign: e.value >= 0 ? '+' : '', value: e.value });
  },
});

function durStr(e) {
  return (e.duration != null && e.duration < 999) ? t('desc.duration', { n: e.duration }) : '';
}
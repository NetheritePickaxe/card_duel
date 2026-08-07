import { $ } from './util.js';
import { t } from './i18n.js';

const LS = 'cardgame_db_v3';

const DEFAULT_DATA = {
  roles: [
    { id: 'r_sword', name: '', hp: 42, def: 3, eng: 3, intro: '', img: '',
      deck: ['c_strike', 'c_strike', 'c_strike', 'c_heavy', 'c_heavy', 'c_pierce', 'c_pierce', 'c_guard', 'c_guard', 'c_weak', 'c_draw'] },
    { id: 'r_mage', name: '', hp: 32, def: 2, eng: 4, intro: '', img: '',
      deck: ['c_strike', 'c_strike', 'c_heavy', 'c_heal', 'c_heal', 'c_overload', 'c_barrier', 'c_haste', 'c_charge', 'c_draw'] },
  ],
  cards: [
    { id: 'c_strike', name: '', cost: 1, img: '', effects: [{ type: 'damage', value: 6, target: 'enemy' }], desc: '' },
    { id: 'c_heavy', name: '', cost: 2, img: '', effects: [{ type: 'damage', value: 11, target: 'enemy' }], desc: '' },
    { id: 'c_pierce', name: '', cost: 2, img: '', effects: [{ type: 'damage', value: 6, pierce: true, target: 'enemy' }], desc: '' },
    { id: 'c_guard', name: '', cost: 1, img: '', effects: [{ type: 'gain_def', value: 3, duration: 999, target: 'self' }], desc: '' },
    { id: 'c_heal', name: '', cost: 1, img: '', effects: [{ type: 'heal', value: 6, target: 'self' }], desc: '' },
    { id: 'c_weak', name: '', cost: 1, img: '', effects: [{ type: 'weaken_def', value: 2, duration: 3, target: 'enemy' }], desc: '' },
    { id: 'c_charge', name: '', cost: 1, img: '', effects: [{ type: 'force_discard', value: 1, target: 'enemy' }], desc: '' },
    { id: 'c_overload', name: '', cost: 1, img: '', effects: [{ type: 'cost_up', value: 1, duration: 2, target: 'enemy' }], desc: '' },
    { id: 'c_barrier', name: '', cost: 2, img: '', effects: [{ type: 'dmg_reduce', value: 25, duration: 3, target: 'self' }], desc: '' },
    { id: 'c_timelock', name: '', cost: 2, img: '', effects: [{ type: 'skip_turn', target: 'enemy' }], desc: '' },
    { id: 'c_haste', name: '', cost: 3, img: '', effects: [{ type: 'extra_turn', target: 'self' }], desc: '' },
    { id: 'c_draw', name: '', cost: 0, img: '', effects: [{ type: 'draw', value: 2, target: 'self' }], desc: '' },
  ],
};

function loadDB() {
  try {
    const s = localStorage.getItem(LS);
    if (s) return JSON.parse(s);
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

export const DB = loadDB();

// Fill localized names on first load
export function applyDefaultNames() {
  const roleMap = { r_sword: 'role.sword', r_mage: 'role.mage' };
  const cardMap = {
    c_strike: 'card.strike', c_heavy: 'card.heavy', c_pierce: 'card.pierce',
    c_guard: 'card.guard', c_heal: 'card.heal', c_weak: 'card.weak',
    c_charge: 'card.charge', c_overload: 'card.overload', c_barrier: 'card.barrier',
    c_timelock: 'card.timelock', c_haste: 'card.haste', c_draw: 'card.draw',
  };
  const introMap = { r_sword: 'role.sword_intro', r_mage: 'role.mage_intro' };
  for (const r of DB.roles) {
    const key = roleMap[r.id];
    if (key && (!r.name || r.name === '')) r.name = t(key);
    const ik = introMap[r.id];
    if (ik && (!r.intro || r.intro === '')) r.intro = t(ik);
  }
  for (const c of DB.cards) {
    const key = cardMap[c.id];
    if (key && (!c.name || c.name === '')) c.name = t(key);
  }
}

export function saveDB() {
  try {
    localStorage.setItem(LS, JSON.stringify(DB));
  } catch (e) {
    alert(t('alert.save_fail'));
  }
}

export const EFF_TYPES = [
  { v: 'damage', nkey: 'effect.damage' }, { v: 'heal', nkey: 'effect.heal' },
  { v: 'gain_def', nkey: 'effect.gain_def' }, { v: 'gain_atk', nkey: 'effect.gain_atk' },
  { v: 'weaken_def', nkey: 'effect.weaken_def' }, { v: 'cost_up', nkey: 'effect.cost_up' },
  { v: 'dmg_reduce', nkey: 'effect.dmg_reduce' },
  { v: 'skip_turn', nkey: 'effect.skip_turn' }, { v: 'extra_turn', nkey: 'effect.extra_turn' },
  { v: 'draw', nkey: 'effect.draw' }, { v: 'force_discard', nkey: 'effect.force_discard' },
  { v: 'energy', nkey: 'effect.energy' }];

export const FX_FORMS = [{ v: '', nkey: 'fx.auto' }, { v: 'flash', nkey: 'fx.flash' }, { v: 'overlay', nkey: 'fx.overlay' }, { v: 'pulse', nkey: 'fx.pulse' }];

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
    const dur = (e.duration != null && e.duration < 999) ? t('desc.duration', { n: e.duration }) : '';
    switch (e.type) {
      case 'damage': return t(e.pierce ? 'desc.damage_pierce' : 'desc.damage', { value: e.value });
      case 'heal': return t('desc.heal', { value: e.value });
      case 'gain_def': return t('desc.gain_def', { value: e.value, dur });
      case 'gain_atk': return t('desc.gain_atk', { value: e.value, dur });
      case 'weaken_def': return t('desc.weaken_def', { value: e.value, dur });
      case 'cost_up': return t('desc.cost_up', { value: e.value, dur });
      case 'dmg_reduce': return t('desc.dmg_reduce', { value: e.value, dur });
      case 'skip_turn': return t('desc.skip_turn');
      case 'extra_turn': return t('desc.extra_turn');
      case 'draw': return t('desc.draw', { value: e.value });
      case 'force_discard': return t('desc.force_discard', { value: e.value });
      case 'energy': return t('desc.energy', { sign: e.value >= 0 ? '+' : '', value: e.value });
    }
    return '';
  }).filter(Boolean).join(t('desc.separator'));
}

export const buffName = x => ({
  gain_def: t('buff.def_up', { value: x.value }),
  gain_atk: t('buff.atk_up', { value: x.value }),
  weaken_def: t('buff.armor_break', { value: x.value }),
  cost_up: t('buff.cost_up', { value: x.value }),
  dmg_reduce: t('buff.dmg_reduce', { value: x.value }),
  skip_turn: t('buff.skip_turn'),
  extra_turn: t('buff.extra_turn'),
}[x.type] || x.type);

export function compressImage(file, cb) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const s = Math.min(1, 384 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    cb(c.toDataURL('image/jpeg', 0.82));
    URL.revokeObjectURL(url);
  };
  img.src = url;
}
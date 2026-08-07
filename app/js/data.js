import { $ } from './util.js';

const LS = 'cardgame_db_v3';

const DEFAULT_DATA = {
  roles: [
    { id: 'r_sword', name: '无名剑客', hp: 42, def: 3, eng: 3, intro: '三尺青锋，攻守兼备', img: '',
      deck: ['c_strike', 'c_strike', 'c_strike', 'c_heavy', 'c_heavy', 'c_pierce', 'c_pierce', 'c_guard', 'c_guard', 'c_weak', 'c_draw'] },
    { id: 'r_mage', name: '符文法师', hp: 32, def: 2, eng: 4, intro: '能量充裕，法术多变', img: '',
      deck: ['c_strike', 'c_strike', 'c_heavy', 'c_heal', 'c_heal', 'c_overload', 'c_barrier', 'c_haste', 'c_charge', 'c_draw'] },
  ],
  cards: [
    { id: 'c_strike', name: '打击', cost: 1, img: '', effects: [{ type: 'damage', value: 6, target: 'enemy' }], desc: '' },
    { id: 'c_heavy', name: '重击', cost: 2, img: '', effects: [{ type: 'damage', value: 11, target: 'enemy' }], desc: '' },
    { id: 'c_pierce', name: '破甲斩', cost: 2, img: '', effects: [{ type: 'damage', value: 6, pierce: true, target: 'enemy' }], desc: '' },
    { id: 'c_guard', name: '铁壁', cost: 1, img: '', effects: [{ type: 'gain_def', value: 3, duration: 999, target: 'self' }], desc: '' },
    { id: 'c_heal', name: '治愈', cost: 1, img: '', effects: [{ type: 'heal', value: 6, target: 'self' }], desc: '' },
    { id: 'c_weak', name: '虚弱', cost: 1, img: '', effects: [{ type: 'weaken_def', value: 2, duration: 3, target: 'enemy' }], desc: '' },
    { id: 'c_charge', name: '能量榨取', cost: 1, img: '', effects: [{ type: 'force_discard', value: 1, target: 'enemy' }], desc: '' },
    { id: 'c_overload', name: '过载', cost: 1, img: '', effects: [{ type: 'cost_up', value: 1, duration: 2, target: 'enemy' }], desc: '' },
    { id: 'c_barrier', name: '屏障', cost: 2, img: '', effects: [{ type: 'dmg_reduce', value: 25, duration: 3, target: 'self' }], desc: '' },
    { id: 'c_timelock', name: '禁行', cost: 2, img: '', effects: [{ type: 'skip_turn', target: 'enemy' }], desc: '' },
    { id: 'c_haste', name: '时间裂隙', cost: 3, img: '', effects: [{ type: 'extra_turn', target: 'self' }], desc: '' },
    { id: 'c_draw', name: '洞察', cost: 0, img: '', effects: [{ type: 'draw', value: 2, target: 'self' }], desc: '' },
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

export function saveDB() {
  try {
    localStorage.setItem(LS, JSON.stringify(DB));
  } catch (e) {
    alert('保存失败：本地存储可能已满');
  }
}

export const EFF_TYPES = [
  { v: 'damage', n: '伤害' }, { v: 'heal', n: '治疗' }, { v: 'gain_def', n: '增加防御' }, { v: 'gain_atk', n: '增加攻击' },
  { v: 'weaken_def', n: '削弱防御' }, { v: 'cost_up', n: '费用增加' }, { v: 'dmg_reduce', n: '百分比减伤' },
  { v: 'skip_turn', n: '跳过回合' }, { v: 'extra_turn', n: '额外回合' }, { v: 'draw', n: '抽牌' },
  { v: 'force_discard', n: '强制弃牌' }, { v: 'energy', n: '能量调整' }];

export const FX_FORMS = [{ v: '', n: '自动' }, { v: 'flash', n: '闪烁' }, { v: 'overlay', n: '覆盖' }, { v: 'pulse', n: '脉冲' }];

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
    const d = (e.duration != null && e.duration < 999) ? `（${e.duration}回合）` : '';
    switch (e.type) {
      case 'damage': return `${e.pierce ? '无视防御，造成' : '造成'}${e.value}点伤害`;
      case 'heal': return `恢复${e.value}点生命`;
      case 'gain_def': return `获得${e.value}点防御${d}`;
      case 'gain_atk': return `攻击+${e.value}${d}`;
      case 'weaken_def': return `目标防御-${e.value}${d}`;
      case 'cost_up': return `目标卡牌费用+${e.value}${d}`;
      case 'dmg_reduce': return `目标受到伤害-${e.value}%${d}`;
      case 'skip_turn': return '跳过目标下一回合';
      case 'extra_turn': return '获得一个额外回合';
      case 'draw': return `抽${e.value}张牌`;
      case 'force_discard': return `目标弃置${e.value}张手牌`;
      case 'energy': return `能量${e.value >= 0 ? '+' : ''}${e.value}`;
    }
    return '';
  }).filter(Boolean).join('；');
}

export const buffName = x => ({
  gain_def: `防御+${x.value}`, gain_atk: `攻击+${x.value}`, weaken_def: `破甲${x.value}`,
  cost_up: `卡费+${x.value}`, dmg_reduce: `减伤${x.value}%`, skip_turn: '跳过回合', extra_turn: '额外回合',
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
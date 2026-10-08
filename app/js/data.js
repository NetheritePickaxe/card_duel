import { $ } from './util.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import * as engine from './engine.js?v=__VERSION__';

const LS = 'cardgame_db_v4';

let defaultSubfactions = [];
let defaultCards = [];
let defaultFactions = [];

export function setDefaultData(subfactions, cards, factions) {
  defaultSubfactions = subfactions;
  defaultCards = cards;
  defaultFactions = factions || [];
  // 首次加载时（DB 从空默认创建），把 modloader 加载的默认数据填入 DB。
  // 各数据集独立填充：某个数据集为空不影响其余数据集生效。
  if (DB.subfactions.length === 0 && subfactions.length > 0) {
    DB.subfactions.splice(0, DB.subfactions.length, ...subfactions);
  }
  if (DB.cards.length === 0 && cards.length > 0) {
    DB.cards.splice(0, DB.cards.length, ...cards);
  }
  if (DB.factions.length === 0 && factions.length > 0) {
    DB.factions.splice(0, DB.factions.length, ...factions);
  }
}

export function getDefaultSubfactions() {
  return defaultSubfactions;
}

export function getDefaultCards() {
  return defaultCards;
}

export function getDefaultSubfactionIds() {
  return new Set(defaultSubfactions.map(r => r.id));
}

export function getDefaultCardIds() {
  return new Set(defaultCards.map(c => c.id));
}

export function getDefaultFactions() {
  return defaultFactions;
}

export function getFaction(id) {
  return DB.factions.find(f => f.id === id);
}

/** 2025-08-18 迁移：去掉 f_/r_ 前缀，更新 subfaction.faction 引用 */
function migrateLegacyIds(db) {
  const stripF = (s) => s && s.startsWith('f_') ? s.slice(2) : s;
  const stripR = (s) => s && s.startsWith('r_') ? s.slice(2) : s;
  // 重建 factions：id 去前缀
  const oldFactionIds = new Set(db.factions.map(f => f.id));
  db.factions = db.factions.map(f => f.id !== stripF(f.id) ? { ...f, id: stripF(f.id) } : f);
  // 重建 subfactions：id 去前缀，faction 字段映射到新 ID
  const newFactionIds = new Set(db.factions.map(f => f.id));
  db.subfactions = db.subfactions.map(s => {
    const newId = stripR(s.id);
    const mappedFaction = stripF(s.faction || '').startsWith('f_') ? stripF(s.faction) : (newFactionIds.has(stripF(s.faction || '')) ? stripF(s.faction || '') : s.faction);
    return s.id !== newId || s.faction !== mappedFaction ? { ...s, id: newId, faction: mappedFaction } : s;
  });
}

function loadDB() {
  let db;
  try {
    const s = localStorage.getItem(LS);
    if (s) db = JSON.parse(s);
  } catch (e) { /* ignore */ }
  if (!db) {
    db = { subfactions: defaultSubfactions, cards: defaultCards, factions: defaultFactions };
  } else {
    // 兼容旧存档：迁移 roles → subfactions
    if (db.roles) {
      db.subfactions = db.roles;
      delete db.roles;
    }
    if (!Array.isArray(db.subfactions)) db.subfactions = defaultSubfactions;
    if (!Array.isArray(db.factions)) db.factions = defaultFactions;
    // 2025-08-18 阵营结构重构：f_* → 无前缀，r_* → 无前缀
    migrateLegacyIds(db);
  }
  return db;
}

export const DB = loadDB();

export function saveDB() {
  try {
    localStorage.setItem(LS, JSON.stringify(DB));
  } catch (e) {
    alert(t('alert.save_fail'));
  }
}

// 效果类型列表从引擎元数据生成
let EFFECT_META = {};
export const EFF_TYPES = [];

export function initEffectMeta() {
  try {
    EFFECT_META = JSON.parse(engine.listEffects()) || {};
  } catch (e) {
    EFFECT_META = {};
    console.error('initEffectMeta failed', e);
  }
  updateEffTypes();
}

export function effMeta(type) {
  return EFFECT_META[type];
}

export function updateEffTypes() {
  EFF_TYPES.length = 0;
  for (const type of Object.keys(EFFECT_META)) {
    EFF_TYPES.push({ v: type, nkey: `effect.${type}` });
  }
}

export function defaultFx(type) {
  const m = EFFECT_META[type];
  return (m && m.fx) ? m.fx : { form: 'flash', color: '#ffffff' };
}

export function effFx(e) {
  return (e.fx && e.fx.form) ? { form: e.fx.form, color: e.fx.color || defaultFx(e.type).color } : defaultFx(e.type);
}

export function genDesc(effs) {
  return effs.map(e => {
    const m = EFFECT_META[e.type];
    if (!m) return '';
    if (e.pierce && m.descKeyPierce) return tPlus(m.descKeyPierce, e);
    return tPlus(m.descKey, e);
  }).filter(Boolean).join(t('desc.separator'));
}

function tPlus(key, e) {
  const params = { value: e.value };
  const m = EFFECT_META[e.type];
  if (m && m.hasDuration && e.duration != null) params.dur = durStr(e);
  if (e.type === 'energy') params.sign = e.value >= 0 ? '+' : '';
  if (e.type === 'damage') return t(key, { value: e.value });
  return t(key, params);
}

export function buffName(x) {
  const m = EFFECT_META[x.type];
  if (m && m.buffKey) return t(m.buffKey, { value: x.value });
  return x.type;
}

function durStr(e) {
  return (e.duration != null && e.duration < 999) ? t('desc.duration', { n: e.duration }) : '';
}

export const FX_FORMS = [{ v: '', nkey: 'fx.auto' }, { v: 'flash', nkey: 'fx.flash' }, { v: 'overlay', nkey: 'fx.overlay' }, { v: 'pulse', nkey: 'fx.pulse' }];

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

export const DECK_TOTAL = 24;

export function getSubfactionPool(sub) {
  const ids = new Set(sub.deck || []);
  if (sub.faction) {
    const f = DB.factions.find(x => x.id === sub.faction);
    if (f) (f.deck || []).forEach(id => ids.add(id));
  }
  return [...ids];
}

export function fillToDeckTotal(deck, pool) {
  const d = [...deck];
  let i = 0;
  while (d.length < DECK_TOTAL && pool.length > 0) {
    d.push(pool[i % pool.length]);
    i++;
  }
  return d.slice(0, DECK_TOTAL);
}
import { $ } from './util.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { getEffect, getEffectTypes, defaultFx, effFx, genDesc, buffName } from './effect_registry.js?v=__VERSION__';

const LS = 'cardgame_db_v4';

let defaultSubfactions = [];
let defaultCards = [];
let defaultFactions = [];

export function setDefaultData(subfactions, cards, factions) {
  defaultSubfactions = subfactions;
  defaultCards = cards;
  defaultFactions = factions || [];
  // 首次加载时（DB 从空默认创建），把 modloader 加载的默认数据填入 DB
  if (DB.subfactions.length === 0 && subfactions.length > 0) {
    DB.subfactions.splice(0, DB.subfactions.length, ...subfactions);
    DB.cards.splice(0, DB.cards.length, ...cards);
    DB.factions.splice(0, DB.factions.length, ...(factions || []));
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

// 效果类型列表从注册表生成
export const EFF_TYPES = [];

export function updateEffTypes() {
  EFF_TYPES.length = 0;
  for (const type of getEffectTypes()) {
    const eff = getEffect(type);
    EFF_TYPES.push({ v: type, nkey: `effect.${type}` });
  }
}

export { defaultFx, effFx, genDesc, buffName } from './effect_registry.js';

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
import { $ } from './util.js';
import { t } from './i18n.js';
import { getEffect, getEffectTypes, defaultFx, effFx, genDesc, buffName } from './effect_registry.js';

const LS = 'cardgame_db_v3';

let defaultRoles = [];
let defaultCards = [];

export function setDefaultData(roles, cards) {
  defaultRoles = roles;
  defaultCards = cards;
}

export function getDefaultRoles() {
  return defaultRoles;
}

export function getDefaultCards() {
  return defaultCards;
}

function loadDB() {
  try {
    const s = localStorage.getItem(LS);
    if (s) return JSON.parse(s);
  } catch (e) { /* ignore */ }
  return JSON.parse(JSON.stringify({ roles: defaultRoles, cards: defaultCards }));
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
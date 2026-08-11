import { registerTrack, deregisterTrack } from './sound.js?v=__VERSION__';
import { registerEffect, getEffect } from './effect_registry.js?v=__VERSION__';
import { addTranslation, clearTranslations } from './i18n.js?v=__VERSION__';
import { setDefaultData } from './data.js?v=__VERSION__';

const DB_NAME = 'card_duel_mods';
const STORE = 'mods';
const ORDER_KEY = 'mod_order';
const VANILLA = 'card_duel';

let MODS = [];
let configValues = {};

/* ============ IndexedDB ============ */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => { db.close(); resolve(r.result); };
    r.onerror = () => { db.close(); resolve(null); };
  });
}

async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
  });
}

async function idbKeys() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).getAllKeys();
    r.onsuccess = () => { db.close(); resolve(r.result || []); };
    r.onerror = () => { db.close(); resolve([]); };
  });
}

async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
  });
}

/* ============ 读取文件工具 ============ */
async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('404');
  return res.text();
}

function modBaseUrl(modId) {
  if (modId === VANILLA) return 'card_duel/';
  return `mods/${modId}/`;
}

/* ============ 模组加载 ============ */
async function loadVanillaMod() {
  const meta = JSON.parse(await fetchText(`${modBaseUrl(VANILLA)}mod.json`));
  // 读取所有原版文件（从磁盘）
  const files = {};
  const fileList = [
    'assets/sound/sound.json',
    'assets/lang/zh_cn.json',
    'assets/lang/en_us.json',
    'data/subfactions.json',
    'data/cards.json',
    'data/effects.json',
    'data/factions.json',
  ];
  for (const f of fileList) {
    try { files[f] = await fetchText(`${modBaseUrl(VANILLA)}${f}`); } catch (e) { files[f] = '{}'; }
  }
  return { id: VANILLA, meta, builtin: true, files, enabled: true };
}

async function loadPlayerMods() {
  try {
    const keys = await idbKeys();
    const mods = [];
    for (const id of keys) {
      const rec = await idbGet(id);
      if (!rec || !rec.meta) continue;
      const order = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]');
      const enabled = order.includes(id) ? true : (rec.enabled ?? true);
      mods.push({ id, meta: rec.meta, builtin: false, files: rec.files, enabled });
    }
    return mods;
  } catch (e) { return []; }
}

function getPriorityOrder() {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '[]'); } catch (e) { return []; }
}

export function getModOrder() {
  return getPriorityOrder();
}

export function setModOrder(order) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(order));
}

export function getMods() {
  return [...MODS];
}

export function getMod(id) {
  return MODS.find(m => m.id === id);
}

export function isModEnabled(id) {
  const m = getMod(id);
  return m ? m.enabled : false;
}

export function setModEnabled(id, enabled) {
  const m = getMod(id);
  if (m) m.enabled = enabled;
}

export async function loadMods() {
  clearTranslations();
  const vanilla = await loadVanillaMod();
  const players = await loadPlayerMods();
  const order = getPriorityOrder();
  // 排序：vanilla 固定最低优先级，玩家模组按 order 从低到高
  const playerSorted = players.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  MODS = [vanilla, ...playerSorted];
  for (const mod of MODS) {
    if (!mod.enabled) continue;
    await applyMod(mod);
  }
}

async function applyMod(mod) {
  // 翻译
  const langFiles = ['assets/lang/zh_cn.json', 'assets/lang/en_us.json'];
  for (const f of langFiles) {
    const content = mod.files[f];
    if (content) {
      try { addTranslation(f.includes('zh_cn') ? 'zh_cn' : 'en_us', JSON.parse(content)); } catch (e) { /* ignore */ }
    }
  }
  // 效果
  const effContent = mod.files['data/effects.json'];
  if (effContent) {
    try {
      const effects = JSON.parse(effContent);
      for (const [type, cfg] of Object.entries(effects)) {
        if (!getEffect(type)) registerEffect(type, cfg);
      }
    } catch (e) { /* ignore */ }
  }
  // 数据
  try {
    const subfactions = JSON.parse(mod.files['data/subfactions.json'] || mod.files['data/roles.json'] || '[]');
    const cards = JSON.parse(mod.files['data/cards.json'] || '[]');
    const factions = JSON.parse(mod.files['data/factions.json'] || '[]');
    setDefaultData(subfactions, cards, factions);
  } catch (e) { /* ignore */ }
  // 声音
  const soundContent = mod.files['assets/sound/sound.json'];
  if (soundContent) {
    try { registerSoundRegistry(JSON.parse(soundContent)); } catch (e) { /* ignore */ }
  }
  // 配置
  const cfgContent = mod.files['config.json'];
  if (cfgContent) {
    try { loadModConfig(mod.id, JSON.parse(cfgContent)); } catch (e) { /* ignore */ }
  }
}

function registerSoundRegistry(data) {
  for (const [type, tracks] of Object.entries(data)) {
    for (const [name, cfg] of Object.entries(tracks)) {
      const id = `${type}/${name}`;
      if (typeof cfg === 'string') {
        registerTrack(id, { stream: false, volume: 1.0, tracks: [{ file: cfg, weight: 1, volume: 1 }] });
      } else {
        registerTrack(id, { type, ...cfg });
      }
    }
  }
}

/* ============ 模组重载（应用模组） ============ */
export async function reloadMods() {
  await loadMods();
  window.dispatchEvent(new CustomEvent('mods-reloaded'));
}

/* ============ 模组导入（ZIP） ============ */
export async function importMod(file) {
  const zip = await JSZip.loadAsync(file);
  // 读取 mod.json
  const metaFile = zip.file('mod.json');
  if (!metaFile) throw new Error('无效模组：缺少 mod.json');
  const meta = JSON.parse(await metaFile.async('string'));
  if (!meta.id) throw new Error('无效模组：缺少 id');
  const files = {};
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    files[entry.name] = await entry.async('string');
  }
  await idbSet(meta.id, { meta, files });
  // 加入排序
  const order = getPriorityOrder();
  if (!order.includes(meta.id)) order.push(meta.id);
  setModOrder(order);
  return meta;
}

export async function deleteMod(id) {
  await idbDelete(id);
  const order = getPriorityOrder().filter(x => x !== id);
  setModOrder(order);
}

/* ============ 模组配置 ============ */
function loadModConfig(modId, schema) {
  const saved = JSON.parse(localStorage.getItem(`mod_config_${modId}`) || '{}');
  configValues[modId] = { schema, values: { ...defaults(schema), ...saved } };
}

function defaults(schema) {
  const d = {};
  for (const [k, opt] of Object.entries(schema.options)) d[k] = opt.default;
  return d;
}

export function getModConfigValue(modId, key) {
  return configValues[modId]?.values?.[key];
}

export function setModConfigValue(modId, key, value) {
  if (!configValues[modId]) return;
  configValues[modId].values[key] = value;
  localStorage.setItem(`mod_config_${modId}`, JSON.stringify(configValues[modId].values));
}

export function getModConfigSchema(modId) {
  return configValues[modId]?.schema;
}

export function renderModConfig(modId, container) {
  const cfg = configValues[modId];
  if (!cfg) { container.innerHTML = '<div class="dim">该模组无配置</div>'; return; }
  container.innerHTML = '';
  for (const [key, opt] of Object.entries(cfg.schema.options)) {
    const row = document.createElement('div');
    row.className = 'frow';
    const label = document.createElement('label');
    label.textContent = opt.label || key;
    row.appendChild(label);
    const input = makeConfigInput(opt, cfg.values[key], (v) => setModConfigValue(modId, key, v));
    row.appendChild(input);
    container.appendChild(row);
  }
}

function makeConfigInput(opt, value, onChange) {
  let el;
  switch (opt.type) {
    case 'boolean':
      el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = !!value;
      el.addEventListener('change', () => onChange(el.checked));
      break;
    case 'number':
      el = document.createElement('input');
      el.type = 'range';
      el.min = opt.min ?? 0; el.max = opt.max ?? 1; el.step = opt.step ?? 0.1;
      el.value = value; el.style.flex = '1';
      el.addEventListener('input', () => onChange(parseFloat(el.value)));
      break;
    case 'color':
      el = document.createElement('input');
      el.type = 'color';
      el.value = value || '#ffffff';
      el.addEventListener('input', () => onChange(el.value));
      break;
    case 'select': {
      el = document.createElement('select');
      for (const op of opt.options || []) {
        const o = document.createElement('option');
        o.value = op.value; o.textContent = op.label;
        if (op.value === value) o.selected = true;
        el.appendChild(o);
      }
      el.addEventListener('change', () => onChange(el.value));
      break;
    }
    default: // string
      el = document.createElement('input');
      el.type = 'text';
      el.value = value ?? '';
      el.addEventListener('input', () => onChange(el.value));
      break;
  }
  return el;
}
import { $, esc, toast, show } from './util.js?v=__VERSION__';
import { DB, getSubfactionPool, genDesc, DECK_TOTAL, fillToDeckTotal } from './data.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';

const lib = {
  selFaction: '',
  selSub: '',
  selCard: null,
  editingSubId: null,
};

export function openLibrary() {
  show('sc-library');
  lib.selFaction = '';
  lib.selSub = '';
  lib.selCard = null;
  lib.editingSubId = null;
  const ed = $('deck-editor');
  if (ed) ed.style.display = 'none';
  renderFilter();
  renderFlatCards();
  renderCardDetail(null);
}

function customDeckOf(subId) {
  try {
    const raw = localStorage.getItem('deck_' + subId);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}

function saveCustomDeck(subId, deck) {
  try { localStorage.setItem('deck_' + subId, JSON.stringify(deck)); } catch (e) { /* ignore */ }
}

/* ============ 顶栏筛�?============ */

function renderFilter() {
  const el = $('lib-filter');
  if (!el) return;
  const fid = new Set(DB.factions.map(f => f.id));
  const sub = lib.selSub ? DB.subfactions.find(x => x.id === lib.selSub) : null;
  const custom = lib.selSub ? customDeckOf(lib.selSub) : null;
  const btnLabel = custom ? t('library.edit_deck') : (sub ? t('library.create_deck') : '');
  el.innerHTML = `
    <label>${t('library.filter_faction')}</label>
    <select id="lib-faction">
      <option value="">${t('library.filter_all')}</option>
      ${DB.factions.map(f => `<option value="${esc(f.id)}" ${lib.selFaction === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
      <option value="__none__" ${lib.selFaction === '__none__' ? 'selected' : ''}>${t('edit.faction_none')}</option>
    </select>
    <label>${t('library.filter_subfaction')}</label>
    <select id="lib-subfaction">
      <option value="">${t('library.filter_all')}</option>
      ${(() => {
        let subs = [];
        if (lib.selFaction === '__none__') subs = DB.subfactions.filter(r => !r.faction || !fid.has(r.faction));
        else if (lib.selFaction) subs = DB.subfactions.filter(r => r.faction === lib.selFaction);
        else subs = DB.subfactions;
        return subs.map(s => `<option value="${esc(s.id)}" ${lib.selSub === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
      })()}
    </select>
    ${lib.selSub ? `<button class="primary lib-deck-btn" data-action="edit-custom-deck" data-rid="${lib.selSub}">${btnLabel}</button>` : ''}`;
}

function onFilterChange(e) {
  if (e.target.id === 'lib-faction') {
    lib.selFaction = e.target.value;
    lib.selSub = '';
    lib.selCard = null;
    renderFilter();
    renderFlatCards();
    renderCardDetail(null);
  } else if (e.target.id === 'lib-subfaction') {
    lib.selSub = e.target.value;
    lib.selCard = null;
    renderFilter();
    renderFlatCards();
    if (lib.selSub) renderSubDetail(lib.selSub);
    else renderCardDetail(null);
  }
}

const filterEl = $('lib-filter');
if (filterEl) filterEl.addEventListener('change', onFilterChange);

/* ============ 卡池平铺展示（按筛选过滤） ============ */

function flatFilteredCards() {
  if (lib.selSub) {
    const sub = DB.subfactions.find(x => x.id === lib.selSub);
    if (!sub) return DB.cards;
    const poolIds = getSubfactionPool(sub);
    return [...new Set(poolIds)].map(id => DB.cards.find(c => c.id === id)).filter(Boolean);
  }
  if (lib.selFaction) {
    const f = DB.factions.find(x => x.id === lib.selFaction);
    const subs = DB.subfactions.filter(r => r.faction === lib.selFaction);
    const ids = new Set();
    if (f) (f.deck || []).forEach(id => ids.add(id));
    subs.forEach(s => (s.deck || []).forEach(id => ids.add(id)));
    return [...ids].map(id => DB.cards.find(c => c.id === id)).filter(Boolean);
  }
  return DB.cards;
}

export function renderFlatCards() {
  const grid = $('lib-flat');
  if (!grid) return;
  const cards = flatFilteredCards();
  grid.innerHTML = cards.length ? cards.map(c => `
    <button class="flat-card ${lib.selCard === c.id ? 'sel' : ''}" data-action="select-card" data-card="${c.id}">
      <div class="fc-cost">${c.cost}</div>
      <div class="fc-img">${c.img ? `<img src="${c.img}">` : esc((c.name || '?')[0])}</div>
      <div class="fc-name">${esc(c.name)}</div>
    </button>`).join('') : `<div class="dim">${t('library.empty')}</div>`;
}

/* ============ 右侧：卡牌详�?/ 子阵营卡池构�?============ */

export function renderCardDetail(card) {
  const det = $('lib-detail');
  if (!det) return;
  if (!card) { det.innerHTML = `<div class="lib-placeholder">${t('library.placeholder')}</div>`; return; }
  det.innerHTML = `
    <div class="lib-card-big">
      <div class="lib-card-cost">${card.cost}</div>
      <div class="lib-card-name">${esc(card.name)}</div>
      <div class="lib-card-img">${card.img ? `<img src="${card.img}">` : esc((card.name || '?')[0])}</div>
      <div class="lib-card-desc">${esc(card.desc || genDesc(card.effects))}</div>
    </div>`;
}

function renderSubDetail(subId) {
  const det = $('lib-detail');
  if (!det) return;
  if (!subId) { det.innerHTML = `<div class="lib-placeholder">${t('library.placeholder')}</div>`; return; }
  const sub = DB.subfactions.find(x => x.id === subId);
  if (!sub) return;
  const pool = getSubfactionPool(sub);
  const poolCount = {};
  pool.forEach(id => poolCount[id] = (poolCount[id] || 0) + 1);
  const deck = customDeckOf(subId) || (sub.presetDeck || []);
  det.innerHTML = `
    <div class="lib-sub-info"><b>${esc(sub.name)}</b> · ${t('edit.stat_deck')} ${deck.length}/${DECK_TOTAL}</div>
    <div class="lib-sub-desc">${esc(sub.intro || '')}</div>
    <div class="lib-section-title">${t('edit.faction_deck')}</div>
    ${Object.entries(poolCount).map(([id, n]) => {
      const c = DB.cards.find(x => x.id === id);
      return c ? `<div class="lib-row lib-card-row"><span class="lib-dot"></span><span>${esc(c.name)}</span><span class="lib-count">x${n}</span></div>` : '';
    }).join('')}`;
}

function selectCard(id) {
  lib.selCard = id;
  const card = DB.cards.find(c => c.id === id);
  renderCardDetail(card);
  renderFlatCards();
}

/* ============ 自定义牌组编辑器 ============ */

function editCustomDeck(rid) {
  const sub = DB.subfactions.find(x => x.id === rid);
  if (!sub) return;
  lib.editingSubId = rid;
  renderDeckEditor(sub);
}

function renderDeckEditor(sub) {
  const ed = $('deck-editor');
  if (!ed) return;
  ed.style.display = 'block';
  let deck = customDeckOf(sub.id);
  if (!deck) deck = (sub.presetDeck || []).slice();
  const poolIds = getSubfactionPool(sub);
  const poolCount = {};
  poolIds.forEach(id => poolCount[id] = (poolCount[id] || 0) + 1);
  const cnt = {};
  deck.forEach(id => cnt[id] = (cnt[id] || 0) + 1);
  const poolCards = [...new Set(poolIds)].map(id => DB.cards.find(c => c.id === id)).filter(Boolean);
  const total = deck.length;
  ed.innerHTML = `
    <div class="frow"><label>${t('edit.name')}</label><span>${esc(sub.name)} ${t('edit.preset_deck')}</span></div>
    <div class="lib-deck-total">${total}/${DECK_TOTAL}</div>
    <div class="lib-deck-cards">${(DB.cards.length === poolCards.length
      ? poolCards
      : poolCards.length ? poolCards : DB.cards).map(c => {
      const n = cnt[c.id] || 0;
      const inPool = !!poolCount[c.id];
      return `<div class="lib-choose-card ${inPool ? '' : 'out'}" title="${inPool ? '' : t('library.not_in_pool')}">
        <span>${esc(c.name)}</span>
        <button data-action="deck-adj2" data-rid="${sub.id}" data-card="${c.id}" data-delta="-1">�?/button><b>${n}</b>
        <button data-action="deck-adj2" data-rid="${sub.id}" data-card="${c.id}" data-delta="1">+</button>
      </div>`;
    }).join('')}</div>
    <div class="frow"><button data-action="custom-auto-fill" data-rid="${sub.id}">${t('library.auto_fill')}</button>
      <button data-action="custom-reset" data-rid="${sub.id}">${t('library.reset_deck')}</button></div>
    <div class="frow"><button class="primary" data-action="custom-save" data-rid="${sub.id}">${t('library.save_deck')}</button>
      <button data-action="custom-clear" data-rid="${sub.id}">${t('library.clear_deck')}</button></div>`;
}

function deckAdj2(rid, cid, delta) {
  const sub = DB.subfactions.find(x => x.id === rid);
  if (!sub) return;
  const poolIds = getSubfactionPool(sub);
  const idx = poolIds.indexOf(cid);
  if (delta > 0 && idx < 0) { toast(t('library.not_in_pool')); return; }
  let deck = customDeckOf(rid);
  if (!deck) deck = (sub.presetDeck || []).slice();
  const i = deck.indexOf(cid);
  if (delta > 0) {
    if (deck.length >= DECK_TOTAL) { toast(t('library.max_reached')); return; }
    deck.push(cid);
  } else if (i >= 0) deck.splice(i, 1);
  saveCustomDeck(rid, deck);
  renderDeckEditor(sub);
  renderFilter();
  if (lib.selSub === rid) renderSubDetail(rid);
}

function customAutoFill(rid) {
  const sub = DB.subfactions.find(x => x.id === rid);
  if (!sub) return;
  let deck = customDeckOf(rid);
  if (!deck) deck = (sub.presetDeck || []).slice();
  deck = fillToDeckTotal(deck, getSubfactionPool(sub));
  saveCustomDeck(rid, deck);
  renderDeckEditor(sub);
  renderFilter();
  if (lib.selSub === rid) renderSubDetail(rid);
}

function customReset(rid) {
  const sub = DB.subfactions.find(x => x.id === rid);
  if (!sub) return;
  try { localStorage.removeItem('deck_' + rid); } catch (e) { /* ignore */ }
  const deck = (sub.presetDeck || []).slice();
  saveCustomDeck(rid, deck);
  renderDeckEditor(sub);
  renderFilter();
  if (lib.selSub === rid) renderSubDetail(rid);
}

function customClear(rid) {
  try { localStorage.removeItem('deck_' + rid); } catch (e) { /* ignore */ }
  renderDeckEditor(DB.subfactions.find(x => x.id === rid));
  renderFilter();
  if (lib.selSub === rid) renderSubDetail(rid);
}

function customSave(rid) {
  renderFilter();
  if (lib.selSub === rid) renderSubDetail(rid);
  toast(t('edit.saved'));
}

export const libraryActions = {
  'select-card': (el) => selectCard(el.dataset.card),
  'edit-custom-deck': (el) => editCustomDeck(el.dataset.rid),
  'deck-adj2': (el) => deckAdj2(el.dataset.rid, el.dataset.card, parseInt(el.dataset.delta)),
  'custom-auto-fill': (el) => customAutoFill(el.dataset.rid),
  'custom-reset': (el) => customReset(el.dataset.rid),
  'custom-clear': (el) => customClear(el.dataset.rid),
  'custom-save': (el) => customSave(el.dataset.rid),
};
import { $, esc, IS_MOBILE, toast } from './util.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { DB, saveDB, EFF_TYPES, FX_FORMS, defaultFx, compressImage, genDesc, getFaction } from './data.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { show } from './util.js?v=__VERSION__';

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

export function openEditor() {
  state.EDIT = { tab: 'subfaction', sel: null, factionSel: null };
  setTab('subfaction');
  show('sc-edit');
}

export function setTab(tab) {
  state.EDIT.tab = tab;
  state.EDIT.sel = null;
  state.EDIT.factionSel = null;
  saveEditState();
  $('edit-subfaction').style.display = tab === 'subfaction' ? 'flex' : 'none';
  $('edit-card').style.display = tab === 'card' ? 'flex' : 'none';
  const tabs = document.querySelectorAll('.edit-tabs .tab');
  const idx = tab === 'subfaction' ? 0 : 1;
  tabs.forEach((b, i) => b.classList.toggle('on', i === idx));
  renderEditList();
}

export function renderEditList() {
  if (state.EDIT.tab === 'subfaction') {
    renderSubfactionTree();
    if (state.EDIT.factionSel) {
      renderFactionForm(DB.factions.find(x => x.id === state.EDIT.factionSel));
      $('faction-form').style.display = '';
      $('subfaction-form').style.display = 'none';
    } else {
      const r = DB.subfactions.find(x => x.id === state.EDIT.sel) || DB.subfactions[0];
      if (r) { renderSubfactionForm(r); $('subfaction-form').style.display = ''; }
      else $('subfaction-form').style.display = 'none';
      $('faction-form').style.display = 'none';
    }
  } else {
    $('card-list').innerHTML = DB.cards.map((c, i) =>
      `<button class="item ${state.EDIT.sel === c.id ? 'sel' : ''}" data-action="edit-sel-card" data-index="${i}">
        <div class="thumb">${c.img ? `<img src="${c.img}">` : ''}</div><div><b>${esc(c.name)}</b><div class="dim" style="font-size:11px">${c.cost}${t('edit.cost')} · ${esc(c.desc || genDesc(c.effects))}</div></div></button>`).join('')
      + (!IS_MOBILE ? `<button data-action="new-card" style="padding:8px">${t('edit.new_card')}</button>` : '');
    const c = DB.cards.find(x => x.id === state.EDIT.sel) || DB.cards[0];
    if (c) { renderCardForm(c); $('card-form').style.display = ''; }
    else $('card-form').style.display = 'none';
  }
}

function renderSubfactionTree() {
  const fid = new Set(DB.factions.map(f => f.id));
  const openFactions = new Set((state.EDIT.openFactions || '').split(',').filter(Boolean));
  $('subfaction-list').innerHTML = DB.factions.map(f => {
    const subs = DB.subfactions.filter(r => r.faction === f.id);
    const isOpen = openFactions.has(f.id);
    return `<div class="tree-faction ${isOpen ? 'open' : ''}">
      <div class="tree-row tree-faction-row" data-action="edit-faction" data-fid="${f.id}">
        <span class="tree-toggle" data-action="tree-toggle-faction" data-fid="${f.id}">${isOpen ? '▾' : '▸'}</span>
        <span class="tree-name">${esc(f.name)}</span>
        <span class="tree-count">${subs.length}</span>
      </div>
      <div class="tree-children">${subs.map(r => {
        const idx = DB.subfactions.indexOf(r);
        return `<div class="tree-sub-row tree-row ${state.EDIT.sel === r.id ? 'sel' : ''}" data-action="edit-sel-subfaction" data-index="${idx}">
          <span class="tree-dot"></span>
          <span class="tree-name">${esc(r.name)}</span>
          <span class="tree-count">${t('edit.stat_hp')}${r.hp}</span>
        </div>`;
      }).join('')}${isOpen && !IS_MOBILE ? `<div class="tree-new" data-action="new-subfaction" data-faction="${f.id}" style="cursor:pointer">${t('edit.new_subfaction')}</div>` : ''}</div>
    </div>`;
  }).join('')
  + (DB.factions.length ? `<div class="tree-faction ${openFactions.has('__none__') ? 'open' : ''}">
    <div class="tree-row tree-faction-row" data-action="edit-faction" data-fid="__none__">
      <span class="tree-toggle" data-action="tree-toggle-faction" data-fid="__none__">${openFactions.has('__none__') ? '▾' : '▸'}</span>
      <span class="tree-name">${t('edit.faction_none')}</span>
      <span class="tree-count">${DB.subfactions.filter(r => !r.faction || !fid.has(r.faction)).length}</span>
    </div>
    <div class="tree-children">${DB.subfactions.filter(r => !r.faction || !fid.has(r.faction)).map(r => {
      const idx = DB.subfactions.indexOf(r);
      return `<div class="tree-sub-row tree-row ${state.EDIT.sel === r.id ? 'sel' : ''}" data-action="edit-sel-subfaction" data-index="${idx}">
        <span class="tree-dot"></span>
        <span class="tree-name">${esc(r.name)}</span>
        <span class="tree-count">${t('edit.stat_hp')}${r.hp}</span>
      </div>`;
    }).join('')}${openFactions.has('__none__') && !IS_MOBILE ? `<div class="tree-new" data-action="new-subfaction" data-faction="" style="cursor:pointer">${t('edit.new_subfaction')}</div>` : ''}</div>
  </div>` : '')
  + (!IS_MOBILE ? `<div class="tree-new" data-action="new-faction" style="cursor:pointer">${t('edit.new_faction')}</div>` : '');
}

function toggleTreeFaction(fid) {
  const key = 'openFactions';
  const set = new Set((state.EDIT[key] || '').split(',').filter(Boolean));
  if (set.has(fid)) set.delete(fid); else set.add(fid);
  state.EDIT[key] = [...set].join(',');
  renderSubfactionTree();
}

function editSel(tab, i) {
  state.EDIT.sel = (tab === 'subfaction' ? DB.subfactions[i].id : DB.cards[i].id);
  state.EDIT.factionSel = null;
  saveEditState();
  renderEditList();
}

function saveEditState() {
  localStorage.setItem('saved_edit', JSON.stringify({ tab: state.EDIT.tab, sel: state.EDIT.sel }));
}

function newSubfaction(el) {
  const faction = el ? el.dataset.faction || null : null;
  const r = { id: 'r' + Date.now(), name: t('edit.default_subfaction_name'), faction, hp: 40, def: 2, eng: 3, intro: '', img: '', deck: [] };
  DB.subfactions.push(r);
  state.EDIT.sel = r.id;
  renderEditList();
}

function newCard() {
  const c = { id: 'c' + Date.now(), name: t('edit.default_card_name'), cost: 1, img: '', effects: [{ type: 'damage', value: 5, target: 'enemy' }], desc: '' };
  DB.cards.push(c);
  state.EDIT.sel = c.id;
  renderEditList();
}

function delSubfaction() {
  if (!confirm(t('edit.confirm_del_subfaction'))) return;
  DB.subfactions = DB.subfactions.filter(x => x.id !== state.EDIT.sel);
  state.EDIT.sel = null;
  saveDB();
  renderEditList();
}

function delCard() {
  if (!confirm(t('edit.confirm_del_card'))) return;
  DB.cards = DB.cards.filter(x => x.id !== state.EDIT.sel);
  state.EDIT.sel = null;
  saveDB();
  renderEditList();
}

function renderSubfactionForm(r) {
  if (!r) return;
  state.DECK_SUBFACTION = r;
  if (IS_MOBILE) {
    $('subfaction-form').innerHTML = `
      <div class="frow"><label>${t('edit.name')}</label><span>${esc(r.name)}</span></div>
      <div class="frow"><label>${t('edit.hp')}</label><span>${r.hp}</span></div>
      <div class="frow"><label>${t('edit.def')}</label><span>${r.def}</span></div>
      <div class="frow"><label>${t('edit.energy')}</label><span>${r.eng}</span></div>
      <div class="frow"><label>${t('edit.intro')}</label><span class="dim">${esc(r.intro || '')}</span></div>
      <div class="frow"><label>${t('edit.deck')}</label><span>${(r.deck || []).length} ${t('edit.stat_count')}</span></div>
      <div class="frow"><button style="color:var(--red)" data-action="del-subfaction">${t('edit.del_subfaction')}</button></div>
      <div class="dim" style="font-size:11px">${t('edit.mobile_hint')}</div>`;
    return;
  }
  $('subfaction-form').innerHTML = `
    <div class="frow"><label>${t('edit.name')}</label><input id="rf-name" value="${esc(r.name)}"></div>
    <div class="frow"><label>${t('edit.faction')}</label><select id="rf-faction"><option value="">${t('edit.faction_none')}</option>${DB.factions.map(f => `<option value="${esc(f.id)}" ${r.faction === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div>
    <div class="frow"><label>${t('edit.hp')}</label><input id="rf-hp" type="number" min="1" value="${r.hp}"></div>
    <div class="frow"><label>${t('edit.def')}</label><input id="rf-def" type="number" min="0" value="${r.def}"></div>
    <div class="frow"><label>${t('edit.energy')}</label><input id="rf-eng" type="number" min="1" value="${r.eng}"></div>
    <div class="frow"><label>${t('edit.intro')}</label><textarea id="rf-intro" rows="2">${esc(r.intro || '')}</textarea></div>
    <div class="frow"><label>${t('edit.img')}</label><input id="rf-img" placeholder="${t('edit.img_placeholder')}" value="${esc(r.img || '')}"><input type="file" accept="image/*" data-action="load-img-subfaction"></div>
    <div class="frow"><label>${t('edit.deck')}</label><span class="dim" style="font-size:11px">${t('edit.deck_hint')}</span></div>
    <div class="deck-box" id="deck-box"></div>
    <div class="frow"><button class="primary" data-action="save-subfaction">${t('edit.save_subfaction')}</button><button style="color:var(--red)" data-action="del-subfaction">${t('edit.del_subfaction_btn')}</button></div>`;
  renderDeckBox(r);
  autoGrow($('rf-intro'));
}

function renderDeckBox(r) {
  const cnt = {};
  (r.deck || []).forEach(id => cnt[id] = (cnt[id] || 0) + 1);
  $('deck-box').innerHTML = DB.cards.map(c =>
    `<div class="deck-item"><span class="dn">${esc(c.name)}</span>
      <button data-action="deck-dec" data-card="${c.id}">−</button><b>${cnt[c.id] || 0}</b>
      <button data-action="deck-inc" data-card="${c.id}">+</button></div>`).join('')
    || `<div class="dim">${t('edit.no_card')}</div>`;
}

function deckAdj(cid, delta) {
  if (!state.DECK_SUBFACTION) return;
  state.DECK_SUBFACTION.deck = state.DECK_SUBFACTION.deck || [];
  const idx = state.DECK_SUBFACTION.deck.indexOf(cid);
  if (delta > 0) state.DECK_SUBFACTION.deck.push(cid);
  else if (idx >= 0) state.DECK_SUBFACTION.deck.splice(idx, 1);
  renderDeckBox(state.DECK_SUBFACTION);
}

function renderCardForm(c) {
  if (!c) return;
  if (IS_MOBILE) {
    $('card-form').innerHTML = `
      <div class="frow"><label>${t('edit.name')}</label><span>${esc(c.name)}</span></div>
      <div class="frow"><label>${t('edit.cost')}</label><span>${c.cost}</span></div>
      <div class="frow"><label>${t('edit.effects')}</label><span class="dim" style="font-size:12px">${esc(c.desc || genDesc(c.effects))}</span></div>
      <div class="frow"><button style="color:var(--red)" data-action="del-card">${t('edit.del_card')}</button></div>
      <div class="dim" style="font-size:11px">${t('edit.mobile_hint')}</div>`;
    return;
  }
  $('card-form').innerHTML = `
    <div class="frow"><label>${t('edit.name')}</label><input id="cf-name" value="${esc(c.name)}"></div>
    <div class="frow"><label>${t('edit.cost')}</label><input id="cf-cost" type="number" min="0" value="${c.cost}" style="width:90px"></div>
    <div class="frow"><label>${t('edit.img')}</label><input id="cf-img" placeholder="${t('edit.img_placeholder')}" value="${esc(c.img || '')}"><input type="file" accept="image/*" data-action="load-img-card"></div>
    <div class="frow"><label>${t('edit.effects')}</label><button data-action="add-eff">${t('edit.add_eff')}</button><span class="dim" style="font-size:11px">${t('edit.eff_hint')}</span></div>
    <div id="eff-list"></div>
    <div class="frow"><label>${t('edit.desc')}</label><textarea id="cf-desc" rows="2" placeholder="${t('edit.desc_placeholder')}">${esc(c.desc || '')}</textarea></div>
    <div class="frow"><button class="primary" data-action="save-card">${t('edit.save_card')}</button><button style="color:var(--red)" data-action="del-card">${t('edit.del_card_btn')}</button></div>`;
  c.effects.forEach(e => addEffRow(e));
  autoGrow($('cf-desc'));
}

function addEffRow(e) {
  const d = defaultFx(e ? e.type : 'damage');
  const box = document.createElement('div');
  box.className = 'eff-row';
  box.innerHTML = `<select class="et">${EFF_TYPES.map(et => `<option value="${et.v}" ${e && e.type === et.v ? 'selected' : ''}>${t(et.nkey)}</option>`).join('')}</select>
    <input class="ev" type="number" placeholder="${t('edit.eff_val')}" value="${e && e.value != null ? e.value : ''}">
    <input class="ed" type="number" placeholder="${t('edit.eff_dur')}" value="${e && e.duration != null ? e.duration : ''}">
    <label class="ep">${t('edit.eff_pierce')}<input type="checkbox" ${e && e.pierce ? 'checked' : ''}></label>
    <select class="etg"><option value="enemy" ${!e || e.target !== 'self' ? 'selected' : ''}>${t('edit.eff_target_enemy')}</option><option value="self" ${e && e.target === 'self' ? 'selected' : ''}>${t('edit.eff_target_self')}</option></select>
    <span class="fxlab">${t('edit.eff_fx')}</span>
    <select class="ef">${FX_FORMS.map(f => `<option value="${f.v}" ${e && e.fx && e.fx.form === f.v ? 'selected' : ''}>${t(f.nkey)}</option>`).join('')}</select>
    <input type="color" class="ec" value="${e && e.fx && e.fx.color ? e.fx.color : d.color}">
    <button style="padding:4px 8px" class="eff-del" data-action="eff-del">${t('edit.eff_del')}</button>`;
  box.querySelector('.eff-del').onclick = () => box.remove();
  box.querySelector('.et').onchange = () => updateEffRow(box);
  updateEffRow(box);
  $('eff-list').appendChild(box);
}

function addEff() { addEffRow(null); }

function updateEffRow(box) {
  const t = box.querySelector('.et').value;
  const noV = ['skip_turn', 'extra_turn'].includes(t);
  const noD = ['damage', 'heal', 'draw', 'force_discard', 'energy', 'skip_turn', 'extra_turn'].includes(t);
  box.querySelector('.ev').style.display = noV ? 'none' : '';
  box.querySelector('.ed').style.display = noD ? 'none' : '';
  box.querySelector('.ep').style.display = t === 'damage' ? '' : 'none';
}

function collectEffs() {
  return [...$('eff-list').children].map(box => ({
    type: box.querySelector('.et').value,
    value: box.querySelector('.ev').value === '' ? undefined : parseInt(box.querySelector('.ev').value),
    duration: box.querySelector('.ed').value === '' ? undefined : parseInt(box.querySelector('.ed').value),
    pierce: box.querySelector('.ep input').checked,
    target: box.querySelector('.etg').value,
    fx: { form: box.querySelector('.ef').value, color: box.querySelector('.ec').value },
  })).filter(e => e.type);
}

function saveSubfaction() {
  const r = DB.subfactions.find(x => x.id === state.EDIT.sel);
  if (!r) return;
  r.name = $('rf-name').value.trim() || t('edit.fallback_name');
  r.faction = $('rf-faction').value || null;
  r.hp = Math.max(1, parseInt($('rf-hp').value) || 1);
  r.def = Math.max(0, parseInt($('rf-def').value) || 0);
  r.eng = Math.max(1, parseInt($('rf-eng').value) || 1);
  r.intro = $('rf-intro').value;
  r.img = $('rf-img').value.trim();
  r.deck = r.deck || [];
  saveDB();
  renderEditList();
  toast(t('edit.saved'));
}

function saveCard() {
  const c = DB.cards.find(x => x.id === state.EDIT.sel);
  if (!c) return;
  c.name = $('cf-name').value.trim() || t('edit.fallback_name');
  c.cost = Math.max(0, parseInt($('cf-cost').value) || 0);
  c.img = $('cf-img').value.trim();
  c.effects = collectEffs();
  const manual = $('cf-desc').value.trim();
  c.desc = manual || genDesc(c.effects);
  saveDB();
  renderEditList();
  toast(t('edit.saved'));
}

function loadImg(kind) {
  const input = kind === 'subfaction' ? $('rf-img').nextElementSibling : $('cf-img').nextElementSibling;
  const f = input.files[0];
  if (!f) return;
  compressImage(f, data => {
    if (kind === 'subfaction') {
      const r = DB.subfactions.find(x => x.id === state.EDIT.sel);
      if (r) r.img = data;
    } else {
      const c = DB.cards.find(x => x.id === state.EDIT.sel);
      if (c) c.img = data;
    }
    renderEditList();
  });
}

function newFaction() {
  const f = { id: 'f' + Date.now(), name: t('edit.default_faction_name'), desc: '', img: '' };
  DB.factions.push(f);
  state.EDIT.factionSel = f.id;
  renderEditList();
}

function renderFactionForm(f) {
  if (IS_MOBILE) {
    $('faction-form').innerHTML = `
      <div class="frow"><button data-action="back-to-subfaction">← ${t('edit.tab_subfaction')}</button></div>
      <div class="frow"><label>${t('edit.faction_name')}</label><span>${esc(f.name)}</span></div>
      <div class="frow"><label>${t('edit.faction_desc')}</label><span class="dim">${esc(f.desc || '')}</span></div>
      <div class="frow"><button style="color:var(--red)" data-action="del-faction">${t('edit.del_faction')}</button></div>
      <div class="dim" style="font-size:11px">${t('edit.mobile_hint')}</div>`;
    return;
  }
  $('faction-form').innerHTML = `
    <div class="frow"><button data-action="back-to-subfaction">← ${t('edit.tab_subfaction')}</button></div>
    <div class="frow"><label>${t('edit.faction_name')}</label><input id="ff-name" value="${esc(f.name)}"></div>
    <div class="frow"><label>${t('edit.faction_desc')}</label><textarea id="ff-desc" rows="2">${esc(f.desc || '')}</textarea></div>
    <div class="frow"><label>${t('edit.img')}</label><input id="ff-img" placeholder="${t('edit.img_placeholder')}" value="${esc(f.img || '')}"><input type="file" accept="image/*" data-action="load-img-faction"></div>
    <div class="frow"><button class="primary" data-action="save-faction">${t('edit.save_faction')}</button><button style="color:var(--red)" data-action="del-faction">${t('edit.del_faction_btn')}</button></div>`;
  autoGrow($('ff-desc'));
}

function saveFaction() {
  const f = DB.factions.find(x => x.id === state.EDIT.factionSel);
  if (!f) return;
  f.name = $('ff-name').value.trim() || t('edit.fallback_name');
  f.desc = $('ff-desc').value;
  f.img = $('ff-img').value.trim();
  saveDB();
  renderEditList();
  toast(t('edit.saved'));
}

function delFaction() {
  const f = DB.factions.find(x => x.id === state.EDIT.factionSel);
  if (!f) return;
  if (!confirm(t('edit.confirm_del_faction'))) return;
  DB.factions = DB.factions.filter(x => x.id !== f.id);
  DB.subfactions.forEach(r => { if (r.faction === f.id) r.faction = null; });
  state.EDIT.factionSel = null;
  saveDB();
  renderEditList();
}

function loadImgFaction() {
  const input = $('ff-img').nextElementSibling;
  const file = input.files[0];
  if (!file) return;
  compressImage(file, data => {
    const f = DB.factions.find(x => x.id === state.EDIT.factionSel);
    if (f) f.img = data;
    renderEditList();
  });
}

export const editorActions = {
  'edit-sel-subfaction': (el) => editSel('subfaction', parseInt(el.dataset.index)),
  'edit-sel-card': (el) => editSel('card', parseInt(el.dataset.index)),
  'tree-toggle-faction': (el) => toggleTreeFaction(el.dataset.fid),
  'edit-faction': (el) => { if (el.dataset.fid === '__none__') { toggleTreeFaction('__none__'); return; } state.EDIT.factionSel = el.dataset.fid; state.EDIT.sel = null; renderEditList(); },
  'back-to-subfaction': () => { state.EDIT.factionSel = null; renderEditList(); },
  'new-subfaction': (el) => newSubfaction(el),
  'new-card': () => newCard(),
  'new-faction': () => newFaction(),
  'del-subfaction': () => delSubfaction(),
  'del-card': () => delCard(),
  'del-faction': () => delFaction(),
  'save-subfaction': () => saveSubfaction(),
  'save-card': () => saveCard(),
  'save-faction': () => saveFaction(),
  'deck-dec': (el) => deckAdj(el.dataset.card, -1),
  'deck-inc': (el) => deckAdj(el.dataset.card, 1),
  'add-eff': () => addEff(),
  'load-img-subfaction': (el) => { el.addEventListener('change', () => loadImg('subfaction'), { once: true }); },
  'load-img-card': (el) => { el.addEventListener('change', () => loadImg('card'), { once: true }); },
  'load-img-faction': (el) => { el.addEventListener('change', () => loadImgFaction(), { once: true }); },
};
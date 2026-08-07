import { $, esc, IS_MOBILE } from './util.js';
import { state } from './state.js';
import { DB, saveDB, EFF_TYPES, FX_FORMS, defaultFx, compressImage, genDesc } from './data.js';
import { t } from './i18n.js';
import { show } from './util.js';

export function openEditor() {
  state.EDIT = { tab: 'role', sel: null };
  setTab('role');
  show('sc-edit');
}

export function setTab(tab) {
  state.EDIT.tab = tab;
  state.EDIT.sel = null;
  $('edit-role').style.display = tab === 'role' ? 'flex' : 'none';
  $('edit-card').style.display = tab === 'card' ? 'flex' : 'none';
  document.querySelectorAll('.tab').forEach((b, i) => b.classList.toggle('on', i === (tab === 'role' ? 0 : 1)));
  renderEditList();
}

export function renderEditList() {
  if (state.EDIT.tab === 'role') {
    $('role-list').innerHTML = DB.roles.map((r, i) =>
      `<button class="item ${state.EDIT.sel === r.id ? 'sel' : ''}" data-action="edit-sel-role" data-index="${i}">
        <div class="thumb">${r.img ? `<img src="${r.img}">` : ''}</div><div><b>${esc(r.name)}</b><div class="dim" style="font-size:11px">${t('edit.stat_hp')}${r.hp} · ${t('edit.stat_def')}${r.def} · ${t('edit.stat_eng')}${r.eng} · ${t('edit.stat_deck')}${(r.deck || []).length}${t('edit.stat_count')}</div></div></button>`).join('')
      + (!IS_MOBILE ? `<button data-action="new-role" style="padding:8px">${t('edit.new_role')}</button>` : '');
    const r = DB.roles.find(x => x.id === state.EDIT.sel);
    renderRoleForm(r || DB.roles[0]);
  } else {
    $('card-list').innerHTML = DB.cards.map((c, i) =>
      `<button class="item ${state.EDIT.sel === c.id ? 'sel' : ''}" data-action="edit-sel-card" data-index="${i}">
        <div class="thumb">${c.img ? `<img src="${c.img}">` : ''}</div><div><b>${esc(c.name)}</b><div class="dim" style="font-size:11px">${c.cost}${t('edit.cost')} · ${esc(c.desc || genDesc(c.effects))}</div></div></button>`).join('')
      + (!IS_MOBILE ? `<button data-action="new-card" style="padding:8px">${t('edit.new_card')}</button>` : '');
    const c = DB.cards.find(x => x.id === state.EDIT.sel);
    renderCardForm(c || DB.cards[0]);
  }
}

function editSel(tab, i) {
  state.EDIT.sel = (tab === 'role' ? DB.roles[i].id : DB.cards[i].id);
  renderEditList();
}

function newRole() {
  const r = { id: 'r' + Date.now(), name: t('edit.default_role_name'), hp: 40, def: 2, eng: 3, intro: '', img: '', deck: [] };
  DB.roles.push(r);
  state.EDIT.sel = r.id;
  renderEditList();
}

function newCard() {
  const c = { id: 'c' + Date.now(), name: t('edit.default_card_name'), cost: 1, img: '', effects: [{ type: 'damage', value: 5, target: 'enemy' }], desc: '' };
  DB.cards.push(c);
  state.EDIT.sel = c.id;
  renderEditList();
}

function delRole() {
  if (!confirm(t('edit.confirm_del_role'))) return;
  DB.roles = DB.roles.filter(x => x.id !== state.EDIT.sel);
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

function renderRoleForm(r) {
  if (!r) return;
  state.DECK_ROLE = r;
  if (IS_MOBILE) {
    $('role-form').innerHTML = `
      <div class="frow"><label>${t('edit.name')}</label><span>${esc(r.name)}</span></div>
      <div class="frow"><label>${t('edit.hp')}</label><span>${r.hp}</span></div>
      <div class="frow"><label>${t('edit.def')}</label><span>${r.def}</span></div>
      <div class="frow"><label>${t('edit.energy')}</label><span>${r.eng}</span></div>
      <div class="frow"><label>${t('edit.intro')}</label><span class="dim">${esc(r.intro || '')}</span></div>
      <div class="frow"><label>${t('edit.deck')}</label><span>${(r.deck || []).length} ${t('edit.stat_count')}</span></div>
      <div class="frow"><button style="color:var(--red)" data-action="del-role">${t('edit.del_role')}</button></div>
      <div class="dim" style="font-size:11px">${t('edit.mobile_hint')}</div>`;
    return;
  }
  $('role-form').innerHTML = `
    <div class="frow"><label>${t('edit.name')}</label><input id="rf-name" value="${esc(r.name)}"></div>
    <div class="frow"><label>${t('edit.hp')}</label><input id="rf-hp" type="number" min="1" value="${r.hp}"></div>
    <div class="frow"><label>${t('edit.def')}</label><input id="rf-def" type="number" min="0" value="${r.def}"></div>
    <div class="frow"><label>${t('edit.energy')}</label><input id="rf-eng" type="number" min="1" value="${r.eng}"></div>
    <div class="frow"><label>${t('edit.intro')}</label><textarea id="rf-intro" rows="2">${esc(r.intro || '')}</textarea></div>
    <div class="frow"><label>${t('edit.img')}</label><input id="rf-img" placeholder="${t('edit.img_placeholder')}" value="${esc(r.img || '')}"><input type="file" accept="image/*" data-action="load-img-role"></div>
    <div class="frow"><label>${t('edit.deck')}</label><span class="dim" style="font-size:11px">${t('edit.deck_hint')}</span></div>
    <div class="deck-box" id="deck-box"></div>
    <div class="frow"><button class="primary" data-action="save-role">${t('edit.save_role')}</button><button data-action="new-role">${t('edit.new_role_btn')}</button><button style="color:var(--red)" data-action="del-role">${t('edit.del_role_btn')}</button></div>`;
  renderDeckBox(r);
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
  if (!state.DECK_ROLE) return;
  state.DECK_ROLE.deck = state.DECK_ROLE.deck || [];
  const idx = state.DECK_ROLE.deck.indexOf(cid);
  if (delta > 0) state.DECK_ROLE.deck.push(cid);
  else if (idx >= 0) state.DECK_ROLE.deck.splice(idx, 1);
  renderDeckBox(state.DECK_ROLE);
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
    <div class="frow"><button class="primary" data-action="save-card">${t('edit.save_card')}</button><button data-action="new-card">${t('edit.new_card_btn')}</button><button style="color:var(--red)" data-action="del-card">${t('edit.del_card_btn')}</button></div>`;
  c.effects.forEach(e => addEffRow(e));
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
    <button style="padding:4px 8px" data-action="eff-del">${t('edit.eff_del')}</button>`;
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

function saveRole() {
  const r = DB.roles.find(x => x.id === state.EDIT.sel);
  if (!r) return;
  r.name = $('rf-name').value.trim() || t('edit.fallback_name');
  r.hp = Math.max(1, parseInt($('rf-hp').value) || 1);
  r.def = Math.max(0, parseInt($('rf-def').value) || 0);
  r.eng = Math.max(1, parseInt($('rf-eng').value) || 1);
  r.intro = $('rf-intro').value;
  r.img = $('rf-img').value.trim();
  r.deck = r.deck || [];
  saveDB();
  renderEditList();
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
}

function loadImg(kind) {
  const input = kind === 'role' ? $('rf-img').nextElementSibling : $('cf-img').nextElementSibling;
  const f = input.files[0];
  if (!f) return;
  compressImage(f, data => {
    if (kind === 'role') {
      const r = DB.roles.find(x => x.id === state.EDIT.sel);
      if (r) r.img = data;
    } else {
      const c = DB.cards.find(x => x.id === state.EDIT.sel);
      if (c) c.img = data;
    }
    renderEditList();
  });
}

export const editorActions = {
  'edit-sel-role': (el) => editSel('role', parseInt(el.dataset.index)),
  'edit-sel-card': (el) => editSel('card', parseInt(el.dataset.index)),
  'new-role': () => newRole(),
  'new-card': () => newCard(),
  'del-role': () => delRole(),
  'del-card': () => delCard(),
  'save-role': () => saveRole(),
  'save-card': () => saveCard(),
  'deck-dec': (el) => deckAdj(el.dataset.card, -1),
  'deck-inc': (el) => deckAdj(el.dataset.card, 1),
  'add-eff': () => addEff(),
  'load-img-role': (el) => { el.addEventListener('change', () => loadImg('role'), { once: true }); },
  'load-img-card': (el) => { el.addEventListener('change', () => loadImg('card'), { once: true }); },
};
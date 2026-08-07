import { $, esc, IS_MOBILE } from './util.js';
import { state } from './state.js';
import { DB, saveDB, EFF_TYPES, FX_FORMS, defaultFx, compressImage, genDesc } from './data.js';
import { show } from './util.js';

export function openEditor() {
  state.EDIT = { tab: 'role', sel: null };
  setTab('role');
  show('sc-edit');
}

export function setTab(t) {
  state.EDIT.tab = t;
  state.EDIT.sel = null;
  $('edit-role').style.display = t === 'role' ? 'flex' : 'none';
  $('edit-card').style.display = t === 'card' ? 'flex' : 'none';
  document.querySelectorAll('.tab').forEach((b, i) => b.classList.toggle('on', i === (t === 'role' ? 0 : 1)));
  renderEditList();
}

export function renderEditList() {
  if (state.EDIT.tab === 'role') {
    $('role-list').innerHTML = DB.roles.map((r, i) =>
      `<button class="item ${state.EDIT.sel === r.id ? 'sel' : ''}" data-action="edit-sel-role" data-index="${i}">
        <div class="thumb">${r.img ? `<img src="${r.img}">` : ''}</div><div><b>${esc(r.name)}</b><div class="dim" style="font-size:11px">HP${r.hp} · 防${r.def} · 能${r.eng} · 牌组${(r.deck || []).length}张</div></div></button>`).join('')
      + (!IS_MOBILE ? `<button data-action="new-role" style="padding:8px">+ 新建角色</button>` : '');
    const r = DB.roles.find(x => x.id === state.EDIT.sel);
    renderRoleForm(r || DB.roles[0]);
  } else {
    $('card-list').innerHTML = DB.cards.map((c, i) =>
      `<button class="item ${state.EDIT.sel === c.id ? 'sel' : ''}" data-action="edit-sel-card" data-index="${i}">
        <div class="thumb">${c.img ? `<img src="${c.img}">` : ''}</div><div><b>${esc(c.name)}</b><div class="dim" style="font-size:11px">${c.cost}费 · ${esc(c.desc || genDesc(c.effects))}</div></div></button>`).join('')
      + (!IS_MOBILE ? `<button data-action="new-card" style="padding:8px">+ 新建卡牌</button>` : '');
    const c = DB.cards.find(x => x.id === state.EDIT.sel);
    renderCardForm(c || DB.cards[0]);
  }
}

function editSel(t, i) {
  state.EDIT.sel = (t === 'role' ? DB.roles[i].id : DB.cards[i].id);
  renderEditList();
}

function newRole() {
  const r = { id: 'r' + Date.now(), name: '新角色', hp: 40, def: 2, eng: 3, intro: '', img: '', deck: [] };
  DB.roles.push(r);
  state.EDIT.sel = r.id;
  renderEditList();
}

function newCard() {
  const c = { id: 'c' + Date.now(), name: '新卡牌', cost: 1, img: '', effects: [{ type: 'damage', value: 5, target: 'enemy' }], desc: '' };
  DB.cards.push(c);
  state.EDIT.sel = c.id;
  renderEditList();
}

function delRole() {
  if (!confirm('删除该角色？')) return;
  DB.roles = DB.roles.filter(x => x.id !== state.EDIT.sel);
  state.EDIT.sel = null;
  saveDB();
  renderEditList();
}

function delCard() {
  if (!confirm('删除该卡牌？')) return;
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
      <div class="frow"><label>名字</label><span>${esc(r.name)}</span></div>
      <div class="frow"><label>生命</label><span>${r.hp}</span></div>
      <div class="frow"><label>防御</label><span>${r.def}</span></div>
      <div class="frow"><label>能量上限</label><span>${r.eng}</span></div>
      <div class="frow"><label>介绍</label><span class="dim">${esc(r.intro || '')}</span></div>
      <div class="frow"><label>牌组</label><span>${(r.deck || []).length} 张</span></div>
      <div class="frow"><button style="color:var(--red)" data-action="del-role">删除该角色</button></div>
      <div class="dim" style="font-size:11px">手机端仅支持查看与删除，编辑请到电脑端</div>`;
    return;
  }
  $('role-form').innerHTML = `
    <div class="frow"><label>名字</label><input id="rf-name" value="${esc(r.name)}"></div>
    <div class="frow"><label>生命</label><input id="rf-hp" type="number" min="1" value="${r.hp}"></div>
    <div class="frow"><label>防御</label><input id="rf-def" type="number" min="0" value="${r.def}"></div>
    <div class="frow"><label>能量上限</label><input id="rf-eng" type="number" min="1" value="${r.eng}"></div>
    <div class="frow"><label>介绍</label><textarea id="rf-intro" rows="2">${esc(r.intro || '')}</textarea></div>
    <div class="frow"><label>图片</label><input id="rf-img" placeholder="图片URL（或上传文件）" value="${esc(r.img || '')}"><input type="file" accept="image/*" data-action="load-img-role"></div>
    <div class="frow"><label>牌组</label><span class="dim" style="font-size:11px">该角色专属牌组，+/- 调整张数（留空则用全部卡牌各2张）</span></div>
    <div class="deck-box" id="deck-box"></div>
    <div class="frow"><button class="primary" data-action="save-role">保存角色</button><button data-action="new-role">新建</button><button style="color:var(--red)" data-action="del-role">删除</button></div>`;
  renderDeckBox(r);
}

function renderDeckBox(r) {
  const cnt = {};
  (r.deck || []).forEach(id => cnt[id] = (cnt[id] || 0) + 1);
  $('deck-box').innerHTML = DB.cards.map(c =>
    `<div class="deck-item"><span class="dn">${esc(c.name)}</span>
      <button data-action="deck-dec" data-card="${c.id}">−</button><b>${cnt[c.id] || 0}</b>
      <button data-action="deck-inc" data-card="${c.id}">+</button></div>`).join('')
    || '<div class="dim">暂无卡牌，请先在【技能卡牌】标签创建</div>';
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
      <div class="frow"><label>名字</label><span>${esc(c.name)}</span></div>
      <div class="frow"><label>费用</label><span>${c.cost}</span></div>
      <div class="frow"><label>效果</label><span class="dim" style="font-size:12px">${esc(c.desc || genDesc(c.effects))}</span></div>
      <div class="frow"><button style="color:var(--red)" data-action="del-card">删除该卡牌</button></div>
      <div class="dim" style="font-size:11px">手机端仅支持查看与删除，编辑请到电脑端</div>`;
    return;
  }
  $('card-form').innerHTML = `
    <div class="frow"><label>名字</label><input id="cf-name" value="${esc(c.name)}"></div>
    <div class="frow"><label>费用</label><input id="cf-cost" type="number" min="0" value="${c.cost}" style="width:90px"></div>
    <div class="frow"><label>图片</label><input id="cf-img" placeholder="图片URL（或上传文件）" value="${esc(c.img || '')}"><input type="file" accept="image/*" data-action="load-img-card"></div>
    <div class="frow"><label>效果</label><button data-action="add-eff">+ 添加效果</button><span class="dim" style="font-size:11px">每个效果可配特效（形式+颜色），按顺序结算</span></div>
    <div id="eff-list"></div>
    <div class="frow"><label>描述</label><textarea id="cf-desc" rows="2" placeholder="留空则按效果自动生成">${esc(c.desc || '')}</textarea></div>
    <div class="frow"><button class="primary" data-action="save-card">保存卡牌</button><button data-action="new-card">新建</button><button style="color:var(--red)" data-action="del-card">删除</button></div>`;
  c.effects.forEach(e => addEffRow(e));
}

function addEffRow(e) {
  const d = defaultFx(e ? e.type : 'damage');
  const box = document.createElement('div');
  box.className = 'eff-row';
  box.innerHTML = `<select class="et">${EFF_TYPES.map(t => `<option value="${t.v}" ${e && e.type === t.v ? 'selected' : ''}>${t.n}</option>`).join('')}</select>
    <input class="ev" type="number" placeholder="数值" value="${e && e.value != null ? e.value : ''}">
    <input class="ed" type="number" placeholder="持续" value="${e && e.duration != null ? e.duration : ''}">
    <label class="ep">真伤<input type="checkbox" ${e && e.pierce ? 'checked' : ''}></label>
    <select class="etg"><option value="enemy" ${!e || e.target !== 'self' ? 'selected' : ''}>敌方</option><option value="self" ${e && e.target === 'self' ? 'selected' : ''}>自己</option></select>
    <span class="fxlab">特效</span>
    <select class="ef">${FX_FORMS.map(f => `<option value="${f.v}" ${e && e.fx && e.fx.form === f.v ? 'selected' : ''}>${f.n}</option>`).join('')}</select>
    <input type="color" class="ec" value="${e && e.fx && e.fx.color ? e.fx.color : d.color}">
    <button style="padding:4px 8px" data-action="eff-del">删</button>`;
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
  r.name = $('rf-name').value.trim() || '无名';
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
  c.name = $('cf-name').value.trim() || '无名';
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

/* Event handler map - called by app.js */
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
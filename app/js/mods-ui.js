import { $, show } from './util.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';
import { state } from './state.js?v=__VERSION__';
import { getMods, getModOrder, setModOrder, deleteMod, setModEnabled, renderModConfig, importMod, reloadMods } from './modloader.js?v=__VERSION__';

// ============================================================================
// 模组管理组件（设置页的模组列表 UI；数据层在 modloader.js）
// ============================================================================

export function renderModList() {
  const list = $('mod-list');
  if (!list) return;
  const mods = getMods();
  list.innerHTML = mods.map((m, i) => `
    <div class="mod-item" data-mod-id="${m.id}">
      <span class="mod-drag" data-action="mod-drag">☰</span>
      <span class="mod-name">${m.meta.name || m.id}</span>
      <span class="dim" style="font-size:11px">v${m.meta.version || '?'} ${m.builtin ? '(' + t('settings.mods_builtin') + ')' : ''}</span>
      <span class="sp"></span>
      ${m.builtin ? '' : `<button class="mod-up" data-action="mod-up" data-idx="${i}" style="padding:2px 6px">▲</button>
      <button class="mod-dn" data-action="mod-dn" data-idx="${i}" style="padding:2px 6px">▼</button>
      <button class="mod-del" data-action="mod-del" data-idx="${i}" style="padding:2px 6px;color:var(--red)">✕</button>`}
      <label class="mod-toggle"><input type="checkbox" ${m.enabled ? 'checked' : ''} ${m.builtin ? 'disabled' : ''} data-action="mod-toggle" data-idx="${i}"></label>
    </div>
    <div class="mod-config" id="mod-config-${m.id}" style="display:none"></div>`).join('');
}

function initModList() {
  const list = $('mod-list');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.mod-item');
    if (!item) return;
    const id = item.dataset.modId;
    const cfgDiv = $('mod-config-' + id);
    if (e.target.closest('[data-action="mod-up"]')) {
      const idx = parseInt(e.target.dataset.idx);
      const order = getModOrder();
      if (idx > 0) [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
      setModOrder(order);
      renderModList();
    } else if (e.target.closest('[data-action="mod-dn"]')) {
      const idx = parseInt(e.target.dataset.idx);
      const order = getModOrder();
      if (idx < order.length - 1) [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
      setModOrder(order);
      renderModList();
    } else if (e.target.closest('[data-action="mod-del"]')) {
      const idx = parseInt(e.target.dataset.idx);
      const mods = getMods();
      deleteMod(mods[idx].id).then(() => renderModList());
    } else if (e.target.closest('[data-action="mod-toggle"]')) {
      const idx = parseInt(e.target.dataset.idx);
      const mods = getMods();
      setModEnabled(mods[idx].id, e.target.checked);
    } else {
      // 点击模组名称展开/收起配置
      const wasVisible = cfgDiv.style.display !== 'none';
      cfgDiv.style.display = wasVisible ? 'none' : 'block';
      if (!wasVisible) renderModConfig(id, cfgDiv);
    }
  });
}

function initModImport() {
  const btn = $('mod-import-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        await importMod(file);
        alert(t('settings.mods_imported'));
        renderModList();
      } catch (e) {
        alert(t('settings.mods_invalid') + ': ' + e.message);
      }
    };
    input.click();
  });
}

function initModApply() {
  const btn = $('mod-apply-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (state.PHASE_BATTLE && state.BATTLE && !state.BATTLE.winner) {
      if (!confirm(t('settings.mods_confirm_quit'))) return;
    }
    state.BATTLE = null;
    state.PHASE_BATTLE = false;
    state.LAN = null;
    show('sc-menu');
    await reloadMods();
  });
}

/** 启动初始化（app.js 调用一次） */
export function initMods() {
  initModList();
  initModImport();
  initModApply();
}

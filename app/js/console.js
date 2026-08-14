import { t } from './i18n.js?v=__VERSION__';

// ============================================================================
// 开发者控制台：按住 ~ 键显示，点击标题激活，输入 admin dev 开启编辑器权限
// ============================================================================

const CONSOLE_HEIGHT = 280;
const DEV_KEY = 'dev_mode';

let consoleEl = null;
let inputEl = null;
let outputEl = null;
let isLocked = false;

export function initConsole() {
  // 检查是否已开启 dev 模式（上次启用时保留状态）
  if (localStorage.getItem(DEV_KEY) === '1') {
    setDevMode(true);
  }

  // 监听 ~ 键
  document.addEventListener('keydown', (e) => {
    if (e.key === '~' || e.key === 'graveaccent') {
      e.preventDefault();
      toggleConsole();
    }
    if (!consoleEl || !consoleEl.classList.contains('on')) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      execCommand();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideConsole();
    }
  });

  // 点击标题时若控制台可见则聚焦输入
  const titleBtn = document.getElementById('menu-title');
  if (titleBtn) {
    titleBtn.addEventListener('click', () => {
      if (consoleEl && consoleEl.classList.contains('on')) {
        focusInput();
      }
    });
  }
}

function toggleConsole() {
  if (!consoleEl) buildConsole();
  const shown = consoleEl.classList.contains('on');
  if (shown) hideConsole();
  else showConsole();
}

function showConsole() {
  if (!consoleEl) buildConsole();
  consoleEl.classList.add('on');
  setTimeout(focusInput, 50);
}

function hideConsole() {
  if (!consoleEl) return;
  consoleEl.classList.remove('on');
  inputEl.value = '';
}

function focusInput() {
  if (inputEl) { inputEl.focus(); inputEl.select(); }
}

function buildConsole() {
  consoleEl = document.createElement('div');
  consoleEl.id = 'dev-console';
  consoleEl.innerHTML = `
    <div class="console-hd"><span class="console-title">开发者控制台</span><span class="console-hint">输入 admin dev 开启开发者模式</span></div>
    <div class="console-out" id="console-output"></div>
    <div class="console-in"><span class="prompt">$ </span><input type="text" id="console-input" autocomplete="off" spellcheck="false"></div>
  `;
  document.body.appendChild(consoleEl);
  outputEl = document.getElementById('console-output');
  inputEl = document.getElementById('console-input');
  printOutput(t('console.prompt'));
}

function printOutput(text) {
  if (!outputEl) return;
  const line = document.createElement('div');
  line.className = 'console-line';
  line.textContent = text;
  outputEl.appendChild(line);
  outputEl.scrollTop = outputEl.scrollHeight;
}

function execCommand() {
  const raw = inputEl.value.trim();
  if (!raw) return;
  printOutput('> ' + raw);
  const parts = raw.toLowerCase().split(/\s+/);
  if (parts[0] === 'admin' && parts[1] === 'dev') {
    localStorage.setItem(DEV_KEY, '1');
    setDevMode(true);
    printOutput(t('console.dev_enabled'));
  } else if (raw === 'clear') {
    outputEl.innerHTML = '';
    printOutput(t('console.prompt'));
  } else if (raw === 'help') {
    printOutput(t('console.help'));
  } else {
    printOutput(t('console.unknown_cmd'));
  }
  inputEl.value = '';
}

export function setDevMode(on) {
  if (!on) {
    localStorage.removeItem(DEV_KEY);
    const btn = document.getElementById('dev-editor-btn');
    if (btn) btn.remove();
    return;
  }
  if (document.getElementById('dev-editor-btn')) return;
  const settingsBtn = document.querySelector('[data-action="open-settings"]');
  if (!settingsBtn) return;
  const btn = document.createElement('div');
  btn.className = 'mbtn';
  btn.id = 'dev-editor-btn';
  btn.setAttribute('data-action', 'open-editor');
  btn.innerHTML = `<span data-i18n="menu.edit"></span><small data-i18n="menu.edit_hint"></small>`;
  settingsBtn.parentNode.insertBefore(btn, settingsBtn);
  // data-i18n 元素由 updateI18nElements() 在 locale-changed 时统一更新
}

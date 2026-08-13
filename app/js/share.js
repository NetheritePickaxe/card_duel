import { $, toast } from './util.js?v=__VERSION__';
import { t } from './i18n.js?v=__VERSION__';

// ============================================================================
// 主界面分享组件：局域网地址探测 / 复制分享 / 一言提示
// ============================================================================

function copyTextFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true, () => copyTextFallback(text));
  }
  return Promise.resolve(copyTextFallback(text));
}

function isPrivateIp(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip || '');
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// 服务端注入的占位符是顶层 const（词法作用域），不会挂到 window 上，需用裸标识符读取
function ipListGlobal() {
  try { return Array.isArray(__IP_LIST__) ? __IP_LIST__ : []; } catch (e) { return []; }
}
function phoneIpGlobal() {
  try { return typeof __PHONE_IP__ === 'string' ? __PHONE_IP__ : ''; } catch (e) { return ''; }
}

function getLanIp(cb) {
  let done = false;
  const finish = (ip) => { if (!done) { done = true; cb(ip || null); } };

  // Tauri：直接调用 Rust 的 lan_ip（src-tauri/src/net.rs）
  if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function') {
    window.__TAURI__.core.invoke('lan_ip')
      .then(ip => { if (isPrivateIp(ip)) finish(ip); else webrtcLanIp(finish); })
      .catch(() => webrtcLanIp(finish));
    return;
  }
  // 服务端注入（server.rs）：__PHONE_IP__ = 最优局域网 IP
  const phoneIp = phoneIpGlobal();
  if (isPrivateIp(phoneIp)) {
    finish(phoneIp);
    return;
  }
  const ipList = ipListGlobal();
  const hit = ipList.find(ip => isPrivateIp(ip));
  if (hit) { finish(hit); return; }
  // 页面已通过局域网地址打开
  if (isPrivateIp(location.hostname)) { finish(location.hostname); return; }

  // WebRTC 兜底（非 localhost 的局域网 HTTP 页面可正常获取）
  webrtcLanIp(finish);
}

function webrtcLanIp(finish) {
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    window.__lanPc = pc;
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const m = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(e.candidate.candidate || '');
      if (m && isPrivateIp(m[1])) finish(m[1]);
    };
    pc.createDataChannel('lan');
    pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => finish(null));
    setTimeout(() => finish(null), 1200);
  } catch (e) {
    finish(null);
  }
}

function buildShareUrl(ip) {
  const host = ip || location.hostname || 'localhost';
  const port = location.port || '8788';
  const scheme = (location.protocol === 'http:' || location.protocol === 'https:')
    ? location.protocol
    : 'http:';
  const portPart = (port && port !== '80' && port !== '443') ? ':' + port : '';
  return scheme + '//' + host + portPart + '/';
}

// 主界面标题：点标题变色
const menuTitle = document.querySelector('#sc-menu .m-title');
if (menuTitle) {
  menuTitle.addEventListener('click', () => {
    menuTitle.classList.add('anim');
    clearTimeout(menuTitle._animT);
    menuTitle._animT = setTimeout(() => menuTitle.classList.remove('anim'), 900);
  });
}

// 从本地 splash.txt 随机取一行作为提示文本
function showSplash(label) {
  fetch('card_duel/assets/splash.txt', { cache: 'no-store' })
    .then(r => { if (!r.ok) throw new Error('fail'); return r.text(); })
    .then(text => {
      const lines = text.split('\n').map(l => l.trim()).filter(l => l);
      if (lines.length && label) {
        label.textContent = lines[Math.floor(Math.random() * lines.length)];
      }
    })
    .catch(() => { /* ignore */ });
}

// 菜单下方显示地址（点击一言切换展开，点击地址复制）
export function renderMenuAddr() {
  const el = $('maddr');
  if (!el) return;
  el.classList.remove('open');
  el.innerHTML = '<div class="addr-label">' + t('menu.addr') + '</div><div class="addr-body"></div>';
  const label = el.querySelector('.addr-label');
  if (localStorage.getItem('_show_splash') !== '0') {
    el.style.display = '';
    showSplash(label);
  } else {
    el.style.display = 'none';
    return;
  }
  el.querySelector('.addr-label').addEventListener('click', (e) => {
    e.stopPropagation();
    el.classList.toggle('open');
  });
  getLanIp(ip => {
    const pi = ip || location.hostname || 'localhost';
    const port = location.port || '8788';
    const url = (h) => 'http://' + h + ':' + port + '/';
    const extra = ipListGlobal().filter(h => h && h !== pi);
    const extraHtml = extra.length ? '<div class="addr-extra">' + extra.map(url).join(' · ') + '</div>' : '';
    const body = el.querySelector('.addr-body');
    body.innerHTML = url(pi) + extraHtml;
    body.addEventListener('click', (e) => {
      e.stopPropagation();
      getLanIp(ip2 => {
        copyToClipboard(buildShareUrl(ip2)).then(ok => { if (ok) toast(t('menu.url_copied')); });
      });
    });
  });
}

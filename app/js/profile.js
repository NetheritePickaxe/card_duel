import { t } from './i18n.js?v=__VERSION__';

// ============================================================================
// 玩家资料（昵称）：首次启动设置，设置页可改。
// localStorage 键 `player_name`，与主题/语言等并列。
// ============================================================================

const KEY = 'player_name';

export function getPlayerName() {
  const n = (localStorage.getItem(KEY) || '').trim();
  return n || t('name.default');
}

export function savePlayerName(n) {
  localStorage.setItem(KEY, (n || '').trim());
}

export function hasPlayerName() {
  return !!(localStorage.getItem(KEY) || '').trim();
}

/** 电脑席位显示名：电脑1 / CPU 1 … */
export function cpuLabel(n) {
  return t('battle.cpu_name', { n });
}
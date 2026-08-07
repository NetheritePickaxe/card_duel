const VOLUME_KEY = 'bgm_volume';
const DEFAULT_VOLUME = 0.3;

let audio = null;

export function initAudio() {
  audio = document.getElementById('bgm');
  if (!audio) return;
  const saved = localStorage.getItem(VOLUME_KEY);
  audio.volume = saved !== null ? parseFloat(saved) : DEFAULT_VOLUME;
  const slider = document.getElementById('volume-slider');
  if (slider) slider.value = audio.volume;
  // 浏览器自动播放策略：首次用户交互后开始播放
  const start = () => { audio.play().catch(() => { }); document.removeEventListener('click', start); };
  document.addEventListener('click', start);
}

export function setVolume(v) {
  if (!audio) return;
  audio.volume = v;
  localStorage.setItem(VOLUME_KEY, v);
}

export function updateBGM() {
  if (!audio) return;
  const onMenu = document.getElementById('sc-menu').classList.contains('on');
  if (onMenu) {
    audio.play().catch(() => { });
  } else {
    audio.pause();
  }
}
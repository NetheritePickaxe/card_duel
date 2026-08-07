const VOLUME_KEY = 'bgm_volume';
const DEFAULT_VOLUME = 0.3;

const TRACKS = {};

export function registerTrack(id, path) {
  TRACKS[id] = path;
}

export function deregisterTrack(id) {
  delete TRACKS[id];
}

export function getTrackList() {
  return Object.keys(TRACKS);
}

let audio = null;

export async function initAudio() {
  audio = document.getElementById('bgm');
  if (!audio) return;
  const saved = localStorage.getItem(VOLUME_KEY);
  audio.volume = saved !== null ? parseFloat(saved) : DEFAULT_VOLUME;
  const slider = document.getElementById('volume-slider');
  if (slider) slider.value = audio.volume;
  await loadRegistry();
  audio.src = await resolveTrack('bgm/menu');
  const start = () => { audio.play().catch(() => { }); document.removeEventListener('click', start); };
  document.addEventListener('click', start);
}

async function loadRegistry() {
  try {
    const res = await fetch('sound/tracks.json');
    if (res.ok) {
      const data = await res.json();
      for (const [id, path] of Object.entries(data)) {
        if (!(id in TRACKS)) TRACKS[id] = path;
      }
    }
  } catch (e) { /* ignore */ }
}

async function resolveTrack(id) {
  const path = TRACKS[id];
  if (!path) return '';
  return path;
}

export function playTrack(id) {
  if (!audio) return;
  const path = TRACKS[id];
  if (!path) return;
  audio.src = path;
  audio.currentTime = 0;
  audio.play().catch(() => { });
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
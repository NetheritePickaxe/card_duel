import { state } from './state.js?v=__VERSION__';

const VOL_KEYS = { master: 'vol_master', bgm: 'vol_bgm', sfx: 'vol_sfx', voice: 'vol_voice' };
const VOL_DEFAULTS = { master: 1.0, bgm: 0.3, sfx: 0.8, voice: 0.8 };

const TRACKS = {};
let audio = null;
let currentId = null;
let currentTrackIdx = null;

export function registerTrack(id, config) {
  if (typeof config === 'string') {
    config = { stream: false, volume: 1.0, tracks: [{ file: config, weight: 1, volume: 1.0 }] };
  }
  const type = id.split('/')[0];
  TRACKS[id] = { type, ...config };
}

export function deregisterTrack(id) { delete TRACKS[id]; }
export function getTrackList() { return Object.keys(TRACKS); }

export function getTypeVolume(type) {
  const saved = localStorage.getItem(VOL_KEYS[type]);
  return saved !== null ? parseFloat(saved) : VOL_DEFAULTS[type];
}

export function setTypeVolume(type, v) {
  localStorage.setItem(VOL_KEYS[type], v);
  if (currentId && TRACKS[currentId] && TRACKS[currentId].type === type) applyVolume();
}

export function getMasterVolume() { return getTypeVolume('master'); }
export function setMasterVolume(v) {
  localStorage.setItem(VOL_KEYS.master, v);
  applyVolume();
}

function applyVolume() {
  if (!audio || !currentId) return;
  const cfg = TRACKS[currentId];
  if (!cfg) return;
  const file = cfg.tracks[currentTrackIdx];
  const master = getMasterVolume();
  const typeVol = getTypeVolume(cfg.type);
  audio.volume = master * typeVol * (cfg.volume ?? 1) * (file?.volume ?? 1);
}

function pickTrack(cfg) {
  const total = cfg.tracks.reduce((s, t) => s + (t.weight ?? 1), 0);
  let r = Math.random() * total;
  for (let i = 0; i < cfg.tracks.length; i++) {
    r -= cfg.tracks[i].weight ?? 1;
    if (r <= 0) return i;
  }
  return 0;
}

export async function initAudio() {
  audio = document.getElementById('bgm');
  if (!audio) return;
  audio.volume = 0;
  audio.addEventListener('ended', () => {
    if (!currentId) return;
    const cfg = TRACKS[currentId];
    if (!cfg) return;
    if (cfg.stream) {
      currentTrackIdx = pickTrack(cfg);
      audio.src = cfg.tracks[currentTrackIdx].file;
      applyVolume();
      audio.play().catch(() => { });
    } else {
      audio.currentTime = 0;
      audio.play().catch(() => { });
    }
  });
  const start = () => { playTrack('bgm/menu'); document.removeEventListener('click', start); };
  document.addEventListener('click', start);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { audio.pause(); }
    else { audio.play().catch(() => { }); }
  });
}

export function playTrack(id) {
  if (!audio) return;
  const cfg = TRACKS[id];
  if (!cfg || cfg.tracks.length === 0) return;
  currentId = id;
  currentTrackIdx = pickTrack(cfg);
  audio.src = cfg.tracks[currentTrackIdx].file;
  applyVolume();
  audio.play().catch(() => { });
}

export function updateBGM() {
  if (!audio) return;
  if (state.BATTLE && state.BATTLE.winner != null) {
    if (currentId !== 'bgm/defeat') playTrack('bgm/defeat');
    return;
  }
  const inBattle = document.getElementById('sc-battle').classList.contains('on');
  if (inBattle) {
    if (currentId !== 'bgm/battle') playTrack('bgm/battle');
  } else {
    if (currentId !== 'bgm/menu') playTrack('bgm/menu');
  }
  audio.play().catch(() => { });
}
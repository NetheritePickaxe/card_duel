// ============================================================================
// BGM 解析器：支持音频直链和 B站视频链接
// ============================================================================

const CORS_PROXY = 'https://api.allorigins.win/raw?url=';

function extractBvid(url) {
  const m = url.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
  return m ? m[1] : null;
}

async function tryFetch(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchWithFallback(apiUrl) {
  try {
    return await tryFetch(apiUrl);
  } catch (e) {
    // CORS 失败时尝试 CORS 代理
    const proxied = CORS_PROXY + encodeURIComponent(apiUrl);
    return await tryFetch(proxied);
  }
}

/**
 * 解析 BGM URL，返回可直接播放的音频 URL
 * @param {string} url - 音频直链或 B站视频链接
 * @returns {Promise<string>} 音频直链
 */
export async function resolveBgmUrl(url) {
  if (!url) return '';

  const bvid = extractBvid(url);
  if (!bvid) {
    // 不是 B站链接，视为直链
    return url;
  }

  // 1. 获取视频信息得到 cid
  const info = await fetchWithFallback(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  if (!info || !info.data) throw new Error('无法获取B站视频信息');
  const cid = info.data.cid;
  if (!cid) throw new Error('无法获取视频CID');

  // 2. 获取音频流地址
  const play = await fetchWithFallback(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&platform=html5&high_quality=0`
  );
  if (!play || !play.data) throw new Error('无法获取音频流');

  // 优先选纯音频流（dash.audio），其次选第一个视频流（dash.video，可能含音频）
  const dash = play.data.dash;
  if (dash && dash.audio && dash.audio.length > 0) {
    return dash.audio[0].baseUrl || dash.audio[0].base_url || dash.audio[0].url;
  }
  if (dash && dash.video && dash.video.length > 0) {
    return dash.video[0].baseUrl || dash.video[0].base_url || dash.video[0].url;
  }
  // 回退到 durl
  const durl = play.data.durl;
  if (durl && durl.length > 0) {
    return durl[0].url;
  }
  throw new Error('未找到可用的音频流');
}
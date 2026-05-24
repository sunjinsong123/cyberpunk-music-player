/* ═══════════════════════════════════════════════════
   NEON BEAT // 赛博音浪 - Application Logic v2
   ═══════════════════════════════════════════════════ */

// ── Config ──
// Cloudflare Worker URL (部署后修改此处)
// 留空则使用 QQ 音乐 JSONP fallback
const WORKER_URL = ''; // 例如: 'https://music-api-proxy.your-name.workers.dev'

// ── State ──
const state = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  mode: 'loop',
  audio: new Audio(),
  visualizerActive: false,
  audioCtx: null,
  analyser: null,
  searchResults: [],
};

// ── Utilities ──
const $ = (sel) => document.querySelector(sel);
const formatTime = (sec) => {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

function showToast(msg, type = 'error') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showLoading(container) {
  container.innerHTML = '<div class="loading"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div>';
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ══════════════════════════════════════════════════
// API Layer: Worker Mode + JSONP Fallback
// ══════════════════════════════════════════════════

// ── Method 1: Cloudflare Worker (preferred) ──
async function searchViaWorker(keyword) {
  const resp = await fetch(`${WORKER_URL}/api/search?q=${encodeURIComponent(keyword)}&limit=30`);
  if (!resp.ok) throw new Error('Worker request failed');
  const data = await resp.json();
  return (data.songs || []).map(s => ({
    id: s.id,
    name: s.name,
    artist: s.artist,
    album: s.album || '',
    cover: s.cover || '',
    duration: s.duration || 0,
    url: '',
    source: 'netease',
  }));
}

async function getSongUrlViaWorker(id) {
  const resp = await fetch(`${WORKER_URL}/api/url?id=${id}`);
  if (!resp.ok) return '';
  const data = await resp.json();
  return data.url || '';
}

// ── Method 2: QQ Music JSONP Fallback ──
let jsonpCounter = 0;
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cbName = `__neonbeat_cb_${++jsonpCounter}`;
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP timeout'));
    }, 10000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[cbName];
      const script = document.getElementById(cbName);
      if (script) script.remove();
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    const script = document.createElement('script');
    script.id = cbName;
    script.src = url.includes('?') ? `${url}&callback=${cbName}` : `${url}?callback=${cbName}`;
    script.onerror = () => { cleanup(); reject(new Error('JSONP error')); };
    document.head.appendChild(script);
  });
}

async function searchViaQQMusic(keyword) {
  const url = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&format=jsonp&limit=30`;
  const data = await jsonp(url);

  const songs = (data?.data?.song?.list || []).map(s => ({
    id: s.songmid,
    name: s.songname || 'Unknown',
    artist: (s.singer || []).map(a => a.name).join('/') || 'Unknown',
    album: s.albumname || '',
    cover: s.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${s.albummid}.jpg` : '',
    duration: s.interval || 0,
    url: '',
    source: 'qq',
    mediaMid: s.strMediaMid || s.media_mid || '',
  }));

  return songs;
}

// ── Get playback URL ──
async function getPlaybackUrl(song) {
  // Method 1: Worker
  if (WORKER_URL && song.source === 'netease') {
    try {
      const url = await getSongUrlViaWorker(song.id);
      if (url) return url;
    } catch (e) { console.log('Worker URL failed:', e); }
  }

  // Method 2: NeteaseCloudMusic outer URL (follows redirect to MP3)
  if (song.source === 'netease') {
    return `https://music.163.com/song/media/outer/url?id=${song.id}.mp3`;
  }

  // Method 3: QQ Music via Meting API
  if (song.source === 'qq') {
    try {
      // Try Meting API to get NeteaseCloudMusic equivalent
      const resp = await fetch(`https://api.injahow.cn/meting/?server=tencent&type=song&id=${song.id}`);
      const data = await resp.json();
      if (data && data[0]?.url) {
        // The URL points to Meting API which redirects to MP3
        return data[0].url;
      }
    } catch (e) { console.log('Meting API failed:', e); }

    // Fallback: try QQ Music direct stream
    return `https://api.injahow.cn/meting/?server=tencent&type=url&id=${song.id}`;
  }

  return '';
}

// ── Main search function ──
async function searchMusic(keyword) {
  // Try Worker first
  if (WORKER_URL) {
    try {
      return await searchViaWorker(keyword);
    } catch (e) {
      console.log('Worker search failed, falling back to QQ Music:', e);
    }
  }

  // Fallback: QQ Music JSONP
  try {
    return await searchViaQQMusic(keyword);
  } catch (e) {
    console.log('QQ Music search failed:', e);
    showToast('搜索失败，请检查网络');
    return [];
  }
}

// ══════════════════════════════════════════════════
// UI & Playback
// ══════════════════════════════════════════════════

const dom = {
  searchInput: $('#searchInput'),
  searchBtn: $('#searchBtn'),
  resultsList: $('#resultsList'),
  resultCount: $('#resultCount'),
  playlist: $('#playlist'),
  clearPlaylist: $('#clearPlaylist'),
  playBtn: $('#playBtn'),
  prevBtn: $('#prevBtn'),
  nextBtn: $('#nextBtn'),
  modeBtn: $('#modeBtn'),
  trackName: $('#trackName'),
  trackArtist: $('#trackArtist'),
  albumArt: $('#albumArt'),
  currentTime: $('#currentTime'),
  duration: $('#duration'),
  progressBar: $('#progressBar'),
  progressFill: $('#progressFill'),
  progressGlow: $('#progressGlow'),
  volumeSlider: $('#volumeSlider'),
  volIcon: $('#volIcon'),
  playerBar: $('#playerBar'),
  visualizer: $('#visualizer'),
};

// ── Search Handler ──
async function handleSearch() {
  const keyword = dom.searchInput.value.trim();
  if (!keyword) return;

  showLoading(dom.resultsList);
  dom.resultCount.textContent = 'SCANNING...';

  const results = await searchMusic(keyword);
  state.searchResults = results;

  if (results.length === 0) {
    dom.resultsList.innerHTML = '<div class="empty-state"><div class="empty-icon">∅</div><p>未找到匹配结果</p><p class="empty-sub">尝试其他关键词</p></div>';
    dom.resultCount.textContent = '';
    return;
  }

  dom.resultCount.textContent = `${results.length} RESULTS`;
  renderResults(results);
}

function renderResults(songs) {
  dom.resultsList.innerHTML = songs.map((song, i) => `
    <div class="song-item" data-index="${i}">
      <span class="song-index">${String(i + 1).padStart(2, '0')}</span>
      <div class="song-cover">${song.cover ? `<img src="${song.cover}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='♫'">` : '♫'}</div>
      <div class="song-meta">
        <div class="song-name">${escapeHtml(song.name)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}${song.album ? ' · ' + escapeHtml(song.album) : ''}</div>
      </div>
      <span class="song-duration">${formatTime(song.duration)}</span>
      <div class="song-actions">
        <button class="btn-action play-action" data-action="play" title="播放">▶</button>
        <button class="btn-action" data-action="add" title="添加到列表">+</button>
      </div>
    </div>
  `).join('');

  dom.resultsList.querySelectorAll('.song-item').forEach(item => {
    const idx = parseInt(item.dataset.index);
    item.addEventListener('dblclick', () => playFromResults(idx));
    item.querySelector('[data-action="play"]')?.addEventListener('click', (e) => { e.stopPropagation(); playFromResults(idx); });
    item.querySelector('[data-action="add"]')?.addEventListener('click', (e) => { e.stopPropagation(); addToPlaylist(songs[idx]); });
  });
}

async function playFromResults(index) {
  const song = state.searchResults[index];
  if (!song) return;

  const existingIdx = state.playlist.findIndex(s => s.id === song.id);
  if (existingIdx === -1) {
    state.playlist.push(song);
    renderPlaylist();
  }

  const playIdx = existingIdx !== -1 ? existingIdx : state.playlist.length - 1;
  await playSong(playIdx);
}

function addToPlaylist(song) {
  if (state.playlist.find(s => s.id === song.id)) {
    showToast('已在播放列表中', 'success');
    return;
  }
  state.playlist.push(song);
  renderPlaylist();
  showToast(`已添加: ${song.name}`, 'success');
}

// ── Playlist ──
function renderPlaylist() {
  if (state.playlist.length === 0) {
    dom.playlist.innerHTML = '<div class="empty-state"><div class="empty-icon">♫</div><p>播放列表为空</p><p class="empty-sub">搜索并点击歌曲添加到列表</p></div>';
    return;
  }

  dom.playlist.innerHTML = state.playlist.map((song, i) => `
    <div class="song-item ${i === state.currentIndex ? 'playing' : ''}" data-index="${i}">
      <span class="song-index">${i === state.currentIndex && state.isPlaying ? '♪' : String(i + 1).padStart(2, '0')}</span>
      <div class="song-cover">${song.cover ? `<img src="${song.cover}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='♫'">` : '♫'}</div>
      <div class="song-meta">
        <div class="song-name">${escapeHtml(song.name)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}</div>
      </div>
      <div class="song-actions"><button class="btn-action" data-action="remove" title="移除">✕</button></div>
    </div>
  `).join('');

  dom.playlist.querySelectorAll('.song-item').forEach(item => {
    const idx = parseInt(item.dataset.index);
    item.addEventListener('dblclick', () => playSong(idx));
    item.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => { e.stopPropagation(); removeFromPlaylist(idx); });
  });
}

function removeFromPlaylist(index) {
  if (index === state.currentIndex) stopPlayback();
  else if (index < state.currentIndex) state.currentIndex--;
  state.playlist.splice(index, 1);
  renderPlaylist();
}

// ── Playback ──
async function playSong(index) {
  if (index < 0 || index >= state.playlist.length) return;

  const song = state.playlist[index];
  state.currentIndex = index;

  dom.trackName.textContent = song.name;
  dom.trackArtist.textContent = song.artist;
  if (song.cover) {
    dom.albumArt.innerHTML = `<img src="${song.cover}" alt="">`;
    dom.albumArt.classList.add('spinning');
  } else {
    dom.albumArt.innerHTML = '<div class="album-placeholder">♫</div>';
    dom.albumArt.classList.remove('spinning');
  }
  renderPlaylist();

  showToast('获取播放链接...');
  const url = await getPlaybackUrl(song);
  if (!url) {
    showToast('无法获取播放链接');
    return;
  }

  state.audio.src = url;
  state.audio.volume = dom.volumeSlider.value / 100;

  try {
    await state.audio.play();
    state.isPlaying = true;
    dom.playBtn.textContent = '⏸';
    showToast(`♪ ${song.name}`, 'success');
    initVisualizer();
  } catch (err) {
    console.error('Play error:', err);
    showToast('播放失败');
  }
}

function togglePlay() {
  if (state.playlist.length === 0) return;
  if (state.isPlaying) {
    state.audio.pause();
    state.isPlaying = false;
    dom.playBtn.textContent = '▶';
    dom.albumArt.classList.remove('spinning');
  } else {
    state.audio.play().catch(() => {});
    state.isPlaying = true;
    dom.playBtn.textContent = '⏸';
    dom.albumArt.classList.add('spinning');
  }
}

function playNext() {
  if (state.playlist.length === 0) return;
  const nextIdx = state.mode === 'shuffle'
    ? Math.floor(Math.random() * state.playlist.length)
    : (state.currentIndex + 1) % state.playlist.length;
  playSong(nextIdx);
}

function playPrev() {
  if (state.playlist.length === 0) return;
  const prevIdx = state.mode === 'shuffle'
    ? Math.floor(Math.random() * state.playlist.length)
    : (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
  playSong(prevIdx);
}

function stopPlayback() {
  state.audio.pause();
  state.audio.currentTime = 0;
  state.isPlaying = false;
  dom.playBtn.textContent = '▶';
  dom.trackName.textContent = '未播放';
  dom.trackArtist.textContent = '--';
  dom.progressFill.style.width = '0%';
  dom.currentTime.textContent = '0:00';
  dom.duration.textContent = '0:00';
  dom.albumArt.innerHTML = '<div class="album-placeholder">♫</div>';
  dom.albumArt.classList.remove('spinning');
}

function cycleMode() {
  const modes = ['loop', 'single', 'shuffle'];
  const labels = { loop: '🔁', single: '🔂', shuffle: '🔀' };
  state.mode = modes[(modes.indexOf(state.mode) + 1) % 3];
  dom.modeBtn.textContent = labels[state.mode];
  showToast({ loop: '列表循环', single: '单曲循环', shuffle: '随机播放' }[state.mode], 'success');
}

// ── Audio Events ──
state.audio.addEventListener('timeupdate', () => {
  const { currentTime, duration } = state.audio;
  if (duration) {
    dom.progressFill.style.width = (currentTime / duration * 100) + '%';
    dom.currentTime.textContent = formatTime(currentTime);
    dom.duration.textContent = formatTime(duration);
  }
});

state.audio.addEventListener('ended', () => {
  if (state.mode === 'single') { state.audio.currentTime = 0; state.audio.play(); }
  else playNext();
});

state.audio.addEventListener('error', (e) => {
  console.error('Audio error:', e);
  showToast('播放出错，跳过');
  setTimeout(playNext, 1500);
});

// ── Progress Bar ──
dom.progressBar.addEventListener('click', (e) => {
  const rect = dom.progressBar.getBoundingClientRect();
  if (state.audio.duration) state.audio.currentTime = ((e.clientX - rect.left) / rect.width) * state.audio.duration;
});

// ── Volume ──
dom.volumeSlider.addEventListener('input', () => {
  state.audio.volume = dom.volumeSlider.value / 100;
  updateVolIcon();
});

dom.volIcon.addEventListener('click', () => {
  if (state.audio.volume > 0) {
    state.audio._prevVol = state.audio.volume;
    state.audio.volume = 0;
    dom.volumeSlider.value = 0;
  } else {
    state.audio.volume = state.audio._prevVol || 0.8;
    dom.volumeSlider.value = state.audio.volume * 100;
  }
  updateVolIcon();
});

function updateVolIcon() {
  const v = state.audio.volume;
  dom.volIcon.textContent = v === 0 ? '🔇' : v < 0.3 ? '🔈' : v < 0.7 ? '🔉' : '🔊';
}

// ── Visualizer ──
function initVisualizer() {
  if (state.visualizerActive) return;
  try {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser = state.audioCtx.createAnalyser();
    const source = state.audioCtx.createMediaElementSource(state.audio);
    source.connect(state.analyser);
    state.analyser.connect(state.audioCtx.destination);
    state.analyser.fftSize = 256;
    state.visualizerActive = true;
    drawVisualizer();
  } catch (e) { console.log('Visualizer N/A'); }
}

function drawVisualizer() {
  if (!state.visualizerActive) return;
  requestAnimationFrame(drawVisualizer);
  const canvas = dom.visualizer;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = 60;
  const bufLen = state.analyser.frequencyBinCount;
  const data = new Uint8Array(bufLen);
  state.analyser.getByteFrequencyData(data);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const barW = (canvas.width / bufLen) * 2.5;
  let x = 0;
  for (let i = 0; i < bufLen; i++) {
    const h = (data[i] / 255) * canvas.height;
    const g = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - h);
    g.addColorStop(0, '#ff2d95');
    g.addColorStop(1, '#00f0ff');
    ctx.fillStyle = g;
    ctx.fillRect(x, canvas.height - h, barW, h);
    x += barW + 1;
  }
}

// ── Keyboard ──
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.code) {
    case 'Space': e.preventDefault(); togglePlay(); break;
    case 'ArrowRight': e.ctrlKey ? playNext() : (state.audio.duration && (state.audio.currentTime = Math.min(state.audio.currentTime + 5, state.audio.duration))); break;
    case 'ArrowLeft': e.ctrlKey ? playPrev() : (state.audio.currentTime = Math.max(state.audio.currentTime - 5, 0)); break;
    case 'ArrowUp': e.preventDefault(); dom.volumeSlider.value = Math.min(100, +dom.volumeSlider.value + 5); state.audio.volume = dom.volumeSlider.value / 100; updateVolIcon(); break;
    case 'ArrowDown': e.preventDefault(); dom.volumeSlider.value = Math.max(0, +dom.volumeSlider.value - 5); state.audio.volume = dom.volumeSlider.value / 100; updateVolIcon(); break;
  }
});

// ── Events ──
dom.searchBtn.addEventListener('click', handleSearch);
dom.searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSearch(); });
dom.playBtn.addEventListener('click', togglePlay);
dom.nextBtn.addEventListener('click', playNext);
dom.prevBtn.addEventListener('click', playPrev);
dom.modeBtn.addEventListener('click', cycleMode);
dom.clearPlaylist.addEventListener('click', () => {
  stopPlayback();
  state.playlist = [];
  state.currentIndex = -1;
  renderPlaylist();
  showToast('播放列表已清空', 'success');
});

document.querySelectorAll('.tag').forEach(tag => {
  tag.addEventListener('click', () => { dom.searchInput.value = tag.dataset.query; handleSearch(); });
});

// ── Init ──
renderPlaylist();
if (!WORKER_URL) {
  console.log('%c NEON BEAT v2 // JSONP Mode ', 'background: #b829dd; color: white; font-size: 12px; padding: 2px 6px;');
} else {
  console.log('%c NEON BEAT v2 // Worker Mode ', 'background: #00f0ff; color: black; font-size: 12px; padding: 2px 6px;');
}

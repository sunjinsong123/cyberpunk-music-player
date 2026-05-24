/* ═══════════════════════════════════════════════════
   NEON BEAT // 赛博音浪 - Application Logic
   ═══════════════════════════════════════════════════ */

// ── State ──
const state = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  mode: 'loop', // loop, single, shuffle
  audio: new Audio(),
  visualizerActive: false,
  audioCtx: null,
  analyser: null,
};

// ── API (NeteaseCloudMusic via public proxy) ──
const API_BASE = 'https://api.injahow.cn/meting/';

async function searchMusic(keyword) {
  try {
    const res = await fetch(`${API_BASE}?type=search&source=netease&s=${encodeURIComponent(keyword)}`);
    if (!res.ok) throw new Error('API request failed');
    const data = await res.json();
    return (data || []).map(item => ({
      id: item.id,
      name: item.name || item.title || 'Unknown',
      artist: item.artist || item.author || 'Unknown',
      album: item.album || item.album_name || '',
      cover: item.pic || item.cover || '',
      duration: item.duration || 0,
      url: item.url || '',
      lrc: item.lrc || '',
    }));
  } catch (err) {
    console.error('Search error:', err);
    // Fallback: try alternative API
    return searchMusicFallback(keyword);
  }
}

async function searchMusicFallback(keyword) {
  try {
    const res = await fetch(`https://music.qier222.com/api/search?keywords=${encodeURIComponent(keyword)}&limit=30`);
    if (!res.ok) throw new Error('Fallback API failed');
    const data = await res.json();
    const songs = data?.result?.songs || [];
    return songs.map(item => ({
      id: item.id,
      name: item.name || 'Unknown',
      artist: (item.artists || []).map(a => a.name).join('/') || 'Unknown',
      album: item.album?.name || '',
      cover: item.album?.artist?.img1v1Url || '',
      duration: Math.floor((item.duration || 0) / 1000),
      url: '',
      lrc: '',
    }));
  } catch (err) {
    console.error('Fallback search error:', err);
    return [];
  }
}

async function getSongUrl(id) {
  try {
    const res = await fetch(`${API_BASE}?type=url&id=${id}`);
    if (!res.ok) throw new Error('URL fetch failed');
    const data = await res.json();
    if (data && data.url) return data.url;
    // Try direct format
    if (typeof data === 'string') return data;
    if (Array.isArray(data) && data[0]?.url) return data[0].url;
    return '';
  } catch (err) {
    console.error('Get URL error:', err);
    return '';
  }
}

async function getSongDetail(id) {
  try {
    const res = await fetch(`${API_BASE}?type=song&id=${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data[0]) return data[0];
    if (data && data.name) return data;
    return null;
  } catch {
    return null;
  }
}

// ── DOM References ──
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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

// ── Utilities ──
function formatTime(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
  container.innerHTML = `
    <div class="loading">
      <div class="loading-dot"></div>
      <div class="loading-dot"></div>
      <div class="loading-dot"></div>
    </div>
  `;
}

// ── Search ──
let searchTimeout = null;

async function handleSearch() {
  const keyword = dom.searchInput.value.trim();
  if (!keyword) return;

  showLoading(dom.resultsList);
  dom.resultCount.textContent = 'SCANNING...';

  const results = await searchMusic(keyword);

  if (results.length === 0) {
    dom.resultsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">∅</div>
        <p>未找到匹配结果</p>
        <p class="empty-sub">尝试其他关键词</p>
      </div>
    `;
    dom.resultCount.textContent = '';
    return;
  }

  dom.resultCount.textContent = `${results.length} RESULTS`;
  renderResults(results);
}

function renderResults(songs) {
  dom.resultsList.innerHTML = songs.map((song, i) => `
    <div class="song-item" data-index="${i}" data-id="${song.id}">
      <span class="song-index">${String(i + 1).padStart(2, '0')}</span>
      <div class="song-cover">
        ${song.cover ? `<img src="${song.cover}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='♫'">` : '♫'}
      </div>
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

  // Store search results temporarily
  dom.resultsList._songs = songs;

  // Click handlers
  dom.resultsList.querySelectorAll('.song-item').forEach(item => {
    item.addEventListener('dblclick', () => {
      const idx = parseInt(item.dataset.index);
      playSongFromResults(idx);
    });

    item.querySelector('[data-action="play"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.index);
      playSongFromResults(idx);
    });

    item.querySelector('[data-action="add"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.index);
      addToPlaylist(songs[idx]);
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function playSongFromResults(index) {
  const songs = dom.resultsList._songs;
  if (!songs || !songs[index]) return;

  const song = songs[index];

  // Add to playlist if not exists
  const existingIdx = state.playlist.findIndex(s => s.id === song.id);
  if (existingIdx === -1) {
    state.playlist.push(song);
    renderPlaylist();
  }

  // Play
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
    dom.playlist.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">♫</div>
        <p>播放列表为空</p>
        <p class="empty-sub">搜索并点击歌曲添加到列表</p>
      </div>
    `;
    return;
  }

  dom.playlist.innerHTML = state.playlist.map((song, i) => `
    <div class="song-item ${i === state.currentIndex ? 'playing' : ''}" data-index="${i}">
      <span class="song-index">${i === state.currentIndex && state.isPlaying ? '♪' : String(i + 1).padStart(2, '0')}</span>
      <div class="song-cover">
        ${song.cover ? `<img src="${song.cover}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='♫'">` : '♫'}
      </div>
      <div class="song-meta">
        <div class="song-name">${escapeHtml(song.name)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}</div>
      </div>
      <div class="song-actions">
        <button class="btn-action" data-action="remove" title="移除">✕</button>
      </div>
    </div>
  `).join('');

  dom.playlist.querySelectorAll('.song-item').forEach(item => {
    item.addEventListener('dblclick', () => {
      playSong(parseInt(item.dataset.index));
    });

    item.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(item.dataset.index);
      removeFromPlaylist(idx);
    });
  });
}

function removeFromPlaylist(index) {
  if (index === state.currentIndex) {
    stopPlayback();
  } else if (index < state.currentIndex) {
    state.currentIndex--;
  }
  state.playlist.splice(index, 1);
  renderPlaylist();
}

// ── Playback ──
async function playSong(index) {
  if (index < 0 || index >= state.playlist.length) return;

  const song = state.playlist[index];
  state.currentIndex = index;

  // Update UI
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

  // Get song URL
  let url = song.url;
  if (!url) {
    showToast('获取播放链接...');
    url = await getSongUrl(song.id);
    song.url = url;
  }

  if (!url) {
    showToast('无法获取播放链接，尝试下一首');
    return;
  }

  state.audio.src = url;
  state.audio.volume = dom.volumeSlider.value / 100;

  try {
    await state.audio.play();
    state.isPlaying = true;
    dom.playBtn.textContent = '⏸';
    initVisualizer();
  } catch (err) {
    console.error('Play error:', err);
    showToast('播放失败: ' + err.message);
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

  let nextIdx;
  if (state.mode === 'shuffle') {
    nextIdx = Math.floor(Math.random() * state.playlist.length);
  } else {
    nextIdx = (state.currentIndex + 1) % state.playlist.length;
  }
  playSong(nextIdx);
}

function playPrev() {
  if (state.playlist.length === 0) return;

  let prevIdx;
  if (state.mode === 'shuffle') {
    prevIdx = Math.floor(Math.random() * state.playlist.length);
  } else {
    prevIdx = (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
  }
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
  const idx = modes.indexOf(state.mode);
  state.mode = modes[(idx + 1) % modes.length];
  dom.modeBtn.textContent = labels[state.mode];
  dom.modeBtn.title = { loop: '列表循环', single: '单曲循环', shuffle: '随机播放' }[state.mode];
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
  if (state.mode === 'single') {
    state.audio.currentTime = 0;
    state.audio.play();
  } else {
    playNext();
  }
});

state.audio.addEventListener('error', (e) => {
  console.error('Audio error:', e);
  showToast('播放出错，跳过');
  setTimeout(playNext, 1000);
});

// ── Progress Bar Click ──
dom.progressBar.addEventListener('click', (e) => {
  const rect = dom.progressBar.getBoundingClientRect();
  const percent = (e.clientX - rect.left) / rect.width;
  if (state.audio.duration) {
    state.audio.currentTime = percent * state.audio.duration;
  }
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

// ── Audio Visualizer ──
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
  } catch (err) {
    console.log('Visualizer not available:', err);
  }
}

function drawVisualizer() {
  if (!state.visualizerActive) return;
  requestAnimationFrame(drawVisualizer);

  const canvas = dom.visualizer;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = 60;

  const bufferLength = state.analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  state.analyser.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const barWidth = (canvas.width / bufferLength) * 2.5;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const barHeight = (dataArray[i] / 255) * canvas.height;
    const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
    gradient.addColorStop(0, '#ff2d95');
    gradient.addColorStop(1, '#00f0ff');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
}

// ── Keyboard Shortcuts ──
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowRight':
      if (e.ctrlKey) playNext();
      else if (state.audio.duration) state.audio.currentTime = Math.min(state.audio.currentTime + 5, state.audio.duration);
      break;
    case 'ArrowLeft':
      if (e.ctrlKey) playPrev();
      else state.audio.currentTime = Math.max(state.audio.currentTime - 5, 0);
      break;
    case 'ArrowUp':
      e.preventDefault();
      dom.volumeSlider.value = Math.min(100, parseInt(dom.volumeSlider.value) + 5);
      state.audio.volume = dom.volumeSlider.value / 100;
      updateVolIcon();
      break;
    case 'ArrowDown':
      e.preventDefault();
      dom.volumeSlider.value = Math.max(0, parseInt(dom.volumeSlider.value) - 5);
      state.audio.volume = dom.volumeSlider.value / 100;
      updateVolIcon();
      break;
  }
});

// ── Event Listeners ──
dom.searchBtn.addEventListener('click', handleSearch);
dom.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSearch();
});
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

// Tags
document.querySelectorAll('.tag').forEach(tag => {
  tag.addEventListener('click', () => {
    dom.searchInput.value = tag.dataset.query;
    handleSearch();
  });
});

// ── Init ──
renderPlaylist();
console.log('%c NEON BEAT // 赛博音浪 v2.077 ', 'background: #ff2d95; color: white; font-size: 14px; padding: 4px 8px; border-radius: 2px;');

/* ═══════════════════════════════════════════════════
   NEON BEAT // 赛博音浪 - Application Logic v4
   支持本地完整音频、同源音乐库、歌词详情和频谱律动。
   ═══════════════════════════════════════════════════ */

// ── Config ──
const WORKER_URL = '';
const SEARCH_LIMIT = 30;
const ITUNES_SEARCH_ENDPOINT = 'https://itunes.apple.com/search';
const LRCLIB_SEARCH_ENDPOINT = 'https://lrclib.net/api/search';
const LOCAL_LIBRARY_URL = './music-library.json';

// ── State ──
const audio = new Audio();
audio.preload = 'metadata';
audio.crossOrigin = 'anonymous';

const state = {
  playlist: [],
  currentIndex: -1,
  isPlaying: false,
  isLoadingTrack: false,
  isSearching: false,
  mode: 'loop',
  audio,
  visualizerActive: false,
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  searchResults: [],
  activePlayToken: 0,
  localLibrary: [],
  localLyrics: new Map(),
  selectedSongId: '',
  currentLyricIndex: -1,
  beatLevel: 0,
};

// ── Utilities ──
const $ = (sel) => document.querySelector(sel);

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
  trackInfo: document.querySelector('.track-info'),
  currentTime: $('#currentTime'),
  duration: $('#duration'),
  progressBar: $('#progressBar'),
  progressFill: $('#progressFill'),
  progressGlow: $('#progressGlow'),
  volumeSlider: $('#volumeSlider'),
  volIcon: $('#volIcon'),
  visualizer: $('#visualizer'),
  detailPanel: $('#detailPanel'),
  detailHint: $('#detailHint'),
  importAudioBtn: $('#importAudioBtn'),
  importLyricsBtn: $('#importLyricsBtn'),
  focusCurrentBtn: $('#focusCurrentBtn'),
  audioFileInput: $('#audioFileInput'),
  lyricsFileInput: $('#lyricsFileInput'),
};

function formatTime(sec) {
  if (!sec || Number.isNaN(sec) || sec < 0) return '0:00';
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
  container.innerHTML = '<div class="loading"><div class="loading-dot"></div><div class="loading-dot"></div><div class="loading-dot"></div></div>';
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text ?? '';
  return d.innerHTML;
}

function buildUrl(base, params) {
  const url = new URL(base);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function normalizeArtwork(url) {
  if (!url) return '';
  return url.replace(/\/\d+x\d+bb\./, '/600x600bb.');
}

function removeExtension(name) {
  return name.replace(/\.[^.]+$/, '');
}

function toSongId(source, rawId) {
  return `${source}:${rawId}`;
}

function makeSongKey(song) {
  return `${(song.name || '').trim().toLowerCase()}__${(song.artist || '').trim().toLowerCase()}`;
}

function getLyricsMatchKey(song) {
  return `${(song.artist || '').trim().toLowerCase()} - ${(song.name || '').trim().toLowerCase()}`;
}

function dedupeSongs(songs) {
  const seen = new Set();
  return songs.filter((song) => {
    const key = makeSongKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function updateSearchButton() {
  dom.searchBtn.disabled = state.isSearching;
  dom.searchBtn.innerHTML = `<span>${state.isSearching ? 'SCANNING...' : 'SCAN'}</span>`;
}

function setProgress(current = 0, duration = 0) {
  const percent = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  dom.progressFill.style.width = `${percent}%`;
  dom.progressGlow.style.left = `calc(${percent}% - 4px)`;
  dom.currentTime.textContent = formatTime(current);
  dom.duration.textContent = formatTime(duration);
}

function updateBeatUi(level) {
  const normalized = Math.max(0, Math.min(1, level));
  state.beatLevel = normalized;
  document.documentElement.style.setProperty('--beat-level', normalized.toFixed(3));
  document.documentElement.style.setProperty('--beat-scale', (1 + normalized * 0.12).toFixed(3));
}

function setPlayerMeta(song) {
  if (!song) {
    dom.trackName.textContent = '未播放';
    dom.trackArtist.textContent = '--';
    dom.albumArt.innerHTML = '<div class="album-placeholder">♫</div>';
    dom.albumArt.classList.remove('spinning');
    dom.detailHint.textContent = '点击歌曲查看详情';
    return;
  }

  dom.trackName.textContent = song.name;
  dom.trackArtist.textContent = song.previewOnly ? `${song.artist} · 试听版` : `${song.artist} · 完整版`;

  if (song.cover) {
    dom.albumArt.innerHTML = `<img src="${song.cover}" alt="">`;
  } else {
    dom.albumArt.innerHTML = '<div class="album-placeholder">♫</div>';
  }

  dom.albumArt.classList.toggle('spinning', state.isPlaying);
  dom.detailHint.textContent = `${song.sourceLabel}${song.previewOnly ? ' / PREVIEW' : ' / FULL'}`;
}

function getCurrentSong() {
  return state.playlist[state.currentIndex] || null;
}

function parseFileName(fileName) {
  const cleanName = removeExtension(fileName).replace(/[_]+/g, ' ').trim();
  const separators = [' - ', ' — ', ' – ', '｜', '|'];

  for (const separator of separators) {
    if (cleanName.includes(separator)) {
      const [artist, ...rest] = cleanName.split(separator);
      const title = rest.join(separator).trim();
      if (artist.trim() && title) {
        return { artist: artist.trim(), title };
      }
    }
  }

  return { artist: '本地文件', title: cleanName };
}

function parseLrc(rawText) {
  const text = (rawText || '').replace(/\r/g, '').trim();
  if (!text) return { rawText: '', lines: [], isSynced: false };

  const rows = text.split('\n');
  const lines = [];
  let hasTimestamp = false;

  rows.forEach((row) => {
    const timestamps = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const content = row.replace(/\[[^\]]+\]/g, '').trim();

    if (!timestamps.length) {
      if (content) {
        lines.push({ time: null, text: content });
      }
      return;
    }

    hasTimestamp = true;
    timestamps.forEach((match) => {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const millis = Number((match[3] || '0').padEnd(3, '0'));
      lines.push({
        time: min * 60 + sec + millis / 1000,
        text: content || '…',
      });
    });
  });

  lines.sort((a, b) => {
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return a.time - b.time;
  });

  return {
    rawText: text,
    lines,
    isSynced: hasTimestamp,
  };
}

function setSongLyrics(song, rawText, sourceLabel) {
  const parsed = parseLrc(rawText);
  song.lyricsRaw = parsed.rawText;
  song.lyrics = parsed.lines;
  song.lyricsSynced = parsed.isSynced;
  song.lyricsLoaded = true;
  song.lyricsSource = sourceLabel;
}

function formatLyricsSource(song) {
  if (!song) return '';
  if (song.lyricsSource) return song.lyricsSource;
  return song.previewOnly ? '未加载歌词' : '等待歌词';
}

function renderDetail(song = getSelectedSong()) {
  if (!song) {
    dom.detailPanel.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">◎</div>
        <p>尚未选择歌曲</p>
        <p class="empty-sub">点击搜索结果、播放列表或底部当前歌曲查看歌词与详情</p>
      </div>
    `;
    return;
  }

  const currentSong = getCurrentSong();
  const isCurrent = currentSong?.id === song.id;
  const badges = [
    `<span class="detail-badge">${escapeHtml(song.sourceLabel)}</span>`,
    `<span class="detail-badge ${song.previewOnly ? 'warning' : 'success'}">${song.previewOnly ? '试听' : '完整版'}</span>`,
    song.album ? `<span class="detail-badge">${escapeHtml(song.album)}</span>` : '',
  ].filter(Boolean).join('');

  const lyricsMarkup = renderLyricsMarkup(song, isCurrent ? state.currentLyricIndex : -1);

  dom.detailPanel.innerHTML = `
    <div class="detail-card ${isCurrent ? 'live' : ''}">
      <div class="detail-hero">
        <div class="detail-cover ${state.isPlaying && isCurrent ? 'active' : ''}">
          ${song.cover ? `<img src="${song.cover}" alt="">` : '<div class="detail-cover-fallback">♫</div>'}
          <div class="detail-cover-glow"></div>
        </div>
        <div class="detail-meta">
          <div class="detail-title">${escapeHtml(song.name)}</div>
          <div class="detail-artist">${escapeHtml(song.artist)}</div>
          <div class="detail-badges">${badges}</div>
          <div class="detail-stats">
            <div class="detail-stat"><span>时长</span><strong>${formatTime(song.duration || 0)}</strong></div>
            <div class="detail-stat"><span>歌词</span><strong>${escapeHtml(formatLyricsSource(song))}</strong></div>
          </div>
          <div class="detail-actions">
            <button class="btn-tool detail-action" data-action="play-current">${isCurrent && state.isPlaying ? 'PAUSE' : 'PLAY'}</button>
            <button class="btn-tool detail-action" data-action="queue-song">QUEUE</button>
          </div>
        </div>
      </div>
      <div class="lyrics-panel" id="lyricsPanel">
        <div class="lyrics-header">
          <span>LYRICS STREAM</span>
          <span class="lyrics-meta">${song.lyricsSynced ? 'SYNC' : song.lyricsLoaded ? 'TEXT' : 'LOADING'}</span>
        </div>
        <div class="lyrics-list" id="lyricsList">${lyricsMarkup}</div>
      </div>
    </div>
  `;

  dom.detailPanel.querySelector('[data-action="play-current"]')?.addEventListener('click', () => {
    const targetIndex = state.playlist.findIndex((item) => item.id === song.id);
    if (isCurrent) {
      togglePlay();
    } else if (targetIndex !== -1) {
      playSong(targetIndex);
    } else {
      state.playlist.push({ ...song });
      renderPlaylist();
      playSong(state.playlist.length - 1);
    }
  });

  dom.detailPanel.querySelector('[data-action="queue-song"]')?.addEventListener('click', () => {
    if (state.playlist.find((item) => item.id === song.id)) {
      showToast('已在播放列表中', 'success');
      return;
    }
    state.playlist.push({ ...song });
    renderPlaylist();
    showToast(`已加入播放列表: ${song.name}`, 'success');
  });

  if (song.lyricsLoaded && isCurrent) {
    syncLyricsToPlayback(song);
  }
}

function renderLyricsMarkup(song, activeIndex = -1) {
  if (!song.lyricsLoaded) {
    return '<div class="lyrics-empty">歌词加载中...</div>';
  }

  if (!song.lyrics?.length) {
    return '<div class="lyrics-empty">暂无歌词，可导入同名 .lrc 文件补全。</div>';
  }

  return song.lyrics.map((line, index) => `
    <div class="lyric-line ${index === activeIndex ? 'active' : ''}" data-lyric-index="${index}">
      <span class="lyric-time">${line.time === null ? '--:--' : formatTime(line.time)}</span>
      <span class="lyric-text">${escapeHtml(line.text)}</span>
    </div>
  `).join('');
}

function getSelectedSong() {
  if (!state.selectedSongId) return getCurrentSong();
  return [
    ...state.playlist,
    ...state.searchResults,
    ...state.localLibrary,
  ].find((song) => song.id === state.selectedSongId) || getCurrentSong();
}

function openSongDetail(song) {
  if (!song) return;
  state.selectedSongId = song.id;
  renderDetail(song);
  ensureLyrics(song).then(() => {
    if (state.selectedSongId === song.id) {
      renderDetail(song);
    }
  }).catch((err) => {
    console.error('Lyrics load failed:', err);
  });
}

function syncPlaybackUi() {
  dom.playBtn.textContent = state.isLoadingTrack ? '…' : state.isPlaying ? '⏸' : '▶';
  const currentSong = getCurrentSong();
  dom.albumArt.classList.toggle('spinning', Boolean(currentSong && state.isPlaying && currentSong.cover));
  renderPlaylist();

  const detailSong = getSelectedSong();
  if (detailSong) {
    renderDetail(detailSong);
  }
}

function stopPlayback(resetPlayer = true) {
  state.activePlayToken += 1;
  state.audio.pause();
  state.audio.removeAttribute('src');
  state.audio.load();
  state.isPlaying = false;
  state.isLoadingTrack = false;
  state.currentLyricIndex = -1;
  setProgress(0, 0);
  updateBeatUi(0);

  if (resetPlayer) {
    state.currentIndex = -1;
    setPlayerMeta(null);
  }

  syncPlaybackUi();
}

function getPlayableSongs(results) {
  return results.filter((song) => Boolean(song.url));
}

function attachLocalLyrics(song) {
  const directKey = (song.lyricsFileKey || '').toLowerCase();
  const searchKeys = [
    directKey,
    getLyricsMatchKey(song),
    (song.fileBaseName || '').toLowerCase(),
  ].filter(Boolean);

  for (const key of searchKeys) {
    if (state.localLyrics.has(key)) {
      setSongLyrics(song, state.localLyrics.get(key), '本地 LRC');
      return true;
    }
  }

  return false;
}

function normalizeLocalSong(input, index = 0) {
  const id = input.id || toSongId('local-manifest', input.rawId || `${index}-${input.name}`);
  const song = {
    id,
    rawId: input.rawId || String(index),
    name: input.name || 'Unknown',
    artist: input.artist || 'Unknown',
    album: input.album || '',
    cover: input.cover || '',
    duration: input.duration || 0,
    url: input.url || '',
    source: input.source || 'local-manifest',
    sourceLabel: input.sourceLabel || (Boolean(input.previewOnly) ? 'Preview' : 'Local Full'),
    previewOnly: Boolean(input.previewOnly),
    lyricsRaw: '',
    lyrics: [],
    lyricsLoaded: false,
    lyricsSynced: false,
    lyricsSource: '',
    lyricsUrl: input.lyricsUrl || '',
    fileBaseName: (input.fileBaseName || `${input.artist || ''} - ${input.name || ''}`).toLowerCase(),
    lyricsFileKey: (input.lyricsFileKey || `${input.artist || ''} - ${input.name || ''}`).toLowerCase(),
  };

  if (input.lyrics) {
    setSongLyrics(song, input.lyrics, '内置歌词');
  } else {
    attachLocalLyrics(song);
  }

  return song;
}

function normalizeITunesSong(track) {
  if (!track?.trackId || !track?.previewUrl) return null;

  return {
    id: toSongId('itunes', track.trackId),
    rawId: String(track.trackId),
    name: track.trackName || 'Unknown',
    artist: track.artistName || 'Unknown',
    album: track.collectionName || '',
    cover: normalizeArtwork(track.artworkUrl100 || track.artworkUrl60 || ''),
    duration: Math.round((track.trackTimeMillis || 0) / 1000),
    url: track.previewUrl,
    source: 'itunes',
    sourceLabel: 'Preview',
    previewOnly: true,
    lyricsRaw: '',
    lyrics: [],
    lyricsLoaded: false,
    lyricsSynced: false,
    lyricsSource: '',
    lyricsUrl: '',
    fileBaseName: '',
    lyricsFileKey: '',
  };
}

// ══════════════════════════════════════════════════
// API Layer
// ══════════════════════════════════════════════════

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Request failed: ${resp.status}`);
  }
  return resp.json();
}

async function searchViaITunes(keyword, country = 'CN') {
  const url = buildUrl(ITUNES_SEARCH_ENDPOINT, {
    term: keyword,
    media: 'music',
    entity: 'song',
    limit: SEARCH_LIMIT,
    country,
    lang: 'zh_cn',
  });

  const data = await fetchJson(url);
  return (data.results || [])
    .map(normalizeITunesSong)
    .filter(Boolean);
}

async function searchViaWorker(keyword) {
  const url = buildUrl(`${WORKER_URL.replace(/\/$/, '')}/api/search`, {
    q: keyword,
    limit: SEARCH_LIMIT,
  });

  const data = await fetchJson(url);
  return (data.songs || []).map((song, index) => normalizeLocalSong({
    ...song,
    source: song.source || 'worker',
    sourceLabel: song.sourceLabel || (song.previewOnly ? 'Worker Preview' : 'Worker Full'),
    previewOnly: Boolean(song.previewOnly),
  }, index));
}

async function getSongUrlViaWorker(song) {
  const url = buildUrl(`${WORKER_URL.replace(/\/$/, '')}/api/url`, {
    id: song.rawId || song.id,
  });
  const data = await fetchJson(url);
  return data.url || '';
}

async function tryLoadLocalLibrary() {
  try {
    const resp = await fetch(LOCAL_LIBRARY_URL, { cache: 'no-store' });
    if (!resp.ok) return;

    const data = await resp.json();
    const songs = Array.isArray(data) ? data : Array.isArray(data.songs) ? data.songs : [];
    const normalized = songs
      .map((song, index) => normalizeLocalSong(song, index))
      .filter((song) => Boolean(song.url));

    state.localLibrary = dedupeSongs([...state.localLibrary, ...normalized]);
  } catch (err) {
    console.log('Local library unavailable:', err.message);
  }
}

function searchLocalLibrary(keyword) {
  const query = keyword.trim().toLowerCase();
  if (!query) return [];

  return state.localLibrary.filter((song) => {
    return [
      song.name,
      song.artist,
      song.album,
      song.sourceLabel,
    ].some((field) => (field || '').toLowerCase().includes(query));
  });
}

async function resolvePlaybackUrl(song) {
  if (song.url) return song.url;

  if (WORKER_URL) {
    try {
      const url = await getSongUrlViaWorker(song);
      if (url) {
        song.url = url;
        return url;
      }
    } catch (err) {
      console.error('Worker playback resolve failed:', err);
    }
  }

  return '';
}

async function searchMusic(keyword) {
  const localResults = searchLocalLibrary(keyword).map((song) => ({ ...song }));
  const resultGroups = [localResults];

  if (WORKER_URL) {
    try {
      const workerResults = getPlayableSongs(await searchViaWorker(keyword));
      if (workerResults.length > 0) {
        resultGroups.push(workerResults);
      }
    } catch (err) {
      console.error('Worker search failed:', err);
    }
  }

  try {
    const cnResults = await searchViaITunes(keyword, 'CN');
    if (cnResults.length > 0) {
      resultGroups.push(cnResults);
    } else {
      resultGroups.push(await searchViaITunes(keyword, 'US'));
    }
  } catch (err) {
    console.error('Preview search failed:', err);
  }

  return dedupeSongs(resultGroups.flat());
}

async function fetchLyricsFromLrcLib(song) {
  const url = buildUrl(LRCLIB_SEARCH_ENDPOINT, {
    track_name: song.name,
    artist_name: song.artist,
    album_name: song.album || '',
  });

  const rows = await fetchJson(url);
  if (!Array.isArray(rows) || rows.length === 0) {
    setSongLyrics(song, '', '暂无歌词');
    return;
  }

  const exact = rows.find((row) => {
    const sameTrack = (row.trackName || '').trim().toLowerCase() === song.name.trim().toLowerCase();
    const sameArtist = (row.artistName || '').trim().toLowerCase().includes(song.artist.trim().toLowerCase());
    return sameTrack && sameArtist;
  }) || rows[0];

  const lyricText = exact.syncedLyrics || exact.plainLyrics || '';
  setSongLyrics(song, lyricText, exact.syncedLyrics ? 'LRC API / Sync' : lyricText ? 'LRC API / Text' : '暂无歌词');
}

async function ensureLyrics(song) {
  if (!song) return;
  if (song.lyricsLoaded) return;
  if (song._lyricsPromise) return song._lyricsPromise;

  song._lyricsPromise = (async () => {
    if (attachLocalLyrics(song)) return;

    if (song.lyricsUrl) {
      try {
        const resp = await fetch(song.lyricsUrl);
        if (resp.ok) {
          setSongLyrics(song, await resp.text(), '歌词文件');
          return;
        }
      } catch (err) {
        console.error('Lyrics URL failed:', err);
      }
    }

    await fetchLyricsFromLrcLib(song);
  })().finally(() => {
    song._lyricsPromise = null;
  });

  return song._lyricsPromise;
}

// ══════════════════════════════════════════════════
// Local Import
// ══════════════════════════════════════════════════

async function getAudioDurationFromFile(file) {
  return new Promise((resolve) => {
    const probe = document.createElement('audio');
    const objectUrl = URL.createObjectURL(file);
    probe.preload = 'metadata';
    probe.src = objectUrl;
    probe.addEventListener('loadedmetadata', () => {
      resolve(Number.isFinite(probe.duration) ? Math.round(probe.duration) : 0);
      URL.revokeObjectURL(objectUrl);
    }, { once: true });
    probe.addEventListener('error', () => {
      resolve(0);
      URL.revokeObjectURL(objectUrl);
    }, { once: true });
  });
}

async function importAudioFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const songs = await Promise.all(files.map(async (file, index) => {
    const meta = parseFileName(file.name);
    const duration = await getAudioDurationFromFile(file);
    const song = normalizeLocalSong({
      id: toSongId('local-file', `${file.name}-${file.size}-${file.lastModified}`),
      rawId: `${file.name}-${file.size}-${file.lastModified}`,
      name: meta.title,
      artist: meta.artist,
      album: '本地导入',
      cover: '',
      duration,
      url: URL.createObjectURL(file),
      source: 'local-file',
      sourceLabel: 'Local Full',
      previewOnly: false,
      fileBaseName: removeExtension(file.name),
      lyricsFileKey: `${meta.artist} - ${meta.title}`,
    }, index);

    attachLocalLyrics(song);
    return song;
  }));

  state.localLibrary = dedupeSongs([...songs, ...state.localLibrary]);
  showToast(`已导入 ${songs.length} 首本地完整音频`, 'success');
}

async function importLyricsFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  await Promise.all(files.map(async (file) => {
    const text = await file.text();
    const baseName = removeExtension(file.name).toLowerCase();
    state.localLyrics.set(baseName, text);

    const parsedName = parseFileName(file.name);
    state.localLyrics.set(`${parsedName.artist.toLowerCase()} - ${parsedName.title.toLowerCase()}`, text);
  }));

  [...state.localLibrary, ...state.playlist].forEach((song) => {
    if (!song.lyricsLoaded) attachLocalLyrics(song);
  });

  const detailSong = getSelectedSong();
  if (detailSong) {
    await ensureLyrics(detailSong);
    renderDetail(detailSong);
  }

  showToast(`已导入 ${files.length} 份歌词`, 'success');
}

// ══════════════════════════════════════════════════
// UI & Playback
// ══════════════════════════════════════════════════

async function handleSearch() {
  const keyword = dom.searchInput.value.trim();
  if (!keyword || state.isSearching) return;

  state.isSearching = true;
  updateSearchButton();
  showLoading(dom.resultsList);
  dom.resultCount.textContent = 'SCANNING...';

  try {
    const results = await searchMusic(keyword);
    state.searchResults = results;

    if (results.length === 0) {
      dom.resultsList.innerHTML = '<div class="empty-state"><div class="empty-icon">∅</div><p>未找到结果</p><p class="empty-sub">可先导入本地完整音频，或尝试其他关键词</p></div>';
      dom.resultCount.textContent = '';
      showToast('没有找到结果');
      return;
    }

    const fullCount = results.filter((song) => !song.previewOnly).length;
    dom.resultCount.textContent = `${results.length} RESULTS / ${fullCount} FULL`;
    renderResults(results);
  } catch (err) {
    console.error('Search failed:', err);
    dom.resultsList.innerHTML = '<div class="empty-state"><div class="empty-icon">!</div><p>搜索失败</p><p class="empty-sub">请检查网络，或直接导入本地音乐调试</p></div>';
    dom.resultCount.textContent = '';
    showToast('搜索失败，请检查网络');
  } finally {
    state.isSearching = false;
    updateSearchButton();
  }
}

function buildSongItemMarkup(song, index, currentIndex = -1) {
  const isCurrent = index === currentIndex;
  return `
    <div class="song-item ${isCurrent ? 'playing' : ''}" data-index="${index}">
      <span class="song-index">${isCurrent && state.isPlaying ? '♪' : String(index + 1).padStart(2, '0')}</span>
      <div class="song-cover">${song.cover ? `<img src="${song.cover}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='♫'">` : '♫'}</div>
      <div class="song-meta">
        <div class="song-name">${escapeHtml(song.name)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}${song.album ? ` · ${escapeHtml(song.album)}` : ''}</div>
        <div class="song-flags">
          <span class="song-flag">${escapeHtml(song.sourceLabel)}</span>
          <span class="song-flag ${song.previewOnly ? 'warning' : 'success'}">${song.previewOnly ? '试听' : '完整'}</span>
        </div>
      </div>
      <span class="song-duration">${formatTime(song.duration)}</span>
      <div class="song-actions">
        <button class="btn-action play-action" data-action="play" title="播放">▶</button>
        <button class="btn-action" data-action="detail" title="详情">◎</button>
      </div>
    </div>
  `;
}

function renderResults(songs) {
  dom.resultsList.innerHTML = songs.map((song, index) => buildSongItemMarkup(song, index)).join('');

  dom.resultsList.querySelectorAll('.song-item').forEach((item) => {
    const idx = Number.parseInt(item.dataset.index, 10);
    item.addEventListener('click', () => openSongDetail(songs[idx]));
    item.addEventListener('dblclick', () => playFromResults(idx));
    item.querySelector('[data-action="play"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      playFromResults(idx);
    });
    item.querySelector('[data-action="detail"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openSongDetail(songs[idx]);
    });
  });
}

async function playFromResults(index) {
  const song = state.searchResults[index];
  if (!song) return;

  const existingIdx = state.playlist.findIndex((item) => item.id === song.id);
  if (existingIdx === -1) {
    state.playlist.push({ ...song });
    renderPlaylist();
  }

  const playIdx = existingIdx !== -1 ? existingIdx : state.playlist.length - 1;
  openSongDetail(state.playlist[playIdx]);
  await playSong(playIdx);
}

function renderPlaylist() {
  if (state.playlist.length === 0) {
    dom.playlist.innerHTML = '<div class="empty-state"><div class="empty-icon">♫</div><p>播放列表为空</p><p class="empty-sub">双击搜索结果播放，单击可查看详情和歌词</p></div>';
    return;
  }

  dom.playlist.innerHTML = state.playlist.map((song, index) => `
    <div class="song-item ${index === state.currentIndex ? 'playing' : ''}" data-index="${index}">
      <span class="song-index">${index === state.currentIndex && state.isPlaying ? '♪' : String(index + 1).padStart(2, '0')}</span>
      <div class="song-cover">${song.cover ? `<img src="${song.cover}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='♫'">` : '♫'}</div>
      <div class="song-meta">
        <div class="song-name">${escapeHtml(song.name)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}</div>
        <div class="song-flags">
          <span class="song-flag">${escapeHtml(song.sourceLabel)}</span>
          <span class="song-flag ${song.previewOnly ? 'warning' : 'success'}">${song.previewOnly ? '试听' : '完整'}</span>
        </div>
      </div>
      <div class="song-actions">
        <button class="btn-action play-action" data-action="play" title="播放">▶</button>
        <button class="btn-action" data-action="detail" title="详情">◎</button>
        <button class="btn-action" data-action="remove" title="移除">✕</button>
      </div>
    </div>
  `).join('');

  dom.playlist.querySelectorAll('.song-item').forEach((item) => {
    const idx = Number.parseInt(item.dataset.index, 10);
    item.addEventListener('click', () => openSongDetail(state.playlist[idx]));
    item.addEventListener('dblclick', () => playSong(idx));
    item.querySelector('[data-action="play"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      playSong(idx);
    });
    item.querySelector('[data-action="detail"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openSongDetail(state.playlist[idx]);
    });
    item.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromPlaylist(idx);
    });
  });
}

function removeFromPlaylist(index) {
  const removingCurrent = index === state.currentIndex;
  state.playlist.splice(index, 1);

  if (removingCurrent) {
    if (state.playlist.length === 0) {
      stopPlayback(true);
      renderPlaylist();
      renderDetail(getSelectedSong());
      return;
    }

    const nextIndex = Math.min(index, state.playlist.length - 1);
    state.currentIndex = -1;
    renderPlaylist();
    playSong(nextIndex);
    return;
  }

  if (index < state.currentIndex) {
    state.currentIndex -= 1;
  }

  renderPlaylist();
}

async function playSong(index) {
  if (index < 0 || index >= state.playlist.length) return;

  const song = state.playlist[index];
  const playToken = ++state.activePlayToken;

  state.currentIndex = index;
  state.isLoadingTrack = true;
  state.isPlaying = false;
  state.currentLyricIndex = -1;
  setPlayerMeta(song);
  openSongDetail(song);
  syncPlaybackUi();
  showToast(`正在加载: ${song.name}`, 'success');

  try {
    await ensureLyrics(song);

    const url = await resolvePlaybackUrl(song);
    if (playToken !== state.activePlayToken) return;
    if (!url) throw new Error('No playable url');

    state.audio.src = url;
    state.audio.volume = dom.volumeSlider.value / 100;
    await state.audio.play();

    if (playToken !== state.activePlayToken) return;
    state.isPlaying = true;
    state.isLoadingTrack = false;
    setPlayerMeta(song);
    syncPlaybackUi();
    showToast(`♪ ${song.name}`, 'success');
    initVisualizer();
  } catch (err) {
    if (playToken !== state.activePlayToken) return;
    console.error('Play error:', err);
    state.isLoadingTrack = false;
    state.isPlaying = false;
    syncPlaybackUi();
    showToast('播放失败，请检查音频文件或切换下一首');
  }
}

function togglePlay() {
  if (state.playlist.length === 0) return;

  if (state.currentIndex === -1) {
    playSong(0);
    return;
  }

  if (state.isPlaying) {
    state.audio.pause();
    return;
  }

  state.audio.play().catch((err) => {
    console.error('Resume failed:', err);
    showToast('继续播放失败');
  });
}

function getNextIndex(direction) {
  if (state.playlist.length === 0) return -1;
  if (state.mode === 'shuffle') {
    return Math.floor(Math.random() * state.playlist.length);
  }

  if (state.currentIndex === -1) {
    return 0;
  }

  if (direction === 'prev') {
    return (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
  }

  return (state.currentIndex + 1) % state.playlist.length;
}

function playNext() {
  const nextIdx = getNextIndex('next');
  if (nextIdx !== -1) playSong(nextIdx);
}

function playPrev() {
  const prevIdx = getNextIndex('prev');
  if (prevIdx !== -1) playSong(prevIdx);
}

function cycleMode() {
  const modes = ['loop', 'single', 'shuffle'];
  const labels = { loop: '🔁', single: '🔂', shuffle: '🔀' };
  const tips = { loop: '列表循环', single: '单曲循环', shuffle: '随机播放' };

  state.mode = modes[(modes.indexOf(state.mode) + 1) % modes.length];
  dom.modeBtn.textContent = labels[state.mode];
  showToast(tips[state.mode], 'success');
}

function syncLyricsToPlayback(song) {
  if (!song?.lyricsSynced || !song.lyrics?.length) return;

  const currentTime = state.audio.currentTime;
  let activeIndex = -1;

  song.lyrics.forEach((line, index) => {
    if (line.time !== null && currentTime >= line.time) {
      activeIndex = index;
    }
  });

  if (activeIndex === state.currentLyricIndex) return;
  state.currentLyricIndex = activeIndex;

  const lyricsList = dom.detailPanel.querySelector('#lyricsList');
  if (!lyricsList) return;

  lyricsList.querySelectorAll('.lyric-line').forEach((line, index) => {
    line.classList.toggle('active', index === activeIndex);
  });

  if (activeIndex >= 0) {
    const activeLine = lyricsList.querySelector(`[data-lyric-index="${activeIndex}"]`);
    activeLine?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

// ── Audio Events ──
state.audio.addEventListener('loadstart', () => {
  if (state.currentIndex !== -1) {
    state.isLoadingTrack = true;
    syncPlaybackUi();
  }
});

state.audio.addEventListener('loadedmetadata', () => {
  const currentSong = getCurrentSong();
  if (currentSong && (!currentSong.duration || currentSong.duration === 0)) {
    currentSong.duration = Math.round(state.audio.duration || 0);
  }
  setProgress(state.audio.currentTime, state.audio.duration);
  syncPlaybackUi();
});

state.audio.addEventListener('timeupdate', () => {
  const currentSong = getCurrentSong();
  setProgress(state.audio.currentTime, state.audio.duration);
  if (currentSong) {
    syncLyricsToPlayback(currentSong);
  }
});

state.audio.addEventListener('waiting', () => {
  if (state.currentIndex !== -1) {
    state.isLoadingTrack = true;
    syncPlaybackUi();
  }
});

state.audio.addEventListener('playing', () => {
  state.isLoadingTrack = false;
  state.isPlaying = true;
  setPlayerMeta(getCurrentSong());
  syncPlaybackUi();
});

state.audio.addEventListener('pause', () => {
  if (!state.audio.ended) {
    state.isPlaying = false;
    state.isLoadingTrack = false;
    setPlayerMeta(getCurrentSong());
    syncPlaybackUi();
  }
});

state.audio.addEventListener('ended', () => {
  if (state.mode === 'single') {
    state.audio.currentTime = 0;
    state.audio.play().catch((err) => {
      console.error('Replay failed:', err);
    });
    return;
  }

  if (state.playlist.length <= 1) {
    state.isPlaying = false;
    state.isLoadingTrack = false;
    syncPlaybackUi();
    return;
  }

  playNext();
});

state.audio.addEventListener('error', (e) => {
  console.error('Audio error:', e);
  state.isLoadingTrack = false;
  state.isPlaying = false;
  syncPlaybackUi();
  showToast('播放出错，切换下一首');

  if (state.playlist.length > 1) {
    setTimeout(() => playNext(), 800);
  }
});

// ── Progress Bar ──
dom.progressBar.addEventListener('click', (e) => {
  const rect = dom.progressBar.getBoundingClientRect();
  if (!state.audio.duration) return;

  const ratio = (e.clientX - rect.left) / rect.width;
  state.audio.currentTime = Math.max(0, Math.min(state.audio.duration, ratio * state.audio.duration));
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
    dom.volumeSlider.value = Math.round(state.audio.volume * 100);
  }
  updateVolIcon();
});

function updateVolIcon() {
  const v = state.audio.volume;
  dom.volIcon.textContent = v === 0 ? '🔇' : v < 0.3 ? '🔈' : v < 0.7 ? '🔉' : '🔊';
}

// ── Visualizer ──
function initVisualizer() {
  if (state.visualizerActive) {
    if (state.audioCtx?.state === 'suspended') {
      state.audioCtx.resume().catch(() => {});
    }
    return;
  }

  try {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.analyser = state.audioCtx.createAnalyser();
    state.sourceNode = state.audioCtx.createMediaElementSource(state.audio);
    state.sourceNode.connect(state.analyser);
    state.analyser.connect(state.audioCtx.destination);
    state.analyser.fftSize = 256;
    state.visualizerActive = true;
    drawVisualizer();
  } catch (err) {
    console.log('Visualizer unavailable:', err);
  }
}

function drawVisualizer() {
  if (!state.visualizerActive || !state.analyser) return;

  requestAnimationFrame(drawVisualizer);

  const canvas = dom.visualizer;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = 96;

  const bufferLength = state.analyser.frequencyBinCount;
  const data = new Uint8Array(bufferLength);
  state.analyser.getByteFrequencyData(data);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let sum = 0;
  for (let i = 0; i < bufferLength; i += 1) {
    sum += data[i];
  }
  updateBeatUi(sum / bufferLength / 255);

  const barWidth = (canvas.width / bufferLength) * 2.4;
  let x = 0;

  for (let i = 0; i < bufferLength; i += 1) {
    const height = (data[i] / 255) * canvas.height;
    const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - height);
    gradient.addColorStop(0, '#ff2d95');
    gradient.addColorStop(0.5, '#00f0ff');
    gradient.addColorStop(1, '#39ff14');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, canvas.height - height, barWidth, height);
    x += barWidth + 1;
  }
}

// ── Keyboard ──
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowRight':
      if (e.ctrlKey) {
        playNext();
      } else if (state.audio.duration) {
        state.audio.currentTime = Math.min(state.audio.currentTime + 5, state.audio.duration);
      }
      break;
    case 'ArrowLeft':
      if (e.ctrlKey) {
        playPrev();
      } else {
        state.audio.currentTime = Math.max(state.audio.currentTime - 5, 0);
      }
      break;
    case 'ArrowUp':
      e.preventDefault();
      dom.volumeSlider.value = Math.min(100, Number(dom.volumeSlider.value) + 5);
      state.audio.volume = dom.volumeSlider.value / 100;
      updateVolIcon();
      break;
    case 'ArrowDown':
      e.preventDefault();
      dom.volumeSlider.value = Math.max(0, Number(dom.volumeSlider.value) - 5);
      state.audio.volume = dom.volumeSlider.value / 100;
      updateVolIcon();
      break;
    default:
      break;
  }
});

// ── Events ──
dom.searchBtn.addEventListener('click', handleSearch);
dom.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleSearch();
});
dom.playBtn.addEventListener('click', togglePlay);
dom.nextBtn.addEventListener('click', playNext);
dom.prevBtn.addEventListener('click', playPrev);
dom.modeBtn.addEventListener('click', cycleMode);
dom.trackInfo.addEventListener('click', () => openSongDetail(getCurrentSong()));
dom.albumArt.addEventListener('click', () => openSongDetail(getCurrentSong()));

dom.clearPlaylist.addEventListener('click', () => {
  stopPlayback(true);
  state.playlist = [];
  renderPlaylist();
  showToast('播放列表已清空', 'success');
});

dom.importAudioBtn.addEventListener('click', () => dom.audioFileInput.click());
dom.importLyricsBtn.addEventListener('click', () => dom.lyricsFileInput.click());
dom.focusCurrentBtn.addEventListener('click', () => openSongDetail(getCurrentSong()));

dom.audioFileInput.addEventListener('change', async (e) => {
  await importAudioFiles(e.target.files);
  e.target.value = '';
});

dom.lyricsFileInput.addEventListener('change', async (e) => {
  await importLyricsFiles(e.target.files);
  e.target.value = '';
});

document.querySelectorAll('.tag').forEach((tag) => {
  tag.addEventListener('click', () => {
    dom.searchInput.value = tag.dataset.query;
    handleSearch();
  });
});

// ── Init ──
async function init() {
  state.audio.volume = dom.volumeSlider.value / 100;
  updateVolIcon();
  setProgress(0, 0);
  setPlayerMeta(null);
  renderPlaylist();
  renderDetail(null);
  updateSearchButton();
  updateBeatUi(0);
  await tryLoadLocalLibrary();

  console.log(
    `%c NEON BEAT v4 // ${WORKER_URL ? 'Worker + Local Full Mode' : 'Local Full + Preview Mode'} `,
    `background: ${WORKER_URL ? '#00f0ff' : '#b829dd'}; color: ${WORKER_URL ? 'black' : 'white'}; font-size: 12px; padding: 2px 6px;`,
  );
}

init();

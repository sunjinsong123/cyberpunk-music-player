// Cloudflare Worker - optional preview proxy
// 默认前端可直连使用；如需统一出口或规避客户端跨域限制，可部署此 Worker。

const ALLOWED_ORIGINS = [
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const ITUNES_SEARCH_ENDPOINT = 'https://itunes.apple.com/search';
const ITUNES_LOOKUP_ENDPOINT = 'https://itunes.apple.com/lookup';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(request.headers.get('Origin')),
      });
    }

    if (url.pathname === '/api/search') {
      return handleSearch(request);
    }

    if (url.pathname === '/api/url') {
      return handleUrlLookup(request);
    }

    if (url.pathname === '/api/health') {
      return jsonResponse({ ok: true, mode: 'itunes-preview-proxy' }, 200, request);
    }

    return jsonResponse(
      { error: 'Not found', endpoints: ['/api/search', '/api/url', '/api/health'] },
      404,
      request,
    );
  },
};

async function handleSearch(request) {
  const incoming = new URL(request.url);
  const q = incoming.searchParams.get('q') || '';
  const limit = incoming.searchParams.get('limit') || '30';
  const country = incoming.searchParams.get('country') || 'CN';

  if (!q.trim()) {
    return jsonResponse({ songs: [] }, 200, request);
  }

  const upstream = new URL(ITUNES_SEARCH_ENDPOINT);
  upstream.searchParams.set('term', q);
  upstream.searchParams.set('media', 'music');
  upstream.searchParams.set('entity', 'song');
  upstream.searchParams.set('limit', limit);
  upstream.searchParams.set('country', country);
  upstream.searchParams.set('lang', 'zh_cn');

  try {
    const resp = await fetch(upstream.toString(), {
      headers: {
        'User-Agent': 'NEON-BEAT-Worker',
      },
    });

    if (!resp.ok) {
      return jsonResponse({ songs: [], error: `upstream ${resp.status}` }, 502, request);
    }

    const data = await resp.json();
    const songs = (data.results || [])
      .filter((track) => track?.trackId && track?.previewUrl)
      .map((track) => ({
        id: `itunes:${track.trackId}`,
        rawId: String(track.trackId),
        name: track.trackName || 'Unknown',
        artist: track.artistName || 'Unknown',
        album: track.collectionName || '',
        cover: normalizeArtwork(track.artworkUrl100 || track.artworkUrl60 || ''),
        duration: Math.round((track.trackTimeMillis || 0) / 1000),
        url: track.previewUrl,
        source: 'itunes',
        sourceLabel: 'iTunes',
        previewOnly: true,
      }));

    return jsonResponse({ songs }, 200, request);
  } catch (err) {
    return jsonResponse({ songs: [], error: err.message }, 500, request);
  }
}

async function handleUrlLookup(request) {
  const incoming = new URL(request.url);
  const rawId = incoming.searchParams.get('id') || '';
  const trackId = rawId.includes(':') ? rawId.split(':').pop() : rawId;

  if (!trackId) {
    return jsonResponse({ url: '' }, 200, request);
  }

  const upstream = new URL(ITUNES_LOOKUP_ENDPOINT);
  upstream.searchParams.set('id', trackId);
  upstream.searchParams.set('entity', 'song');
  upstream.searchParams.set('country', 'CN');

  try {
    const resp = await fetch(upstream.toString(), {
      headers: {
        'User-Agent': 'NEON-BEAT-Worker',
      },
    });

    if (!resp.ok) {
      return jsonResponse({ url: '', error: `upstream ${resp.status}` }, 502, request);
    }

    const data = await resp.json();
    const track = (data.results || []).find((item) => item?.trackId);
    return jsonResponse({ url: track?.previewUrl || '' }, 200, request);
  } catch (err) {
    return jsonResponse({ url: '', error: err.message }, 500, request);
  }
}

function normalizeArtwork(url) {
  if (!url) return '';
  return url.replace(/\/\d+x\d+bb\./, '/600x600bb.');
}

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function jsonResponse(data, status = 200, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(request.headers.get('Origin') || ''),
  });
}

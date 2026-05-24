// Cloudflare Worker - Music API CORS Proxy
// 部署到 Cloudflare Workers（免费）

const ALLOWED_ORIGINS = [
  'https://sunjinsong123.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Search endpoint
    if (url.pathname === '/api/search') {
      const keyword = url.searchParams.get('q') || '';
      const limit = url.searchParams.get('limit') || '30';

      try {
        const resp = await fetch('https://music.163.com/api/search/get/web', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          body: `s=${encodeURIComponent(keyword)}&type=1&limit=${limit}&offset=0`,
        });

        const data = await resp.json();

        const songs = (data?.result?.songs || []).map(s => ({
          id: s.id,
          name: s.name,
          artist: (s.artists || []).map(a => a.name).join('/'),
          album: s.album?.name || '',
          cover: s.album?.artist?.img1v1Url || s.album?.picUrl || '',
          duration: Math.floor((s.duration || 0) / 1000),
        }));

        return jsonResponse({ songs });
      } catch (err) {
        return jsonResponse({ error: err.message, songs: [] }, 500);
      }
    }

    // Song URL endpoint
    if (url.pathname === '/api/url') {
      const id = url.searchParams.get('id');
      try {
        const resp = await fetch(`https://music.163.com/api/song/enhance/player/url?id=${id}&ids=[${id}]&br=320000`, {
          headers: {
            'Referer': 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        const data = await resp.json();
        const songUrl = data?.data?.[0]?.url || '';
        return jsonResponse({ url: songUrl });
      } catch (err) {
        return jsonResponse({ error: err.message, url: '' }, 500);
      }
    }

    // Song detail endpoint
    if (url.pathname === '/api/detail') {
      const id = url.searchParams.get('id');
      try {
        const resp = await fetch(`https://music.163.com/api/song/detail?id=${id}&ids=[${id}]`, {
          headers: {
            'Referer': 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        const data = await resp.json();
        const song = data?.songs?.[0];
        if (song) {
          return jsonResponse({
            id: song.id,
            name: song.name,
            artist: (song.artists || []).map(a => a.name).join('/'),
            album: song.album?.name || '',
            cover: song.album?.picUrl || '',
            duration: Math.floor((song.duration || 0) / 1000),
          });
        }
        return jsonResponse({ error: 'not found' }, 404);
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    // Lyric endpoint
    if (url.pathname === '/api/lyric') {
      const id = url.searchParams.get('id');
      try {
        const resp = await fetch(`https://music.163.com/api/song/lyric?id=${id}&lv=1&tv=1`, {
          headers: {
            'Referer': 'https://music.163.com',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        const data = await resp.json();
        return jsonResponse({ lrc: data?.lrc?.lyric || '' });
      } catch (err) {
        return jsonResponse({ error: err.message, lrc: '' }, 500);
      }
    }

    return jsonResponse({ error: 'Not found', endpoints: ['/api/search', '/api/url', '/api/detail', '/api/lyric'] }, 404);
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

process.env.YTDL_NO_UPDATE = process.env.YTDL_NO_UPDATE || '1';

const express = require('express');
const path = require('path');
const pkg = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CRAWLER_UA =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const ALLOWED_DOWNLOAD_HOSTS = [
  /(?:^|\.)cdninstagram\.com$/i,
  /(?:^|\.)fbcdn\.net$/i,
  /(?:^|\.)twimg\.com$/i,
  /(?:^|\.)googlevideo\.com$/i,
];

// ============================================================
// helpers
// ============================================================

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function detectPlatform(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const h = u.hostname.toLowerCase();
  if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
  if (/(^|\.)(x\.com|twitter\.com)$/.test(h)) return 'twitter';
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(h)) return 'youtube';
  return null;
}

// ============================================================
// Instagram
// ============================================================

function extractInstagramShortcode(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const m = u.pathname.match(/^\/(?:[^/]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

async function instagramContextJsonStrategy(url, log) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) throw new Error('shortcode não encontrado na URL');
  log(`shortcode: ${shortcode}`);

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  log(`GET ${embedUrl}  (UA=facebookexternalhit)`);

  const r = await fetch(embedUrl, {
    headers: {
      'User-Agent': CRAWLER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();

  const m = html.match(/"contextJSON":"((?:\\.|[^"\\])*)"/);
  if (!m) throw new Error('contextJSON ausente');
  const inner = JSON.parse('"' + m[1] + '"');
  const data = JSON.parse(inner);
  const media = (data.context && data.context.media) || data.shortcode_media;
  if (!media || !media.video_url) throw new Error('media.video_url ausente');

  log(`vídeo encontrado em shortcode_media`);
  return {
    videoUrl: media.video_url,
    thumbnail: media.display_url || null,
    caption:
      (media.edge_media_to_caption &&
        media.edge_media_to_caption.edges &&
        media.edge_media_to_caption.edges[0] &&
        media.edge_media_to_caption.edges[0].node &&
        media.edge_media_to_caption.edges[0].node.text) ||
      null,
    shortcode,
  };
}

async function instagramOgMetaStrategy(url, log) {
  const shortcode = extractInstagramShortcode(url);
  if (!shortcode) throw new Error('shortcode não encontrado');
  log(`shortcode: ${shortcode}`);

  const target = `https://www.instagram.com/reel/${shortcode}/`;
  log(`GET ${target}  (UA=Googlebot)`);
  const r = await fetch(target, {
    headers: { 'User-Agent': GOOGLEBOT_UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();

  const v = html.match(/<meta property="og:video"[^>]*content="([^"]+)"/);
  if (!v) throw new Error('og:video ausente');
  const img = html.match(/<meta property="og:image"[^>]*content="([^"]+)"/);
  const title = html.match(/<meta property="og:title"[^>]*content="([^"]+)"/);

  log('og:video encontrado');
  return {
    videoUrl: decodeHtmlEntities(v[1]),
    thumbnail: img ? decodeHtmlEntities(img[1]) : null,
    caption: title ? decodeHtmlEntities(title[1]) : null,
    shortcode,
  };
}

// ============================================================
// Twitter / X.com
// ============================================================

function extractTwitterId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const m = u.pathname.match(/\/status(?:es)?\/(\d+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function syndicationToken(id) {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(6 ** 2)
    .replace(/(0+|\.)/g, '');
}

async function twitterSyndicationStrategy(url, log) {
  const id = extractTwitterId(url);
  if (!id) throw new Error('ID do tweet ausente na URL');
  log(`tweet id: ${id}`);

  const token = syndicationToken(id);
  const apiUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`;
  log(`GET ${apiUrl}`);

  const r = await fetch(apiUrl, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept': 'application/json',
      'Referer': 'https://platform.twitter.com/',
    },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();

  let variants = null;
  if (data.video && data.video.variants) variants = data.video.variants;
  else if (Array.isArray(data.mediaDetails)) {
    const m = data.mediaDetails.find(
      (x) => x.type === 'video' || x.type === 'animated_gif'
    );
    if (m && m.video_info && m.video_info.variants) variants = m.video_info.variants;
  }
  if (!variants) throw new Error('tweet sem vídeo');

  const mp4s = variants.filter((v) =>
    /video\/mp4/.test(v.content_type || v.type || '')
  );
  if (!mp4s.length) throw new Error('sem variante mp4');
  mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  log(`${mp4s.length} variantes mp4, picking bitrate=${mp4s[0].bitrate || '?'}`);

  return {
    videoUrl: mp4s[0].url,
    thumbnail:
      (Array.isArray(data.mediaDetails) && data.mediaDetails[0] && data.mediaDetails[0].media_url_https) ||
      null,
    caption: data.text || null,
    shortcode: id,
  };
}

async function twitterVxTwitterStrategy(url, log) {
  const id = extractTwitterId(url);
  if (!id) throw new Error('ID do tweet ausente');
  const apiUrl = `https://api.vxtwitter.com/Twitter/status/${id}`;
  log(`GET ${apiUrl}`);

  const r = await fetch(apiUrl, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const ct = (r.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('json')) {
    throw new Error('resposta não-JSON (tweet inexistente, privado ou bloqueado)');
  }
  const data = await r.json();

  const urls = Array.isArray(data.mediaURLs) ? data.mediaURLs : [];
  if (!urls.length) throw new Error('sem mídia');
  const mp4 = urls.find((u) => /\.mp4/i.test(u)) || urls[0];
  log(`mp4 selecionado: ${mp4.slice(0, 80)}...`);

  return {
    videoUrl: mp4,
    thumbnail:
      (Array.isArray(data.media_extended) &&
        data.media_extended[0] &&
        data.media_extended[0].thumbnail_url) ||
      null,
    caption: data.text || null,
    shortcode: id,
  };
}

// ============================================================
// YouTube
// ============================================================

function extractYouTubeId(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) {
      return u.pathname.split('/').filter(Boolean)[0] || null;
    }
    if (u.searchParams.has('v')) return u.searchParams.get('v');
    const m = u.pathname.match(/\/(?:shorts|embed|live)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function youtubeYtdlCoreStrategy(url, log) {
  const ytdl = require('@distube/ytdl-core');
  if (!ytdl.validateURL(url)) throw new Error('URL não reconhecida pelo ytdl-core');
  log('ytdl-core getInfo()...');
  const info = await ytdl.getInfo(url);

  const combined = info.formats.filter(
    (f) => f.container === 'mp4' && f.hasAudio && f.hasVideo && f.url
  );
  if (!combined.length) throw new Error('sem formato mp4 áudio+vídeo combinado');
  combined.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const pick = combined[0];
  log(`${combined.length} formatos combinados; pick itag=${pick.itag} qualityLabel=${pick.qualityLabel || '?'}`);

  return {
    videoUrl: pick.url,
    thumbnail:
      (info.videoDetails.thumbnails &&
        info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1] &&
        info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url) ||
      null,
    caption: info.videoDetails.title || null,
    shortcode: info.videoDetails.videoId,
  };
}

async function youtubeYtdlCoreVideoOnlyStrategy(url, log) {
  const ytdl = require('@distube/ytdl-core');
  if (!ytdl.validateURL(url)) throw new Error('URL não reconhecida');
  log('ytdl-core getInfo() fallback (video-only mp4)...');
  const info = await ytdl.getInfo(url);

  const videoOnly = info.formats.filter(
    (f) => f.container === 'mp4' && f.hasVideo && f.url
  );
  if (!videoOnly.length) throw new Error('nenhum formato mp4');
  videoOnly.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const pick = videoOnly[0];
  log(`fallback: itag=${pick.itag} qualityLabel=${pick.qualityLabel || '?'} (pode estar sem áudio)`);

  return {
    videoUrl: pick.url,
    thumbnail:
      (info.videoDetails.thumbnails &&
        info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1] &&
        info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url) ||
      null,
    caption:
      (info.videoDetails.title || '') +
      (pick.hasAudio ? '' : ' (sem áudio)'),
    shortcode: info.videoDetails.videoId,
  };
}

// ============================================================
// platform registry
// ============================================================

const PLATFORMS = {
  instagram: {
    strategies: [
      { name: 'instagram:contextJSON', fn: instagramContextJsonStrategy },
      { name: 'instagram:og-meta', fn: instagramOgMetaStrategy },
    ],
  },
  twitter: {
    strategies: [
      { name: 'twitter:syndication', fn: twitterSyndicationStrategy },
      { name: 'twitter:vxtwitter', fn: twitterVxTwitterStrategy },
    ],
  },
  youtube: {
    strategies: [
      { name: 'youtube:ytdl-core-combined', fn: youtubeYtdlCoreStrategy },
      { name: 'youtube:ytdl-core-video-only', fn: youtubeYtdlCoreVideoOnlyStrategy },
    ],
  },
};

// ============================================================
// routes
// ============================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.get('/api/version', (req, res) => {
  res.json({ version: pkg.version });
});

app.get('/api/extract', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const log = (msg, level = 'info') => {
    console.log(`[${level}] ${msg}`);
    send('log', { level, msg, time: Date.now() });
  };

  const heartbeat = setInterval(() => {
    try { res.write(': hb\n\n'); } catch {}
  }, 5000);
  let closed = false;
  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
  });

  try {
    const url = (req.query.url || '').toString().trim();
    if (!url) {
      log('URL ausente', 'error');
      send('result', { ok: false, error: 'URL ausente' });
      clearInterval(heartbeat);
      return res.end();
    }
    log(`URL recebida: ${url}`);

    const platform = detectPlatform(url);
    if (!platform) {
      log('domínio não suportado', 'error');
      send('result', {
        ok: false,
        error: 'Domínio não suportado. Use Instagram, X.com/Twitter ou YouTube.',
      });
      clearInterval(heartbeat);
      return res.end();
    }
    log(`plataforma detectada: ${platform}`, 'success');

    const def = PLATFORMS[platform];
    for (let i = 0; i < def.strategies.length; i++) {
      if (closed) return;
      const { name, fn } = def.strategies[i];
      log(`▶ estratégia ${i + 1}/${def.strategies.length}: ${name}`);
      const t0 = Date.now();
      try {
        const result = await fn(url, (m) => log(`   ${m}`));
        if (result && result.videoUrl) {
          log(`✓ sucesso em ${Date.now() - t0}ms via ${name}`, 'success');
          send('result', {
            ok: true,
            platform,
            strategy: name,
            videoUrl: result.videoUrl,
            thumbnail: result.thumbnail || null,
            caption: result.caption || null,
            shortcode: result.shortcode || null,
          });
          clearInterval(heartbeat);
          return res.end();
        }
        log(`${name} não retornou vídeo`, 'warn');
      } catch (e) {
        log(`${name} falhou: ${e.message}`, 'warn');
      }
    }

    log('todas as estratégias falharam', 'error');
    send('result', {
      ok: false,
      error:
        'Não foi possível extrair o vídeo. Verifique se a URL é pública e contém vídeo.',
    });
    clearInterval(heartbeat);
    res.end();
  } catch (err) {
    console.error('extract error:', err);
    try {
      send('log', { level: 'error', msg: 'erro interno: ' + err.message, time: Date.now() });
      send('result', { ok: false, error: 'Erro interno' });
    } catch {}
    clearInterval(heartbeat);
    try { res.end(); } catch {}
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const mediaUrl = (req.query.url || '').toString();
    if (!mediaUrl) return res.status(400).send('Parâmetro "url" obrigatório');

    let parsed;
    try {
      parsed = new URL(mediaUrl);
    } catch {
      return res.status(400).send('URL inválida');
    }
    if (
      parsed.protocol !== 'https:' ||
      !ALLOWED_DOWNLOAD_HOSTS.some((re) => re.test(parsed.hostname))
    ) {
      return res
        .status(400)
        .send('Host de mídia não permitido: ' + parsed.hostname);
    }

    const rawName = (req.query.filename || 'video.mp4').toString();
    const filename =
      rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'video.mp4';

    let referer = 'https://www.instagram.com/';
    if (/twimg\.com$/i.test(parsed.hostname)) referer = 'https://twitter.com/';
    else if (/googlevideo\.com$/i.test(parsed.hostname))
      referer = 'https://www.youtube.com/';

    const upstream = await fetch(mediaUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        Referer: referer,
      },
    });
    if (!upstream.ok || !upstream.body) {
      return res
        .status(502)
        .send('Falha no upstream (' + upstream.status + ')');
    }

    res.setHeader(
      'Content-Type',
      upstream.headers.get('content-type') || 'video/mp4'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }
    res.end();
  } catch (err) {
    console.error('download error:', err);
    if (!res.headersSent) res.status(500).send('Erro interno');
    else res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Multi-platform downloader v${pkg.version} listening on port ${PORT}`);
});

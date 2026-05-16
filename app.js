const express = require('express');
const path = require('path');
const pkg = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views/index.html'));
});

app.get('/api/version', (req, res) => {
  res.json({ version: pkg.version });
});

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Instagram serves a full contextJSON with the video URL only for crawler UAs.
const CRAWLER_UA =
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

function extractShortcode(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/(?:[^/]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function unescapeJsonString(s) {
  try {
    return JSON.parse('"' + s + '"');
  } catch {
    return s;
  }
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function fetchEmbedHtml(shortcode) {
  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  const r = await fetch(embedUrl, {
    headers: {
      'User-Agent': CRAWLER_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!r.ok) throw new Error('Não foi possível acessar o Reels (status ' + r.status + ')');
  return await r.text();
}

function extractContextMedia(html) {
  const m = html.match(/"contextJSON":"((?:\\.|[^"\\])*)"/);
  if (!m) return null;
  try {
    const inner = JSON.parse('"' + m[1] + '"');
    const data = JSON.parse(inner);
    return (data && data.context && data.context.media) || data.shortcode_media || null;
  } catch {
    return null;
  }
}

function extractCaption(media, html) {
  const edges =
    media &&
    media.edge_media_to_caption &&
    media.edge_media_to_caption.edges;
  if (edges && edges.length > 0 && edges[0].node && edges[0].node.text) {
    return edges[0].node.text;
  }
  const m = html.match(/<meta property="og:title" content="([^"]+)"/);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function parseReel(html) {
  const media = extractContextMedia(html);

  let videoUrl = media && media.video_url ? media.video_url : null;
  if (!videoUrl) {
    let m = html.match(/"video_url":"([^"]+)"/);
    if (m) videoUrl = unescapeJsonString(m[1]);
  }
  if (!videoUrl) {
    let m = html.match(/<meta property="og:video" content="([^"]+)"/);
    if (m) videoUrl = decodeHtmlEntities(m[1]);
  }
  if (!videoUrl) {
    let m = html.match(/<video[^>]*src="([^"]+)"/i);
    if (m) videoUrl = decodeHtmlEntities(m[1]);
  }

  let thumbnail = media && media.display_url ? media.display_url : null;
  if (!thumbnail) {
    let m = html.match(/"display_url":"([^"]+)"/);
    if (m) thumbnail = unescapeJsonString(m[1]);
  }
  if (!thumbnail) {
    let m = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (m) thumbnail = decodeHtmlEntities(m[1]);
  }

  const caption = extractCaption(media, html);

  return { videoUrl, thumbnail, caption };
}

app.get('/api/reel', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'Parâmetro "url" obrigatório' });
    const shortcode = extractShortcode(url);
    if (!shortcode) return res.status(400).json({ error: 'Link do Instagram inválido' });

    const html = await fetchEmbedHtml(shortcode);
    const data = parseReel(html);
    if (!data.videoUrl) {
      return res.status(404).json({
        error: 'Vídeo não encontrado. O post pode ser privado, ter sido removido ou não conter vídeo.',
      });
    }
    res.json({ ...data, shortcode });
  } catch (err) {
    console.error('reel error:', err);
    res.status(500).json({ error: err.message || 'Erro interno' });
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const mediaUrl = req.query.url;
    if (!mediaUrl) return res.status(400).send('Parâmetro "url" obrigatório');

    let parsed;
    try {
      parsed = new URL(mediaUrl);
    } catch {
      return res.status(400).send('URL inválida');
    }
    if (
      parsed.protocol !== 'https:' ||
      !/\.(?:cdninstagram\.com|cdninstagram\.net|fbcdn\.net)$/i.test(parsed.hostname)
    ) {
      return res.status(400).send('URL de mídia não permitida');
    }

    const rawName = (req.query.filename || 'reel.mp4').toString();
    const filename = rawName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'reel.mp4';

    const upstream = await fetch(mediaUrl, {
      headers: { 'User-Agent': BROWSER_UA, Referer: 'https://www.instagram.com/' },
    });
    if (!upstream.ok || !upstream.body) {
      return res.status(502).send('Falha ao baixar o vídeo (' + upstream.status + ')');
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
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
  console.log(`Instagram Reels Downloader rodando em http://localhost:${PORT}`);
});

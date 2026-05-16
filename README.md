# Multi Downloader

Web app simples para baixar vídeos públicos a partir de um link. Suporta:

- **Instagram** (Reels, posts em vídeo, IGTV)
- **X.com / Twitter** (vídeos em tweets)
- **YouTube** (vídeos, Shorts) — *ver caveat abaixo*

Para uso pessoal. Respeite os direitos do criador.

## Como funciona

Para cada plataforma o backend tenta duas estratégias em ordem. O frontend
mostra um log de execução em tempo real (SSE) para você ver o que está
acontecendo.

| Plataforma | Estratégia 1 | Estratégia 2 |
|---|---|---|
| Instagram | embed `/embed/captioned/` + `contextJSON` (UA crawler) | página `/reel/` + meta `og:video` (UA Googlebot) |
| Twitter   | `cdn.syndication.twimg.com/tweet-result` (oficial-ish) | `api.vxtwitter.com` (community mirror) |
| YouTube   | `@distube/ytdl-core` com formato mp4 áudio+vídeo | `ytdl-core` fallback video-only |

O download é proxiado por `/api/download` para forçar `Content-Disposition`
e burlar restrições de CORS/cookies. A allowlist do proxy cobre:

- `*.cdninstagram.com`, `*.fbcdn.net` (Instagram)
- `*.twimg.com` (Twitter)
- `*.googlevideo.com` (YouTube)

## Caveat sobre YouTube

`ytdl-core` precisa fazer requisições para o YouTube a partir do servidor.
IPs de provedores de nuvem (Render, Heroku, Vercel, etc.) são
frequentemente *rate-limited* ou bloqueados (HTTP 429) e o YouTube muda o
formato do player com frequência. Resultado:

- Pode funcionar.
- Pode dar erro 429 ("Too Many Requests") — sem o que fazer no nível do
  código além de aguardar.
- Pode quebrar quando o YouTube atualiza o player; basta atualizar
  `@distube/ytdl-core` para a versão mais nova.

Para uso 100% confiável de YouTube, rode o app localmente (seu IP
residencial é tratado como usuário comum).

## Requisitos

- Node.js 18+ (usa `fetch` nativo).

## Como rodar

```bash
npm install
npm start
```

Acesse <http://localhost:3000>.

## Endpoints

- `GET /api/version` → `{ version }`.
- `GET /api/extract?url=<link>` → **SSE stream**. Eventos:
  - `event: log` com `{ level, msg, time }`
  - `event: result` com `{ ok, platform, strategy, videoUrl, thumbnail, caption, shortcode }` ou `{ ok: false, error }`
- `GET /api/download?url=<media-url>&filename=<name.mp4>` → proxy de
  download direto do CDN (só hosts no allowlist).

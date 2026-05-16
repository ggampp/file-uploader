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
| YouTube   | `@distube/ytdl-core` mp4 áudio+vídeo combinado | `ytdl-core` fallback video-only + tentativas em instâncias **Piped** públicas |

O download é proxiado por `/api/download` para forçar `Content-Disposition`
e burlar restrições de CORS/cookies. A allowlist do proxy cobre:

- `*.cdninstagram.com`, `*.fbcdn.net` (Instagram)
- `*.twimg.com` (Twitter)
- `*.googlevideo.com` (YouTube)

## Caveat sobre YouTube

`ytdl-core` precisa fazer requisições para o YouTube a partir do servidor.
IPs de provedores de nuvem (Render, Heroku, Vercel, etc.) são quase
sempre *rate-limited* ou bloqueados (HTTP 429) e o YouTube muda o player
com frequência. Como fallback adicional o app tenta algumas instâncias
**Piped** públicas, mas a rede Piped degradou bastante em 2024-2025 e
boa parte das instâncias está offline ou retornando 5xx.

Recomendação: para uso confiável de YouTube, rode o app **localmente**
(seu IP residencial é tratado como usuário comum). Para Instagram e
X.com a versão hospedada funciona bem.

## Download seguro

O `/api/download` aceita uma URL via dois mecanismos:
- **Allowlist de hosts** (`*.cdninstagram.com`, `*.fbcdn.net`,
  `*.twimg.com`, `*.googlevideo.com`)
- **URL assinada via HMAC** com segredo do servidor (`DOWNLOAD_SECRET`
  por env, gerado em memória se não definido). Estratégias internas
  emitem `downloadUrl` já assinado, permitindo proxy mesmo de hosts
  fora do allowlist (ex.: Piped) sem virar open proxy.

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
  - `event: result` com `{ ok, platform, strategy, videoUrl, downloadUrl, thumbnail, caption, shortcode }` ou `{ ok: false, error }`
- `GET /api/download?url=<media-url>&filename=<name.mp4>[&sig=<hmac>]`
  → proxy de download (hosts do allowlist ou URLs assinadas pelo servidor).

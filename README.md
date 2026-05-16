# Instagram Reels Downloader

Web app simples para baixar Reels públicos do Instagram a partir de um link.

## Como funciona

1. O usuário cola a URL de um Reels (ex.: `https://www.instagram.com/reel/XYZ/`).
2. O backend Express acessa a página de *embed* pública do Instagram, extrai a
   URL direta do vídeo e devolve em JSON.
3. O front-end exibe um preview do vídeo e um botão de download.
4. O download é feito via proxy do servidor (`/api/download`) para forçar o
   nome do arquivo `.mp4` e evitar restrições de CORS.

Funciona apenas com posts públicos. Use de forma responsável e respeitando os
direitos do criador do conteúdo.

## Requisitos

- Node.js 18+ (usa o `fetch` nativo).

## Como rodar

```bash
npm install
npm start
```

Acesse <http://localhost:3000>.

## Endpoints

- `GET /api/reel?url=<link-do-reels>` — devolve `{ videoUrl, thumbnail, caption, shortcode }`.
- `GET /api/download?url=<url-do-video>&filename=<nome.mp4>` — faz o proxy do
  download direto do CDN do Instagram.

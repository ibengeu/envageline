# Evangeline — PDF Read Aloud

A local-first PDF reader that reads documents aloud using on-device AI. Your files never leave your machine.

## What it does

Drop a PDF into the browser. The app extracts the text, splits it into sentences, and reads it back to you — sentence by sentence, with the active sentence highlighted as it plays.

Two voice options:

- **Browser voices** — uses the Web Speech API built into Chrome/Safari/Firefox. Zero setup, zero network traffic.
- **Local Kokoro** — uses the [Kokoro ONNX](https://github.com/hexgrad/kokoro) model running in Docker on your machine. Near-natural voice quality. Text goes only to localhost.

## Quick start

```bash
docker compose up
```

Open **http://localhost:8880** — the reader and the TTS server are served from the same container.

The first time you select Local Kokoro and load voices, the model downloads automatically (~354 MB, one-time). After that it's cached in a Docker volume.

## How it works

```
Browser                              Docker :8880
──────────────────────────────────   ─────────────────────────
PDF.js (vendored) → extract text     FastAPI + Uvicorn
Text → normalize → split chunks  →   POST /v1/audio/speech
IndexedDB LRU cache (150 MB)         Kokoro ONNX inference
EWMA adaptive prefetch (1–6 ahead)   GET  /v1/audio/voices
Web Speech API (browser mode)        GET  / (static files)
```

**No build step.** The front end is plain HTML, CSS, and JavaScript.

## Features

- Sentence-level highlighting that scrolls with playback
- Click any sentence to jump playback to that point
- Adaptive prefetching: measures Kokoro response time and buffers 1–6 chunks ahead automatically
- Persistent audio cache: re-listening to the same document is instant
- Rate control wired to Kokoro's `speed` parameter
- Graceful fallback to browser voices when Kokoro is unavailable
- Automatic pause/resume on tab visibility change

## Privacy

- PDFs are opened and parsed entirely in the browser — no upload, ever
- In browser voice mode: zero network traffic
- In Kokoro mode: text is sent only to `localhost` — enforced by CSP and a server-side URL validator
- No analytics, no cookies, no accounts

## Security

| Risk | Mitigation |
|---|---|
| XSS via PDF content | All text rendered via `textContent`, never `innerHTML` |
| SSRF via custom endpoint | `isLocalTtsEndpoint()` rejects any non-localhost URL before fetch |
| Supply chain (PDF.js) | Vendored at `pdf-reader/vendor/pdfjs-4.10.38/` — no CDN fetch |
| CSP | `connect-src` restricted to `'self'` and `localhost/*` |
| CORS | Explicit localhost allowlist — no wildcard |

## Development

```bash
# Browser voices only — no Docker needed
cd pdf-reader && python3 -m http.server 8000

# Run Kokoro TTS separately
cd pdf-reader/kokoro-server && docker compose up

# Run tests
cd pdf-reader && node --test reader.test.js
```

## Deployment

The root `docker-compose.yml` builds a single image serving everything at `:8880`. Proxy through Nginx for production:

```nginx
location / {
    proxy_pass http://127.0.0.1:8880;
}
```

## Live

**https://evangeline.heraldsqr.com**

## Stack

| Layer | Technology |
|---|---|
| Front end | Vanilla HTML / CSS / JavaScript |
| PDF parsing | PDF.js 4.10.38 (vendored) |
| TTS (local) | Kokoro ONNX |
| TTS (browser) | Web Speech API |
| API server | FastAPI + Uvicorn |
| Audio cache | IndexedDB LRU |
| Container | Docker + Compose |

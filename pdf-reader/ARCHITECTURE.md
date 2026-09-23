# How We Built PDF Read Aloud

*A permanent record of the platform's journey — written for founders, engineers, investors, product managers, and anyone who inherits this codebase.*

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Origin Story](#2-the-origin-story)
3. [Product Vision](#3-product-vision)
4. [Platform Overview](#4-platform-overview)
5. [Architecture and System Design](#5-architecture-and-system-design)
6. [Technology Choices](#6-technology-choices)
7. [Algorithms and Engineering Innovations](#7-algorithms-and-engineering-innovations)
8. [Challenges and Tradeoffs](#8-challenges-and-tradeoffs)
9. [Reliability and Performance](#9-reliability-and-performance)
10. [Security and Trust](#10-security-and-trust)
11. [Development Process](#11-development-process)
12. [What We Learned](#12-what-we-learned)
13. [Alternatives We Considered](#13-alternatives-we-considered)
14. [Future Roadmap](#14-future-roadmap)
15. [Conclusion](#15-conclusion)

---

## 1. Executive Summary

### For Everyone

PDF Read Aloud is a local-first tool that reads PDF documents out loud. You open a PDF in your browser, the text is extracted, and an AI voice reads it back to you — sentence by sentence, with the active sentence highlighted on screen so you can follow along.

What makes it different from every other "text to speech" tool is a single property: **your documents never leave your device.** Not to a cloud API. Not to a logging pipeline. Not to an analytics service. The PDF is opened locally. The text is extracted locally. If you use the AI voice (Kokoro), the text is sent only to a server running on your own machine. If you use browser voices, nothing leaves the browser at all.

This matters for anyone reading legal documents, medical records, financial reports, drafts under NDA, or anything else they wouldn't want processed by a third-party service.

### Why It Matters

The problem is not "text to speech doesn't exist." Cloud TTS exists and is excellent. The problem is the terms of service that come with it. When you send a document to a cloud API to be read aloud, you have implicitly accepted that the provider may log your text, use it for model training, or retain it for compliance purposes. For sensitive documents, that is not acceptable.

Privacy-preserving alternatives existed before this project, but they required technical setup (installing Python packages, managing model files, configuring system services) that non-technical users could not navigate.

PDF Read Aloud eliminates that gap: one Docker command, one browser tab, zero cloud.

### Who Benefits

- **Professionals with sensitive documents** — lawyers, doctors, accountants, researchers
- **Students and knowledge workers** — anyone who absorbs information better by listening
- **People with reading difficulties** — dyslexia, visual impairment, fatigue
- **Anyone who has ever emailed a PDF to a cloud service and wondered where it went**

### Key Outcomes

- Zero document data sent to any external service
- Sub-second playback start on cached content
- Adaptive prefetching that eliminates stalls under normal conditions
- 150 MB persistent audio cache that survives page reloads
- Runs in a single Docker container requiring no configuration beyond `docker compose up`
- Full test suite covering text extraction, playback state, security invariants, and layout contracts

---

## 2. The Origin Story

### For Everyone

This started from a simple frustration: wanting to listen to a long research PDF while doing something else, and discovering that every tool capable of doing it either required uploading the document to a server or involved enough technical setup to be impractical.

Cloud options (ElevenLabs, Google TTS, Azure Cognitive Services) produced excellent audio but required sending the document text to an external API. Browser speech synthesis — built into Chrome and Safari — required no upload but sounded robotic and had limited voice selection.

The inflection point was Kokoro: an open-source text-to-speech model from Hexgrad that runs locally, produces near-natural audio, and exposes an OpenAI-compatible REST API. Suddenly the missing piece was not the TTS engine — it was a clean, private front end that could drive it.

### Pain Points Identified

1. **Cloud TTS requires trust you may not want to grant.** Every cloud provider has different data retention policies, and those policies are subject to change.

2. **Browser speech synthesis is inconsistent.** Voice quality varies dramatically between operating systems and browser versions. On some systems, no enhanced voices are available at all.

3. **Local TTS tools had no usable UI.** Running Kokoro directly required understanding Python virtual environments, model files, and command-line flags. There was no front end.

4. **PDF reading was separate from TTS.** Even if you had a local TTS server running, you still needed to extract the text from your PDF, copy it, paste it somewhere, and manage the reading position manually.

### Existing Solutions and Their Limitations

| Solution | Privacy | Voice Quality | Setup Complexity | PDF Support |
|---|---|---|---|---|
| ElevenLabs / AWS Polly | ✗ Cloud | ✓ Excellent | Low | Manual text copy |
| Browser SpeechSynthesis | ✓ Local | ✗ Inconsistent | None | Manual text copy |
| Kokoro (raw) | ✓ Local | ✓ Excellent | High | None |
| Adobe Acrobat Read Aloud | Partial | ✗ Robotic | None (if licensed) | ✓ Native |
| Screen readers (NVDA, VoiceOver) | ✓ Local | ✗ Robotic | Medium | ✓ Native |

None combined: local privacy + excellent voice quality + low setup + integrated PDF extraction + sentence-level tracking.

### Why We Built Our Own

The gap was a front end, not a TTS engine. Kokoro already solved the hard part. What was missing was:

- A browser-based PDF extractor that doesn't send files anywhere
- A clean UI for voice selection and playback control
- Sentence-level highlighting so you can follow along visually
- A smart buffering system so playback stays continuous

Building this as a single-file web app (no build system, no npm, no bundler) meant it could be served directly by the same FastAPI process that runs Kokoro — one container, one port, zero configuration.

---

## 3. Product Vision

### Core Objectives

1. **Zero external data transmission** — not aspirationally, but architecturally enforced
2. **One-command setup** — `docker compose up` from the root directory
3. **Immediate usability** — drop a PDF, press play, done
4. **Graceful degradation** — works with browser voices when Kokoro is unavailable
5. **Auditable simplicity** — a cautious user should be able to read the source and confirm the privacy guarantees

### User Experience Goals

- The interface should feel like a high-quality native app, not a developer tool
- The reading state should be obvious at a glance (what's playing, where in the document, how far along)
- Switching between voices or providers should not interrupt understanding of the interface
- The text pane should scroll automatically to keep the active sentence visible
- Nothing should require a manual step that could reasonably be automated

### Success Metrics

- Time from "page load" to "audio playing": under 3 seconds on a warm cache
- Playback stall rate: zero under normal conditions with prefetching active
- Setup time for a non-technical user: under 5 minutes from cold start
- User trust: zero lines of code that transmit document content to any external host

### Design Principles

**Privacy by architecture, not by policy.** A privacy policy can change. An architecture that physically cannot transmit data to external hosts cannot. The Content Security Policy, the endpoint allowlist, and the `isLocalTtsEndpoint` guard are all layers of the same principle.

**No build step in the front end.** Vanilla HTML, CSS, and JavaScript. Any engineer — or curious non-engineer — can open the source and read it. No transpilation, no bundler output to audit.

**Fail loud on security boundaries, fail silently on everything else.** If a non-localhost TTS endpoint is entered, the app refuses and says why. If prefetching a future chunk fails, it tries again silently — playback should never crash because a background fetch errored.

**The reading pane is sacred.** All UI controls exist to serve the reading experience. The controls panel is secondary.

---

## 4. Platform Overview

### For Everyone

When you use PDF Read Aloud, here is what happens:

1. You drop a PDF file onto the browser tab (or click to select it)
2. The app extracts all the text from the PDF — entirely inside your browser, no upload
3. You choose a voice: either a browser voice (completely local, no server needed) or Kokoro (requires the Docker container, but stays on your machine)
4. You press Play
5. The app reads the document sentence by sentence. The active sentence is highlighted in the right-hand pane
6. You can pause, resume, or click any sentence to jump directly to it

That's the entire user journey. There are no accounts, no logins, no file uploads, no subscriptions.

### Major Features and Capabilities

**PDF Text Extraction**
Powered by PDF.js (Mozilla's open-source PDF engine, vendored locally). Extracts text from any text-based PDF. Scanned PDFs (images) are out of scope by design — they would require OCR, which introduces significant complexity.

**Dual TTS Providers**
- *Browser voices*: uses the Web Speech API. Zero setup, zero network traffic. Voice quality depends on the OS and browser.
- *Local Kokoro*: uses the Kokoro ONNX model running in Docker. Near-natural voice quality. Text is sent only to localhost.

**Sentence-Level Highlighting**
The document text is split into speech chunks (roughly sentence-length segments of up to 260 characters). As each chunk plays, it is highlighted in the reading pane and scrolled into view.

**Adaptive Prefetching**
The app does not wait until a chunk finishes playing before requesting the next one. It measures how long Kokoro takes to respond and prefetches as many chunks ahead as it can fill during a single chunk's playback time.

**Persistent Audio Cache**
WAV audio generated by Kokoro is cached in IndexedDB (the browser's local persistent storage) keyed by a SHA-256 hash of the text, voice, and speed. Re-listening to the same document (or re-seeking) serves audio instantly from cache.

**Click-to-Seek**
Any rendered sentence in the reading pane is clickable. Clicking starts playback from that sentence. The app cancels the current playback, resets position, and begins speaking from the selected chunk.

### End-to-End User Journey

```
User drops PDF
      │
      ▼
PDF.js extracts text (browser, no upload)
      │
      ▼
Text normalized & split into ~260-char chunks
      │
      ▼
User selects voice & presses Play
      │
      ├─── Browser mode: Web Speech API speaks chunk[0]
      │
      └─── Local mode:
              │
              ├── Check IndexedDB cache for chunk[0]
              │     ├── Hit: serve immediately
              │     └── Miss: POST text to /v1/audio/speech → WAV blob → cache → play
              │
              └── Simultaneously prefetch chunk[1..N] based on EWMA lookahead
```

### How Components Work Together

```
┌─────────────────────────────────────────────────────┐
│                    Browser Tab                       │
│                                                      │
│  ┌──────────────┐    ┌─────────────────────────┐    │
│  │  index.html  │    │        app.js            │    │
│  │  (UI shell)  │◄───│  - PDF extraction        │    │
│  └──────────────┘    │  - Playback state        │    │
│                      │  - EWMA prefetch          │    │
│  ┌──────────────┐    │  - IndexedDB cache       │    │
│  │  styles.css  │    │  - Voice management      │    │
│  └──────────────┘    └─────────┬───────────────┘    │
│                                │                     │
│  ┌──────────────┐              │ fetch (localhost)   │
│  │ pdf-engine.js│              │                     │
│  │ (PDF.js ONNX)│              ▼                     │
│  └──────────────┘    ┌─────────────────────┐         │
│                      │    IndexedDB         │         │
│                      │  (WAV audio cache)   │         │
│                      └─────────────────────┘         │
└─────────────────────────────────────────────────────┘
                              │
                   HTTP (localhost only)
                              │
               ┌──────────────▼──────────────┐
               │   Docker Container :8880     │
               │                             │
               │   FastAPI + Uvicorn         │
               │   ┌─────────────────────┐   │
               │   │   server.py         │   │
               │   │  POST /v1/audio/    │   │
               │   │       speech        │   │
               │   │  GET  /v1/audio/    │   │
               │   │       voices        │   │
               │   └────────┬────────────┘   │
               │            │                │
               │   ┌────────▼────────────┐   │
               │   │  Kokoro ONNX Model  │   │
               │   │  (kokoro-v1.0.onnx) │   │
               │   │  voices-v1.0.bin    │   │
               │   └─────────────────────┘   │
               │                             │
               │   StaticFiles → /app/       │
               │   pdf-reader (HTML/CSS/JS)  │
               └─────────────────────────────┘
```

---

## 5. Architecture and System Design

### For Everyone

The system has two parts: a web page (running in your browser) and an optional local server (running in Docker on your machine).

The web page does all the PDF work: it opens the file, reads the text, controls playback, and talks to the server. The server's only job is to convert text into audio using the Kokoro AI model.

Crucially, the server is optional. If you're happy with your browser's built-in voices, you never need Docker at all.

### High-Level Architecture

The architecture follows a "local-first, server-optional" pattern:

```
┌─────────────────────────────────────┐
│           Client (Browser)          │
│                                     │
│  Presentation Layer                 │
│    index.html + styles.css          │
│                                     │
│  Application Layer (app.js)         │
│    ┌──────────┐  ┌──────────────┐   │
│    │PDF Engine│  │ TTS Adapter  │   │
│    │(PDF.js)  │  │(Browser/     │   │
│    └──────────┘  │ Local)       │   │
│                  └──────┬───────┘   │
│    ┌──────────────────┐ │           │
│    │  Playback State  │ │           │
│    │  Machine         │ │           │
│    └──────────────────┘ │           │
│                         │           │
│    ┌────────────────────▼─────┐     │
│    │    Caching Layer         │     │
│    │  In-memory Map (session) │     │
│    │  IndexedDB LRU (persist) │     │
│    └──────────────────────────┘     │
└─────────────────────────────────────┘
              │ HTTP (localhost)
              ▼
┌─────────────────────────────────────┐
│      TTS Server (Docker :8880)      │
│                                     │
│  FastAPI HTTP Layer                 │
│    POST /v1/audio/speech            │
│    GET  /v1/audio/voices            │
│    GET  /health                     │
│    GET  / (static files)            │
│                                     │
│  Inference Layer                    │
│    Kokoro ONNX Runtime              │
│    (~326 MB model, ~28 MB voices)   │
└─────────────────────────────────────┘
```

### Data Flow: Local Kokoro Playback

```
User presses Play
       │
       ▼
app.js: playReading()
       │
       ▼
speakLocalChunk(index=0)
       │
       ├──► localChunkPromise(0)
       │         │
       │         ├── session Map hit? → return promise
       │         │
       │         └── miss:
       │               sha256(text+voice+speed) → cacheKey
       │               IndexedDB.get(cacheKey)
       │                   ├── hit: return blob (update lastUsed)
       │                   └── miss:
       │                         POST /v1/audio/speech
       │                           { input, voice, speed }
       │                         → WAV blob
       │                         record(responseTime) → ewma
       │                         IndexedDB.put(cacheKey, blob)
       │                         return blob
       │
       ├──► prefetchAhead(0)
       │         │
       │         └── ewma.lookahead() → N
       │               prefetchLocalAudio(1)
       │               prefetchLocalAudio(2)
       │               ...
       │               prefetchLocalAudio(N)
       │
       ▼
await blob
       │
       ▼
URL.createObjectURL(blob)
       │
       ▼
new Audio(url).play()
       │
       ▼
audio.onended → speakLocalChunk(index+1)
```

### Scalability Strategy

This platform is intentionally single-user and single-device. It does not scale horizontally — that would contradict the local-first design. The relevant scaling axes are:

- **Document length**: handled by chunking. A 500-page PDF becomes N chunks; memory usage is proportional to the chunk array, not the rendered audio.
- **Cache growth**: handled by LRU eviction at 150 MB. Long-term use on many documents stays bounded.
- **Kokoro throughput**: one inference at a time per container. The EWMA prefetcher adapts to whatever throughput is available.

---

## 6. Technology Choices

### Front End: Vanilla HTML/CSS/JavaScript

**Why:** No build step, no bundler, no transpilation. The entire front end is three files that any browser can load directly. This makes the codebase auditable by non-engineers, eliminates a class of supply chain vulnerabilities, and means `python3 -m http.server` is a valid way to serve it.

**Alternatives considered:**
- *React/Vue/Svelte*: rejected. Adding a framework adds a build pipeline, node_modules, and a layer of abstraction between the source and what the browser executes. For a tool whose trust model depends on auditability, that is a cost not worth paying.
- *TypeScript*: rejected for the same reason — requires compilation.

**Tradeoff:** No type safety, no hot module replacement, no component library. Accepted because the codebase is small enough (< 900 lines of JS) that these tools add more overhead than value.

### PDF Engine: PDF.js (Mozilla), Vendored

**Why:** PDF.js is the de-facto standard for in-browser PDF parsing. It is maintained by Mozilla, battle-tested against millions of documents, and runs entirely client-side.

**Why vendored, not CDN:** Loading PDF.js from a CDN at runtime means trusting that CDN's integrity on every page load. A compromised CDN could inject code that exfiltrates document content. Vendoring a pinned version (`pdfjs-4.10.38`) under `vendor/` means the code executed is the code audited.

**Alternatives considered:**
- *pdfjs-dist via npm*: requires a build step.
- *pdf-lib*: focused on PDF creation/modification, not text extraction.
- *Server-side extraction (pdfminer, pdfplumber)*: would require uploading the file to the server, violating the privacy model.

### TTS: Web Speech API + Kokoro ONNX

**Two-provider design:**

| Property | Web Speech API | Kokoro |
|---|---|---|
| Setup | None | Docker |
| Privacy | ✓ Fully local | ✓ Localhost only |
| Voice quality | ✗ OS-dependent | ✓ Near-natural |
| Control (speed) | ✓ | ✓ (`speed` param) |
| Control (pitch) | ✓ | ✗ Not supported |
| Offline | ✓ | ✓ (after model download) |

**Why Kokoro:** It is the only open-source TTS model that simultaneously achieves near-natural quality, runs on CPU in a standard Docker container without a GPU, and exposes an OpenAI-compatible API. This last property was decisive — the API contract (`POST /v1/audio/speech` with `{ input, voice, speed }`) is already understood by developers and is likely stable.

**Alternatives considered:**
- *Coqui TTS*: good quality but heavier setup, less active maintenance.
- *eSpeak*: fast and tiny, but robotic quality.
- *ElevenLabs / Azure TTS*: excellent quality, but cloud — disqualified by privacy model.
- *Whisper (reverse)*: Whisper is speech-to-text, not TTS.

### Backend: FastAPI + Uvicorn

**Why FastAPI:** The server has three endpoints. FastAPI's automatic request validation via Pydantic means `SpeechRequest` validates `input` length, `speed` range, and `voice` type before the inference code runs. This is exactly one layer of defence against malformed requests reaching the model.

**Why Uvicorn:** Standard async ONNX I/O pairing. No strong reason to use anything else at this scale.

**Alternatives considered:**
- *Flask*: synchronous by default, no automatic validation.
- *Node.js + Express*: would require a separate JS runtime in the container.
- *Go (chi/gin)*: valid, but Python is the natural language for ML model serving.

### Container: Docker + docker compose

**Why:** Kokoro requires specific Python dependencies (`kokoro-onnx`, `onnxruntime`, `soundfile`) and model files (~354 MB total). Docker encapsulates all of this. `docker compose up` from the root is a single command with no prerequisite knowledge of Python environments.

**The model volume:** Model files are stored in a named Docker volume (`models`) so they survive container restarts. The first run downloads them; subsequent runs are instant.

### Audio Format: WAV

**Why WAV over MP3/OGG:** WAV is what `soundfile.write()` produces most naturally from raw numpy audio arrays. It requires no encoding step, which means no encoder library dependency and no transcoding latency. The blobs are larger (~10× an equivalent MP3) but this is acceptable given they are cached locally and never transmitted over a network.

**Future opportunity:** Transcoding to Opus before caching would reduce IndexedDB storage consumption by ~10× with negligible quality loss.

### Cache Storage: IndexedDB

**Why IndexedDB over:**
- *localStorage*: 5 MB limit, synchronous API, no binary support
- *Cache API*: designed for HTTP responses; works but semantically awkward for synthetic TTS blobs
- *OPFS (Origin Private File System)*: excellent fit but lower browser support as of 2025
- *sessionStorage*: does not survive page reloads

IndexedDB is the correct choice: large storage quota (typically 20–80% of available disk), async API, binary blob support, survives page reloads, same-origin only.

---

## 7. Algorithms and Engineering Innovations

### 7.1 Text Normalization and Chunking

**Problem:** PDF text extraction produces noisy output. Hyphenated words broken across lines become `"hyphen-\nated"`. Multiple blank lines become large gaps. Trailing whitespace accumulates. Raw extraction output is unspeakable.

**How it works:**
```
Raw PDF text
    │
    ▼ rejoin hyphenated line-breaks ("hyphen-\nated" → "hyphenated")
    ▼ strip trailing whitespace from lines
    ▼ collapse 3+ blank lines to 2
    ▼ split on paragraph boundaries (\n\n)
    ▼ within each paragraph, collapse internal newlines to spaces
    ▼ rejoin paragraphs with \n\n
```

The result is clean, paragraph-structured prose that reads naturally when spoken.

**Chunking** then splits this into segments of up to 260 characters, preferring sentence boundaries (`.`, `!`, `?`). A sentence longer than 260 characters is split on whitespace. This produces the `chunks[]` array that drives all playback.

**Why 260 characters:** Empirically, 260 characters is approximately 30–40 spoken words, which is a comfortable listening unit. Shorter chunks produce more HTTP requests to Kokoro; longer chunks produce more noticeable stalls if a request is slow.

**Tradeoff:** Chunking at sentence boundaries occasionally splits a sentence if it exceeds the limit. This is audible as a slight pause. The alternative — variable-length chunks up to a much larger limit — risks long synthesis latency for a single chunk.

### 7.2 Two-Layer Audio Cache

**Problem:** Kokoro synthesis takes 200–2000 ms per chunk depending on text length and machine speed. Without caching, every sentence costs a round-trip. Re-listening to a document or re-seeking would re-incur the full cost.

**Layer 1: In-session Map (hot cache)**

A JavaScript `Map` keyed by chunk index. Stores promises (not resolved blobs) so concurrent lookups for the same index coalesce onto a single in-flight request rather than issuing duplicate fetches.

Entries are evicted as soon as they are behind the playhead — `clearLocalAudioCache(playbackIndex - 1)` is called on each `audio.onended`. This keeps memory bounded to (lookahead + 1) blobs at any time.

**Layer 2: IndexedDB LRU (persistent cache)**

Cache key: `SHA-256(voice + "|" + speed + "|" + text)` → 64-character hex string.

Entry schema:
```json
{
  "key": "a3f2...c91b",
  "blob": Blob,
  "size": 48200,
  "lastUsed": 1718900000000
}
```

On `get`: update `lastUsed` in the same transaction.
On `put`: write entry, then run eviction asynchronously.
Eviction: load all entries sorted by `lastUsed` ascending, delete oldest until total size ≤ 150 MB.

**Why SHA-256 for the key:** Collision resistance. Two different (text, voice, speed) combinations should never map to the same cached audio. SHA-256 from the Web Crypto API provides this guarantee without introducing any security dependency (the hash is not for secrecy).

**Why 150 MB:** A typical chapter of a non-fiction book at Kokoro's default quality produces WAV blobs of ~40 KB per chunk. 150 MB holds approximately 3,750 chunks — many hours of audio. Increasing the limit requires no code change, only a constant.

**Tradeoff:** IndexedDB access on cache hits adds ~2–5 ms of latency. This is invisible in practice because the hit path is several hundred milliseconds faster than a synthesis round-trip.

### 7.3 EWMA Adaptive Prefetching (Algorithm 2)

**Problem:** The original implementation always prefetched exactly one chunk ahead. If Kokoro was fast (200 ms per chunk) and each chunk played for 2500 ms, this left 2300 ms of unused prefetch capacity — meaning chunks 2, 3, 4, and 5 all waited for the playhead to arrive before synthesis began. If Kokoro was slow (2600 ms per chunk), prefetching 4 chunks ahead would cause synthesis requests to pile up and waste memory on blobs that might never be needed.

**How it works:**

Two Exponential Weighted Moving Averages track Kokoro response time:

```
fast  = 0.3 × current  +  0.7 × fast_prev    (reacts quickly)
slow  = 0.05 × current + 0.95 × slow_prev    (tracks trend)
```

At each chunk, the lookahead is computed as:

```
conservative_estimate = max(fast, slow) / 0.9
lookahead = clamp(floor(2500 / conservative_estimate), 1, 6)
```

**The intuition:**
- `max(fast, slow)` takes the more pessimistic of the two estimates — if either window says Kokoro is slow, we back off
- Dividing by 0.9 (the safety factor) adds a margin; we'd rather prefetch one fewer chunk than stall
- `floor(2500 / estimate)` asks: "how many Kokoro requests can complete in the time it takes to play one chunk?"
- Clamped to [1, 6] to guarantee at least one chunk ahead and avoid memory bloat

**Adaptation examples:**

| Kokoro response time | Lookahead |
|---|---|
| No data yet | 1 (conservative default) |
| 200 ms | 6 (Kokoro is fast, fill the buffer) |
| 500 ms | 5 |
| 1000 ms | 2 |
| 2800 ms | 1 (Kokoro is struggling, conserve) |

**Why dual EWMA over single EWMA:**
A single EWMA with α=0.3 (fast) reacts well to sudden slowdowns but is noisy for steady-state estimation. A single EWMA with α=0.05 (slow) is stable but slow to respond to degradation. Using `max(fast, slow)` gives worst-case conservatism: if either window detects a problem, we reduce prefetch immediately.

**EWMA reset:** The estimator resets on stop, new file load, or provider switch. This prevents stale timing from a previous session (e.g., a fast local network run) from over-prefetching at the start of a new session on a slower machine.

**Tradeoff:** The 2500 ms `CHUNK_PLAY_MS` constant is an approximation. Chunk playback time actually varies with text length and speech rate. A more accurate estimate would measure actual audio duration from the blob. This refinement would improve lookahead precision for very short or very long chunks.

### 7.4 Playback State Machine

The playback controller is an implicit state machine with five states:

```
IDLE ──── load PDF ──── READY
                          │
                    press Play
                          │
                          ▼
                       PLAYING ◄──── resume ────┐
                          │                     │
                        pause                   │
                          │                     │
                          ▼                     │
                       PAUSED ─────────────────►┘
                          │
                    press Stop / finish
                          │
                          ▼
                       IDLE
```

State is tracked via `state.utterance` (browser mode), `state.audio` (local mode), `state.isPaused`, and `state.playbackActive`. The `playbackId` counter is a session token — any async callback that finds its `playbackSession !== state.playbackId` knows it belongs to a superseded session and silently exits.

This pattern prevents a class of race condition: if the user presses Stop while a synthesis request is in flight, the response arrives after `playbackId` has incremented and is safely discarded.

### 7.5 Endpoint Fallback Chain

**Problem:** The local TTS endpoint field accepts a bare path (`/v1/audio/speech`) or a full URL. When given a bare path, the app doesn't know the actual port. Kokoro typically runs on `:8880`, but the origin port depends on how the app is served.

**How it works:**

```
Input: "/v1/audio/speech"

Fallback chain:
  1. /v1/audio/speech          (same-origin: works if served by Kokoro itself)
  2. http://localhost:8880/... (standard Kokoro port)
  3. http://127.0.0.1:8880/... (IPv4 loopback alias)
```

The first endpoint to return HTTP 200 wins. This covers the common cases:
- App served by Kokoro at `:8880` → endpoint 1 succeeds
- App served by dev server at `:8000`, Kokoro at `:8880` → endpoints 2 or 3 succeed

---

## 8. Challenges and Tradeoffs

### The CORS Problem

When the PDF reader is served from `:8000` (Python dev server) and Kokoro runs on `:8880`, the browser treats every fetch as cross-origin and sends an `OPTIONS` preflight. Early builds had `OPTIONS /v1/audio/speech → 400 Bad Request` because the CORS allowlist didn't include `:8000`.

The deeper fix was recognising that the root `docker-compose.yml` already serves the static files from inside the Kokoro container — same origin, no CORS at all. The dev server pattern (two ports) is a convenience, not the production model.

**Lesson:** CORS errors are almost always a symptom of a serving architecture question, not a configuration detail.

### The Hidden Element Bug

The `.local-settings` div was given `display: grid` in CSS. When JavaScript set `element.hidden = true` (which sets `display: none`), the browser-default `[hidden] { display: none }` rule was overridden by the more specific `.local-settings { display: grid }` rule. The div remained visible.

The fix was one CSS rule: `.local-settings[hidden] { display: none }`. But the diagnosis required understanding CSS specificity ordering — a non-obvious failure mode when you're thinking at the JavaScript level.

**Lesson:** `element.hidden` is not reliable when CSS has a `display` rule on that element. Always pair it with `[hidden] { display: none }` at equal or higher specificity.

### Stale Chunk Guard Removal

The original `localChunkPromise` contained:
```js
if (index > state.chunkIndex + 1) return null;
```

This was written when lookahead was hardcoded to 1. After EWMA prefetching was added (lookahead up to 6), this guard discarded every prefetched blob for indices 2–6 — storing `null` in the session cache and causing those chunks to stall and re-fetch when actually needed. Worse, it skipped the `IndexedDB.put()` call, so the fetched audio was thrown away without being cached.

The guard was removed. The correct stale-session protection is the `playbackId` token, not an index comparison.

**Lesson:** Guards written for one assumption become landmines when assumptions change. When extending a system, audit every existing guard for whether it still makes sense in the new context.

### Voice Select Consolidation

Early builds had two separate voice selectors: `#voice` (browser voices) and `#localVoice` (Kokoro voices), shown and hidden depending on the active provider. This created two parallel code paths for loading voices, two elements to keep in sync, and a confusing UI with "Local voice" as a label when the entire panel was already labelled "Local Kokoro."

Merging them into a single `#voice` element — repopulated on provider switch — eliminated the duplication. The label simply reads "Voice" in all contexts.

**Lesson:** Two controls doing the same job (selecting a voice) should be one control. Provider context is carried by the parent section, not the label.

### Pitch Control for Kokoro

Kokoro's API does not accept a `pitch` parameter. The browser Speech Synthesis API does. Showing a pitch slider that silently has no effect when Kokoro is active would be confusing and misleading. The slider is now hidden when Local Kokoro is selected.

Rate, by contrast, maps directly to Kokoro's `speed` parameter and is wired through.

---

## 9. Reliability and Performance

### Failure Handling

**Kokoro unavailable at startup:** If the voices endpoint returns an error, the app falls back to `af_heart` as a default voice and sets a status message. Playback can still be attempted — the speech endpoint is tried separately.

**Synthesis failure mid-playback:** `audio.onerror` triggers `speakLocalChunk()` again from the current index — an automatic retry. After repeated failures, `failPlayback()` clears state and shows an error message.

**Slow network / slow inference:** EWMA reduces lookahead. If synthesis takes longer than playback, a stall is inevitable — but the app retries automatically rather than erroring.

**Page visibility change:** When the page is hidden (user switches tabs), Kokoro playback is paused. When visible again, it resumes. This prevents audio playing in the background when the user has moved away.

**Race conditions:** All async playback callbacks carry a `playbackSession` token. If the user stops, seeks, or changes files while synthesis is in flight, the token will not match when the response arrives and the callback exits silently.

### Performance

**Warm cache hit path (best case):**
```
chunk requested → session Map hit → serve blob → createObjectURL → play
Latency: ~0 ms (synchronous Map lookup)
```

**IndexedDB cache hit path:**
```
chunk requested → session Map miss → sha256 (~1 ms) → IDB get (~3 ms) → serve blob
Latency: ~4–5 ms
```

**Cold miss path:**
```
chunk requested → sha256 → IDB miss → POST Kokoro → WAV blob → IDB put → serve blob
Latency: 200–2000 ms (Kokoro synthesis time)
```

The EWMA prefetcher ensures that by the time a chunk is needed for playback, it is already in the session Map from a prior prefetch — making the cold miss path invisible to the listener under normal conditions.

### Monitoring

There is currently no production monitoring. For a local tool this is acceptable. Future additions should include:

- Cache hit rate (IDB hits / total lookups)
- EWMA estimated response time (surfaced to the status bar in a debug mode)
- Synthesis error rate

---

## 10. Security and Trust

### For Everyone

Every decision in this project was made with one question in mind: "Could a user's document content end up somewhere they didn't expect?" If the answer was yes, we changed the design.

### Security Architecture

**Content Security Policy (CSP):**
```
default-src 'self'
script-src 'self'
worker-src 'self' blob:
style-src 'self'
object-src 'none'
base-uri 'none'
connect-src 'self' http://localhost:* http://127.0.0.1:*
media-src 'self' blob: http://localhost:* http://127.0.0.1:*
```

This CSP enforces the privacy model at the HTTP layer:
- `connect-src` limits all fetch calls to same-origin or localhost
- No `https://*` in connect-src means no accidental cloud calls
- `script-src 'self'` prevents injected scripts from CDNs or inline handlers

**OWASP A07:2025 — Injection:**
PDF content is rendered exclusively via `element.textContent`, never `innerHTML`. A PDF containing `<script>alert(1)</script>` renders that string literally and executes nothing.

**OWASP A09:2025 — SSRF:**
`isLocalTtsEndpoint()` validates every TTS URL before any fetch is made. Only paths starting with `/v1/audio/speech` or URLs with `localhost`/`127.0.0.1` hostnames are accepted. A user who pastes `https://attacker.com/exfiltrate` as the TTS endpoint receives an error message and no fetch is made.

**OWASP A03:2025 — Supply Chain:**
PDF.js is vendored under `vendor/pdfjs-4.10.38/`. No runtime CDN fetch. The vendored version is pinned and auditable.

**OWASP A02:2025 — Security Misconfiguration:**
CORS allowlist in `server.py` is explicit. The Kokoro server accepts requests only from known localhost origins. It does not use `allow_origins=["*"]`.

**SHA-256 for cache keys:**
The SHA-256 hash in the IDB cache key is not for cryptographic security — it is for collision-resistant keying. It ensures that two different (text, voice, speed) combinations never share a cached blob. Using a non-cryptographic hash (e.g., FNV-1a) would risk collisions on similar strings.

### Data Protection

- PDF content never leaves the browser (browser voice mode: zero data transmission; Kokoro mode: text sent to localhost only)
- No cookies, no session storage of document content, no analytics
- IndexedDB audio cache is same-origin and not accessible to other sites
- Model files (ONNX, voices) are downloaded once from GitHub releases and stored in a Docker volume — not in a user-accessible directory

---

## 11. Development Process

### Philosophy

This was built iteratively via conversation-driven development — requirements, implementation, and review happening in the same thread. Each change was immediately testable in the browser or via the test suite.

### Testing Strategy

The test suite (`reader.test.js`) uses Node's built-in `node:test` module — no test framework dependency. Tests fall into three categories:

**Pure function tests:**
```js
normalizePdfText, splitIntoSpeechChunks, renderExtractedText, renderSpeechFocus
```
These take inputs and assert outputs. No DOM, no network. Fast and deterministic.

**Integration tests (DOM simulation):**
`createFakeDocument()` constructs a minimal DOM-like object tree. `loadBrowserApp()` loads `app.js` against this fake environment. Tests drive the app by triggering event listeners and asserting element state.

This pattern tests observable behavior (button states, status messages, audio play calls) without testing implementation details (which internal function was called, in what order).

**Contract tests:**
```js
test("static shell exposes resume control and local-only PDF engine policy", ...)
test("reader layout keeps long PDF text inside a viewport-constrained scroll region", ...)
```
These read the actual HTML and CSS files and assert structural invariants. If someone accidentally removes the `id="resume"` attribute or the `overflow: hidden` layout constraint, a test fails.

**Security tests:**
```js
test("local TTS endpoint rejects non-localhost URLs before sending text", ...)
test("renderExtractedText treats PDF content as literal text", ...)
```
These verify security invariants as observable behaviors.

### Deployment

```sh
# From project root
docker compose up --build
```

This builds the Docker image (copying current HTML/CSS/JS into it), starts the container, and serves everything at `http://localhost:8880`. No environment variables required. No secrets to manage.

For development, the static files can also be served via `python3 -m http.server 8000` with Kokoro running separately at `:8880`. The CORS allowlist accommodates this.

---

## 12. What We Learned

### Biggest Successes

**The two-layer cache design.** Combining an in-session Map (hot, index-keyed) with a persistent IndexedDB LRU (warm, content-keyed) gives the best of both worlds: zero-latency replays within a session and zero-synthesis-cost replays across sessions. The design emerged from thinking about the problem from first principles rather than reaching for an existing caching library.

**EWMA lookahead.** The shift from a hardcoded `prefetch +1` to a measured, adaptive lookahead was the single highest-impact performance change. On a fast machine, it fills 4–5 chunks ahead automatically. On a slow machine, it conserves and stays at 1. The algorithm is 30 lines of code.

**Serving the front end from the same container as the API.** The `StaticFiles` mount in FastAPI means same-origin requests from the UI to the TTS API, zero CORS configuration needed, and one URL to share with users.

### Mistakes Made

**The stale chunk guard.** The `if (index > state.chunkIndex + 1) return null` guard was correct for a hardcoded lookahead of 1 and became a silent bug when lookahead became dynamic. It was caught by cross-checking the implementation against the stated design — not by a test.

**Two voice selectors.** `#voice` and `#localVoice` should have been one element from the start. The split created parallel code paths that diverged over time and a confusing UI.

**Not testing the EWMA and cache integration.** The test suite covers pure functions and browser behavior well but has no tests for the EWMA lookahead algorithm or the IndexedDB write-through. These are the two most complex new additions and both contain logic that could fail silently.

### Surprises

**CSS specificity defeating `element.hidden`.** A `display: grid` rule on `.local-settings` overrode the browser default `[hidden] { display: none }`. This was not caught in code review because the symptom (div visible when it shouldn't be) required a running browser.

**CORS was an architecture question.** The CORS `400 Bad Request` on preflight initially looked like a missing header. It was actually a signal that the serving architecture was wrong — the front end and API should not be on different origins.

### What We Would Do Differently

1. **Test the EWMA from the start.** It is pure functions — `record()` and `lookahead()` — and can be tested without a browser.
2. **Single voice selector from the start.** Designing for one control serving two modes is simpler than two controls with visibility toggling.
3. **WAV → Opus in the cache.** Storing Opus instead of WAV would reduce IndexedDB usage by ~10× at negligible quality cost.

---

## 13. Alternatives We Considered

### Architecture: Server-Side PDF Extraction

**What:** Process PDFs on the Kokoro server using `pdfplumber` or `pdfminer`. The browser uploads the file; the server returns text.

**Why rejected:** This would require the user's document to be transmitted to the server. Even though "the server" is localhost, it violates the principle that document content stays in the browser. It also adds a file upload endpoint, which is a meaningful attack surface.

### Architecture: Electron App

**What:** Package the reader and Kokoro server as a desktop app using Electron.

**Why rejected:** Electron adds ~200 MB to the distribution, requires platform-specific builds, and introduces a JavaScript runtime security model. The Docker + browser approach achieves the same result with no new runtime, and the user's existing browser is already trusted.

### Algorithm: Fixed Lookahead (N=2, N=3)

**What:** Prefetch a fixed 2 or 3 chunks ahead unconditionally.

**Why rejected:** A fixed lookahead of 3 on a slow machine (2s per synthesis) prefetches 3× 2s = 6s ahead while only 2.5s of audio plays. Synthesis can't keep up; the in-flight requests queue, and the buffer fills with promises rather than blobs. Adaptive lookahead avoids this.

### Algorithm: Throughput-Based Prefetch (SQUAD)

**What:** Estimate byte throughput (bytes/second) and compute how many bytes of audio to prefetch.

**Why rejected:** Kokoro is a local inference server, not a CDN. Byte throughput to localhost is not the limiting factor — inference time is. Measuring response time (ms per request) is the right signal for this workload.

### Cache: Cache API (Service Worker)

**What:** Use `caches.open()` with synthetic request URLs to store audio responses.

**Why rejected:** The Cache API is designed for HTTP response caching and works on the main thread without a Service Worker. However, the synthetic URL approach (`tts://voice/hash`) is semantically awkward, and Cache API eviction is entirely manual. IndexedDB with explicit LRU is more transparent.

### Cache Key: Simple Hash (FNV-1a, CRC32)

**What:** Use a non-cryptographic hash for the cache key to avoid the async Web Crypto API call.

**Why rejected:** Non-cryptographic hashes have meaningful collision probability on similar strings. Two slightly different chunks (differing by one word) might produce the same hash, causing wrong audio to be served. SHA-256 is collision-resistant enough that this cannot happen in practice. The 1 ms async cost is negligible.

---

## 14. Future Roadmap

### Immediate (Next Sprint)

**Fix stale test references.** The test suite still references `localVoice`, `browserVoiceField`, and `rateAndPitch` — element IDs that were changed or removed during the voice selector consolidation. These tests will fail or produce false passes until updated.

**EWMA tests.** Add tests for `ewma.record()` and `ewma.lookahead()` covering: cold start (returns 1), fast Kokoro (returns 6), slow Kokoro (returns 1), and the transition from fast to slow.

**Cache integration test.** Add a test that verifies: cache miss triggers Kokoro fetch, fetch result is written to IDB, second request for same chunk returns cached blob without a second fetch.

### Medium Term

**WAV → Opus transcoding.** Before writing to IndexedDB, transcode the WAV blob to Opus using the Web Audio API and MediaRecorder. This reduces cache storage by ~10× with no perceptible quality loss.

**CHUNK_PLAY_MS from actual audio duration.** Instead of the fixed 2500 ms constant in the EWMA, measure the actual `Audio.duration` of each played blob. This makes lookahead precision proportional to actual chunk length rather than an approximation.

**OCR support for scanned PDFs.** Integrate Tesseract.js (client-side OCR) behind a feature flag for PDFs that produce no extractable text. Scanned PDFs are currently out of scope but represent a significant fraction of real-world documents.

**Streaming synthesis.** Kokoro's API currently returns a complete WAV file per request. If Kokoro adds streaming support (chunked WAV or Opus), the first few hundred milliseconds of a chunk could play while the rest is still being synthesized — eliminating the synthesis latency from the playback experience entirely.

### Long Term

**Multiple voice blending.** Allow different voices for different document sections (e.g., a different voice for blockquotes or footnotes), useful for academic papers and legal documents with distinct text regions.

**Reading profiles.** Save per-document progress (last position, preferred voice, speed) to IndexedDB. Re-opening a PDF resumes from where you left off.

**Chapter navigation.** Detect document structure (headings, numbered sections) from PDF metadata or text patterns. Expose a chapter list for direct navigation.

**Mobile web.** The current layout is desktop-optimised. A responsive redesign with touch-friendly controls and smaller buffer targets (mobile inference is slower) would extend the platform to tablets and phones.

**Reduce Docker image size.** The current image is large due to Python ML dependencies. A multi-stage build that separates compile-time from runtime dependencies could reduce it significantly.

### Technical Debt

**Rate and EWMA `CHUNK_PLAY_MS` coupling.** The EWMA `CHUNK_PLAY_MS = 2500` constant assumes a fixed playback rate. When the user changes speed (rate slider), chunk playback duration changes but `CHUNK_PLAY_MS` does not. This means lookahead is slightly over-estimated at high speeds and under-estimated at low speeds.

**`elements.voice.value` read in two places.** Both `fetchLocalAudioBlob` (for the API request) and `localChunkPromise` (for the cache key) read `elements.voice.value.trim()`. If voice changes between when a chunk is queued and when it is fetched, the cache key and the API request will use different values. This is a rare race but a genuine one.

---

## 15. Conclusion

### Key Takeaways

**Privacy is an architecture choice.** It cannot be retrofitted with a policy document. The decision to never transmit document content to an external server was made at the design level and enforced by the CSP, the endpoint validator, and the absence of any external API calls in the codebase. Any engineer who wanted to add cloud TTS would have to explicitly break multiple layers.

**Local AI changes what's possible.** A year ago, "local, natural TTS" meant robotic eSpeak voices. Kokoro changed that. The same quality that previously required a cloud subscription now runs on a laptop CPU in a Docker container. The engineering in this project is mostly the integration layer — the model itself is someone else's extraordinary work.

**Simple architecture survives contact with reality.** No build step, no framework, no state management library. When bugs appeared (the CSS hidden override, the stale guard, the CORS misconfiguration), they were debugged by reading the source directly. There was no abstraction layer to peel back.

**Tests should reflect what the user experiences.** The test suite asserts button states, status messages, and audio play calls — not internal variable values or call sequences. When the implementation changed (voice selector consolidation, EWMA addition), the behavior tests remained valid because the observable outcomes stayed the same.

### Strategic Impact

PDF Read Aloud demonstrates a pattern that will become increasingly important: **local AI as a privacy-preserving alternative to cloud AI.** As language and speech models continue to shrink and improve, the gap between "cloud quality" and "local quality" narrows. The gap in privacy — between "your data on someone else's server" and "your data on your machine" — does not narrow. It is structural.

This platform bets on that asymmetry. The engineering is deliberately simple so that the bet is legible: anyone who reads the source can confirm, line by line, that the privacy guarantee holds.

### Vision for the Next Phase

The next meaningful leap is streaming synthesis — getting the first 100 ms of audio playing before the server has finished generating the rest. Combined with the persistent cache for second listens, this would make the experience indistinguishable from streaming a file that already exists.

Beyond that, the same architecture (local inference server + thin browser client + no external data transmission) generalises to other document intelligence tasks: summarisation, translation, question-answering over a corpus. PDF Read Aloud is a vertical slice of a broader pattern.

---

*This document was written to be a living record, not a snapshot. When the platform changes, this document should change with it.*

*Last updated: June 2026*

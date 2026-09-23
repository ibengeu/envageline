# We Built a Private PDF Reader with Local AI — Here's Everything We Learned

*How a frustration with cloud TTS terms of service led to a local-first PDF reader powered by Kokoro, IndexedDB, and a 30-line adaptive prefetching algorithm.*

---

There is a moment that most people who work with documents have experienced. You have a long PDF — a legal brief, a clinical study, a research paper — and you want to listen to it while you do something else. So you reach for a text-to-speech tool.

Then you read the terms of service.

The provider retains your text for 30 days. Or uses it to improve their models. Or shares it with "trusted partners." You close the tab.

That moment is where this project started.

---

## The Problem with Every Existing Solution

We looked at the landscape carefully before writing a line of code.

Cloud TTS tools — ElevenLabs, Google Cloud, AWS Polly, Azure Cognitive Services — produce genuinely excellent audio. The voices are natural, the APIs are clean, the latency is low. The problem is not the product. The problem is the deal. When you send text to a cloud API, you are trusting that provider with your document content, under whatever terms they currently have, subject to whatever changes they make in the future.


For a personal note, that is probably fine. For a legal filing, a medical record, or a draft under NDA, it is not.

Browser speech synthesis — the TTS built into Chrome, Safari, and Firefox — has the opposite problem. It is completely private: nothing leaves the browser. But the voice quality is inconsistent, depends entirely on what the OS has installed, and often sounds robotic enough to make long-form listening unpleasant.

Then there were local TTS tools. These existed, and some of them were genuinely good. But "install a Python virtual environment, download a 300 MB model file, configure a system service, and point a command-line tool at a text file" is not a user experience. It is a setup procedure.

The gap was specific: **private, near-natural, low-friction, integrated with PDF.** Nothing had all four.

---

## The Inflection Point: Kokoro

The project became viable the day we found [Kokoro](https://github.com/hexgrad/kokoro) — an open-source text-to-speech model from Hexgrad that produces near-natural audio, runs on a standard CPU without a GPU, and exposes an OpenAI-compatible REST API.

That last part was decisive. An OpenAI-compatible API means the interface is `POST /v1/audio/speech` with a JSON body containing `input`, `voice`, and `speed`. It is already a known contract. It is unlikely to change arbitrarily. And it means that if something better than Kokoro comes along with the same interface, swapping it in is a configuration change, not a rewrite.

Kokoro solved the hard part — the model. What was missing was a front end that could drive it without requiring the user to touch a terminal.

---

## The Design Constraint That Drove Everything

Before writing any code, we established one non-negotiable rule:

**Document content must never reach any server the user does not own and control.**

This sounds simple. It has significant architectural consequences.

It means no cloud TTS fallback. It means no error reporting that includes document text. It means the PDF must be parsed in the browser, not uploaded to a server. It means the TTS endpoint must be validated against a localhost allowlist before any fetch is issued. It means the Content Security Policy must physically prevent the browser from making requests to external hosts.

We encoded this as architecture, not as policy. A privacy policy is a promise. An architecture is a constraint. We wanted a constraint.

---

## What We Built

PDF Read Aloud is two things:

**A browser-based PDF reader** that extracts text client-side (using a vendored copy of Mozilla's PDF.js), splits it into sentence-length chunks, and plays them back with active sentence highlighting.

**A local TTS server** running in Docker that wraps the Kokoro model behind an OpenAI-compatible HTTP API, serving both the audio generation endpoint and the static reader files from the same origin.

The browser page and the Docker container form a complete system at `http://localhost:8880`. No accounts. No internet connection required after the model downloads. No configuration beyond `docker compose up`.

If you do not want to run Docker at all, the app also works with your browser's built-in voices — degraded quality, but complete privacy and zero setup.

---

## The Architecture in Plain Language

The system has a strict boundary between what happens in the browser and what happens in the container.

**In the browser:**
- PDF.js opens and parses the file locally
- The text is normalised (fixing hyphenation artifacts, collapsing whitespace) and split into ~260-character speech chunks
- The playback engine manages state: which chunk is playing, what's been prefetched, what's cached
- An IndexedDB cache stores WAV audio blobs persistently, so re-reading the same document is instant

**In the container:**
- FastAPI handles HTTP
- A Pydantic model validates every request before it reaches the inference code
- Kokoro generates WAV audio from the input text
- The same process serves the static HTML/CSS/JS files, keeping everything on one origin

The key insight of the architecture is that **same-origin serving eliminates CORS**. By having the Kokoro server also serve the front-end files, every fetch from the browser to the TTS API is a same-origin request. No preflight. No allowlist complexity. No cross-origin headers to debug.

We learned this the hard way — the first version had the reader on one port and Kokoro on another, and spent two debugging sessions on CORS errors before recognising that the architecture itself was the problem.

---

## The Engineering Problem Nobody Talks About: Buffering

Text-to-speech for long documents is a streaming problem. The document has hundreds of chunks. Each chunk takes 200–2000 ms to synthesise. Each chunk takes ~2500 ms to play back. If you naively request a chunk when the previous one finishes, you get a stall every 2.5 seconds.

The obvious fix is to prefetch. Request chunk N+1 while chunk N is playing. This works — until Kokoro is slow. If synthesis takes 3 seconds and playback takes 2.5 seconds, prefetching one chunk ahead still stalls. If synthesis takes 200 ms and you prefetch only one chunk ahead, you are leaving 2300 ms of available synthesis capacity unused.

What you actually want is to prefetch as many chunks ahead as Kokoro can synthesise in one chunk's playback window. That number changes dynamically based on server load, text complexity, and machine speed.

### Three Algorithms We Considered

**Option 1 — BOLA (Buffer Occupancy-Based Lyapunov Algorithm)**
Makes prefetch decisions purely based on current buffer level, not throughput estimates. If the buffer is draining, back off. If it's full, push ahead. Used by Netflix and YouTube in their adaptive bitrate players. The appeal: buffer level is ground truth — it doesn't lie the way throughput estimates do. The problem for our use case: Kokoro is a local inference server, not a CDN. Buffer occupancy alone doesn't tell us how many chunks we can realistically synthesise before the playhead catches up.

**Option 2 — Dual EWMA (what we built)**
Measures actual Kokoro response time using two exponential moving averages — one fast, one slow — and uses the more pessimistic of the two to decide how many chunks to prefetch ahead. Adapts in real time to server load. Simple to implement, no historical data required.

**Option 3 — Markov Chain Session Modelling**
Learns user seek and navigation behaviour as a probability distribution over document positions and prefetches the highest-probability future segments within a bandwidth budget. Netflix uses this to prefetch the next episode. YouTube uses it to prefetch chapters users hover over. Powerful — but overkill for a linear document reader, and requires session history to be useful.

We went with Option 2. The workload is linear (users read documents sequentially), the limiting factor is inference time not byte throughput, and the algorithm is simple enough to audit and tune.

### The EWMA Solution

We implemented a dual Exponential Weighted Moving Average over Kokoro's response time:

```
fast  = 0.3 × current  +  0.7 × fast_prev     (reacts quickly to spikes)
slow  = 0.05 × current + 0.95 × slow_prev     (tracks the steady-state trend)
```

At each chunk, we compute the lookahead as:

```
estimate  = max(fast, slow) / 0.9      (pessimistic; safety factor)
lookahead = clamp(floor(2500 / estimate), 1, 6)
```

Taking `max(fast, slow)` means either window can trigger a reduction in prefetch. If Kokoro suddenly gets slow, the fast window catches it within a few responses. The safety factor of 0.9 means we deliberately underestimate Kokoro's capacity — we would rather prefetch one fewer chunk than stall.

In practice: on a fast machine where Kokoro responds in 200 ms, lookahead reaches 6. On a loaded machine where synthesis takes 1200 ms, it drops to 2. On a struggling server, it falls back to 1 — identical to the original behaviour.

The entire algorithm is about 30 lines of code.

---

## The Cache That Survives Page Reloads

Prefetching solves the first-listen problem. But what about re-listening? What about seeking backwards? What about re-opening the same PDF tomorrow?

We built a two-layer cache:

**Layer 1: In-session Map.** A JavaScript `Map` keyed by chunk index that stores promises, not blobs. This means concurrent lookups for the same chunk coalesce onto a single in-flight request — no duplicate fetches. Entries behind the playhead are evicted immediately.

**Layer 2: IndexedDB LRU.** A persistent cache that survives page reloads and browser restarts. The cache key is `SHA-256(voice + "|" + speed + "|" + text)` — a content address that automatically invalidates if you change voice or speed. Entries are sorted by `lastUsed` timestamp; when total storage exceeds 150 MB, the oldest-accessed entries are deleted first.

The result: the first listen pays the synthesis cost. Every subsequent listen — same document, same voice, same speed — serves audio from IndexedDB in ~4 ms.

We chose SHA-256 (via the Web Crypto API) over a simpler hash like FNV-1a or CRC32 specifically for collision resistance. Two similar chunks differing by one word could plausibly collide under a 32-bit hash. SHA-256 makes this probability negligibly small. The cost is one async operation per cache lookup — about 1 ms — which is invisible against the alternative of a Kokoro round-trip.

---

## A Bug That Taught Us About Assumptions

Shortly after adding the EWMA prefetcher, we noticed that chunks 2 through 6 were sometimes stalling even though they had been prefetched. The EWMA was working. The requests were being issued. But playback was still catching up.

The culprit was a single line written months earlier:

```js
if (index > state.chunkIndex + 1) return null;
```

This guard was correct when lookahead was hardcoded to 1. It was a reasonable defence against prefetching far-future chunks that the user might never reach. But with EWMA lookahead of up to 6, it now silently discarded every blob for indices 2 through 6, stored `null` in the session cache, and caused those chunks to stall and re-fetch when actually needed. Worse, it also skipped the IndexedDB write — so the data was fetched from Kokoro, computed at full cost, and then thrown away.

The fix was removing the line entirely. The correct stale-session protection was already in place: the `playbackId` token that each async callback checks against the current session. Index-based guards are fragile. Session tokens are not.

The lesson generalised: **guards written for one assumption become landmines when assumptions change.** When you extend a system, audit every existing guard for whether it still makes sense in the new context.

---

## Security as Architecture

The privacy guarantee of this platform is not a promise we make in documentation. It is a physical constraint encoded in multiple layers.

**The Content Security Policy** in `index.html` restricts `connect-src` to `'self'` and explicit localhost patterns. A script that tried to exfiltrate document content to an external host would be blocked by the browser before the request was issued.

**The endpoint validator** (`isLocalTtsEndpoint()`) checks every TTS URL before any fetch is made. Entering `https://attacker.com/v1/audio/speech` as the endpoint produces an error message and no network request.

**PDF.js is vendored**, not CDN-loaded. Loading a JavaScript library from a CDN at runtime means trusting that CDN's integrity on every page load. A supply-chain compromise of that CDN could silently add code to exfiltrate document text. Vendoring a pinned version under `vendor/pdfjs-4.10.38/` means the code that runs is the code that was audited.

**PDF content is never passed to `innerHTML`**. Every display of document text goes through `element.textContent`. A PDF containing `<script>alert(1)</script>` renders that string literally.

**The CORS allowlist** in `server.py` is an explicit list of localhost origins. It does not use `allow_origins=["*"]`.

Each of these is a narrow, specific defence against a specific failure mode. Together they make the privacy guarantee structural: an engineer who wanted to route document content to an external service would have to break multiple layers explicitly, not just change a configuration value.

---

## What the Test Suite Covers

We use Node's built-in `node:test` module — no test framework, no test runner dependencies. The suite covers four categories:

**Pure function tests** for text normalisation and chunking: given a raw PDF extraction output, assert the cleaned-up text. These are deterministic and fast.

**Integration tests** that simulate a complete browser environment. A fake DOM, a fake `speechSynthesis`, a fake `indexedDB`, a fake `crypto.subtle`, and a fake `Audio` constructor. Tests drive the app by triggering event listeners and asserting button states, status messages, and audio play calls — not internal state.

**Contract tests** that read the actual HTML and CSS files and assert structural invariants. The layout `overflow: hidden` constraints, the presence of required element IDs, the absence of CDN URLs in the PDF engine.

**Security tests** that verify observable security properties: the endpoint validator rejects non-localhost URLs before making any network request; PDF content rendered to the DOM is treated as literal text.

When we consolidated the two voice selectors into one (`#localVoice` and `#voice` → just `#voice`), the integration tests needed updating. The security tests and contract tests did not — the observable security properties had not changed. That asymmetry is the sign of well-scoped tests.

---

## The Decisions We Would Make Differently

**Single voice selector from the start.** We built separate `#voice` and `#localVoice` elements, then consolidated them when the duplication became painful. A single element that repopulates on provider switch was always the right design.

**Test the EWMA from day one.** The `record()` and `lookahead()` functions are pure — they take inputs and produce outputs, with no DOM or network dependency. They were testable from the moment they were written. We added them without tests and caught the stale guard bug through code review rather than a failing test.

**WAV → Opus before caching.** We cache WAV blobs, which are roughly 10× larger than equivalent Opus audio at the same quality. Transcoding via the Web Audio API and `MediaRecorder` before the IndexedDB write would reduce cache storage by an order of magnitude. The 150 MB limit would effectively become 1.5 GB of audio coverage. This is a medium-term improvement, not a correctness issue — but we would do it from the start next time.

---

## What Comes Next

The most impactful near-term improvement is **streaming synthesis**. Kokoro currently returns a complete WAV file per request — you wait for the entire chunk to be synthesised before you hear any of it. If Kokoro adds streaming support (chunked transfer encoding or a WebSocket stream), the first few hundred milliseconds of a chunk could play while the rest is still being generated. Combined with the persistent cache for second listens, this would make the experience indistinguishable from streaming pre-recorded audio.

Beyond that, the architecture generalises cleanly to other document intelligence tasks. The same pattern — local inference server, thin browser client, no external data transmission — applies to summarisation, translation, and question-answering over a document corpus. PDF Read Aloud is a proof of concept for local AI as a privacy-preserving alternative to cloud AI. The interesting question is how far that pattern extends.

---

## The Broader Point

The gap between cloud AI quality and local AI quality is narrowing. Kokoro produces audio that would have required a paid cloud subscription two years ago. That gap will continue to close.

The gap in privacy between "your data on someone else's server" and "your data on your machine" does not close. It is structural. Cloud providers cannot give you the privacy guarantee that a local model gives you, regardless of how good their terms of service are, because data in transit and on their infrastructure is subject to forces outside your control — legal requests, breaches, policy changes, acquisitions.

The question for the next few years is how many workloads — reading, writing, summarising, searching, classifying — can move from cloud AI to local AI without meaningful quality loss. For text-to-speech, the answer is already: most of them.

This project is a small, specific bet on that trajectory.

---

*The source is on GitHub at [github.com/ibengeu/envageline](https://github.com/ibengeu/envageline). Pull requests welcome.*


Questions


. Pivoting

Madam Margaret How do you differentiate between a strategic pivot and simply avoiding responsibility or discomfort? And how do you ensure that a pivot is genuinely advancing your goals rather than just creating the appearance of progress?

2. Following an Unpleasant but Valuable Path

Mr Abayomi How do you handle situations where the path most likely to make you exceptional at your craft is one you don't particularly enjoy? And when experienced people tell you you're wasting your time, how do you decide whether to trust their advice or continue on your chosen path?
# Contract: Capability Assessment Functions (`pdf-reader/app.js`)

This project has no network API. Its contract surface is the set of pure/narrowly-scoped
functions exported from `app.js` via the `api` object and imported by `reader.test.js`. This
document specifies the new function(s) for this feature.

## New: `assessCapabilities(pageCount)`

**Purpose**: Determine which relevant capabilities are available in the current environment
before extraction proceeds, per FR-007/FR-011/FR-012.

**Input**: `pageCount` — the document's page count (already known by the time this is called, at
the point `extractPdfText` has read `pdf.numPages`).

**Scope note (revised during convergence)**: this function and the `extractPdfText` gate below
are PDF-only. `extractEpubText` is a synchronous, main-thread-only decompression/parse path with
no Worker involvement at any stage, so `hasRealWorker` is not a meaningful signal for it — gating
EPUB extraction on `hasRealWorker` would incorrectly block EPUBs in a Worker-less environment even
though EPUB extraction never needed a worker. EPUB already has its own, worker-independent
safety gates that serve FR-008's "clearly report rather than hang/fail silently on something too
large" intent: `EPUB_MAX_ENTRIES` (10,000 archive entries) and `EPUB_MAX_UNCOMPRESSED_BYTES`
(200MB), both of which throw a clear, user-facing error before any chapter-parsing work begins.
An earlier draft of this contract described `pageCount` as available from either `pdf.numPages`
or "the EPUB spine length," implying `assessCapabilities` should gate both paths identically —
that was inaccurate and is corrected here.

**Output**: a Capability Assessment object (data-model.md) — `{ hasRealWorker, hasLocalStorage,
hasIndexedDb, pageCount }`.

**Behavioral guarantees**:
- Never throws — any capability check that itself errors is caught and treated as that
  capability being unavailable (FR-012).
- Deterministic for a fixed environment: repeated calls in the same browser session with the
  same `pageCount` return the same result (no hidden state, no caching across calls — each call
  re-checks fresh, since environment state could change between checks in principle, and the
  cost of re-checking is negligible per research.md's <100ms performance goal).
- Does not mutate global state (e.g., does not permanently alter `console.warn`; any console
  interception used internally to detect the fake-worker case (research.md §1) is scoped to the
  single check and restored immediately after).

## Changed: `extractPdfText(file)`

**Purpose**: Gains a capability-gated path per FR-008/FR-009, without changing its existing
return shape (`{ pageCount, text, narrationText }`, per the Smart PDF Reading feature) or
altering behavior for any document that already processes successfully today.

**Behavioral guarantees**:
- For a document at or below the large-document page-count threshold (research.md §2):
  processing proceeds exactly as it does today, regardless of the Capability Assessment's
  result — FR-009.
- For a document above the threshold: processing proceeds only if `hasRealWorker` is `true`;
  otherwise, extraction MUST stop before doing per-page work and report a clear message (not
  silently continue in a way that could hang or freeze the UI) — FR-008.
- `hasLocalStorage`/`hasIndexedDb` being `false` never blocks extraction or narration — those
  capabilities gate only bookmarking and local-TTS caching respectively (research.md §3), both
  of which already degrade gracefully today per existing tests.

## Test contract (per Constitution Principle III)

All tests assert on function input/output behavior only:
- `assessCapabilities` given a fake environment with `Worker` undefined → `hasRealWorker: false`.
- `assessCapabilities` given a fake environment with `Worker` present but PDF.js's load path
  emitting the fake-worker warning → `hasRealWorker: false`.
- `assessCapabilities` given a fake environment where `localStorage`/`indexedDB` access throws →
  the corresponding flag is `false`, and the call does not throw.
- `extractPdfText` on a large (above-threshold) document with `hasRealWorker: false` → extraction
  is stopped early with a clear status message, no per-page loop runs.
- `extractPdfText` on a small (at-or-below-threshold) document with `hasRealWorker: false` →
  extraction proceeds and succeeds exactly as it does today.
- No test targets `assessCapabilities`'s internal console-interception mechanism directly —
  only its observable output (the returned flags).

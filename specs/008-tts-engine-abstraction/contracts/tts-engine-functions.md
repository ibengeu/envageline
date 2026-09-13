# Contract: TTS Engine Functions (`pdf-reader/app.js`)

This project has no network API of its own (Kokoro's HTTP API is an external dependency, already
governed by the pipeline's existing loopback-only validation). Its contract surface is the set of
pure/narrowly-scoped functions exported from `app.js` via the `api` object and imported by
`reader.test.js`. This document specifies the new/changed functions for this feature. Field
shapes referenced below are defined in [data-model.md](../data-model.md).

## New: `createKokoroTtsEngine()`

**Purpose**: FR-002. A factory function returning an object satisfying the `TTSEngine` contract
(data-model.md), wrapping today's `fetchLocalAudioBlob` logic exactly.

**Input**: none.

**Output**: an object `{ synthesize }` where `synthesize` is `async (text, options) =>
AudioResult` (data-model.md).

**Behavioral guarantees**:
- `synthesize(text, { voice, speed, endpoint })` performs the same endpoint resolution
  (`localTtsEndpoints`, unchanged), the same request body shape, and the same retry-with-backoff
  behavior `fetchLocalAudioBlob(endpoint, text)` performs today (FR-002).
- Rejects (after exhausting retries) under exactly the same failure conditions
  `fetchLocalAudioBlob` rejects under today — no new failure mode, no suppressed failure mode.
- Never sends `text` to any non-loopback host — the existing loopback-only validation is
  preserved unchanged (FR-006).
- Each call is independent; no shared mutable state across calls (data-model.md's State
  transitions).
- Pure with respect to its inputs modulo the network call itself (i.e. given the same
  `fetch`-level responses, produces the same `AudioResult` or the same rejection).

## New: `defaultTtsEngine`

**Purpose**: FR-004. A module-level `createKokoroTtsEngine()` instance, used as the pipeline's
default engine.

**Behavioral guarantees**:
- Is the engine `localChunkPromise` uses when no other engine is explicitly substituted.
- Satisfies the `TTSEngine` contract identically to any other `createKokoroTtsEngine()` instance
  (it is not special-cased).

## Extended: `localChunkPromise(index)`

**Purpose**: FR-003. Updated to call `defaultTtsEngine.synthesize(chunkText, { voice, speed,
endpoint })` instead of `fetchLocalAudioBlob(endpoint, chunkText)`, reading `result.blob` for the
audio data and `result.synthesisMs` in place of its own external timing measurement when
recording to the EWMA estimator.

**Behavioral guarantees**:
- Caching via `ttsCache` (cache key derivation, get/put) is completely unchanged — it wraps the
  call to `defaultTtsEngine.synthesize` exactly as it previously wrapped the call to
  `fetchLocalAudioBlob` (FR-007).
- `ewma.record(...)` continues to be called with a synthesis-time measurement, now sourced from
  `result.synthesisMs` instead of an externally-measured `Date.now() - t0` (FR-007, unchanged
  observable EWMA behavior).
- For any document/endpoint/voice/speed combination already covered by the existing test suite,
  produces identical observable behavior to before this feature (FR-010, SC-001, SC-002).

## Removed: `fetchLocalAudioBlob`

Superseded by `createKokoroTtsEngine()`'s `synthesize` method — same logic, relocated. No other
function in `app.js` references `fetchLocalAudioBlob` after this refactor (verified by search
before removal, per this project's practice in specs 005/006 when retiring a superseded
constant/function).

## Unchanged: `isLocalTtsEndpoint`, `localTtsEndpoints`, `localVoicesEndpoint`

**Purpose**: Confirmed during specification (plan.md Summary) to be called independently from
`loadLocalVoices` and playback-gating code, outside `fetchLocalAudioBlob`/`synthesize` entirely.
Remain standalone, unchanged functions — `KokoroTtsEngine.synthesize` calls `localTtsEndpoints`
the same way `fetchLocalAudioBlob` already does, without absorbing it into the engine object.

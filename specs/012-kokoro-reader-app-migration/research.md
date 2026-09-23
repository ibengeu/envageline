# Phase 0 Research: Kokoro Narration for the Reader App

No `NEEDS CLARIFICATION` markers were left in the Technical Context — the existing codebase
(both `reader-app/` and `pdf-reader/`) fully determines the integration shape. This document
records the decisions and alternatives considered.

## Decision: Playback mechanism for synthesized audio

**Decision**: Use `HTMLAudioElement` (`new Audio(objectUrl)`) fed by a blob URL created from
the Kokoro server's WAV response (`URL.createObjectURL`), revoked after playback ends.

**Rationale**: `reader-app`'s `TTSEngine.speak()` contract returns a `Promise<void>` that
resolves on natural completion and rejects on cancellation/error — this maps directly onto
`<audio>`'s `ended`/`error` events, the same way `browser-tts.ts` maps
`SpeechSynthesisUtterance`'s `onend`/`onerror` onto the same promise shape. `pause()`/`resume()`/`stop()`
map onto `audio.pause()`, `audio.play()`, and `audio.pause() + audio.currentTime = 0` (plus
revoking the object URL) respectively — native browser behavior, not something to re-implement
or unit test (per constitution Principle III: framework guarantees are not under test).

**Alternatives considered**:
- *Web Audio API (`AudioContext` + `AudioBufferSourceNode`)*: offers finer-grained control
  (e.g., gapless scheduling across chunks) but `AudioBufferSourceNode` cannot be paused and
  resumed — it must be stopped and a new node created, requiring the engine to manually track
  playback offset. This is strictly more complex for no benefit here, since the existing
  contract's pause/resume semantics are already satisfied natively by `<audio>`. Rejected
  under Principle V (simplicity).
- *MediaSource Extensions / streaming playback*: would let playback start before the full
  response downloads, but the Kokoro server returns a single complete WAV body per request
  (no chunked/streaming response), so there is nothing to stream against. Rejected as
  solving a problem that doesn't exist at this layer.

## Decision: Loopback validation strategy

**Decision**: Port the existing `isLocalTtsEndpoint`/`localTtsEndpoints` pattern from
`pdf-reader/app.js` (lines ~2350–2397) into the new Kokoro engine module as small, pure,
independently testable functions: one that validates a URL string is `http(s)://(localhost|127.0.0.1)(:port)?/...`,
and one that resolves the configured base endpoint (defaulting to `http://127.0.0.1:8880`)
before every `/v1/audio/speech` and `/v1/audio/voices` call.

**Rationale**: This exact pattern is already proven in production in `pdf-reader/`'s app and
directly satisfies constitution Principle I's requirement to validate before every request
(not just once). Reusing a proven pattern is lower-risk than inventing a new one, and keeps
cyclomatic complexity low (guard clause + regex test).

**Alternatives considered**:
- *Validate once at app startup / config time*: rejected — constitution explicitly requires
  per-request validation, since a misconfiguration could otherwise change the endpoint after
  the initial check.
- *Allow any endpoint the user configures, with a warning*: rejected — the constitution's
  requirement is a hard reject, not a warn-and-proceed, for SSRF-equivalent protection.

## Decision: Voice model mapping

**Decision**: Map each string voice ID returned by `GET /v1/audio/voices` (e.g. `af_heart`,
`am_michael` — Kokoro's `{lang}{gender}_{name}` convention) into the existing `TTSVoice` shape:
`id` = the raw Kokoro voice string (used verbatim in later `POST /v1/audio/speech` calls),
`name` = a humanized label derived from the id (e.g. "Heart (US Female)"), `lang` = derived
from the id's leading language/locale code (e.g. `af`/`am` → `en-US`, per Kokoro's documented
prefix convention), `localService` = `true` (it is a local server), `default` = `true` only
for the configured default voice (`af_heart`, matching `KOKORO_DEFAULT_VOICE`'s server-side
default).

**Rationale**: Reuses the existing `TTSVoice` interface unchanged (Principle V — no new
type needed), and keeps the human-readable label derivation in one small pure function that's
easy to test against known Kokoro voice ID patterns without needing the live server in tests.

**Alternatives considered**:
- *Extend `TTSVoice` with Kokoro-specific fields*: rejected — the existing shape already
  carries everything the UI needs (id, display name, language, locality, default-ness); adding
  fields would be speculative (YAGNI).
- *Use the raw Kokoro ID as the display name with no humanization*: simpler, but produces a
  poor listener-facing experience (e.g., "af_heart" shown verbatim in a picker). A minimal
  humanization function is a small, worthwhile addition, not scope creep, since voice
  selection is explicitly in scope (User Story 2).

## Decision: Failure classification and surfacing

**Decision**: Classify failures into exactly three observable states, matching spec FR-007/FR-008:
1. **Unavailable** — the loopback fetch itself fails (network error / connection refused),
   surfaced as "local narration is unavailable" within the existing error-state UI pattern.
2. **Synthesis failed** — the server responds but with a non-2xx status (bad voice ID, server
   error), surfaced as a per-passage failure, not a global unavailable state.
3. **Rejected configuration** — the configured endpoint fails the loopback check, surfaced the
   same as "unavailable" since, from the listener's perspective, local narration cannot proceed
   either way; the request is never sent.

**Rationale**: Mirrors the distinct error branches already present in `pdf-reader/app.js`'s
`synthesize()` (fetch failure vs. non-ok response vs. retry exhaustion), which is a
battle-tested classification for this exact server. Keeps `speak()`'s promise rejection
reasons distinguishable so `controller.ts`'s existing error-handling call sites don't need
restructuring — only the engine implementation changes.

**Alternatives considered**:
- *Single generic "TTS failed" error for all cases*: rejected — spec FR-007/FR-008 requires
  the unavailable-server case to be distinguishable enough to show a specific message ("local
  narration is unavailable") rather than a generic per-passage failure.

## Decision: Test strategy for network-dependent behavior

**Decision**: Tests for the new engine inject a fake `fetch` (via a module-level setter,
matching the existing `setTtsEngine` test-hook pattern already present in `pdf-reader/app.js`)
rather than requiring the real Kokoro server to be running. Tests assert observable behavior:
"given a non-loopback configured endpoint, `speak()` rejects without calling fetch", "given a
fetch that resolves with a non-ok response, `speak()` rejects with a synthesis-failure reason",
"given a fetch that never resolves within a bounded fake-timer window, an unavailable state is
reachable" (or equivalent, if a timeout is added — see Open Question below, resolved in favor
of relying on the browser's own fetch/connection-refused rejection since Kokoro runs on
loopback with negligible latency to fail).

**Rationale**: Constitution Principle III forbids testing against a concrete third-party
contract (an actual live server) as a unit-test dependency; behavior must be verified through
the module's own public contract (`TTSEngine.speak/getVoices`) with the network boundary
faked. This is exactly how `reader-app`'s existing `narration/compiler.test.ts` already
operates (pure functions, no live I/O), so this stays consistent with established project
convention.

**Alternatives considered**:
- *Integration test against the real Kokoro server*: valuable as a manual/quickstart
  verification step (see `quickstart.md`) but not as an automated unit test, since it would
  require the Python server + ONNX model to be running in CI, which is out of scope and
  contrary to Principle V (no new required infrastructure for this feature).

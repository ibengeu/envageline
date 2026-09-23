# Phase 1 Data Model: Kokoro Narration for the Reader App

No new persisted entities or storage schema changes. This feature reuses existing
`reader-app` types (`src/reader/core/types.ts`) unchanged, and introduces one new
internal-only concept (endpoint resolution) that is not persisted.

## Reused Entities (unchanged)

### TTSVoice

```ts
interface TTSVoice {
  id: string;           // Kokoro voice id, e.g. "af_heart" — used verbatim in speech requests
  name: string;          // humanized display label, e.g. "Heart (US Female)"
  lang: string;          // derived BCP-47-ish tag, e.g. "en-US"
  localService: boolean; // always true — Kokoro is a local server
  default: boolean;      // true only for the configured default voice
}
```

Populated from `GET /v1/audio/voices` (`{ voices: string[] }`) via the mapping function
documented in `research.md` → Decision: Voice model mapping.

### TTSOptions

```ts
interface TTSOptions {
  rate: number;       // maps to Kokoro's `speed` (0.5–2.0, same bounds already enforced today)
  voiceId: string | null; // a TTSVoice.id, or null to use the default
}
```

Unchanged — Kokoro's `speed` field has the same `[0.5, 2.0]` range the current
`BrowserSpeechEngine` already clamps `rate` to, so no new validation logic is needed beyond
what's already present.

### NarrationSegment

Unchanged. `segment.spokenText` is the text sent as Kokoro's `input` field, exactly as it is
today passed to `SpeechSynthesisUtterance`.

## New Internal-Only Concepts (not persisted, no schema)

### Kokoro Endpoint Configuration

A resolved pair of URLs derived from a single configured base (default
`http://127.0.0.1:8880`):

| Field | Derivation | Example |
|---|---|---|
| `speechUrl` | `{base}/v1/audio/speech` | `http://127.0.0.1:8880/v1/audio/speech` |
| `voicesUrl` | `{base}/v1/audio/voices` | `http://127.0.0.1:8880/v1/audio/voices` |

**Validation rule**: `base` MUST match `^https?://(localhost|127\.0\.0\.1)(:\d+)?$`
(case-insensitive host) before either derived URL is used. Failing this check MUST prevent
any `fetch` call — see `contracts/kokoro-tts-engine.md`.

This configuration is not user-editable UI-side in this feature (per spec Assumptions: "No
new user-facing settings beyond voice selection are required"); it exists purely as an
internal constant with the validation function applied defensively, matching the
constitution's "validated before every request, not just at configuration time" requirement.

### Playback Failure Classification

An internal (non-persisted) discriminant used only to select the right rejection/error
surfaced by `TTSEngine.speak()` and `getVoices()`:

| State | Trigger | Listener-visible outcome |
|---|---|---|
| `endpoint-rejected` | Configured base fails loopback validation | Same message as `unavailable` — request never sent |
| `unavailable` | `fetch` throws (network error, connection refused) | "Local narration is unavailable" message (FR-007) |
| `synthesis-failed` | `fetch` resolves with non-2xx status | Per-passage failure state (FR-008), not global |
| `ok` | `fetch` resolves 2xx, audio decodes and plays | Normal playback |

This mirrors the existing error-handling branches in `pdf-reader/app.js`'s TTS engine (see
`research.md`) and requires no new stored state — it only determines which rejection reason
`speak()`'s returned promise carries, which `controller.ts` already has a call site to catch
and react to.

## State Transitions (Playback Session — unchanged shape, new backing engine)

The existing `PlaybackState` enum (`idle | preparing | playing | paused | buffering |
completed | error`) and its transitions in `controller.ts` are unchanged by this feature. The
only difference is which engine implementation drives `playing ↔ paused` and reaches
`error`/`completed`. No new states are introduced.

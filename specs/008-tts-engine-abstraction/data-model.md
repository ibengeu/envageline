# Phase 1 Data Model: TTS Engine Abstraction

## TTSEngine (contract, not a class — research.md Decision 1)

| Member | Type | Notes |
|---|---|---|
| `synthesize` | `(text: string, options: SynthesisOptions) => Promise<AudioResult>` | The sole method any conforming object must expose. Any object with this method shape satisfies the contract — enforced by documentation and usage, not a runtime type check (research.md Decision 1). |

## SynthesisOptions

| Field | Type | Notes |
|---|---|---|
| `voice` | `string` | The voice identifier, carried forward from today's `elements.voice.value.trim() \|\| "af_heart"` read (research.md Decision 3). |
| `speed` | `number` | The playback-speed multiplier, carried forward from today's `Number(elements.rate.value)` read. |
| `endpoint` | `string` | The configured local TTS endpoint value, carried forward from today's `elements.localEndpoint.value.trim()` read — `KokoroTtsEngine.synthesize` resolves and validates it exactly as `fetchLocalAudioBlob` does today. |

## AudioResult

| Field | Type | Notes |
|---|---|---|
| `blob` | `Blob` | The synthesized audio data — identical to what `fetchLocalAudioBlob` returns directly today, now nested one level under `.blob`. |
| `synthesisMs` | `number \| undefined` | Optional wall-clock synthesis time, replacing the caller's own `Date.now() - t0` measurement (research.md Decision 2). `undefined` is valid — a future engine unable to report timing simply omits it. |

## KokoroTtsEngine (concrete implementation)

Created by `createKokoroTtsEngine()`, a factory function returning an object satisfying the
`TTSEngine` contract. Internally, its `synthesize` method performs exactly the steps
`fetchLocalAudioBlob` performs today:

1. Resolve candidate endpoints via the existing, unchanged `localTtsEndpoints(endpoint,
   "speech")`.
2. Attempt each candidate in order via `fetch`, measuring elapsed time.
3. On success, return `{ blob, synthesisMs }`.
4. On failure, retry with the existing backoff (`waitForRetryDelay`), up to the existing attempt
   limit, before rejecting.

No new validation, retry policy, or endpoint-resolution logic is introduced — this is a
relocation of existing logic into the new shape, per FR-002.

## Validation rules (from Functional Requirements)

- `KokoroTtsEngine.synthesize` MUST reject (or fall through its retry logic identically to today)
  when given a non-loopback `endpoint`, before any `fetch` call is issued (FR-006).
- `synthesize`'s returned `AudioResult.blob` MUST be usable by the caller (`localChunkPromise`)
  without any Kokoro-specific knowledge — the caller reads only `.blob` and optionally
  `.synthesisMs` (FR-005).
- A test double satisfying only `{ synthesize: async (text, options) => ({ blob }) }` MUST be
  usable in place of `defaultTtsEngine` by `localChunkPromise`'s call site without modification
  to `localChunkPromise` itself (FR-011, SC-003).
- For every existing TTS-related test (localhost rejection, endpoint fallback, retry-on-failure,
  prefetching), the observable behavior after this refactor MUST be identical to before it
  (FR-010, SC-001, SC-002) — these tests operate at the `fetch()` mock boundary and require no
  modification.

## State transitions

None — `KokoroTtsEngine` is stateless per call (each `synthesize` invocation is independent,
matching `fetchLocalAudioBlob`'s existing statelessness); `defaultTtsEngine` is a fixed
module-level reference, not mutated at runtime by this spec.

# Contract: KokoroSpeechEngine (implements TTSEngine)

This is the internal TypeScript interface contract the new engine must satisfy — the same
`TTSEngine` interface already defined in `reader-app/src/reader/speech/browser-tts.ts` and
consumed by `reader-app/src/reader/controller.ts`. No new interface is introduced; this
document specifies the *behavioral* contract of the Kokoro-backed implementation.

```ts
export interface TTSEngine {
  initialize(): Promise<void>;
  getVoices(): Promise<TTSVoice[]>;
  speak(segment: NarrationSegment, options: TTSOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}
```

## `initialize()`

- MUST NOT throw even if the Kokoro server is unreachable (mirrors current
  `BrowserSpeechEngine.initialize()`, which never fails). Voice loading failures are deferred
  to `getVoices()`.

## `getVoices(): Promise<TTSVoice[]>`

- MUST validate the configured Kokoro base endpoint is loopback (`localhost`/`127.0.0.1`)
  before calling `fetch`. If invalid, MUST resolve to `[]` without calling `fetch` (fail
  closed, not throw — matches current `loadVoices()`'s `Promise.resolve([])` behavior when
  speech is unsupported).
- On a reachable server: MUST `GET {base}/v1/audio/voices`, map each returned voice string to
  a `TTSVoice` per `data-model.md`, and resolve with the mapped list.
- On an unreachable server (fetch throws) or a non-2xx response: MUST resolve to `[]` (not
  reject) — voice listing failure must not block the rest of the app from rendering a "no
  voices available" state, consistent with how an empty array is already handled by
  `pickDefaultVoice`.

## `speak(segment, options): Promise<void>`

- MUST validate the configured Kokoro base endpoint is loopback before calling `fetch`. If
  invalid, the returned promise MUST reject immediately with a distinguishable error (e.g.
  `DOMException("endpoint-rejected", "SecurityError")` or equivalent) and MUST NOT call
  `fetch`.
- If `segment.spokenText.trim()` is empty, MUST resolve immediately without any network call
  (matches current `BrowserSpeechEngine.speak()` short-circuit).
- MUST `POST {base}/v1/audio/speech` with JSON body `{ input: spokenText, voice: options.voiceId ?? defaultVoiceId, response_format: "wav", speed: clamp(options.rate, 0.5, 2.0) }`.
  `spokenText` MUST appear only in the JSON body, never interpolated into the URL (OWASP
  A06 mitigation, per plan's Security Review).
- On a network-level failure (fetch throws): the returned promise MUST reject with an
  "unavailable" classification (e.g. `DOMException("unavailable", "NotSupportedError")` or
  equivalent), distinguishable from a synthesis failure.
- On a non-2xx HTTP response: the returned promise MUST reject with a "synthesis-failed"
  classification (matches the existing `browser-tts.ts` pattern of distinct rejection
  reasons for `synthesis-failed`/`synthesis-unavailable`).
- On a 2xx response: MUST construct a blob URL from the response body, play it via an
  `HTMLAudioElement`, and resolve the promise when playback ends naturally (`ended` event).
- If `stop()` is called while a `speak()` call is in flight or playing, the in-flight
  promise MUST reject with a cancellation classification (e.g.
  `DOMException("canceled", "AbortError")`), matching `browser-tts.ts`'s existing contract
  for cancellation, so `controller.ts`'s existing catch logic (which already special-cases
  `AbortError`) needs no changes.

## `pause()` / `resume()` / `stop()`

- `pause()`: MUST pause the currently playing `<audio>` element without resetting its
  position. MUST be a no-op if nothing is playing.
- `resume()`: MUST resume playback from the paused position. MUST be a no-op if nothing is
  paused.
- `stop()`: MUST pause playback, reset position, and release the object URL
  (`URL.revokeObjectURL`). Any in-flight `speak()` promise MUST reject per the cancellation
  rule above.

## Non-goals for this contract

- No retry logic is required beyond what the browser's own `fetch` provides — unlike
  `pdf-reader/app.js`'s multi-endpoint retry-with-backoff (which exists there to also probe
  alternate ports), this feature has exactly one configured base endpoint and surfaces
  failure immediately, per spec FR-007/FR-008's requirement for a *clear* failure state
  (a hidden retry loop would delay that).

# Contract: Kokoro voice manager (replaces voice-manager.ts)

Replaces `reader-app/src/reader/speech/voice-manager.ts`'s three exports with Kokoro-backed
equivalents. Call sites in `controller.ts` (`isSpeechSupported`, `pickDefaultVoice`) keep the
same names and signatures so the only changed line at the call site is the import path.

```ts
export function isSpeechSupported(): boolean;
export function loadVoices(): Promise<TTSVoice[]>;
export function pickDefaultVoice(voices: TTSVoice[], preferredId: string | null): string | null;
```

## `isSpeechSupported(): boolean`

- Current behavior: `typeof window !== "undefined" && "speechSynthesis" in window` — a
  synchronous capability check.
- New behavior: since Kokoro reachability can only be known asynchronously (a network call),
  this function's contract narrows to a synchronous, best-effort check: `typeof window !==
  "undefined" && typeof fetch === "function"` (i.e., "could this environment possibly reach a
  local server"), NOT "is the Kokoro server actually running." Actual reachability is
  discovered by `loadVoices()`/`speak()` returning empty/rejecting, which `controller.ts`
  already has to handle (spec FR-007).
- Rationale: keeps this function's contract synchronous (unchanged call-site shape — no
  `await` needed where none exists today) while pushing the real reachability check to where
  the app already has async error-handling (`initialize()`/`getVoices()`/`speak()`).

## `loadVoices(): Promise<TTSVoice[]>`

- MUST perform the loopback validation and `GET /v1/audio/voices` call described in
  `kokoro-tts-engine.md`'s `getVoices()` contract (this function IS that implementation;
  `KokoroSpeechEngine.getVoices()` delegates to it, mirroring how `BrowserSpeechEngine`
  delegates to `voice-manager.ts`'s `loadVoices()` today).
- MUST resolve to `[]` on any failure (invalid endpoint, network error, non-2xx), never
  reject — matches current contract exactly.

## `pickDefaultVoice(voices, preferredId): string | null`

- Behavior is UNCHANGED from the current implementation's logic shape: if `preferredId` is
  present in `voices`, return it; otherwise prefer an English-tagged voice, then a
  `localService` voice, then the server's marked `default` voice, then the first available;
  return `null` if `voices` is empty.
- Since every Kokoro voice is `localService: true`, the "prefer local" tier is always
  satisfied trivially — this is fine and requires no special-casing; the function's existing
  generic logic (already written against the `TTSVoice` shape, not against
  `SpeechSynthesisVoice`) works unchanged. **This function may be reused verbatim, not
  reimplemented** — only `loadVoices`'s internals and `isSpeechSupported`'s definition change.

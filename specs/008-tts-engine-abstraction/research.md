# Phase 0 Research: TTS Engine Abstraction

No `NEEDS CLARIFICATION` markers remain — the scope was fixed with the user before this spec was
written (interface-only, zero behavior change, no merge with spec 009). Research here pins down
the interface's concrete shape and how it's wired into the one existing call site.

## Decision 1: TTSEngine as a documented duck-typed contract, not a class

**Decision**: `TTSEngine` is documented (in a comment directly above `createKokoroTtsEngine`) as
a contract: any object exposing an `async synthesize(text, options) -> AudioResult` method
satisfies it. No `class TTSEngine { ... }` base/abstract type is introduced. `KokoroTtsEngine` is
a factory function, `createKokoroTtsEngine()`, returning a plain object literal with a
`synthesize` method — not a `class KokoroTtsEngine extends TTSEngine`.

**Rationale**: This codebase has zero existing class usage (`app.js` is entirely function-based,
consistent with specs 001-007's style) — introducing the first class specifically for a
single-implementation interface would be a stylistic outlier and, per Principle V, unwarranted
abstraction for what a plain object with a documented method shape already satisfies. JavaScript
has no structural interface enforcement regardless of whether a base class exists, so a class
hierarchy buys no compile-time safety here — it would be ceremony, not protection. A test double
(SC-003) is trivially just `{ synthesize: async () => ({ blob }) }`.

**Alternatives considered**:
- *A `class TTSEngine` with an abstract/throwing `synthesize`, extended by `class
  KokoroTtsEngine`*: rejected — introduces a new pattern (classes) to a codebase that has never
  used one, for no behavioral benefit over duck-typing in an untyped language. This is exactly
  the kind of "abstraction for hypothetical future requirements" Principle V's YAGNI guidance
  warns against, especially since this spec ships only one implementation.
- *TypeScript-style JSDoc `@typedef`/`@interface` annotations*: worth doing as documentation
  (and this plan does include a comment-based contract), but does not by itself change the
  implementation shape — the underlying object is still a plain factory-returned literal either
  way.

## Decision 2: AudioResult shape

**Decision**: `synthesize` resolves to `{ blob, synthesisMs }`:

```text
AudioResult:
  blob: Blob           // the synthesized audio, same Blob fetchLocalAudioBlob returns today
  synthesisMs: number  // wall-clock time the synthesis call took, optional (may be undefined)
```

`localChunkPromise` is updated to read `result.blob` (instead of using the returned Blob
directly) and to call `ewma.record(result.synthesisMs)` in place of its own `Date.now() - t0`
measurement — but `KokoroTtsEngine.synthesize` computes that measurement exactly the same way
`fetchLocalAudioBlob` does today (`Date.now()` around the fetch call), just returning it as data
instead of the caller measuring it externally.

**Rationale**: Keeps the audio data itself trivially accessible (`result.blob`, not a nested
Kokoro-specific structure) while carrying forward the one piece of synthesis metadata a caller
(the EWMA estimator) already depends on today — satisfying FR-005's "MAY include a
synthesis-time measurement" without inventing metadata no current caller needs. Making
`synthesisMs` optional (rather than mandatory) matches spec.md's Edge Case about a future engine
that cannot supply timing data.

**Alternatives considered**:
- *`synthesize` returns the bare `Blob` directly (no wrapper), with timing measured externally by
  the caller as today*: rejected — this would mean the interface contract is "returns whatever
  Kokoro's response shape naturally is," which doesn't actually generalize to a future engine
  that might need to report something engine-specific (even if only timing, for now). A minimal
  wrapper object is the smallest change that makes the contract genuinely engine-agnostic per
  FR-005.
- *A richer `AudioResult` also carrying format/sample-rate/duration metadata*: rejected as
  speculative — no current caller uses any of that; FR-005 only requires audio data plus
  "MAY include" synthesis time, and Principle V disfavors modeling fields nothing consumes yet.

## Decision 3: Synthesis options shape

**Decision**: `options` passed to `synthesize` is `{ voice, speed, endpoint }` — exactly the
three parameters `fetchLocalAudioBlob(endpoint, chunkText, attempt)` and its internal reads of
`elements.voice.value`/`elements.rate.value` already use today, just made explicit as a plain
object rather than a positional `endpoint` argument plus implicit UI-element reads.

**Decision on `attempt`**: The retry-attempt counter stays entirely internal to
`KokoroTtsEngine.synthesize`'s own recursive retry logic (as it is today inside
`fetchLocalAudioBlob`) — it is not part of the public `options` a caller supplies, since retry
policy is implementation-specific per spec.md's Edge Cases ("retry-with-backoff... stays inside
`KokoroTtsEngine`'s implementation... the `TTSEngine` interface itself does not mandate retry
behavior").

**Rationale**: `localChunkPromise` already has `voice`/`speed`/`endpoint` values on hand from
reading UI elements before this refactor — passing them explicitly as an options object (rather
than the engine reading `elements.voice.value` itself) is what actually decouples the engine from
the DOM, which is necessary for a test double to be usable without a real DOM (SC-003's
requirement that a test double needs no Kokoro-specific — or DOM-specific — knowledge).

**Alternatives considered**:
- *`KokoroTtsEngine.synthesize` reads `elements.voice.value`/`elements.rate.value` directly,
  matching `fetchLocalAudioBlob`'s current internal behavior exactly*: rejected — this would
  leave the engine implicitly coupled to the DOM/UI element structure, which defeats
  substitutability (a test double or a future non-browser engine would need fake DOM elements
  just to be called), undermining SC-003. Explicit options is a strict improvement here with no
  behavior change, since `localChunkPromise` already has these values in scope at its call site.

## Assumptions carried into Phase 1

- `localChunkPromise` remains the sole caller of the `TTSEngine` interface for this spec; no
  other call site (e.g. voice-loading, which uses `localVoicesEndpoint` for a different purpose)
  is routed through `synthesize`.
- The module-level default engine instance name is `defaultTtsEngine`, matching this project's
  existing lowerCamelCase convention for module-level singletons (e.g. `ewma`, `ttsCache`).

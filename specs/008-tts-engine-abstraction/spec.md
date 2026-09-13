# Feature Specification: TTS Engine Abstraction

**Feature Branch**: `008-tts-engine-abstraction`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: fifth subsystem of a multi-spec effort to evolve the existing Smart
PDF Reading pipeline (`pdf-reader/app.js`, from specs 001-007) toward the "PDF → structured
spoken-document representation" architecture described in a full system design document (Mobile
PDF-to-Speech Reader). Today, `fetchLocalAudioBlob` is a Kokoro-specific function that directly
builds an HTTP request shaped like Kokoro's OpenAI-compatible `/v1/audio/speech` API and returns a
raw `Blob`, called directly from `localChunkPromise` (which also owns caching, prefetching, and
endpoint/voice/speed lookup). There is no interface boundary between "the pipeline needs audio for
this text" and "here is exactly how Kokoro's specific API is called." This spec introduces a
`TTSEngine` interface and a `KokoroTtsEngine` implementation wrapping the existing logic exactly,
with zero behavior change — this is an interface-introduction spec, not a new engine, not a
caching change, not a UI change, and not a change to the text pipeline (specs 004-007).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nothing changes for a listener today (Priority: P1)

A listener who was already using the reader before this change loads documents, plays audio,
and experiences the same caching, prefetching, retry behavior, and localhost-only security
validation as before — no difference in what they hear, how quickly it starts, or how failures
are handled.

**Why this priority**: Like every foundation-laying refactor in this sequence (specs 004-007),
if this abstraction changes any observable audio behavior, it has failed at being a safe
foundation for a future engine swap — the whole point is that introducing the seam costs nothing
today.

**Independent Test**: Run the full existing test suite after the change and confirm every
existing TTS-related behavioral test (localhost-only validation, endpoint fallback,
retry-on-failure, prefetching) passes unmodified, with no test needing to be rewritten to
tolerate a behavior change.

**Acceptance Scenarios**:

1. **Given** a local TTS endpoint that is not localhost/127.0.0.1, **When** playback is
   attempted, **Then** the request is rejected before any text is sent, exactly as it is today.
2. **Given** a same-origin local endpoint that becomes unavailable, **When** playback is
   attempted, **Then** the reader falls back to `localhost:8880` exactly as it does today.
3. **Given** a synthesis request that fails, **When** playback is active, **Then** the reader
   retries with the same backoff behavior as today.
4. **Given** the existing prefetch-ahead behavior driven by the EWMA response-time estimator,
   **When** chunks are queued for playback, **Then** prefetching behaves identically to today.

---

### User Story 2 - The pipeline depends on an interface, not on Kokoro specifically (Priority: P1)

A developer adding a future TTS engine (or writing a test that needs audio without a real network
call) can provide any object implementing the `TTSEngine` interface's `synthesize(text, options)`
method in place of the Kokoro-backed implementation, without touching any Kokoro-specific request-
building code.

**Why this priority**: This is the actual point of the spec — closing the "pipeline should never
depend directly on Kokoro" gap identified against the project's architecture goal. Ranked
alongside User Story 1 as P1 because an abstraction that isn't actually substitutable (e.g. one
that still leaks Kokoro-specific assumptions into its caller) hasn't achieved its purpose.

**Independent Test**: Construct a minimal test double implementing the `TTSEngine` interface
(returning a synthetic audio result without any network call) and confirm it can be substituted
for the default Kokoro-backed engine in a test, with no test code needing to know about Kokoro's
specific request/response shape.

**Acceptance Scenarios**:

1. **Given** a test double implementing `synthesize(text, options)`, **When** it is substituted
   for the default engine, **Then** the caller (`localChunkPromise`) successfully obtains audio
   from it without any code path referencing Kokoro-specific request fields.
2. **Given** the `KokoroTtsEngine` implementation, **When** its `synthesize` method is called,
   **Then** it performs exactly the same endpoint resolution, request shape, and retry behavior
   `fetchLocalAudioBlob` performs today.

### Edge Cases

- What happens to the response-time value the existing EWMA lookahead estimator records? The
  `TTSEngine` interface's synthesis result carries the measured synthesis time as data (not by
  having `synthesize` itself call into the EWMA estimator), so the caller (`localChunkPromise`)
  continues to own recording it — the interface does not entangle audio synthesis with playback-
  timing orchestration, which is a separate concern this spec does not touch.
- What happens to the audio cache (`ttsCache`) and its cache-key derivation? Entirely unchanged —
  caching remains the caller's responsibility, wrapping calls to the `TTSEngine` interface exactly
  as it previously wrapped calls to `fetchLocalAudioBlob`.
- What happens if a future engine cannot supply a synthesis-time measurement (e.g. a bundled,
  instant on-device engine)? The synthesis-time field on the result is optional; a caller that
  depends on it (the EWMA estimator) already tolerates absent/first-call data today, so no new
  handling is required by this spec.
- What happens to the retry-with-backoff behavior — does it belong inside `synthesize` or outside
  it? It stays inside `KokoroTtsEngine`'s implementation of `synthesize`, exactly where
  `fetchLocalAudioBlob`'s retry loop lives today — the `TTSEngine` interface itself does not
  mandate retry behavior, since that is an implementation-specific reliability concern, not part
  of the contract every engine must expose identically.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The pipeline MUST define a `TTSEngine` interface exposing a `synthesize(text,
  options)` method that returns a Promise resolving to an audio result.
- **FR-002**: The pipeline MUST provide a `KokoroTtsEngine` implementation of `TTSEngine` that
  performs the same endpoint resolution (loopback-only validation, same-origin/localhost-fallback
  behavior), the same request shape, and the same retry-with-backoff behavior that
  `fetchLocalAudioBlob` performs today.
- **FR-003**: `localChunkPromise` (or its equivalent after this refactor) MUST obtain audio via
  the `TTSEngine` interface rather than by calling Kokoro-specific request-building logic
  directly.
- **FR-004**: The default `TTSEngine` instance used by the pipeline MUST be a `KokoroTtsEngine`,
  preserving today's default behavior when no other engine is configured.
- **FR-005**: The audio result returned by `synthesize` MUST include the synthesized audio data
  and MAY include a synthesis-time measurement, but MUST NOT require the caller to know
  Kokoro-specific details (response format internals, endpoint paths) to make use of the audio
  data.
- **FR-006**: The existing loopback-only validation for any local TTS endpoint (constitution
  Principle I) MUST continue to be enforced exactly where it is enforced today — at the
  playback-initiation call site, before `synthesize` is ever reached — and this refactor MUST NOT
  move, duplicate, or weaken that check. **Correction after implementation began**: this
  requirement originally assumed the check lived inside `fetchLocalAudioBlob`/`synthesize`
  itself; inspecting the pre-008 code directly showed the check has only ever lived in the
  caller (the playback-initiation gate), never inside the synthesis function. `synthesize` itself
  performs no endpoint-trust validation before or after this refactor — that is unchanged
  behavior, not a gap this spec introduces or must close.
- **FR-007**: This feature MUST NOT change the existing audio cache (`ttsCache`) internals, cache
  key derivation, prefetching logic, or EWMA-based lookahead calculation.
- **FR-008**: This feature MUST NOT change any block classification, speech policy, text
  normalization, or chunking logic from specs 004-007.
- **FR-009**: This feature MUST NOT modify `index.html`, `styles.css`, or any reader control — no
  user-facing settings surface (e.g. an engine picker) is introduced by this spec.
- **FR-010**: For every existing TTS-related behavior already covered by the test suite
  (localhost-only rejection, endpoint fallback, retry-on-failure, prefetching), the pipeline MUST
  produce identical observable behavior after this refactor, verified without rewriting any
  pre-existing test.
- **FR-011**: The `TTSEngine` interface MUST be substitutable in a test with a minimal test
  double (no real network call) without that test needing any Kokoro-specific knowledge.

### Key Entities *(include if feature involves data)*

- **TTSEngine**: An interface with one method, `synthesize(text, options)`, returning a Promise
  of an audio result. Any implementation (Kokoro-backed today; a future engine later) must honor
  this contract; the pipeline's audio-consuming code depends only on this interface.
- **KokoroTtsEngine**: The concrete `TTSEngine` implementation wrapping today's Kokoro-specific
  HTTP request logic (endpoint resolution, request shape, retry-with-backoff), replacing
  `fetchLocalAudioBlob` as a standalone function with an object method of the same behavior.
- **Synthesis Options**: The per-request parameters a caller supplies to `synthesize` (voice,
  speed, and any endpoint override) — carrying forward exactly the parameters
  `fetchLocalAudioBlob` already accepts today, not a new configuration surface.
- **Audio Result**: The value `synthesize` resolves to — the synthesized audio data plus an
  optional synthesis-time measurement, replacing today's bare `Blob` return value with a small
  wrapper that keeps the audio data equally accessible to existing callers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the existing behavioral test suite (186 tests as of spec 007's cleanup)
  continues to pass unmodified after this feature, with no pre-existing test needing rewriting to
  tolerate a behavior change.
- **SC-002**: Every existing TTS-related behavioral test (localhost-only rejection, endpoint
  fallback, retry-on-failure, prefetching) passes against the new `TTSEngine`-mediated code path
  with zero test modifications.
- **SC-003**: A test double implementing only the `TTSEngine` interface can be substituted for
  the default engine and successfully used by the pipeline's audio-consuming code, verified by at
  least one new test that contains no Kokoro-specific request/response knowledge.
- **SC-004**: The `KokoroTtsEngine` implementation, when inspected, performs identical endpoint
  resolution, request construction, and retry behavior to the pre-008 `fetchLocalAudioBlob`
  function it replaces — verified by at least one new test exercising each of those three
  behaviors directly against `KokoroTtsEngine`.

## Assumptions

- No new TTS engine (Piper, Sherpa-ONNX, platform TTS) is implemented by this spec — only the
  interface and the Kokoro-backed implementation of it, per the "interface-introduction only"
  scope agreed for this feature.
- No persistence or user-facing selection of which engine to use is introduced; the pipeline
  continues to use a single, module-level default `KokoroTtsEngine` instance, matching today's
  single-engine behavior.
- The EWMA lookahead estimator, the audio cache, and all playback/prefetch orchestration remain
  entirely the caller's (`localChunkPromise`'s) responsibility; this spec does not move any of
  that logic into `TTSEngine` or `KokoroTtsEngine`.
- "Behavior-preserving" is verified primarily through the existing test suite's continued passage
  (these tests operate at the `fetch()` mock level, agnostic to internal refactoring), plus new
  tests targeting `KokoroTtsEngine` and the substitutability of a test double directly.

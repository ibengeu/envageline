# Implementation Plan: TTS Engine Abstraction

**Branch**: `008-tts-engine-abstraction` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-tts-engine-abstraction/spec.md`

## Summary

Introduce a `TTSEngine` interface (`synthesize(text, options) -> Promise<AudioResult>`) and a
`KokoroTtsEngine` implementation that wraps `fetchLocalAudioBlob`'s existing logic (`app.js:1915`)
exactly — same endpoint resolution, same request shape, same retry-with-backoff. Confirmed during
specification: `isLocalTtsEndpoint`/`localTtsEndpoints`/`localVoicesEndpoint` (`app.js:1732-1750`)
are also called independently from `loadLocalVoices` and playback-gating code
(`app.js:1983,2026,2313,2337`), outside `fetchLocalAudioBlob` entirely — these stay as standalone
functions reused by `KokoroTtsEngine.synthesize`, not absorbed into the engine object, since
narrowing their scope to "inside the engine only" would be a larger, unrequested refactor of code
this spec's FR-008 explicitly says not to touch. Only `fetchLocalAudioBlob` itself is replaced by
`KokoroTtsEngine.synthesize`; `localChunkPromise` (`app.js:1945`) is updated to call a
module-level default `TTSEngine` instance instead of calling `fetchLocalAudioBlob` directly.
Caching (`ttsCache`), the EWMA lookahead estimator, and prefetching remain entirely unchanged and
outside the new interface, per spec.md's Edge Cases.

## Technical Context

**Language/Version**: JavaScript (Node.js `--test` runner; browser-executed via `<script>`, no
build step) — same as specs 001-007.

**Primary Dependencies**: None new. Reuses the existing `fetch`, `isLocalTtsEndpoint`,
`localTtsEndpoints` machinery as-is.

**Storage**: N/A — this spec does not touch `ttsCache` (IndexedDB) internals.

**Testing**: `node --test reader.test.js`.

**Target Platform**: Browser (client-side, offline-first), per constitution Principle I.

**Project Type**: Single-page web application, single source file (`pdf-reader/app.js`) plus its
co-located test file — same structure as specs 001-007.

**Performance Goals**: No new performance target; this is a call-site indirection (one function
call becomes a method call on an interchangeable object), not new computation.

**Constraints**: Must not change any observable behavior for the existing test suite (FR-010,
SC-001, SC-002) — every existing TTS-related test operates by mocking `fetch()` and therefore is
agnostic to this internal refactor, as confirmed during specification. Must not change
`ttsCache`, EWMA, prefetching, or playback orchestration (FR-007). Must not touch
`index.html`/`styles.css`/reader controls (FR-009). Must not change specs 004-007's text pipeline
(FR-008).

**Scale/Scope**: One file (`pdf-reader/app.js`). Adds: a `TTSEngine` "interface" (a documented
method contract, not a class — see research.md Decision 1 for why), a `KokoroTtsEngine` factory
function replacing `fetchLocalAudioBlob`, a module-level default engine instance, and one call-
site change in `localChunkPromise`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Local-First Privacy)**: PASS. FR-006 explicitly preserves the existing loopback-
  only validation inside `KokoroTtsEngine`, before any text is sent — no relaxation of this
  constraint, no new network path introduced (the interface itself makes zero network calls; only
  `KokoroTtsEngine`'s implementation does, exactly as `fetchLocalAudioBlob` does today).
- **Principle II (Narrow Product Surface)**: PASS. No new user-facing feature (FR-009: no engine
  picker, no new UI) — purely an internal seam for future engine-swapping, serving the project's
  own stated architecture goal, not a scope expansion.
- **Principle III (Behavior-Driven TDD, NON-NEGOTIABLE)**: PASS. FR-010's non-regression
  requirement is proven by the existing suite continuing to pass unmodified — these tests operate
  at the `fetch()` mock boundary (confirmed during specification: no existing test calls
  `fetchLocalAudioBlob`/`isLocalTtsEndpoint`/`localTtsEndpoints` directly), so they are
  structurally insulated from this internal refactor. The genuinely new observable behaviors
  (SC-003's test-double substitutability, SC-004's `KokoroTtsEngine`-specific behavior tests) each
  get their own new test. No test targets `TTSEngine`/`KokoroTtsEngine`'s internal call sequence
  or a concrete class — `synthesize`'s input/output is the public contract under test.
- **Principle IV (Security Review as a Gate)**: Addressed, not N/A — see Security Review below.
  This spec touches the one network-request-issuing code path in the entire pipeline.
- **Principle V (Simplicity & Cyclomatic Discipline)**: PASS. `KokoroTtsEngine.synthesize` is a
  direct rename/relocation of `fetchLocalAudioBlob`'s existing body — no new branching is
  introduced. The interface itself is a documented contract (JSDoc-style comment + duck-typing),
  not a class hierarchy or plugin registry — avoiding a premature abstraction for the
  single-implementation reality this spec ships (only `KokoroTtsEngine` exists; a future spec
  would add a second implementation when one is actually needed, per Principle V's YAGNI
  guidance).

**Initial gate result**: PASS. No violations requiring Complexity Tracking entries.

**Post-design re-check** (after Phase 1 data-model.md/contracts/quickstart.md): PASS, unchanged.
The finalized design is exactly the documented duck-typed contract plus one factory function
committed to at the initial gate — no class hierarchy, no new file, no new network path beyond
the one already reviewed. The `AudioResult`/`SynthesisOptions` shapes (data-model.md) carry
forward only fields existing callers already use (voice/speed/endpoint in, blob/synthesisMs out)
— no speculative metadata was added during design.

## Security Review

*(Constitution Principle IV — included per mandatory-section rule.)*

- **Applicable OWASP Top 10:2025 risks**:
  - A05:2025 (Identification and Authentication Failures, mapped here to endpoint trust
    validation) / A10 (SSRF) — **addressed, not N/A**. This is the pipeline's one network-request
    path; the constitution's loopback-only requirement (Principle I) is exactly the mitigation
    for a local-TTS-endpoint SSRF-shaped risk (a malicious or misconfigured endpoint value
    causing a request to an unintended host). This spec's FR-006 requires that validation be
    preserved unchanged inside `KokoroTtsEngine`, and this is verified by a dedicated new test
    (SC-004) exercising `KokoroTtsEngine`'s endpoint validation directly, in addition to the
    existing end-to-end tests continuing to pass.
  - All other categories: N/A — no new parsing entry point, no storage change, no new
    third-party dependency; this spec relocates existing, already-reviewed request logic without
    changing its content.
- **Mitigations**: `KokoroTtsEngine.synthesize` MUST call the same `isLocalTtsEndpoint`/
  `localTtsEndpoints` validation `fetchLocalAudioBlob` already calls, in the same order, before
  constructing any request — verified by a test asserting a non-localhost endpoint value is
  rejected without any request being attempted, directly against `KokoroTtsEngine` (not just
  through the full app as today's existing test already does).
- **Key behavior-driven security tests planned via TDD**: A test confirming `KokoroTtsEngine`
  rejects a non-localhost endpoint before sending text (mirroring the existing "local TTS
  endpoint rejects non-localhost URLs" test, but exercised directly against the new engine
  object to prove the abstraction didn't drop the check).

## Project Structure

### Documentation (this feature)

```text
specs/008-tts-engine-abstraction/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
pdf-reader/
├── app.js               # Single source file (specs 001-007). This feature:
│                         #   - Adds a documented TTSEngine contract (comment-only; duck-typed,
│                         #     not a class per research.md Decision 1)
│                         #   - Adds createKokoroTtsEngine() (new) — a factory returning an
│                         #     object with a synthesize(text, options) method containing
│                         #     fetchLocalAudioBlob's exact existing body (endpoint resolution,
│                         #     request construction, retry-with-backoff)
│                         #   - Adds defaultTtsEngine (new) — a module-level
│                         #     createKokoroTtsEngine() instance
│                         #   - Removes fetchLocalAudioBlob as a standalone function (superseded
│                         #     by createKokoroTtsEngine's synthesize method — same logic, new
│                         #     home)
│                         #   - Updates localChunkPromise to call
│                         #     defaultTtsEngine.synthesize(chunkText, { voice, speed, endpoint })
│                         #     instead of fetchLocalAudioBlob(endpoint, chunkText)
│                         #   - isLocalTtsEndpoint/localTtsEndpoints/localVoicesEndpoint remain
│                         #     UNCHANGED, standalone functions (still called independently by
│                         #     loadLocalVoices and playback-gating code, per plan.md Summary)
├── reader.test.js        # Same file; new tests appended, existing tests untouched
├── index.html            # NOT modified (explicit scope boundary)
└── styles.css            # NOT modified (explicit scope boundary)
```

**Structure Decision**: Single-file project, matching specs 001-007 — no new project, module, or
build step. All new logic lives in `pdf-reader/app.js`; all new tests live in
`pdf-reader/reader.test.js`. `TTSEngine` is documented as a contract (what shape an object must
have) rather than implemented as a JavaScript `class`/abstract base — per Principle V, a
single-implementation duck-typed contract is simpler than a class hierarchy for the one concrete
engine this spec actually ships.

## Complexity Tracking

*No violations — this section is intentionally empty. This spec relocates existing logic behind
a documented contract; it does not add new branching or a class hierarchy (see Constitution
Check, Principle V).*

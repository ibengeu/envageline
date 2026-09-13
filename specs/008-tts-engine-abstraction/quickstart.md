# Quickstart: Validating the TTS Engine Abstraction

Validates the new interface boundary end-to-end once implemented, without duplicating the full
behavior spec (see [spec.md](./spec.md)) or contract details (see
[contracts/tts-engine-functions.md](./contracts/tts-engine-functions.md)).

## Prerequisites

- No new dependencies to install — this feature adds code only to `pdf-reader/app.js` and tests
  only to `pdf-reader/reader.test.js`.
- Node.js available for running the automated test suite.
- `index.html`/`styles.css` are explicitly out of scope — no manual UI validation step required.

## Automated validation

From the repository root:

```sh
cd pdf-reader
node --test reader.test.js
```

Expected: **all existing tests continue to pass, unmodified** (SC-001) — including every existing
TTS-related behavioral test (localhost-only rejection, endpoint fallback, retry-on-failure,
prefetching), with zero test-file edits to those pre-existing tests (SC-002). Plus new tests
covering:

- `createKokoroTtsEngine().synthesize` rejects a non-localhost endpoint before any request is
  attempted, exercised directly against the engine object (not just through the full app), per
  the Security Review's stated mitigation-verification approach.
- `createKokoroTtsEngine().synthesize` performs the same same-origin-then-`localhost:8880`
  fallback behavior `fetchLocalAudioBlob` performs today.
- `createKokoroTtsEngine().synthesize` retries on failure with the same behavior as today.
- A minimal test double (`{ synthesize: async () => ({ blob }) }`, containing zero Kokoro-specific
  knowledge) can be substituted for `defaultTtsEngine` and successfully used by the pipeline's
  audio-consuming code (SC-003).
- `defaultTtsEngine` is a `createKokoroTtsEngine()` instance, confirming FR-004's default-engine
  requirement.

## Manual validation

Not required for this feature — same reasoning as specs 004-007: no UI or user-observable control
surface changes; the automated suite is the complete validation surface for this internal
refactor.

## Success criteria mapping

- SC-001 (100% of existing suite passes unmodified) → `node --test reader.test.js` full pass with
  zero pre-existing test file edits.
- SC-002 (every existing TTS-related test passes against the new code path) → same run,
  specifically the localhost-rejection/fallback/retry/prefetch tests already in the suite.
- SC-003 (test-double substitutability) → the dedicated new test-double test.
- SC-004 (`KokoroTtsEngine` matches pre-008 `fetchLocalAudioBlob` behavior directly) → the three
  new tests exercising endpoint resolution, request construction, and retry directly against
  `createKokoroTtsEngine()`.

## Out of scope for this validation pass

Any new TTS engine implementation beyond `KokoroTtsEngine`, any user-facing engine selection UI,
and any change to `ttsCache`/EWMA/prefetching behavior are not implemented or validated here — all
deferred per spec.md's Assumptions, consistent with this feature's interface-introduction-only
scope.

# Quickstart: Validating the Speech Policy Engine

Validates the new configurable speech policy end-to-end once implemented, without duplicating the
full behavior spec (see [spec.md](./spec.md)) or contract details (see
[contracts/speech-policy-functions.md](./contracts/speech-policy-functions.md)).

## Prerequisites

- No new dependencies to install — this feature adds code only to `pdf-reader/app.js` and tests
  only to `pdf-reader/reader.test.js`.
- Node.js available for running the automated test suite.
- `index.html`/`styles.css` are explicitly out of scope — no manual UI validation step is
  required or expected.

## Automated validation

From the repository root:

```sh
cd pdf-reader
node --test reader.test.js
```

Expected: **all existing tests continue to pass, unmodified** (SC-001) — this includes spec 004's
own regression baseline test, which must still hold byte-for-byte since the default policy
reproduces `NARRATION_EXCLUDED_TYPES` exactly. Plus new tests covering:

- `shouldSpeak(type, DEFAULT_SPEECH_POLICY)` matches the old `NARRATION_EXCLUDED_TYPES`-based
  result for every block type the pipeline currently produces (the data-model.md table, made
  executable).
- `resolveSpeechPolicy()`/`resolveSpeechPolicy({})` equal `DEFAULT_SPEECH_POLICY`.
- `resolveSpeechPolicy({ oneField: ... })` changes only that field, leaving every other field at
  its default value.
- Overriding one policy field (e.g. `speakFootnotes: true`) changes both `buildDocumentAst`'s
  per-block `speak` flag AND `renderNarrationText`'s inclusion for that block type, consistently,
  for a document containing that type.
- Overriding the `tables` field away from `"skip"` changes both outputs consistently for a table
  block, exercising the non-boolean field.
- `buildPipelineOutput` called with no `policy` argument produces `displayText`/`narrationText`/
  `document` identical to the pre-005 baseline.

## Manual validation

Not required for this feature — same reasoning as spec 004: no UI or user-observable surface
changes (no settings control is introduced), so the automated suite is the complete validation
surface.

## Success criteria mapping

- SC-001 (100% of existing suite passes unmodified) → `node --test reader.test.js` full pass with
  zero pre-existing test file edits.
- SC-002 (default policy output identical to pre-005 baseline for every block type) →
  `shouldSpeak`/`DEFAULT_SPEECH_POLICY` table test + spec 004's own regression baseline test
  continuing to pass unmodified.
- SC-003 (one field change propagates consistently to both outputs) → the footnote-override and
  tables-override tests above.
- SC-004 (a partial override leaves every other field at its default) →
  `resolveSpeechPolicy` per-field independence test, exercised across all boolean fields and
  `tables`.

## Out of scope for this validation pass

Any user-facing settings control for choosing a policy (a reading-mode picker, persisted
preference) is not validated here — this feature only makes the pipeline internally configurable;
exposing that configurability to a listener is a later spec's concern, per spec.md's Assumptions.
`speakCitations`/`speakReferences`/non-skip `tables` modes' *behavior* is also not validated here
beyond confirming they are accepted without error — they are intentionally inert until a later
spec introduces the block types or narration behavior they would govern.

# Quickstart: Validating Speech-Aware Chunking

Validates the fixed chunker end-to-end once implemented, without duplicating the full behavior
spec (see [spec.md](./spec.md)) or contract details (see
[contracts/chunking-functions.md](./contracts/chunking-functions.md)).

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

Expected: **all existing tests continue to pass, unmodified** (SC-001). Plus new tests covering:

- Each of the five protected-span detectors (`isProtectedAbbreviationPeriod`,
  `isProtectedDecimal`, `isProtectedCurrencyPhrase`, `isProtectedOrdinal`,
  `isProtectedYearPhrase`) correctly identifies and correctly excludes positions, per
  data-model.md's category table.
- `splitIntoSpeechChunks` never splits "Dr. Smith", "3.14", "four hundred dollars",
  "twenty-first", or "twenty twenty-four" across two chunks, at a length bound that would
  otherwise force a split near each one (SC-002) — directly re-testing the two originally
  reproduced defects from spec.md's Input.
- `splitIntoSpeechChunks` produces byte-for-byte identical output to the pre-fix implementation
  for a long plain-prose passage with no protected patterns (SC-003).
- `splitIntoSpeechChunks` terminates and produces bounded chunks when `maxLength` is smaller than
  the shortest protected span (SC-004).
- `splitIntoSpeechChunks` prefers a lower-tier boundary (clause) over a higher-tier one
  (sentence) when the sentence-tier split would exceed `maxLength` but a clause-tier one would
  not (SC-005), verified across all four tier transitions.
- `splitIntoSpeechChunks` completes quickly on an adversarial input (a long digit run or repeated
  punctuation run), mirroring spec 006's own ReDoS test.

## Manual validation

Not required for this feature — same reasoning as specs 004-006: no UI or user-observable control
surface changes; the automated suite is the complete validation surface for this text-processing
change.

## Success criteria mapping

- SC-001 (100% of existing suite passes unmodified) → `node --test reader.test.js` full pass with
  zero pre-existing test file edits.
- SC-002 (protected spans never split) → the dedicated per-category split-avoidance tests.
- SC-003 (plain-prose passage identical to pre-fix output) → the byte-for-byte regression test.
- SC-004 (pathological maxLength terminates, bounded output) → the small-maxLength fallback test.
- SC-005 (lower-tier boundary chosen when higher-tier would exceed the bound) → the four
  tier-preference tests.

## Out of scope for this validation pass

Threading structured `NormalizedEntity` metadata from spec 006 into the chunker (research.md
Decision 2's rejected alternative) is not implemented or validated here — protection is achieved
by re-recognizing spec 006's spoken-word vocabulary directly in narration text, per spec.md's own
Assumptions. A user-extensible abbreviation dictionary is also out of scope, per spec.md
Assumptions.

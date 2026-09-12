# Quickstart: Validating the Text Normalization Engine

Validates the new normalization step end-to-end once implemented, without duplicating the full
behavior spec (see [spec.md](./spec.md)) or contract details (see
[contracts/normalization-functions.md](./contracts/normalization-functions.md)).

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

Expected: **all existing tests continue to pass, unmodified** (SC-001) — including specs 004-005's
own literal-string regression baselines, which must still hold since those fixtures contain no
numeric patterns this feature changes. Plus new tests covering, per data-model.md's category
table:

- `detectNumericEntities` correctly classifies each of the seven categories (currency,
  percentage, ordinal, code, year, decimal, cardinal) in isolation, and correctly resolves every
  documented priority conflict (e.g. `"$1998"` → currency, not year; `"0.5%"` → percentage, not
  decimal).
- Each converter function (`convertCardinal`, `convertYear`, `convertCurrency`,
  `convertPercentage`, `convertDecimal`, `convertOrdinal`, `convertCodeDigits`) produces the exact
  spoken-word string documented in data-model.md's example table, for every example given in
  spec.md's User Stories 1-3.
- `normalizeSpokenText` leaves text with no numeric-like span completely unchanged.
- `normalizeSpokenText` leaves an unclassifiable numeric-looking span unmodified rather than
  guessing (SC-004).
- `renderNarrationText` produces normalized output end-to-end for a document containing mixed
  categories, while `displayText` and `document.sections[].blocks[].text` remain unaffected
  (SC-005).
- A deliberately adversarial input (a long digit run, or a long run of repeated separator
  characters) is processed by `detectNumericEntities`/`normalizeSpokenText` without a
  perceptible hang, verifying the ReDoS mitigation from plan.md's Security Review.

## Manual validation

Not required for this feature — same reasoning as specs 004-005: no UI or user-observable control
surface changes; the automated suite is the complete validation surface for this text-processing
change. (A future spec integrating actual TTS audio output would be where manually *listening* to
normalized speech becomes relevant — out of scope here, since this pipeline stage only produces
text, per the project's staged architecture.)

## Success criteria mapping

- SC-001 (100% of existing suite passes unmodified) → `node --test reader.test.js` full pass with
  zero pre-existing test file edits.
- SC-002 (no numeric pattern → byte-identical narration) → dedicated no-op regression test using
  a fixture with only prose, no numbers.
- SC-003 (every documented example converts exactly as specified) → the full example-table test
  matrix across all seven categories.
- SC-004 (unclassifiable span left unmodified, never dropped) → a deliberately ambiguous/malformed
  numeric-looking fixture (e.g. a symbol combination no category matches).
- SC-005 (displayText/document block text unaffected) → a combined test asserting `narrationText`
  changed while `displayText` and `document` block text did not, for the same processed document.

## Out of scope for this validation pass

Full calendar-date normalization (locale-aware `DD/MM/YYYY`-style conversion), non-USD/GBP/EUR
currency symbols and 3-letter currency codes, and any user-facing locale/normalization setting are
not validated here — all deferred per spec.md's Assumptions to a later increment.

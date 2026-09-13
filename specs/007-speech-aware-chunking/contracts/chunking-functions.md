# Contract: Chunking Functions (`pdf-reader/app.js`)

This project has no network API. Its contract surface is the set of pure/narrowly-scoped
functions exported from `app.js` via the `api` object and imported by `reader.test.js`. This
document specifies the new/changed functions for this feature. Field shapes referenced below are
defined in [data-model.md](../data-model.md).

## New: `isProtectedAbbreviationPeriod(text, position)`

**Purpose**: FR-002/FR-006. True when `position` falls immediately after a period that closes
one of the fixed abbreviations, with further text following.

**Behavioral guarantees**:
- Returns `true` for the position immediately after "Dr." in "...Dr. Smith..." and for each of
  the other eleven fixed abbreviations, when followed by further text.
- Returns `false` when the abbreviation is at the very end of the text with nothing following
  (spec.md Edge Cases).
- Returns `false` for an ordinary sentence-ending period not preceded by a listed abbreviation.
- Pure and deterministic.

## New: `isProtectedDecimal(text, position)`

**Purpose**: FR-003. True when `position` falls between two digits joined by a `.` (a raw decimal
that could still reach the chunker).

**Behavioral guarantees**:
- Returns `true` for the position between "3" and "14" in "3.14".
- Returns `false` for an ordinary sentence-ending period following a digit with no following
  digit (e.g. "It was 1996. The next year...").
- Pure and deterministic.

## New: `isProtectedCurrencyPhrase(text, position)`

**Purpose**: FR-004. True when `position` falls inside a spoken currency phrase (a number-word
run immediately before a currency unit noun, or within the "and ... cents" clause).

**Behavioral guarantees**:
- Returns `true` for any position between "four" and "hundred" or between "hundred" and
  "dollars" in "four hundred dollars".
- Returns `true` for a position inside "one dollar and fifty cents" (the cents clause).
- Returns `false` for a position outside any recognized currency-unit-noun-adjacent word run.
- Pure and deterministic.

## New: `isProtectedOrdinal(text, position)`

**Purpose**: FR-005. True when `position` falls inside a spoken ordinal word run (e.g.
"twenty-first").

**Behavioral guarantees**:
- Returns `true` for the position inside the hyphenated "twenty-first".
- Returns `false` for a position outside any recognized ordinal word run.
- Pure and deterministic.

## New: `isProtectedYearPhrase(text, position)`

**Purpose**: FR-005. True when `position` falls inside a spoken year phrase (e.g. "twenty
twenty-four", "two thousand five").

**Behavioral guarantees**:
- Returns `true` for the position between "twenty" and "twenty-four" in "twenty twenty-four".
- Returns `true` for a position inside "two thousand five".
- Returns `false` for a position outside any recognized year word run.
- Pure and deterministic.

## New: `findBoundaryCandidates(text, tier)`

**Purpose**: research.md Decision 1 (revised). Scans `text` for every split candidate of exactly
the given `tier` (paragraph, sentence, clause, or plain punctuation), excluding any position
where one of the five protected-span detectors above returns `true`.

**Input**: `text` — narration text (already normalized by specs 004-006). `tier` — one of
`"paragraph" | "sentence" | "clause" | "plain"`.

**Output**: an array of `Split Point` objects (data-model.md), all sharing the requested `tier`,
ordered by `position` ascending.

**Behavioral guarantees**:
- Never includes a candidate position rejected by any protected-span detector.
- For `tier: "paragraph"`, includes a candidate at every `\n\n` boundary.
- Terminates in time linear in `text`'s length, including on adversarial inputs (long digit runs,
  repeated punctuation) — no catastrophic regex backtracking (Security Review, A08:2025).
- Pure and deterministic.

## New: `splitByTier(text, tier, maxLength)`

**Purpose**: research.md Decision 1 (revised). Splits `text` at every accepted `Split Point` of
`tier`, without merging pieces; recursively descends to the next tier down for any piece that is
still longer than `maxLength`, falling back to `splitLongText` once no tier remains.

**Behavioral guarantees**:
- Never merges two pieces produced by splitting at `tier`'s boundaries (this is what preserves
  "one sentence per chunk, no merging" for the FR-009 non-regression case).
- A piece already within `maxLength` is returned as-is, with no further splitting attempted.
- A piece still exceeding `maxLength` is recursively processed at the next tier down
  (paragraph → sentence → clause → plain → `splitLongText` fallback).
- Pure and deterministic.

## Extended: `splitIntoSpeechChunks(text, maxLength = 260)`

**Purpose**: Rewritten to call `splitByTier(normalizedText, "paragraph", maxLength)` as its entry
point (research.md Decision 1, revised), preserving the pre-existing recursive-splitting shape
(split into units; word-wrap only the oversized ones) rather than replacing it with a
merging strategy.

**Behavioral guarantees**:
- For text containing no protected-span pattern, produces output identical to the pre-fix
  implementation for the same input and `maxLength` (FR-009, SC-003) — the primary regression
  contract for this feature, verified directly against every pre-existing
  `splitIntoSpeechChunks` test in `reader.test.js`.
- Never splits inside a span any of the five protected-span detectors would reject (FR-002
  through FR-006, SC-002).
- Every produced chunk's length is `<= maxLength`, except when `splitLongText`'s own fallback
  behavior (unchanged from today) is itself forced to exceed a per-word bound in its pathological
  single-oversized-word case (existing, pre-007 behavior, not newly introduced).
- Terminates and produces bounded output even when `maxLength` is smaller than the shortest
  protected span (FR-008, SC-004) — never loops indefinitely or emits an unbounded chunk.
- Pure and deterministic.

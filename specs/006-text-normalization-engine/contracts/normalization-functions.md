# Contract: Text Normalization Functions (`pdf-reader/app.js`)

This project has no network API. Its contract surface is the set of pure/narrowly-scoped
functions exported from `app.js` via the `api` object and imported by `reader.test.js`. This
document specifies the new/changed functions for this feature. Field shapes referenced below are
defined in [data-model.md](../data-model.md).

## New: `detectNumericEntities(text)`

**Purpose**: FR-012's detection stage. Scans `text` for currency/percentage/ordinal/code/year/
decimal/cardinal spans in the fixed priority order from research.md Decision 2, producing
non-overlapping `NormalizedEntity` matches.

**Input**: `text` — a string (typically the citation/URL-stripped narration text for one
document, though the function itself is text-shape-agnostic).

**Output**: an array of `NormalizedEntity` objects (data-model.md), ordered by their position in
`text` (`start` ascending), with no two entities' ranges overlapping.

**Behavioral guarantees**:
- A span already claimed by an earlier-priority category (e.g. the digits of `"$1998"` claimed by
  `currency`) is never also returned as a later-priority match (e.g. never additionally matched
  as `year`) — research.md Decision 2's non-overlap/priority guarantee.
- A bare 4-digit number in 1000-2099 is classified `year` unless immediately preceded by a
  currency symbol or immediately followed by a unit/count word, per FR-005's exception rule.
- A digit sequence is classified `code` only when it carries an explicit label-word or
  phone-separator signal (research.md Decision 3); otherwise it falls through to `cardinal`
  regardless of length (FR-004).
- Returns an empty array for text containing no recognizable numeric-like span (FR-017's
  no-incidental-change guarantee starts here).
- Terminates in time linear in `text`'s length, including on adversarial inputs (long digit runs,
  repeated separator characters) — no catastrophic regex backtracking (Security Review, A08:2025
  mitigation).
- Pure and deterministic: identical `text` always yields identical output (FR-015).

## New: one converter function per category

`convertCardinal(digitsText)`, `convertYear(digitsText)`, `convertCurrency(matchText)`,
`convertPercentage(matchText)`, `convertDecimal(matchText)`, `convertOrdinal(matchText)`,
`convertCodeDigits(digitsText)` — each takes one matched span's text and returns its spoken-word
string (data-model.md's per-category examples), per research.md Decision 1 (cardinal algorithm)
and the category-specific rules in data-model.md's mapping table.

**Behavioral guarantees** (all seven functions):
- Pure and deterministic (FR-015).
- Never throws on a well-formed match of its own category (a match `detectNumericEntities` has
  already classified into that category is, by construction, well-formed for that category's
  converter).
- Preserves the numeric meaning of the input exactly (FR-014) — verified per function by the
  SC-003 example table.

## New: `normalizeSpokenText(text)`

**Purpose**: Orchestrates `detectNumericEntities` + the per-category converters into the final
spoken-text transform (FR-001, FR-013). This is the function `renderNarrationText` calls.

**Input**: `text` — narration text (post `stripCitationsAndUrls`).

**Output**: `text` with every detected entity's `match` replaced by its `spoken` form, and every
other character (including any span the detector did not classify) left exactly as in the input.

**Behavioral guarantees**:
- Text containing no numeric-like span is returned unchanged, character-for-character (FR-017,
  SC-002).
- A numeric-looking span the detector could not confidently classify is left in its original,
  unmodified form in the output — never guessed at, never dropped (FR-013, SC-004).
- Replacements do not shift or corrupt the position of surrounding, unmatched text (each
  replacement is applied against the original entity offsets, not re-scanned iteratively in a way
  that could double-process already-converted spoken text).
- Pure and deterministic (FR-015).

## Extended: `renderNarrationText(orderedBlocksByPage, policy)`

**Purpose**: Gains a call to `normalizeSpokenText` after the existing `stripCitationsAndUrls`
call, before returning (FR-001, FR-016).

**Behavioral guarantees**:
- For any document whose narration text (post citation/URL stripping) contains no
  numeric/currency/percentage/year/ordinal pattern, the returned narration text is byte-for-byte
  identical to before this feature (FR-017, SC-002) — this is the primary regression contract for
  this entire feature, mirroring specs 004-005's own non-regression bar.
- `stripCitationsAndUrls` continues to run exactly as before (FR-016) — normalization is strictly
  additive, applied after it, never replacing or reordering it.
- `displayText` (returned separately by `buildPipelineOutput`) and any `Block.text` in `document`
  (spec 004's schema) are completely unaffected by this feature (FR-001, SC-005) — normalization
  only ever transforms the string `renderNarrationText` returns.

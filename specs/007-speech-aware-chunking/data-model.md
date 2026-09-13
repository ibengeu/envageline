# Phase 1 Data Model: Speech-Aware Chunking

## Split Point

A candidate location in narration text where a chunk boundary may be placed (spec.md
§"Split Point"). An internal working structure produced by `findBoundaryCandidates` for one tier
at a time — not a new field on any spec 004-006 entity.

| Field | Type | Notes |
|---|---|---|
| `position` | `number` | Character offset in the source text where the boundary would fall. |
| `tier` | `"paragraph" \| "sentence" \| "clause" \| "plain"` | Priority tier, per research.md Decision 1's four-tier order (paragraph highest). Recursive splitting (Decision 1, revised) processes one tier at a time rather than ranking mixed-tier candidates against each other. |

## Protected Span (conceptual — not a materialized list)

A contiguous range of narration text that must never be split (spec.md §"Protected Span").
Rather than pre-computing a list of protected ranges, research.md Decision 2's five detector
functions each answer "is this specific candidate position inside a protected span of my
category?" on demand, given the boundary candidate under consideration. This avoids a separate
data structure and keeps each detector's logic self-contained and independently testable.

| Category | Recognized by | FR |
|---|---|---|
| Abbreviation pair | `isProtectedAbbreviationPeriod` — fixed abbreviation list + following text present | FR-002, FR-006 |
| Decimal (raw or spoken) | `isProtectedDecimal` — digit.digit pattern in surrounding text | FR-003 |
| Currency phrase | `isProtectedCurrencyPhrase` — number-word run immediately before a currency unit noun (dollar/dollars/pound/pounds/euro/euros/cent/cents), including the "and" cents clause | FR-004 |
| Ordinal | `isProtectedOrdinal` — number-word run ending in an ordinal word | FR-005 |
| Spoken year | `isProtectedYearPhrase` — two-part year-shaped word run, or "two thousand [+ word]" | FR-005 |

## Validation rules (from Functional Requirements)

- A `Split Point` used by the final algorithm MUST NOT have any of the five Protected Span
  detectors return `true` for its `position` (FR-002 through FR-006).
- `splitByTier(text, tier)` (research.md Decision 1, revised) MUST split `text` at every accepted
  `Split Point` of exactly the given `tier` — never merging two pieces produced by that split,
  and never looking ahead to a different tier while processing this one.
- A piece produced by `splitByTier` that already fits within `maxLength` MUST be kept as one
  chunk without further splitting, even if a smaller split would also be possible — this is what
  preserves "one sentence per chunk, no merging" for the common case (FR-009).
- A piece that does not fit within `maxLength` MUST be recursively split at the next tier down
  (paragraph → sentence → clause → plain punctuation → `splitLongText` fallback) — this is what
  "prefer the highest-priority boundary that respects the length bound" (FR-001, SC-005) means
  operationally: a tier is only descended into when the current tier's piece is still oversized.
- If no tier's boundaries can further split an oversized piece (all rejected by protection, or
  none present) even at the plain-punctuation tier, the algorithm MUST fall back to
  `splitLongText` (FR-008) rather than exceeding `maxLength` or looping.
- For text containing zero instances of any protected-span category, the sequence of chunks
  produced MUST be identical to the pre-fix algorithm's output for the same input and `maxLength`
  (FR-009) — verified directly against the pre-existing test fixtures in `reader.test.js` that
  predate this feature.

## State transitions

None — chunking is a one-shot, stateless transform of narration text computed fresh on each
`splitIntoSpeechChunks` call, consistent with the pipeline's existing stateless processing model.

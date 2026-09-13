# Phase 0 Research: Speech-Aware Chunking

No `NEEDS CLARIFICATION` markers remain. Research here pins down the boundary-scanning algorithm
and the shape of each protected-span detector.

## Decision 1: Recursive tiered splitting (revised after discovering FR-009's exact constraint)

**Decision (revised)**: An initial greedy-accumulation design (combining adjacent short units up
to `maxLength`) was drafted first, but was found during implementation to violate FR-009: the
*existing*, pre-007 chunker never merges adjacent sentences, even when several short sentences
together would fit under `maxLength` — confirmed by reproducing
`splitIntoSpeechChunks("Short one. Short two. Short three.", 30)` against the live pre-007 code,
which returns three separate one-sentence chunks, not one merged chunk. FR-009 requires this
exact behavior to be preserved for protection-free text. The corrected design is **recursive
tiered splitting**, not greedy accumulation:

`splitByTier(text, tier)`:
1. Split `text` at every *accepted* (non-protected) boundary of the given `tier` — paragraph,
   then sentence, then clause, then plain punctuation, in that fixed order — producing one
   piece per boundary, with no merging across pieces (this is what makes "one sentence per
   chunk" the natural, preserved default: a paragraph containing three separate sentences
   produces three separate sentence-tier pieces, matching today's behavior exactly).
2. For each resulting piece: if it already fits within `maxLength`, keep it as one chunk. If it
   is still too long, recurse into `splitByTier` with the *next* tier down (sentence → clause →
   plain punctuation → `splitLongText` word-wrap fallback).

`splitIntoSpeechChunks(text, maxLength)` calls `splitByTier(text, "paragraph")` as its entry
point. A boundary of any tier is skipped (never split at) when a protected-span detector
(Decision 2) rejects it — the piece then stays whole through that tier and only splits at the
next tier down if it's still oversized.

**Rationale**: This reproduces the pre-007 algorithm's actual shape (split into sentences; word-
wrap only the oversized ones) generalized to more tiers, rather than replacing it with a
different strategy (greedy merging) that happens to also satisfy FR-001's priority order but
breaks FR-009's byte-for-byte preservation requirement. It still satisfies SC-005 ("prefer a
lower-tier boundary when a higher-tier one would exceed the bound") because that is exactly what
"recurse to the next tier only when a piece is still oversized" means operationally — a piece
that already fits after paragraph/sentence splitting never reaches clause-tier splitting at all.

**Alternatives considered**:
- *Greedy accumulation up to `maxLength` (the original draft)*: rejected after reproducing the
  FR-009 violation above — it is a strictly different, more space-efficient chunking strategy
  than the one already shipped and tested in specs 001-006, and spec.md explicitly scopes this
  feature as "a precision fix to the boundary-detection logic, not a redesign of the overall
  chunking strategy."
- *Flat ordered candidate list with a single scan (the original draft's mechanism)*: same
  rejection reason — any single-pass selection over one candidate list naturally tends toward
  merging adjacent short units, which is the behavior that must NOT change.

## Decision 2: Protected-span detectors

**Decision**: Five small, independent boolean-returning functions, each checking whether a given
candidate boundary position falls strictly inside one protected-span shape. All operate on plain
narration text (no structured entity metadata from spec 006 — per spec.md's Assumptions, the
chunker's only input remains `(text, maxLength)`):

- `isProtectedAbbreviationPeriod(text, position)`: true when the text immediately before
  `position` ends with one of the fixed abbreviation strings (`Dr.`, `Mr.`, `Mrs.`, `Prof.`,
  `vs.`, `approx.`, `etc.`, `e.g.`, `i.e.`, `St.`, `Jr.`, `Sr.`) and the text immediately after
  `position` is non-empty (FR-002, FR-006).
- `isProtectedDecimal(text, position)`: true when `position` falls between two digits separated
  by a `.` in the surrounding text (covers a raw, not-yet-normalized decimal reaching the
  chunker, per FR-003's defensive requirement).
- `isProtectedCurrencyPhrase(text, position)`: true when `position` falls inside a recognized
  "<number-word(s)> dollars/pounds/euros/cents" span, or between the "and" clause of a
  currency-with-cents reading (e.g. inside "one dollar and fifty cents") — recognized by scanning
  for the pipeline's own currency unit-noun vocabulary (dollar/dollars/pound/pounds/euro/euros/
  cent/cents) and treating the word-run immediately before it as part of the same protected span
  (FR-004).
- `isProtectedOrdinal(text, position)`: true when `position` falls inside a spoken ordinal word
  (a number-word immediately followed by an ordinal suffix word, e.g. "twenty-first" as a single
  hyphenated token, or "one hundred fifth" as a word run ending in an irregular/`-th` ordinal
  word) (FR-005).
- `isProtectedYearPhrase(text, position)`: true when `position` falls inside a two-part
  year-shaped word run (e.g. "twenty twenty-four", "nineteen ninety-eight") or the "two thousand
  [+ word]" pattern spec 006's `convertYear` produces (FR-005).

A candidate boundary position is rejected if any of the five detectors returns true for it.

**Rationale**: Mirrors spec 006's own successful pattern (one small function per category) rather
than one large combined check, keeping each independently testable and under the complexity
ceiling (Principle V). Operating on the *words* normalization produces (dollars, thousand,
twenty-first, etc.) rather than re-deriving structured entity data is the simplest approach
consistent with the chunker's plain-text-only input contract (spec.md Assumptions) — it treats
spec 006's spoken vocabulary as a fixed, known set of words/patterns to recognize syntactically,
without needing spec 006 to expose any new data.

**Alternatives considered**:
- *Thread `NormalizedEntity` spans (spec 006's data-model.md) through to the chunker as
  structured metadata instead of re-scanning text*: would be more precise, but requires changing
  `renderNarrationText`'s return shape (currently a plain string) and `splitIntoSpeechChunks`'s
  signature — a larger, more invasive change than this spec's stated scope ("this spec only
  changes how already-normalized narration text is divided into TTS-bound chunks"). Rejected in
  favor of the simpler text-re-scanning approach, consistent with spec.md's own Assumption on
  this point.

## Decision 3: Last-resort fallback (FR-008)

**Decision**: When the greedy scan (Decision 1) finds no acceptable boundary within `maxLength`
for the current chunk-start position (every in-range candidate was rejected by a protected-span
detector, or no candidate exists in range at all), the algorithm falls back to calling the
existing, unmodified `splitLongText` on the remaining text from the current position onward,
taking only its first produced chunk and resuming the boundary scan after it.

**Rationale**: `splitLongText` already has a proven, terminating word-wrap algorithm (it's
existing, tested code from spec 001) — reusing it as the fallback guarantees termination by
construction (Decision covered in Security Review) rather than requiring a new bounded-search
algorithm to be designed and separately proven safe. This directly satisfies FR-008 and SC-004
("pathological input produces bounded, terminating output") by delegating to already-safe code
instead of inventing new fallback logic.

**Alternatives considered**:
- *Design a new "least-bad split point" search that tries to minimize protected-span damage*:
  rejected as unnecessary complexity for an explicitly-labeled last resort (FR-008 says "last
  resort," not "best effort") — Principle V favors the simpler, already-safe reuse.

## Assumptions carried into Phase 1

- The `ABBREVIATIONS` list is exactly the twelve entries named in spec.md's Assumptions; no
  attempt is made to infer additional abbreviations from context.
- Currency/ordinal/year phrase detection recognizes only the exact word vocabulary spec 006's
  converters actually produce (verified against `app.js`'s `CURRENCY_UNIT_WORDS`,
  `IRREGULAR_ORDINAL_WORDS`, and `convertYear`'s output shapes) — not a general-purpose
  English number-word parser.

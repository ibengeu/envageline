# Phase 1 Data Model: Text Normalization Engine

## NormalizedEntity

One detected numeric-like span within narration text, classified into exactly one category
before conversion (spec.md §"Normalized Entity", FR-012). An internal working structure — not a
new field on the `Block`/`Document` schema from spec 004 (this spec transforms `narrationText`
directly; see plan.md Summary for why no new schema field is needed).

| Field | Type | Notes |
|---|---|---|
| `category` | `"currency" \| "percentage" \| "ordinal" \| "code" \| "year" \| "decimal" \| "cardinal"` | Exactly one; assigned by detection priority order (research.md Decision 2). |
| `start` | `number` | Character offset in the source text where the match begins. |
| `end` | `number` | Character offset where the match ends (exclusive). |
| `match` | `string` | The exact original text matched (e.g. `"$2.5bn"`, `"1998"`, `"21st"`). |
| `spoken` | `string` | The converted spoken-word replacement (e.g. `"two point five billion dollars"`). |

## Category → conversion mapping

| Category | Example input | Example spoken output | Converter (research.md Decision 1 unless noted) |
|---|---|---|---|
| `currency` | `$400`, `$1.50`, `£400`, `€400`, `$4m`, `$2.5bn` | "four hundred dollars", "one dollar and fifty cents", "four hundred pounds", "four hundred euros", "four million dollars", "two point five billion dollars" | Cardinal converter + currency unit noun (singular/plural) + optional cents clause + optional magnitude word. |
| `percentage` | `20%`, `0.5%` | "twenty percent", "zero point five percent" | Cardinal or decimal converter + "percent". |
| `ordinal` | `1st`, `21st` | "first", "twenty-first" | Dedicated ordinal-word lookup/suffix rule over the cardinal converter's output. |
| `code` | `PIN 4829`, `801-234-5678` | "PIN four eight two nine", "eight zero one two three four five six seven eight" | Digit-by-digit lookup (0-9 word list), one word per digit. |
| `year` | `1998`, `2024`, `2000` | "nineteen ninety-eight", "twenty twenty-four", "two thousand" | Split into two 2-digit groups (or "two thousand [+ N]" for 2000-2009); each group via cardinal converter with year-specific phrasing. |
| `decimal` | `3.14` | "three point one four" | Integer part via cardinal converter; fractional part digit-by-digit after "point". |
| `cardinal` | `400`, `12,500`, `1,000,000` | "four hundred", "twelve thousand five hundred", "one million" | research.md Decision 1's grouped algorithm. |

## Validation rules (from Functional Requirements)

- Every `NormalizedEntity`'s `category` MUST be exactly one value — no span is double-classified
  (FR-012's "assigning it exactly one category").
- `spoken` MUST represent the identical numeric quantity as `match` (FR-014) — verified per
  category by the SC-003 example table, not by a generic equivalence checker (there is no
  runtime numeric-equivalence assertion; correctness is enforced by each converter's own tested
  logic).
- A span the detector cannot confidently assign to any category MUST NOT produce a
  `NormalizedEntity` at all — the original text for that span is left untouched in the output
  (FR-013), rather than emitting an entity with a guessed category.
- Entities MUST NOT overlap: once a range `[start, end)` is claimed by one entity, no other
  entity's range may intersect it (research.md Decision 2's non-overlap guarantee).
- Given identical input text, `detectNumericEntities` MUST return the same entities in the same
  order on every call (FR-015's determinism, extended to the detection stage).

## State transitions

None — normalization is a one-shot, stateless transform of `narrationText` computed fresh on
each `buildPipelineOutput`/`renderNarrationText` call, consistent with the pipeline's existing
stateless processing model (same as specs 004-005's entities).

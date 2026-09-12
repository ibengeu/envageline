# Phase 1 Data Model: Document AST & Block Schema

Entities correspond to spec.md's Key Entities section, refined with the concrete field set this
plan will implement. All three are plain JavaScript objects (no classes — consistent with the
constitution's Principle III ban on testing concrete types, and Principle V's YAGNI guidance:
plain objects are sufficient, a class hierarchy would be premature).

## Document

The top-level processed representation of one imported file (spec.md §"Document").

| Field | Type | Required | Notes |
|---|---|---|---|
| `title` | `string` | yes | Reuses the title source already available to the pipeline (falls back to a filename-independent placeholder if no in-document title is detected — this spec does not add title *detection*, it only carries whatever the pipeline already has forward). |
| `sections` | `Section[]` | yes | Ordered; see Section below. Non-empty for any document with at least one block (FR-008, edge case: no headings → single implicit section, never empty). |

Not included in this spec (goal document has these, deferred): `documentId`, `pages` array —
neither is consumed by any FR in this spec; adding them now would be speculative surface
(Principle V). `documentId`/content-hash concerns belong to the audio-cache/resume-state spec
(009) where they're actually used as a cache/resume key.

## Section

A logical grouping of blocks under one heading, or an implicit default grouping (spec.md
§"Section", FR-007, FR-008).

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | Derived the same way as block ids (Decision 1, research.md) from its first block's id, so it is stable across repeated processing (FR-009 extends to sections transitively). |
| `type` | `"chapter" \| "section"` | yes | Fixed to `"section"` for every section in this spec (no chapter-vs-section distinction exists in the classifier yet); kept as a field, not hardcoded inline, so a later spec can populate it without a schema change. |
| `title` | `string \| undefined` | no | The text of the heading block that opened this section; `undefined` for the implicit leading section when no heading precedes it. |
| `level` | `number` | yes | Fixed to `1` for every section in this spec (research.md Decision 2 / Assumption). |
| `blocks` | `Block[]` | yes | Ordered, in reading order; every block in the document appears in exactly one section (FR-007: no omission, no duplication). |

## Block

The smallest unit of processed document content (spec.md §"Block", FR-001–FR-004).

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | `string` | yes | FR-001, FR-009. Derived per research.md Decision 1: hash of `(page, original text, bbox)`, computed before reading-order/column resolution runs, so it survives reordering. |
| `page` | `number` | yes | FR-001. Already computed by `extractPositionedItems`/`buildBlock` today (0-indexed internally, consistent with existing `block.page`; not renumbered by this spec). |
| `type` | one of the existing classifier outputs: `"body" \| "heading" \| "header" \| "footer" \| "page-number" \| "footnote" \| "caption" \| "table"` | yes | FR-001, FR-011. Exactly the set `classifyBlocks` already produces today — no new type added or renamed. |
| `text` | `string` | yes | FR-001. The block's original, unmodified text — same value as today's `block.text`. Never overwritten by any later normalization spec (constitution-adjacent goal-doc principle, carried forward for 006 to respect). |
| `readingOrder` | `number` | yes | FR-001. Strictly increasing across the document's blocks in output (post `resolveReadingOrder`) order; not required to be contiguous (edge case in spec.md). |
| `speak` | `boolean` | yes | FR-001. `false` when `type` is in the existing `NARRATION_EXCLUDED_TYPES` set (`header`, `footer`, `page-number`, `footnote`, `caption`, `table`); `true` otherwise. Purely derived — introduces no new decision, just exposes the existing set's decision per-block instead of only as a filter inside `renderNarrationText`. |
| `bbox` | `{ x0: number, y0: number, x1: number, y1: number } \| undefined` | no | FR-002. Carries forward the existing `block.bbox` object as-is (already this exact shape in the current code — see `buildBlock`). |
| `style` | `{ fontSize?: number } \| undefined` | no | FR-003. Carries forward the existing `block.fontSize` under a nested `style.fontSize`. `fontWeight`/`italic`/`fontFamily` from the goal document's full `DocumentBlock.style` shape are omitted — the current extractor never computes them (PDF.js text-content items expose font *size* but the pipeline does not currently derive weight/italic/family), so populating them would be fabricated data, not preserved data. FR-003 only requires preserving what's *already computed*. |
| `confidence` | `number \| undefined` | no | FR-004. Carries forward the existing `block.confidence` where classification already sets one (page-number, header, footer confidence ratios; `1` for heading/footnote/table/caption per current code). |

Not included in this spec (goal document has these, deferred to spec 006 Text Normalization
Engine, per research.md Decision 3 / Assumptions): `spokenText`. Also not included:
`lines`/`column` — these remain as internal working fields on the pre-AST block objects consumed
by `classifyBlocks`/`resolveReadingOrder`/`detectColumns` (unchanged, since FR-005/FR-006 forbid
touching that logic in this spec) but are not part of the new `Block` schema's public shape,
since no FR in this spec requires exposing them there and the goal document's own `DocumentBlock`
type doesn't include them either.

## Validation rules (from Functional Requirements)

- Every `Block` MUST have `id`, `page`, `type`, `text`, `readingOrder`, `speak` defined (FR-001).
  `bbox`, `style`, `confidence` are present exactly when the current pipeline already computed
  them for that block (FR-002–FR-004) — never backfilled with a default/placeholder value.
- `readingOrder` values MUST be strictly increasing across a document's flattened block sequence
  (edge case in spec.md) — verified by comparing consecutive values in the flattened `Section.blocks`
  concatenation, not by requiring contiguity.
- Re-running `buildPipelineOutput` on identical input MUST yield identical `id` values for every
  block, and identical section `id` values (FR-009).
- The union of all blocks across all `Document.sections[].blocks` MUST equal the pipeline's
  existing flattened, ordered block list exactly (no drop, no duplicate) — FR-007.
- `displayText` and `narrationText`, as already returned by `buildPipelineOutput`, MUST be
  unchanged in value for any document already covered by specs 001-003's test suite (FR-005,
  FR-006) — this is the primary regression guard for this entire spec.

## State transitions

None — this is a one-shot derived structure computed fresh each time `buildPipelineOutput` runs
(consistent with the existing pipeline's stateless, per-load processing model). No entity in this
spec is mutated after construction.

# Phase 0 Research: Document AST & Block Schema

No `NEEDS CLARIFICATION` markers were produced in Technical Context — this feature reshapes data
already computed by the existing pipeline (specs 001-003) rather than adopting new technology or
integrating a new system. Research here instead pins down the design decisions FR-007/FR-008
(section grouping) and FR-009 (id stability) leave open, so Phase 1's data model and later tasks
don't have to re-derive them.

## Decision 1: Block id derivation

**Decision**: A block's id is derived deterministically from `(page, reading-order-independent
content signature)` — specifically a short hash of the block's page number, its original
(pre-narration-cleanup) text, and its bounding box — computed *before* reading order is assigned,
so that reordering columns (spec 001/002's two-column logic) never changes an id.

**Rationale**: FR-009 requires the same input document to yield the same ids on repeated
processing. Using array index as an id would violate this the moment reading order reshuffles
blocks (exactly what `resolveReadingOrder` does for two-column pages) or the moment an earlier
block is reclassified. Hashing stable content (page + text + bbox) rather than position in any
output array keeps ids stable across the very transformations (column reordering, classification)
this pipeline already performs, and keeps id assignment a pure function with no dependency on
processing order.

**Alternatives considered**:
- *Sequential counter during traversal*: simplest to implement, but ids would shift if any
  upstream block count or order changes between runs (e.g. a future spec adds a new detection
  step that splits one block into two) — fragile as a foundation for later specs (resume state,
  audio cache) that key off block id.
- *Random UUID per block*: fails FR-009 outright (not reproducible across runs) — rejected
  immediately, not a real candidate.
- *Hash of content only (no bbox)*: simpler, but two visually distinct blocks with identical text
  (e.g. a repeated "Continued" caption on two different pages at different positions) would
  collide; including bbox avoids this without adding meaningful complexity.

## Decision 2: Section grouping algorithm

**Decision**: A single linear pass over the reading-order-resolved, flattened block list. Each
`heading`-typed block starts a new section (using that heading's detected level — currently a
single implicit level, since specs 001-003 don't yet distinguish heading levels — see Assumption
below). Blocks before the first heading (or all blocks, if no heading exists anywhere) are
collected into one default/implicit leading section.

**Rationale**: This is the simplest grouping that satisfies FR-007/FR-008 and the goal document's
"a section may contain blocks" shape, without requiring any new detection heuristic — it reuses
the `type === "heading"` classification specs 001-003 already produce. A linear pass is O(n) in
block count, trivially satisfies Principle V's complexity ceiling, and requires no new state
beyond "current open section."

**Alternatives considered**:
- *Nested section tree by heading level*: the goal document's `DocumentBlock`/section schema
  supports a `level` field, implying multi-level nesting (chapters containing subsections).
  Rejected for this spec because specs 001-003's heading detection (spec 003) does not yet
  distinguish heading levels (font-size threshold produces a single `"heading"` type, not
  `h1`/`h2`/etc.) — building a nested-level tree now would invent structure the classifier can't
  actually support yet, violating Principle V (YAGNI) and this spec's own FR-011 (no new
  detection heuristics). A flat section list (one level) is what today's classifier can honestly
  populate; multi-level nesting is deferred until a spec adds heading-level detection.
- *Group by page instead of by heading*: rejected — pages are a rendering artifact, not a
  structural one (a section routinely spans multiple pages), and grouping by page would not match
  the goal document's `Section` concept or serve any of the three user stories.

## Decision 3: Where the AST is attached to existing output

**Decision**: `buildPipelineOutput` gains one additional return field, `document` (the new
`Document`/`Section`/`Block` tree), alongside its existing `displayText` and `narrationText`
fields, which remain byte-for-byte unchanged. Nothing consumes `document` yet inside `app.js`
outside of tests — later specs (005 speech policy, 006 normalization) are what will start reading
from it instead of the flat exclusion-set/string-concatenation path `renderNarrationText` uses
today.

**Rationale**: Directly satisfies FR-005/FR-006 (no behavior change) by construction — existing
callers of `buildPipelineOutput` that only destructure `displayText`/`narrationText` are
unaffected by the new field's presence. Avoids a premature "big bang" cutover where
`renderNarrationText` is rewritten to consume the new AST in this same spec — that rewire is
correctly the concern of spec 005 (Speech Policy Engine), which is what actually needs to replace
`NARRATION_EXCLUDED_TYPES` with configurable policy.

**Alternatives considered**:
- *Replace `renderNarrationText`'s exclusion-set logic now, sourcing from the new `speak` flag on
  each block*: would still pass this spec's own tests (the `speak` flag is defined identically to
  the current exclusion set, so output is unchanged either way), but conflates "introduce the
  schema" with "cut existing logic over to the schema," which is spec 005's job per the agreed
  004-009 sequencing. Deferred to keep this spec's diff minimal and independently revertable.

## Assumptions carried into Phase 1

- Heading level is uniformly `1` for every section in this spec's output (see Decision 2) —
  `Section.level` exists in the schema per the goal document but is not yet meaningfully
  populated beyond a constant, since no upstream heading-level detection exists yet.
- `Block.spokenText` (from the goal document's `DocumentBlock` type) is intentionally omitted from
  this spec's schema population — it is introduced by spec 006 (Text Normalization Engine); this
  spec's blocks may include the field as `undefined`/absent but must not populate it with a
  placeholder value.

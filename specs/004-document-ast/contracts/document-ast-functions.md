# Contract: Document AST Functions (`pdf-reader/app.js`)

This project has no network API. Its contract surface is the set of pure/narrowly-scoped
functions exported from `app.js` via the `api` object and imported by `reader.test.js`. This
document specifies the new/changed functions for this feature. Field shapes referenced below are
defined in [data-model.md](../data-model.md).

## New: `assignBlockIds(blocksByPage)`

**Purpose**: Compute a stable `id` for every block, before reading order or column layout is
resolved (research.md Decision 1), so ids survive later reordering.

**Input**: `blocksByPage` — array of per-page block arrays, each block having at least `page`,
`text`, `bbox` (the shape already produced by `reconstructBlocks`/`splitParagraphBoundaries`,
before classification).

**Output**: same nested array shape, each block augmented with an `id: string` field. All other
fields unchanged (same values, same field set otherwise).

**Behavioral guarantees**:
- Deterministic: identical input (same page, text, bbox for a block) yields the same `id` on
  every call (FR-009).
- Two distinct blocks (differing in page, text, or bbox) never receive the same `id` for any
  document already covered by the existing test corpus.
- Does not read or depend on `type`, `confidence`, or `column` — classification and column
  detection run after id assignment, and ids must not depend on their output.

## New: `buildDocumentAst(orderedBlocksByPage)`

**Purpose**: Produce the `Document`/`Section`/`Block` tree (data-model.md) from the pipeline's
already-classified, already-ordered, already-id-assigned blocks. Runs after
`resolveReadingOrder`, alongside (not replacing) `renderNarrationText`.

**Input**: `orderedBlocksByPage` — array of per-page block arrays, each block carrying `id`
(from `assignBlockIds`), `type`, `confidence`, `bbox`, `fontSize`, `text`, `page`, in the reading
order `resolveReadingOrder` already established.

**Output**: a single `Document` object (data-model.md): `{ title, sections }`, where
`sections` is the FR-007/FR-008 grouping (research.md Decision 2) and each section's `blocks`
array contains `Block`-shaped objects per data-model.md's field table (`readingOrder` and `speak`
newly computed here; `bbox`/`style`/`confidence` carried forward from the input).

**Behavioral guarantees**:
- The flattened concatenation of every section's `blocks`, in order, equals the flattened input
  block sequence exactly — same blocks, same order, no drop or duplicate (FR-007).
- `readingOrder` is strictly increasing across that flattened sequence (edge case in spec.md).
- `speak` is `true` iff the block's `type` is not in the existing `NARRATION_EXCLUDED_TYPES` set
  — identical boolean result to what `renderNarrationText`'s filter already computes today for
  that block, just exposed per-block instead of only as a filter predicate.
- Every block appears in exactly one section (FR-007).
- A document with zero heading-typed blocks produces exactly one section containing all blocks
  (edge case in spec.md), never zero sections and never a thrown error.
- Never mutates its input blocks; returns new objects (consistent with the existing pipeline's
  style of spreading (`{ ...block, ... }`) rather than mutating in place, e.g. in `classifyBlocks`
  and `detectColumns` today).

## Extended: `buildPipelineOutput(pagesOfItems, pageWidth, pageHeight)`

**Purpose**: Gains a `document` field in its returned object, built via `assignBlockIds` (run
immediately after `splitParagraphBoundaries`, before `analyzeDocumentStats`) and
`buildDocumentAst` (run immediately after `resolveReadingOrder`, before `renderNarrationText`).

**Behavioral guarantees**:
- `displayText` and `narrationText` — both already-existing returned fields — have byte-identical
  values to before this change, for every document already covered by the existing test suite
  (FR-005, FR-006). This is the primary regression contract for this entire feature.
- The new `document` field satisfies every guarantee of `buildDocumentAst` above, built from the
  same `orderedBlocksByPage` value `renderNarrationText` already consumes internally — i.e. the
  `document` field and `narrationText` field are two views over the same underlying ordered,
  classified block data, not two independently-computed paths that could silently diverge.
- Calling `buildPipelineOutput` twice with the same arguments yields a `document` whose block and
  section `id` values are identical between the two calls (FR-009, SC-003).

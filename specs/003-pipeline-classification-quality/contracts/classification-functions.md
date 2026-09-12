# Contract: Classification Functions (`pdf-reader/app.js`)

This project has no network API. Its contract surface is the set of pure/narrowly-scoped
functions exported from `app.js` via the `api` object and imported by `reader.test.js`. This
document specifies the new/changed function(s) for this feature.

## New: `splitParagraphBoundaries(blocks)`

**Purpose**: Insert paragraph boundaries within already-reconstructed blocks, per FR-004–FR-007.
Runs between `reconstructBlocks` and `analyzeDocumentStats` in `buildPipelineOutput`.

**Input**: `blocks` — the array of `Block` objects for one page, as returned by
`reconstructBlocks` (each with a `lines` array, per feature 001-clean-private-reading).

**Output**: an array of `Block` objects, same shape as the input, with any block that had an
internal paragraph boundary now split into two or more blocks. A block with no detected boundary
is returned unchanged (same object identity not required, but same field values).

**Behavioral guarantees**:
- Never throws — a block with degenerate geometry (single line, zero-height lines) is returned
  unchanged rather than causing a comparison error (FR-006's uniform-block case naturally covers
  this: a block with nothing to compare has no possible boundary).
- Never splits a block whose lines share a uniform left margin and uniform inter-line gap
  (FR-006/FR-007).
- Deterministic: identical input produces identical output (FR-013).

## Extended: `analyzeDocumentStats(blocksByPage)`

**Purpose**: Gains `headingFontSizeThreshold` and `footnoteFontSizeThreshold` in its returned
profile (data-model.md), computed from the existing `medianBodyFontSize` calculation, per
FR-001/FR-002/FR-008.

**Behavioral guarantees**:
- Both new thresholds are `undefined` when the document has no reliable `medianBodyFontSize`
  (e.g. every block reports no `fontSize`) — FR-002's "absence of evidence, no false heading"
  applies symmetrically to the footnote threshold.
- Does not change any existing field's value or meaning.

## Extended: `classifyBlocks(blocksByPage, stats)`

**Purpose**: Gains heading, footnote, caption, and table classification, per
FR-001/FR-003/FR-008/FR-009/FR-010/FR-012, alongside its existing header/footer/page-number
classification.

**Behavioral guarantees**:
- A block is classified `"heading"` only when its `fontSize` exceeds `stats.headingFontSizeThreshold`,
  that threshold is defined, AND the block's text is more than one character (FR-001/FR-002). The
  single-character exclusion exists because a decorative drop-cap first letter (e.g. the "I"
  opening a chapter) is extracted by PDF.js as its own block at a much larger font size than body
  text — without this guard it would satisfy the font-size evidence and be classified a heading,
  which then split it out of its own sentence during narration. No legitimate section heading is
  a single character, so this guard never excludes real heading text.
- A block is classified `"footnote"` only when it is confined to the existing footer zone, its
  `fontSize` is below `stats.footnoteFontSizeThreshold`, that threshold is defined, AND the
  block's text does not match the standalone-page-number pattern already used by page-number
  classification (FR-008/FR-012 — position alone is insufficient). The page-number-text exclusion
  exists because a bare page number can have a smaller font than body text and sit in the footer
  zone without ever satisfying the stricter, repetition-based page-number check (which requires
  the exact same digit to repeat across 2+ pages — a single page's own unique number never
  qualifies on its own); without this guard such a number would be misclassified as a footnote.
- A block is classified `"caption"` only when it sits adjacent to a low-text-density page region
  AND its styling (font size or family) differs from the block's page's dominant body style
  (FR-009/FR-012).
- A group of blocks is classified `"table"` only when 3 or more consecutive lines within the
  group share a repeated, stable column-gap pattern (FR-010/FR-012 — a single aligned pair of
  lines is insufficient).
- A block that does not meet any new type's full evidence requirement keeps its prior
  classification (typically `"body"`) — never partially classified (FR-002/FR-012/FR-014).
- Never throws; a block with missing/invalid geometry is treated as insufficient evidence for
  every new type, not as a crash (A08:2025 mitigation, plan.md Security Review).

## Extended: `NARRATION_EXCLUDED_TYPES`

**Purpose**: Gains `"footnote"`, `"caption"`, `"table"` per FR-011. `"heading"` is deliberately
excluded from this set (FR-003 — headings remain speakable).

## Test contract (per Constitution Principle III)

All tests assert on function input/output behavior only:
- `analyzeDocumentStats` on a document with a clear body/heading font-size split → returns a
  defined `headingFontSizeThreshold` between the two sizes.
- `analyzeDocumentStats` on a document with uniform font sizes throughout → returns `undefined`
  for both new thresholds.
- `classifyBlocks` given a block whose font size exceeds a defined `headingFontSizeThreshold` →
  classified `"heading"`.
- `classifyBlocks` given the same block but with `headingFontSizeThreshold` undefined (no
  document-wide evidence) → remains `"body"`.
- `classifyBlocks` given a small-font block confined to the footer zone → classified `"footnote"`.
- `classifyBlocks` given a small-font block NOT confined to the footer zone → remains `"body"`
  (position corroboration required, per FR-012).
- `classifyBlocks` given a single-character block (e.g. a decorative drop cap) that otherwise
  exceeds the heading font-size threshold → remains `"body"`, never `"heading"` (FR-001/FR-002).
- `classifyBlocks` given a standalone page-number-shaped block that is small and in the footer
  zone → does not classify it `"footnote"` (FR-008/FR-012).
- `classifyBlocks` given 3+ consecutive lines sharing a repeated column-gap pattern → classified
  `"table"`.
- `classifyBlocks` given only 2 lines sharing a column-gap pattern → remains `"body"` (repetition
  threshold not met, per FR-012's edge case).
- `splitParagraphBoundaries` given a block with one line indented beyond the block's own left
  margin → returns two blocks split at that line.
- `splitParagraphBoundaries` given a block with uniform margins and spacing throughout → returns
  the block unchanged (FR-006).
- `renderNarrationText` given a mix of body, heading, footnote, caption, and table blocks →
  excludes footnote/caption/table text, includes heading and body text (FR-011/FR-003).
- A full-pipeline regression test on a document with none of these three patterns → narration
  output is byte-for-byte identical to the pre-feature pipeline's output (FR-014/SC-006).
- No test targets classification thresholds' exact numeric values directly — only the resulting
  classification/output behavior, per Constitution Principle III (never lock in an implementation
  constant as if it were the behavior under test).

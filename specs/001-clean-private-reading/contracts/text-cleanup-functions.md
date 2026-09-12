# Contract: Smart PDF Reading Pipeline Functions (`pdf-reader/app.js`)

This project has no network API. Its contract surface is the set of pure functions exported
from `app.js` via the `api` object (`app.js:141-147`) and imported by `reader.test.js`
(`require("./app.js")`). This document specifies the new/changed functions for the layout-aware
pipeline, superseding the flat-text-only contract from the prior revision of this document.
Signatures are illustrative for planning; exact naming is finalized during implementation as
long as behavior matches. Each function corresponds to one research.md decision (§ noted).

## Pipeline overview

```
PDF page → extractPositionedItems → reconstructLines → reconstructBlocks
                                                              ↓
                                              analyzeDocumentStats (all pages' blocks)
                                                              ↓
                                classifyBlocks (header/footer/page-number/heading/body)
                                                              ↓
                                    detectColumns (per page, uses classified blocks)
                                                              ↓
                                  resolveReadingOrder (per page, uses column assignment)
                                                              ↓
                              renderNarrationText (join, dehyphenate, strip citations/URLs)
```

The existing display path (`renderExtractedText`/`renderChunkedText`) continues to consume raw
per-page text in original order, entirely separate from this pipeline (research.md §10).

## New: `extractPositionedItems(page)` (research.md §1)

**Input**: a PDF.js page's `getTextContent()` result (already fetched by the existing
`extractPdfText` loop — no new PDF.js call is introduced, just fuller use of the existing one).

**Output**: array of Positioned Text Item (data-model.md), normalized to plain objects with
0–1 bounding boxes.

**Behavioral guarantees**: Pure transform of PDF.js's own output; no filtering, no removal — 
"no artifact removal happens during this stage" (source design's Stage 1 requirement, preserved
as-is since it's a correctness requirement, not a stylistic one).

## New: `reconstructLines(items)` (research.md §2)

**Input**: array of Positioned Text Item, all belonging to one page.

**Output**: array of Page Line (data-model.md), ordered top-to-bottom then left-to-right within
each line.

**Behavioral guarantees**: Deterministic grouping by the `0.35 * medianLineHeight` vertical
threshold (per-page median). Items on different pages are never grouped together (not
applicable here since input is already one page's items, but `reconstructBlocks` below must
respect page boundaries when given multi-page input).

## New: `reconstructBlocks(lines)` (research.md §3)

**Input**: array of Page Line, one page's lines.

**Output**: array of Page Block (data-model.md), `type` initially `"unknown"`/`"body"` pending
classification (classification is a separate stage, per contract below — keeps this function
single-concern and under the Principle V complexity budget).

**Behavioral guarantees**: Grouping only by left-edge alignment, font consistency, and vertical
spacing (research.md §3) — no cross-page grouping, no classification logic mixed in.

## New: `analyzeDocumentStats(blocksByPage)` (research.md §4)

**Input**: array of per-page block arrays (i.e., `PageBlock[][]`, one entry per page).

**Output**: Document Statistics (data-model.md).

**Behavioral guarantees**: Read-only aggregation — does not mutate any input block. Computing
this requires all pages' blocks up front, which is why `extractPdfText` must finish
per-page block reconstruction for the whole document before this stage runs (a change from the
prior single-pass-per-page pipeline, noted in Project Structure in plan.md).

## New: `classifyBlocks(blocksByPage, stats)` (research.md §5, §6)

**Input**: `PageBlock[][]` (from `reconstructBlocks`, one array per page) and Document
Statistics (from `analyzeDocumentStats`).

**Output**: `PageBlock[][]`, same shape, with `type` and `confidence` set per block. Header,
footer, and page-number classification only ever promotes a block from `"body"`/`"unknown"` —
it never reclassifies a block whose first/last-line position and repetition don't meet the
research.md §5/§6 gates, satisfying FR-010/FR-012 (preserve when uncertain).

**Behavioral guarantees**:
- Deterministic: same input always produces the same classified output (FR-011).
- A block is classified `"header"`/`"footer"` only at the ≥60% cross-page repetition,
  stable-region tier (research.md §5) — never the lower "potential" tier.
- A block is classified `"page-number"` only when it passes all three boolean gates in
  research.md §6 — a body sentence containing a number never qualifies.
- Never removes or mutates block `text` — classification only sets `type`/`confidence`;
  removal happens later, in `renderNarrationText`.

## New: `detectColumns(blocksByPage)` (research.md §7)

**Input**: `PageBlock[][]` (post-classification, since full-width heading/title blocks should be
excluded from the column-gap calculation).

**Output**: `PageBlock[][]`, same shape, with `column` set (`0`, `1`, or `undefined`) per block,
and implicitly determines each page's layout (`"single"` / `"two-column"` / `"unknown"`,
stored in an updated Document Statistics `columnLayoutByPage`, or returned alongside — exact
plumbing is an implementation decision, not a contract requirement).

**Behavioral guarantees**: A page defaults to `"single"`/`column: undefined` for every block
unless a stable, page-height-spanning gap is found (research.md §7) — the conservative default
satisfies FR-008's fallback requirement structurally, not as an afterthought.

## New: `resolveReadingOrder(blocksByPage, columnLayoutByPage)` (research.md §8)

**Input**: classified, column-assigned `PageBlock[][]`, plus the per-page layout classification.

**Output**: `PageBlock[][]`, same blocks, reordered per page: unchanged (top-to-bottom) for
`"single"`/`"unknown"` pages; left-column-then-right-column (full-width blocks interleaved by
vertical position) for `"two-column"` pages.

**Behavioral guarantees**: Never drops a block — output array for each page has the same blocks
as input, only reordered (FR-010 extended to reordering, not just removal). Deterministic
(FR-011).

## Changed: `renderNarrationText(orderedBlocksByPage)` (research.md §9)

**Purpose**: Produces the final string handed to `splitIntoSpeechChunks`. Supersedes the prior
contract's approach of extending `normalizePdfText` directly — dehyphenation now needs block
boundaries (to avoid merging across them, per the spec's edge case), so it runs here instead of
inside the older, block-unaware `normalizePdfText`.

**Input**: `PageBlock[][]` in final reading order (from `resolveReadingOrder`).

**Output**: string — narration-ready text with:
- Blocks classified `"header"`, `"footer"`, or `"page-number"` at the qualifying confidence
  excluded entirely.
- Remaining blocks' text joined in order, with hyphenated line-wraps repaired only within a
  block (never across a block boundary).
- Numeric citation markers (`\[\d+(?:[,\-\s]\d+)*\]`) and bare URLs (`https?:\/\/\S+`) removed,
  exactly as the prior plan specified (non-numeric bracketed text such as `[sic]` is never
  touched).

**Behavioral guarantees**: Deterministic (FR-011). Never produces output shorter than what
remains after header/footer/page-number exclusion — i.e., it must not additionally drop body
text; only the four explicitly-named removals (headers, footers, page numbers,
citations/URLs) reduce content.

## Unchanged: display path

`extractPdfText`'s existing return value (raw per-page text, original order) and
`renderExtractedText`/`renderChunkedText` are not modified by this feature. `extractPdfText` is
extended to *also* run the pipeline above and expose its narration-text result alongside the
unchanged display text — the two are sibling outputs of one call, not a replacement of one by
the other (data-model.md, "Displayed Extracted Text").

## Test contract (per Constitution Principle III)

All tests assert on function input/output behavior only, one behavior per test, added to
`reader.test.js`:
- `reconstructLines` given items with small vertical offset → grouped into one line; given
  items with large vertical offset → separate lines.
- `reconstructBlocks` given aligned lines with consistent spacing → one block; given a font-size
  jump → a block boundary.
- `classifyBlocks` given a line repeated on ≥60% of pages at a stable region → classified
  `"header"`/`"footer"`; given the same line on only one page → remains `"body"`.
- `classifyBlocks` given a standalone digit-only first/last line with stable
  sequential/formatted progression → classified `"page-number"`; given a number embedded in a
  sentence → remains `"body"`.
- `detectColumns` given two blocks with a stable page-spanning horizontal gap → assigned
  columns 0/1; given no stable gap → all blocks `column: undefined`.
- `resolveReadingOrder` given a two-column page → left-column blocks precede right-column
  blocks in the output; given a single-column page → order unchanged from input.
- `renderNarrationText` given blocks classified as header/footer/page-number → their text is
  absent from the output; given a citation marker or URL → absent from output, surrounding text
  intact; given a hyphenated wrap within one block → merged into one word; given a hyphenated
  wrap that spans two different blocks → NOT merged.
- No test targets internal PDF.js item shapes, constructors, or call sequences — only the
  exported function contract above.

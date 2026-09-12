# Phase 0 Research: Smart PDF Reading — Layout-Aware Listening Compiler

No items in Technical Context were marked `NEEDS CLARIFICATION`. The source design description
("Smart PDF Reading") already proposes concrete data structures, thresholds, and scoring
signals; this document evaluates those proposals against this project's actual constraints
(single-file vanilla JS, no build step, Constitution Principle V's complexity budget,
FR-009's requirement that the reading pane stay literal) and commits to specific decisions,
simplifying where the source design's full generality isn't needed for this release's scope
(single/two-column, no ML fallback, per spec Assumptions).

## 1. Positioned extraction: how much metadata to carry

**Decision**: Capture, per text item: `text`, `page`, and a normalized bounding box (`x0`, `y0`,
`x1`, `y1`, each 0–1 relative to page width/height) derived from PDF.js's existing
`item.transform` (position) and `item.width`/`item.height` (size). Also capture `fontName` and
an approximate `fontSize` (derivable from the transform's scale component), since heading/body
distinction and font-based line-grouping both need it. Do not carry PDF.js's full raw item
object forward past the extraction stage — normalize immediately into the plain shape above.

**Rationale**: This is exactly the source design's Stage 1 `PdfTextItem`/`NormalizedBBox`
shape, minus fields this release doesn't use (`hasEOL` — line grouping in this release is
computed from geometry, not relied on PDF.js's own EOL hints, since those are inconsistent
across producers). Normalizing to 0–1 coordinates immediately (rather than passing page pixel
dimensions around everywhere) keeps every downstream threshold (header zone, footer zone,
column gap) expressible as a plain fraction, independent of page size — simpler to reason about
and test.

**Alternatives considered**:
- *Keep PDF.js's raw `TextItem` objects through the whole pipeline.* Rejected — couples every
  downstream function to PDF.js's object shape, making unit tests need to construct
  PDF.js-shaped fixtures instead of plain objects, and violates Constitution Principle III's
  spirit (tests should target plain input/output, not a third-party library's internal shape).

## 2. Line reconstruction threshold

**Decision**: Group text items into a line when they're on the same page and
`abs(a.centerY - b.centerY) < 0.35 * medianLineHeight` (the source design's proposed threshold),
using each page's own median line height rather than a single document-wide constant, since
font size can vary page to page (e.g. a title page vs. body pages). Within a line, order items
by `x0` (left to right; right-to-left scripts are out of scope for this release, consistent
with the product's currently English-language-oriented test fixtures).

**Rationale**: Matches the source design's Stage 2 signal directly; per-page median (not
document-wide) avoids a title page with unusually large text skewing the threshold for every
other page.

**Alternatives considered**:
- *Document-wide single median line height.* Rejected — a title page or a page with a large
  pull-quote would skew the one global value; per-page computation is no more expensive (still
  linear) and more robust.
- *Use PDF.js's `hasEOL` hint directly instead of computing centerY proximity.* Rejected —
  `hasEOL` reliability varies by PDF producer; the geometry-based approach is deterministic and
  under this project's own control, matching FR-011's determinism requirement more safely.

## 3. Paragraph/block reconstruction

**Decision**: Group consecutive lines into a block when: left-edge `x0` values are within a
small tolerance (e.g. 0.02 of page width) of each other, font size/name are the same or within
a small tolerance, and vertical spacing between lines is consistent with the page's median line
height (not a large gap suggesting a new block). A block ends when any of these breaks, or when
a line's font size differs enough to suggest a heading (see §6).

**Rationale**: Matches the source design's Stage 3 signals, scoped down to what's needed for
this release's block types actually used downstream: body, header, footer, page-number, and
(as a side classification, per spec Assumptions) heading — not the source design's full type
list (caption, footnote, table, list), which spec Assumptions explicitly defer.

**Alternatives considered**:
- *Classify every block type from the source design's full `BlockType` union immediately.*
  Rejected — spec Assumptions scope this release to detection needed for reading order and
  noise removal; footnote/caption/table classification is explicitly future work. Building
  unused classification branches now would violate Principle V (YAGNI) and the constitution's
  "don't build for hypothetical future requirements."

## 4. Document-wide statistics needed before removal

**Decision**: Compute once per document (not per page): the set of candidate repeated
top-of-page and bottom-of-page text patterns (see §5), the dominant/median body font size, and
which pages appear to be single- vs. two-column (see §7). Do not compute the source design's
full `estimatedColumnLayouts`/`bodyMargins` structure beyond what §5–§7 need.

**Rationale**: FR-003/FR-004 (header/footer/page-number detection) are explicitly cross-page
questions — "does this repeat" cannot be answered from one page alone, matching the source
design's Stage 4 rationale and this project's own spec Edge Cases (single-page documents have
nothing to compare against, so must be left unchanged).

**Alternatives considered**: none substantively different — this stage's necessity is
essentially forced by FR-003/FR-004 as specified; the only real decision is scope (see above),
already resolved.

## 5. Header/footer detection: zones, normalization, and thresholds

**Decision**:
- Header zone: top 12% of page height; footer zone: bottom 12% (source design's proposed
  values — reasonable defaults, kept as named constants for easy tuning, not hardcoded inline).
- Before comparing candidate lines across pages: lowercase, collapse whitespace, and replace
  any run of digits with a placeholder token (so "Report — 21" and "Report — 22" normalize to
  the same candidate string) — this specifically enables page-number-bearing headers/footers to
  still be recognized as repeated, per the source design's example.
- A candidate is a **confirmed** header/footer, and removed, only when it appears on at least
  60% of eligible pages (pages that have content in that zone at all) at a stable horizontal
  region (independently clustered as left/center/right, per the source design) — the source
  design's "high-confidence" tier. The lower "potential" tier (≥40%) is deliberately **not**
  auto-removed in this release — per FR-012/the spec's mandatory preservation principle, only
  the higher-confidence tier is used for actual removal; the lower tier is not surfaced at all
  in this release (no partial/soft-removal UI exists yet), avoiding a middle state this release
  has no way to act on safely.

**Rationale**: Directly resolves the FR-003 "recurs at the same page-edge position on multiple
pages" requirement with a concrete, testable threshold, while resolving the spec's mandatory
preservation principle by using only the source design's stricter tier for actual removal.

**Alternatives considered**:
- *Use the source design's full two-tier signal set (including alignment/font-similarity scoring
  contributing to a combined score).* Considered, but simplified: for this release, requiring
  repetition rate + stable positional cluster is sufficient to satisfy FR-003 and the spec's
  acceptance scenarios, and keeps the detection function within Principle V's complexity budget.
  Font-similarity scoring can be added later if real fixtures show the simpler rule
  over-triggers.

## 6. Page-number detection: scoring vs. a simpler rule

**Decision**: Do not implement the source design's full additive/subtractive scoring model
(§12 of the source doc) as literal point totals. Instead, implement the same signals as a
small ordered set of boolean gates, matching this project's existing style (see
`isLocalTtsEndpoint` in `app.js` for the pattern of small validating functions) and Principle
V's preference for guard clauses over accumulated scores: a first/last-line candidate is a page
number only if (a) it is a standalone line consisting solely of digits or a Roman numeral,
optionally wrapped in simple pagination punctuation, (b) it sits in the header or footer zone
(§5), and (c) across the document, candidates in the same positional cluster show either
sequential or stable-format progression. A candidate failing any gate is left as body text.

**Rationale**: Preserves the source design's intent (multiple corroborating signals, not "any
standalone number") while avoiding a tunable-weights scoring system that would be harder to
test deterministically (FR-011) and harder to keep under Principle V's complexity ceiling than
a small set of named boolean checks. Matches the spec's explicit edge case: a number embedded
in a sentence (e.g. "In 2024,") fails gate (a) immediately (not standalone) and is never
touched.

**Alternatives considered**:
- *Implement the literal point-scoring system from the source design.* Rejected for this
  release — the boolean-gate approach satisfies the same acceptance criteria (FR-004, spec
  Edge Cases) with fewer tunable parameters and a smaller, more testable surface. Revisit only
  if real fixtures show the simpler gates are insufficiently discriminating.

## 7. Column detection

**Decision**: For each page, look for a persistent vertical whitespace gap between body-line
bounding boxes spanning most of the page's body height — if found and stable, classify the page
as two-column with a left/right split at the gap's center; otherwise single-column. Full-width
lines (width close to the page's overall body width) are never assigned to a column and are
treated as spanning both (titles, section headings), per the spec's edge case on ambiguous
column assignment. Three-or-more-column and pages where no stable gap is found are classified
as unknown/single-column-fallback (read top-to-bottom in original order) — the conservative
fallback FR-012 and FR-008 require, not a forced guess.

**Rationale**: Matches the source design's Stage 14 method, scoped to the single/two-column
first-class cases the spec's Assumptions commit to for this release; unknown layouts fall back
rather than attempt three-column detection logic that isn't required and would add branching
without a corresponding acceptance criterion.

**Alternatives considered**:
- *Attempt N-column detection generally.* Rejected by spec Assumptions — out of scope for this
  release; falling back for anything beyond two columns satisfies FR-008 and keeps the detection
  function simpler.

## 8. Reading order resolution

**Decision**: Do not implement a general transition-cost graph solver (source design §16's
`transitionCost` model in full generality). For the single/two-column scope of this release,
use the simplified deterministic path the source design itself calls out as sufficient "for
straightforward pages": within a single-column page, order blocks top-to-bottom as today
(no change in behavior). Within a confirmed two-column page, order all blocks in the left
column top-to-bottom, then all blocks in the right column top-to-bottom, except full-width
blocks (titles/headings spanning both columns, per §7), which are placed in document order
relative to the column blocks immediately before/after them by vertical position. Pages that
fall back to single-column/unknown per §7 use the existing top-to-bottom order unchanged.

**Rationale**: Satisfies FR-007/FR-008 and the spec's acceptance scenario ("entire left column
read before the right column") without building a general graph-cost solver whose weights would
be hard to justify, test deterministically, or keep within Principle V's complexity budget. The
source design explicitly sanctions this simplification for straightforward pages, and this
release's scope (single/two-column only) makes every in-scope page "straightforward" by
definition — anything more complex already routed to the conservative fallback in §7.

**Alternatives considered**:
- *Implement the full transition-cost graph model.* Rejected for this release — substantially
  more complex than the acceptance criteria require, and a poor fit for Principle V given the
  number of tunable weights the source design proposes. Would only be justified if a future
  release commits to 3+ column or more irregular layouts as first-class, which spec Assumptions
  explicitly defer.

## 9. Dehyphenation, citation, and URL rules

**Decision**: Unchanged from the prior plan's research, but now applied at the block/line level
rather than after full-document flattening: a hyphenated line-wrap is repaired only when the
line break sits inside a single reconstructed block (§3) — never across a detected block
boundary — directly resolving the spec's edge case about not merging across structural
boundaries. Citation-marker suppression (`\[\d+(?:[,\-\s]\d+)*\]`) and bare-URL suppression
(`https?:\/\/\S+`) remain string-level regex passes, now applied to the assembled narration
text after blocks are ordered (§8), exactly as their rationale in the prior plan's research
established (see git history of this file's prior revision for the original citation/URL
rationale, which is unchanged).

**Rationale**: The source design's §13/§19/§20 confirm the same rules; the only change from the
prior plan is applying dehyphenation with block-boundary awareness (now possible, since blocks
are known) instead of the prior plan's simpler "always merge a trailing hyphen with the next
line" rule, which risked merging across a boundary the prior plan's flat pipeline couldn't see.

**Alternatives considered**: See prior plan's research for citation/URL pattern alternatives
(unchanged). For dehyphenation specifically: *keep the prior plan's boundary-unaware merge
rule.* Rejected — now that block structure is available, using it closes a real gap the spec's
new edge case explicitly calls out.

## 10. Keeping the reading pane unaffected (FR-009)

**Decision**: Unchanged in principle from the prior plan: the reading pane continues to render
today's literal, unmodified per-page text and order. The new pipeline's output (cleaned,
reordered narration text) is a second, separate value computed alongside — never substituted
into the display path. This is a stronger requirement now than before, since reading order
itself can change for narration (two-column reordering) while the display pane must still show
the text in its original raw order for the user to visually follow along on the page as printed.

**Rationale**: FR-009 explicitly extends to reordering, not just content removal, in the
revised spec. The architectural separation (positioned extraction → structure → narration text,
vs. display text taken directly from raw per-page extraction) makes this straightforward: the
display path simply never consumes the reading-order stage's output.

**Alternatives considered**:
- *Reorder the display pane to match narration order, so read-along stays in sync during
  two-column playback.* Rejected for this release — not required by any FR, and directly
  conflicts with FR-009's literal-display guarantee and User Story 3's verifiability goal (a
  user comparing display to source PDF needs the display in the PDF's own visual/raw order, not
  a reordered one). Worth revisiting as a distinct future feature (e.g. a "follow narration"
  view mode) but out of scope here.

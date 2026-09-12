# Quickstart: Validating Smart PDF Reading (Layout-Aware Pipeline)

Validates the layout-aware pipeline end-to-end once implemented: positioned extraction, line/
block reconstruction, header/footer/page-number classification, column detection, reading-order
resolution, dehyphenation, citation/URL suppression — without duplicating the full behavior
spec (see [spec.md](./spec.md)) or contract details (see
[contracts/text-cleanup-functions.md](./contracts/text-cleanup-functions.md)). Supersedes the
prior revision of this document, which validated only flat-text regex cleanup.

## Prerequisites

- No new dependencies to install — this feature adds code only to `pdf-reader/app.js` and
  tests only to `pdf-reader/reader.test.js`. The additional PDF.js fields it reads
  (`transform`, `width`, `height`, font metadata) are already returned by the vendored
  PDF.js 4.10.38 dependency's existing `getTextContent()` call.
- Node.js available for running the test suite (`node:test`, already used by the project).
- A local static server to manually verify in-browser, per the existing project README.
- At least one two-column PDF (e.g. an academic paper in a two-column layout) for manual
  validation of reading-order behavior — this is new relative to the prior revision's
  validation, which only needed single-column fixtures.

## Automated validation

From the repository root:

```sh
cd pdf-reader
node --test reader.test.js
```

Expected: all existing tests continue to pass, plus new tests covering (per the contract, one
test per bullet at minimum):
- Line reconstruction groups/splits text items correctly by vertical proximity.
- Block reconstruction groups/splits lines correctly by alignment, font, and spacing.
- Header/footer classification promotes only text repeated at a stable position across ≥60% of
  eligible pages; a single-occurrence line is never classified as header/footer.
- Page-number classification promotes only a standalone digit/Roman-numeral line in a
  header/footer zone with stable progression; a number inside a sentence is never classified as
  a page number.
- Column detection assigns column 0/1 only when a stable, page-spanning gap is found; otherwise
  every block's column is `undefined` (single-column/unknown fallback).
- Reading-order resolution reorders a two-column page's blocks left-column-then-right-column,
  and leaves a single-column page's order unchanged.
- Narration text excludes classified header/footer/page-number blocks, excludes citation
  markers and bare URLs, merges a hyphenated wrap within one block, and does NOT merge a
  hyphenated wrap across a block boundary.
- The display path (`extractPdfText`'s existing return value) is unchanged in content and
  order regardless of any narration-side reordering.

## Manual validation (end-to-end, in-browser)

1. Serve the app: `python3 -m http.server 4173` from `pdf-reader/`, then open
   `http://localhost:4173`.
2. **Single-column fixture**: load a multi-page PDF known to contain a repeated header or
   footer, page numbers, at least one inline citation marker (e.g. `[12]`), at least one bare
   URL, and at least one hyphenated line wrap — an academic paper or report is a good source.
   - Confirm the **reading pane** still shows all original content literally, in original
     order, including headers, page numbers, citation markers, and URLs (FR-009).
   - Start playback and confirm across at least one page boundary: the repeated header/footer
     is not spoken, no page number is spoken, citation markers/URLs are not spoken (surrounding
     sentences still read naturally), and the hyphenated word is spoken as one continuous word.
3. **Two-column fixture**: load a two-column academic paper.
   - Confirm the reading pane still shows the page's raw extracted text/order, unchanged.
   - Start playback on a two-column page and confirm the entire left column is read before the
     right column begins — not an interleaving of both columns' lines.
4. **Clean/simple fixture**: load a short, single-page, single-column, noise-free document and
   confirm playback is unaffected — no content is dropped, altered, or reordered (FR-010).
5. **Irregular-layout fixture** (if available): load a PDF with an unusual or dense layout the
   system isn't expected to classify confidently. Confirm narration still reads the page's full
   text (using the conservative fallback order) rather than skipping the page or failing.

## Success criteria mapping

- SC-001 (zero repeated header/footer/page-number interruptions) → step 2.
- SC-002 (zero spoken citation markers/URLs, 100% surrounding content intact) → step 2.
- SC-003 (0% of real sentences altered/reordered on clean single-column documents) → step 4.
- SC-006 (two-column pages read column-by-column) → step 3.
- SC-007 (hyphenated wraps spoken as single words) → step 2.
- SC-008 (no page causes narration to fail or skip entirely) → step 5.

## Out of scope for this validation pass

Non-retention messaging (User Story 2) is not covered here — it's independent UI/copy work, not
part of the pipeline this quickstart validates. Selectively reading/skipping footnotes,
captions, and tables (mentioned in the source design's Phase 2/3 scope and spec Assumptions) are
explicitly deferred; this release's classification of those categories, where it happens as a
side effect, is not yet exposed as user-facing behavior and has no acceptance criteria here.

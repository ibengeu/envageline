# Quickstart: Validating Reading Pipeline Classification Quality

Validates the three new classification behaviors end-to-end once implemented, without
duplicating the full behavior spec (see [spec.md](./spec.md)) or contract details (see
[contracts/classification-functions.md](./contracts/classification-functions.md)).

## Prerequisites

- No new dependencies to install — this feature adds code only to `pdf-reader/app.js` and tests
  only to `pdf-reader/reader.test.js`.
- Node.js available for running the automated test suite.
- A local static server and a real browser for manual validation, per the existing project
  README.
- A document with visually distinct headings, at least one multi-paragraph block, and (ideally)
  a footnote or table for full manual coverage — the session's own reference fixtures used for
  specs 001/002 (books with running headers/footers) already exercise the body/heading-adjacent
  cases; a document containing footnotes or a table is needed to manually exercise those two
  cases specifically.

## Automated validation

From the repository root:

```sh
cd pdf-reader
node --test reader.test.js
```

Expected: all existing tests continue to pass, plus new tests covering:
- `analyzeDocumentStats` correctly derives (or omits) `headingFontSizeThreshold`/
  `footnoteFontSizeThreshold` depending on whether the document has a reliable body-font profile.
- `classifyBlocks` correctly assigns `"heading"`, `"footnote"`, `"caption"`, and `"table"` only
  when their full evidence requirement is met, and leaves ambiguous/weak-evidence blocks as
  `"body"`.
- `splitParagraphBoundaries` correctly splits a block at a genuine indentation/spacing signal and
  leaves a uniform block unchanged.
- `renderNarrationText` excludes footnote/caption/table text from narration while still including
  heading text.
- A full-pipeline regression test confirms a document with none of these three patterns produces
  byte-for-byte identical narration output to the pre-feature pipeline (FR-014/SC-006).

## Manual validation (end-to-end, in-browser)

1. Serve the app (`python3 -m http.server 4173` from `pdf-reader/`) and open it in a browser.
2. Load a document with clearly-styled section headings and confirm — via the reading pane's
   literal-text view — that heading blocks are visually distinguishable in the extracted output
   (or, once a later narration-rendering feature adds audio treatment, audibly distinguishable);
   this quickstart validates classification correctness, not audio treatment (out of scope per
   spec.md's Assumptions).
3. Load a document containing a block with visible multi-paragraph structure (indentation or a
   vertical gap between paragraphs) and confirm the reading pane shows it split into separate
   paragraph units rather than one run-on block.
4. Load a document containing a footnote, caption, or table and confirm that content does not
   appear in the narrated/spoken text output, while confirming (by comparing against the raw PDF)
   that no ordinary body content was incorrectly excluded alongside it.
5. Load a document exhibiting NONE of these three patterns (a plain, single-column, no-footnote
   book already used in prior manual testing) and confirm its reading-pane output is unchanged
   from before this feature — this is the regression check for FR-014/SC-006 in a real browser,
   not just the automated suite.

## Success criteria mapping

- SC-001 (headings correctly detected on documents with distinct heading styles) → automated
  `classifyBlocks` heading tests + manual step 2.
- SC-002 (no false headings on documents without a distinguishable heading style) → automated
  `analyzeDocumentStats`/`classifyBlocks` undefined-threshold tests.
- SC-003 (paragraph boundaries correctly recognized) → automated `splitParagraphBoundaries` tests
  + manual step 3.
- SC-004 (no false paragraph splits on uniform blocks) → automated `splitParagraphBoundaries`
  uniform-block test.
- SC-005 (footnotes/captions/tables excluded from narration) → automated `renderNarrationText`
  exclusion tests + manual step 4.
- SC-006 (documents with none of these patterns are unaffected) → automated full-pipeline
  regression test + manual step 5.

## Out of scope for this validation pass

Audio/narration treatment of a heading boundary (pause length, tonal change, announcement) is not
validated here — this quickstart validates classification output only, per spec.md's Assumptions.
Structured table-content narration (reading cells in a meaningful order) is also out of scope;
this feature only validates that tables are excluded from default narration, not how their
content might be presented if a future feature chooses to narrate them differently.

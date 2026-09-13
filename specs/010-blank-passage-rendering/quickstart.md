# Quickstart: Validating Blank Passage Rendering

Validates the fix end-to-end once implemented, without duplicating the behaviour spec (see
[spec.md](./spec.md)) or the contract details (see
[contracts/blank-passage-rendering.md](./contracts/blank-passage-rendering.md)).

## Prerequisites

- No new dependencies. This feature changes `pdf-reader/app.js` only, with tests added to
  `pdf-reader/reader.test.js`.
- Node.js available for running the automated test suite.
- `index.html` and `styles.css` are explicitly out of scope (plan.md Structure Decision) — no
  stylesheet change is made, so no CSS validation step is required.

## Automated validation

From the repository root:

```sh
cd pdf-reader
node --test reader.test.js
```

Expected: **all 219 existing tests continue to pass, unmodified** (SC-005, FR-008, FR-009), plus
new tests covering:

- A document containing whitespace-only blocks renders no blank passages, and every rendered
  passage contains visible text (US1, FR-001, FR-002).
- A block whose text is a single visible character still renders as a passage (spec.md Edge
  Cases) — this is what stops the fix from over-filtering.
- No clickable row corresponds to a whitespace-only block (US2, FR-005).
- **A document containing whitespace-only blocks *and* two identically-worded passages resolves a
  click on the later one to its own occurrence, not the earlier one** (US3, FR-007). This is the
  single most important test in this feature: it is the only one that fails if the alignment
  invariant breaks, and the naive fix passes every other test while breaking it.
- A document in which every block is blank reports no readable text rather than rendering an empty
  pane (FR-011, OWASP A08).
- An EPUB continues to render one passage per chapter with no blank rows (FR-012).

## Manual validation

Optional, and useful because the reported defect was visual. Serve the reader and open a PDF whose
layout produces spacer blocks:

```sh
cd pdf-reader
python3 -m http.server 4173
```

Open `http://localhost:4173`, load a document, and confirm:

- No empty rows appear between passages in the reading pane.
- The passage numbers down the left gutter run consecutively with no apparent gaps.
- Clicking any passage starts narration at that passage's text.

## Regression watch

The `mapParagraphsToChunks maps a book-scale document in bounded time` test runs at roughly
1280–1345 ms against a 1500 ms budget and can exceed it when another suite runs concurrently on the
same machine. This is pre-existing and unrelated to this feature, but a failure there after this
change should be checked for contention before being treated as a regression.

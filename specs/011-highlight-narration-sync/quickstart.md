# Quickstart: Validating Highlight and Narration Synchronisation

Validates the fix end-to-end once implemented, without duplicating the behaviour spec (see
[spec.md](./spec.md)) or the contract details (see
[contracts/highlight-resolution.md](./contracts/highlight-resolution.md)).

## Prerequisites

- No new dependencies. This feature changes `pdf-reader/app.js` only, with tests added to
  `pdf-reader/reader.test.js`.
- Node.js available for running the automated test suite.
- `index.html` and `styles.css` are out of scope (plan.md Structure Decision) — the `.is-active`
  styling already exists and is correct; only which element receives it, and when, changes.

## Automated validation

From the repository root:

```sh
cd pdf-reader
node --test reader.test.js
```

Expected: **all 223 existing tests continue to pass, unmodified** (FR-010, SC-006), plus new tests
covering:

- A paragraph narrated across several chunks stays highlighted while each of its chunks plays
  (US1, FR-001) — the test that fails hardest under the current equality rule.
- Exactly one passage is highlighted when several short passages share one chunk (US2, FR-002,
  FR-004).
- With synthesis held pending, the highlight has not advanced onto the pending passage, and some
  passage is still highlighted (US3, FR-003, FR-005) — the test that proves the FR-003/FR-005
  tension was resolved rather than traded off.
- **A document on the fallback mapping path with repeated identical passages still highlights
  exactly one passage** (FR-012, OWASP A08). This is the test guarding the non-monotonic map
  hazard: the underlying map there was measured as `[0,1,0]`, and a range-based implementation
  would leave a passage permanently unhighlightable. No visible US1 or US2 criterion catches it.
- Clicking a passage highlights it immediately (FR-006).

## Manual validation

Recommended, because the defect is visual and its worst form appears on real long paragraphs:

```sh
cd pdf-reader
python3 -m http.server 4173
```

Open `http://localhost:4173`, load a PDF with ordinary long body paragraphs, press Play, and
confirm:

- The highlighted paragraph stays highlighted for the whole time it is being read — it does not
  light up briefly and then go dark while the voice continues in the same paragraph.
- Exactly one paragraph is highlighted at a time, including across runs of short lines or headings.
- The highlight moves onto a paragraph as the voice reaches it, not a second or more early.
- Clicking a paragraph highlights it instantly.

## Regression watch

The `mapParagraphsToChunks maps a book-scale document in bounded time` test runs at roughly
1250–1350 ms against a 1500 ms budget. One transient failure of the full suite was observed during
spec 011's specification phase and could not be reproduced across a clean run, five isolated runs,
or two deliberately concurrent suites. Treat a failure there as unattributed and re-run before
investigating it as a regression from this feature.

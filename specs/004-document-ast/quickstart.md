# Quickstart: Validating Document AST & Block Schema

Validates the new typed document/section/block structure end-to-end once implemented, without
duplicating the full behavior spec (see [spec.md](./spec.md)) or contract details (see
[contracts/document-ast-functions.md](./contracts/document-ast-functions.md)).

## Prerequisites

- No new dependencies to install — this feature adds code only to `pdf-reader/app.js` and tests
  only to `pdf-reader/reader.test.js`.
- Node.js available for running the automated test suite.
- `index.html`/`styles.css` are explicitly out of scope for this feature — no manual UI
  validation step is required or expected; the reader interface does not change.

## Automated validation

From the repository root:

```sh
cd pdf-reader
node --test reader.test.js
```

Expected: **all existing tests continue to pass, unmodified** — this is the primary regression
gate (FR-005, FR-006, SC-001). Plus new tests covering:

- `assignBlockIds` produces a defined `id` for every block, and produces the same `id` for the
  same `(page, text, bbox)` across repeated calls.
- `buildDocumentAst` groups a multi-heading document's blocks into the correct sections, with no
  block dropped or duplicated relative to the flat reading-order list.
- `buildDocumentAst` produces exactly one (implicit) section for a document with no headings at
  all, rather than zero sections or a thrown error.
- Every block in a representative multi-type document (heading, body, footnote, page-number,
  caption, table) independently exposes `id`, `page`, `type`, `text`, `readingOrder`, `speak`,
  and (where the existing pipeline already computed them) `bbox`/`style.fontSize`/`confidence`.
- `speak` is `false` exactly for blocks whose `type` is in the existing narration-exclusion set,
  matching what `renderNarrationText` already excludes today.
- `buildPipelineOutput`'s `displayText` and `narrationText` are byte-identical, before vs. after
  this feature, for every document in the existing test corpus (the core non-regression contract).
- `buildPipelineOutput` called twice with the same input produces identical block/section `id`
  values across both calls.

## Manual validation

Not required for this feature. Because the reader UI (`index.html`, `styles.css`, playback
controls) is explicitly untouched and no new file-loading path is introduced, the automated suite
above is the complete validation surface — there is no new user-observable behavior to exercise
in a browser. (Contrast with specs 001-003, which did require manual in-browser validation
because they changed what listeners hear or see.)

## Success criteria mapping

- SC-001 (100% of existing suite passes unmodified) → `node --test reader.test.js` run above,
  full pass with zero test-file edits to pre-existing tests.
- SC-002 (every output block independently satisfies the schema) → automated multi-type-document
  schema-completeness test.
- SC-003 (identical ids across repeated processing) → automated `buildPipelineOutput`
  call-twice-compare-ids test.
- SC-004 (correct, lossless section grouping for a multi-heading document) → automated
  `buildDocumentAst` grouping test.

## Out of scope for this validation pass

Multi-level section nesting (chapters containing subsections) is not validated here — this
feature produces a flat, single-level section list per research.md Decision 2, since no upstream
heading-level detection exists yet to honestly populate a deeper hierarchy. Any consumption of the
new `document` field by narration, speech policy, or normalization logic is also out of scope —
that begins with spec 005 (Speech Policy Engine).

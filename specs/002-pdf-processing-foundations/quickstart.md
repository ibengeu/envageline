# Quickstart: Validating PDF Processing Foundations

Validates the four processing rules and capability-assessment gate end-to-end once implemented,
without duplicating the full behavior spec (see [spec.md](./spec.md)) or contract details (see
[contracts/capability-assessment.md](./contracts/capability-assessment.md)).

## Prerequisites

- No new dependencies to install — this feature adds code only to `pdf-reader/app.js` and tests
  only to `pdf-reader/reader.test.js`.
- Node.js available for running the automated test suite.
- A local static server and a real browser for manual validation, per the existing project
  README.
- A document above the large-document page-count threshold (research.md §2 — 200 pages) for
  manual gate testing; the session's own "Patterns of Enterprise Application Architecture"
  fixture (389 pages) already exceeds it.

## Automated validation

From the repository root:

```sh
cd pdf-reader
node --test reader.test.js
```

Expected: all existing tests continue to pass, plus new tests covering:
- `assessCapabilities` correctly reports each capability flag under a faked-missing/faked-broken
  environment, and never throws.
- A large document with a faked-absent real worker is stopped before its per-page extraction
  loop, with a clear status message.
- A small document proceeds and succeeds even with the same faked-absent real worker.
- `buildPipelineOutput` (or the equivalent whole-pipeline call) produces byte-identical output
  across two calls with identical input (FR-004/FR-005, reproducibility).
- No fetch call made during a normal document-load-and-narrate cycle carries the document's
  extracted text, and any fetch calls made target only `localhost`/`127.0.0.1` (FR-001).

## Manual validation (end-to-end, in-browser)

1. Serve the app (`python3 -m http.server 4173` from `pdf-reader/`) and open it in a browser
   with developer tools open to the Network tab.
2. Load a normal document and confirm playback works as before — this feature must not change
   behavior for documents that already work today.
3. With the Network tab recording, load and narrate a document; confirm no request's URL or
   payload contains any of the document's extracted sentences (FR-001 in a real browser, not
   just the test harness).
4. Compare the source file's contents before and after loading it (e.g., via a checksum of the
   original file on disk versus re-reading the same file) and confirm they are identical
   (FR-003) — expected to pass trivially, since the browser platform itself prevents a `File`
   object's bytes from being mutated by page script.
5. If a browser or environment can be configured to disable Web Workers (e.g., certain
   privacy/extension settings), load the 389-page fixture and confirm a clear message appears
   rather than a hang, freeze, or silent failure (FR-008). Then load an 18-page fixture in the
   same restricted environment and confirm it still processes successfully (FR-009).

## Success criteria mapping

- SC-001 (no document data over the network) → automated fetch-spy test + manual step 3.
- SC-002 (source file never altered) → manual step 4.
- SC-003 (reproducible output) → automated determinism test.
- SC-004 (UI stays responsive) → manual step 2, general use — no dedicated automated test in
  this plan beyond confirming the existing per-page `await` yielding is unchanged.
- SC-005 (clear message when a large document can't be processed reliably) → automated
  large-document gate test + manual step 5, first half.
- SC-006 (small documents always succeed) → automated small-document test + manual step 5,
  second half.

## Out of scope for this validation pass

Epics 3–23 (worker topology, OCR, semantic classification, checkpoint/resume, browser-matrix
testing, and everything else in the original 23-epic source document) are not covered by this
quickstart, since they are not part of this plan's scope.

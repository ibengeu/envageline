# Data Model: PDF Processing Foundations (Rules & Capability Detection)

This feature introduces no persisted data (per spec Assumptions: capability assessment is
recomputed fresh each time, never stored). The shapes below are transient, in-memory values
produced by the capability-assessment step and consumed by `extractPdfText` before extraction
begins.

## Capability Assessment

The result of checking the current environment's relevant capabilities, computed once per
document-load attempt.

| Field | Type | Notes |
|---|---|---|
| `hasRealWorker` | boolean | `true` only when `typeof Worker === "function"` AND PDF.js's document-load call completed without emitting its known fake-worker warning (research.md §1). `false` for both "no Worker support" and "Worker exists but PDF.js still fell back." |
| `hasLocalStorage` | boolean | `true` when `localStorage` is accessible without throwing (reuses the existing defensive check already in `bookmarkStorage()`). |
| `hasIndexedDb` | boolean | `true` when `indexedDB` is accessible without throwing. |
| `pageCount` | integer | The document's page count, read from the already-available `pdf.numPages`; used to decide whether the "large document" gate (research.md §2) applies. PDF-only — see the scope note below. |

**Relationship to existing entities**: not a new persisted entity — a plain object built and
consumed entirely within one `extractPdfText` call, analogous to how `Document Statistics` (from
the Smart PDF Reading feature) is computed fresh per extraction and never stored.

**Scope note (revised during convergence)**: Capability Assessment and the large-document gate
apply only to the PDF path. `extractEpubText` is synchronous and main-thread-only with no Worker
involvement, so `hasRealWorker` is not a meaningful gate for it; EPUB already has its own,
worker-independent safety limits (`EPUB_MAX_ENTRIES`, `EPUB_MAX_UNCOMPRESSED_BYTES` in
`pdf-reader/app.js`) that serve the analogous "fail clearly instead of hanging" role for FR-008.
An earlier draft of this document implied the EPUB spine length feeds the same gate as
`pdf.numPages` — that was inaccurate and is corrected here; see
contracts/capability-assessment.md's matching scope note.

## Processing Rule (conceptual, not a data entity)

The four rules from spec.md (local-only, byte-preservation, reproducibility, main-thread
responsiveness) are not data — they are constraints checked by tests and, where applicable
(FR-010, FR-012), enforced by the Capability Assessment's conservative-default behavior. Listed
here only to record that no entity/schema is needed for them beyond what's already described in
this document and in contracts/capability-assessment.md.

## State Transitions

None. Capability Assessment is a pure function of the current environment at the moment it's
called — it has no lifecycle, is never updated in place, and is discarded once the extraction
call it gated has completed (successfully or not). A fresh assessment is computed on the next
document load, consistent with the spec's "not persisted between sessions" assumption.

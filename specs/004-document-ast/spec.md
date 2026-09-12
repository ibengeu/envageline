# Feature Specification: Document AST & Block Schema

**Feature Branch**: `004-document-ast`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: first subsystem of a multi-spec effort to evolve the existing Smart
PDF Reading pipeline (`pdf-reader/app.js`, from specs 001-003) toward the "PDF → structured
spoken-document representation" architecture described in a full system design document (Mobile
PDF-to-Speech Reader). This spec covers only the Document AST / block schema layer: formalize the
pipeline's existing internal block representation into an explicit, typed document structure
(document → sections → blocks, each block carrying id, page, type, text, bbox, style, reading
order, speak flag, and optional spoken text/confidence) so that later specs (speech policy engine,
text normalization engine, chunking, TTS abstraction, audio cache) all consume and produce this
same shape instead of ad hoc objects. This is a pure internal-representation change: no new
detection heuristics, no new block types beyond what specs 001-003 already classify, no change to
narration output, no change to the reader UI (`index.html`, `styles.css`, playback controls stay
untouched), no OCR, no network calls, no persistence format changes.

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
-->

### User Story 1 - Listening experience is unchanged after the refactor (Priority: P1)

A listener who was already using the reader before this change opens the same documents and hears
exactly the same narration, in the same order, with the same headings/footnotes/page-numbers
excluded as before. Nothing about what they hear or see changes.

**Why this priority**: This is a foundation-laying refactor for later features (speech policy,
normalization, chunking). If it changes any observable behavior, it has failed at being a safe
foundation — every later spec would inherit an unnoticed regression.

**Independent Test**: Run the full existing test suite (`node --test reader.test.js`) after the
refactor and confirm all previously-passing behavioral tests (extraction, reading order,
classification, narration exclusion, playback) still pass unchanged, with no test needing to be
rewritten to tolerate a behavior change.

**Acceptance Scenarios**:

1. **Given** a document that previously produced a specific narration sequence under specs
   001-003, **When** the same document is processed after this refactor, **Then** the produced
   narration sequence (text, order, and which blocks are excluded) is identical.
2. **Given** the existing pipeline output consumers (narration builder, highlighting, playback
   position mapping), **When** the internal block representation is formalized, **Then** those
   consumers continue to receive the fields they already depend on, under the same access
   pattern or a mechanically equivalent one.

---

### User Story 2 - Every pipeline block has a complete, typed identity (Priority: P1)

A developer extending the pipeline (in this or a later spec) can inspect any block produced by the
document pipeline and find a complete, self-describing record: which document and page it came
from, what type it was classified as, its position in reading order, whether it should be spoken,
and its text — without needing to cross-reference multiple parallel arrays or infer meaning from
array position.

**Why this priority**: Every subsequent subsystem (speech policy engine, normalization engine,
chunker, TTS layer, audio cache, resume state) is specified in terms of operating on blocks with
this shape. Without a real, populated schema now, every later spec would have to re-derive it
ad hoc, causing drift between specs.

**Independent Test**: Take the pipeline's output for a representative multi-page, multi-column,
multi-type document (headings, body paragraphs, footnotes, page numbers, captions, tables) and
confirm every block in the output independently satisfies the required schema (all mandatory
fields present and correctly typed) without needing any other block or array for context.

**Acceptance Scenarios**:

1. **Given** a processed document, **When** its blocks are inspected, **Then** every block
   exposes a stable id, its source page number, one of the recognized block types, its reading
   order position, a boolean speak flag, and its original text.
2. **Given** a block that specs 001-003 already classify with a confidence score (e.g. page
   numbers, footnotes), **When** the block is represented in the new schema, **Then** that
   confidence value is preserved and exposed on the block.
3. **Given** a block that has associated layout information already computed by the existing
   pipeline (position/size, font size/weight/style), **When** the block is represented in the new
   schema, **Then** that information is preserved and exposed under the schema's layout and style
   fields rather than being dropped.

---

### User Story 3 - Blocks are organized into a navigable document/section structure (Priority: P2)

A developer (or a later feature such as chapter navigation) can walk a processed document as a
tree: the document has a title and an ordered list of sections, each section has a heading level
and an ordered list of the blocks belonging to it, rather than only a single flat list of blocks
with no higher-level grouping.

**Why this priority**: Useful for future chapter-navigation and highlighting work, but nothing in
specs 001-003 or the immediately following specs (policy engine, normalization) strictly requires
section grouping to function — they can operate on the flat block list. Ranked below the P1
stories because the flat-list schema alone already unblocks later specs; section grouping is an
additive convenience on top of it.

**Independent Test**: Process a document containing multiple heading-delimited sections and
confirm the resulting document structure groups blocks under their enclosing section in reading
order, independent of any change to block-level fields.

**Acceptance Scenarios**:

1. **Given** a document with two or more heading blocks, **When** it is processed, **Then** the
   resulting structure exposes an ordered list of sections, each containing the blocks that follow
   its heading up to (but not including) the next heading of equal or higher level.
2. **Given** a document with no heading blocks at all, **When** it is processed, **Then** the
   resulting structure still exposes a valid section list (e.g. a single implicit section
   containing all blocks) rather than failing or omitting blocks.

### Edge Cases

- What happens when a block has no bounding box or style information available (e.g. OCR fallback
  text, or a synthetic block)? The schema's layout/style fields are optional per the goal
  document's own `DocumentBlock` shape — the block must still be valid without them.
- What happens when reading order contains gaps or is non-contiguous after existing
  column/reordering logic runs? Reading order values must remain strictly increasing across the
  document's blocks in output order; the schema does not require contiguous integers.
- What happens when the same document is reprocessed (e.g. re-opened)? The same input must
  produce blocks with the same ids given the same block content and position, so downstream
  features (resume state, caching) added in later specs can rely on id stability.
- What happens to block types not enumerated in the goal document's minimum type list (if the
  existing pipeline has any project-specific type)? Existing project-specific types are preserved
  as-is; this spec does not remove or rename any type already produced by specs 001-003.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The pipeline MUST represent every processed block as a single self-contained record
  exposing at minimum: a stable identifier, source page number, block type, reading-order
  position, a boolean flag indicating whether the block should be spoken, and the block's original
  text.
- **FR-002**: The pipeline MUST preserve, on each block's record, any layout information (position
  and size) already computed for that block by the existing extraction/classification pipeline,
  as optional fields present whenever that information exists.
- **FR-003**: The pipeline MUST preserve, on each block's record, any style information (font
  size, font weight, italics, font family) already computed for that block, as optional fields
  present whenever that information exists.
- **FR-004**: The pipeline MUST preserve, on each block's record, any classification confidence
  value already computed for that block (e.g. for page numbers or footnotes), as an optional
  field present whenever that information exists.
- **FR-005**: The pipeline MUST NOT change which blocks are classified as which type, which blocks
  are marked to be spoken versus excluded, or the reading order of blocks, relative to the
  behavior already established by specs 001-003.
- **FR-006**: The pipeline MUST NOT change the produced narration text or narration sequence for
  any document that specs 001-003 already process correctly.
- **FR-007**: The pipeline MUST organize a processed document's blocks into an ordered list of
  sections, where each section contains the ordered blocks that logically follow its heading (or
  a single default section when no headings exist), without omitting or duplicating any block from
  the flat reading-order sequence.
- **FR-008**: The document-level structure MUST expose a title and its ordered sections; each
  section MUST expose its heading level and its ordered blocks.
- **FR-009**: Given the same input document content, the pipeline MUST assign the same block
  identifiers on repeated processing runs.
- **FR-010**: The reader's display, highlighting, search, navigation, and playback-position
  features (as already implemented in specs 001-003) MUST continue to function against the new
  block/document representation without requiring changes to `index.html`, `styles.css`, or any
  user-facing control.
- **FR-011**: The new representation MUST NOT introduce any block type beyond those already
  produced by specs 001-003; adopting the goal document's full type vocabulary (e.g. `quote`,
  `list`, `equation`, `image`) is out of scope for this spec and deferred to whichever later spec
  first needs that type.

### Key Entities *(include if feature involves data)*

- **Document**: The top-level processed representation of one imported file. Has an identifier,
  a title, and an ordered list of sections. Represents the whole reading session's structural
  source of truth.
- **Section**: A logical grouping of blocks under one heading (or an implicit default grouping).
  Has an identifier, a heading level, an optional title, and an ordered list of blocks.
- **Block**: The smallest unit of processed document content (paragraph, heading, footnote, page
  number, header, footer, caption, table, or any other type already produced by specs 001-003).
  Has an identifier, source page, type, original text, reading-order position, a speak flag, and
  optional layout, style, and confidence information. Does not yet carry a separate spoken-text
  field — that is introduced by the normalization-engine spec.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the existing behavioral test suite (all tests passing under specs 001-003,
  currently 107 tests) continues to pass unmodified after this refactor.
- **SC-002**: For a representative document exercising every block type the pipeline currently
  produces, 100% of output blocks independently satisfy the required schema fields (FR-001
  through FR-004) without needing cross-referencing against other blocks or arrays.
- **SC-003**: Reprocessing the same source document twice yields identical block identifiers for
  100% of blocks across both runs.
- **SC-004**: A document containing at least two heading-delimited sections is grouped into a
  section list where 100% of blocks appear under their correct enclosing section, with zero
  blocks dropped or duplicated relative to the flat reading-order list.

## Assumptions

- The existing block objects produced internally by specs 001-003 already carry enough
  information (page, type, text, reading order, speak/exclude decision, and, where computed,
  bbox/style/confidence) that this spec is a reshaping/formalization of existing data rather than
  new detection work.
- "Stable identifier" means stable across repeated processing of the same source file in the same
  session/environment; cross-session persistence of identifiers (e.g. surviving a browser reload)
  is the concern of the resume-state spec later in this sequence, not this one.
- Section grouping (User Story 3) uses the heading detection already implemented in spec 003; no
  new heading-detection heuristics are introduced here.
- This spec does not change the module/file layout beyond what is needed to introduce the typed
  document/section/block shape; broader reorganization toward the goal document's suggested
  `core/pdf`, `core/document`, `core/speech`, `core/tts`, `core/reader` module structure is not
  required by this spec and may happen incrementally across later specs.
- No new user-facing settings, controls, or visual changes are introduced; this is an internal
  representation change only.

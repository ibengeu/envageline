# Feature Specification: Reading Pipeline Classification Quality

**Feature Branch**: `003-pipeline-classification-quality`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: close three specific gaps in the existing Smart PDF Reading
pipeline (`pdf-reader/app.js`, from feature 001-clean-private-reading): (1) heading detection —
section/chapter titles are currently narrated identically to body text; (2) paragraph boundary
detection — paragraph breaks are only inferred from existing line/block grouping, with no
explicit indentation/whitespace signal; (3) footnote/caption/table classification — these are
currently untyped and narrated as ordinary body paragraphs. This is a quality improvement to the
existing local, in-browser pipeline — no new architecture, no OCR, no worker topology, no
persistence changes, no network calls.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hearing when a new section starts (Priority: P1)

A listener is having a document read aloud. When the document reaches a chapter or section
heading, the listener can tell — through a distinct pause, tone, or announcement — that a new
section has begun, rather than the heading blending seamlessly into the body text that follows it
as if it were just another sentence.

**Why this priority**: Section boundaries are one of the primary ways listeners orient themselves
in a long document (where am I, how much is left, did I miss something). Narrating a heading
identically to body text erases that orientation signal entirely — this is the single biggest gap
identified in current listening quality.

**Independent Test**: Load a document with clearly-styled headings (larger/bolder font than body
text) and confirm the pipeline's output marks those blocks as headings distinct from surrounding
paragraphs, independent of any change to paragraph or footnote handling.

**Acceptance Scenarios**:

1. **Given** a document where headings use a font size or weight distinctly different from the
   document's own body text, **When** the document is processed, **Then** those blocks are
   classified as headings rather than paragraphs.
2. **Given** two different documents with headings at different absolute font sizes (e.g. one
   book's headings are 14pt, another's are 11pt but still larger than that book's own 9pt body
   text), **When** each is processed, **Then** each document's headings are correctly detected
   relative to that document's own body-text size, not a fixed absolute threshold.
3. **Given** a document with no distinguishable heading style anywhere (every block matches the
   body-text profile), **When** it is processed, **Then** no block is incorrectly forced into the
   heading type — the system does not invent headings that were never there.

---

### User Story 2 - Paragraph breaks land where the document intends them (Priority: P2)

A listener hears a document with multiple paragraphs inside what the pipeline currently treats as
a single block. The listener should hear a distinct pause where the source document shows a new
paragraph starting — signaled by indentation or extra vertical space — rather than the whole
block being narrated as one uninterrupted run of text.

**Why this priority**: This affects comprehension and pacing but is less disorienting than a
missed section boundary — a listener can usually still follow a run-on multi-paragraph passage,
just less comfortably. Ranked below heading detection for that reason.

**Independent Test**: Load a document containing a single reconstructed block that visually
represents multiple paragraphs (first-line indentation or a vertical gap between them) and confirm
the pipeline splits that block into separate paragraph-level narration units at those points.

**Acceptance Scenarios**:

1. **Given** a block containing lines where one line starts noticeably further right than the
   block's own established left margin, **When** the document is processed, **Then** a new
   paragraph boundary is recognized at that line.
2. **Given** a block containing a noticeably larger vertical gap between two lines than the
   gap typical of the surrounding lines, **When** the document is processed, **Then** a new
   paragraph boundary is recognized at that gap.
3. **Given** a block with uniform left margins and uniform line spacing throughout (a single true
   paragraph), **When** the document is processed, **Then** no paragraph boundary is introduced
   inside it.

---

### User Story 3 - Footnotes, captions, and tables don't interrupt narration as prose (Priority: P2)

A listener is having a document read aloud that contains footnotes, figure captions, or a table.
Today, this content is narrated as if it were ordinary body text, which is disruptive (a footnote
marker and text breaking into the middle of a sentence) or nonsensical (a table's rows and columns
read as a run-on sentence). These block types should be recognized and, consistent with how
headers/footers/page-numbers are already excluded from narration, excluded from narration by
default.

**Why this priority**: This is a real listening-quality problem, but it affects a narrower slice
of documents (those containing footnotes/captions/tables at all) than heading detection, and the
existing header/footer/page-number exclusion already establishes the pattern this story extends —
making it more mechanical than novel. Ranked alongside paragraph boundaries as P2.

**Independent Test**: Load a document containing a footnote block (small font, bottom-of-page
position) and confirm it is classified as a footnote and excluded from the default narration
output, independent of any change to heading or paragraph-boundary handling.

**Acceptance Scenarios**:

1. **Given** a block positioned near the bottom of a page in a noticeably smaller font than the
   document's body text, **When** the document is processed, **Then** that block is classified as
   a footnote and excluded from default narration.
2. **Given** a block positioned adjacent to a non-text page region (e.g. an image) with styling
   distinct from body text, **When** the document is processed, **Then** that block is classified
   as a caption and excluded from default narration.
3. **Given** a set of blocks whose text forms a repeated grid-like column alignment across
   multiple lines, **When** the document is processed, **Then** those blocks are classified as a
   table and excluded from default narration.
4. **Given** a block that merely happens to be short or numeric but does not match the
   footnote/caption/table position and styling evidence, **When** the document is processed,
   **Then** it remains classified as ordinary body content rather than being incorrectly excluded.

---

### Edge Cases

- What happens when a document has no clear body-text majority to compare against (e.g. every
  block uses a different font)? The system MUST fall back to treating all blocks as ordinary
  content (the current behavior) rather than guessing at a classification with no reliable
  baseline, consistent with the existing pipeline's confidence-threshold pattern for
  headers/footers.
- What happens when a heading candidate and a footnote/caption candidate share similar styling
  (e.g. both smaller than body text)? Position evidence (top-of-block-group vs. bottom-of-page)
  MUST take priority over font-size evidence alone to disambiguate, since font size alone is not a
  reliable discriminator between these types.
- What happens to a document that has none of these elements at all (no headings, every block is
  a single clean paragraph, no footnotes/captions/tables)? Its narration output MUST be unchanged
  from the current pipeline's output — this feature only adds new classifications where evidence
  supports them, never changes documents where no such evidence exists.
- What happens when paragraph-boundary detection would split a single sentence that merely wraps
  onto an indented continuation line (e.g. a hanging indent used for a citation or list, not a new
  paragraph)? The system MUST require the indentation or spacing evidence to differ from the
  block's own established pattern, not just from zero, so single-style hanging-indent blocks are
  not incorrectly fragmented.
- What happens when a table is only two or three cells wide and could be mistaken for a short list
  or two adjacent short paragraphs? The system MUST require the grid-alignment evidence to repeat
  across multiple lines before classifying as a table, consistent with the existing
  header/footer-detection pattern of requiring repetition before acting on uncertain evidence.

## Requirements *(mandatory)*

### Functional Requirements

**Heading detection**

- **FR-001**: System MUST classify a block as a heading when its typographic profile (font size
  and/or weight) differs materially from the document's own body-text profile, rather than from
  any fixed absolute size threshold.
- **FR-002**: System MUST NOT classify any block as a heading when the document has no
  distinguishable heading style relative to its own body text (i.e., absence of evidence must not
  produce a false heading).
- **FR-003**: System MUST treat a heading as a distinct narration unit from the paragraph content
  that follows it, so a listener can perceive the section boundary (e.g. via a distinguishing
  pause or marker at the narration-output level — the exact audio treatment is out of scope for
  this spec and belongs to the narration-rendering step this feature feeds into).

**Paragraph boundary detection**

- **FR-004**: System MUST recognize a new paragraph boundary within a reconstructed block when a
  line's starting horizontal position is noticeably indented relative to that block's own
  established left margin.
- **FR-005**: System MUST recognize a new paragraph boundary within a reconstructed block when the
  vertical gap between two lines is noticeably larger than the gap typical of the surrounding
  lines in that block.
- **FR-006**: System MUST NOT introduce a paragraph boundary inside a block whose margins and line
  spacing are uniform throughout.
- **FR-007**: System MUST NOT split a block at an indentation or spacing pattern that is uniform
  throughout that block (e.g. a consistent hanging indent), since a uniform pattern does not
  indicate a change.

**Footnote, caption, and table classification**

- **FR-008**: System MUST classify a block as a footnote when it is positioned near the bottom of
  a page in a font noticeably smaller than the document's body text.
- **FR-009**: System MUST classify a block as a caption when it is positioned adjacent to a
  non-text page region and has styling distinct from body text.
- **FR-010**: System MUST classify a set of blocks as a table when their text forms a repeated,
  grid-like column alignment across multiple lines.
- **FR-011**: System MUST exclude blocks classified as footnote, caption, or table from default
  narration output, consistent with the existing exclusion of headers, footers, and page numbers.
- **FR-012**: System MUST NOT classify a block as footnote, caption, or table based on a single
  weak signal (e.g. small size alone, or short text alone) without corroborating position or
  repetition evidence, to avoid excluding real body content by mistake.

**Cross-cutting**

- **FR-013**: System MUST produce identical classification output for identical document input,
  consistent with the existing pipeline's reproducibility guarantee (spec
  002-pdf-processing-foundations, FR-004/FR-005) — this feature adds new classification types but
  does not relax that guarantee.
- **FR-014**: System MUST leave documents with no headings, no multi-paragraph blocks, and no
  footnotes/captions/tables narrating identically to how they narrate today — this feature only
  changes output where its own new evidence positively supports a change.

### Key Entities

- **Heading**: A block classified as a section/chapter title based on typographic contrast with
  the document's body-text profile. Distinct from the existing `header`/`footer`/`page-number`
  types (which are page-furniture, repeated across pages) — a heading is content, appears once,
  and is part of the document's outline structure.
- **Paragraph Boundary**: Not a new block type — a split point introduced within an existing
  reconstructed block, based on indentation or vertical-spacing evidence, producing two or more
  narration units from what was previously treated as one.
- **Footnote**: A block classified as bottom-of-page, small-font annotation content, excluded from
  default narration.
- **Caption**: A block classified as being adjacent to and describing a non-text region (e.g. a
  figure), excluded from default narration.
- **Table**: A set of blocks classified by repeated grid-like column alignment, excluded from
  default narration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On documents with visually distinct headings, at least 90% of true headings are
  classified as headings rather than as body paragraphs, measured against a hand-labeled sample
  corpus.
- **SC-002**: On documents with no distinguishable heading style, 0% of blocks are incorrectly
  classified as headings.
- **SC-003**: On documents containing multi-paragraph blocks with visible indentation or spacing
  cues, at least 85% of true paragraph boundaries are recognized as boundaries, measured against a
  hand-labeled sample corpus.
- **SC-004**: On documents with uniform single-paragraph blocks, 0% of blocks have an incorrectly
  introduced paragraph split.
- **SC-005**: On documents containing footnotes, captions, or tables, at least 90% of those
  blocks are excluded from default narration, measured against a hand-labeled sample corpus.
- **SC-006**: On documents with none of these elements, narration output is byte-for-byte
  identical to the current pipeline's output, verified across a regression sample corpus.

## Assumptions

- This feature operates entirely within the existing block-reconstruction and classification
  stages already implemented in `pdf-reader/app.js` (from feature 001-clean-private-reading:
  `reconstructBlocks`, `analyzeDocumentStats`, `classifyBlocks`) — it extends that pipeline's
  existing "compare against the document's own learned profile, require corroborating evidence,
  default to leaving content alone when evidence is weak" pattern (already used for
  header/footer/page-number detection) to three new cases, rather than introducing a different
  detection architecture.
- "Materially different" font size/weight (FR-001) and "noticeably" indented/spaced (FR-004/
  FR-005) are relative thresholds tuned against real documents during implementation, the same way
  the existing `HEADER_FOOTER_MIN_REPETITION_RATE` and zone-confinement thresholds were tuned —
  this spec does not fix exact numeric values, since that is an implementation/plan detail, not a
  business requirement.
- The exact audio/narration treatment of a heading boundary (a pause length, a tonal change, an
  announcement) is out of scope for this spec; this spec ends at producing a correctly classified,
  distinct heading unit in the pipeline's output. How that gets rendered into speech is a
  separate, later concern.
- Table detection is scoped to recognizing and excluding tables from narration, not to extracting
  or narrating table contents in a structured way (e.g. reading cell-by-cell) — that would be a
  larger, separate feature.
- This feature does not require OCR, a dedicated worker, persistent storage, or any network
  access — it operates on already-extracted positioned text, exactly as the current pipeline does,
  and is out of scope beyond Epic 1+2 (the local-only/capability rules from spec
  002-pdf-processing-foundations already govern the pipeline this feature extends).

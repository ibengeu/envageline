# Feature Specification: Smart PDF Reading (Clean & Private PDF Reading)

**Feature Branch**: `001-clean-private-reading`

**Created**: 2026-09-11

**Status**: Draft (superseded scope — see revision note)

**Input**: User description: "Clean & Private PDF Reading — Automatically cleans extracted PDF
text for smoother narration while making Evangeline's local, non-retained document processing
clear to the user." Superseded by a follow-up "Smart PDF Reading" description that replaces
flat-text regex cleanup with a layout-aware pipeline (positioned extraction → lines → blocks →
document structure → speakable text), while keeping the same underlying goal: better narration,
kept private and local.

**Revision note**: User Story 1 below was rewritten to reflect the layout-aware approach
(geometry-preserving extraction and structural classification, not regex over flattened text).
User Stories 2 and 3 are unchanged — the non-retention messaging and reading-pane verifiability
goals still apply exactly as before, now extended to cover the richer set of artifacts this
approach can detect (columns, headings, footnotes, captions, tables) in addition to the original
four (headers, footers, page numbers, citations/URLs).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Smoother narration on real-world PDFs (Priority: P1)

A user drops in a PDF that has running headers, footers, page numbers, inline citation
markers, bare URLs, hyphenated line wraps, and — for many academic papers and reports — a
two-column layout. When they listen, they hear the actual sentence content flow naturally and
in correct reading order, without the reader interrupting itself to speak a repeated header, a
page number, a citation bracket, a raw link, or a fragment of the wrong column.

**Why this priority**: This is the core differentiator described in the product plan — the
"document-to-listening pipeline" is the reason Evangeline is worth using over a generic
browser read-aloud button. Without it, the rest of the product is a commodity TTS wrapper. A
naive flat-text approach (join all page text, then regex-clean it) cannot reliably tell a
repeated header from body text that happens to repeat, or read a two-column paper in the
correct order — both require knowing where text sits on the page, not just what it says.

**Independent Test**: Load a multi-page PDF known to contain repeated headers/footers, page
numbers, citation markers like `[12]`, at least one bare URL, at least one hyphenated line
wrap, and (separately) a two-column paper. Start playback and confirm none of the noise is
spoken, all surrounding sentence content is spoken in the correct order, and the two-column
document is read column-by-column rather than line-by-line across both columns.

**Acceptance Scenarios**:

1. **Given** a PDF where the same header line appears at the top of most pages, **When** the
   user plays the document, **Then** the header text is not spoken at any page boundary.
2. **Given** a PDF with sequential page numbers printed as standalone lines near a page edge,
   **When** the user plays the document, **Then** page numbers are not spoken and the
   surrounding sentence reads as a continuous thought.
3. **Given** a sentence containing an inline citation marker such as `[12]` or a bare URL,
   **When** the user plays that passage, **Then** the marker or URL is not spoken and the
   sentence remains grammatically coherent without it.
4. **Given** a word visually broken across two lines by a hyphen (e.g. "under-" / "standing"),
   **When** the user plays that passage, **Then** the word is spoken as one continuous word.
5. **Given** a two-column PDF page, **When** the user plays that page, **Then** the entire left
   column is read before the right column, not an interleaving of lines from both.
6. **Given** a PDF with none of these noise patterns or layout complexity (e.g. a short,
   single-column clean document), **When** the user plays it, **Then** no legitimate body text
   is dropped, altered, or reordered.
7. **Given** a page whose layout is too irregular for the system to confidently determine
   structure or reading order, **When** the user plays that page, **Then** the system still
   reads all the text using a reasonable fallback order rather than dropping content or
   failing.

---

### User Story 2 - Understanding that nothing is retained (Priority: P2)

A user who is about to read a sensitive document (legal, medical, financial) wants to know,
before and during use, that Evangeline is not storing or transmitting their document. They
should not have to read a privacy policy or FAQ to find this out — it should be visible in the
product itself.

**Why this priority**: Privacy is the product's other core promise, but today the behavior
exists without being communicated. A user who doesn't trust the tool won't use it on the
documents that matter most, regardless of how good the narration is.

**Independent Test**: Open the app cold (no prior session), load a document, and — without
reading any external documentation — identify where the document is being processed and that
it will not persist after the session ends.

**Acceptance Scenarios**:

1. **Given** a user has not yet loaded a document, **When** they view the main screen,
   **Then** they can see a plain-language statement that documents are processed on-device and
   not retained.
2. **Given** a user has loaded and is reading a document, **When** they look at the reading
   screen, **Then** the same non-retention assurance remains visible or easily reachable, not
   only shown once before upload.
3. **Given** a user closes or reloads the session, **When** they return, **Then** no trace of
   the previous document's content is visible anywhere in the interface, consistent with the
   stated assurance.

---

### User Story 3 - Confidence that cleanup doesn't remove or scramble real content (Priority: P3)

A user who is skeptical of automatic text cleanup and reordering wants a way to verify that the
system removed only noise (headers, footers, page numbers, citation markers, URLs) and reordered
only what genuinely needed reordering (e.g. columns), without silently dropping real sentences
or reading them in the wrong sequence.

**Why this priority**: Automatic cleanup and reading-order correction both carry a
false-positive risk. Trust in the P1 feature depends on users being able to confirm it isn't
eating content or scrambling it, but this is a secondary safeguard rather than the primary
value delivery.

**Independent Test**: Load a PDF, compare the on-screen extracted/displayed text against the
source PDF's actual body content, and confirm every real sentence is present, in a sensible
order, while noise lines are absent.

**Acceptance Scenarios**:

1. **Given** a document has been cleaned and reordered for narration, **When** the user views
   the reading pane, **Then** the displayed text reflects what will be spoken (and in what
   order), so removed noise or reordering is not silently hidden from inspection.
2. **Given** the system is uncertain whether a piece of text is noise, or uncertain how to order
   two pieces of text (e.g. a short line that could be a heading or a stray footer fragment, or
   a page whose column structure is ambiguous), **When** that ambiguous case is encountered,
   **Then** the system favors keeping the content and using a conservative order rather than
   silently discarding or confidently mis-ordering it.

---

### Edge Cases

- What happens when a document has no repeated headers/footers at all (e.g. a single-page
  document)? The cleanup step MUST make no changes rather than misfire on the first page.
- What happens when a citation-marker-like pattern is actually part of legitimate content
  (e.g. `[sic]` or a bracketed clarification, not a numbered citation)? The system MUST prefer
  under-removal to over-removal when the pattern doesn't match a numeric citation shape.
  Non-numeric bracketed patterns are not treated as citations.
- What happens when a bare URL is itself the useful content (e.g. a reference the user wants
  to hear)? URL suppression applies to narration only; the full text, including URLs, MUST
  still be visible in the on-screen reading pane per User Story 3.
- What happens when a page number pattern coincides with a real number in body text (e.g. "In
  2024," on a line by itself)? Page-number detection MUST require the line to be a standalone
  short numeric token consistent with pagination position, not any standalone number.
- How does the system handle a document where cleanup and the original extraction disagree
  after a page is re-processed (e.g. re-opening the same file)? Cleanup MUST be deterministic —
  the same input text produces the same cleaned output every time.
- What happens on a page whose layout is too irregular to classify confidently (e.g. a dense
  magazine-style layout, overlapping text regions)? The system MUST still read all text using a
  conservative fallback order rather than omitting content or failing to produce narration.
- What happens when column detection is ambiguous (e.g. a title or figure spans what looks like
  a column gap)? Full-width elements MUST NOT be forced into a single column; the system MUST
  favor treating ambiguous width as full-width over guessing a column assignment that could
  scramble reading order.
- What happens when a hyphenated line-wrap candidate spans what is actually two different
  structural blocks (e.g. end of one paragraph, unrelated word starting the next)? Dehyphenation
  MUST only merge across a line break that the system has already determined sits inside the
  same paragraph/block — never across a detected structural boundary.

## Requirements *(mandatory)*

### Functional Requirements

**Text fidelity (line and word level)**

- **FR-001**: System MUST reconstruct a visually wrapped line's text into a single continuous
  line before it is treated as narratable content, so a sentence split across multiple text
  fragments on the page is read as one sentence.
- **FR-002**: System MUST repair a word visually hyphenated across a line break (the line above
  ends in a hyphen, the next line continues the word) into a single spoken word, but only when
  both lines belong to the same paragraph/block — never across a detected structural boundary
  (heading, column break, page break that isn't a genuine continuation).

**Noise removal (structural level)**

- **FR-003**: System MUST remove header or footer text that recurs across multiple pages at the
  same page-edge position before the text is sent to narration.
- **FR-004**: System MUST remove standalone page-number text that shows a consistent pagination
  pattern (position, and either sequential progression or stable formatting) before the text is
  sent to narration.
- **FR-005**: System MUST remove inline numeric citation markers (e.g. `[12]`, `[3, 7]`) from
  narrated text without removing surrounding sentence content.
- **FR-006**: System MUST remove bare URLs from narrated text without removing surrounding
  sentence content.

**Reading order (layout level)**

- **FR-007**: System MUST determine each page's reading order using the text's position on the
  page, not merely its order of appearance in the raw extraction, so that a multi-column page is
  read one column at a time rather than interleaving lines across columns.
- **FR-008**: System MUST support single-column and two-column page layouts as first-class
  cases for reading-order determination in this release; layouts the system cannot confidently
  classify MUST fall back to a conservative reading order rather than fail or drop content
  (see Edge Cases).

**Fidelity and trust guarantees**

- **FR-009**: System MUST NOT alter the on-screen displayed/extracted text shown in the
  reading pane as a result of narration cleanup or reordering — cleanup and reading-order
  determination affect what is spoken and its spoken sequence; the reading pane continues to
  show literal extracted content for user inspection (User Story 3).
- **FR-010**: System MUST leave content unchanged when no recognized noise pattern (repeated
  header/footer, page number, citation marker, URL) is present, so short or atypical documents
  are not altered.
- **FR-011**: System MUST apply the same cleanup and reading-order rules deterministically, so
  re-processing the same document yields the same narration text and order every time.
- **FR-012**: System MUST favor retaining ambiguous content over removing it, and favor a
  conservative fallback order over a confident-looking but wrong reordering, whenever a
  classification's confidence is not clear-cut (e.g. a bracketed non-numeric marker, a number
  that isn't clearly a page number, a column boundary that isn't clearly established).

**Privacy (unchanged from original scope)**

- **FR-013**: System MUST display a plain-language statement, visible before a document is
  loaded, that documents are processed on the user's device and are not retained by Evangeline.
- **FR-014**: System MUST keep the non-retention assurance visible or reachable while a
  document is open, not only before the file is chosen.
- **FR-015**: System MUST NOT introduce any new transmission or storage of document content as
  part of this feature; all layout analysis, cleanup, and reading-order determination MUST occur
  using only document content and geometry already available on-device — no PDF content,
  layout, or derived structure may be sent to any server as part of this feature.

### Key Entities

- **Positioned extraction**: The text extracted from a PDF together with where it sits on the
  page (position, size, page number), before any narration-only cleanup is applied. This is
  what makes header/footer and column detection possible; a flat, position-less text string
  cannot support those requirements.
- **Reconstructed structure**: The document's text reorganized into lines, paragraphs/blocks,
  and a reading order derived from position — an intermediate representation, not a stored
  artifact, that exists only long enough to produce the narration text and the (unchanged)
  display text.
- **Cleaned narration text**: The version of the document's text with header/footer,
  page-number, citation-marker, and URL noise removed and reading order corrected for layout,
  used only to drive speech output. Derived on the fly; not persisted separately.
- **Displayed extracted text**: The literal, unmodified text extraction shown in the reading
  pane, independent of narration cleanup and reordering, used as the user's ground truth for
  verifying nothing real was dropped or scrambled.
- **Non-retention assurance**: The user-facing statement and its placement(s) confirming
  on-device processing and no server-side retention; not a data entity, but a required UI
  element tracked as part of this feature's scope.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When narrating a document with repeated headers/footers and page numbers,
  listeners hear zero repeated header/footer/page-number interruptions across the full
  document.
- **SC-002**: When narrating a document containing inline citation markers and bare URLs,
  listeners hear zero spoken citation markers or URLs, while 100% of surrounding sentence
  content remains intelligible and in original order.
- **SC-003**: Across a sample of clean, single-column, noise-free documents, 0% of real body
  sentences are altered, omitted, or reordered by the cleanup and reading-order steps (verified
  by comparing displayed text to spoken content and sequence).
- **SC-004**: A first-time user can state, without consulting outside documentation, that
  their document is not stored by Evangeline, after spending no more than 30 seconds on the
  main screen.
- **SC-005**: The non-retention assurance is visible on both the pre-load screen and the active
  reading screen in 100% of sessions.
- **SC-006**: Across a sample of two-column academic papers, listeners hear each column read to
  completion before the next column begins, on at least 90% of pages classified as two-column
  layout.
- **SC-007**: Across a sample of documents containing hyphenated line-wraps, 100% of sampled
  wrapped words are spoken as single continuous words rather than as two fragments.
- **SC-008**: No page in the evaluation sample causes narration to fail outright or skip an
  entire page's content, even when that page's layout cannot be confidently classified.

## Assumptions

- This feature operates on text extracted from a PDF, extended to also capture each text
  fragment's position and size on the page (not merely its content) — this is a change from the
  original flat-text-only extraction, needed to support header/footer, page-number, and column
  detection reliably. It does not change how PDF files are opened or rendered on screen.
- "Repeated across multiple pages" for header/footer detection means the same text recurs at
  the same page-edge position on multiple pages; a single occurrence, or text that only
  resembles a header/footer without recurring, is not treated as one.
- Citation-marker removal targets numeric bracket patterns (e.g. `[12]`, `[3, 7]`, `[4-6]`)
  consistent with common academic citation styles; non-numeric bracketed text (e.g. `[sic]`,
  author-name citations) is out of scope for removal in this release and is left untouched.
- Reading-order determination in this release targets single-column and two-column page
  layouts as first-class cases. Three-or-more-column layouts and irregular/magazine-style
  layouts are handled by the conservative fallback (Edge Cases), not by dedicated detection, in
  this release.
- The non-retention assurance is a messaging/UI requirement only; it does not change or add any
  actual storage behavior, since no server-side retention exists today.
- Headings, footnotes, captions, and tables may be identifiable as a side effect of the
  structural analysis this feature introduces, but deliberately reading/skipping them as
  distinct categories, OCR, EPUB support, and mathematical/table content narration are out of
  scope for this feature and are addressed by separate, later work.
- No machine-learning-based document understanding (layout models, LLMs) is used in this
  release; detection and reading-order determination use deterministic, geometry-based
  heuristics only, consistent with keeping all processing local and fast.
- "Narration" and "spoken text" refer to whatever voice/TTS path the user has selected; this
  feature changes the text and its order fed into that path, not the voice technology itself.

# Feature Specification: Sentence Highlight Alignment

**Feature Branch**: `014-sentence-highlight-alignment`

**Created**: 2026-09-14

**Status**: Ready for planning

**Input**: User description: "Fix the new reader's narration overlay highlighting so each spoken sentence highlights only its own text geometry and remains aligned on rotated and scaled PDF pages."

## User Scenarios & Testing

### User Story 1 - Highlight the Spoken Sentence (Priority: P1)

When the reader speaks a sentence, the visible highlight covers the text for that sentence only. The highlight does not cover the complete paragraph when the paragraph contains multiple sentences.

**Why this priority**: The highlight is the main visual link between the spoken audio and the document. A paragraph-wide highlight makes the reader lose the current position.

**Independent Test**: Load a page with two sentences in one paragraph. Start narration. Confirm that the first sentence highlights first and the second sentence highlights after the first completes.

**Acceptance Scenarios**:

1. **Given** a paragraph contains two sentences on separate lines, **When** the first sentence is active, **Then** only the source line or lines for the first sentence are highlighted.
2. **Given** a sentence crosses a line break, **When** the sentence is active, **Then** all source lines for that sentence are highlighted and no unrelated line is highlighted.
3. **Given** the active sentence changes, **When** the reader updates the current segment, **Then** the previous sentence highlight is removed.

### User Story 2 - Stay Aligned Across PDF Viewports (Priority: P1)

The highlight remains over the correct text when the reader renders a PDF at a different display width, zoom level, or page rotation.

**Why this priority**: Misalignment makes the feature unreliable across common PDF layouts and screen sizes.

**Independent Test**: Render test pages at base size, fit width, zoomed width, and rotated page orientations. Compare the highlight rectangle with the source text rectangle.

**Acceptance Scenarios**:

1. **Given** a page is rendered at fit width, **When** narration highlights a sentence, **Then** the highlight stays over the sentence.
2. **Given** a page is zoomed, **When** narration highlights a sentence, **Then** the highlight scales with the page and stays over the sentence.
3. **Given** a PDF page has a supported rotation, **When** narration highlights a sentence, **Then** the highlight uses the same page coordinate system as the rendered page.

### User Story 3 - Preserve Reader Interaction (Priority: P2)

The reader keeps current scrolling, click-to-seek, sidebar page selection, sentence order, and highlight-follow behavior after the alignment fix.

**Why this priority**: The fix must improve visual accuracy without changing reading controls.

**Independent Test**: Run the existing reader behavior tests and manually use play, pause, seek, page navigation, and return-to-narration with an active highlight.

**Acceptance Scenarios**:

1. **Given** narration is active, **When** the user pauses or resumes, **Then** the active highlight remains on the current sentence.
2. **Given** the user clicks a visible text region, **When** the reader seeks, **Then** the selected sentence and highlight remain in the same reading order.
3. **Given** the user scrolls manually, **When** the active highlight changes, **Then** the reader does not force-scroll until the existing narration-follow rule permits it.
4. **Given** the user selects a page in the sidebar, **When** the page selection changes, **Then** the reader scrolls the selected page into view.

## Edge Cases

- A sentence has no source text box after cleanup. The reader must omit the highlight without failing narration.
- A sentence spans multiple source lines. The reader must render one rectangle per source line.
- A paragraph contains a citation or removed text. The spoken sentence and visible geometry must still map to the remaining source text.
- A page has zero or invalid dimensions. The reader must avoid invalid CSS percentages and continue without a highlight.
- A PDF page uses rotation or a non-default viewport transform. The extracted geometry must use the rendered page coordinate system.
- A page is re-rendered while the active segment stays unchanged. The highlight must remain aligned after the render completes.
- A selected page is temporarily outside the virtualized page window. The reader must render and scroll to the selected page without selecting a different page.

## Requirements

### Functional Requirements

- **FR-001**: The reader MUST associate each narration segment with only the visible source geometry for that segment.
- **FR-002**: The reader MUST support one or more highlight rectangles for a segment that spans multiple lines.
- **FR-003**: The reader MUST keep the highlight geometry in the same normalized coordinate system as the rendered page.
- **FR-004**: The reader MUST preserve highlight alignment when the page display width or zoom changes.
- **FR-005**: The reader MUST handle supported PDF page rotations without shifting the highlight to a different text region.
- **FR-006**: The reader MUST omit invalid or empty highlight rectangles without stopping narration.
- **FR-007**: The reader MUST preserve sentence order and current-segment updates.
- **FR-008**: The reader MUST preserve existing click-to-seek, pause, resume, and narration-follow behavior.
- **FR-011**: The reader MUST scroll a page selected from the sidebar into view and MUST keep the selected page as the current page.
- **FR-009**: The reader MUST keep extracted document text as literal text and MUST NOT interpret it as markup.
- **FR-010**: The reader MUST NOT add a network request, storage record, or dependency for highlight alignment.

### Key Entities

- **Source text geometry**: A normalized rectangle that identifies a visible text item or line on one PDF page.
- **Narration segment geometry**: The ordered set of source text rectangles associated with one spoken sentence.
- **Rendered page viewport**: The display coordinate system used by the PDF page and its overlay.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In a test page with two sentences in one paragraph, the active highlight excludes the inactive sentence in 100% of tested sentence transitions.
- **SC-002**: In viewport tests covering base width, fit width, zoom, and supported rotation, every valid highlight rectangle remains within 2 CSS pixels of its source text geometry after rendering.
- **SC-003**: Existing reader behavior tests continue to pass with no changes to playback order or seek behavior.
- **SC-006**: Selecting any page from the sidebar leaves that page at the reader viewport start in all supported page-window states.
- **SC-004**: Invalid geometry produces no invalid CSS position or size values and does not produce a narration error.
- **SC-005**: The feature adds no network request, persistent storage entry, or runtime dependency.

## Assumptions

- The new reader continues to render PDF pages with the existing PDF renderer.
- The existing normalized rectangle type remains the public geometry contract.
- Sentence cleanup may change spoken text. The implementation must use the closest available visible source text mapping.
- The first release supports the PDF rotations exposed by the existing PDF renderer.
- Visual verification can use the existing sample PDF and focused browser or component checks.
- The old `pdf-reader` implementation is out of scope.

# Feature Specification: Android Kotlin Port

**Feature Branch**: `015-android-kotlin-port`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "Port the Evangeline reader to a native Kotlin Android app using
Jetpack Compose. Faithfully port the narration, segmentation, normalization, read-ahead, and
playback-controller behavior from `reader-app/src/reader` test-first, into a new `android-app/`
folder. The existing web readers (`reader-app/`, `pdf-reader/`) must not be modified."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Listen to a document on a phone (Priority: P1)

A listener opens a PDF from their phone's storage, presses play, and hears the document read aloud
passage by passage, with the passage being spoken highlighted on screen.

**Why this priority**: This is the product. Nothing else in the port has value until a document can
be opened, narrated, and followed visually. Delivered alone, this is a usable reader.

**Independent Test**: Install on a device, open a text-based document, press play, and confirm
audible narration with the spoken passage highlighted — no other story needs to exist.

**Acceptance Scenarios**:

1. **Given** a text-based document on the phone, **When** the listener opens it, **Then** the
   document is displayed and can be narrated without any network access.
2. **Given** an open document, **When** the listener presses play, **Then** narration begins at the
   first readable passage and that passage is highlighted.
3. **Given** narration is playing, **When** a passage finishes, **Then** narration continues into
   the next readable passage without a manual action.
4. **Given** a document whose pages contain no readable text, **When** the listener opens it,
   **Then** the reader says the document has no readable text rather than playing silence.

---

### User Story 2 - Reading quality matches the existing reader (Priority: P1)

A listener plays the same document on the phone and in the existing web reader. The passages
spoken, their order, and their wording match.

**Why this priority**: A port that sounds worse than the original is a regression, not a delivery.
The tuned reading behavior is the differentiated value. Independently verifiable against the
existing reader without any playback UI.

**Independent Test**: Compile passages from a fixed document and compare the spoken text and order
against the existing reader's output for the same document.

**Acceptance Scenarios**:

1. **Given** a paragraph containing abbreviations such as "Dr.", "e.g.", or "U.S.", **When** it is
   split into passages, **Then** the abbreviation does not end a passage.
2. **Given** text containing numbers, percentages, money, or decimals, **When** a passage is
   prepared for speech, **Then** those values are spoken as words using the same rules as the
   existing reader.
3. **Given** a page carrying a running header, footer, or page number, **When** passages are
   compiled, **Then** those elements are not spoken.
4. **Given** a two-column page, **When** passages are compiled, **Then** the left column is read
   fully before the right column.
5. **Given** text containing numeric or author-year citations, **When** a passage is prepared,
   **Then** the citation is not spoken.

---

### User Story 3 - Continuous narration on a slow device (Priority: P2)

A listener plays a long document on a phone where speech preparation takes a variable amount of
time. Narration does not stall between passages.

**Why this priority**: Read-ahead is what makes narration feel continuous, and it matters most on
the hardware this target introduces. The reader works without it, just less smoothly.

**Independent Test**: Drive passage preparation with a stand-in whose response time varies, and
confirm the number of passages prepared ahead moves within its bounded range.

**Acceptance Scenarios**:

1. **Given** narration is playing, **When** a passage is being spoken, **Then** at least one
   upcoming passage is prepared at the same time.
2. **Given** preparation becomes slower, **When** narration continues, **Then** the number of
   passages prepared ahead increases, up to a ceiling of six.
3. **Given** an upcoming passage was already prepared, **When** narration reaches it, **Then** the
   prepared audio is used rather than preparing it a second time.

---

### User Story 4 - Safe playback and interruption handling (Priority: P2)

A listener seeks, changes voice or speed, opens another document, backgrounds the app, or receives
a phone call while narration and preparation are in flight.

**Why this priority**: Audio from the wrong document, or a highlight that disagrees with the voice,
is a correctness failure. A phone introduces interruptions the web reader never faced.

**Independent Test**: Trigger each change during active narration and confirm the highlight and
audio stay aligned and no superseded audio is heard.

**Acceptance Scenarios**:

1. **Given** narration is playing, **When** the listener jumps to another passage, **Then** audio
   prepared for the abandoned passage is discarded and never heard.
2. **Given** narration is playing, **When** the listener changes voice or speed, **Then** later
   passages use the new setting and audio prepared under the old setting is not reused.
3. **Given** narration is playing, **When** another document is opened, **Then** no audio from the
   previous document is heard.
4. **Given** narration is playing, **When** another app takes over audio (a call, an alarm),
   **Then** narration pauses and does not resume without the listener asking.
5. **Given** narration is playing, **When** the app moves to the background, **Then** narration
   either continues visibly under the listener's control or pauses cleanly.

---

### User Story 5 - Resume where reading stopped (Priority: P3)

A listener closes the app mid-document and returns later. Reading resumes at the passage where they
stopped.

**Why this priority**: Valuable for long documents, but the reader is fully usable without it.

**Independent Test**: Stop mid-document, close the app, reopen the same document, confirm the
restored position; then confirm a different document does not restore that position.

**Acceptance Scenarios**:

1. **Given** a listener stopped mid-document, **When** they reopen the same document, **Then**
   reading resumes at the stored passage.
2. **Given** a stored position for one document, **When** a different document is opened, **Then**
   that position is not restored.
3. **Given** stored position data is damaged or unreadable, **When** a document is opened, **Then**
   reading starts from the beginning without blocking the listener.

---

### Edge Cases

- **A document that is images only (a scan)**: reported as having no readable text, rather than
  narrating silence or appearing to work.
- **A password-protected document**: the listener is told the document is locked; the app does not
  crash or hang.
- **A damaged or partially unreadable document**: pages that can be read stay readable; one bad
  page does not take down the rest of the document.
- **A page whose text is positioned outside the page boundary**: the highlight is placed within the
  page rather than disappearing or being dropped.
- **Speech preparation fails mid-document** (engine unavailable, resource exhaustion): the listener
  is told narration failed rather than playback silently stalling.
- **A very long document**: opening and narrating does not degrade as page count grows; passages
  are prepared as needed rather than all at once.
- **The listener changes voice or speed rapidly and repeatedly**: the audio that plays matches the
  most recent setting, with no audible burst of superseded audio.
- **Storage is full or unwritable when saving position**: reading continues; failure to save a
  position never blocks narration.
- **The listener seeks to the last passage and it finishes**: reading completes cleanly rather than
  advancing past the end.
- **The app is interrupted during preparation, not playback**: no audio is heard when the listener
  returns unless they ask for it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reader MUST open documents from the phone's storage and determine the text on
  each page along with where that text sits on the page.
- **FR-002**: The reader MUST split text into spoken passages using the same abbreviation-aware
  rules as the existing reader.
- **FR-003**: The reader MUST speak numbers, percentages, currency, decimals, and titles as words
  using the existing reader's rules.
- **FR-004**: The reader MUST NOT speak running headers, footers, page numbers, captions, tables,
  code, footnotes, or references.
- **FR-005**: The reader MUST read multi-column pages one column at a time, finishing a column
  before moving to the next.
- **FR-006**: The reader MUST NOT speak numeric or author-year citations.
- **FR-007**: The reader MUST highlight the passage currently being spoken and keep that highlight
  aligned with what is heard.
- **FR-008**: Listeners MUST be able to play, pause, jump to a passage, move to the next or
  previous passage, and move to the next or previous paragraph.
- **FR-009**: Listeners MUST be able to set a reading speed between 0.5x and 3x in 0.1 steps, and
  choose from the available voices.
- **FR-010**: The reader MUST prepare upcoming passages ahead of playback, adjusting how far ahead
  it works between one and six passages based on how long preparation is taking.
- **FR-011**: The reader MUST discard prepared audio made obsolete by a change of document,
  passage, voice, or speed, and MUST NOT play it.
- **FR-012**: The reader MUST pause when another app takes over audio, and MUST NOT resume on its
  own.
- **FR-013**: The reader MUST save reading position against an identifier derived from the
  document's own content, and MUST restore it only for that same document.
- **FR-014**: The reader MUST discard damaged saved data without blocking reading.
- **FR-015**: The reader MUST report a document with no readable text as unreadable rather than
  narrating nothing.
- **FR-016**: The reader MUST NOT send document content, text, or filenames off the device in a
  released version.
- **FR-017**: Any developer-only narration service used during development MUST be restricted to
  the developer's own machine, checked before every use, and absent from released versions.
- **FR-018**: Saved data MUST NOT retain filenames, document text, or document contents alongside
  the derived identifier.
- **FR-019**: Text taken from a document MUST be treated as untrusted and displayed as literal
  text, never interpreted as instructions or markup.
- **FR-020**: The existing web readers MUST remain unmodified by this feature.

### Key Entities

- **Document**: An opened document — a content-derived identifier, page count, display title, and
  page dimensions. Does not retain where the file came from.
- **Page**: One page's text with positions on the page, and how far it has progressed through
  processing.
- **Block**: A positioned run of text with a classification (title, heading, paragraph, header,
  footer, page number, caption, table, code, footnote, reference, list item, unknown).
- **Passage**: A narratable unit — the text spoken, its source page, its position in reading order,
  where to highlight, and its kind. The unit of playback, highlight, jump, and preparation.
- **Narration Settings**: The chosen voice and reading speed. Both form part of prepared audio's
  identity, so changing either makes previously prepared audio obsolete.
- **Reading Position**: A content-derived document identifier and a passage position.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a fixed set of test documents, the passages spoken and their order are identical
  to those produced by the existing reader, with zero differences.
- **SC-002**: A listener can go from opening a document to hearing correctly-ordered narration with
  an aligned highlight, on a phone, with zero network access.
- **SC-003**: Every reading-behavior rule verified in the existing reader (53 verified behaviors)
  remains verified, with no expected value changed.
- **SC-004**: During continuous narration, the silence between consecutive passages stays under 300
  milliseconds once reading is underway.
- **SC-005**: Across a complete reading session in a released version, zero requests carrying
  document content, text, or filenames leave the device.
- **SC-006**: No reading-behavior rule regresses when the interface or storage changes — the full
  set of verified behaviors passes before any release.

## Out of Scope

- Reading text out of scanned images (the existing reader tracks this state but does not implement
  it).
- Formats other than PDF.
- Any account, sign-in, sync, or stored reading history outside the device.
- Changes to the existing web readers.
- Publishing to an app store.
- Other platforms, and extracting shared code for reuse across platforms. Reading logic SHOULD stay
  free of phone-specific dependencies so a future extraction stays cheap, but no shared module is
  built here.

## Assumptions

- The target is phone-sized devices on a currently supported operating system version; tablet
  layout refinement is not a goal.
- Speech can be produced on the device itself, either by a bundled voice or the phone's own speech
  service; which one is a planning decision and does not change the passage rules.
- The 53 behaviors verified in the existing reader encode intended behavior correctly. Where one
  encodes an obvious defect, it is raised rather than silently carried across.
- Documents are opened from the phone's own storage through the system file picker; no separate
  file manager is built.

## Dependencies

- The existing reader's adaptive read-ahead behavior (feature 013), whose preparation rules are
  carried across.
- The existing reader's highlight alignment behavior (feature 014), whose highlight placement is
  carried across.
- The existing reader (feature 012), which is the reference this port is compared against.

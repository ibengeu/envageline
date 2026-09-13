# Contract: Highlight Resolution (`pdf-reader/app.js`)

This project exposes no network API. Following specs 008–010, this document specifies the
*observable* behaviour of the reading pane's active-passage marking — the real contract surface.
The functions involved are internal and unexported; the behaviours below are verified through the
full app via the existing `loadBrowserApp` helper.

## Changed: a passage stays highlighted for as long as it is being read

**Purpose**: FR-001, US1.

**Behavioural guarantees**:

- A passage narrated across several chunks is the highlighted passage while *any* of those chunks
  is playing, not only the first.
- Narration moving from one chunk of a passage to the next does not move or remove the highlight.
- A passage is highlighted from the start of its first chunk until the moment the next passage's
  narration begins.

## Changed: exactly one passage is highlighted

**Purpose**: FR-002, FR-004, US2.

**Behavioural guarantees**:

- At any moment during playback, exactly one rendered passage carries the active marker.
- When several passages are narrated together in one chunk, the first of them in reading order is
  the highlighted one.
- The selection is stable: the same document at the same chunk always highlights the same passage.

## Preserved: the pane is never left with nothing highlighted

**Purpose**: FR-003, and OWASP A08:2025 (plan.md Security Review).

**Behavioural guarantees**:

- While audio for the next chunk is being prepared, a passage remains highlighted.
- An active chunk index before the first passage's start, or beyond the last passage's start, still
  resolves to exactly one passage rather than none.

## Changed: the highlight does not advance ahead of the voice

**Purpose**: FR-005, US3.

**Behavioural guarantees**:

- With narration audio still being prepared, the highlight has not advanced onto the passage whose
  audio is pending.
- When audio for a passage begins playing, that passage becomes the highlighted one.

## Preserved: clicking a passage highlights it immediately

**Purpose**: FR-006.

**Behavioural guarantees**:

- Clicking a passage marks it active without waiting for its audio to be prepared or to begin.
- This is existing behaviour and must survive the timing change in FR-005.

## Preserved: a non-narrated passage never becomes the highlight

**Purpose**: FR-009.

**Behavioural guarantees**:

- A footnote, header, caption, or table passage is visible and clickable but is never the
  highlighted passage during ordinary playback.

## Preserved: documents without block structure behave correctly

**Purpose**: FR-012, and OWASP A08:2025.

**Behavioural guarantees**:

- On the fallback mapping path (EPUBs, PDFs with no usable layout data), exactly one passage is
  highlighted at any moment and no passage becomes permanently unhighlightable — including when the
  document contains repeated identical passages, where the underlying map is not ordered.

## Preserved: nothing about narration changes

**Purpose**: FR-010, FR-011.

**Behavioural guarantees**:

- The spoken words, their order, and the division of the document into chunks are byte-for-byte
  identical to before this feature.
- Saved reading positions continue to refer to the same place in the document.

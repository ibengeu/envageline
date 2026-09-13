# Contract: Blank Passage Rendering (`pdf-reader/app.js`)

This project exposes no network API. Following the precedent of specs 008 and 009, this document
specifies the *observable* behaviour of the reading pane and the passage→chunk mapping — the actual
contract surface for this feature. `documentPassages`, `resolvePassages`, `renderNarrationBlocks`,
and `buildChunksAndMapping` are internal and not exported; the behaviours below are verified
through the full app via the existing `loadBrowserApp` test helper, matching how every prior
reading-pane behaviour is tested.

## Changed: the reading pane renders only passages with visible text

**Purpose**: FR-001, FR-002, FR-004.

**Behavioural guarantees**:

- A document containing blocks whose text is entirely whitespace renders no passage for those
  blocks.
- Every rendered passage contains at least one visible character.
- Visible passage numbering is consecutive across rendered passages — no number is consumed by a
  block that is not rendered.
- A block whose text is a single visible character (for example `.`) is rendered normally.
- A passage's rendered text is exactly the block's text, including any whitespace surrounding its
  visible characters.

## Unchanged: extracted text is rendered as literal text

**Purpose**: FR-003 and OWASP A07:2025 Injection (plan.md Security Review).

**Behavioural guarantees**:

- Passage text continues to reach the DOM through `textContent` only; no rendering path is added
  or altered.
- The existing guarantees that PDF and EPUB content are never parsed as markup continue to hold
  unmodified.

## Changed: only passages with visible text are clickable

**Purpose**: FR-005.

**Behavioural guarantees**:

- No clickable row corresponds to a whitespace-only block.
- Clicking any rendered passage begins playback at that passage's own text.

## Preserved: documents with blank blocks keep the exact passage→chunk mapping

**Purpose**: FR-006, FR-007 — the guarantee the naive fix would silently break.

**Behavioural guarantees**:

- For a document with reconstructed block structure, the number of narrated passages equals the
  number of narrated blocks, so the exact mapping applies.
- A document containing whitespace-only blocks *and* two passages with identical text resolves a
  click on the later identical passage to that occurrence, not the earlier one. This behaviour is
  only produced by the exact mapping; under the word-overlap fallback both resolve to the same
  chunk, so this scenario is what proves the invariant held.

## Preserved: nothing spoken changes

**Purpose**: FR-009, FR-010.

**Behavioural guarantees**:

- The narration text, its word order, and the resulting speech chunk boundaries are byte-for-byte
  identical to before this feature, for every document.
- Saved reading positions continue to refer to the same place in the document, because chunk
  indices are unchanged.

## Preserved: a document with nothing readable fails cleanly

**Purpose**: FR-011 and OWASP A08:2025 Mishandling of Exceptional Conditions.

**Behavioural guarantees**:

- A document in which every block is whitespace-only produces no passages and is reported through
  the existing "no readable text" path, with playback controls disabled — not an empty clickable
  pane, and not an error.

## Preserved: documents without block structure are unaffected

**Purpose**: FR-012.

**Behavioural guarantees**:

- EPUBs, and PDFs whose pages carry no usable position data, continue to render one passage per
  blank-line-separated section exactly as before, and render no blank rows.
- These documents continue to use the word-overlap mapping, which is correct for them: their
  passages do not correspond one-to-one with narrated blocks.

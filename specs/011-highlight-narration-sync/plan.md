# Implementation Plan: Highlight and Narration Synchronisation

**Branch**: `011-highlight-narration-sync` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-highlight-narration-sync/spec.md`

## Summary

Three defects, all in how the reading pane resolves which passage is active, all reproduced
against the real pipeline before planning.

**Defect A — the highlight goes dark mid-paragraph.** `buildPassageButton` marks a passage active
on `chunkIndex === activeIndex`, comparing the playing chunk against the passage's *first* chunk.
A passage spanning several chunks lights only on its first. Measured end to end through
`buildPipelineOutput`: a 700-character paragraph maps `[0,1,3]` over 4 chunks, so passage 1 covers
chunks 1–2 but is dark for chunk 2; a 1400-character paragraph maps `[0,1,6]` over 7 chunks and
leaves 4 of them with nothing highlighted; a 3000-character paragraph leaves 11 of 14. Exact
figures are fixture-dependent — the dark-chunk count grows with paragraph length, which is the
invariant that matters.

**Defect B — the highlight runs ahead of the voice.** `renderPlaybackText(state.chunkIndex)` is
called before `await currentChunk`, so the highlight moves when synthesis is *requested*. Proven
through the app harness: with the synthesis promise held open, the pane already showed the first
passage active while no `Audio` object existed. Synthesis costs ~1.55 s fixed plus ~0.0143 s/char,
so the lead is over a second on a cache miss and near zero on a prefetch hit — an unpredictable,
varying desync. `onended` repeats it at every boundary: it increments `chunkIndex` then calls
`speakLocalChunk`, which re-renders before the next audio starts.

**Defect C — several passages highlight at once.** Merging packs short passages into one chunk, so
several share a first-chunk index. Measured: five short passages map `[0,1,1,1,1]`, and the
equality test matches four of them against chunk 1 simultaneously.

**The critical finding.** Fixing A and C means replacing the equality test with a range test, and
ranges derive from the existing map as `[map[i], map[i+1])`. That derivation is only valid if the
map is monotonic non-decreasing. Measured:

```text
exact map (PDFs with block structure)
  duplicates + long block   [0,1,3,3]    monotonic, all chunks covered
  footnote mid-document     [0,1,1]      monotonic, all chunks covered
  merged short passages     [0,1,1,1]    monotonic, all chunks covered

fallback map (EPUBs, PDFs with no usable layout)
  duplicate passages        [0,1,0]      DECREASING
```

The fallback map is built by similarity scoring, which has no ordering guarantee: two identical
passages can score against chunks out of order. A derived range of `[1, 0)` is empty, so that
passage would be permanently unhighlightable — an FR-012 failure that would appear only on EPUBs
and only with repeated text. Ranges must therefore be derived defensively rather than assuming
monotonicity, or resolved differently on the fallback path. This is the analogue of spec 010's
alignment invariant: a silent, path-specific failure that no visible acceptance criterion catches.

**Technical approach**: resolve the active passage by scanning for the last passage whose start is
at or before the playing chunk, rather than by equality. That single rule fixes A (a passage stays
active until the next one starts), fixes C (only one passage can be the last at-or-before), and is
inherently safe against a non-monotonic map because it selects one winner regardless of ordering.
For B, move the highlight advance to the moment `Audio.play()` is called, while retaining the
pre-await render so click-to-seek keeps its instant feedback (FR-006) and the pane is never blank
(FR-003).

**Out of scope, verified**: the progress bar shares `state.chunkIndex` and has the same granularity,
but no functional requirement mentions it, so it is left unchanged.

## Technical Context

**Language/Version**: JavaScript (ES2022), browser-targeted, no build step

**Primary Dependencies**: None added

**Storage**: N/A — bookmarks and the audio cache are untouched (FR-011)

**Testing**: `node --test pdf-reader/reader.test.js`, 223 passing at baseline

**Target Platform**: Modern browsers, static files served from localhost

**Project Type**: Single-project static web application

**Performance Goals**: Active-passage resolution runs on every render; it must stay proportional to
the number of rendered passages, which is already the rendering cost

**Constraints**: Spoken output, chunk boundaries, and saved bookmark indices unchanged (FR-010,
FR-011); extracted text still rendered as literal text only

**Scale/Scope**: Active-passage resolution plus the timing of one render call in
`pdf-reader/app.js`; new behavioural tests in `pdf-reader/reader.test.js`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Local-First Privacy)**: PASS. No new input, network, or persisted data. The change
  is a selection rule over an in-memory list.
- **Principle II (Narrow Product Surface)**: PASS. Repairs an existing reading-pane behaviour.
  Passes the "does this make a document better to listen to?" test directly — a highlight that goes
  dark or points at four rows at once is worse than useless for following along. No new control,
  and the spec explicitly rejected adding a "preparing" visual state for this reason.
- **Principle III (Behavior-Driven TDD, NON-NEGOTIABLE)**: PASS. Each story maps to a failing test
  asserting observable outcomes: which passage carries the active marker while a given chunk plays
  (US1), how many carry it (US2), and whether it has advanced while audio is still pending (US3).
- **Principle IV (Security Review as a Gate)**: PASS — see Security Review. This touches the
  rendering path for untrusted document text, so the review is mandatory rather than N/A.
- **Principle V (Simplicity & Cyclomatic Discipline)**: PASS. One resolution rule replaces one
  equality test; the range scan is a single helper. No new state field, no new abstraction. The
  scan-for-last-at-or-before rule is *simpler* than deriving explicit ranges and also happens to be
  robust against the non-monotonic fallback map — a case where the simpler option is the safer one.

**Initial gate result**: PASS. No violations requiring Complexity Tracking entries.

**Post-design re-check** (after Phase 1): PASS, unchanged. Design confirmed that resolving by
"last passage starting at or before the active chunk" needs no precomputed ranges, no new state,
and no special-casing of the fallback path — the same rule is correct on both.

## Security Review

*(Constitution Principle IV — mandatory: this feature touches the rendering path for untrusted
document text.)*

**Applicable OWASP Top 10:2025 risks**:

- **A07:2025 Injection** — APPLICABLE. Passage text comes from an untrusted PDF or EPUB. This
  feature changes *which* passage is marked active, not *how* text reaches the DOM.
  **Mitigation**: the sink is unchanged — `buildPassageButton` continues to assign `textContent`
  and never `innerHTML`. The three existing literal-text and injection tests must pass unmodified.
- **A08:2025 Mishandling of Exceptional Conditions** — APPLICABLE, and the substantive risk.
  Three exceptional conditions:
  1. *A non-monotonic fallback map* (measured: `[0,1,0]`). A range-based resolution would silently
     produce an empty range and leave a passage unhighlightable on EPUBs with repeated text.
     **Mitigation**: use a scan that selects exactly one winner regardless of ordering, and pin it
     with a test on the fallback path.
  2. *No passage highlighted during audio preparation* (FR-003). Moving the advance to audio start
     must not leave the pane blank for the second or more of synthesis. **Mitigation**: the
     previously-active passage persists until the next audio begins; tested directly with a held
     synthesis promise.
  3. *An active chunk before the first passage's start, or past the last* — resolution must still
     yield exactly one passage rather than none or an error.
- **A01, A02, A03, A04, A05, A09** — N/A. No authentication or authorization surface; no
  configuration or CSP change; no dependency added, removed, or updated; no cryptographic material
  touched (bookmark key derivation is unchanged); no new network path.

**Key behavior-driven security tests planned via TDD**:

- A document on the fallback path with repeated passages still highlights exactly one passage, and
  every passage remains reachable (A08, FR-012).
- With synthesis held pending, some passage remains highlighted and it has not advanced past the
  passage being read (A08, FR-003/FR-005).
- The existing literal-text and injection tests pass unmodified (A07).

## Project Structure

### Documentation (this feature)

```text
specs/011-highlight-narration-sync/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── highlight-resolution.md
├── checklists/
│   └── requirements.md  # Created by /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
pdf-reader/
├── app.js               # active-passage resolution; highlight timing in speakLocalChunk
├── reader.test.js       # new behavioural tests for US1, US2, US3
├── index.html           # unchanged
└── styles.css           # unchanged
```

**Structure Decision**: Single project, matching specs 001–010. No new files. The `.is-active`
styling already exists and is correct — only which element receives it, and when, changes — so no
stylesheet edit is made.

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.

# Phase 0 Research: Highlight and Narration Synchronisation

No `NEEDS CLARIFICATION` markers remain. Every decision was settled by running the real pipeline
against constructed fixtures before design.

## Decision 1: Resolve the active passage by "last passage starting at or before the active chunk"

**Decision**: Replace the `chunkIndex === activeIndex` equality test with a scan that picks the
last passage whose start index is at or before the currently playing chunk. That passage, and only
that passage, is marked active.

**Rationale**: One rule fixes two defects and is inherently safe against a third hazard.

- *Defect A (dark highlight)*: a passage spanning chunks 1–3 has start 1, and the next passage
  starts at 4. While chunks 1, 2, or 3 play, the last passage starting at or before is still the
  one with start 1, so it stays highlighted for its whole reading.
- *Defect C (several highlighted)*: when passages share a start (measured `[0,1,1,1,1]`), only one
  can be *last* among them, so exactly one is selected. This also implements the spec's tie-break
  assumption without any extra rule — see Decision 2.
- *Hazard (non-monotonic map, Decision 3)*: a scan selects one winner from whatever ordering it is
  given; it cannot produce an empty or inverted selection the way a derived range can.

**Alternatives considered**:

- *Precompute explicit ranges `[map[i], map[i+1])` per passage*: the obvious reading of the fix,
  and it works on the exact map — measured coverage `[1,1,1,1,1]`, every chunk covered exactly
  once. It was rejected because it is unsafe on the fallback map (Decision 3) and because it needs
  either a precomputation step or a lookahead at render time, both more machinery than a scan for
  the same result. Principle V favours the simpler option when both achieve the outcome.
- *Store the active passage index in state and update it as chunks advance*: adds a state field
  that can drift out of sync with `chunkIndex`, creating a second source of truth for the same
  fact. Rejected on Principle V.

## Decision 2: When several passages share a chunk, the first of them is highlighted

**Decision**: Among passages sharing a start index, the one that appears first in reading order is
the active one.

**Rationale**: The spec requires a stable rule (FR-004) and assumes the first passage. Narration of
a merged chunk does begin with the first passage's text, so it is the passage the voice is actually
reading when that chunk starts. Note this is the *first* of the tied passages, which the scan of
Decision 1 yields naturally when it stops at the first match of the maximum start value — the
implementation must take care to select the first tied passage, not the last, since "last passage
starting at or before" is ambiguous among ties.

**Alternatives considered**:

- *Highlight the last tied passage*: equally stable, but wrong on the substance — the voice begins
  with the first passage's words, so highlighting the last would point ahead of what is being said.
- *Highlight all tied passages*: this is the current behaviour and the defect being fixed.

## Decision 3: Do not derive ranges, because the fallback map is not monotonic

**Decision**: Resolution must not assume the passage→chunk map increases monotonically.

**Rationale**: Measured across both mapping paths:

```text
exact map (PDFs with reconstructed block structure)
  duplicates + long multi-chunk block   [0,1,3,3]   monotonic, all chunks covered
  footnote mid-document                 [0,1,1]     monotonic, all chunks covered
  merged short passages                 [0,1,1,1]   monotonic, all chunks covered

fallback map (EPUBs, PDFs with no usable layout data)
  duplicate passages                    [0,1,0]     DECREASING
```

The fallback map comes from word-overlap similarity scoring, which carries no ordering guarantee:
two identically-worded passages can each score best against different chunks, out of order. Under a
range derivation, passage 1 would get `[1, 0)` — an empty range — and could never be highlighted,
on any EPUB containing repeated text. The failure is silent and path-specific: no visible
acceptance criterion for US1 or US2 would catch it, because it only manifests on the fallback path
with duplicate text.

The scan of Decision 1 is immune: given `[0,1,0]` and active chunk 0, it selects a passage; given
active chunk 1, it selects passage 1. It always yields exactly one.

**Alternatives considered**:

- *Sort or clamp the fallback map to force monotonicity*: changes the mapping itself, which the
  spec places out of scope, and would alter which chunk a click jumps to — a behaviour change
  disguised as a highlight fix.
- *Use ranges on the exact path and a different rule on the fallback path*: two code paths for one
  behaviour, twice the surface to test, for no benefit over a single rule that works on both.

## Decision 4: Move the highlight advance to audio start, keeping the pre-await render

**Decision**: Keep the existing render call before synthesis, and add a render at the moment audio
begins playing. The first keeps the pane populated and gives click-to-seek instant feedback; the
second is what actually moves the highlight onto a newly-started passage.

**Rationale**: FR-003 and FR-005 conflict if the pre-await render is simply deleted — the pane
would show nothing during the second or more of synthesis, which is worse than the early highlight
being fixed. Retaining it means the previously-active passage stays marked until the next one truly
begins, satisfying both: never ahead of the voice, never absent.

Click-to-seek (FR-006) depends on this too. The click handler sets `chunkIndex` and calls
`speakLocalChunk`, whose pre-await render is what makes the clicked passage light up immediately.
Deleting that render would make a click appear unresponsive for over a second.

**Alternatives considered**:

- *Delete the pre-await render and render only on audio start*: violates FR-003 and breaks FR-006's
  instant click feedback.
- *Introduce a distinct "preparing" visual state*: rejected in the spec's Assumptions as new
  user-facing surface, against Principle II.
- *Drive the highlight from audio playback position rather than chunk transitions*: far more
  precise, and the right answer for word- or sentence-level highlighting later, but it requires
  timing data the TTS engine does not provide (established earlier in this project: the local
  engine returns audio and sample rate only). Out of scope here.

## Decision 5: Leave the progress indicator unchanged

**Decision**: No change to progress reporting.

**Rationale**: It derives from the same chunk index and therefore shares the same granularity, but
no functional requirement in this spec mentions it, and changing it would widen scope beyond the
reported defect. Recorded here so the omission is visibly deliberate rather than an oversight.

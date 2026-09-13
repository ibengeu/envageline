# Phase 0 Research: Blank Passage Rendering

No `NEEDS CLARIFICATION` markers remain. Every decision below was settled by running the real
pipeline against constructed fixtures before design, not by reasoning about the code.

## Decision 1: "Blank" means no visible characters, determined by trimming

**Decision**: A passage is excluded when `String(text).trim().length === 0`. A block containing a
single visible character — a lone `.`, a page-number digit — is **not** blank and still renders.

**Rationale**: The current predicate is `text.length > 0`, which admits any run of whitespace.
Measured against the real pipeline:

```text
block 1  len=3  "   "        -> rendered as a passage
block 2  len=1  " "     -> rendered as a passage
block 4  len=1  "."          -> rendered as a passage  (correctly)
```

`.trim()` removes all Unicode whitespace including the non-breaking space, so both defective cases
collapse while the legitimate single-character case survives. This matches what a reader means by
"blank": a row with nothing to read.

**Alternatives considered**:

- *Test against a whitespace regex such as `/^\s*$/`*: identical outcome to `.trim()`, with no
  advantage and a slightly larger surface to get wrong. Principle V favours the simpler of two
  equivalent options.
- *Require a minimum length (say, 2 characters)*: rejected. It would discard legitimate
  single-character passages, and the spec's edge cases explicitly pin a lone `.` as renderable.
- *Normalise the text as it is stored, so blanks never reach the passage list*: rejected as out of
  scope. Block reconstruction produces whitespace blocks from genuine source-document layout;
  changing reconstruction risks the classification, column-ordering, and reading-order behaviours
  that specs 002–004 pinned, for no additional benefit here.

## Decision 2: Filter both the passage list and the narrated-block list, at the same predicate

**Decision**: Apply the same blank test in `documentPassages`, in `resolvePassages`' blank-line
fallback, **and** in `renderNarrationBlocks`. All three must agree.

**Rationale**: This is the finding that makes the feature non-trivial, and it is invisible if
untested. `buildChunksAndMapping` selects the exact O(1) passage→chunk mapping only when

```text
narratedPassages.length === result.narrationBlocks.length
```

`renderNarrationBlocks` emits an entry for every speakable block, including one that normalises to
an empty string. Measured on the reproduction fixture:

```text
narrationBlocks:            ["Real first paragraph.", "", "", "Real second paragraph."]   (4)
narrated passages (before):                                                                4  -> GUARD true
narrated passages (naive fix):                                                             2  -> GUARD false
```

So filtering only the display side flips the guard to `false` for any document containing a single
stray whitespace block, silently dropping it onto the ~1350ms word-overlap search — which also
cannot distinguish two identically-worded passages, reintroducing the defect fixed in commit
`2184165`. A whitespace block contributes no chunks in any case
(`splitIntoSpeechChunks("   ") === []`), so removing it from the narrated list changes nothing
about what is spoken; it only restores the count equality.

**Alternatives considered**:

- *Relax the guard to compare something other than length*: rejected. The guard's job is to detect
  when passages and narrated blocks have stopped corresponding one-to-one; weakening it to tolerate
  a known divergence would blind it to the unknown ones it exists to catch.
- *Filter blanks only in `renderNarrationBlocks`*: rejected — inverts the problem, leaving the
  visible blank rows in place, which is the reported defect.
- *Keep the blank passage but render it without a chunk index (disabled)*: rejected. It removes the
  misdirected click but leaves the empty row and the consumed paragraph number, so the visible
  defect and the numbering gap both survive.

## Decision 3: Fix the data, not the stylesheet

**Decision**: No change to `styles.css`. The blank rows are removed by not constructing those
passages.

**Rationale**: A CSS-only fix (`.literal-paragraph:empty { display: none }`) was considered because
it is a one-line change. Two objections defeat it, each sufficient on its own:

1. `:empty` does not match the actual case. It requires an element to have no child nodes at all,
   and a whitespace-only passage contains a text node — so the rule would never fire for `"   "`.
2. Even a rule that did match would only hide the row. The button would remain in the DOM and in
   the accessibility tree, still carrying its `data-chunk-index`, so it would stay reachable by
   keyboard and would still misdirect playback when activated (FR-005).

The defect is in which passages exist, so it is fixed where passages are built.

**Alternatives considered**:

- *`:empty` selector*: does not match whitespace-only text nodes. Ineffective for the actual case.
- *`min-height: 0` on the passage button*: would shrink the row but leave it in the DOM as a
  clickable target, so the misdirected click (FR-005) would remain.

## Decision 4: Selection highlighting is already correct — no change

**Decision**: Do not modify `speakLocalChunk`, `renderPlaybackText`, or the click handler.

**Rationale**: The report described "selection of a passage and presentation" as faulty, which
suggested the active highlight might be lagging behind the click. Inspection shows
`renderPlaybackText(state.chunkIndex)` is called at the top of `speakLocalChunk`, **before** the
`await` on synthesis, so the highlight moves as soon as a passage is clicked and does not wait for
audio. The observed misbehaviour is fully explained by clicking a blank row, which carries a
`data-chunk-index` pointing at an unrelated chunk. Fixing the blanks removes the symptom.

**Alternatives considered**:

- *Move the re-render earlier, or add one to the click handler*: rejected as a change with no
  defect behind it. Principle V — do not build for a problem that was not demonstrated.

# Phase 1 Data Model: Blank Passage Rendering

This feature introduces no new entity and no new persisted field. It narrows the membership rule
of two existing in-memory lists and adds an invariant tying them together.

## Passage (existing, membership rule changed)

One readable, clickable unit shown in the reading pane. Produced by `documentPassages` from the
document AST, or by `resolvePassages`' blank-line fallback for documents with no reconstructed
block structure.

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | `string` | yes | The literal text shown to the reader, unmodified. Leading and trailing whitespace around visible text is preserved (FR-003) — trimming is used only to *decide membership*, never to alter the stored value. |
| `speak` | `boolean` | yes | Whether this passage's block is narrated under the active speech policy. Unchanged by this feature. |

**Membership rule (changed)**: a passage is constructed only when its text contains at least one
visible character — `String(text).trim().length > 0`. Previously the rule was
`String(text).length > 0`, which admitted whitespace-only blocks (FR-001, FR-002).

## Narrated block (existing, membership rule changed)

The spoken form of one narrated block, produced by `renderNarrationBlocks` and fed to the chunker.
A plain string, not an object.

**Membership rule (changed)**: a narrated block is emitted only when its narration text contains at
least one visible character, applying the same predicate as Passage (FR-006).

A whitespace-only block contributes no speech chunks either way
(`splitIntoSpeechChunks("   ")` returns `[]`), so this narrows the list without changing what is
spoken (FR-009).

## Alignment invariant (the load-bearing rule)

```text
passages.filter(p => p.speak).length === narrationBlocks.length
```

`buildChunksAndMapping` uses this equality to decide whether the exact O(1) passage→chunk mapping
is applicable. When it holds, each narrated passage corresponds positionally to one narrated block,
and `passageChunkMap` can walk them in step. When it does not hold, the reader falls back to
word-overlap similarity matching.

**Why it must be stated explicitly**: the invariant is satisfied today only because *neither* list
filters blanks. Filtering one side alone breaks it, and the failure is silent — no error, no
visible symptom, just a slower and less accurate mapping. Measured:

| Configuration | narrated passages | narrationBlocks | invariant | mapping used |
|---|---|---|---|---|
| Before this feature | 4 | 4 | holds | exact |
| Filtering passages only | 2 | 4 | **broken** | approximate fallback |
| Filtering both (this feature) | 2 | 2 | holds | exact |

## Validation rules (from Functional Requirements)

- Every constructed passage MUST contain at least one visible character (FR-002).
- A passage's `text` MUST be stored exactly as the block produced it, including any surrounding
  whitespace (FR-003) — the trim is a predicate, not a transformation.
- `renderNarrationBlocks` MUST exclude exactly the blocks `documentPassages` excludes (FR-006).
- The alignment invariant above MUST hold for every document that has reconstructed block
  structure, so such documents keep the exact mapping (FR-007).
- A document with no whitespace-only blocks MUST produce an identical passage list, narrated-block
  list, and chunk list to before this feature (FR-008, FR-009).
- A document in which every block is blank MUST produce an empty passage list, which the existing
  load path already reports as "no readable text" (FR-011).
- Documents with no reconstructed block structure use `resolvePassages`' fallback, which MUST apply
  the same predicate so they cannot render blank rows either (FR-012).

## State transitions

None. Both lists are rebuilt from scratch on each document load; neither carries state across
loads, and this feature adds no field to `state`.

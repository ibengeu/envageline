# Phase 1 Data Model: Highlight and Narration Synchronisation

This feature introduces no new entity, no new persisted field, and no new state field. It changes
one derived value — which passage is active — and when that derivation is applied.

## Passage (existing, unchanged shape)

One readable, clickable unit in the reading pane.

| Field | Type | Notes |
|---|---|---|
| `text` | `string` | Literal text shown to the reader. Unchanged. |
| `speak` | `boolean` | Whether the passage is narrated. Unchanged. |

The passage→chunk map (one start index per passage, already maintained) is likewise unchanged. This
feature only reads it differently.

## Active passage (derived, rule changed)

Not stored. Computed at render time from the passage list, the passage→chunk map, and the chunk
currently being narrated.

**Previous rule**: a passage is active when its start index equals the active chunk index.

**New rule**: the active passage is the **first** passage among those with the greatest start index
that is less than or equal to the active chunk index. Equivalently: scanning in reading order, the
active passage is the last one whose start index is at or before the active chunk — and where
several tie at that value, the earliest of them.

**Why the tie-break clause matters**: passages sharing a start index are common — merging packs
short passages into one chunk, measured `[0,1,1,1,1]`. "Last at or before" alone is ambiguous among
ties and would select the final tied passage, pointing ahead of the words actually being spoken.
Selecting the first tied passage matches what the voice reads when that chunk begins (research.md
Decision 2).

## Derivation properties

| Property | Requirement | Source |
|---|---|---|
| Exactly one active | For any active chunk index, the rule yields one passage or none-if-empty-document | FR-002, FR-003 |
| Total coverage | Every chunk index resolves to some passage | FR-003 |
| Ordering-independent | Correct even if the map is not monotonic | FR-012, research.md Decision 3 |
| Stable | Same document and chunk index always yield the same passage | FR-004 |

**Measured map shapes the rule must handle**:

```text
[0,1,3,3]      exact map, duplicates and a multi-chunk block   monotonic
[0,1,1]        exact map, non-narrated footnote                monotonic
[0,1,1,1]      exact map, merged short passages                monotonic, ties
[0,1,0]        fallback map, duplicate passages                NOT monotonic
```

The last shape is why the rule must be a scan rather than a range derivation: `[map[i], map[i+1])`
yields `[1, 0)` for passage 1 there, an empty range, making that passage permanently
unhighlightable.

## Highlight timing (changed)

Not a data structure, but the other half of the feature.

| Moment | Before | After |
|---|---|---|
| Narration requested for a chunk | Highlight advances to that chunk's passage | Pane re-rendered; highlight does **not** advance past the passage being read |
| Audio for that chunk begins playing | No highlight change | Highlight advances to that chunk's passage |
| Passage clicked | Highlight advances immediately | Unchanged — still immediate (FR-006) |
| Playback paused | No change | Unchanged (FR-007) |

## State transitions

None added. The active passage is derived on each render; no field records it, so there is no
transition to manage and no possibility of it drifting out of sync with the playing chunk.

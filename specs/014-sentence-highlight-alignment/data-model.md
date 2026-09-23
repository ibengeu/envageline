# Data Model: Sentence Highlight Alignment

## Source line

An ordered source line from one PDF paragraph.

| Field | Type | Invariant |
|-------|------|-----------|
| `text` | string | Literal extracted text. |
| `bounds` | `BoundingBox` | Finite normalized rectangle. |

## Narration segment geometry

The existing `NarrationSegment.bounds` field becomes sentence-specific.

| Field | Type | Invariant |
|-------|------|-----------|
| `bounds` | `BoundingBox[]` | Contains only source rectangles for the spoken sentence. |
| `sourceBlockIds` | string[] | Preserves existing paragraph source references. |
| `spokenText` | string | Preserves existing normalized speech text. |

## Normalized bounding box

```text
{ x, y, width, height }
```

Invariants:

- `x`, `y`, `width`, and `height` are finite numbers.
- `x` and `y` are between 0 and 1.
- `width` and `height` are greater than 0.
- `x + width` and `y + height` are at most 1 after clamping.
- The rectangle uses the same top-left viewport orientation as the rendered page.

## State transitions

```text
PDF text item
  -> viewport rectangle
  -> normalized source line
  -> paragraph group
  -> sentence token range
  -> sentence-specific bounds
  -> safe overlay rectangle
```

Invalid input exits the chain before the overlay. Invalid geometry does not change playback state.

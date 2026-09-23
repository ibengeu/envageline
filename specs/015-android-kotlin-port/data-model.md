# Data Model: Android Kotlin Port

**Feature**: `015-android-kotlin-port` | **Phase**: 1 (design) | **Date**: 2026-09-15

Entities are derived from the spec's Key Entities section and the pinned TypeScript source
(`reader-app/src/reader/core/types.ts` at `bb0c1f4`). Implemented in
`android-app/core/src/main/kotlin/com/evangeline/reader/model/`.

## Geometry convention

All positions are **normalised to 0..1 in both axes**, relative to the page box, and never stored in
pixels. This makes geometry independent of render scale, zoom, and device density, and is what lets
the ported highlight tests run on the JVM with no renderer present.

## Entities

### BoundingBox

| Field | Type | Rules |
|---|---|---|
| `x`, `y` | Double | ≥ 0 |
| `width`, `height` | Double | > 0 |

**Validation**: all four finite; `x + width ≤ 1` and `y + height ≤ 1`, within a rounding slack of
1e-6. A box failing validation is **clamped to the page, not dropped** (A10) — a float artifact must
never silently remove the highlight for a passage being narrated.

### DocumentBlock

A positioned run of text as extracted from a page, before narration decisions.

| Field | Type | Notes |
|---|---|---|
| `id` | String | `p{page}-b{index}` |
| `page` | Int | 1-based |
| `text` | String | Untrusted document content (FR-019) |
| `bounds` | BoundingBox | Normalised |
| `fontSize` | Double? | Normalised against page height |
| `fontName` | String? | |
| `source` | BlockSource | `PDF_TEXT` or `OCR` |
| `confidence` | Double? | OCR only |
| `type` | DocumentBlockType? | Assigned by classification |

**State**: `type` is null until layout classification runs, then one of the 14 block types.

### DocumentBlockType → narration policy

Every block type maps to `READ` or `SKIP`. The map is **exhaustive by test**, because a type with no
entry would default to spoken — the wrong default for page furniture (FR-004).

| Policy | Types |
|---|---|
| READ | title, heading, paragraph, list-item, quote, unknown |
| SKIP | caption, header, footer, page-number, footnote, table, code, reference |

### NarrationSegment (the Passage)

The unit of playback, highlight, jump, and preparation.

| Field | Type | Notes |
|---|---|---|
| `id` | String | Stable within a document |
| `documentId` | String | Content-derived |
| `page` | Int | |
| `type` | NarrationSegmentType | title, heading, paragraph, list, caption |
| `originalText` | String | As it appears on the page — drives highlight mapping |
| `spokenText` | String | Normalised — drives speech |
| `sourceBlockIds` | List\<String\> | Provenance |
| `bounds` | List\<BoundingBox\> | One per source line; a passage may span lines |
| `order` | Int | Reading order across the whole document |
| `paragraphId` | String | Groups passages for paragraph navigation (FR-008) |
| `speech` | SpeechShaping? | Optional rate/pause shaping |

**Why two text fields**: the highlight maps to glyphs on the page while narration speaks the
normalised form ("23.7" is highlighted, "twenty-three point seven" is spoken).

### ReadingProgress

| Field | Type | Notes |
|---|---|---|
| `documentId` | String | **Content-derived (SHA-256 over bytes)** |
| `page` | Int | |
| `segmentId` | String? | |
| `segmentIndex` | Int | |
| `updatedAt` | Long | Epoch millis |

**Security invariant (FR-018, A04)**: this record carries **no filename, no extracted text, and no
document bytes**. The content-derived key is the only link to the document, which is what makes
"restores for the same document, never for a different one" (FR-013) testable without retaining
anything sensitive.

**Failure rule (FR-014, A10)**: damaged or unreadable progress data is discarded and reading starts
from the beginning. It never blocks reading.

### TtsOptions (Narration Settings)

| Field | Type | Rules |
|---|---|---|
| `rate` | Double | 0.5 ≤ rate ≤ 3.0, step 0.1 (FR-009) |
| `voiceId` | String? | Null means platform default |

**Identity rule (FR-011)**: both fields participate in prepared-audio identity. Changing either
makes previously prepared audio obsolete, and obsolete audio must never play.

### ExtractedPage / PdfDocumentModel / DocumentHints

- **ExtractedPage** — one page's blocks plus `scanned` and `textLength`. A page whose meaningful
  text length falls below the scan threshold (20) is flagged scanned, driving FR-015.
- **PdfDocumentModel** — content-derived `id`, `filename` (in-memory only, never persisted per
  FR-018), `pageCount`, metadata, page dimensions.
- **DocumentHints** — repeated header and footer strings learned across pages, so running furniture
  is suppressed document-wide rather than page by page.

## Lifecycle

```text
Document opened
  → bytes hashed (SHA-256) → documentId
  → per page: extract blocks → classify types → group lines → group paragraphs
  → order across columns → strip citations → normalise → split sentences
  → NarrationSegment list (ordered)
  → playback: prepare ahead (1–6) → speak → highlight → advance
  → position saved against documentId only
```

## Processing and playback states

**ProcessingState** (per page): `UNPROCESSED → EXTRACTING → TEXT_READY → LAYOUT_PROCESSING →
NARRATION_READY`, with `OCR_REQUIRED`/`OCR_PROCESSING` reserved (out of scope) and `ERROR` terminal
for that page only — one bad page never takes down the document (A10).

**PlaybackState**: `IDLE → PREPARING → PLAYING ⇄ PAUSED`, plus `BUFFERING` when preparation has not
kept ahead, `COMPLETED` at the end of the last passage, and `ERROR`.

## Coded errors

`PDF_LOAD_FAILED`, `PDF_PASSWORD_REQUIRED`, `PAGE_RENDER_FAILED`, `TEXT_EXTRACTION_FAILED`,
`OCR_FAILED`, `NARRATION_FAILED`, `TTS_FAILED`, `STORAGE_FAILED`.

**A07 invariant**: the code is what gets logged and displayed. Document text, filenames, and derived
keys never appear in an error payload, so a crash report cannot leak the document being read.

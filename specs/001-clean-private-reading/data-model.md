# Data Model: Smart PDF Reading — Layout-Aware Listening Compiler

This feature introduces no persisted data and no new stored entity — every shape below is a
transient, in-memory value produced and consumed within a single `extractPdfText` call. Nothing
here is a class or a stored type; each is a description of the plain-object shape a pipeline
stage's exported function takes as input or produces as output, so `/speckit-tasks` can break
work into per-stage, per-shape testable units per Constitution Principle III (tests target
function behavior, never these shapes' internals directly).

## Positioned Text Item

One text fragment from PDF.js's `getTextContent()`, normalized to a plain shape.

| Field | Type | Notes |
|---|---|---|
| `text` | string | The fragment's text content (from `item.str`). |
| `page` | integer | 0-based page index. |
| `bbox` | `NormalizedBBox` | Position/size normalized to 0–1 of page width/height, derived from `item.transform`/`width`/`height`. |
| `fontSize` | number \| undefined | Approximate size derived from the transform's scale component, when available. |
| `fontName` | string \| undefined | From PDF.js item metadata, when available. |

## Normalized Bounding Box

| Field | Type | Notes |
|---|---|---|
| `x0`, `y0` | number (0–1) | Top-left corner, relative to page width/height. |
| `x1`, `y1` | number (0–1) | Bottom-right corner. |

## Page Line

A visual line reconstructed from one or more Positioned Text Items (research.md §2).

| Field | Type | Notes |
|---|---|---|
| `page` | integer | 0-based page index. |
| `text` | string | Concatenated, left-to-right ordered text of the items in this line. |
| `bbox` | `NormalizedBBox` | Union of the contributing items' boxes. |
| `fontSize` | number \| undefined | Representative size for the line. |
| `position` | `"first"` \| `"last"` \| `"body"` | Whether this is the first/last line of its page (used by header/footer/page-number detection) or an interior line. |

## Page Block

One or more Page Lines grouped as a paragraph-like unit (research.md §3).

| Field | Type | Notes |
|---|---|---|
| `page` | integer | 0-based page index. |
| `lines` | `PageLine[]` | The lines making up this block, in order. |
| `text` | string | The block's lines joined into continuous text (dehyphenation applied per research.md §9, block-boundary aware). |
| `bbox` | `NormalizedBBox` | Union of the block's lines' boxes. |
| `type` | `"header"` \| `"footer"` \| `"page-number"` \| `"heading"` \| `"body"` | Classification result (research.md §5, §6; heading detection is a side effect used only for reading-order/future work per spec Assumptions, not exposed to the user in this release). |
| `confidence` | number (0–1) | How confident the classification is; used by the preservation-favoring gates in research.md §5/§6. |
| `column` | `0` \| `1` \| `undefined` | Column assignment when the page is two-column (research.md §7); `undefined` for full-width blocks or single-column pages. |

## Document Statistics

Computed once per document (research.md §4), used by header/footer/page-number/column
detection.

| Field | Type | Notes |
|---|---|---|
| `pageCount` | integer | Total pages. |
| `medianBodyFontSize` | number \| undefined | Dominant body text size, used to distinguish headings from body. |
| `headerCandidates` | array of `{ normalizedText, pages: integer[], region: "left"\|"center"\|"right" }` | Candidate repeated top-of-page text, clustered by horizontal region. |
| `footerCandidates` | same shape as `headerCandidates` | Candidate repeated bottom-of-page text. |
| `columnLayoutByPage` | array of `"single"` \| `"two-column"` \| `"unknown"` | One entry per page, from research.md §7. |

## Reading-Order Result

The per-page ordered list of Page Blocks to narrate (research.md §8) — not a new stored shape,
just the `PageBlock[]` array reordered; called out separately here because it is the value that
diverges from display order.

## Cleaned Narration Text

The string handed to `splitIntoSpeechChunks`: the Reading-Order Result's blocks (excluding
those classified as `header`/`footer`/`page-number` at high confidence, per research.md §5/§6),
joined in reading order, with citation markers and bare URLs removed (research.md §9). Derived
fresh on every extraction; never cached or persisted separately.

**Relationship to existing entities**: this is the new value flowing into
`splitIntoSpeechChunks`, replacing what `normalizePdfText`'s output alone used to provide.

## Displayed Extracted Text

The existing, unmodified per-page text, in the PDF's own raw order, shown in the reading pane
(`renderExtractedText` / `renderChunkedText`). Unchanged by this feature, and — per the revised
FR-009 — must remain in original order even when Cleaned Narration Text reorders two-column
content, per research.md §10.

**Relationship to existing entities**: this is `extractPdfText`'s existing return value,
untouched in content and order.

## State Transitions

None. Every stage (extraction → lines → blocks → document stats → classification → column
detection → reading order → narration text) is a pure function producing a new value from its
input, with no state held between calls — satisfying FR-011 (determinism). The only sequencing
is a straight pipeline (each stage consumes the previous stage's output); there is no
stage output that later feeds back into an earlier stage.

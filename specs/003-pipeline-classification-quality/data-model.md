# Data Model: Reading Pipeline Classification Quality

This feature introduces no persisted data. The shapes below are transient, in-memory values
produced and consumed entirely within one document's classification pass, extending the existing
`Document Statistics` and `Block` shapes from feature 001-clean-private-reading.

## Extended: Document Statistics (`analyzeDocumentStats`'s return value)

| Field | Type | Notes |
|---|---|---|
| `pageCount` | integer | Unchanged from the existing shape. |
| `medianBodyFontSize` | number \| undefined | Unchanged — already computed today, but was previously unused by any classification rule. This feature is its first consumer. |
| `headerCandidates` / `footerCandidates` | array | Unchanged from the existing shape. |
| `headingFontSizeThreshold` *(new)* | number \| undefined | The font size above which a block is a heading candidate, derived from `medianBodyFontSize` plus a tuned margin (research.md §2). `undefined` when no reliable `medianBodyFontSize` exists (FR-002's "no evidence, no false heading" case). |
| `footnoteFontSizeThreshold` *(new)* | number \| undefined | The font size below which a bottom-zone block is a footnote candidate, derived from `medianBodyFontSize` minus a tuned margin (research.md §4). `undefined` under the same no-evidence condition. |

## New: Paragraph-Boundary Split (applied within `reconstructBlocks`'s output, before `analyzeDocumentStats`)

Not a new persisted entity — a transformation that takes one `Block` (from feature
001-clean-private-reading, with its `lines` array) and returns one or more `Block`s, splitting at
detected boundaries. Each resulting block keeps the same shape as the input (`page`, `lines`,
`text`, `bbox`, `fontSize`, `type: "body"`, `confidence: 0`, `column: undefined`) — this step runs
before classification, so split blocks are still just `type: "body"` until `classifyBlocks` runs.

| Concept | Notes |
|---|---|
| Block's own left margin | The minimum `line.bbox.x0` across the block's own lines — the baseline a later line's indentation is compared against (research.md §3). |
| Block's own typical line gap | The median vertical gap between consecutive lines in the block — the baseline a later line's spacing is compared against. |

## Extended: Block / Segment Type (`classifyBlocks`'s `type` field)

The existing `type` field (`"body" | "header" | "footer" | "page-number"`) gains three new values:

| Type | Notes |
|---|---|
| `"heading"` *(new)* | Font size exceeds `headingFontSizeThreshold` (FR-001); never assigned when that threshold is `undefined` (FR-002). Included in narration (FR-003) but retained as a distinct type so a future narration-rendering step can treat it differently (e.g. a longer pause) — this feature does not itself change audio treatment, per spec.md's Assumptions. |
| `"footnote"` *(new)* | Confined to the existing footer zone (`isConfinedToFooterZone`, from feature 001) AND font size below `footnoteFontSizeThreshold` (FR-008) — position alone is insufficient, per FR-012. |
| `"caption"` *(new)* | Adjacent to a page region with disproportionately little extracted text (a text-geometry proxy for image-adjacency, research.md §4) AND styling distinct from body text (FR-009). |
| `"table"` *(new)* | Part of a group of 3+ consecutive lines sharing a repeated, stable column-gap pattern (reusing `findStableColumnGap` from feature 001-clean-private-reading's column detection, research.md §4), per FR-010. |

No existing type's meaning changes; a block only receives one of the new types when its own new
corroborating evidence (never a single weak signal, per FR-012) supports it.

## Extended: `NARRATION_EXCLUDED_TYPES`

Existing set `{"header", "footer", "page-number"}` gains two new entries: `{"footnote",
"caption", "table"}` (FR-011). `"heading"` is deliberately NOT added — headings remain speakable
(FR-003), consistent with spec.md's Assumptions that heading narration treatment (pause, tone) is
a separate, later concern from classification itself.

## State Transitions

None. Every new value here is a pure function of the current document's already-extracted
geometry, computed fresh per `buildPipelineOutput` call and discarded afterward — identical in
lifecycle to the existing header/footer/page-number classification it extends.

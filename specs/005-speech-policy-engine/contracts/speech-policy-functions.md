# Contract: Speech Policy Functions (`pdf-reader/app.js`)

This project has no network API. Its contract surface is the set of pure/narrowly-scoped
functions exported from `app.js` via the `api` object and imported by `reader.test.js`. This
document specifies the new/changed functions for this feature. Field shapes referenced below are
defined in [data-model.md](../data-model.md).

## New: `DEFAULT_SPEECH_POLICY` (exported constant)

**Purpose**: The fixed default `SpeechPolicy` value (data-model.md), whose fields reproduce
`NARRATION_EXCLUDED_TYPES`'s old behavior exactly (FR-001, FR-002).

**Behavioral guarantees**:
- `shouldSpeak(type, DEFAULT_SPEECH_POLICY)` equals `!NARRATION_EXCLUDED_TYPES`'s old
  per-type result for every type the pipeline currently produces (`body`, `heading`, `header`,
  `footer`, `page-number`, `footnote`, `caption`, `table`).
- Exposes all ten fields from data-model.md's `SpeechPolicy` table, including the three inert
  fields (`speakTitles`, `speakCitations`, `speakReferences`) — present per FR-003's field
  requirement even though they have no observable effect yet (spec.md Edge Cases).

## New: `resolveSpeechPolicy(overrides)`

**Purpose**: Merge a caller-supplied partial policy over `DEFAULT_SPEECH_POLICY` (FR-006,
research.md Decision 3).

**Input**: `overrides` — a plain object with zero or more `SpeechPolicy` fields set;
`undefined`/omitted is valid and equivalent to `{}`.

**Output**: a complete `SpeechPolicy` object: every field from `overrides` that is present wins;
every field `overrides` does not set falls back to `DEFAULT_SPEECH_POLICY`'s value.

**Behavioral guarantees**:
- `resolveSpeechPolicy()` (no argument) and `resolveSpeechPolicy({})` both return a value
  deep-equal to `DEFAULT_SPEECH_POLICY`.
- `resolveSpeechPolicy({ speakFootnotes: true })` returns a policy equal to
  `DEFAULT_SPEECH_POLICY` in every field except `speakFootnotes`, which is `true`.
- Never mutates `DEFAULT_SPEECH_POLICY` or the `overrides` argument.

## New: `shouldSpeak(type, policy)`

**Purpose**: The single source of truth for whether a block of a given type should be spoken
under a given policy (FR-005, research.md Decision 2). Both `toAstBlock` and
`renderNarrationText` call this — no other function independently encodes this decision.

**Input**: `type` — a block type string (one of the types spec 004's schema produces, or any
other string). `policy` — a complete `SpeechPolicy` object (typically the result of
`resolveSpeechPolicy`).

**Output**: `boolean`.

**Behavioral guarantees**:
- Follows exactly the mapping in research.md Decision 2's table (each boolean field governs its
  corresponding type; `tables` governs `table` via the skip/non-skip distinction; `body` and any
  unrecognized type always return `true`, matching `NARRATION_EXCLUDED_TYPES`'s old implicit
  fallback for anything not in the set).
- Pure: given the same `type` and `policy`, always returns the same result; never mutates
  `policy`.

## Extended: `toAstBlock(block, readingOrder, policy)`

**Purpose**: Gains a `policy` parameter (data-model.md's `SpeechPolicy`), used to compute the
`speak` field via `shouldSpeak` instead of the direct `NARRATION_EXCLUDED_TYPES.has(...)` check.

**Behavioral guarantees**:
- `astBlock.speak === shouldSpeak(block.type, policy)` for every call.
- All other fields (`id`, `page`, `type`, `text`, `bbox`, `style`, `confidence`) are computed
  exactly as before this feature — unaffected by `policy`.

## Extended: `buildDocumentAst(orderedBlocksByPage, policy)`

**Purpose**: Gains an optional `policy` parameter, threaded to `toAstBlock` for every block via
`resolveSpeechPolicy` (so a caller may pass a partial override, or omit `policy` entirely for the
default).

**Behavioral guarantees**:
- Calling `buildDocumentAst(orderedBlocksByPage)` (no `policy` argument) produces identical
  output to before this feature, for any document already covered by the existing suite (FR-001,
  FR-008).
- Section grouping (spec 004) is unaffected by `policy` — grouping depends only on `type ===
  "heading"`, never on any policy field.

## Extended: `renderNarrationText(orderedBlocksByPage, policy)`

**Purpose**: Gains an optional `policy` parameter, used via `shouldSpeak` in place of the direct
`NARRATION_EXCLUDED_TYPES.has(...)` filter.

**Behavioral guarantees**:
- Calling `renderNarrationText(orderedBlocksByPage)` (no `policy` argument) produces identical
  output to before this feature, for any document already covered by the existing suite (FR-001,
  FR-008).
- For any explicit policy, the set of blocks included in the joined narration text is exactly the
  set of blocks for which `shouldSpeak(block.type, policy)` is `true` — the same predicate
  `buildDocumentAst` uses for the same blocks under the same policy (FR-005).

## Extended: `buildPipelineOutput(pagesOfItems, pageWidth, pageHeight, policy)`

**Purpose**: Gains an optional `policy` parameter (a partial or complete override, or omitted),
resolved once via `resolveSpeechPolicy` and passed as the same resolved value to both
`buildDocumentAst` and `renderNarrationText` — the structural fix for FR-005/FR-009's
single-source-of-truth requirement.

**Behavioral guarantees**:
- Calling `buildPipelineOutput(pagesOfItems, pageWidth, pageHeight)` (no `policy` argument)
  produces `displayText`/`narrationText`/`document` identical to before this feature, for any
  document already covered by the existing suite (FR-001, FR-008, SC-001).
- For any explicit `policy` override, the `document`'s per-block `speak` flags and
  `narrationText`'s block inclusion agree exactly — both were computed from the same resolved
  policy object (FR-005, FR-009, SC-003).

## Removed: `NARRATION_EXCLUDED_TYPES`

Deleted once both consumers migrate to `shouldSpeak` (research.md Decision 4) — fully superseded
by `DEFAULT_SPEECH_POLICY`'s field values; no other function references it.

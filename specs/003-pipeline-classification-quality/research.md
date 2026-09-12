# Phase 0 Research: Reading Pipeline Classification Quality

No items in Technical Context were marked `NEEDS CLARIFICATION` — this plan extends an existing,
already-implemented pipeline (`pdf-reader/app.js`, from feature 001-clean-private-reading) rather
than introducing new architecture. This document resolves the concrete design questions needed to
implement the three new classification behaviors (heading, paragraph boundary, footnote/
caption/table) correctly and minimally, using the existing block-reconstruction pipeline's own
established patterns.

## 1. Font-weight signal availability (FR-001, FR-003)

**Decision**: Use font-size contrast against the document's own body-text profile as the primary,
required heading signal. Font weight is an optional, best-effort secondary signal, added only if
it can be obtained cheaply from data already being read — never a hard requirement for heading
detection.

**Rationale**: Inspecting the vendored PDF.js 4.10.38 build directly confirms `getTextContent()`
text items expose only an internal `fontName` key (e.g. `g_d0_f1`), not the real font family or a
bold/italic flag. Weight/style flags (`bold`, `black`, `italic`) do exist on PDF.js's internal
font descriptor objects, reachable via `page.commonObjs.get(item.fontName)` — a separate,
per-unique-font async lookup not currently made anywhere in this pipeline. The reference
fixture's own heading distinction (Univers Condensed Bold ~12.5pt vs. Sabon Roman body ~10.5pt)
already differs by font size alone, without requiring weight — confirming size contrast alone is
a workable primary signal, consistent with FR-012's "do not classify on one weak signal without
corroboration" applying at the requirement level (size contrast + relative rarity within the
document, per §16.6 of this plan's evidence model) rather than requiring a second font-descriptor
lookup that adds real implementation and error-handling surface for uncertain benefit.

**Alternatives considered**:
- *Always fetch `commonObjs.get(fontName)` per item.* Rejected as a hard requirement — adds an
  async per-page-per-font lookup, and PDF.js's own font-loading path can throw or fall back for
  malformed embedded fonts (a case this project's Security Review already treats as untrusted
  input to degrade gracefully around, not extend). Left as an optional future enhancement, not
  part of this feature's required path, per Constitution Principle V (don't build for
  hypothetical requirements the current fixture data doesn't demand).
- *Parse font names for substrings like "Bold"/"Black".* Rejected — PDF.js's `fontName` here is
  an internal alias, not the embedded font's real PostScript name in the general case; this would
  work by coincidence on some PDFs and silently do nothing on most others, which is worse than
  not attempting it (a false sense of coverage).

## 2. Reusing the existing body-text profile (FR-001, FR-002)

**Decision**: Extend `analyzeDocumentStats` (already computes `medianBodyFontSize` from all
blocks) to also compute the distribution's spread (e.g. blocks at least N points above the
median, where N is tuned against the existing test fixtures), and have `classifyBlocks` compare
each block's `fontSize` against that spread rather than any fixed constant — mirroring exactly how
`isConfidentHeaderFooterCandidate` already compares a candidate's repetition rate against
`HEADER_FOOTER_MIN_REPETITION_RATE`, a document-relative rather than absolute test.

**Rationale**: `medianBodyFontSize` already exists in `analyzeDocumentStats` today but is
currently computed and unused by any classification rule — this is the natural, already-tested
entry point for a document-relative comparison, avoiding a new document-scanning pass.

**Alternatives considered**:
- *A new, separate profiling pass just for headings.* Rejected — `analyzeDocumentStats` already
  runs once per document and is the established location for document-relative statistics; adding
  a second pass duplicates the block iteration for no benefit.

## 3. Paragraph-boundary detection scope (FR-004–FR-007)

**Decision**: Detect paragraph boundaries as a new step operating on an already-reconstructed
block's own `lines` array (confirmed present on every block from `buildBlock`), inserted between
`reconstructBlocks` and `classifyBlocks` in the pipeline. A boundary is introduced at a line when
either (a) that line's `bbox.x0` is indented beyond the block's own established left margin (the
minimum `x0` across the block's other lines) by more than a tuned threshold, or (b) the vertical
gap between that line and the previous one exceeds the block's own typical inter-line gap by more
than a tuned multiplier — both compared against the block's own values, never a fixed constant,
consistent with FR-007's "uniform pattern is not a signal" requirement.

**Rationale**: Blocks are already grouped by `linesBelongToSameBlock` using left-alignment +
font-size + spacing similarity — a multi-paragraph passage with consistent left-alignment except
for first-line indents already survives as ONE block today (indentation differences are usually
too small to break `linesBelongToSameBlock`'s 0.02 left-alignment tolerance across a full block,
but the boundary signal still needs its own, independent check within the block, since
`linesBelongToSameBlock` was never designed to detect intra-block paragraph starts). Operating
within an existing block, rather than changing block reconstruction itself, keeps this an
additive, low-risk change per Constitution Principle V.

**Alternatives considered**:
- *Lower `linesBelongToSameBlock`'s alignment tolerance so indented lines become new blocks.*
  Rejected — this would also incorrectly split blocks at benign, non-paragraph indentation (e.g. a
  hanging indent used consistently throughout one paragraph), which is exactly FR-007's edge case.
  A dedicated post-processing pass with the block's own established pattern as its baseline (not
  block-formation itself) is more precise and easier to reason about independently.

## 4. Footnote/caption/table evidence sources (FR-008–FR-012)

**Decision**: Extend the existing document-stats profiling (`analyzeDocumentStats`) and
zone-based candidate collection pattern (`collectEdgeCandidates`, `isConfinedToFooterZone`) to
also flag footnote candidates (confined to the existing footer-adjacent zone, but with a font size
below the body-text median — not merely position alone, addressing FR-012's corroboration
requirement) and caption candidates (adjacent to a page region with disproportionately little
extracted text — a proxy for "next to an image," since this pipeline does not decode image
content, only text-item geometry). Table detection reuses the existing column-detection machinery
(`findStableColumnGap`, already built for the two-column reading-order feature) applied within a
localized block group rather than the whole page, looking for a *repeated* stable gap pattern
across 3+ consecutive lines as the corroborating "grid" signal FR-010 requires.

**Rationale**: This maximizes reuse of already-implemented, already-tested geometry primitives
(`isConfinedToFooterZone`, `findStableColumnGap`) rather than introducing new detection
mechanisms, consistent with how header/footer detection itself was built. Caption detection is
necessarily approximate since this pipeline extracts text geometry only, never renders or
inspects image content directly — the plan explicitly scopes caption detection to this
text-geometry-only proxy signal, not true image-adjacency detection, and documents this
limitation rather than pretending a stronger guarantee exists.

**Alternatives considered**:
- *Detect captions via actual image regions from PDF.js's `OPS`/operator list.* Rejected — this
  pipeline does not currently render pages or inspect the operator list at all (`extractPdfText`
  only calls `getTextContent()`), and adding that is a substantially larger change than this
  feature's scope; the text-geometry proxy is the smallest change consistent with the existing
  architecture, revisited only if the text-geometry proxy's SC-005 measurement proves inadequate
  in practice.
- *A generic ML/statistical table detector.* Rejected outright — far exceeds Constitution
  Principle V's simplicity bar and this pipeline's existing "flat set of geometry heuristics"
  style; the existing column-gap-detection code already solves the core "are these lines aligned
  into a grid" problem this needs.

## 5. Reproducibility under new classification (FR-013)

**Decision**: No new decision needed — every new classification step operates as a pure function
of already-extracted, already-normalized geometry (bbox, fontSize) and document-relative
statistics computed once per call, exactly like the existing header/footer/page-number
classification. The existing reproducibility test pattern from spec 002
(`buildPipelineOutput` determinism) already covers this by construction, since these new
functions plug into the same call chain with no new randomness or external state.

**Rationale**: Confirmed by direct inspection — `classifyBlocks`, `analyzeDocumentStats`, and
every function in this pipeline are synchronous, side-effect-free transformations of their inputs;
adding new pure functions to the same chain does not introduce non-determinism.

## Summary

This plan adds new pure functions to the existing pipeline chain (`reconstructBlocks` →
[NEW: paragraph-boundary split] → `analyzeDocumentStats` → [EXTENDED: heading/footnote/caption/
table evidence] → `classifyBlocks` → [EXTENDED: heading/footnote/caption/table classification] →
`detectColumns` → [EXTENDED: table detection may reuse or run alongside] → `resolveReadingOrder`
→ `renderNarrationText` → [EXTENDED: exclude new non-speakable types, mark heading boundaries]),
reusing existing document-relative comparison patterns, existing geometry primitives, and the
existing pure-function architecture throughout. No new dependency, no new worker, no new storage,
no new network path.

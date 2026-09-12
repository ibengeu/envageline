# Feature Specification: Speech Policy Engine

**Feature Branch**: `005-speech-policy-engine`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: second subsystem of a multi-spec effort to evolve the existing Smart
PDF Reading pipeline (`pdf-reader/app.js`, from specs 001-004) toward the "PDF → structured
spoken-document representation" architecture described in a full system design document (Mobile
PDF-to-Speech Reader). This spec covers only the Speech Policy Engine: replace the pipeline's one
hardcoded exclusion set (`NARRATION_EXCLUDED_TYPES`, currently consumed independently by both
`renderNarrationText`'s filter and spec 004's `buildDocumentAst`'s per-block `speak` derivation)
with a single, explicit, configurable policy object that both consumers read from, so the
what's-spoken decision exists in exactly one place instead of two parallel hardcoded copies. No
new block detection or classification heuristics, no new UI controls, no text normalization, no
chunking changes, no network calls — this is a decision-making layer over classification output
that already exists (spec 003), not a new classifier.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nothing changes for a listener today (Priority: P1)

A listener who was already using the reader before this change opens the same documents and hears
exactly the same narration as before: the same content included, the same content excluded, in
the same order.

**Why this priority**: Like spec 004, this is a foundation-laying refactor. If the default policy
produces even one different word of narration for an existing document, the refactor has broken
the exact thing it was supposed to make more maintainable.

**Independent Test**: Run the full existing test suite after the change and confirm all
previously-passing behavioral tests still pass unchanged, plus confirm the exact
`displayText`/`narrationText` regression baseline from spec 004 still holds byte-for-byte.

**Acceptance Scenarios**:

1. **Given** a document that previously produced specific narration under specs 001-004, **When**
   the same document is processed after this refactor with no policy customization, **Then** the
   produced narration is identical.
2. **Given** the pipeline's two current consumers of the exclusion decision (narration filtering,
   per-block `speak` flag), **When** the policy engine is introduced, **Then** both consumers
   produce the same inclusion/exclusion result for every block as they did before, for every
   block type the pipeline already produces.

---

### User Story 2 - One decision, not two copies of it (Priority: P1)

A developer changing what gets spoken (e.g. to support a future "read footnotes" toggle) can make
that change in exactly one place and have it apply consistently everywhere the pipeline decides
whether to speak a block — not discover, after shipping, that narration text and the per-block
`speak` flag now disagree because only one of two hardcoded copies was updated.

**Why this priority**: This is the actual maintenance defect this spec exists to close. Ranked
alongside User Story 1 as P1 because an engine that still leaves two independently-maintained
decision points defeats the purpose of building it at all.

**Independent Test**: Change the policy's setting for one block type (in a test, not a shipped
UI) and confirm both the narration output and the per-block `speak` flag reflect the new setting
consistently, without editing more than one place in the policy configuration.

**Acceptance Scenarios**:

1. **Given** a policy configured to include a type that is excluded by default (e.g. footnotes),
   **When** a document containing that type is processed, **Then** both the narration text
   includes that block's content and the block's `speak` flag is `true`.
2. **Given** a policy configured to exclude a type that is included by default, **When** a
   document containing that type is processed, **Then** both the narration text excludes that
   block's content and the block's `speak` flag is `false`.
3. **Given** no policy is explicitly provided, **When** a document is processed, **Then** the
   pipeline uses a default policy whose settings reproduce today's `NARRATION_EXCLUDED_TYPES`
   behavior exactly.

---

### User Story 3 - The policy's shape matches the settings a reader will eventually expose (Priority: P2)

A developer building a future reading-mode setting (Natural / Academic / Accessible, per the
product's documented reading modes) can express each mode as one policy object with named,
self-describing fields — `speakFootnotes`, `speakCitations`, `tables`, and so on — rather than
inventing a new ad hoc configuration shape for each mode.

**Why this priority**: Useful for future reader-settings work, but nothing in User Story 1 or 2
requires the policy's field names or structure to match any particular future UI — the
non-regression and single-source-of-truth guarantees hold regardless of naming. Ranked P2 because
it's a design-quality property for future consumers, not a behavior any current user story
depends on.

**Independent Test**: Inspect the default policy object and confirm it exposes one named,
independently-settable field for each block type the pipeline currently classifies, using the
field names and value shapes already documented for this product's speech policy concept.

**Acceptance Scenarios**:

1. **Given** the default policy object, **When** it is inspected, **Then** it exposes a distinct
   boolean field for each of: titles, headings, page numbers, headers, footers, footnotes,
   captions (the block types spec 004's schema currently distinguishes with a clear speak/don't
   default).
2. **Given** the default policy object, **When** it is inspected, **Then** its table-handling
   field takes one of the three named modes (skip, summary, detailed) rather than a boolean,
   matching how the product's documented policy shape treats tables differently from simple
   include/exclude types.

### Edge Cases

- What happens when a policy is given a value for a field the current pipeline has no
  corresponding block type for (e.g. `speakCitations`, since this pipeline does not yet produce a
  distinct `citation` block type — citations are inline markers stripped by
  `stripCitationsAndUrls`, not a block type)? The field is accepted and stored on the policy
  object for forward compatibility with later specs, but has no observable effect on this
  spec's output, since no current block type maps to it. This must not be treated as an error.
- What happens when a policy omits a field entirely? The missing field falls back to the default
  policy's value for that field, rather than being treated as `false`/`undefined` or causing an
  error — a partial policy override must be safe to pass.
- What happens when `tables` is set to a mode this spec doesn't yet implement narration behavior
  for (`"detailed"`)? The setting is accepted and stored; behavior beyond the existing
  skip/include distinction (this pipeline currently only ever fully excludes or fully includes a
  table block's text, it does not summarize) is out of scope for this spec and deferred, tracked
  as a known gap rather than silently ignored or erroring.
- What happens when the two current consumers (narration renderer, per-block speak-flag deriver)
  are called with different policy objects in error (e.g. a future caller passes one policy to
  one and forgets the other)? Not a defect this spec needs to prevent programmatically — this
  spec's contribution is that a *single* policy object, once passed to both, produces consistent
  results; enforcing that callers always pass the same object is a caller-discipline concern, not
  a new runtime guard, per Constitution Principle V (no defensive code for a scenario the
  pipeline's own single call site does not create).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The pipeline MUST expose a default speech policy object whose settings, when
  applied, produce narration output identical to the current `NARRATION_EXCLUDED_TYPES`-based
  behavior for every block type the pipeline currently classifies.
- **FR-002**: The default policy MUST NOT speak blocks of type header, footer, page-number,
  footnote, caption, or table, and MUST speak blocks of type heading and body — matching today's
  `NARRATION_EXCLUDED_TYPES` set exactly.
- **FR-003**: The policy object MUST expose independently-settable fields for each block type the
  pipeline distinguishes with a boolean speak/don't-speak default: titles, headings, page
  numbers, headers, footers, footnotes, captions.
- **FR-004**: The policy object MUST expose a `tables` field accepting one of three named modes
  (`"skip"`, `"summary"`, `"detailed"`), defaulting to a mode that reproduces today's full-exclusion
  behavior for table blocks.
- **FR-005**: The narration-rendering path and the per-block `speak`-flag derivation path MUST
  both derive their inclusion/exclusion decision from the same policy object, rather than each
  independently encoding the decision — a single change to one policy field MUST be reflected
  consistently in both outputs.
- **FR-006**: The pipeline MUST accept a caller-supplied policy that overrides only some fields,
  falling back to the default policy's value for any field the caller's policy omits.
- **FR-007**: The pipeline MUST NOT introduce any new block-type detection or classification
  logic; the policy engine operates only on block types spec 004's schema already produces.
- **FR-008**: The pipeline MUST NOT change `displayText` or reading order for any document
  already covered by the existing test suite; this spec affects only which classified content is
  spoken, not how content is extracted, classified, or ordered.
- **FR-009**: Given a policy that changes one field's setting relative to the default, the
  pipeline MUST reflect that change in both the narration text and every affected block's `speak`
  flag for a document exercising that block type.
- **FR-010**: The reader's playback, highlighting, and navigation features (as already
  implemented in specs 001-004) MUST continue to function without requiring changes to
  `index.html`, `styles.css`, or any user-facing control — no settings UI is introduced by this
  spec.

### Key Entities *(include if feature involves data)*

- **SpeechPolicy**: A plain configuration object describing which classified content should be
  spoken. Has one boolean field per simple include/exclude block type (titles, headings, page
  numbers, headers, footers, footnotes, captions) and one named-mode field for tables. Forward-
  compatible fields for concepts this pipeline does not yet produce as distinct block types
  (citations, references) may be present but have no effect until a later spec introduces the
  corresponding block type or detection.
- **Default Policy**: The specific `SpeechPolicy` value the pipeline uses when no override is
  supplied; its values are fixed by FR-001/FR-002 to reproduce today's behavior exactly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the existing behavioral test suite (122 tests as of spec 004) continues to
  pass unmodified after this refactor, with no pre-existing test needing rewriting to tolerate a
  behavior change.
- **SC-002**: For a document exercising every block type the pipeline currently produces, the
  default policy's narration output and per-block `speak` flags are identical to the pre-005
  baseline for 100% of blocks.
- **SC-003**: Changing one field on a policy object changes the corresponding block type's
  inclusion in both the narration text and the per-block `speak` flag consistently, verified for
  at least one boolean field and the `tables` field.
- **SC-004**: A policy object with only one field overridden produces the same result, for every
  field it did not override, as the default policy — verified across all seven boolean fields and
  the `tables` field independently.

## Assumptions

- "Titles" (a distinct field per the goal document's policy shape) maps to the pipeline's existing
  `heading` block type for now, since spec 004's schema does not yet distinguish a document title
  from a section heading; `speakTitles` and `speakHeadings` may therefore have overlapping effect
  until a future spec introduces a distinct `title` block type. This is a forward-compatible field
  presence, not a behavior claim beyond what block types currently exist.
- `speakCitations`, `speakReferences`, and non-`skip` table modes are included in the policy
  shape for forward compatibility with the goal document's full policy interface, but are inert
  in this spec per the Edge Cases above — no current block type or text-level marker maps to
  them yet (citation markers are handled by existing inline text stripping, not a block-level
  policy decision).
- No persistence or user-facing settings surface for the policy is introduced; the policy is a
  pipeline-internal parameter with a fixed default for this spec, matching the "no new UI
  controls" scope boundary.
- This spec does not change which functions are exported or how `buildPipelineOutput` is called
  by existing consumers with no explicit policy argument — the default-policy behavior applies
  automatically when no policy is supplied, preserving every existing call site.

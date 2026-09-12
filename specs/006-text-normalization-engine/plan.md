# Implementation Plan: Text Normalization Engine

**Branch**: `006-text-normalization-engine` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-text-normalization-engine/spec.md`

## Summary

Insert a deterministic normalization step into `renderNarrationText` (`app.js:685`), between the
existing `stripCitationsAndUrls` call and the function's return value. Today `narrationText` (the
string `renderNarrationText` returns) is already the pipeline's TTS-bound spoken-text form,
distinct from `displayText` — this spec does not need to introduce a new parallel text field; it
extends the existing spoken-text pipeline stage. The new step runs a detect-then-convert pass
(FR-012) over the joined, citation/URL-stripped text: an entity scanner identifies
currency/year/percentage/decimal/ordinal/code-phone/cardinal spans in priority order (most
specific category wins so a currency amount is never subsequently re-matched as a bare cardinal),
then each matched span is replaced with its spoken-word form via dedicated converter functions.
Text with no matching span passes through unchanged (FR-017).

## Technical Context

**Language/Version**: JavaScript (Node.js `--test` runner; browser-executed via `<script>`, no
build step) — same as specs 001-005.

**Primary Dependencies**: None new. Pure string/regex processing, no number-formatting library
(Intl.NumberFormat produces digit groups, not spoken words, so it doesn't help here — spoken-word
conversion is written directly).

**Storage**: N/A.

**Testing**: `node --test reader.test.js`.

**Target Platform**: Browser (client-side, offline-first), per constitution Principle I.

**Project Type**: Single-page web application, single source file (`pdf-reader/app.js`) plus its
co-located test file — same structure as specs 001-005.

**Performance Goals**: No new performance target; normalization runs once per document load over
already-small narration text (not per-chunk, not per-keystroke) — negligible relative to PDF
parsing.

**Constraints**: Must not change `displayText`, block classification, reading order, or the
speech-policy decision for any document already covered by the existing suite (FR-017, SC-002).
Must not touch `index.html`/`styles.css`/reader controls. Must not use a generative/LLM approach
(FR-015) — every conversion is a deterministic function over a regex-matched span.

**Scale/Scope**: One file (`pdf-reader/app.js`). Adds roughly: one entity-detection function, one
converter function per category (cardinal, year, currency, percentage, decimal, ordinal,
code/phone), and one orchestrating `normalizeSpokenText(text)` function wired into
`renderNarrationText`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Local-First Privacy)**: PASS / N/A-clean. Pure in-memory string transformation;
  no new storage, no new network path.
- **Principle II (Narrow Product Surface)**: PASS. Directly serves the product's core stated job
  ("turn a document into a good listening experience") — this is the single highest-value gap
  identified against the full goal architecture, not a scope expansion.
- **Principle III (Behavior-Driven TDD, NON-NEGOTIABLE)**: PASS, with a scale note. This feature
  has the largest number of independently-testable behaviors of any spec so far (7 categories ×
  multiple examples each, per spec.md's own SC-003 table). Each category gets its own small TDD
  cycle (failing test → minimal converter → refactor), consistent with the "target 20-100+ cycles
  per feature" guidance for larger features. Every test asserts on `normalizeSpokenText`'s (or
  `renderNarrationText`'s) input/output text — its public observable contract — never on internal
  regex patterns, category-detection call order, or private helper names.
- **Principle IV (Security Review as a Gate)**: N/A, justified. No new parsing input path, no
  network request, no storage, no third-party code. The only "input" is text already extracted
  and classified by the existing, already-reviewed pipeline. The one risk worth naming explicitly:
  user-controlled PDF text now drives regex matching for the first time in a way that could, in
  principle, be crafted adversarially — addressed below.
- **Principle V (Simplicity & Cyclomatic Discipline)**: PASS, with an explicit design commitment.
  Because this feature has 7 categories that must not conflict (FR-012's detect-then-convert
  staging exists specifically to keep this simple), the orchestrating function MUST stay a linear
  "try each detector in priority order, take the first match" dispatcher rather than one giant
  branching function — each category's own conversion logic lives in its own small function. This
  is the concrete mechanism by which Principle V's complexity ceiling is kept achievable across a
  feature with this much branching potential.

**Initial gate result**: PASS. No violations requiring Complexity Tracking entries.

**Post-design re-check** (after Phase 1 data-model.md/contracts/quickstart.md): PASS, unchanged.
The finalized design is exactly the priority-ordered dispatcher plus one small function per
category committed to at the initial gate — no additional file, module, storage, or network
surface emerged during design. The ReDoS mitigation (Security Review) is now a concrete,
testable commitment (research.md Decision 4: no nested unbounded quantifiers in any pattern),
not just a stated intention. Each converter function is independently small and single-purpose,
keeping Principle V's complexity ceiling achievable per-function even though the feature's total
surface (7 categories) is the largest of the 004-006 sequence so far.

## Security Review

*(Constitution Principle IV — included per mandatory-section rule.)*

- **Applicable OWASP Top 10:2025 risks**: 
  - A08:2025 (Mishandling of Exceptional Conditions) — **addressed, not N/A**. This is the one
    real new consideration this spec introduces: normalization runs regex matching over arbitrary
    PDF-extracted text, which is untrusted input (constitution Principle IV: "extracted document
    content is untrusted input"). A pathological input (e.g. a very long run of digits or
    repeated separator characters engineered to trigger catastrophic regex backtracking) must not
    hang or crash the reader.
  - All other categories (Injection, Auth, SSRF, Supply Chain, etc.): N/A — no new parsing
    entry point, network request, storage write, or third-party dependency.
- **Mitigations**: Every regex used for entity detection MUST be written to avoid nested
  quantifiers over unbounded input (no `(\d+\s*)+`-style patterns) — each pattern matches a
  bounded, linear-scan shape (fixed separator classes, no ambiguous repetition). This MUST be
  verified with a test asserting normalization completes quickly on a large adversarial input
  (e.g. a long digit run or repeated symbol sequence), per Principle IV's "malformed or hostile
  input fails cleanly" requirement extended to this new text-processing surface.
- **Key behavior-driven security tests planned via TDD**: A test confirming normalization
  terminates promptly (no catastrophic-backtracking hang) on a deliberately adversarial long
  numeric/symbol input, and a test confirming a malformed or unrecognized numeric-looking span is
  left unmodified rather than throwing (FR-013's "leave unmodified" requirement doubles as an
  exceptional-condition guarantee).

## Project Structure

### Documentation (this feature)

```text
specs/006-text-normalization-engine/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
pdf-reader/
├── app.js               # Single source file (specs 001-005). This feature adds:
│                         #   - detectNumericEntities(text) (new) — FR-012's detection stage:
│                         #     scans text for currency/year/percent/decimal/ordinal/code-phone/
│                         #     cardinal spans, in priority order, returning non-overlapping
│                         #     matches each tagged with a category
│                         #   - convertCardinal(digits), convertYear(digits),
│                         #     convertCurrency(match), convertPercentage(match),
│                         #     convertDecimal(match), convertOrdinal(match),
│                         #     convertCodeDigits(digits) (new) — one small pure function per
│                         #     category (FR-003, FR-005, FR-006/007/008, FR-009, FR-010, FR-011,
│                         #     FR-004)
│                         #   - normalizeSpokenText(text) (new) — orchestrates detection +
│                         #     conversion, leaving unmatched/unclassifiable spans untouched
│                         #     (FR-013)
│                         #   - renderNarrationText extended to call normalizeSpokenText after
│                         #     stripCitationsAndUrls, before returning (FR-001, FR-016)
├── reader.test.js        # Same file; new tests appended, existing tests untouched
├── index.html            # NOT modified (explicit scope boundary)
└── styles.css            # NOT modified (explicit scope boundary)
```

**Structure Decision**: Single-file project, matching specs 001-005 — no new project, module, or
build step, and no new number-formatting dependency (Principle V: a hand-written spoken-word
converter for the bounded set of categories this spec needs is simpler than integrating and
constraining a general-purpose i18n number-to-words library, and keeps the conversion fully
auditable/deterministic per FR-015). All new logic lives in `pdf-reader/app.js`; all new tests
live in `pdf-reader/reader.test.js`.

## Complexity Tracking

*No violations — this section is intentionally empty. The detect-then-convert staging (FR-012)
and one-function-per-category structure are the explicit design commitments that keep this
larger feature's complexity bounded (see Constitution Check, Principle V).*

# Implementation Plan: Speech Policy Engine

**Branch**: `005-speech-policy-engine` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-speech-policy-engine/spec.md`

## Summary

Replace the pipeline's single hardcoded `NARRATION_EXCLUDED_TYPES` set — currently duplicated
across two independent consumers, `toAstBlock`'s `speak` derivation (`app.js:581`) and
`renderNarrationText`'s filter (`app.js:651`) — with one explicit `SpeechPolicy` object and a
single `shouldSpeak(type, policy)` function both consumers call. Introduce a default policy whose
field values reproduce `NARRATION_EXCLUDED_TYPES` exactly, so behavior for every document already
covered by the test suite is unchanged (FR-001, FR-002). Thread an optional `policy` parameter
through `buildDocumentAst` and `renderNarrationText` (defaulting to the default policy when
omitted), and through `buildPipelineOutput` so a caller can override it in one place and have both
outputs agree (FR-005, FR-006, FR-009) — closing the two-copies drift risk the current code has.

## Technical Context

**Language/Version**: JavaScript (Node.js `--test` runner; browser-executed via `<script>`, no
build step) — same as specs 001-004.

**Primary Dependencies**: None new.

**Storage**: N/A — the policy is an in-memory parameter with a fixed default; no persistence
introduced (explicitly out of scope per spec.md Assumptions — a future reader-settings spec would
add persistence).

**Testing**: `node --test reader.test.js`.

**Target Platform**: Browser (client-side, offline-first), per constitution Principle I.

**Project Type**: Single-page web application, single source file (`pdf-reader/app.js`) plus its
co-located test file — same structure as specs 001-004.

**Performance Goals**: No new performance target; this is a lookup-table read replacing a
set-membership check, not new computation.

**Constraints**: Must not change `displayText`, reading order, or block classification for any
document already covered by the existing test suite (FR-008). Must not touch
`index.html`/`styles.css`/reader controls (explicit scope boundary, consistent with spec 004).

**Scale/Scope**: One file (`pdf-reader/app.js`); replaces one constant and two consumer call
sites with one policy object, one lookup function, and two threaded parameters.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Local-First Privacy)**: PASS / N/A-clean. No new storage, no new network path.
- **Principle II (Narrow Product Surface)**: PASS. This is infrastructure enabling spec 006
  (Text Normalization) and future reader settings; it does not expand what the product does today
  (no new UI, no new user-visible toggle — FR-010).
- **Principle III (Behavior-Driven TDD, NON-NEGOTIABLE)**: PASS. FR-001/FR-002/FR-008 (no
  behavior change under the default policy) are proven by the existing suite continuing to pass
  unmodified. The new observable behaviors (FR-003/FR-004 field shape, FR-005/FR-009 single-
  source-of-truth consistency, FR-006 partial-override fallback) each get one new failing test
  before minimal implementation. Tests assert on `buildPipelineOutput`'s/`buildDocumentAst`'s
  return values and the exported default policy's shape — its public contract — never on
  `shouldSpeak`'s internal branching or call sequence.
- **Principle IV (Security Review as a Gate)**: N/A, justified. No new parsing input path, no
  network request, no storage, no third-party code — this reshapes an in-memory decision already
  made by existing, already-reviewed classification output.
- **Principle V (Simplicity & Cyclomatic Discipline)**: PASS. `shouldSpeak` is a single lookup
  (policy field access keyed by type, or a small switch/map) with low branching. No configuration
  persistence, validation framework, or schema-versioning is introduced beyond the fields FR-003/
  FR-004 require — inert forward-compatible fields (`speakCitations`, `speakReferences`, non-skip
  table modes) are stored but deliberately not wired to any behavior yet, avoiding speculative
  branching for effects that don't exist (YAGNI).

**Initial gate result**: PASS. No violations requiring Complexity Tracking entries.

**Post-design re-check** (after Phase 1 data-model.md/contracts/quickstart.md): PASS, unchanged.
The finalized design adds one constant (`DEFAULT_SPEECH_POLICY`), two small pure functions
(`resolveSpeechPolicy`, `shouldSpeak`), and threads one optional parameter through three existing
functions (`toAstBlock`, `buildDocumentAst`, `renderNarrationText`, `buildPipelineOutput`) — no
new file, storage, network path, or configuration-persistence surface emerged during design.
`shouldSpeak` is a single switch/lookup with one branch per block type, well under Principle V's
complexity ceiling.

## Security Review

*(Constitution Principle IV — included per mandatory-section rule; N/A justification per gate
above.)*

- **Applicable OWASP Top 10:2025 risks**: N/A. No new input path, network request, storage write,
  or third-party dependency. The policy object is an internal parameter with a fixed default;
  it is not sourced from document content, user input, or any external source in this spec.
- **Mitigations**: N/A — no new surface to mitigate.
- **Key behavior-driven security tests planned via TDD**: None required. Existing security-
  relevant tests (loopback TTS validation, zip-bomb bounds, literal-text rendering) are untouched
  by this spec's scope and are covered by SC-001 (full existing suite passes unmodified).

## Project Structure

### Documentation (this feature)

```text
specs/005-speech-policy-engine/
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
├── app.js               # Single source file (specs 001-004). This feature:
│                         #   - Adds DEFAULT_SPEECH_POLICY (const) and
│                         #     resolveSpeechPolicy(overrides) (new)
│                         #   - Adds shouldSpeak(type, policy) (new) — single source of truth,
│                         #     replacing both direct NARRATION_EXCLUDED_TYPES.has(...) call sites
│                         #   - Extends toAstBlock/buildDocumentAst to accept a `policy` parameter
│                         #     (defaults applied via resolveSpeechPolicy)
│                         #   - Extends renderNarrationText to accept a `policy` parameter (same
│                         #     default)
│                         #   - Extends buildPipelineOutput to accept an optional `policy`
│                         #     parameter and pass the same resolved policy to both consumers
│                         #   - Removes the now-unused NARRATION_EXCLUDED_TYPES constant (dead
│                         #     code once both call sites are migrated — Principle V)
├── reader.test.js        # Same file; new tests appended, existing tests untouched
├── index.html            # NOT modified (explicit scope boundary)
└── styles.css            # NOT modified (explicit scope boundary)
```

**Structure Decision**: Single-file project, matching specs 001-004 — no new project, module, or
build step. All new logic lives in `pdf-reader/app.js`; all new tests live in
`pdf-reader/reader.test.js`. This is a decision-consolidation refactor over two existing call
sites, not new architecture — no new file warranted per Principle V.

## Complexity Tracking

*No violations — this section is intentionally empty.*

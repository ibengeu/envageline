# Implementation Plan: Speech-Aware Chunking

**Branch**: `007-speech-aware-chunking` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-speech-aware-chunking/spec.md`

## Summary

Replace `splitIntoSpeechChunks`'s single-pass sentence regex (`app.js:1007`) with a priority-tiered
boundary scanner that finds candidate split points (paragraph `\n\n`, sentence-ending punctuation,
clause-ending comma/semicolon, plain punctuation), rejects any candidate that falls inside a
protected span (abbreviation-plus-word, decimal, currency phrase, ordinal, spoken year), and
greedily accumulates text between accepted boundaries up to `maxLength`, always preferring the
highest-priority boundary type available within that bound (FR-001). Confirmed during
specification: `normalizePdfText` already rejoins paragraphs with `\n\n`, but the current sentence
regex ignores that structure entirely — paragraph boundaries are not currently a distinct,
respected split point, which this spec's FR-001 priority order corrects as a side effect of the
redesign, not a separately scoped fix. `splitLongText`'s word-wrap fallback (`app.js:973`) is
reused only as the last-resort path (FR-008) when no boundary satisfies both length and
protection constraints — its own wrapping logic is otherwise unchanged (plan explicitly preserves
it per spec.md Assumptions).

## Technical Context

**Language/Version**: JavaScript (Node.js `--test` runner; browser-executed via `<script>`, no
build step) — same as specs 001-006.

**Primary Dependencies**: None new. Pure string/regex processing, reusing spec 006's number-word
vocabulary conceptually (not its code) to recognize already-normalized spoken phrases in plain
text.

**Storage**: N/A.

**Testing**: `node --test reader.test.js`.

**Target Platform**: Browser (client-side, offline-first), per constitution Principle I.

**Project Type**: Single-page web application, single source file (`pdf-reader/app.js`) plus its
co-located test file — same structure as specs 001-006.

**Performance Goals**: No new performance target; chunking runs once per document load over
already-small narration text, same call frequency as today.

**Constraints**: Must not change chunking output for any document already covered by the existing
suite that contains no protected-span pattern (FR-009, SC-003) — this is a precision fix, not a
strategy redesign. Must not touch `index.html`/`styles.css`/reader controls. Must not change
specs 004-006's classification/policy/normalization logic (FR-010).

**Scale/Scope**: One file (`pdf-reader/app.js`). Adds: a fixed abbreviation list, a small set of
protected-span detector regexes (decimal, currency-phrase, ordinal, spoken-year, abbreviation
pair), a boundary-candidate scanner, and a rewritten `splitIntoSpeechChunks` orchestrating them.
`splitLongText` is reused as-is for the last-resort fallback.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Local-First Privacy)**: PASS / N/A-clean. No new storage, no new network path.
- **Principle II (Narrow Product Surface)**: PASS. Directly fixes two confirmed, reproduced
  defects in existing core narration behavior — not a scope expansion.
- **Principle III (Behavior-Driven TDD, NON-NEGOTIABLE)**: PASS. FR-009/SC-003's non-regression
  requirement is proven by the existing suite continuing to pass unmodified, plus a dedicated
  identical-output test for a protected-pattern-free passage. Every new protected-span category
  and boundary-priority behavior gets its own small failing test before minimal implementation,
  consistent with specs 004-006's practice. Tests assert on `splitIntoSpeechChunks`'s return
  value (its public contract) — never on internal boundary-candidate data structures or
  detector-call order.
- **Principle IV (Security Review as a Gate)**: Addressed, not N/A — see Security Review below.
  Same class of concern as spec 006 (untrusted PDF-derived text now drives more regex matching).
- **Principle V (Simplicity & Cyclomatic Discipline)**: PASS, with an explicit design commitment.
  The four-tier priority order (FR-001) and the "one detector function per protected-span
  category" structure (mirroring spec 006's per-category converter pattern) are the concrete
  mechanisms keeping this achievable — a single function scanning for all boundary types and all
  protection rules at once would risk exceeding the complexity ceiling; splitting concerns across
  small functions (as spec 006 did for normalization) is the design used here too.

**Initial gate result**: PASS. No violations requiring Complexity Tracking entries.

**Post-design re-check** (after Phase 1 data-model.md/contracts/quickstart.md): PASS, unchanged.
The finalized design is exactly the priority-tiered candidate scan plus five small protected-span
detectors committed to at the initial gate, with the last-resort fallback delegating to existing,
already-proven-terminating code (`splitLongText`) rather than new bounded-search logic — no
additional file, module, storage, or network surface emerged during design. The ReDoS mitigation
mirrors spec 006's precedent directly (bounded, non-nested regex quantifiers throughout).

## Security Review

*(Constitution Principle IV — included per mandatory-section rule.)*

- **Applicable OWASP Top 10:2025 risks**:
  - A08:2025 (Mishandling of Exceptional Conditions) — addressed, not N/A, same reasoning as
    spec 006: chunking runs regex matching over untrusted PDF-derived narration text. A
    pathological input (a very long run of digits, or repeated punctuation) must not hang via
    catastrophic backtracking, and FR-008's last-resort fallback must be a genuine, terminating
    escape hatch — not a path that can itself loop indefinitely when a protected span is
    unsplittable within `maxLength`.
  - All other categories: N/A — no new parsing entry point, network request, storage write, or
    third-party dependency.
- **Mitigations**: Every new regex (abbreviation-pair detection, decimal/currency/ordinal/year
  phrase detection) follows spec 006's research.md Decision 4 precedent: bounded, non-nested
  quantifiers only. The last-resort fallback (FR-008) MUST have a hard termination guarantee
  independent of input shape — implemented by bounding it to `splitLongText`'s existing,
  already-terminating word-wrap logic, never a new unbounded search for "the least-bad split
  point."
- **Key behavior-driven security tests planned via TDD**: A test confirming chunking completes
  quickly on a deliberately adversarial input (a very long unbroken run of digits or repeated
  punctuation), mirroring spec 006's own ReDoS test; a test confirming the pathological
  `maxLength`-smaller-than-any-protected-span case (SC-004) terminates and produces bounded
  output rather than hanging.

## Project Structure

### Documentation (this feature)

```text
specs/007-speech-aware-chunking/
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
├── app.js               # Single source file (specs 001-006). This feature:
│                         #   - Adds ABBREVIATIONS (const list) and isProtectedAbbreviationPeriod
│                         #     (new) — FR-002/FR-006
│                         #   - Adds isProtectedDecimal, isProtectedCurrencyPhrase,
│                         #     isProtectedOrdinal, isProtectedYearPhrase (new) — FR-003/FR-004/
│                         #     FR-005, each a small detector over plain narration text
│                         #   - Adds findBoundaryCandidates(text) (new) — FR-001's four-tier
│                         #     priority scan (paragraph/sentence/clause/plain punctuation),
│                         #     filtering out any candidate inside a protected span
│                         #   - Rewrites splitIntoSpeechChunks(text, maxLength) to greedily
│                         #     accumulate text between accepted boundary candidates, preferring
│                         #     higher-priority boundaries within maxLength (FR-001, FR-007),
│                         #     falling back to the existing splitLongText only when no
│                         #     protection-respecting boundary fits (FR-008)
│                         #   - splitLongText itself is UNCHANGED (reused as the last-resort path
│                         #     only, per spec.md Assumptions)
├── reader.test.js        # Same file; new tests appended, existing tests untouched
├── index.html            # NOT modified (explicit scope boundary)
└── styles.css            # NOT modified (explicit scope boundary)
```

**Structure Decision**: Single-file project, matching specs 001-006 — no new project, module, or
build step, no new dependency. All new logic lives in `pdf-reader/app.js`; all new tests live in
`pdf-reader/reader.test.js`.

## Complexity Tracking

*No violations — this section is intentionally empty. The four-tier priority order and
one-detector-per-protected-category structure are the explicit design commitments keeping this
feature's complexity bounded (see Constitution Check, Principle V).*

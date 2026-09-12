---

description: "Task list for Text Normalization Engine"
---

# Tasks: Text Normalization Engine

**Input**: Design documents from `/specs/006-text-normalization-engine/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/normalization-functions.md, quickstart.md (all present)

**Tests**: Included throughout, per Constitution Principle III (Behavior-Driven TDD,
non-negotiable) and this project's established practice in specs 001-005. This is the largest
feature in the sequence so far (7 independent categories) — each category gets its own small,
independent TDD cycle rather than one large combined implementation.

**Scope**: All three user stories from spec.md:
- User Story 1 (P1) — Numbers sound like numbers, not digits (FR-003, FR-004, FR-006, FR-007,
  FR-008)
- User Story 2 (P1) — Years sound like years, not large numbers (FR-005)
- User Story 3 (P2) — Percentages, decimals, and ordinals sound natural (FR-009, FR-010, FR-011)
- Cross-cutting: FR-001, FR-002, FR-012–FR-018 (staging, non-regression, security)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files/functions, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are relative to the repository root.

## Path Conventions

Single project, matching plan.md's Structure Decision — no new files: all tasks touch
`pdf-reader/app.js` (implementation) and `pdf-reader/reader.test.js` (tests).

---

## Phase 1: Setup

**Purpose**: Confirm the baseline this feature builds on.

- [X] T001 Confirmed: 136/136 passing baseline before any change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the shared cardinal-to-words algorithm and the detection/dispatch skeleton
every category depends on, plus the ReDoS-safety commitment, before any individual category is
implemented.

**⚠️ CRITICAL**: No user story's category work can begin until this phase is complete.

- [X] T002 [P] Added failing test: `convertCardinal` produces correct spoken form across group
      boundaries (single-digit, teen, tens, hundreds, thousands, millions).
- [X] T003 [P] Added failing test: `convertCardinal("0")` returns "zero" (boundary case).
- [X] T004 Implemented `convertCardinal(digitsText)` (lookup tables for 0-19/tens/scale words,
      iterative 3-digit grouping from least-significant chunk, scale word applied per group).
      Makes T002–T003 pass.
- [X] T005 [P] Added failing test: `detectNumericEntities` returns `[]` for text with no
      numeric-like span.
- [X] T006 [P] Added failing test: `detectNumericEntities` on "400 units" returns exactly one
      `cardinal` entity with correct `match`.
- [X] T007 Implemented the `detectNumericEntities(text)` skeleton: a `findNonOverlapping` helper
      matching a pattern against text while skipping ranges already claimed, plus the cardinal
      detector wired in as the sole entry so far. Makes T005–T006 pass.
- [X] T008 [P] Added failing test: `detectNumericEntities` completes in under 1000ms on a
      5000-character digit run and a 5000-character separator run — measured ~1.6ms in practice,
      confirming the non-nested-quantifier design (research.md Decision 4) is genuinely linear,
      not just theoretically so.
- [X] T009 Implemented `normalizeSpokenText(text)`: calls `detectNumericEntities`, splices each
      entity's `spoken` form in at its offsets, returns the original text unchanged when no
      entities are found. Exported `convertCardinal`, `detectNumericEntities`,
      `normalizeSpokenText`. 141/141 passing.

**Checkpoint**: The cardinal algorithm, the detection/dispatch skeleton, and the ReDoS-safety
guarantee all exist and are independently correct for the cardinal category alone. Every other
category's detector plugs into the same `detectNumericEntities` priority chain in later phases.

---

## Phase 3: User Story 1 - Numbers sound like numbers, not digits (Priority: P1) 🎯 MVP

**Goal**: Cardinal numbers (any size, with/without thousands separators) and currency amounts
($/£/€, with magnitude suffixes and cents) are narrated in natural spoken-word form; code/phone
digit sequences are correctly excluded and read digit-by-digit instead (FR-003, FR-004, FR-006,
FR-007, FR-008).

**Independent Test**: Process a document containing plain cardinals, currency amounts (including
magnitude suffixes and cents), and a labeled code/phone number, and confirm each converts to its
documented natural spoken form.

### Tests for User Story 1

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T010 [P] [US1] Added failing test: `detectNumericEntities` classifies "12,500" as one
      `cardinal` entity. Passed immediately (already correct from Foundational's pattern).
- [X] T011 [P] [US1] Added failing test: "PIN 4829" and "801-234-5678" classify as `code`; a
      9-digit unlabeled run classifies as `cardinal` (FR-004).
- [X] T012 [P] [US1] Added failing test: `$400`, `$1`, `$1.50`, `£400`, `€400` classify as
      `currency` with correct `match` spans.
- [X] T013 [P] [US1] Added failing test: `$4m`, `$2.5bn` classify as `currency`.
- [X] T014 [P] [US1] Added failing test: `convertCodeDigits` produces digit-by-digit words.
- [X] T015 [P] [US1] Added failing test: `convertCurrency` produces the correct form for all
      seven documented examples.
- [X] T016 [P] [US1] Added test: `₦400`/`400 USD` — the unsupported symbol/code text itself is
      left untouched, while the digits beside it are still converted as an ordinary cardinal
      (corrected the test's own assertion mid-implementation once I confirmed this is the
      intended FR-008/FR-013 distinction: "unsupported as currency" ≠ "unclassifiable
      entirely").

### Implementation for User Story 1

- [X] T017 [US1] Added the `code`-category detector (`CODE_LABEL_PATTERN` for label-word+digits,
      `PHONE_SHAPED_PATTERN` for dash/space-separated phone shapes) into the priority chain.
      Makes T011 pass.
- [X] T018 [US1] Implemented `convertCodeDigits(digitsText)` (digit-by-digit lookup). Makes T014
      pass.
- [X] T019 [US1] Added the `currency`-category detector (`CURRENCY_PATTERN`: symbol + digits +
      optional separators + optional cents + optional magnitude suffix), run FIRST in the
      priority chain. Makes T012–T013 pass.
- [X] T020 [US1] Implemented `convertCurrency(matchText)`: unit-noun singular/plural, cents
      clause, magnitude-word handling, built on `convertCardinal`. Makes T015 pass.
- [X] T021 [US1] Added a `normalizeSpokenText` end-to-end test covering all four US1 Acceptance
      Scenarios from spec.md directly (device cost, revenue-in-millions, population with
      separators, PIN). `renderNarrationText` wiring itself is Phase 6/T045 per this file's own
      sequencing — this task validates the categories work correctly together before that wiring
      lands, not the full pipeline path.

**Bug found and fixed during this phase (not a task, a genuine defect)**: my initial
`CARDINAL_PATTERN` (`\d{1,3}(?:,\d{3})*(?:\.\d+)?`) could only match 3 leading digits before
requiring a comma, so an unformatted 9+ digit cardinal fragmented into multiple 3-digit matches
instead of one number. Fixed by trying the comma-grouped form first, falling back to a plain
`\d+` run. That fix then exposed a second, more serious bug: `convertCardinal` on a very long
digit run (fixed at 350+ characters, `9` repeated) overflows to `Infinity`, whose modulo is `NaN`
while its quotient stays `Infinity` — the group-extraction loop's exit condition
(`remaining > 0`) is then never false, hanging indefinitely. This actually hung
`node --test reader.test.js` itself during this phase's own test run and had to be killed
manually. Fixed by bounding `convertCardinal` to this pipeline's largest named scale
(`SCALE_WORDS.length * 3` digits) and returning the original digit text unmodified beyond that,
consistent with FR-013's "leave unclassifiable input unmodified" and Security Review's A08:2025
commitment. Added a dedicated regression test (distinct from the general ReDoS test, since this
is numeric overflow, not regex backtracking) confirming a 350-digit run completes in
under a second and returns its original text unchanged.

**Checkpoint**: `node --test reader.test.js`: 150/150 passing (136 pre-existing, unmodified + 14
new). Cardinal, currency, and code/phone categories are complete and independently correct. This
alone is a viable MVP increment per plan.md.

---

## Phase 4: User Story 2 - Years sound like years, not large numbers (Priority: P1)

**Goal**: Bare 4-digit numbers in 1000-2099 are narrated as years, except when immediately
preceded by a currency symbol or followed by a unit/count word, in which case they fall back to
currency/cardinal (FR-005).

**Independent Test**: Process a document containing year-bearing sentences and a
quantity-bearing 4-digit sentence, and confirm each is disambiguated correctly.

### Tests for User Story 2

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T022 [P] [US2] Added failing test: "1998", "2024" classify as `year` (US2 AS1-AS2).
- [X] T023 [P] [US2] Added failing test: "2000" classifies as `year` (US2 AS3).
- [X] T024 [P] [US2] Added test: "1500" in "1500 units were sold" classifies as `cardinal` (US2
      AS4). Passed immediately once the year detector's unit-word exception was implemented
      alongside it (not sequenced as a separate pre-existing pass).
- [X] T025 [P] [US2] Added test: "1998" in "$1998 was the price" is part of the `currency`
      entity (US2 AS5). Initially failed — see the bug note below; passed once
      `CURRENCY_PATTERN`'s digit-fragmentation bug was fixed.
- [X] T026 [P] [US2] Added failing test: `convertYear` produces "nineteen ninety-eight", "twenty
      twenty-four", "two thousand" for 1998/2024/2000.

### Implementation for User Story 2

- [X] T027 [US2] Added the `year`-category detector: `YEAR_PATTERN` (`1[0-9]{3}|20[0-9]{2}` with
      a negative lookbehind for a preceding currency symbol) plus a post-match filter checking
      for a following unit/count word (`UNIT_WORD_PATTERN`), sequenced after currency and code,
      before cardinal. Makes T022–T025 pass.
- [X] T028 [US2] Implemented `convertYear(digitsText)` (two-2-digit-group split; "two thousand [+
      cardinal]" special case for 2000-2009, since there's no natural "twenty-oh-three"
      pairing). Makes T026 pass.

**Second bug found and fixed during this phase**: `CURRENCY_PATTERN` had the exact same
digit-fragmentation defect as `CARDINAL_PATTERN` did in Phase 3 — `\d{1,3}` capped currency
amounts at 3 digits before requiring a comma, so `"$1998"` (4 digits, no comma) simply never
matched as currency at all, silently falling through to the cardinal/year detectors instead of
being correctly claimed. This directly broke US2 AS5 (T025) — without the currency claim,
`YEAR_PATTERN`'s lookbehind had nothing to reject against and "1998" would have been read as a
year despite the leading `$`. Fixed with the same comma-grouped-or-plain-digit-run alternation
already applied to `CARDINAL_PATTERN`, applied to both `CURRENCY_PATTERN` and
`convertCurrency`'s internal parsing regex (which had the identical `\d{1,3}` cap).

**Checkpoint**: `node --test reader.test.js`: 156/156 passing (150 from Phases 1-3 + 6 new).
Year disambiguation is complete and independently correct, including both exception cases.

---

## Phase 5: User Story 3 - Percentages, decimals, and ordinals sound natural (Priority: P2)

**Goal**: Percentages, standalone decimals, and ordinal numbers are narrated in their natural
spoken form (FR-009, FR-010, FR-011).

**Independent Test**: Process a document containing a percentage, a standalone decimal, and
ordinal numbers, and confirm each converts to its documented natural spoken form, distinct from
how a plain cardinal or year would be read.

### Tests for User Story 3

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T029 [P] [US3] Added failing test: "20%" and "0.5%" classify as `percentage`.
- [X] T030 [P] [US3] Added failing test: "3.14" classifies as `decimal`.
- [X] T031 [P] [US3] Added failing test: "21st", "1st", "2nd" classify as `ordinal`.
- [X] T032 [P] [US3] Added failing test: `convertPercentage` produces "twenty percent" / "zero
      point five percent".
- [X] T033 [P] [US3] Added failing test: `convertDecimal` produces "three point one four".
- [X] T034 [P] [US3] Added failing test: `convertOrdinal` produces "first" / "second" /
      "twenty-first".

### Implementation for User Story 3

- [X] T035 [US3] Added the `percentage`-category detector (`PERCENTAGE_PATTERN`), sequenced
      ahead of ordinal/decimal/cardinal. Makes T029 pass.
- [X] T036 [US3] Implemented `convertPercentage(matchText)` via a shared `decimalToWords` helper
      (also used by `convertDecimal`) plus "percent". Makes T032 pass.
- [X] T037 [US3] Added the `decimal`-category detector (`DECIMAL_PATTERN`), sequenced after
      percentage/ordinal (so a percentage's decimal digits are already claimed) and ahead of
      cardinal. Makes T030 pass.
- [X] T038 [US3] Implemented `convertDecimal(matchText)` (thin wrapper over `decimalToWords`).
      Makes T033 pass.
- [X] T039 [US3] Added the `ordinal`-category detector (`ORDINAL_PATTERN`), sequenced ahead of
      cardinal. Makes T031 pass.
- [X] T040 [US3] Implemented `convertOrdinal(matchText)`: strips the suffix, converts the
      remaining digits via `convertCardinal`, then replaces only the cardinal's trailing word
      (split on the last space/hyphen) with its ordinal form via a small irregular-word lookup
      plus a `-y`→`-ieth` / default `+th` fallback — simpler and more robust than an initial
      string-surgery draft that computed separator positions manually (reworked before running
      any test, on review). Makes T034 pass.

**Checkpoint**: `node --test reader.test.js`: 163/163 passing (156 from Phases 1-4 + 7 new). All
seven categories are implemented and independently correct on the first implementation attempt
for this phase — no bugs found, unlike Phases 3-4. All three user stories are complete.

---

## Phase 6: Cross-Cutting Non-Regression & Fidelity (FR-001, FR-002, FR-013–FR-018)

**Purpose**: Prove the requirements that span all categories rather than belonging to any single
user story: non-destructive spoken text, policy-scoped operation, graceful handling of
unclassifiable spans, and zero-regression on documents without numeric patterns.

- [X] T041 [P] Added test: a number beyond this pipeline's largest named scale (350-digit run,
      the same bug fixture from Phase 3) is left completely unmodified by `normalizeSpokenText`
      (FR-013, SC-004). Passed immediately — this is the direct behavioral payoff of the Phase 3
      overflow fix.
- [X] T042 [P] Added test: plain prose with no numeric-like span at all is returned byte-for-byte
      unchanged by `normalizeSpokenText` (FR-017, SC-002). Passed immediately.
- [X] T043 [P] Added test: a document with a narratable body block containing `$400` and an
      excluded footnote block containing `$999` — `renderNarrationText` normalizes the body's
      amount but the footnote's amount never appears at all (proving policy filtering happens
      before normalization ever sees that text). Failed until T045's wiring landed.
- [X] T044 [P] Added test: `buildPipelineOutput` on a document with `$400` — `narrationText`
      contains "four hundred dollars", `displayText` and every block's `text` in `document`
      still contain the literal `$400` and never the spoken form. Failed until T045's wiring
      landed.
- [X] T045 Wired `normalizeSpokenText` into `renderNarrationText`, wrapping the existing
      `stripCitationsAndUrls(joinedText)` call: `normalizeSpokenText(stripCitationsAndUrls(joinedText))`.
      Makes T043–T044 pass; T041–T042 already held from Phase 3/testing directly against
      `normalizeSpokenText`.
- [X] T046 All seven converter functions were already exported by their introducing tasks in
      Phases 2-5 (`convertCardinal`, `convertCodeDigits`, `convertCurrency`, `convertYear`,
      `convertPercentage`, `convertDecimal`, `convertOrdinal`) — verified present in the
      `api`/`module.exports` object; no further export needed.

**Checkpoint**: `node --test reader.test.js`: 167/167 passing (163 from Phases 1-5 + 4 new). The
full pipeline, end to end, normalizes narration text without regressing display text, policy
scoping, or documents lacking numeric patterns.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation against the spec's success criteria as a whole.

- [X] T047 [P] Added a combined test exercising currency, year, citation-stripping, and
      percentage together in one paragraph via `renderNarrationText`.

      **Scope gap found and documented (not silently patched)**: my first draft of this test used
      "$400 million" (spelled-out, space-separated magnitude word) — exactly the phrasing in the
      original goal document's own MVP Acceptance Example. This produced "four hundred dollars
      million" (wrong word order), because `CURRENCY_PATTERN`/FR-007 only recognize a magnitude
      suffix directly *attached* to the digits (`$4m`, `$2.5bn`, per spec.md's actual documented
      examples) — a separate spelled-out magnitude word after a space is a distinct pattern this
      spec never committed to supporting. This is not a bug relative to spec.md's FRs (FR-007's
      literal wording and examples only cover the attached-suffix form), but it is a real,
      user-visible gap relative to the broader goal document's own example. Rather than silently
      expand scope mid-polish-phase to patch it, the test was corrected to use the documented
      `$4m` form (matching FR-007 exactly), and this gap is recorded here for a future spec or
      follow-up to address explicitly: recognizing "$<number> <magnitude word>" as well as
      "$<number><suffix>".
- [X] T048 Reviewed every new function against Principle V (≤10 cyclomatic complexity):
      `convertCardinal` (~4), `convertCodeDigits` (~1), `convertCurrency` (~4), `convertYear`
      (~4), `convertPercentage` (~2), `convertDecimal` (~1), `convertOrdinal` (~2),
      `detectNumericEntities` (~3, delegates to per-category detector/converter pairs rather than
      inlining seven checks — the plan's committed design). All well within the limit; no
      documented exception needed.
- [X] T049 Reviewed all 11 regex patterns introduced or touched by this feature
      (`CARDINAL_PATTERN`, `CURRENCY_PATTERN`, `CODE_LABEL_PATTERN`, `PHONE_SHAPED_PATTERN`,
      `PERCENTAGE_PATTERN`, `ORDINAL_PATTERN`, `DECIMAL_PATTERN`, `UNIT_WORD_PATTERN`,
      `YEAR_PATTERN`, plus the pre-existing `CITATION_MARKER_PATTERN`/`BARE_URL_PATTERN`): none
      nest one unbounded quantifier inside another repeated group (research.md Decision 4
      confirmed structurally, not just empirically via T008/T041's timing tests). The one real
      DoS hazard this phase surfaced (Phase 3's `convertCardinal` infinite loop) was numeric
      overflow, not regex backtracking — already fixed and covered by its own regression test.
- [X] T050 Ran `quickstart.md`'s automated validation section (`node --test reader.test.js`) —
      all listed expectations hold: 136 pre-existing tests unmodified and passing, plus 32 new
      tests across Phases 2-7, 168/168 total.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories (the cardinal algorithm
  and detection/dispatch skeleton are load-bearing for every category).
- **User Story 1 (Phase 3, P1)**: Depends on Foundational. No dependency on US2/US3.
- **User Story 2 (Phase 4, P1)**: Depends on Foundational AND on US1's currency detector being
  wired in (T019), since T025's exception test relies on currency already claiming "$1998" at
  higher priority — sequenced after US1 for that reason, despite sharing P1 priority.
- **User Story 3 (Phase 5, P2)**: Depends on Foundational only — could in principle run before
  US2, but sequenced last among the three stories since it's P2 and its categories (percentage,
  decimal, ordinal) don't interact with year disambiguation.
- **Cross-Cutting (Phase 6)**: Depends on all three user stories being complete (exercises the
  fully-wired `normalizeSpokenText`/`renderNarrationText` path).
- **Polish (Phase 7)**: Depends on Phase 6.

### Within Each User Story

- Tests are written and confirmed failing before implementation.
- Each category's detector-then-converter pair is its own small TDD cycle — do not implement two
  categories' detectors before both have their own passing tests, per the constitution's "many
  small TDD cycles" guidance being especially important for a feature this size.

### Parallel Opportunities

- T002–T003, T005–T006, T008 (Foundational tests) can be written in parallel.
- T010–T016 (US1 tests) can all be written in parallel.
- T022–T026 (US2 tests) can all be written in parallel.
- T029–T034 (US3 tests) can all be written in parallel.
- T041–T044 (Cross-Cutting tests) can all be written in parallel.
- Implementation tasks within a phase that touch different converter functions (e.g. T018 and
  T020) can be done in either order, but each depends on its own detector task landing first.

---

## Parallel Example: User Story 1 Tests

```bash
# Launch all US1 tests together (all assert against not-yet-fully-wired detectNumericEntities):
Task: "Add failing test: thousands-separated cardinal detected as one entity"
Task: "Add failing test: labeled/phone-shaped digit sequences detected as code"
Task: "Add failing test: $/£/€ amounts detected as currency"
Task: "Add failing test: magnitude-suffix currency amounts detected as currency"
Task: "Add failing test: convertCodeDigits produces digit-by-digit words"
Task: "Add failing test: convertCurrency produces correct spoken form per example"
Task: "Add failing test: unsupported currency symbols left unmodified"
```

---

## Implementation Strategy

### MVP First (Foundational + User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (cardinal algorithm + detection skeleton + ReDoS safety) —
   CRITICAL, blocks all stories.
3. Complete Phase 3: User Story 1 — cardinal, currency, and code/phone categories complete. This
   alone closes the single most common and most jarring narration failure mode (spec.md's own
   framing of why US1 is P1 and foundational).
4. **STOP and VALIDATE**: run `node --test reader.test.js`.

### Incremental Delivery

1. Setup + Foundational → cardinal algorithm and detection skeleton exist.
2. Add User Story 1 → cardinal/currency/code categories complete → validate independently.
3. Add User Story 2 → year disambiguation complete → validate independently.
4. Add User Story 3 → percentage/decimal/ordinal complete → validate independently.
5. Cross-Cutting phase → non-regression and fidelity guarantees proven end-to-end.
6. Polish phase → cross-cutting success-criteria confirmation, complexity/security review.

Each story adds a category without breaking previously-completed categories, per FR-017's
non-regression constraint and the non-overlapping-entity guarantee (research.md Decision 2)
holding throughout.

---

## Phase 8: Convergence

**Purpose**: Close a gap found by `/speckit-converge` between FR-013's requirement and the
current behavior of four converter functions when their internal `convertCardinal` call falls
back to leaving an oversized digit run unmodified (Phase 3's overflow-safety fix).

- [X] T051 Fixed `convertCurrency`, `convertPercentage`, and `convertDecimal` in
      `pdf-reader/app.js`: extracted `exceedsConvertibleDigits(digitsText)` from
      `convertCardinal`'s inline overflow check so every wrapping converter can guard its
      whole-number part before building phrasing around it. `convertCurrency` checks the guard
      immediately after parsing, before either the magnitude-suffix or cents branch runs (also
      covers `$<oversized>m`-shaped input, verified separately). `decimalToWords` (shared by
      `convertPercentage`/`convertDecimal`) returns `null` on overflow instead of a string, and
      both callers fall back to their original `matchText` when they see `null`.
      `convertPercentage`'s non-decimal branch (a bare oversized integer percentage) got its own
      guard too, since it doesn't route through `decimalToWords`. `convertYear` needed no change
      — confirmed via a sanity-check test that `YEAR_PATTERN` can only ever produce an
      exactly-4-digit match, so it can never reach the overflow threshold. Added 5 new tests
      (4 unit-level + 1 end-to-end through `normalizeSpokenText`) covering all three fixed
      converters plus the year sanity check; all pass. Full suite: 173/173 (168 pre-existing,
      unmodified + 5 new).


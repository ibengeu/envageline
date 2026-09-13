---

description: "Task list for Speech-Aware Chunking"
---

# Tasks: Speech-Aware Chunking

**Input**: Design documents from `/specs/007-speech-aware-chunking/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/chunking-functions.md, quickstart.md (all present)

**Tests**: Included throughout, per Constitution Principle III (Behavior-Driven TDD,
non-negotiable) and this project's established practice in specs 001-006.

**Scope**: All three user stories from spec.md:
- User Story 1 (P1) — Abbreviations don't create false sentence breaks (FR-002, FR-006)
- User Story 2 (P1) — Numbers and currency amounts are never split mid-value (FR-003, FR-004,
  FR-005)
- User Story 3 (P2) — Chunking still respects length limits and existing behavior (FR-001,
  FR-007, FR-008, FR-009)

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

- [X] T001 Confirmed: 173/173 passing baseline before any change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the boundary-candidate scanner skeleton and confirm the two originally
reproduced defects are captured as failing tests before any protection logic exists.

**⚠️ CRITICAL**: No user story's protection work can begin until this phase is complete.

- [X] T002 [P] Added tests codifying the FIXED (not buggy) behavior for both originally
      reproduced defects: "Dr. Smith" stays together, "3.14" stays together. Correctly fail
      until real fixes land (Dr./Smith fails until Phase 3; 3.14 already passes from T005a's
      rewrite alone, since decimal-adjacent periods never matched the old greedy sentence regex
      as a false boundary in the first place — only the abbreviation case needed new protection
      logic).
- [X] T003 [P] Added failing test: `findBoundaryCandidates(text, "paragraph")` finds both `\n\n`
      boundaries in a 3-paragraph text.
- [X] T004 [P] Added test: `findBoundaryCandidates(text, "sentence")` finds boundaries between
      3 sentences. **Test-authoring bug caught before it became a false failure**: initially
      expected 3 candidates for 3 sentences; corrected to 2 once I recognized a boundary marks
      the split point *between* sentences, not one-per-sentence — there is no boundary after the
      final sentence since nothing follows it.
- [X] T005 Implemented `findBoundaryCandidates(text, tier)` using one regex per tier
      (`BOUNDARY_PATTERNS`), each with bounded non-nested quantifiers. `isProtectedPosition`
      stubbed to always return `false` for this phase (Phases 3-4 wire in real detectors).
- [X] T005a Implemented `splitByTier`/`splitAtTierUnconditionally`.
      **Two real design bugs found and fixed during this phase, both via direct comparison
      against the live pre-007 code, not guessed at**:
      (1) My first draft short-circuited to one chunk whenever the *whole* input already fit
      under `maxLength`, before ever attempting a tier split — this silently merged
      "First passage. Second passage." (31 chars, fits under the default 260) into one chunk
      instead of the pre-007 chunker's two, breaking two existing bookmark-position tests
      downstream. Root-caused by reproducing the exact fixture from those tests directly against
      both old and new code.
      (2) After partially fixing (1), a single-piece "no boundary found at this tier" result was
      still being accepted as final once it fit under `maxLength`, rather than continuing to
      descend through the remaining *unconditional* tiers (paragraph then sentence) — this
      reintroduced the same merge bug at the paragraph→sentence transition specifically, since a
      short paragraph with multiple sentences never advanced to sentence-tier splitting. Fixed by
      introducing `UNCONDITIONAL_TIERS` (paragraph, sentence — matching the pre-007 chunker's
      actual granularity, which always split into sentences and never merged) versus
      `CONDITIONAL_TIERS` (clause, plain — used only as fallbacks for an oversized piece), with
      unconditional tiers always descending to the next unconditional tier regardless of size.
- [X] T006 [P] Added failing-until-verified test: chunking completes under 1 second on a long
      digit run + long punctuation run. Passed immediately (~1ms) both before and after the
      rewrite — confirmed no ReDoS regression introduced by the new regex patterns.
- [X] T007 Exported `findBoundaryCandidates` and `splitByTier`.

**Checkpoint**: `node --test reader.test.js`: 177/178 (176 pre-existing + this phase's new tests,
minus the one abbreviation-protection test correctly still failing — that's Phase 3's job). The
boundary scanner exists and correctly tags paragraph/sentence candidates with no protection logic
yet. The decimal defect is already resolved as a side effect of the tiered rewrite; the
abbreviation defect remains, tracked as this feature's next milestone.

---

## Phase 3: User Story 1 - Abbreviations don't create false sentence breaks (Priority: P1) 🎯 MVP

**Goal**: The chunker never splits between a protected abbreviation and the word immediately
following it, while ordinary sentence boundaries with no abbreviation involved still split
correctly (FR-002, FR-006).

**Independent Test**: Process narration text containing each of the twelve fixed abbreviations
followed by a capitalized word, and confirm no split occurs between them; separately confirm an
ordinary sentence boundary with no abbreviation still splits.

### Tests for User Story 1

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T008 [P] [US1] Added failing test: `isProtectedAbbreviationPeriod` true for all twelve
      fixed abbreviations followed by further text.
- [X] T009 [P] [US1] Added failing test: `false` when the abbreviation is at the very end of the
      text (spec.md Edge Cases).
- [X] T010 [P] [US1] Added failing test: `false` for an ordinary sentence-ending period with no
      abbreviation.
- [X] T011 [P] [US1] Added failing test: "Dr. Smith" stays in one chunk (US1 AS1) — the direct
      fix for the first originally reproduced defect.
- [X] T012 [P] [US1] Added failing test: "Prof. Lee" stays in one chunk (US1 AS2).
- [X] T013 [P] [US1] Added test: an ordinary sentence boundary with no abbreviation still splits
      (US1 AS3). Passed immediately — Foundational's tiered rewrite already handled this
      correctly on its own.

### Implementation for User Story 1

- [X] T014 [US1] Implemented `isProtectedAbbreviationPeriod(text, position)` (fixed abbreviation
      list, following-text check via `text.slice(0, position).endsWith(abbreviation)`). Wired as
      the sole check inside `isProtectedPosition` (the dispatch stub from Phase 2). T008–T010
      passed immediately.
- [X] T015 [US1] Wired `isProtectedPosition` into `findBoundaryCandidates`'s sentence-tier scan
      (already structurally present as a stub call from Phase 2 — Phase 3 only needed to make
      the stub real). **Real bug found and fixed**: `findBoundaryCandidates` was checking
      protection at the boundary's final `position` (after the sentence pattern's trailing
      `\s+`), but `isProtectedAbbreviationPeriod` expects to check right after the abbreviation's
      period itself — a one-character offset mismatch that silently made the check always
      irrelevant (checking a space character's context, not the period's). Fixed by checking
      protection at `match.index + 1` (immediately after the punctuation character) instead of
      the full match end. Caught by T011/T012 actually failing after T014 alone passed, which is
      exactly what motivated tracing the offset bug rather than assuming the detector was wrong.
      Makes T011–T012 pass.
- [X] T016 [US1] Exported `isProtectedAbbreviationPeriod`.

**Checkpoint**: `node --test reader.test.js`: 184/184 passing. Abbreviation protection is
complete and independently correct — this alone is a viable MVP increment per plan.md, and both
originally reproduced defects from spec.md's Input are now fixed (the decimal one resolved
already in Phase 2, the abbreviation one here).

---

## Phase 4: User Story 2 - Numbers and currency amounts are never split mid-value (Priority: P1)

**Goal**: The chunker never splits inside a decimal (raw or spoken-form), a currency phrase, an
ordinal, or a spoken year phrase (FR-003, FR-004, FR-005).

**Independent Test**: Process narration text containing each protected numeric pattern near a
chunk-length boundary and confirm the complete phrase stays within one chunk.

### Tests for User Story 2

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T017 [P] [US2] Added failing test: `isProtectedDecimal` true between "3" and "14" in
      "3.14"; false for a sentence-ending period after a digit with no following digit.
      **Corrected mid-authoring**: my first draft's position calculation actually landed right
      after the "." (not "between two digits" as literally worded) — confirmed this is still
      correct once `isProtectedDecimal` was redesigned to protect the whole matched span, not
      just a position with digits on both immediate sides (see T025 below).
- [X] T018 [P] [US2] Added failing test: `isProtectedCurrencyPhrase` true inside "four hundred
      dollars" (both internal boundaries) and inside "one dollar and fifty cents"; false outside
      any currency-unit-noun-adjacent run.
- [X] T019 [P] [US2] Added failing test: `isProtectedOrdinal` true inside "twenty-first"; false
      outside any ordinal word run.
- [X] T020 [P] [US2] Added failing test: `isProtectedYearPhrase` true inside "twenty twenty-four"
      and "two thousand five"; false outside any year word run.
- [X] T021 [P] [US2] Added failing test: "three point one four" stays together (US2 AS1) — the
      direct fix for the second originally reproduced defect. This test is what surfaced the
      missing protection-aware fallback tier (see T029's bug note).
- [X] T022 [P] [US2] Added failing test: "four hundred dollars" never splits (US2 AS2). Also
      surfaced the same missing-fallback-tier bug as T021.
- [X] T023 [P] [US2] Added test: a raw "3.14" is not split mid-decimal. Passed immediately —
      already covered by Phase 2's tiered rewrite plus Phase 4's `isProtectedDecimal` raw-digit
      check landing before the spoken-form check was even needed for this case.
- [X] T024 [P] [US2] Added test: "twenty-first" and "twenty twenty-four" stay intact near a
      length boundary. Passed immediately.

### Implementation for User Story 2

- [X] T025 [US2] Implemented `isProtectedDecimal(text, position)`. **Design correction found
      while writing it**: a check requiring digits on both immediate sides of `position` can
      never be true when a "." sits between them (the "." isn't a digit) — redesigned to find the
      full raw-decimal match (`RAW_DECIMAL_PATTERN`) and protect any position strictly inside its
      matched span, not just positions with adjacent digits. Also extended (once T021 exposed the
      need) to recognize the spoken multi-word form: any `NUMBER_WORD_RUN_PATTERN` match
      containing the word "point" is equally protected — this is what actually made "three point
      one four" protectable, since that phrase contains no literal digits at all. Makes T017,
      T021 pass.
- [X] T026 [US2] Implemented `isProtectedCurrencyPhrase(text, position)`: finds each currency
      unit noun (`CURRENCY_UNIT_NOUN_PATTERN`: dollar/dollars/pound/pounds/euro/euros/cent/cents)
      and extends the protected range backward to include any immediately-adjacent number-word
      run (`NUMBER_WORD_RUN_PATTERN`, shared with T025's spoken-decimal check). Makes T018 pass.
- [X] T027 [US2] Implemented `isProtectedOrdinal(text, position)`: finds an ordinal-ending word
      (`ORDINAL_WORD_ENDING_PATTERN`) and extends the range backward across one preceding
      hyphen-joined word if present (covers "twenty-first" as one protected unit, not just
      "first"). Makes T019 pass.
- [X] T028 [US2] Implemented `isProtectedYearPhrase(text, position)`: `YEAR_WORD_PHRASE_PATTERN`
      matches the two-part "nineteen/twenty ..." shape and the "two thousand [+ word]" shape
      directly. Makes T020 pass.
- [X] T029 [US2] Wired all four new detectors into `isProtectedPosition`'s dispatch (alongside
      Phase 3's abbreviation check). **Significant design gap found and fixed, not anticipated in
      plan.md/research.md**: after wiring, T021/T022 still failed — tracing showed
      `splitIntoSpeechChunks("...is three point one four in...", 30)` still split the phrase,
      even though `isProtectedDecimal` correctly returned `true` for that exact position. Root
      cause: neither punctuation-based tier (paragraph/sentence/clause/plain) has a candidate in
      a punctuation-free sentence like this one, so `splitByTier` fell through to the
      **unmodified** `splitLongText` fallback — which has no concept of protected spans at all
      and wraps purely at word boundaries every `maxLength` characters, splitting straight
      through the protected phrase. research.md Decision 3 had assumed the existing
      `splitLongText` was an adequate, protection-agnostic-but-rare last resort; this was wrong
      for any punctuation-free passage containing a protected phrase, which is common enough to
      matter (plain prose with numbers, no commas). Fixed by adding
      `packWordsRespectingProtection(text, maxLength)`: a new function, structurally mirroring
      `splitLongText`'s greedy word-packing and identical single-overlong-word character-split
      fallback, but checking `isProtectedPosition` before accepting a word boundary as a valid
      chunk break. `splitByTier`'s final-tier fallback now calls this instead of raw
      `splitLongText`; the original `splitLongText` itself remains completely unmodified, per
      plan.md's constraint, and is no longer reachable from `splitIntoSpeechChunks`'s own tiered
      path except via `packWordsRespectingProtection`'s own explicit reuse of the same
      single-overlong-word logic. Makes T021–T022 pass.

**Checkpoint**: `node --test reader.test.js`: 192/192 passing (184 from Phases 1-3 + 8 new). All
five protected-span categories are complete and independently correct. Both originally
reproduced defects are now fully resolved.

---

## Phase 5: User Story 3 - Chunking still respects length limits and existing behavior (Priority: P2)

**Goal**: The length bound is still respected, the last-resort fallback terminates safely, and a
document with no protected patterns chunks identically to before this spec (FR-001, FR-007,
FR-008, FR-009).

**Independent Test**: Process a long plain-prose passage with none of the protected patterns and
confirm byte-for-byte identical output to the pre-fix chunker; construct a pathological
`maxLength`-too-small case and confirm bounded, terminating output.

### Tests for User Story 3

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T030 [P] [US3] Added test: `splitIntoSpeechChunks` on a 4-sentence plain-prose passage with
      no protected patterns. **Verified against the actual pre-007 code, not guessed**: extracted
      `app.js` from the last git commit (before this feature's changes) and ran the exact fixture
      through it to confirm the recorded baseline before writing the assertion — the baseline
      matched what I'd have predicted, but this was checked, not assumed. Passed immediately
      (Phase 2's tiered rewrite already preserves this).
- [X] T031 [P] [US3] Added test: `maxLength` smaller than the shortest protected span still
      produces bounded, terminating output. **Test-authoring bug caught and fixed**: my first
      assertion (`chunks.join(" ")` should equal the original text) failed — at `maxLength: 5`,
      `packWordsRespectingProtection`'s single-overlong-word character-split (mirroring
      `splitLongText`'s own pre-existing behavior) joins fragments without a space
      ("devic"+"e", not "devic e"), so a literal space-joined comparison is the wrong check. Not
      a bug in the implementation — `splitLongText` has always behaved this way; my test's
      equality check was too strict. Fixed by comparing letters only (whitespace-stripped) to
      verify no content is lost, which is what SC-004 actually requires.
- [X] T032 [P] [US3] Added test: a sentence-tier split that would exceed `maxLength` correctly
      falls back to an in-range clause-tier split instead. Passed immediately — this is exactly
      what the recursive tier-descent design (Phase 2) does by construction.

### Implementation for User Story 3

- [X] T033 [US3] No implementation needed — the last-resort fallback was already completed in
      Phase 4/T029 (`packWordsRespectingProtection`, not the originally-planned raw
      `splitLongText` resume-scan approach; see T029's design-gap note). T031 passed directly
      against the existing implementation.
- [X] T034 [US3] No adjustment needed — the recursive tier-descent structure from Phase 2
      already implements the full four-tier preference order (each conditional tier is only
      reached when the prior tier's piece is still oversized). T032 passed directly.
- [X] T035 [US3] Ran T030: byte-for-byte match confirmed against the verified pre-007 baseline.

**Checkpoint**: `node --test reader.test.js`: 193/193 passing. Length-bound respect, safe
fallback termination, and zero regression on protection-free text are all proven. All three user
stories are complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation against the spec's success criteria as a whole.

**Scope note**: the originally-planned T036 (a combined multi-category test) was dropped as
redundant on review — every protected category already has its own dedicated end-to-end test
(US1 AS1/AS2, US2 AS1/AS2/AS4, US3 AS3), and T032 already exercises multiple tiers together in
one passage. Adding a further "combined" test would only restate assertions already made
individually, which is the kind of test-count inflation worth avoiding rather than defaulting
into. Two redundant Foundational-phase "defect reproduction" tests (which duplicated US1 AS1 and
US2 AS3 exactly, word for word) were also removed during Phase 5, dropping the suite from 195 to
193 with zero coverage loss.

- [X] T037 Reviewed every new function against Principle V (≤10 cyclomatic complexity):
      `isProtectedAbbreviationPeriod` (~2), `isProtectedDecimal` (~4), `isProtectedCurrencyPhrase`
      (~5, the highest — two nested scan loops), `isProtectedOrdinal` (~3), `isProtectedYearPhrase`
      (~3), `isProtectedPosition` (~1), `findBoundaryCandidates` (~2), `splitAtTierUnconditionally`
      (~2), `packWordsRespectingProtection` (~5), `splitByTier` (~6, the highest overall). All
      well within the limit; no documented exception needed.
- [X] T038 Reviewed all regex patterns introduced by this feature (`BOUNDARY_PATTERNS`'s four
      tier patterns, `RAW_DECIMAL_PATTERN`, `NUMBER_WORD_RUN_PATTERN`, `CURRENCY_UNIT_NOUN_PATTERN`,
      `ORDINAL_WORD_ENDING_PATTERN`, `YEAR_WORD_PHRASE_PATTERN`): none nest an unbounded
      quantifier inside another repeated group. `NUMBER_WORD_RUN_PATTERN`'s
      `(?:[\s-]+(?:...))*` repeats a group that must consume at least one separator character
      per iteration, so it cannot loop on a zero-width match. Confirmed structurally, corroborating
      T006's empirical timing test.
- [X] T039 Ran `quickstart.md`'s automated validation section (`node --test reader.test.js`) —
      all listed expectations hold: 173 pre-existing tests unmodified and passing, plus 20 new
      tests across Phases 2-5 (2 redundant Foundational-phase tests removed on review before
      this final count), 193/193 total.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories (the boundary scanner and
  the codified regression baseline for the two original defects must exist first).
- **User Story 1 (Phase 3, P1)**: Depends on Foundational. Establishes the full
  `splitIntoSpeechChunks` rewrite (greedy selection + stubbed fallback) that US2/US3 extend, so
  it is sequenced first among the P1 stories.
- **User Story 2 (Phase 4, P1)**: Depends on US1's rewritten `splitIntoSpeechChunks` existing to
  extend with additional detectors.
- **User Story 3 (Phase 5, P2)**: Depends on US1 and US2's detectors all being wired in (its
  regression test exercises the fully-assembled chunker, and its fallback-completion task
  finishes what US1 stubbed).
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests are written and confirmed failing before implementation.
- Implementation tasks follow their tests directly, one detector/behavior at a time.

### Parallel Opportunities

- T002–T004, T006 (Foundational tests) can be written in parallel.
- T008–T013 (US1 tests) can all be written in parallel.
- T017–T024 (US2 tests) can all be written in parallel.
- T030–T032 (US3 tests) can all be written in parallel.
- T036 depends on all prior implementation tasks being complete and so is not parallelizable
  with them.

---

## Parallel Example: User Story 2 Tests

```bash
# Launch all US2 detector tests together (all assert against not-yet-implemented functions):
Task: "Add failing test: isProtectedDecimal true/false cases"
Task: "Add failing test: isProtectedCurrencyPhrase true/false cases"
Task: "Add failing test: isProtectedOrdinal true/false cases"
Task: "Add failing test: isProtectedYearPhrase true/false cases"
```

---

## Implementation Strategy

### MVP First (Foundational + User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (boundary scanner + codified defect baseline) — CRITICAL,
   blocks all stories.
3. Complete Phase 3: User Story 1 — abbreviation protection complete, first originally reproduced
   defect fixed.
4. **STOP and VALIDATE**: run `node --test reader.test.js`.

### Incremental Delivery

1. Setup + Foundational → boundary scanner exists, defects codified as failing tests.
2. Add User Story 1 → abbreviation protection complete → validate independently.
3. Add User Story 2 → all numeric/currency protection complete → validate independently.
4. Add User Story 3 → length-bound and fallback safety proven, zero regression confirmed →
   validate independently.
5. Polish phase → cross-cutting success-criteria confirmation, complexity/security review.

Each story adds protection without breaking previously-completed protection, per FR-009's
non-regression constraint holding throughout.

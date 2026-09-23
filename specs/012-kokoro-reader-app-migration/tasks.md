# Tasks: Kokoro Narration for the Reader App

**Input**: Design documents from `/specs/012-kokoro-reader-app-migration/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included per project constitution Principle III (mandatory behavior-driven TDD) and
user's global TDD rules — every implementation task is preceded by its failing test, one
small cycle at a time. UI-only tasks are exempt per the constitution's UI carve-out.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) to enable
independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Paths are relative to repo root; all implementation happens under `reader-app/`

## Path Conventions

Single project, frontend-only change confined to `reader-app/src/reader/speech/` plus one
call-site file `reader-app/src/reader/controller.ts`. No backend changes (Kokoro server is
reused unchanged).

---

## Phase 1: Setup

**Purpose**: Confirm the environment is ready before any TDD cycles begin.

- [X] T001 Confirm `reader-app/` dependencies are installed and `npm run typecheck` passes
      clean (baseline already verified working during migration setup).
- [X] T002 Add the two new test files to `reader-app/package.json`'s `test` script
      (`src/reader/speech/kokoro-tts.test.ts`, `src/reader/speech/kokoro-voice-manager.test.ts`),
      alongside the existing `narration/compiler.test.ts` entry.

**Checkpoint**: Environment ready; test runner will pick up new speech test files once created.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared, story-agnostic pieces every user story's implementation calls into.
Kept minimal per constitution Principle V — no speculative abstraction beyond what
`contracts/` already specifies.

**⚠️ CRITICAL**: Must complete before any user story phase begins.

### Endpoint resolution & validation (shared by US1, US2, US3)

- [X] T003 [P] Write one failing test: "a base URL of `http://127.0.0.1:8880` is accepted as
      loopback" in `reader-app/src/reader/speech/kokoro-endpoint.test.ts` (new file).
- [X] T004 Implement the minimal `isLoopbackEndpoint(base: string): boolean` function in
      `reader-app/src/reader/speech/kokoro-endpoint.ts` (new file) to pass T003 — port the
      regex check from `pdf-reader/app.js`'s `isLocalTtsEndpoint` (per research.md).
- [X] T005 [P] Write one failing test: "a base URL of `http://example.invalid:8880` is
      rejected as non-loopback" in `kokoro-endpoint.test.ts`.
- [X] T006 Extend `isLoopbackEndpoint` minimally to pass T005 (refine the regex/host check;
      no new function needed — refactor only, per one-cycle-at-a-time discipline).
- [X] T007 [P] Write one failing test: "resolveKokoroUrls(base) returns speechUrl and
      voicesUrl derived from base" in `kokoro-endpoint.test.ts`.
- [X] T008 Implement `resolveKokoroUrls(base: string): { speechUrl: string; voicesUrl: string }`
      in `kokoro-endpoint.ts` to pass T007, per `data-model.md`'s derivation table.
- [X] T009 [P] Write one failing test: "the default configured base is
      `http://127.0.0.1:8880`" in `kokoro-endpoint.test.ts`.
- [X] T010 Export the `DEFAULT_KOKORO_BASE` constant from `kokoro-endpoint.ts` to pass T009.

**Checkpoint**: `kokoro-endpoint.ts` fully covers loopback validation and URL resolution —
every later story reuses this module without modification.

---

## Phase 3: User Story 1 - Listening with a real narration voice (Priority: P1) 🎯 MVP

**Goal**: Pressing play synthesizes and plays audio via the local Kokoro server, with
pause/resume/stop behaving equivalently to the current browser-speech engine.

**Independent Test**: With the Kokoro server running, open a document and press play;
confirm a Kokoro voice is heard and pause/resume/stop behave correctly (quickstart.md
Scenarios 1–2).

### Tests for User Story 1 (write first, confirm failing)

- [X] T011 [P] [US1] Write failing test: "speak() rejects immediately without calling fetch
      when the configured endpoint fails loopback validation" in
      `reader-app/src/reader/speech/kokoro-tts.test.ts` (new file; inject a fake `fetch` per
      research.md's test strategy).
- [X] T012 [P] [US1] Write failing test: "speak() resolves without calling fetch when
      segment.spokenText is empty/whitespace" in `kokoro-tts.test.ts`.
- [X] T013 [P] [US1] Write failing test: "speak() POSTs to `{base}/v1/audio/speech` with JSON
      body containing input, voice, response_format: 'wav', and speed clamped to [0.5, 2.0]"
      in `kokoro-tts.test.ts` (assert on the fake fetch's captured call args).
- [X] T014 [P] [US1] Write failing test: "speak() rejects with an 'unavailable' classification
      when fetch throws (network error)" in `kokoro-tts.test.ts`.
- [X] T015 [P] [US1] Write failing test: "speak() rejects with a 'synthesis-failed'
      classification, distinguishable from 'unavailable', when fetch resolves non-2xx" in
      `kokoro-tts.test.ts`.
- [X] T016 [P] [US1] Write failing test: "speak() resolves when fetch resolves 2xx and
      playback completes" (fake an `<audio>`-like playable stub per the contract) in
      `kokoro-tts.test.ts`.
- [X] T017 [P] [US1] Write failing test: "calling stop() while speak() is in flight rejects
      that in-flight promise with a cancellation classification (AbortError-equivalent)" in
      `kokoro-tts.test.ts`.
- [X] T018 [P] [US1] Write failing test: "pause() halts playback without resetting position;
      resume() continues from the same position" in `kokoro-tts.test.ts`.
- [X] T019 [P] [US1] Write failing test: "stop() resets position and releases the object URL"
      in `kokoro-tts.test.ts`.

### Implementation for User Story 1 (minimal code per failing test, one cycle at a time)

- [X] T020 [US1] Create `reader-app/src/reader/speech/kokoro-tts.ts` with a
      `KokoroSpeechEngine` class implementing `TTSEngine` (`initialize`, `getVoices` stubbed
      for now — full impl in US2 — `speak`, `pause`, `resume`, `stop`), using
      `isLoopbackEndpoint`/`resolveKokoroUrls` from `kokoro-endpoint.ts`. Implement just
      enough to pass T011, then T012, then T013 in sequence (do not write ahead).
- [X] T021 [US1] Extend `speak()`'s fetch-failure handling to pass T014 (map thrown fetch
      errors to the 'unavailable' rejection classification per contracts/kokoro-tts-engine.md).
- [X] T022 [US1] Extend `speak()`'s response handling to pass T015 (map non-2xx responses to
      'synthesis-failed', distinct from T021's classification).
- [X] T023 [US1] Implement the `<audio>`-backed playback path (blob URL construction,
      `ended` event → resolve) to pass T016.
- [X] T024 [US1] Implement `stop()`'s in-flight cancellation to pass T017.
- [X] T025 [US1] Implement `pause()`/`resume()` to pass T018.
- [X] T026 [US1] Implement `stop()`'s position-reset and object-URL release to pass T019.
- [X] T027 [US1] Update `reader-app/src/reader/controller.ts` to import and construct
      `KokoroSpeechEngine` from `./speech/kokoro-tts` instead of `BrowserSpeechEngine` from
      `./speech/browser-tts` (single line change at the `const tts = new ...` call site).
- [X] T028 [US1] Delete `reader-app/src/reader/speech/browser-tts.ts` (superseded — no longer
      imported by any file after T027).
- [ ] T029 [US1] Run `reader-app/quickstart.md` Scenarios 1 and 2 manually against a running
      Kokoro server; confirm playback, pause/resume/stop, and highlight sync all work as
      expected.

**Checkpoint**: User Story 1 is fully functional and independently testable — narration plays
via Kokoro, with correct pause/resume/stop/cancel behavior. This is the MVP.

---

## Phase 4: User Story 2 - Choosing a narration voice (Priority: P2)

**Goal**: The voice picker lists real Kokoro voices, and selecting one changes which voice is
used for playback.

**Independent Test**: With the Kokoro server running, open the voice picker and confirm the
list matches `GET /v1/audio/voices`; select a non-default voice and confirm it's used
(quickstart.md Scenario 3).

### Tests for User Story 2 (write first, confirm failing)

- [X] T030 [P] [US2] Write failing test: "loadVoices() resolves to [] without calling fetch
      when the configured endpoint fails loopback validation" in
      `reader-app/src/reader/speech/kokoro-voice-manager.test.ts` (new file).
- [X] T031 [P] [US2] Write failing test: "loadVoices() resolves to [] (not reject) when fetch
      throws" in `kokoro-voice-manager.test.ts`.
- [X] T032 [P] [US2] Write failing test: "loadVoices() resolves to [] (not reject) when fetch
      resolves non-2xx" in `kokoro-voice-manager.test.ts`.
- [X] T033 [P] [US2] Write failing test: "loadVoices() maps each Kokoro voice id (e.g.
      'af_heart') to a TTSVoice with id set to the raw string, localService true, and a
      humanized name" in `kokoro-voice-manager.test.ts`.
- [X] T034 [P] [US2] Write failing test: "loadVoices() marks exactly the configured default
      voice id as default: true" in `kokoro-voice-manager.test.ts`.
- [X] T035 [P] [US2] Write failing test: "isSpeechSupported() reflects fetch availability in
      the current environment" in `kokoro-voice-manager.test.ts`.
- [X] T036 [P] [US2] Write failing test: "pickDefaultVoice is re-exported and behaves
      identically to its existing documented contract" (a thin smoke test confirming the
      re-export, per contracts/kokoro-voice-manager.md's verbatim-reuse decision) in
      `kokoro-voice-manager.test.ts`.

### Implementation for User Story 2

- [X] T037 [US2] Create `reader-app/src/reader/speech/kokoro-voice-manager.ts` implementing
      `isSpeechSupported()` to pass T035.
- [X] T038 [US2] Implement `loadVoices()`'s loopback-guard short-circuit to pass T030.
- [X] T039 [US2] Extend `loadVoices()` to pass T031 and T032 (fail closed to `[]` on fetch
      throw or non-2xx).
- [X] T040 [US2] Implement the Kokoro voice-id → `TTSVoice` mapping function to pass T033.
- [X] T041 [US2] Implement default-voice marking to pass T034.
- [X] T042 [US2] Re-export `pickDefaultVoice` verbatim from the old
      `reader-app/src/reader/speech/voice-manager.ts` logic to pass T036 (copy the function
      body as-is per contracts/kokoro-voice-manager.md — no reimplementation).
- [X] T043 [US2] Wire `KokoroSpeechEngine.getVoices()` (stubbed in T020) to delegate to
      `loadVoices()` from `kokoro-voice-manager.ts`, matching how `BrowserSpeechEngine`
      delegated to the old `voice-manager.ts`.
- [X] T044 [US2] Update `reader-app/src/reader/controller.ts`'s imports of
      `isSpeechSupported`/`pickDefaultVoice` to come from `./speech/kokoro-voice-manager`
      instead of `./speech/voice-manager`.
- [X] T045 [US2] Delete `reader-app/src/reader/speech/voice-manager.ts` (superseded — no
      longer imported by any file after T044).
- [ ] T046 [US2] Run `reader-app/quickstart.md` Scenario 3 manually against a running Kokoro
      server; confirm the voice picker lists real Kokoro voices and selection affects
      playback.

**Checkpoint**: User Stories 1 and 2 both work independently — narration plays via Kokoro,
and the listener can choose which Kokoro voice narrates.

---

## Phase 5: User Story 3 - Graceful behavior when the local voice server isn't available (Priority: P3)

**Goal**: When the Kokoro server is unreachable, the listener sees a clear message instead of
a silent failure, hang, or crash, and no document text leaves the device.

**Independent Test**: With the Kokoro server stopped, press play and confirm a clear
unavailable message appears within 5 seconds, with zero non-loopback network requests
(quickstart.md Scenario 4).

### Tests for User Story 3 (write first, confirm failing)

> Note: T014/T021 (US1) already cover `speak()`'s own 'unavailable' rejection at the engine
> level. This phase covers the *listener-visible surfacing* of that rejection in
> `controller.ts`, which is the remaining gap per spec FR-007.

- [X] T047 [US3] Write failing test: "when tts.speak() rejects with an 'unavailable'
      classification, playback state transitions to an error state carrying a
      'local narration is unavailable' message" in
      `reader-app/src/reader/controller.test.ts` (new file, or extend existing controller
      tests if present — check for one first).
- [X] T048 [US3] Write failing test: "when tts.speak() rejects with a 'synthesis-failed'
      classification, playback state transitions to a per-passage error state distinct from
      the unavailable message" in the same controller test file.
- [X] T049 [US3] Write failing test: "a previously selected voiceId absent from the current
      voice list falls back to a valid default rather than failing to produce audio" in the
      same controller test file (exercises `pickDefaultVoice`'s existing fallback behavior
      wired through the real call site).

### Implementation for User Story 3

- [X] T050 [US3] In `reader-app/src/reader/controller.ts`, branch on the two rejection
      classifications from `speak()` (per contracts/kokoro-tts-engine.md) to pass T047 and
      T048 — surfacing the unavailable-vs-synthesis-failed distinction in playback state.
- [X] T051 [US3] Confirm/adjust the existing `pickDefaultVoice(voices, settings.voiceId)`
      call site in `controller.ts` handles a stale `voiceId` correctly to pass T049 (likely
      already correct per T042's verbatim reuse — this task verifies, and only changes code
      if the test reveals a gap).
- [ ] T052 [US3] Run `reader-app/quickstart.md` Scenario 4 (server stopped) and Scenario 5
      (loopback rejection) manually; confirm the unavailable message appears within 5 seconds
      in Scenario 4, and confirm zero network requests are made at all in Scenario 5.

**Checkpoint**: All three user stories are independently functional. The feature is complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all stories; no new behavior.

- [X] T053 [P] Run `npm run typecheck` in `reader-app/` and confirm it passes clean with the
      old `browser-tts.ts`/`voice-manager.ts` fully removed.
- [X] T054 [P] Run `npm test` in `reader-app/` and confirm every new test from T003–T052
      passes.
- [X] T055 [P] Run `npm run lint` in `reader-app/` and fix any findings introduced by this
      feature's new files.
- [X] T056 Grep `reader-app/src` for any remaining reference to `speechSynthesis`,
      `SpeechSynthesisUtterance`, or the deleted `browser-tts`/`voice-manager` module paths to
      confirm the cutover is complete.
- [X] T057 Confirm `pdf-reader/` (the old vanilla-JS app) is untouched: `git status
      pdf-reader/` shows no changes from this feature's work.
- [ ] T058 Re-run all five `quickstart.md` scenarios end-to-end as a final smoke pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories (US1's `speak()` and
  US2's `loadVoices()` both call into `kokoro-endpoint.ts`).
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on US2/US3 — ships with
  `getVoices()` stubbed to satisfy the `TTSEngine` interface (returns `[]` or a hardcoded
  default) until Phase 4 wires it up. This keeps US1 independently testable per spec.
- **User Story 2 (Phase 4)**: Depends on Foundational. Wires into the `getVoices()` stub left
  in Phase 3 (T043) — this is an integration point, not a reimplementation, so US1 remains
  independently valid before US2 starts.
- **User Story 3 (Phase 5)**: Depends on Foundational and on US1's rejection classifications
  (T021/T022) existing to branch on. Can be developed independently of US2.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before their corresponding implementation task
  (strict TDD micro-cycles — never write T011 through T019 all at once without implementing
  in between; the list above is ordered for readability, but execution MUST interleave one
  red test → minimal green implementation → refactor at a time, per CLAUDE.md's non-negotiable
  rule).
- Within Phase 2, T003→T004, T005→T006, T007→T008, T009→T010 are each one TDD cycle; the
  four cycles touch the same file (`kokoro-endpoint.ts`) so are NOT parallel with each other
  despite the `[P]` marker on the test-writing tasks — `[P]` here indicates the test tasks
  could be *drafted* in parallel, but implementation must still proceed one cycle at a time
  per the constitution.

### Parallel Opportunities

- T003, T005, T007, T009 (test-drafting only, Phase 2) can be written in parallel since they
  target independent behaviors, but must be made to pass one at a time.
- T011–T019 (Phase 3 test-drafting) can be written in parallel — same caveat as above.
- T030–T036 (Phase 4 test-drafting) can be written in parallel — same caveat.
- Phase 6's T053, T054, T055 can run in parallel (independent commands, no shared file edits).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (User Story 1) — one TDD cycle at a time.
3. **STOP and VALIDATE**: run quickstart.md Scenarios 1–2 manually against a live Kokoro
   server.
4. This is a deployable increment: narration is fully Kokoro-backed with correct playback
   controls, even before voice selection (US2) or graceful degradation (US3) land.

### Incremental Delivery

1. Setup + Foundational → shared endpoint module ready.
2. US1 → validate → real Kokoro narration works (MVP).
3. US2 → validate → voice selection works.
4. US3 → validate → graceful degradation works.
5. Polish → final cross-cutting verification.

## Notes

- No task in this list touches `pdf-reader/` — confirmed by T057.
- No task activates auth/database scaffolding in `reader-app` — confirmed by inspection during
  Polish (no dedicated task needed since no task in Phases 1–5 imports `@/lib/db` or auth
  routes).
- Every function introduced here stays within cyclomatic complexity 10 per constitution
  Principle V; if any implementation task's minimal code would exceed that, split the
  function further rather than requesting an exception.

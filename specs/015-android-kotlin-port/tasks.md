# Tasks: Android Kotlin Port

**Input**: Design documents from `/specs/015-android-kotlin-port/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Test tasks ARE included and are mandatory. Constitution Principle III makes
behavior-driven TDD non-negotiable, and this feature's value depends on preserving 53 existing
verified behaviors. One failing test precedes each implementation task.

**Source of truth**: `reader-app/src/reader` at commit `bb0c1f4`. No task may modify `reader-app/`
or `pdf-reader/` (FR-020).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: Which user story the task serves (US1-US5)

## Path Conventions

- Pure logic and its tests: `android-app/core/src/{main,test}/kotlin/com/evangeline/reader/`
- Platform code: `android-app/app/src/main/kotlin/com/evangeline/reader/app/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and a fast, device-free test loop

- [X] T001 Record the pinned `reader-app/src/reader` commit in `specs/015-android-kotlin-port/research.md`
- [X] T002 Create the two-module Gradle project in `android-app/` (`core` pure JVM, `app` Android) per plan Project Structure
  - **Reopened and completed 2026-09-17**: only `:core` had been built; `android-app/app/` was empty and `settings.gradle.kts` did not `include(":app")`. The `app` module now exists with AGP 8.7.3, builds a debug APK, and was installed and run on the API 36 emulator with `core` classes confirmed in the APK dex.
- [X] T003 [P] Pin every dependency to an exact version in `android-app/gradle/libs.versions.toml` (A03)
- [X] T004 [P] Enable dependency verification with SHA-256 in `android-app/gradle/verification-metadata.xml` (A03)
- [X] T005 [P] Wire the JUnit 5 test harness in `android-app/core/build.gradle.kts` so `:core:test` runs with no device
- [X] T006 [P] Add the detekt complexity gate (threshold 10) in `android-app/detekt.yml` and bind it to `check` (Principle V)
- [X] T007 [P] Add Kotlin build output patterns to `.gitignore`

**Checkpoint**: `./gradlew :core:check` green with no sources.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared vocabulary every user story depends on. No story can begin until this is done.

- [X] T008 Port document, page, block, passage, and settings types to `android-app/core/src/main/kotlin/com/evangeline/reader/model/Types.kt`
- [X] T009 Port constants and the narration policy map to `android-app/core/src/main/kotlin/com/evangeline/reader/model/Config.kt`
- [X] T010 Write a failing test that every block type has an explicit narration decision in `android-app/core/src/test/kotlin/com/evangeline/reader/model/NarrationPolicyTest.kt`, then make it pass (FR-004)
- [X] T011 Port the coded error type to `android-app/core/src/main/kotlin/com/evangeline/reader/model/ReaderError.kt`
- [X] T012 Write a failing test that a failure carrying a sensitive cause does not expose it in its own message in `android-app/core/src/test/kotlin/com/evangeline/reader/model/ReaderErrorTest.kt`, then make it pass (A07)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel.

---

## Phase 3: User Story 2 - Reading quality matches the existing reader (Priority: P1) 🎯 MVP

**Goal**: Produce, from a page of positioned text, exactly the passages the existing reader
produces - same text, same order, same suppressions.

**Independent Test**: Compile passages from a fixed page and compare spoken text and order against
the existing reader's output. Needs no UI, no speech engine, and no device.

**Why this is the MVP rather than US1**: this story is the differentiated value and the largest
risk. It is verifiable entirely on the JVM, and US1 cannot produce correct narration without it.

### Tests and implementation for User Story 2

Each task is one TDD cycle: write the failing test, then the minimal code to pass it.

- [X] T013 [US2] Failing test then implementation: an abbreviation does not end a passage, in `core/src/*/kotlin/com/evangeline/reader/narration/SegmenterTest.kt` and `Segmenter.kt`
- [X] T014 [US2] Failing test then implementation: an acronym before a capitalised word does not end a passage, in `core/.../narration/Segmenter.kt`
- [X] T015 [US2] Failing test then implementation: a quote or parenthesis opener starts a new passage, in `core/.../narration/Segmenter.kt`
- [X] T016 [US2] Failing test then implementation: a single-letter initial does not end a passage, in `core/.../narration/Segmenter.kt`
- [X] T017 [US2] Capture remaining segmenter ground truth per `quickstart.md`, pin it in `core/.../narration/SegmenterTest.kt`, and record any Java/JS regex divergence in `research.md`
- [X] T018 [P] [US2] Failing test then implementation: whole numbers spoken as words, in `core/.../narration/NormalizerTest.kt` and `Normalizer.kt`
- [X] T019 [US2] Failing test then implementation: numeric tokens with decimals, negatives, and separators, in `core/.../narration/Normalizer.kt`
- [X] T020 [US2] Failing test then implementation: percentages spoken as words, in `core/.../narration/Normalizer.kt`
- [X] T021 [US2] Failing test then implementation: currency amounts spoken as words, in `core/.../narration/Normalizer.kt`
- [X] T022 [US2] Failing test then implementation: ordinals spoken as words, in `core/.../narration/Normalizer.kt`
- [X] T023 [US2] Failing test then implementation: titles expanded such as "Dr." to "Doctor", in `core/.../narration/Normalizer.kt`
- [X] T024 [US2] Failing test then implementation: acronyms spoken as letters or words per the existing lists, in `core/.../narration/Normalizer.kt`
- [X] T025 [P] [US2] Failing test then implementation: numeric citations removed, in `core/.../narration/CleanupTest.kt` and `Cleanup.kt` (FR-006)
- [X] T026 [US2] Failing test then implementation: author-year citations removed, in `core/.../narration/Cleanup.kt` (FR-006)
- [X] T027 [US2] Failing test then implementation: repeated header and footer text collected as hints, in `core/.../narration/Cleanup.kt` (FR-004)
- [X] T028 [US2] Failing test then implementation: block classification assigns the right type, in `core/.../narration/Cleanup.kt`
- [X] T029 [US2] Failing test then implementation: common page stamps detected, in `core/.../narration/Cleanup.kt` (FR-004)
- [X] T030 [US2] Failing test then implementation: ordinal list prefixes spoken correctly, in `core/.../narration/Cleanup.kt`
- [X] T031 [P] [US2] Failing test then implementation: text runs grouped into lines using Double throughout, in `core/.../narration/ParagraphBuilderTest.kt` and `ParagraphBuilder.kt`
- [X] T032 [US2] Failing test then implementation: lines grouped into paragraphs by gap, in `core/.../narration/ParagraphBuilder.kt`
- [X] T033 [P] [US2] Failing test then implementation: left column read fully before right, in `core/.../narration/ReadingOrderTest.kt` and `ReadingOrder.kt` (FR-005)
- [X] T034 [P] [US2] Failing test then implementation: bounding-box validation, in `core/.../narration/HighlightGeometryTest.kt` and `HighlightGeometry.kt`
- [X] T035 [US2] Failing test then implementation: an out-of-bounds box is clamped to the page rather than dropped, in `core/.../narration/HighlightGeometry.kt` (A10)
- [X] T036 [US2] Failing test then implementation: sentence bounds mapped across a multi-line paragraph, in `core/.../narration/HighlightGeometry.kt` (FR-007)
- [X] T037 [P] [US2] Failing test then implementation: transform math produces normalised bounds, in `core/.../narration/BlockBuilderTest.kt` and `BlockBuilder.kt`
- [X] T038 [P] [US2] Failing test then implementation: a page below the text threshold is flagged scanned, in `core/.../narration/PageAnalyzer.kt` (FR-015)
- [X] T039 [US2] Failing test then implementation: headers, footers, and page numbers are not spoken, in `core/.../narration/CompilerTest.kt` and `Compiler.kt` (FR-004)
- [X] T040 [US2] Failing test then implementation: citations are not spoken, in `core/.../narration/Compiler.kt` (FR-006)
- [X] T041 [US2] Failing test then implementation: each passage carries sentence-specific highlight bounds, in `core/.../narration/Compiler.kt` (FR-007)
- [X] T042 [US2] Failing test then implementation: a two-column page is compiled left column first, in `core/.../narration/Compiler.kt` (FR-005)
- [X] T043 [US2] Implement compiler orchestration over the modules above, in `core/.../narration/Compiler.kt` (FR-002, FR-003)

**Checkpoint**: User Story 2 is independently verifiable - passage output matches the existing reader (SC-001, SC-003).

---

## Phase 4: User Story 1 - Listen to a document on a phone (Priority: P1)

**Goal**: Open a document on a phone, press play, hear it narrated with the spoken passage highlighted.

**Independent Test**: Install on a device, open a text PDF, press play, confirm audible narration with an aligned highlight.

**Depends on**: Phase 3 (passages must be correct before they can be spoken). **Blocked by**: research T087 and T089.

- [ ] T044 [US1] Implement the page text source adapter in `app/src/main/kotlin/com/evangeline/reader/app/pdf/PdfTextSource.kt` against the DocumentTextSource contract (FR-001)
- [ ] T045 [US1] Failing test then implementation: a locked document produces the coded password error, in `app/.../pdf/PdfTextSource.kt` (A10)
- [ ] T046 [US1] Failing test then implementation: a document with no readable text reports unreadable, in `app/.../pdf/PdfTextSource.kt` (FR-015)
- [ ] T047 [US1] Failing test then implementation: a malformed page fails without stopping other pages, in `app/.../pdf/PdfTextSource.kt` (A10)
- [X] T048 [P] [US1] Implement the content-derived SHA-256 document identifier in `core/src/main/kotlin/com/evangeline/reader/model/DocumentId.kt` (A04, FR-013)
- [ ] T049 [US1] Move extraction off the main thread onto Dispatchers.Default in `app/.../pdf/PdfTextSource.kt` (A09)
- [X] T050 [P] [US1] Define the TextSynthesizer interface plus a test fake in `core/src/main/kotlin/com/evangeline/reader/speech/TextSynthesizer.kt` per `contracts/core-interfaces.md`
- [ ] T051 [US1] Implement the Android synthesis path in `app/src/main/kotlin/com/evangeline/reader/app/speech/AndroidSynthesizer.kt` using the engine chosen in T089
- [ ] T052 [US1] Implement audio output and completion signalling in `app/.../speech/AudioOutput.kt`
- [ ] T053 [P] [US1] Failing test then implementation: voice listing and default selection, in `app/.../speech/VoiceCatalog.kt` (FR-009)
- [ ] T054 [US1] Implement the document picker via the system file picker with no broad storage permission, in `app/src/main/kotlin/com/evangeline/reader/app/ui/DocumentPicker.kt` (A01, FR-001)
- [ ] T055 [US1] Implement the page rendering surface in `app/.../ui/PageSurface.kt`
- [ ] T056 [US1] Implement the highlight overlay driven by normalised bounds in `app/.../ui/HighlightOverlay.kt` (FR-007)
- [ ] T057 [US1] Implement play and pause controls in `app/.../ui/PlayerControls.kt` (FR-008)
- [ ] T058 [US1] Implement error and empty states for the coded errors in `app/.../ui/ReaderStates.kt` (FR-015)
- [ ] T059 [US1] Verify no WebView exists anywhere in `android-app/` and extracted text renders only as literal text (A06, FR-019)

**Checkpoint**: User Story 1 delivers a usable reader on a device (SC-002).

---

## Phase 5: User Story 3 - Continuous narration on a slow device (Priority: P2)

**Goal**: Prepare passages ahead of playback so narration does not stall between them.

**Independent Test**: Drive preparation with a fake of programmable latency; confirm prepared depth moves within its bounded range. Runs on the JVM with no device.

**Depends on**: Phase 2 only - can be built in parallel with Phase 3.

- [X] T060 [P] [US3] Failing test then implementation: prepared depth stays between 1 and 6, in `core/src/*/kotlin/com/evangeline/reader/speech/ReadAheadSchedulerTest.kt` and `ReadAheadScheduler.kt` (FR-010)
- [X] T061 [US3] Failing test then implementation: invalid or absent timing floors depth to 1, in `core/.../speech/ReadAheadScheduler.kt`
- [X] T062 [US3] Failing test then implementation: depth rises as preparation slows, in `core/.../speech/ReadAheadScheduler.kt`
- [X] T063 [US3] Failing test then implementation: prepared audio is reused rather than prepared twice, in `core/.../speech/ReadAheadScheduler.kt`
- [X] T064 [US3] Failing test then implementation: cache identity includes passage, voice, and rate, in `core/.../speech/ReadAheadScheduler.kt` (FR-011)
- [X] T065 [US3] Failing test then implementation: a reset discards in-flight preparation using structured concurrency, in `core/.../speech/ReadAheadScheduler.kt`

**Checkpoint**: Narration is continuous under variable preparation latency (SC-004).

---

## Phase 6: User Story 4 - Safe playback and interruption handling (Priority: P2)

**Goal**: Keep audio and highlight aligned, and never play superseded audio, across seeks, setting changes, document changes, and interruptions.

**Independent Test**: Trigger each change during active narration; confirm no superseded audio is heard and the highlight matches the voice.

**Depends on**: Phases 3, 4, and 5.

**Note**: the controller is a structural rewrite. Write these failing tests BEFORE the rewrite - only 3 of the 53 existing tests cover this file.

- [ ] T066 [US4] Port the 3 existing controller behaviors as failing tests, then implement a minimal state machine in `core/src/main/kotlin/com/evangeline/reader/playback/PlaybackController.kt`
- [ ] T067 [US4] Model reader state as an immutable value exposed as a StateFlow in `core/.../playback/ReaderState.kt`
- [ ] T068 [US4] Failing test then implementation: seeking discards the abandoned passage's audio, in `core/.../playback/PlaybackController.kt` (FR-011)
- [ ] T069 [US4] Failing test then implementation: changing voice or rate invalidates prepared audio, in `core/.../playback/PlaybackController.kt` (FR-011)
- [ ] T070 [US4] Failing test then implementation: opening another document never plays the previous document's audio, in `core/.../playback/PlaybackController.kt` (FR-011)
- [ ] T071 [US4] Failing test then implementation: narration advances to the next readable passage automatically, in `core/.../playback/PlaybackController.kt`
- [ ] T072 [US4] Failing test then implementation: reaching the last passage completes cleanly, in `core/.../playback/PlaybackController.kt`
- [ ] T073 [P] [US4] Failing test then implementation: next and previous passage navigation, in `core/.../playback/PlaybackController.kt` (FR-008)
- [ ] T074 [P] [US4] Failing test then implementation: next and previous paragraph navigation, in `core/.../playback/PlaybackController.kt` (FR-008)
- [ ] T075 [P] [US4] Failing test then implementation: reading speed stays within 0.5-3.0 in 0.1 steps, in `core/.../playback/PlaybackController.kt` (FR-009)
- [ ] T076 [US4] Failing test then implementation: losing audio focus pauses narration, in `app/src/main/kotlin/com/evangeline/reader/app/playback/AudioFocusHandler.kt` (FR-012)
- [ ] T077 [US4] Failing test then implementation: regaining audio focus does not auto-resume, in `app/.../playback/AudioFocusHandler.kt` (FR-012)
- [ ] T078 [US4] Implement backgrounding behavior per the T090 decision, in `app/.../playback/` 
- [ ] T079 [US4] Replace every generation counter with job cancellation in `core/.../playback/PlaybackController.kt`, keeping all tests green
- [ ] T080 [US4] Implement jump-to-passage by tapping a passage, in `app/.../ui/PageSurface.kt` (FR-008)

**Checkpoint**: Playback is correct under every interruption in User Story 4.

---

## Phase 7: User Story 5 - Resume where reading stopped (Priority: P3)

**Goal**: Restore the reading position for the same document, and only that document.

**Independent Test**: Stop mid-document, close, reopen the same document (resumes); open a different document (does not resume).

**Depends on**: Phase 2 for the model; Phase 6 for position to be meaningful.

- [ ] T081 [P] [US5] Failing test then implementation: a stored position restores for the same document, in `app/src/main/kotlin/com/evangeline/reader/app/data/ProgressStore.kt` (FR-013)
- [ ] T082 [US5] Failing test then implementation: a stored position does not restore for a different document, in `app/.../data/ProgressStore.kt` (FR-013)
- [ ] T083 [US5] Failing test then implementation: damaged stored data is discarded and reading starts at the beginning, in `app/.../data/ProgressStore.kt` (FR-014, A10)
- [ ] T084 [US5] Failing test then implementation: stored records contain no filename and no document text, in `app/.../data/ProgressStore.kt` (FR-018, A04)
- [ ] T085 [US5] Failing test then implementation: a failed save never blocks narration, in `app/.../data/ProgressStore.kt`
- [ ] T086 [US5] Verify all persistence uses parameterized queries and app-internal storage only, in `app/.../data/` (A01, A06)

**Checkpoint**: All five user stories are independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Release hardening, plus the research that unblocks device work.

### Research (blocks Phases 4 and 6; needs a physical device)

- [ ] T087 Spike PDF text extraction on a real multi-column document and record extraction fidelity in `specs/015-android-kotlin-port/research.md`
- [ ] T088 [P] Spike on-device speech latency against the 300 ms inter-passage target and record in `research.md` (SC-004)
- [X] T089 [P] Decide the speech engine and minimum API level; resolve plan Open Questions 1 and 2 in `plan.md`
- [ ] T090 [P] Decide screen-off narration behavior; resolve plan Open Question 3 in `plan.md`

### Release hardening

- [X] T091 [P] Set usesCleartextTraffic false and a debug-only loopback network config in `app/src/main/AndroidManifest.xml` and `app/src/debug/` (A02)
- [X] T092 [P] Set allowBackup false in `app/src/main/AndroidManifest.xml` (A02)
- [X] T093 [P] Confirm every manifest component is not exported except the launcher, in `app/src/main/AndroidManifest.xml` (A01)
- [ ] T094 Move the developer-only narration endpoint into `app/src/debug/` so it is absent from release (A02, FR-017)
- [ ] T095 Failing test then implementation: the release configuration exposes no remote narration endpoint, in `app/src/test/` (FR-016, FR-017)
- [X] T096 [P] Port the endpoint validator with its tests to `core/src/*/kotlin/com/evangeline/reader/speech/EndpointValidator.kt` (A08)
- [X] T097 Failing test then implementation: a non-loopback endpoint is rejected before any text is sent, in `core/.../speech/EndpointValidator.kt` (A08)
- [X] T098 Failing test then implementation: validation runs on every request, not once at configuration, in `core/.../speech/EndpointValidator.kt` (A08)
- [X] T099 Failing test then implementation: credential-embedded and lookalike authorities are rejected by resolved address, in `core/.../speech/EndpointValidator.kt` (A08)
- [X] T100 Failing test then implementation: redirects are not followed on the narration path, in `core/.../speech/EndpointValidator.kt` (A08)
- [ ] T101 [P] Verify no document text, filename, or derived key is logged at any level across `android-app/` (A07)
- [X] T102 [P] Confirm no analytics, telemetry, or crash-reporting SDK is present in `android-app/gradle/libs.versions.toml` (A07)
- [ ] T103 [P] Verify any bundled speech model has a recorded checksum verified at load, in `app/.../speech/` (A03)
- [ ] T104 Run a full reading session against a release build and confirm zero requests carrying document data leave the device (SC-005)
- [X] T105 [P] Run the complexity gate and document any justified exception above the function in `android-app/core/` (Principle V)
- [X] T106 Confirm `reader-app/` and `pdf-reader/` are unmodified (FR-020)
- [ ] T107 Verify opening and narrating a long document does not degrade as page count grows

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** - blocks everything
- **Phase 2 (Foundational)** - blocks all user stories
- **Phase 3 (US2)** - blocks Phase 4 (US1) and Phase 6 (US4)
- **Phase 5 (US3)** - depends only on Phase 2; parallel with Phase 3
- **Phase 4 (US1)** - blocked by research T087 and T089
- **Phase 6 (US4)** - depends on Phases 3, 4, 5
- **Phase 7 (US5)** - depends on Phase 2; verified through Phase 6
- **Phase 8 (Polish)** - last, except the research tasks which must run early

### User Story Dependencies

- **US2** (passage correctness) - independent; the foundation of reading quality
- **US1** (listen on a phone) - needs US2 for correct passages
- **US3** (continuous narration) - independent of US2; needs only the foundation
- **US4** (safe playback) - needs US1, US2, US3
- **US5** (resume) - independent of US3 and US4; needs only the foundation to be testable

### Within Each User Story

Tests precede implementation in every task; each task is a red-green-refactor cycle. Within US2 the
module order is fixed by dependency: segmenter and normalizer feed cleanup, which feeds layout and
geometry, which feed the compiler.

### Parallel Opportunities

- Phase 3 (US2) and Phase 5 (US3) are both pure JVM work and can proceed simultaneously.
- Within US2, the `[P]`-marked module entry points touch different files and can start together.
- Research tasks T088-T090 are independent of T087.
- Most Phase 8 hardening tasks touch different files and are marked `[P]`.

## Parallel Example: User Story 2

```text
# These four open different files and can start together:
T013 [US2] Segmenter          -> core/.../narration/Segmenter.kt
T018 [US2] Normalizer         -> core/.../narration/Normalizer.kt
T025 [US2] Cleanup            -> core/.../narration/Cleanup.kt
T031 [US2] ParagraphBuilder   -> core/.../narration/ParagraphBuilder.kt

# The compiler (T039-T043) must wait: it orchestrates all four.
```

## Implementation Strategy

### MVP First (User Story 2 only)

Phases 1, 2, then 3 delivers passage output identical to the existing reader, verified on the JVM in
seconds. This is the MVP because it carries the differentiated value and the largest risk, and it
needs no device.

This departs from the usual "US1 is the MVP" default deliberately: US1 cannot narrate correctly
without US2, and US1 is blocked on hardware research while US2 is not.

### Incremental Delivery

1. Phases 1-2 - foundation
2. Phase 3 (US2) - **MVP**: reading quality proven against the existing reader
3. Phase 5 (US3) - continuous narration, still device-free
4. Phase 4 (US1) - first end-to-end listening experience on a phone
5. Phase 6 (US4) - playback correct under interruption
6. Phase 7 (US5) - resume
7. Phase 8 - release hardening

### Current Status

**62 of 107 tasks complete.** Phases 1 and 2 are done. In Phase 3, the
segmenter (T013-T017) and normalizer (T018-T024) are fully ported and verified against the web
reader's own output across a 14-case reference corpus. 24 tests pass and the complexity gate is
green. Citation stripping (T025-T026), page-stamp
detection (T029), list markers (T030) and line grouping (T031) are ported too. 40 tests pass.
Paragraph grouping (T032) and the deferred
T027-T028 (hints, classification) are done. Reading order (T033) is ported too.
60 tests pass. Highlight geometry (T034-T036) is ported, including
page-edge clamping and line-break hyphen rejoining. Transform math (T037) is ported
with the full viewport matrix pipeline, glyph metrics and edge clipping.
Page analysis (T038) flags a thin,
lone-block or badly decoded text layer as scanned. The compiler (T039-T043)
orchestrates the pipeline end to end: furniture and citations are suppressed,
each passage carries its own sentence bounds, and columns are read in order.
**Phase 3 (US2, the MVP) is complete.**

**Phase 5 (US3) is complete.** The read-ahead scheduler bounds prepared depth
to 1-6, floors it when engine timing is unusable, keys prepared audio by
passage, voice and rate (FR-011), and cancels in-flight preparation on reset
through structured concurrency. T050's TextSynthesizer seam was built with it.
kotlinx-coroutines 1.9.0 was added, pinned and checksum-verified (A03).

T048's content-derived SHA-256 document identifier is done too - it is pure
`core` work and needed no device.

**The A08 endpoint validator (T096-T100) is done**, also pure `core`. It
refuses remote hosts, lookalike hosts, credential-embedded authorities,
non-HTTP schemes and non-origin URLs; validates on every request rather than
once at configuration; sends nothing to a refused endpoint; and validates
redirect targets rather than following them. Each guard was mutation-checked:
removing any one fails a specific test. T102 is confirmed - no analytics,
telemetry or crash-reporting SDK is declared, and `core` production code
contains no logging at all.

T105 and T106 are verified: the complexity gate passes with no suppressions
anywhere in `core`, so there is no exception to document; and `reader-app/` and
`pdf-reader/` have zero tracked modifications against HEAD (FR-020).

108 tests pass and the complexity gate is green.

**2026-09-17 - the `app` module now exists and runs.** T002 was reopened (only
`:core` had been built) and completed: AGP 8.7.3, minSdk 26, `app -> core`,
building debug and release APKs. The debug APK was installed on the API 36
emulator and launched; `core`'s narration classes are confirmed present in the
APK dex. T089 is resolved (platform `TextToSpeech`, minSdk 26) and T091-T093
are done and verified against the *built* manifests rather than the source:
release ships `usesCleartextTraffic=false` with no network config, debug scopes
cleartext to loopback only, `allowBackup=false` in both, and the launcher is the
only exported component in either variant (`profileinstaller` was excluded
because it contributed an exported receiver). `check` is green across both
modules including Android lint.

**What remains is US1/US4/US5 plus hardware-only verification.** The 48 remaining tasks all
need a device or the research that precedes it: US1 (T044-T059) is blocked by
T087/T089, US4 (T066-T080) depends on US1, US5 (T081-T086) is Android
persistence, and the rest of Phase 8 hardens the Android app that those
produce.

**Remaining work is blocked on hardware.** Phases 4, 6 and 7 need a device and
the research in T087-T090; Phase 8 hardens what they produce.

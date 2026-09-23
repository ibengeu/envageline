# Implementation Plan: Android Kotlin Port

**Branch**: `015-android-kotlin-port` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-android-kotlin-port/spec.md`

## Summary

Deliver the Evangeline listening experience as a native Android application, reproducing the
reading quality of the existing web reader exactly (SC-001, SC-003) while running entirely
on-device (SC-005).

The technical approach follows one line already present in the TypeScript source: **pure passage
logic versus platform I/O**. The pure half — segmentation, normalization, citation cleanup, reading
order, highlight geometry, and the adaptive read-ahead scheduler — is roughly 2,600 lines that port
almost mechanically into a dependency-free Kotlin module testable on the JVM. The platform half —
PDF extraction, speech synthesis, audio output, storage — is rewritten against Android APIs behind
interfaces the pure half already defines.

The existing suite of 53 behavior tests is the executable definition of reading quality and is
ported **first**, before the code it describes (Constitution Principle III). One file,
`controller.ts`, is a structural rewrite rather than a transliteration: its generation-counter
cancellation has no place in a language with structured concurrency, so its guarantees are pinned
by tests and its mechanism discarded.

## Security Review *(mandatory — Constitution Principle IV)*

This feature introduces a new runtime platform that parses untrusted user documents, stores derived
state, synthesizes speech, and (during bring-up only) may make network requests. All ten OWASP Top
10:2025 categories are assessed below. This section precedes implementation, per Principle IV and
the Development Workflow section of the constitution.

### A01:2025 – Broken Access Control

**Applicable — low.** No accounts, no multi-user surface, no server-side resources, so classic IDOR
does not arise. The relevant control is inter-app access: document content and reading state must
not be readable by other applications on the device.

**Mitigations**:

- All persisted state written to app-internal storage; no world-readable paths, no external storage.
- Documents opened through the system file picker with a user-granted URI; no broad storage
  permission requested.
- No exported components — every activity, service, provider, and receiver declares
  `android:exported="false"` unless a launcher entry requires otherwise.
- The playback foreground service accepts no external intent commands that could drive narration
  from another app.

### A02:2025 – Security Misconfiguration

**Applicable.** A misconfigured release build is the most likely way this port breaks the project's
privacy promise (Principle I).

**Mitigations**:

- `android:usesCleartextTraffic="false"` in release, with a network security config permitting
  cleartext for loopback in debug only.
- The developer-only narration endpoint (FR-017) lives in a debug-only source set, so it is not
  compiled into release at all. A behavior test asserts release exposes no remote endpoint.
- `android:allowBackup="false"` — reading state and cached document data must not reach cloud backup.
- Logging of extracted document text prohibited in all build types.

### A03:2025 – Software Supply Chain Failures

**Applicable — high.** A PDF parser and possibly a speech runtime are third-party code handling
untrusted input. The constitution requires pinned, vendored dependencies rather than CDN fetches.

**Mitigations**:

- Every dependency pinned to an exact version in a Gradle version catalog; no dynamic versions.
- Gradle dependency verification with SHA-256 checksums, so a substituted artifact fails the build.
- A bundled speech model ships as a pinned in-repo asset with a recorded checksum verified at load —
  never downloaded at runtime from an unpinned source.
- Dependency set kept deliberately small; each parsing or inference dependency justified here.

**Verified in implementation**: see `research.md` — the gate only re-verifies on a cold cache, which
constrains how CI must run it.

### A04:2025 – Cryptographic Failures

**Applicable — low.** The only cryptographic use is the content-derived document identifier
(FR-013, FR-018), mirroring the web reader's existing hash.

**Mitigations**:

- SHA-256 over document bytes via the platform provider; no custom or legacy hash.
- The derived key is stored alone — never alongside filename, extracted text, or bytes (FR-018),
  matching the constitution's requirement for content-derived identifiers.
- The hash is an identifier, not a secret; no key material is stored, so no keystore requirement.

### A05:2025 – Identification and Authentication Failures

**N/A.** No accounts, sign-in, sessions, or credentials exist, and Principle I forbids introducing
them. There is no authentication surface to fail.

### A06:2025 – Injection

**Applicable.** Extracted document text is untrusted input flowing into the UI and into speech.

**Mitigations**:

- Extracted text rendered only through text composables that draw literal strings — no markup
  interpretation path exists, satisfying FR-019.
- No `WebView` anywhere in the app, removing the web reader's XSS surface entirely rather than
  re-mitigating it.
- Persisted state uses parameterized queries; no string-concatenated SQL.
- Text sent to a debug speech endpoint travels in a structured request body, never interpolated
  into a URL or command.

### A07:2025 – Security Logging and Monitoring Failures

**Applicable — inverted.** For a local-first privacy tool the risk is logging *too much*; there is
no server to monitor.

**Mitigations**:

- Document text, filenames, and derived keys MUST NOT be logged at any level.
- Error reporting carries coded values only (`PDF_LOAD_FAILED`, `TEXT_EXTRACTION_FAILED`,
  `TTS_FAILED`, `STORAGE_FAILED`, …), never document content.
- No analytics, crash-reporting SDK, or telemetry — consistent with "no analytics, no cookies, no
  accounts".

### A08:2025 – Server-Side Request Forgery (SSRF)

**Applicable during bring-up only.** The web reader's loopback validator exists precisely for this;
the Android debug path inherits the risk.

**Mitigations**:

- The endpoint validator is ported test-first and applied before *every* request, not once at
  configuration time, as the constitution requires.
- Validation rejects by resolved address, not string prefix, so `localhost.evil.com`,
  credential-embedded authorities, and redirect-to-remote are refused.
- Redirects are not followed on the narration request path.
- Release builds contain no network narration path, making this unreachable in shipped code.

### A09:2025 – Vulnerable and Outdated Components

**Applicable.** PDF parsers are a recurring source of CVEs against malformed input.

**Mitigations**:

- Pinned versions in the version catalog with a documented review point before any upgrade.
- Parsing runs off the main thread in a bounded worker, so a hostile document degrades the reading
  session rather than the process.
- Minimum dependency surface; no general-purpose document-conversion frameworks.

### A10:2025 – Mishandling of Exceptional Conditions

**Applicable — high.** This is the category the existing codebase already annotates in its highlight
geometry, and malformed PDFs are the expected adversarial input.

**Mitigations**:

- Encrypted, corrupt, and zero-text documents fail to typed coded errors with a visible message
  (FR-015), never a crash or silent empty narration.
- Bounding-box validation and clamping ported as-is, including its rounding-slack rule, so a float
  artifact never drops the highlight for a passage being narrated.
- Corrupt persisted state discarded, reading starts from the beginning (FR-014).
- Page-level extraction failure isolates to that page; the rest of the document stays readable.
- Read-ahead synthesis failures surface through the existing failure-reporting path rather than
  stalling playback.

### Behavior-driven security tests planned (TDD)

Each written as a failing test before its implementation:

1. A narration endpoint that is not loopback is rejected before any text is sent.
2. Endpoint validation runs on every request, not only at configuration time.
3. A release configuration exposes no remote narration endpoint.
4. A stored reading position does not restore for a different document.
5. Corrupt stored state is discarded and reading starts at the beginning.
6. Persisted position records contain no filename and no extracted text.
7. An encrypted document produces a coded password error, not a crash.
8. A document with no extractable text reports unreadable rather than narrating nothing.
9. A malformed page fails without preventing other pages from being read.
10. Superseded prepared audio is never played after a document, voice, or rate change.

## Technical Context

**Language/Version**: Kotlin 2.2.20, JVM toolchain 17

**Primary Dependencies**: Jetpack Compose (UI); a pinned PDF text-extraction library exposing
per-glyph positions (NEEDS CLARIFICATION — resolved by research T002); a pinned on-device speech
path (NEEDS CLARIFICATION — resolved by research T003/T004); Room (persistence); Kotlin coroutines

**Storage**: Room database in app-internal storage; small preferences via DataStore

**Testing**: JUnit 5 + `kotlin.test` on the JVM for all domain logic (no device required);
instrumented tests only where a platform API is unavoidable

**Target Platform**: Android phones, current supported API levels (exact minimum NEEDS
CLARIFICATION — resolved by research T004)

**Project Type**: Mobile application — new `android-app/` Gradle project, sibling to the existing
web readers

**Performance Goals**: Silence between consecutive passages under 300 ms once reading is underway
(SC-004)

**Constraints**: Zero network in release builds (FR-016, SC-005); cyclomatic complexity ≤ 10 per
function (Constitution Principle V), enforced by detekt inside `check`

**Scale/Scope**: ~2,600 lines of TypeScript domain logic to port; 53 existing behavior tests to
carry across; 34 source files in the pinned reference

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Local-First Privacy | PASS | On-device parsing and synthesis; no accounts; no network in release; derived-key-only persistence (FR-013, FR-016, FR-018). |
| II. Narrow Product Surface | PASS | A new delivery target for the same job — turning a document into a good listening experience. OCR, EPUB, and sync explicitly out of scope. |
| III. Behavior-Driven TDD | PASS | 53 existing behavior tests ported before their implementations; new platform behavior developed test-first. UI composables exempt per the principle's own carve-out. |
| IV. Security Review as a Gate | PASS | The Security Review section above precedes implementation. |
| V. Simplicity & Cyclomatic Discipline | PASS | Faithful port; no speculative multiplatform abstraction (see spec Out of Scope). Complexity limit enforced mechanically by detekt, not by review alone. |

**Initial evaluation**: no violations. **Post-design re-evaluation**: no violations; the two-module
structure below is the minimum that makes the JVM test loop possible, not an added abstraction.

## Project Structure

### Documentation (this feature)

```text
specs/015-android-kotlin-port/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification (/speckit-specify output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
├── checklists/
│   └── requirements.md  # Spec quality checklist (/speckit-specify output)
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
android-app/                      # New. Sibling to the existing web readers.
├── settings.gradle.kts
├── gradle/
│   ├── libs.versions.toml        # Exact pinned versions (A03)
│   └── verification-metadata.xml # SHA-256 per artifact (A03)
├── detekt.yml                    # Complexity gate, threshold 10 (Principle V)
├── core/                         # Pure Kotlin. No Android imports. JVM-testable.
│   └── src/
│       ├── main/kotlin/com/evangeline/reader/
│       │   ├── model/            # ← core/types.ts, core/config.ts
│       │   ├── narration/        # ← segmenter, normalizer, cleanup,
│       │   │                     #   paragraph-builder, reading-order,
│       │   │                     #   compiler, highlight-geometry
│       │   ├── speech/           # ← read-ahead.ts, endpoint validator
│       │   └── playback/         # ← controller.ts, as a state machine
│       └── test/kotlin/…         # The 53 ported behavior tests
└── app/                          # Android. Compose UI, ViewModels, service, DI.
    └── src/main/kotlin/com/evangeline/reader/app/
        ├── pdf/                  # Extraction adapter → core block model
        ├── speech/               # Synthesis, audio output, audio focus
        └── data/                 # Room entities, DAOs, document store

reader-app/                       # UNCHANGED (FR-020) — the pinned reference
pdf-reader/                       # UNCHANGED (FR-020)
```

**Structure Decision**: Two Gradle modules. `core` is pure Kotlin with no Android dependency, which
is what makes SC-003's 53 behavior tests runnable on the JVM in seconds without an emulator — the
single most important property for a port whose risk is concentrated in reading-quality
regressions. `app` holds everything platform-bound. Dependencies point one way only: `app` → `core`.

This is also the cheapest path to a future multiplatform extraction, but that is a consequence, not
a goal — no multiplatform module is built here (Principle V, YAGNI).

### Mapping from the TypeScript source

| TypeScript source | Kotlin destination | Nature |
|---|---|---|
| `core/types.ts` (196) | `core/model/Types.kt` | Mechanical; string unions become enums |
| `core/config.ts` (44) | `core/model/Config.kt` | Constants, incl. narration policy map |
| `core/errors.ts` (22) | `core/model/ReaderError.kt` | Coded errors as an enum |
| `narration/segmenter.ts` (77) | `core/narration/Segmenter.kt` | **Care needed** — lookbehind regex, see Risks |
| `narration/normalizer.ts` (230) | `core/narration/Normalizer.kt` | Mechanical; number-to-words tables |
| `narration/cleanup.ts` (165) | `core/narration/Cleanup.kt` | Citation stripping, hints, classification |
| `narration/paragraph-builder.ts` (184) | `core/narration/ParagraphBuilder.kt` | Geometry grouping; `Double` throughout |
| `narration/reading-order.ts` (76) | `core/narration/ReadingOrder.kt` | Column detection |
| `narration/highlight-geometry.ts` (102) | `core/narration/HighlightGeometry.kt` | Normalized 0–1 boxes port directly |
| `narration/compiler.ts` (103) | `core/narration/Compiler.kt` | Orchestrator over the above |
| `pdf/text-extractor.ts` (225) | `core/narration/BlockBuilder.kt` + `app/pdf/` | **Split** — transform math is pure; item source is platform |
| `pdf/page-analyzer.ts` (11) | `core/narration/PageAnalyzer.kt` | Trivial |
| `speech/read-ahead.ts` (132) | `core/speech/ReadAheadScheduler.kt` | EWMA; `Promise` → `Deferred` |
| `speech/kokoro-endpoint.ts` | `core/speech/EndpointValidator.kt` | Security-critical; hardened beyond a port (A08) |
| `speech/kokoro-tts.ts` (247) | `app/speech/` | **Rewrite** — `Audio`/`Blob` have no Android analogue |
| `speech/kokoro-voice-manager.ts` | `app/speech/VoiceCatalog.kt` | Partly platform |
| `controller.ts` (626) | `core/playback/` + ViewModel | **Rewrite in structure, port in behavior** |
| `core/store.ts` (144) | `core/playback/ReaderState.kt` | Zustand store → immutable state + `StateFlow` |
| `storage/database.ts` (309) | `app/data/` Room | **Rewrite** — IndexedDB → relational |
| `workers/narration.worker.ts` (65) | Coroutine on `Dispatchers.Default` | Web Worker has no analogue |

### The controller

`controller.ts` is the one file that must not be transliterated. It is 626 lines of module-level
mutable state — `playGeneration`, `processingToken`, `speechContext`, `loopActive` — which is how a
browser module simulates cancellation. Kotlin has structured concurrency, so those counters become
job cancellation and the mutable module state becomes an immutable value in a `StateFlow`.

**This is a structural rewrite with a behavioral port.** Every observable behavior — what plays
next, what is discarded on seek, when the highlight moves, how paragraph navigation skips — is
pinned by tests before the structure changes. The generation-counter *mechanism* is discarded; the
*guarantees* it provides (User Story 4) are kept and tested. Since only 3 of the 53 existing tests
cover the controller, additional failing tests are written for the User Story 4 scenarios **before**
the rewrite, rather than porting only what exists.

### Speech

The passage pipeline is deliberately independent of the synthesis engine, and the TypeScript source
already expresses this as an interface with a fake in tests. Kotlin keeps that seam: `core` defines
the synthesizer interface, tests drive a fake, and `app` supplies the real one. The engine choice —
bundled model versus platform speech service — is settled in research and does not block the
narration or read-ahead phases.

## Phased Delivery

Phases are ordered so each ends at a verifiable state, and the highest-risk unknowns retire first.

| Phase | Deliverable | Verified by | Status |
|---|---|---|---|
| 0 | Research: extraction library with glyph positions; on-device speech path, both spiked | A written decision plus a working spike | Partial — T001 done; T002–T005 need a device |
| 1 | Gradle scaffold: `core` + `app`, version catalog, dependency verification, complexity gate | `./gradlew check` green | **Complete** |
| 2 | Model, config, and coded errors | Types compile; narration policy exhaustive | **Complete** |
| 3 | Narration port, test-first, in dependency order | All ported narration tests pass (SC-003) | In progress |
| 4 | Read-ahead scheduler + endpoint validator, test-first | Ported scheduler and validator tests pass | Not started |
| 5 | PDF extraction adapter feeding the core block model | Real document produces the same passages as the web reader (SC-001) | Blocked on T002 |
| 6 | Speech engine, audio output, audio focus | Audible narration on a device; focus loss pauses | Blocked on T003/T004 |
| 7 | Playback state machine | Ported controller tests pass; User Story 4 holds | Not started |
| 8 | Compose UI: page render, highlight, controls | Direct inspection (UI exempt per Principle III) | Not started |
| 9 | Persistence: Room, resume, corrupt-state handling | User Story 5 scenarios pass | Not started |
| 10 | Release hardening: manifest flags, no-network assertion, complexity check | SC-005, Principle V | Not started |

Phases 3 and 4 are pure JVM work — no emulator, fast cycles — and carry most of SC-003. Phase 5 is
the first point where the port can be compared end-to-end against the web reader.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Regex dialect mismatch.** `segmenter.ts` uses a JS lookbehind `(?<=[.!?])\s+(?=[“"'(A-Z])`; `normalizer.ts` and `cleanup.ts` carry more. Java regex supports lookbehind but differs in Unicode class and escaping behavior. | Wrong sentence splits — the most audible possible regression | Port segmenter tests first; add cases for quotes, parentheses, decimals; treat any divergence as a finding. **Partially retired** — see `research.md` Finding 3 |
| **PDF library gives weaker positional data than PDF.js.** The highlight depends on per-item transforms, width, and font ascent/descent. | Highlight misalignment; FR-007 at risk | Retired in Phase 0 by spiking a real document before porting (T002) |
| **On-device synthesis latency far worse than a desktop server.** Read-ahead assumes a ~9s chunk playback budget. | Stalls between passages; SC-004 at risk | Phase 0 spike measures real latency (T003); the scheduler's bounds are already adaptive, so constants may need re-tuning rather than redesign |
| **Floating-point divergence.** JS numbers are always Double; Kotlin distinguishes Float/Double and Int division truncates. | Off-by-small geometry, wrong column detection | Use `Double` throughout ported geometry; port geometry tests verbatim |
| **Controller rewrite loses an untested guarantee.** Only 3 of 53 tests cover the largest file. | Silent playback regressions | Write failing tests for User Story 4 scenarios *before* the rewrite |
| **`reader-app/` keeps moving.** It is under active development on another branch. | The port targets a stale definition | Pinned to commit `bb0c1f4`, recorded in `research.md`; re-sync is deliberate, not continuous |

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No Constitution Check violations. This section is intentionally empty.

One implementation-level deviation is recorded here for visibility, as it is a constraint a reader
of this plan will otherwise find surprising:

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Gradle daemon pinned to JDK 17 via `org.gradle.java.home` | detekt 1.23.8 embeds a Kotlin compiler environment that cannot parse the host JDK 25 version string, and it reads the daemon's JVM rather than the task's `jdkHome` | Dropping the complexity gate would violate Principle V; setting `jdkHome` or a task-level launcher does not work (the property does not exist on the Detekt task type in 1.23.x). Revisit when detekt ships a JDK 25-aware release. |

## Open Questions

1. ~~**Speech engine**~~ **RESOLVED 2026-09-17 (T089): the platform speech service.**
   Android's `TextToSpeech` with Google TTS (`com.google.android.tts`), verified present on the
   API 36 Google APIs emulator image. Rejecting a bundled neural model: it costs a large APK
   download and brings an A03 obligation to checksum-verify the model at load (T103), to buy voice
   timbre — while this port's differentiated value is reading *quality*, which lives in `core` and
   is already verified by 108 JVM tests. `TextSynthesizer` (T050) is the seam, so a bundled model
   remains a later swap rather than a rewrite.
2. ~~**Minimum API level**~~ **RESOLVED 2026-09-17 (T089): minSdk 26** (Android 8.0), compileSdk 36,
   targetSdk 36. API 26 gives `TextToSpeech.synthesizeToFile` with a `ParcelFileDescriptor` and
   `AudioAttributes`-based audio focus, which FR-012 needs.
3. **Background narration**: is narration expected to continue with the screen off? This decides
   whether the foreground service lands in Phase 6; FR-012 holds either way (T005).

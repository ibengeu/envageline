# Research: Android Kotlin Port

**Feature**: `015-android-kotlin-port` | **Status**: In progress

## T001 — Pinned source of truth

The port targets `reader-app/src/reader` as of branch `speech-chunk-buffering`, commit `bb0c1f4`
("Stop a long filename from crushing the landing layout"). Re-syncing to a later commit is a
deliberate, recorded decision — not a continuous rebase (see the `plan.md` risk table).

Scope of the pinned source: 34 files, ~4,600 lines including tests; ~2,600 lines of non-test
domain logic; 53 behavior tests across 9 test files.

## Findings from the segmenter port (T015–T017)

### Finding 1 — The short-fragment merge branch is unreachable

`narration/segmenter.ts` ends with a merge pass:

```js
if (last && part.length < 18 && !/[.!?]$/.test(last)) { /* merge */ }
```

The guard requires the previous part to end **without** a terminator. But the split that produces
these parts is `(?<=[.!?])\s+(?=[“"'(A-Z])`, which only cuts immediately after `.`, `!`, or `?`,
and abbreviations are placeholder-protected *before* the split, so a restored part still ends in
its own period. Every part therefore ends in a terminator and the condition never holds.

Verified against the TypeScript implementation directly:

| Input | Output |
|---|---|
| `The meeting ran long! Yes` | `["The meeting ran long!", "Yes"]` — not merged, despite `Yes` being 3 chars |
| `Bring pens, paper, etc. Go` | `["Bring pens, paper, etc. Go"]` — never split |
| `Ready? Yes. No.` | `["Ready?", "Yes. No."]` — the second part is one split unit, not a merge |

**Decision**: do not port the merge pass. Porting dead code would add a branch against SC-006 and
invite a test that passes vacuously. If a future input proves it reachable, it returns as its own
TDD cycle. Recorded per the spec's assumption that a test encoding an obvious defect is raised
rather than silently carried over.

### Finding 2 — Two TypeScript behaviors worth confirming as intended

Neither is ported yet; both are flagged for the T017 divergence review rather than assumed correct.

- `Fig. Two shows it. Fig. Three does not.` → returns a **single** passage. `Fig.` protection
  suppresses both boundaries, so two real sentences are narrated as one.
- `Ready? Yes. No.` → `["Ready?", "Yes. No."]`. The `(?=[“"'(A-Z])` lookahead does not re-split
  `Yes. No.` because the split is applied once, not iteratively.

Both are audible behaviors. They are currently reproduced faithfully by the Kotlin port; whether
they are *desired* is a product question for the T017 review.

### Finding 3 — Regex dialect held for the cases tested

The JS lookbehind `(?<=[.!?])\s+(?=[“"'(A-Z])` transferred to `java.util.regex` unchanged and
produced identical splits on every case probed. The curly quote `“` needed an explicit `“`
escape in the Kotlin string literal. The dialect risk in `plan.md` is **not** retired — it stands
for `normalizer.ts` and `cleanup.ts`, which carry more complex patterns.

## Implementation progress (speckit implement, 2026-09-15)

Phases 1 and 2 are complete; Phase 3 is in progress. 12 behavior tests pass on the JVM in ~2s
with no emulator, and the detekt complexity gate runs inside `check`.

### Toolchain finding — detekt cannot run on JDK 25

`detekt 1.23.8` embeds a Kotlin compiler environment that throws
`IllegalArgumentException: 25.0.3` when parsing the host JVM version, and it reads the **Gradle
daemon's** JVM, not the task's `jdkHome`. Setting `jdkHome` or a task `javaLauncher` does not help
(`javaLauncher` is not a property of the Detekt task type in 1.23.x; the property is `jdkHome`).

**Decision**: pin the Gradle daemon to the installed JDK 17 via `org.gradle.java.home` in
`gradle.properties`, and set the Kotlin toolchain to 17. This constrains the analyser's runtime
only. Revisit when detekt ships a JDK 25-aware release, at which point the daemon pin can be
dropped.

### Dependency verification is enforcing, not decorative (T008)

`gradle/verification-metadata.xml` pins SHA-256 for 117 components. Verified by corrupting a
checksum: the build **passed** on a warm cache and only failed with `--refresh-dependencies`,
which is worth knowing — a cached artifact is not re-verified on every build. CI must therefore
run with a cold cache for this gate to mean anything (A03).

### Narration policy exhaustiveness is tested, not assumed (T013)

`NARRATION_POLICY` covers every `DocumentBlockType`. A test asserts this, and it was
mutation-checked by deleting the `QUOTE` entry — the test failed as intended. Without it, a block
type added later would fall through to spoken, which is the wrong default for page furniture.

### Ground truth captured before porting

Rather than infer expected values from the TypeScript source, the TS functions were executed
directly and their output pinned as Kotlin test expectations. This surfaced two behaviors that
reading the code alone would likely have got wrong:

- `integerToWords(1_000_000)` returns the digit string `"1000000"`, not words.
- `numberToSpoken("0.50")` returns `"zero point five zero"` — trailing zeros in a fraction are
  spoken, but a fraction of *only* zeros is dropped entirely.

## Segmenter and normalizer ports complete (2026-09-15)

T013–T024 are done: the segmenter and normalizer are fully ported, verified against the web
reader's own output rather than against a reading of its source. 24 tests pass.

### Verified equivalence across a 14-case reference corpus

Every case was executed through the TypeScript segmenter and the Kotlin port, and the outputs
match exactly — including the two quirks below. The corpus is pinned in `SegmenterTest.kt` so a
regex-dialect difference surfaces as a failure rather than as a subtly worse read.

**Regex dialect risk is now retired for the segmenter.** The JS lookbehind
`(?<=[.!?])\s+(?=[“"'(A-Z])`, the initial guard `\b[A-Z]\.`, and the decimal guard `\d+\.\d+`
all transferred to `java.util.regex` unchanged. Only the curly quote needed an explicit `\u201C`
escape in the Kotlin literal. The risk still stands for `cleanup.ts`, which is not yet ported.

### Two web-reader behaviours pinned as quirks, not fixed

Both are reproduced exactly, because the port must sound identical, and both are recorded here as
open product questions:

| Input | Output | Why it is arguably wrong |
|---|---|---|
| `Fig. Two shows it. Fig. Three does not.` | one passage | `Fig.` protection suppresses both boundaries, so two sentences narrate as one |
| `Ready? Yes. No.` | `["Ready?", "Yes. No."]` | the split is applied once, not iteratively, so `Yes. No.` is never re-split |

Deciding whether to change either is a product call. Changing them would make the Android port
diverge audibly from the web reader, so it should be changed in both or neither.

### Normalizer: ordinals are deliberately not expanded

`normalizeText("The 1st item.")` returns `"The 1st item."` unchanged, and a bare number after a
title (`"See fig. 4"` → `"See figure 4"`) also stays in digits. Only money, percentages, units,
titles, quarters, and acronyms are rewritten. This was captured from the running TypeScript, not
inferred — a reasonable guess would have been that ordinals expand to "first".

### Mutation-testing the regression corpus

The 14-case corpus test was checked for vacuousness by disabling the initial-protection regex: four
tests failed, confirming the corpus genuinely constrains behaviour. This follows the earlier finding
that three segmenter tests passed without ever exercising the code they named.

## Cleanup and line grouping (2026-09-15)

T025-T026, T029-T031 are ported. 40 tests pass.

### Task ordering correction: T027/T028 depend on T031

`tasks.md` lists T027 (header/footer hints) and T028 (block classification) before T031 (line
grouping), but both take `ParagraphGroup` arguments, and `ParagraphGroup` is produced by
`groupParagraphs` — T032, built on T031's `TextLine`. They cannot be written first.

**Resolution**: T029 and T030 (`isPageNumber`, `ordinalListPrefix` — both pure string functions
with no geometry dependency) were done first, then T031. T027/T028 follow T032. No task was
skipped; the order within the phase was corrected. The dependency is worth carrying back into
`tasks.md` if it is ever regenerated.

### Ground truth captured for three more functions

| Function | Behaviour worth noting |
|---|---|
| `isPageNumber` | `"Page"` alone is false; `"- 5 -"` and `"5."` are false; the cap is 18 characters |
| `ordinalListPrefix` | numbers above twenty **drop** the marker rather than reading the numeral; `"3.NoSpace"` is not a list item because the trailing space is required |
| `groupLines` | a decorative marker set in a larger face is excluded from the line box |

### The decorative-marker rule is load-bearing

`wordBearing` filters a line's bounding box down to the runs that actually contain letters or
digits. Without it, a bullet or drop-cap set in a larger face widens the line box and the reading
highlight sits off the text. Mutation-tested by removing the filter: the test failed as intended.

This matters for FR-007 (highlight stays aligned with what is heard) and is the kind of rule that a
"faithful port" can easily drop as apparent noise.

## Paragraph grouping and classification (2026-09-15)

T027-T028 and T032 are ported; the deferred pair is resolved. 54 tests pass.

### The complexity gate caught a real violation

`classifyGroup` ported naively came out at complexity 15 for `furnitureType` and 11 for
`classifyGroup` itself - both over the constitution's limit of 10. detekt failed the build while
the behaviour test passed, which is the gate working as intended (Principle V).

Resolved by splitting furniture detection into `repeatedFurniture` (text that recurs across pages)
and `edgeFurniture` (small type at a page edge), and lifting the footnote and textual checks out of
`classifyGroup`. Behaviour is unchanged - the same test passed before and after, which is what makes
it a refactor rather than a rewrite.

This is worth noting for the rest of the port: `compiler.ts` and `controller.ts` are both denser
than `cleanup.ts`, so the same pressure will recur. The answer is decomposition, not raising the
threshold.

### `dehyphenate` is more conservative than it first appears

Joining a word split across lines requires **all** of: a prefix of at least four letters, a
lowercase continuation, and a next word that is not a common short word. Captured cases:

| Input | Output | Rule that fired |
|---|---|---|
| `"Consider the estab-"` + `"lished order"` | `"Consider the established order"` | joins |
| `"go-"` + `"ing home"` | `"go-ing home"` | prefix under four letters |
| `"multi-"` + `"the end"` | `"multi-the end"` | next word is a stopword |
| `"ends with-"` + `"Capital"` | `"ends with-Capital"` | continuation is uppercase |

Over-joining would silently corrupt a real compound, so the negative cases are pinned as carefully
as the positive one.

### Header hints drop digits before comparison

`normalizeKey` strips digits, so `"Page 12"` and `"Page 13"` both collapse to `"page"`. Without
this, running furniture would look like new text on every page and would never be suppressed
(FR-004). Pinned by a test that feeds two pages in sequence.

## Reading order (2026-09-15)

T033 is ported. 60 tests pass. `orderBlocks` splits a page at the widest gap between block centres,
then reads each column top to bottom (FR-005).

### Column detection is guarded four times over, and the guards overlap

A split is rejected unless: there are at least four blocks; the widest centre gap is at least
`COLUMN_GUTTER_MIN`; the split sits between x=0.28 and x=0.72; each side has at least two blocks;
and the two sides overlap vertically by at least 45%.

Mutation testing found that **no single guard can be isolated by a behaviour test**. Every page
shape that should not split trips several guards at once — removing any one of them individually
leaves all tests passing. Three separate attempts to construct an isolating case failed:

| Page shape | Guards that fire |
|---|---|
| 3 blocks, one far right | block count **and** two-per-column |
| 4 blocks, lone block right | two-per-column **and** vertical overlap |
| 3 blocks split 1/2 | block count **and** two-per-column |

**Decision**: pin the outcomes (each verified against the TypeScript), and say so in the test
comments rather than implying mechanism-level coverage. A mechanism-isolating test would have to
assert on internals, which Principle III forbids. The redundancy is defensible — the cost of a
false column split is reading a page in the wrong order, which is badly audible.

This is worth remembering for `compiler.ts`: overlapping guards mean a mutation-survival result
there will not necessarily indicate a missing test.

## Read-ahead depth: the task wording inverts the actual behavior

`tasks.md` T062 reads "depth rises as preparation slows". The TypeScript
(`read-ahead.ts`) does the opposite, and the Kotlin port preserves the
TypeScript:

```
depth = floor(chunkPlaybackMs / (estimatedPreparationMs / 0.9)), clamped to 1..6
```

| Preparation | Depth |
|---|---|
| 500 ms | 6 (ceiling) |
| 1500 ms | 5 |
| 4000 ms | 2 |
| 9000 ms+ | 1 (floor) |

Depth is *how many passages fit inside one passage's playback*. Fast
preparation fits many, so depth rises to the ceiling; slow preparation fits
only the next one, so depth falls to the floor. This still satisfies FR-010 and
SC-004 — continuity comes from always having the next passage ready, and
preparing further ahead on a slow device would not help, because the device
cannot produce the audio any faster.

**Decision**: preserve the TypeScript behavior. The test
(`ReadAheadSchedulerTest`) pins the real direction; T062's wording is the
error, not the code.

## Emulator as the device surrogate (2026-09-17)

An Android emulator is available and booted: AVD `Medium_Phone_API_36.1`,
API 36 (Android 16), arm64 Google APIs image, with `com.google.android.tts`
installed. The `app` module builds, installs and runs on it, and the `core`
narration classes are confirmed present in the APK's dex.

**What the emulator can settle**: T087 (PDF extraction fidelity - pure
computation, identical on emulator and hardware), all of US1/US4/US5, and the
manifest hardening tasks.

**What it cannot settle**: the emulator runs TTS on the host CPU through a
translation layer, so any latency number from it is not evidence about a phone.

| Task | Emulator verdict |
|---|---|
| T088 on-device speech latency vs 300 ms (SC-004) | **Hardware required.** Emulator timings are meaningless here. |
| T090 screen-off narration | **Hardware required.** No real Doze, audio-focus contention or OEM process-killing. |
| T104 release-build no-egress session (SC-005) | Emulator can check code paths; sign-off wants a real build on a phone. |
| T107 long-document degradation | **Hardware required.** Emulator performance profile does not transfer. |

Two emulator artifacts worth knowing, neither caused by this app: the AVD
raises a "System UI isn't responding" ANR under SwiftShader software rendering
(`mFocusedApp` stayed on `ReaderActivity` throughout, and no ANR was attributed
to our package), and `tts_default_synth` reads `null` on a fresh AVD until a
`TextToSpeech` client first initialises.

## Open — not yet researched

- **T002** PDF extraction library with per-glyph positions. Blocks Phase 5.
- **T003** On-device synthesis latency vs the scheduler's 9s chunk assumption. Blocks Phase 6.
- ~~**T004** Speech engine choice and minimum API level.~~ **Resolved (T089)**: platform `TextToSpeech`, minSdk 26. See plan Open Questions.
- **T005** Screen-off narration, which decides whether the foreground service lands in Phase 6.

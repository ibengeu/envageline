# Quickstart: Android Kotlin Port

**Feature**: `015-android-kotlin-port` | **Phase**: 1 (design) | **Date**: 2026-09-15

How to run and validate this feature. Every command below has been run in this repository.

## Prerequisites

| Requirement | Why | Verify |
|---|---|---|
| JDK 17 installed | The Gradle daemon is pinned to it (see plan Complexity Tracking) | `/usr/libexec/java_home -V` lists a 17.x |
| Android SDK (for `app` only) | Not needed for the `core` test loop | `ls ~/Library/Android/sdk/platforms` |
| A physical Android phone | Only for Phases 5–10 validation | — |

No Gradle or Kotlin install is needed — the wrapper bootstraps both.

## The fast loop (no device, no emulator)

All reading-behavior work lives in `core`, which has no Android dependency:

```bash
cd android-app
./gradlew :core:test        # behavior tests only
./gradlew :core:check       # tests + complexity gate (detekt)
```

**Expected**: green, in a couple of seconds after the first run. This is the loop used for Phases
2–4 and 7, and it is where the 53 ported behaviors are verified (SC-003).

To force a re-run when Gradle reports tasks as up to date:

```bash
./gradlew :core:check --rerun-tasks
```

## Current state

| Check | Command | Expected now |
|---|---|---|
| Behavior tests | `./gradlew :core:test --rerun-tasks` | 12 passing |
| Complexity gate | `./gradlew :core:check` | No function over complexity 10 |
| Supply-chain gate | `./gradlew :core:check --refresh-dependencies` | Passes; fails if any artifact checksum changed |

## Validating the supply-chain gate (A03)

Dependency verification only re-checks on a **cold** cache. To prove it is enforcing rather than
decorative:

```bash
cd android-app
cp gradle/verification-metadata.xml /tmp/vm.bak
# corrupt one checksum, then:
./gradlew :core:test --rerun-tasks                      # PASSES  — warm cache, not re-verified
./gradlew :core:test --rerun-tasks --refresh-dependencies  # FAILS — verification enforced
cp /tmp/vm.bak gradle/verification-metadata.xml
```

**CI must run with `--refresh-dependencies`** or a cold cache, or this gate means nothing.

## Validating reading quality against the web reader (SC-001, SC-003)

The port's correctness is defined by matching the existing reader. To capture ground truth rather
than inferring expected values from the source:

```bash
cd reader-app
cat > probe.mts <<'EOF'
import { splitSentences } from "./src/reader/narration/segmenter.ts";
console.log(JSON.stringify(splitSentences("The U.S. Senate met. It adjourned.")));
EOF
node --experimental-strip-types ./probe.mts
rm probe.mts
```

Pin whatever it prints as the expected value in the corresponding Kotlin test. This method already
surfaced two behaviors that reading the code alone would have got wrong (see `research.md`).

The probe file must be created inside `reader-app/` for its TypeScript imports to resolve, and
**must be deleted afterwards** — `reader-app/` stays unmodified (FR-020):

```bash
git status --porcelain reader-app pdf-reader | grep -v '^??'   # must print nothing
```

## Validating on a device (Phases 5–10)

Not yet runnable — blocked on research tasks T002 (extraction library) and T003/T004 (speech
engine). Once the `app` module exists:

```bash
cd android-app
./gradlew :app:installDebug
```

Then, per user story:

| Story | Validation |
|---|---|
| US1 | Open a text PDF, press play, confirm audible narration with the spoken passage highlighted |
| US2 | Compare the spoken passage sequence against the web reader for the same document — zero differences |
| US3 | Play a long document; confirm gaps between passages stay under 300 ms (SC-004) |
| US4 | Seek, change voice/rate, open another document, take a call — confirm no superseded audio is heard |
| US5 | Stop mid-document, kill the app, reopen — confirm resume; open a different document — confirm no resume |

## Validating the privacy promise (SC-005, FR-016)

With a release build installed, run a full reading session with network monitoring attached and
confirm **zero** requests carrying document content, text, or filenames leave the device.

## Where things live

```text
android-app/core/src/main/kotlin/com/evangeline/reader/   # pure logic, ported
android-app/core/src/test/kotlin/com/evangeline/reader/   # behavior tests
specs/015-android-kotlin-port/                            # this feature's documents
reader-app/src/reader/                                    # the pinned reference (do not modify)
```

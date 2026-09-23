# Implementation Plan: Kokoro Narration for the Reader App

**Branch**: `012-kokoro-reader-app-migration` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-kokoro-reader-app-migration/spec.md`

## Summary

`reader-app/` (the rebuilt TanStack Start UI, code-named "Auralis") currently narrates via
`window.speechSynthesis` in `src/reader/speech/browser-tts.ts` and
`src/reader/speech/voice-manager.ts`. This feature replaces that implementation with a
`KokoroSpeechEngine` that satisfies the same `TTSEngine` interface
(`src/reader/core/types.ts`) but sources audio from the existing local Kokoro FastAPI server
(`pdf-reader/kokoro-server/server.py`, unchanged, reached at `http://127.0.0.1:8880`). Voice
listing comes from `GET /v1/audio/voices`; synthesis comes from `POST /v1/audio/speech`;
playback of the returned WAV bytes is via the `HTMLAudioElement` API (`new Audio()` +
`URL.createObjectURL`), which natively supports pause/resume/stop semantics equivalent to
`SpeechSynthesisUtterance`'s. Every request path validates the target is a loopback address
before sending, mirroring the pattern already proven in `pdf-reader/app.js`
(`isLocalTtsEndpoint`), satisfying constitution Principle I.

## Technical Context

**Language/Version**: TypeScript 5.7 (strict), React 19.2, Node 22

**Primary Dependencies**: `reader-app`'s existing stack — no new runtime dependencies added.
Uses native `fetch` and `HTMLAudioElement`, both already available in the target browsers.

**Storage**: N/A — no persistence changes. Existing IndexedDB-backed reader storage
(`src/reader/storage/`) is untouched.

**Testing**: `node --test` via `npm test` (already wired for
`src/reader/narration/compiler.test.ts` and others); new tests follow the same
`node --experimental-strip-types --test` pattern, added to the `test` script in
`reader-app/package.json`.

**Target Platform**: Browser (desktop + mobile web), reader-app's existing TanStack
Start/Vite dev and build targets. No server-side change to `reader-app` itself; depends on
the already-running local Kokoro server as an external process the listener starts
separately (unchanged from today's `pdf-reader/` setup).

**Project Type**: Web application (frontend-only change within `reader-app/`; the Kokoro
server is an existing, unmodified backend dependency).

**Performance Goals**: No new performance target beyond parity with the current
browser-speech experience — synthesis latency is dictated by the existing Kokoro server
(already measured in `pdf-reader/app.js` comments at ~1.55s fixed + ~0.0143s/char), unchanged
here.

**Constraints**: MUST validate every narration request targets a loopback host
(`localhost`/`127.0.0.1`) before sending; MUST NOT send document text to any non-loopback
destination; MUST NOT introduce auth/database usage in `reader-app` (constitution + explicit
user scope).

**Scale/Scope**: Single-user, single-device, local-only feature. Two new/changed source
files (`browser-tts.ts` replaced by a Kokoro-backed engine, `voice-manager.ts` replaced by a
Kokoro voice-fetching module) plus their call sites and tests. No change to `pdf-reader/`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I — Local-First Privacy**: Applies directly. The new engine's only network
  calls are to the local Kokoro server. Gate: every call MUST pass a loopback-host check
  before sending, mirroring `pdf-reader/app.js`'s `isLocalTtsEndpoint`. Any failed check MUST
  short-circuit before request construction (no text serialized into a request body first).
  **Status: PASS (by design constraint carried into Phase 1 contracts).**
- **Principle II — Narrow Product Surface**: This feature is a narration-engine swap, not a
  new capability — passes the "does this make a document better to listen to?" test directly
  (real voice quality vs. OS default). No scope creep (no new settings UI beyond voice
  selection, which already exists in the current app's contract). **Status: PASS.**
- **Principle III — Behavior-Driven TDD**: All new logic (endpoint validation, voice mapping,
  playback state transitions) will be developed test-first against observable behavior
  (e.g., "a non-loopback endpoint is rejected before fetch is called", "pause halts audio and
  resume continues from the same offset"), never against internal state or the `HTMLAudioElement`
  API itself (a browser guarantee). UI-only changes (e.g., voice picker labels, if any) are
  exempt per the constitution's UI carve-out. **Status: PASS.**
- **Principle IV — Security Review as a Gate**: This plan requires and includes a Security
  Review (below) before implementation, mapped to OWASP Top 10:2025. **Status: PASS —
  Security Review section included.**
- **Principle V — Simplicity & Cyclomatic Discipline**: The new engine reuses the existing
  `TTSEngine` interface and existing `NarrationSegment`/`TTSOptions`/`TTSVoice` types; no new
  abstraction layer, no configuration surface beyond what's needed to point at the Kokoro
  server. Endpoint resolution and validation are kept as small, guard-clause-driven pure
  functions (ported from the proven `pdf-reader/app.js` pattern) to stay under complexity 10.
  **Status: PASS.**

### Security Review (Principle IV gate)

**Applicable OWASP Top 10:2025 risks:**

- **A01:2025 – Broken Access Control**: N/A — no user accounts, no server-side resources
  scoped to a user; the Kokoro server is an unauthenticated local-only tool by design (same
  as today).
- **A02:2025 – Security Misconfiguration**: Applies. Mitigation: the narration endpoint
  configuration MUST default to `http://127.0.0.1:8880` and MUST be validated as
  loopback-only before every request (not just once at startup), rejecting the request
  before any text leaves the module if validation fails.
- **A03:2025 – Software Supply Chain Failures**: N/A for this feature specifically — no new
  third-party runtime dependency is introduced (uses native `fetch`/`Audio`). The existing
  Kokoro server's own dependencies are out of scope (server is reused unchanged).
- **A04:2025 – Cryptographic Failures**: N/A — no cryptographic material or secrets involved
  in local, unauthenticated loopback requests.
- **A05:2025 – Identification and Authentication Failures**: N/A — no authentication is
  introduced or required; this feature explicitly must not activate `reader-app`'s dormant
  auth scaffolding.
- **A06:2025 – Injection**: Applies narrowly. Mitigation: narration text is sent as a JSON
  request body field (`input`), never interpolated into a URL or shell command; voice IDs
  used to build request bodies are treated as opaque strings, never used to construct file
  paths or executed.
- **A07:2025 – Logging/Monitoring Failures**: N/A — no new logging surface; failures are
  surfaced to the listener via UI state, not persisted logs, consistent with existing
  behavior.
- **A08:2025 – Mishandling of Exceptional Conditions**: Applies. Mitigation: unreachable
  server, HTTP error responses, and malformed/oversized text MUST each produce a distinct,
  clearly surfaced failure state (per spec FR-007/FR-008) rather than an indefinite pending
  state or a silent swallow — mirroring the retry/error-classification pattern already in
  `pdf-reader/app.js`'s `synthesize()`.
- **A09:2025 – SSRF**: Directly applies. Mitigation: the loopback-only validation (A02
  above) is precisely an SSRF control — it prevents the narration endpoint from ever being
  pointed at an arbitrary internal or external host via configuration or injected input.
- **A10:2025 – Vulnerable Components**: N/A for this feature — no new dependency; existing
  Kokoro server version pinning is unchanged and out of scope.

**Key behavior-driven security tests planned via TDD:**

- "A narration request to a non-loopback-configured endpoint is rejected before any network
  call is made" (A02/A09).
- "Narration text is never included in a URL or endpoint string, only in a JSON request
  body" (A06).
- "An unreachable Kokoro server produces a distinct 'unavailable' failure state without
  hanging" (A08).
- "An HTTP error response from the Kokoro server produces a distinct per-passage failure
  state, not an indefinite loading state" (A08).

## Project Structure

### Documentation (this feature)

```text
specs/012-kokoro-reader-app-migration/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
reader-app/
├── src/
│   ├── reader/
│   │   ├── core/
│   │   │   └── types.ts                  # TTSEngine, TTSVoice, TTSOptions, NarrationSegment (unchanged contract)
│   │   ├── speech/
│   │   │   ├── kokoro-tts.ts             # NEW — replaces browser-tts.ts; implements TTSEngine via Kokoro HTTP API
│   │   │   ├── kokoro-tts.test.ts        # NEW — behavior tests (loopback validation, playback state, error handling)
│   │   │   ├── kokoro-voice-manager.ts   # NEW — replaces voice-manager.ts's isSpeechSupported/loadVoices;
│   │   │   │                            # re-exports pickDefaultVoice verbatim (already generic over TTSVoice —
│   │   │   │                            # see contracts/kokoro-voice-manager.md, no reimplementation needed)
│   │   │   ├── kokoro-voice-manager.test.ts  # NEW
│   │   │   ├── browser-tts.ts            # REMOVED (superseded)
│   │   │   └── voice-manager.ts          # REMOVED (superseded)
│   │   ├── narration/                     # unchanged — compiler/segmenter/etc. are not part of this feature's seam
│   │   └── controller.ts                 # single call site constructing the TTSEngine + calling
│   │                                      # isSpeechSupported/pickDefaultVoice — updated to construct
│   │                                      # KokoroSpeechEngine and use Kokoro-backed equivalents; no other
│   │                                      # change to playback orchestration logic in this file
└── package.json                          # `test` script extended to include the two new *.test.ts files

pdf-reader/
└── kokoro-server/                        # UNCHANGED — reused exactly as-is per spec scope
```

**Structure Decision**: Single-project web application change confined to `reader-app/src/reader/speech/`.
The existing `TTSEngine` interface in `reader-app/src/reader/core/types.ts` is the seam: two
files are replaced (`browser-tts.ts` → `kokoro-tts.ts`, `voice-manager.ts` →
`kokoro-voice-manager.ts`), and their single call site, `src/reader/controller.ts` (which
constructs the engine and calls `isSpeechSupported`/`pickDefaultVoice`), is updated to use the
Kokoro-backed equivalents. No new top-level directories; no changes outside `reader-app/`.

## Complexity Tracking

*No constitution violations requiring justification — table omitted.*

## Post-Design Constitution Re-Check

*Re-evaluated after Phase 1 (data-model.md, contracts/, quickstart.md).*

- **Principle I — Local-First Privacy**: Confirmed by design — `contracts/kokoro-tts-engine.md`
  specifies loopback validation before every `fetch` in both `speak()` and `getVoices()`, with
  fail-closed behavior (reject/empty-array, never a silent pass-through). **PASS.**
- **Principle II — Narrow Product Surface**: Confirmed — no new UI surface beyond the existing
  voice picker; `data-model.md` explicitly notes no new user-facing endpoint-configuration UI.
  **PASS.**
- **Principle III — Behavior-Driven TDD**: Confirmed — `research.md`'s test strategy fakes the
  network boundary and asserts only on the public `TTSEngine`/voice-manager contract, matching
  the project's existing `narration/compiler.test.ts` convention. **PASS.**
- **Principle IV — Security Review as a Gate**: Confirmed — Security Review section above maps
  all applicable OWASP Top 10:2025 categories with concrete mitigations reflected directly in
  the two contracts. **PASS.**
- **Principle V — Simplicity & Cyclomatic Discipline**: Strengthened by design — contracts
  writing surfaced that `pickDefaultVoice` needs no reimplementation (already generic over
  `TTSVoice`), reducing the change to two new files instead of three, and no hidden retry logic
  was added (contract explicitly scopes retries as a non-goal). **PASS.**

No gate failures. Proceeding to `/speckit-tasks`.

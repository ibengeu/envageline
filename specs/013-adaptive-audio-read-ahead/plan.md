# Implementation Plan: Adaptive Audio Read-Ahead

**Branch**: `013-adaptive-audio-read-ahead` | **Date**: 2026-09-14 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-adaptive-audio-read-ahead/spec.md`

## Summary

Port the old reader's adaptive audio read-ahead behavior into `reader-app/`. The new app will
measure recent Kokoro synthesis time, prepare one to six upcoming narration segments, reuse the
prepared audio for playback, and discard stale work when the playback context changes. The port
will preserve the new app's sentence-level segment boundaries and highlight timing. It will not
change `pdf-reader/`, merge segments, or add persistent audio storage.

## Technical Context

**Language/Version**: TypeScript 5.7, Node 22, browser APIs

**Primary Dependencies**: Existing `reader-app` stack, native `fetch`, `AbortController`, and
`HTMLAudioElement`; no new runtime dependency

**Storage**: In-memory session cache only; existing IndexedDB schema remains unchanged

**Testing**: Node `--experimental-strip-types --test`, TypeScript type check, ESLint, and focused
behavior tests

**Target Platform**: Desktop and mobile browsers served by the existing local reader app

**Project Type**: Frontend web application

**Performance Goals**: Start at least one eligible upcoming synthesis before the current passage
finishes; adapt between one and six upcoming passages; retain no more than the current passage
and six upcoming passages in the active audio window

**Constraints**: Preserve segment-level highlighting and controls; validate loopback endpoints
before every request; prevent stale audio from playback; do not change `pdf-reader/`

**Scale/Scope**: One active document and one active playback context per browser tab; no persistent
audio cache or new user-facing settings

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I — Local-First Privacy**: PASS. Read-ahead calls the existing Kokoro engine. The
  engine validates loopback endpoints before sending narration text.
- **Principle II — Narrow Product Surface**: PASS. The feature improves document listening and
  adds no new user-facing setting or service.
- **Principle III — Behavior-Driven TDD**: PASS. Pure timing, request reuse, bounded look-ahead,
  stale-context, and playback behavior will use public-contract tests in small red-green cycles.
- **Principle IV — Security Review as a Gate**: PASS. The Security Review below covers all OWASP
  Top 10:2025 categories and NIST SSDF alignment.
- **Principle V — Simplicity & Cyclomatic Discipline**: PASS. The scheduler has focused functions
  for timing, keying, pruning, and request reuse. Each function will stay at complexity 10 or less.

**Initial gate result**: PASS.

## Security Review

### Applicable OWASP Top 10:2025 categories

- **A02:2025 — Security Misconfiguration**: Applies. A read-ahead path could bypass the existing
  endpoint validation. Mitigation: route all synthesis through the existing loopback validation;
  add a behavior test that rejects a non-loopback endpoint before `fetch`.
- **A04:2025 — Insecure Design**: Applies. Unbounded prefetch can consume memory and stale work
  can cause incorrect playback. Mitigation: cap read-ahead at six passages, prune older entries,
  isolate playback contexts, and abort or ignore stale synthesis work.
- **A07:2025 — Injection**: Applies. Extracted PDF text and voice identifiers are untrusted input.
  Mitigation: keep text in the existing JSON request body and never interpolate it into a URL,
  command, or executable template. Test the public request boundary.
- **A09:2025 — Server-Side Request Forgery**: Applies. A configured endpoint could target a
  remote host. Mitigation: preserve loopback-only validation before every read-ahead request and
  test that no request is sent to a non-loopback host.

### N/A OWASP Top 10:2025 categories

- **A01:2025 — Broken Access Control** is not applicable. The feature adds no accounts, roles,
  ownership rules, tenant data, or protected server resource.
- **A03:2025 — Software Supply Chain Failures** is not applicable. The feature adds no dependency
  or runtime-loaded third-party code.
- **A05:2025 — Cryptographic Failures** is not applicable. The feature does not create, store, or
  transmit keys, passwords, tokens, or encrypted data.
- **A06:2025 — Identification and Authentication Failures** is not applicable. The feature does
  not add authentication, sessions, credentials, or identity verification.
- **A08:2025 — Security Logging and Monitoring Failures** is not applicable. The feature adds no
  security event logging or monitoring pipeline and will not log document text or audio data.
- **A10:2025 — Vulnerable and Outdated Components** is not applicable. No component or dependency
  changes in this feature.

### Planned behavior-focused security tests

- Reject a non-loopback read-ahead request before any network request or text transmission.
- Confirm narration text stays in the JSON body and does not alter the request URL.
- Confirm a failed or stale background request cannot change playback state.
- Confirm the read-ahead window remains bounded under fast synthesis responses.

### NIST SSDF alignment

- **PO.1 / PO.3**: record the read-ahead threat boundaries and scope in this plan.
- **PW.1 / PW.2**: design the scheduler with bounded resources, explicit context identity, and
  fail-closed endpoint validation.
- **PW.5 / PW.7**: implement small functions with behavior-focused tests and static checks.
- **RV.1**: keep the old reader unchanged and document the known failure modes for later review.

## Project Structure

### Documentation (this feature)

```text
specs/013-adaptive-audio-read-ahead/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code (repository root)

```text
reader-app/src/reader/speech/
├── kokoro-tts.ts                 # synthesis result, prepared-audio playback, cancellation
├── kokoro-tts.test.ts            # synthesis and prepared-audio behavior
├── read-ahead.ts                  # timing estimate, bounded window, request reuse
└── read-ahead.test.ts             # scheduler public behavior

reader-app/src/reader/controller.ts       # integrate read-ahead with playback
reader-app/src/reader/controller.test.ts  # playback and stale-context behavior
reader-app/src/reader/core/types.ts       # shared synthesis result/options contract if needed
reader-app/package.json                   # include the new test file
```

**Structure Decision**: Keep the scheduler beside the Kokoro speech engine. The controller owns
the active playback context and ordered segments. The old `pdf-reader/` tree is out of scope.

## TDD Plan

1. Review the existing `kokoro-tts.test.ts`, `controller.test.ts`, and old `pdf-reader/reader.test.js`.
2. Write one failing test for the bounded timing calculation. Implement the minimum pure function.
3. Write one failing test for duplicate request reuse and background error isolation. Implement the
   scheduler.
4. Write one failing test for prepared audio playback and synthesis cancellation. Extend the Kokoro
   engine with the minimum public contract.
5. Write one failing controller test that proves playback uses prepared audio and starts read-ahead.
   Integrate the scheduler.
6. Write one failing stale-context test. Add context invalidation and cleanup.
7. Run focused tests, type checking, linting, and the quickstart validation. Refactor only after the
   relevant behavior passes.

Every cycle tests observable outcomes. No test will inspect private fields, concrete call order,
or internal state.

## Implementation Notes

- Preserve `NarrationSegment` boundaries. Do not merge sentences because the new app highlights at
  segment level.
- Extend the Kokoro engine so a prepared `Blob` can be played without a second synthesis request.
- Track background synthesis controllers so stop, document changes, and playback invalidation can
  cancel owned requests. Stale completions must also be ignored by context identity.
- Use the old reader's conservative dual EWMA behavior: fast alpha `0.3`, slow alpha `0.05`, a
  nine-second playback budget, safety factor `0.9`, and bounds of one through six.
- Keep read-ahead session-scoped. Do not change the existing IndexedDB schema in this feature.
- Add concise inline OWASP comments only where a new endpoint or resource bound is enforced.

## Validation

- Run `node --experimental-strip-types --test` for all reader tests, including the new scheduler.
- Run `npm run typecheck`.
- Run ESLint on changed TypeScript and test files.
- Run `npm run build:dev`.
- Run `git diff --check`.
- Confirm no files under `pdf-reader/` change.
- Confirm loopback rejection, stale request isolation, bounded read-ahead, and playback reuse tests
  pass.

## Post-Design Constitution Re-Check

- **Principle I**: PASS. Read-ahead uses the existing validated local Kokoro path.
- **Principle II**: PASS. The feature only improves document listening.
- **Principle III**: PASS. Tests cover the public scheduler, synthesis, and controller outcomes.
- **Principle IV**: PASS. The Security Review controls are represented in the design and test plan.
- **Principle V**: PASS. The scheduler is bounded, focused, and has no speculative persistence layer.

No gate failures. Ready for task generation.

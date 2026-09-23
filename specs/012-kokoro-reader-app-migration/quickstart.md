# Quickstart: Validating Kokoro Narration in the Reader App

This is a manual/end-to-end validation guide, not an automated test suite (see
`research.md` → Decision: Test strategy for why automated tests fake the network boundary
instead of requiring a live server). Run this after implementation to confirm the feature
works end-to-end, and re-run it as a smoke check before considering the feature done.

## Prerequisites

- Local Kokoro server running and reachable at `http://127.0.0.1:8880` (the same server
  `pdf-reader/` already uses):
  ```sh
  cd pdf-reader/kokoro-server
  docker compose up
  # or, without Docker:
  # source ../.venv-kokoro/bin/activate && uvicorn server:app --host 127.0.0.1 --port 8880
  ```
- Confirm it's healthy: `curl http://127.0.0.1:8880/health` → `{"status": "ok"}`.
- `reader-app/` dependencies installed (`npm install` in `reader-app/`).

## Scenario 1 — Narration uses a Kokoro voice (User Story 1, SC-001)

1. `cd reader-app && npm run dev -- --port 5183` (use a free port — 8080 may be occupied by
   another local service; see plan's Technical Context).
2. Open the app, load a sample/local PDF, press play.
3. **Expected**: audio plays. Confirm it is Kokoro-sourced, not browser TTS, by checking the
   Network tab for a `POST http://127.0.0.1:8880/v1/audio/speech` request per spoken segment.
4. Confirm the on-screen highlight advances in sync with the audio (unchanged behavior).

## Scenario 2 — Pause / resume / stop parity (User Story 1, SC-003)

1. While playing, press pause. **Expected**: audio halts immediately.
2. Press resume. **Expected**: playback continues from the same position — no repeated or
   skipped audio.
3. Press stop. **Expected**: playback ends; no further audio from that passage plays.
4. Repeat steps 1–3 for at least 10 consecutive cycles rapidly. **Expected**: no overlapping
   audio, no stuck loading indicator, no crash (FR-010).

## Scenario 3 — Voice selection (User Story 2, SC-002)

1. Open the voice picker. **Expected**: the listed voices match
   `curl http://127.0.0.1:8880/v1/audio/voices`'s `voices` array (compare counts/ids).
2. Select a non-default voice, press play. **Expected**: the `POST /v1/audio/speech` request
   body's `voice` field matches the selected voice's id.

## Scenario 4 — Server unavailable (User Story 3, SC-004)

1. Stop the Kokoro server (`docker compose down`, or kill the `uvicorn` process).
2. In the app, press play on a document.
3. **Expected**: within 5 seconds, a clear "local narration is unavailable" message appears
   — no indefinite spinner, no crash.
4. Check the Network tab: confirm zero requests to any non-loopback host were made (FR-006,
   SC-005).

## Scenario 5 — Loopback rejection (FR-005, Security Review A02/A09)

This scenario exercises defense-in-depth and may require a temporary code change to the
configured endpoint constant for manual verification (not a normal user-reachable state,
since the endpoint isn't user-configurable in this feature per `data-model.md`):

1. Temporarily point the engine's base endpoint constant at a non-loopback value (e.g.
   `http://example.invalid:8880`).
2. Press play. **Expected**: the request is rejected before any `fetch` call is made (verify
   via Network tab — zero requests appear at all, not even a failed one), and the same
   "unavailable" message from Scenario 4 is shown.
3. Revert the temporary change.

## Automated test entry points

Once implemented, the behavior above is additionally covered by:

- `reader-app/src/reader/speech/kokoro-tts.test.ts`
- `reader-app/src/reader/speech/kokoro-voice-manager.test.ts`

Run via:

```sh
cd reader-app && npm test
```

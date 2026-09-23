# Quickstart: Adaptive Audio Read-Ahead

## Prerequisites

- Node.js 22 or a compatible project Node runtime.
- Dependencies installed in `reader-app/`.
- A local Kokoro server at `http://127.0.0.1:8880` for live playback verification.

## Focused validation

From the repository root:

```bash
cd reader-app
node --experimental-strip-types --test \
  src/reader/speech/read-ahead.test.ts \
  src/reader/speech/kokoro-tts.test.ts \
  src/reader/controller.test.ts
npm run typecheck
npx eslint src/reader/speech/read-ahead.ts src/reader/speech/read-ahead.test.ts \
  src/reader/speech/kokoro-tts.ts src/reader/speech/kokoro-tts.test.ts \
  src/reader/controller.ts src/reader/controller.test.ts
```

Expected result: all focused behavior tests pass, type checking passes, and ESLint reports no
errors.

## Live validation

From the repository root:

```bash
./start-local.sh
```

Open the printed reader URL, open a text PDF, and start local narration. The reader should request
the current and upcoming passages while playback continues. Change the rate, pause, seek, stop,
and open a second document. No old passage should begin playing after each change.

Press `Ctrl-C` in the launcher terminal after the check. The launcher must stop only the processes
it started.

## Security validation

- Run the non-loopback endpoint behavior test.
- Confirm request URLs contain only the loopback Kokoro endpoint and route names.
- Confirm request bodies contain the narration text and no logs contain that text.

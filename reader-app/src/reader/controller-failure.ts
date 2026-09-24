import { appError, logError } from "./core/errors.ts";
import { useReaderStore } from "./core/store.ts";
import { DEFAULT_KOKORO_BASE, SAME_ORIGIN } from "./speech/kokoro-endpoint.ts";

// What the listener is told, by where narration comes from: a local build
// points at the Kokoro server on their own machine; the hosted build's
// visitors have no local server to start, so they are only asked to retry.
const MESSAGES = {
  local: {
    unavailable: "Local narration is unavailable. Start the local Kokoro server and try again.",
    synthesisFailed:
      "This passage could not be synthesized. Check the local server and try again.",
  },
  hosted: {
    unavailable: "Narration is unavailable right now. Try again in a moment.",
    synthesisFailed: "This passage could not be narrated right now. Try again in a moment.",
  },
} as const;

const PLAYBACK_FAILURE_MESSAGE =
  "This passage could not be played in the browser. Press play to try again.";

function failureKind(cause: unknown): string {
  if (!(cause instanceof DOMException)) return "";
  if (cause.name !== "NotSupportedError" && cause.name !== "SecurityError") return "";
  return cause.message;
}

export function reportTtsFailure(
  cause: unknown,
  { hosted = DEFAULT_KOKORO_BASE === SAME_ORIGIN }: { hosted?: boolean } = {},
): void {
  const kind = failureKind(cause);
  const messages = hosted ? MESSAGES.hosted : MESSAGES.local;
  useReaderStore.getState().patchPlayback({ status: "error" });
  if (kind === "unavailable" || kind === "endpoint-rejected") {
    useReaderStore.getState().setError(null);
    useReaderStore.getState().setNotice(messages.unavailable);
    return;
  }
  if (kind === "synthesis-failed" || kind === "playback-failed") {
    useReaderStore.getState().setNotice(null);
    useReaderStore.getState().setError({
      code: "TTS_FAILED",
      message: kind === "synthesis-failed" ? messages.synthesisFailed : PLAYBACK_FAILURE_MESSAGE,
    });
    return;
  }
  logError("TTS_FAILED", cause);
  useReaderStore.getState().setNotice(null);
  useReaderStore.getState().setError(appError("TTS_FAILED"));
}

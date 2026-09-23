import { appError, logError } from "./core/errors.ts";
import { useReaderStore } from "./core/store.ts";

const UNAVAILABLE_MESSAGE =
  "Local narration is unavailable. Start the local Kokoro server and try again.";
const SYNTHESIS_FAILURE_MESSAGE =
  "This passage could not be synthesized. Check the local server and try again.";
const PLAYBACK_FAILURE_MESSAGE =
  "This passage could not be played in the browser. Press play to try again.";

function failureKind(cause: unknown): string {
  if (!(cause instanceof DOMException)) return "";
  if (cause.name !== "NotSupportedError" && cause.name !== "SecurityError") return "";
  return cause.message;
}

export function reportTtsFailure(cause: unknown): void {
  const kind = failureKind(cause);
  useReaderStore.getState().patchPlayback({ status: "error" });
  if (kind === "unavailable" || kind === "endpoint-rejected") {
    useReaderStore.getState().setError(null);
    useReaderStore.getState().setNotice(UNAVAILABLE_MESSAGE);
    return;
  }
  if (kind === "synthesis-failed" || kind === "playback-failed") {
    useReaderStore.getState().setNotice(null);
    useReaderStore.getState().setError({
      code: "TTS_FAILED",
      message: kind === "synthesis-failed" ? SYNTHESIS_FAILURE_MESSAGE : PLAYBACK_FAILURE_MESSAGE,
    });
    return;
  }
  logError("TTS_FAILED", cause);
  useReaderStore.getState().setNotice(null);
  useReaderStore.getState().setError(appError("TTS_FAILED"));
}

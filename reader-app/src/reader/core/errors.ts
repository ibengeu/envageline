import type { AppError, ErrorCode } from "./types.ts";

const MESSAGES: Record<ErrorCode, string> = {
  PDF_LOAD_FAILED: "This PDF could not be opened. Try another file.",
  PDF_PASSWORD_REQUIRED: "This PDF is password-protected and cannot be opened.",
  PAGE_RENDER_FAILED: "A page failed to render. You can keep reading nearby pages.",
  TEXT_EXTRACTION_FAILED: "Text could not be read from this page.",
  OCR_FAILED: "This scanned page could not be transcribed.",
  NARRATION_FAILED: "Narration could not be prepared for this page.",
  TTS_FAILED: "Speech playback failed. Try another voice.",
  STORAGE_FAILED: "Local saving is unavailable in this browser session.",
};

export function appError(code: ErrorCode, cause?: unknown): AppError {
  const suffix =
    cause instanceof Error && cause.message ? ` ${cause.message}` : "";
  return { code, message: `${MESSAGES[code]}${suffix}`.trim() };
}

export function logError(code: ErrorCode, cause?: unknown): void {
  console.warn(`[Evangeline:${code}]`, cause ?? "");
}

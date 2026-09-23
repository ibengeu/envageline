package com.evangeline.reader.model

/**
 * Coded failures surfaced to the reader.
 *
 * OWASP A07:2025 Logging Failures - the code is what gets logged and shown.
 * Document text, filenames and derived keys never appear in an error payload,
 * so a crash report cannot leak the document being read.
 */
enum class ErrorCode {
    PDF_LOAD_FAILED,
    PDF_PASSWORD_REQUIRED,
    PAGE_RENDER_FAILED,
    TEXT_EXTRACTION_FAILED,
    OCR_FAILED,
    NARRATION_FAILED,
    TTS_FAILED,
    STORAGE_FAILED,
}

/**
 * A failure the reader can present. [message] is a fixed, non-sensitive string
 * chosen by the code - never interpolated document content.
 */
data class ReaderError(
    val code: ErrorCode,
    val message: String,
)

class ReaderException(
    val code: ErrorCode,
    cause: Throwable? = null,
) : Exception(code.name, cause)

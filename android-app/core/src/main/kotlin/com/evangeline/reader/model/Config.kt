package com.evangeline.reader.model

const val APP_NAME = "Evangeline"
const val APP_TAGLINE = "Listen to any PDF."

/** Bumped when the narration pipeline changes enough to invalidate cached passages. */
const val PROCESSING_VERSION = 1

const val SCAN_TEXT_THRESHOLD = 20
const val HEADER_BAND = 0.12
const val FOOTER_BAND = 0.12
const val COLUMN_GUTTER_MIN = 0.08
const val LINE_Y_TOLERANCE = 0.45
const val PARAGRAPH_GAP_FACTOR = 1.6

const val PREFETCH_PAGES = 2
const val MAX_PREFETCH_PAGES = 6
const val VIRTUAL_PAGE_WINDOW = 2

const val MIN_ZOOM = 0.6
const val MAX_ZOOM = 2.4

const val DEFAULT_RATE = 1.0
const val MIN_RATE = 0.5
const val MAX_RATE = 3.0
const val RATE_STEP = 0.1

val RATE_PRESETS = listOf(0.75, 1.0, 1.25, 1.5, 2.0)

const val MAX_CACHED_DOCUMENTS = 6
const val MAX_CACHED_BYTES = 80L * 1024 * 1024
const val OCR_DPI = 180

/** Whether a block of a given type is spoken or silently skipped. */
enum class NarrationPolicy {
    READ,
    SKIP,
}

/**
 * Which block types reach narration.
 *
 * Kept exhaustive over [DocumentBlockType] so a newly added block type is a
 * compile error here rather than silently defaulting to spoken.
 */
val NARRATION_POLICY: Map<DocumentBlockType, NarrationPolicy> = mapOf(
    DocumentBlockType.TITLE to NarrationPolicy.READ,
    DocumentBlockType.HEADING to NarrationPolicy.READ,
    DocumentBlockType.PARAGRAPH to NarrationPolicy.READ,
    DocumentBlockType.LIST_ITEM to NarrationPolicy.READ,
    DocumentBlockType.QUOTE to NarrationPolicy.READ,
    DocumentBlockType.UNKNOWN to NarrationPolicy.READ,
    DocumentBlockType.CAPTION to NarrationPolicy.SKIP,
    DocumentBlockType.HEADER to NarrationPolicy.SKIP,
    DocumentBlockType.FOOTER to NarrationPolicy.SKIP,
    DocumentBlockType.PAGE_NUMBER to NarrationPolicy.SKIP,
    DocumentBlockType.FOOTNOTE to NarrationPolicy.SKIP,
    DocumentBlockType.TABLE to NarrationPolicy.SKIP,
    DocumentBlockType.CODE to NarrationPolicy.SKIP,
    DocumentBlockType.REFERENCE to NarrationPolicy.SKIP,
)

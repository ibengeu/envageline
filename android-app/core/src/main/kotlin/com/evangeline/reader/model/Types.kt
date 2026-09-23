package com.evangeline.reader.model

/** Where a page currently sits in the extraction and narration pipeline. */
enum class ProcessingState {
    UNPROCESSED,
    EXTRACTING,
    TEXT_READY,
    OCR_REQUIRED,
    OCR_PROCESSING,
    LAYOUT_PROCESSING,
    NARRATION_READY,
    ERROR,
}

enum class PlaybackState {
    IDLE,
    PREPARING,
    PLAYING,
    PAUSED,
    BUFFERING,
    COMPLETED,
    ERROR,
}

/** How a block of extracted text was classified by layout analysis. */
enum class DocumentBlockType {
    TITLE,
    HEADING,
    PARAGRAPH,
    LIST_ITEM,
    QUOTE,
    CAPTION,
    FOOTNOTE,
    HEADER,
    FOOTER,
    PAGE_NUMBER,
    TABLE,
    CODE,
    REFERENCE,
    UNKNOWN,
}

/** The narratable kinds a passage can take once compiled. */
enum class NarrationSegmentType {
    TITLE,
    HEADING,
    PARAGRAPH,
    LIST,
    CAPTION,
}

enum class BlockSource {
    PDF_TEXT,
    OCR,
}

/**
 * Position on a page, normalised to 0..1 in both axes so geometry is
 * independent of render scale and device density.
 */
data class BoundingBox(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
)

data class DocumentBlock(
    val id: String,
    val page: Int,
    val text: String,
    val bounds: BoundingBox,
    val fontSize: Double? = null,
    val fontName: String? = null,
    val source: BlockSource = BlockSource.PDF_TEXT,
    val confidence: Double? = null,
    val type: DocumentBlockType? = null,
)

data class SpeechShaping(
    val rateModifier: Double? = null,
    val pauseBeforeMs: Int? = null,
    val pauseAfterMs: Int? = null,
)

/**
 * One spoken unit. The unit of playback, highlight, seek and prefetch.
 *
 * [originalText] is kept alongside [spokenText] because the highlight maps to
 * glyphs on the page while narration speaks the normalised form.
 */
data class NarrationSegment(
    val id: String,
    val documentId: String,
    val page: Int,
    val type: NarrationSegmentType,
    val originalText: String,
    val spokenText: String,
    val sourceBlockIds: List<String>,
    val bounds: List<BoundingBox>,
    val order: Int,
    val paragraphId: String,
    val speech: SpeechShaping? = null,
)

data class PageMetadata(
    val page: Int,
    val width: Double,
    val height: Double,
    val rotation: Int,
)

data class DocumentMetadata(
    val title: String? = null,
    val author: String? = null,
)

data class PdfDocumentModel(
    val id: String,
    val filename: String,
    val pageCount: Int,
    val metadata: DocumentMetadata = DocumentMetadata(),
    val pages: List<PageMetadata> = emptyList(),
)

data class ExtractedPage(
    val documentId: String,
    val page: Int,
    val width: Double,
    val height: Double,
    val blocks: List<DocumentBlock>,
    val scanned: Boolean,
    val textLength: Int,
)

/** Repeated header and footer text learned across pages, used to suppress it. */
data class DocumentHints(
    val headerTexts: List<String> = emptyList(),
    val footerTexts: List<String> = emptyList(),
)

/**
 * Where reading stopped.
 *
 * FR-018: the document is identified by a content-derived key only. No
 * filename, extracted text, or document bytes are carried here.
 */
data class ReadingProgress(
    val documentId: String,
    val page: Int,
    val segmentId: String?,
    val segmentIndex: Int,
    val updatedAt: Long,
)

data class TtsVoice(
    val id: String,
    val name: String,
    val lang: String,
    val localService: Boolean,
    val isDefault: Boolean,
)

/**
 * Narration settings. Voice and rate participate in prepared-audio identity, so
 * a change to either invalidates audio prepared under the old value (FR-011).
 */
data class TtsOptions(
    val rate: Double,
    val voiceId: String?,
)

data class ReaderSettings(
    val rate: Double = DEFAULT_RATE,
    val voiceId: String? = null,
    val skipCaptions: Boolean = true,
    val skipFootnotes: Boolean = true,
    val skipReferences: Boolean = true,
)

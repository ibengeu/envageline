package com.evangeline.reader.narration

import com.evangeline.reader.model.DocumentBlockType
import com.evangeline.reader.model.DocumentHints
import com.evangeline.reader.model.ExtractedPage
import com.evangeline.reader.model.NARRATION_POLICY
import com.evangeline.reader.model.NarrationPolicy
import com.evangeline.reader.model.NarrationSegment
import com.evangeline.reader.model.NarrationSegmentType
import com.evangeline.reader.model.SpeechShaping

/** The passages a page produced, and the header and footer hints it taught. */
data class CompileResult(
    val segments: List<NarrationSegment>,
    val hints: DocumentHints,
)

private const val MIN_SPOKEN_LENGTH = 2
private const val LEAD_PAUSE_MS = 180
private const val HEADING_TAIL_PAUSE_MS = 280
private const val BODY_TAIL_PAUSE_MS = 80

private fun segmentType(type: DocumentBlockType): NarrationSegmentType = when (type) {
    DocumentBlockType.TITLE -> NarrationSegmentType.TITLE
    DocumentBlockType.HEADING -> NarrationSegmentType.HEADING
    DocumentBlockType.LIST_ITEM -> NarrationSegmentType.LIST
    DocumentBlockType.CAPTION -> NarrationSegmentType.CAPTION
    else -> NarrationSegmentType.PARAGRAPH
}

private fun isHeadingLike(type: DocumentBlockType): Boolean =
    type == DocumentBlockType.TITLE || type == DocumentBlockType.HEADING

/** A list marker is spoken as an ordinal, so "1." is heard as "First,". */
private fun listSpoken(original: String): String =
    ordinalListPrefix(original)?.spoken ?: original

private fun readableText(group: ParagraphGroup, type: DocumentBlockType): String? {
    val original = group.text.trim()
    if (original.length < MIN_SPOKEN_LENGTH) return null
    val stripped = stripCitations(original)
    val cleaned = if (type == DocumentBlockType.LIST_ITEM) listSpoken(stripped) else stripped
    return cleaned.ifBlank { null }
}

private fun shaping(type: DocumentBlockType, order: Int) = SpeechShaping(
    pauseBeforeMs = if (isHeadingLike(type) || order == 0) LEAD_PAUSE_MS else 0,
    pauseAfterMs = if (isHeadingLike(type)) HEADING_TAIL_PAUSE_MS else BODY_TAIL_PAUSE_MS,
)

private class PageCompiler(private val page: ExtractedPage) {
    private val segments = mutableListOf<NarrationSegment>()
    private var order = 0

    /**
     * Once a reference list starts, everything after it on the page is reference
     * matter until a heading begins a new section.
     */
    private var inReferences = false

    fun compile(groups: List<ParagraphGroup>, hints: DocumentHints): List<NarrationSegment> {
        for ((index, group) in groups.withIndex()) {
            val type = classifyGroup(group, groups, hints)
            if (type == DocumentBlockType.REFERENCE) inReferences = true
            if (inReferences && !isHeadingLike(type)) continue
            if (NARRATION_POLICY[type] == NarrationPolicy.SKIP) continue
            addGroup(group, type, index)
        }
        return segments.toList()
    }

    private fun addGroup(group: ParagraphGroup, type: DocumentBlockType, index: Int) {
        val cleaned = readableText(group, type) ?: return
        val sentences = splitSentences(cleaned)
        val bounds = mapSentenceBounds(
            sentences,
            group.sourceLines.map { SourceLine(it.text, it.bounds) },
        )
        val paragraphId = "${page.documentId}-p${page.page}-g$index"

        for ((sentenceIndex, sentence) in sentences.withIndex()) {
            val spoken = normalizeText(sentence)
            if (spoken.isBlank()) continue
            segments += NarrationSegment(
                id = "${page.documentId}-p${page.page}-s$order",
                documentId = page.documentId,
                page = page.page,
                type = segmentType(type),
                originalText = sentence,
                spokenText = spoken,
                sourceBlockIds = group.blocks.map { it.id },
                bounds = bounds.getOrElse(sentenceIndex) { emptyList() },
                order = order,
                paragraphId = paragraphId,
                speech = shaping(type, order),
            )
            order += 1
        }
    }
}

/**
 * Turns a page of positioned text into the passages to narrate, in reading
 * order, with the furniture suppressed (FR-002, FR-003, FR-004, FR-005).
 */
fun compilePage(page: ExtractedPage, hints: DocumentHints = DocumentHints()): CompileResult {
    val groups = groupParagraphs(groupLines(orderBlocks(page.blocks)))
    val nextHints = collectHints(groups, hints)
    return CompileResult(PageCompiler(page).compile(groups, nextHints), nextHints)
}

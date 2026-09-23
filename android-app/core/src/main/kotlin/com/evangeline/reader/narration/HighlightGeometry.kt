package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import kotlin.math.min

/** One rendered line of source text with the rectangle it occupies on the page. */
data class SourceLine(val text: String, val bounds: BoundingBox)

private data class SourceToken(val value: String, val lineIndex: Int)

/**
 * Rounding slack for normalised geometry. A rectangle that spills past the page
 * edge by less than this is a float artifact of the PDF transform, not bad data.
 */
private const val EDGE_EPSILON = 1e-6

/**
 * OWASP A10:2025 Mishandling of Exceptional Conditions - geometry derived from
 * an untrusted PDF transform is only drawable when it is finite, has area, and
 * lies on the page.
 */
internal fun BoundingBox.isDrawable(): Boolean =
    x.isFinite() && y.isFinite() && width.isFinite() && height.isFinite() &&
        x >= 0 && y >= 0 && width > 0 && height > 0 &&
        x + width <= 1 + EDGE_EPSILON && y + height <= 1 + EDGE_EPSILON

private val WORD = Regex("[\\p{L}\\p{N}]+")

private fun tokens(text: String): List<String> =
    WORD.findAll(text).map { it.value.lowercase() }.toList()

/** A word split by a line-break hyphen spans the line it starts and the next. */
private data class BrokenWord(val head: String, val lineIndex: Int)

private fun brokenWordAt(line: SourceLine, lineTokens: List<String>, index: Int): BrokenWord? =
    if (line.text.trimEnd().endsWith("-") && lineTokens.isNotEmpty()) {
        BrokenWord(lineTokens.last(), index)
    } else {
        null
    }

/**
 * A trailing hyphen breaks one word across two lines. Rejoining the halves lets
 * the whole spoken word match, and the rejoined word is recorded on both lines
 * so the highlight covers it wherever it is drawn.
 */
private fun sourceTokens(lines: List<SourceLine>): List<SourceToken> {
    val result = mutableListOf<SourceToken>()
    var broken: BrokenWord? = null
    for ((index, line) in lines.withIndex()) {
        val lineTokens = tokens(line.text)
        val pending = broken
        val rejoined = if (pending != null && lineTokens.isNotEmpty()) {
            val whole = pending.head + lineTokens.first()
            result += SourceToken(whole, pending.lineIndex)
            result += SourceToken(whole, index)
            lineTokens.drop(1)
        } else {
            lineTokens
        }
        broken = brokenWordAt(line, rejoined, index)
        val keep = if (broken == null) rejoined else rejoined.dropLast(1)
        result += keep.map { SourceToken(it, index) }
    }
    return result
}



/**
 * OWASP A10:2025 Mishandling of Exceptional Conditions - clamp drawable geometry
 * to the page instead of dropping it, so a rounding artifact never silently
 * removes the highlight of the passage being narrated.
 */
internal fun BoundingBox.clampedToPage(): BoundingBox =
    copy(width = min(width, 1 - x), height = min(height, 1 - y))

private data class Match(val bounds: List<BoundingBox>, val next: Int)

/**
 * Walks the source tokens from [start] looking for the sentence's tokens in
 * order, collecting the lines they land on.
 */
private fun matchSentence(
    sentence: String,
    source: List<SourceToken>,
    lines: List<SourceLine>,
    start: Int,
): Match {
    val wanted = tokens(sentence)
    if (wanted.isEmpty()) return Match(emptyList(), start)

    val lineIndexes = LinkedHashSet<Int>()
    var sourceIndex = start
    var wantedIndex = 0
    while (sourceIndex < source.size && wantedIndex < wanted.size) {
        val current = source[sourceIndex]
        if (current.value == wanted[wantedIndex]) {
            lineIndexes.add(current.lineIndex)
            wantedIndex += 1
        }
        sourceIndex += 1
    }
    if (wantedIndex != wanted.size) return Match(emptyList(), start)

    val bounds = lineIndexes.sorted().map { lines[it].bounds }.filter { it.isDrawable() }.map { it.clampedToPage() }
    return Match(bounds, sourceIndex)
}

/**
 * Maps each spoken sentence onto the rectangles of the source lines that carry
 * it, so the highlight follows the voice (FR-007).
 */
fun mapSentenceBounds(sentences: List<String>, lines: List<SourceLine>): List<List<BoundingBox>> {
    val source = sourceTokens(lines)
    var cursor = 0
    return sentences.map { sentence ->
        val match = matchSentence(sentence, source, lines, cursor)
        cursor = match.next
        match.bounds
    }
}

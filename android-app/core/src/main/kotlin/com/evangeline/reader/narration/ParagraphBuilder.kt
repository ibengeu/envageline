package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import com.evangeline.reader.model.DocumentBlock
import com.evangeline.reader.model.LINE_Y_TOLERANCE
import com.evangeline.reader.model.PARAGRAPH_GAP_FACTOR
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** One visual line of the page: the runs of text sharing a baseline. */
data class TextLine(
    val text: String,
    val blocks: List<DocumentBlock>,
    val bounds: BoundingBox,
    val fontSize: Double,
)

private const val FALLBACK_FONT_SIZE = 0.02
private const val SIZE_TOLERANCE = 0.45
private val WHITESPACE = Regex("\\s+")
private val WORD_CHARACTER = Regex("[\\p{L}\\p{N}]")

private fun unionBounds(boxes: List<BoundingBox>): BoundingBox {
    var minX = 1.0
    var minY = 1.0
    var maxX = 0.0
    var maxY = 0.0
    for (box in boxes) {
        minX = min(minX, box.x)
        minY = min(minY, box.y)
        maxX = max(maxX, box.x + box.width)
        maxY = max(maxY, box.y + box.height)
    }
    return BoundingBox(minX, minY, max(0.0, maxX - minX), max(0.0, maxY - minY))
}

// Decorative markers - section bullets, drop-cap rules, dingbats - are set in a
// larger face than the words beside them. Letting them into the line box pushes
// the reading highlight off the text, so the box follows the blocks that
// actually carry words whenever the line has any.
private fun wordBearing(blocks: List<DocumentBlock>): List<DocumentBlock> {
    val words = blocks.filter { WORD_CHARACTER.containsMatchIn(it.text) }
    return words.ifEmpty { blocks }
}

private fun lineBounds(blocks: List<DocumentBlock>): BoundingBox =
    unionBounds(wordBearing(blocks).map { it.bounds })

private fun joinLineText(blocks: List<DocumentBlock>): String =
    blocks
        .map { it.text.replace(WHITESPACE, " ").trim() }
        .filter { it.isNotEmpty() }
        .joinToString(" ")
        .replace(WHITESPACE, " ")
        .trim()

private fun DocumentBlock.sizeOrHeight(): Double = fontSize ?: bounds.height

private fun startLine(block: DocumentBlock) = TextLine(
    text = block.text,
    blocks = listOf(block),
    bounds = block.bounds,
    fontSize = block.sizeOrHeight(),
)

private fun BoundingBox.verticalCentre(): Double = y + height / 2

private fun joinsLine(line: TextLine, block: DocumentBlock): Boolean {
    val lastSize = if (line.fontSize == 0.0) FALLBACK_FONT_SIZE else line.fontSize
    val centreGap = abs(block.bounds.verticalCentre() - line.bounds.verticalCentre())
    val sizeGap = abs((block.fontSize ?: lastSize) - lastSize)
    return centreGap <= lastSize * LINE_Y_TOLERANCE && sizeGap <= lastSize * SIZE_TOLERANCE
}

private fun extend(line: TextLine, block: DocumentBlock): TextLine {
    val blocks = line.blocks + block
    return TextLine(
        text = joinLineText(blocks),
        blocks = blocks,
        bounds = lineBounds(blocks),
        fontSize = max(line.fontSize, block.fontSize ?: line.fontSize),
    )
}

/**
 * Groups positioned text runs into visual lines.
 *
 * A run joins the current line when its vertical centre and font size are both
 * close enough; otherwise it starts a new line. Empty lines are dropped so they
 * never become silent passages.
 */
fun groupLines(blocks: List<DocumentBlock>): List<TextLine> {
    val lines = mutableListOf<TextLine>()
    for (block in blocks) {
        val last = lines.lastOrNull()
        if (last != null && joinsLine(last, block)) {
            lines[lines.lastIndex] = extend(last, block)
        } else {
            lines.add(startLine(block))
        }
    }
    return lines.filter { it.text.isNotBlank() }
}

// Short words that follow a hyphen are usually a real compound ("state-of-the-art"),
// not a word broken across lines, so the hyphen is kept.
private val KEEP_HYPHEN_NEXT = setOf(
    "of", "the", "and", "to", "in", "for", "with", "or", "a", "an",
)

private val HYPHEN_BREAK = Regex("^(.*?)([A-Za-z]{2,})-$")
private val LEADING_WORD = Regex("^[A-Za-z']+")
private const val MIN_JOINABLE_PREFIX = 4

/**
 * Joins a line ending in a hyphen to the line after it.
 *
 * The hyphen is dropped only when the break looks like one word split across
 * lines: a prefix of at least four letters, continued by a lowercase word that
 * is not a common short word. Anything else keeps its hyphen, because removing
 * it from a real compound would change what the listener hears.
 */
fun dehyphenate(previous: String, next: String): String {
    val match = HYPHEN_BREAK.find(previous)
        ?: return if (previous.endsWith("-")) "$previous$next" else "$previous $next"

    val stem = match.groupValues[1]
    val prefix = match.groupValues[2]
    val nextWord = LEADING_WORD.find(next)?.value.orEmpty().lowercase()
    val continuesWord = next.firstOrNull()?.isLowerCase() == true &&
        prefix.length >= MIN_JOINABLE_PREFIX &&
        nextWord !in KEEP_HYPHEN_NEXT

    return if (continuesWord) "$stem$prefix$next" else "$stem$prefix-$next"
}

/**
 * A run of lines that belong together as one block of prose.
 *
 * [text] is the joined, de-hyphenated reading text; [originalParts] keeps each
 * line as it appeared, because the highlight maps to lines on the page while
 * narration speaks the joined form.
 */
data class ParagraphGroup(
    val text: String,
    val originalParts: List<String>,
    val sourceLines: List<TextLine>,
    val blocks: List<DocumentBlock>,
    val bounds: List<BoundingBox>,
    val fontSize: Double,
    val indent: Double,
)

private val LIST_START = Regex("^(?:[-•●▪]|[0-9]{1,2}[.)]|[A-Za-z][.)])\\s+\\S")
private val SENTENCE_END = Regex("[.!?]$")
private const val INDENT_BREAK = 0.08
private const val SIZE_BREAK = 0.35
private const val SHORT_LINE_WIDTH = 0.35
private const val SHORT_LINE_RATIO = 0.45

private fun looksLikeList(text: String): Boolean = LIST_START.containsMatchIn(text.trim())

// A line ending a paragraph is usually short and finishes a sentence; a line
// that fills its column is usually mid-paragraph.
private fun endsBlock(line: TextLine): Boolean =
    line.bounds.width < SHORT_LINE_WIDTH &&
        SENTENCE_END.containsMatchIn(line.text) &&
        (if (line.bounds.width == 0.0) 1.0 else line.bounds.width) < SHORT_LINE_RATIO

private fun looksLikeBreak(line: TextLine, next: TextLine): Boolean {
    val size = if (line.fontSize == 0.0) FALLBACK_FONT_SIZE else line.fontSize
    val gap = next.bounds.y - (line.bounds.y + line.bounds.height)
    return gap > size * PARAGRAPH_GAP_FACTOR ||
        abs(next.bounds.x - line.bounds.x) > INDENT_BREAK ||
        abs(next.fontSize - line.fontSize) > line.fontSize * SIZE_BREAK ||
        looksLikeList(next.text) ||
        endsBlock(line)
}

private fun startGroup(line: TextLine) = ParagraphGroup(
    text = line.text.trim(),
    originalParts = listOf(line.text.trim()),
    sourceLines = listOf(line),
    blocks = line.blocks,
    bounds = listOf(line.bounds),
    fontSize = line.fontSize,
    indent = line.bounds.x,
)

private fun extend(group: ParagraphGroup, line: TextLine) = group.copy(
    text = dehyphenate(group.text, line.text.trim()),
    originalParts = group.originalParts + line.text.trim(),
    sourceLines = group.sourceLines + line,
    blocks = group.blocks + line.blocks,
    bounds = group.bounds + line.bounds,
    fontSize = max(group.fontSize, line.fontSize),
)

/** Groups visual lines into paragraphs, joining words broken across lines. */
fun groupParagraphs(lines: List<TextLine>): List<ParagraphGroup> {
    val groups = mutableListOf<ParagraphGroup>()
    for (line in lines) {
        val last = groups.lastOrNull()
        if (last == null || looksLikeBreak(last.sourceLines.last(), line) || looksLikeList(line.text)) {
            groups.add(startGroup(line))
        } else {
            groups[groups.lastIndex] = extend(last, line)
        }
    }
    return groups
}

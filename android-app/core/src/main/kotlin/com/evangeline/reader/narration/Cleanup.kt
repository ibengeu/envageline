package com.evangeline.reader.narration

import com.evangeline.reader.model.DocumentBlockType
import com.evangeline.reader.model.DocumentHints
import com.evangeline.reader.model.FOOTER_BAND
import com.evangeline.reader.model.HEADER_BAND

// A bracketed run of numbers: "[1]", "[1, 2, 3]", "[4-6]".
private val CITATION_NUMERIC = Regex("\\[(?:\\d+(?:\\s*[,;–-]\\s*\\d+)*)]")

// A parenthesised author-year reference: "(Smith, 2020)", "(Smith & Jones, 2019)",
// "(Smith et al., 2020, p. 14)". Deliberately narrow so ordinary parentheses
// such as "(n = 42)" survive - over-stripping would silently drop real prose.
private val CITATION_AUTHOR = Regex(
    "\\((?:[A-Z][A-Za-z-]+(?:\\s+(?:et al\\.?|& [A-Z][A-Za-z-]+))?,?\\s+" +
        "\\d{4}[a-z]?(?:,\\s*p+\\.?\\s*\\d+)?)\\)",
)

// Superscript reference marks attached to a word, as in "result¹".
private val SUPER_REF = Regex("(?<=\\S)[¹²³⁴⁵⁶⁷⁸⁹⁰]+")

private val EXTRA_SPACES = Regex("\\s{2,}")
private val WHITESPACE_RUN = Regex("\\s+")
private val SPACE_BEFORE_PUNCTUATION = Regex("\\s+([,.;:!?])")

/**
 * Removes citation marks so they are not read aloud (FR-006).
 *
 * Spacing is repaired afterwards so removing a citation does not leave a gap
 * before the punctuation that followed it.
 */
fun stripCitations(text: String): String =
    text
        .replace(CITATION_NUMERIC, "")
        .replace(CITATION_AUTHOR, "")
        .replace(SUPER_REF, "")
        .replace(EXTRA_SPACES, " ")
        .replace(SPACE_BEFORE_PUNCTUATION, "$1")
        .trim()

// "12", "Page 7", "iv", "XIV", "3 / 12". Roman numerals and arabic digits, with
// an optional "page" prefix and an optional "of total" suffix.
private val PAGE_NUMBER = Regex(
    "^(?:page\\s+)?(?:[ivxlcdm]+|\\d+)(?:\\s*/\\s*\\d+)?$|^[ivxlcdm]+$|^\\d+\\s*$",
    RegexOption.IGNORE_CASE,
)

// Longer than any real page stamp; past this the text is prose that happens to
// start with a numeral.
private const val MAX_PAGE_STAMP_LENGTH = 18

/** Whether a line is a page stamp, and so must not be spoken (FR-004). */
fun isPageNumber(text: String): Boolean {
    val trimmed = text.trim()
    if (trimmed.isEmpty() || trimmed.length > MAX_PAGE_STAMP_LENGTH) return false
    return PAGE_NUMBER.matches(trimmed)
}

private val ORDINAL_WORDS = listOf(
    "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh",
    "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth", "Thirteenth",
    "Fourteenth", "Fifteenth", "Sixteenth", "Seventeenth", "Eighteenth",
    "Nineteenth", "Twentieth",
)

// "1. ", "2) ", "- ", "• " - a marker followed by whitespace. The trailing space
// is required, so "3.NoSpace" is prose, not a list item.
private val LIST_MARKER = Regex("^(?:([0-9]{1,2})[.)]|[-•●▪])\\s+(.*)$")

/**
 * A list item split into what should be spoken and the text after its marker.
 *
 * [spoken] leads with the ordinal as a word ("First, Take notes") so a listener
 * hears position without hearing punctuation. Bullets and numbers above twenty
 * drop the marker entirely rather than reading it out.
 */
data class ListPrefix(
    val spoken: String,
    val rest: String,
)

/** Returns null when the text is not a list item at all. */
fun ordinalListPrefix(text: String): ListPrefix? {
    val match = LIST_MARKER.find(text) ?: return null
    val rest = match.groupValues[2]
    val number = match.groupValues[1].toIntOrNull()
    val word = number?.let { ORDINAL_WORDS.getOrNull(it - 1) }
    return if (word != null) ListPrefix("$word, $rest", rest) else ListPrefix(rest, rest)
}

private val DIGITS = Regex("[0-9]+")
private val NON_LETTER = Regex("[^\\p{L}\\s]")

// Page furniture repeats with the page number changing, so digits are dropped
// before comparison: "Page 12" and "Page 13" must collapse to the same key.
private fun normalizeKey(text: String): String =
    text.lowercase()
        .replace(DIGITS, "")
        .replace(NON_LETTER, "")
        .replace(WHITESPACE_RUN, " ")
        .trim()

private const val MIN_HINT_LENGTH = 4
private const val MAX_FURNITURE_LENGTH = 80

private fun ParagraphGroup.inHeaderBand(): Boolean =
    bounds.minOf { it.y } < HEADER_BAND

private fun ParagraphGroup.inFooterBand(): Boolean =
    bounds.maxOf { it.y + it.height } > 1 - FOOTER_BAND

/**
 * Learns which text repeats as a running header or footer across the document,
 * so it can be suppressed from narration (FR-004).
 *
 * Hints accumulate across pages: a line is only furniture if it recurs, and a
 * caller passes the hints gathered so far back in.
 */
fun collectHints(groups: List<ParagraphGroup>, hints: DocumentHints): DocumentHints {
    val headers = hints.headerTexts.toMutableList()
    val footers = hints.footerTexts.toMutableList()
    for (group in groups) {
        val key = normalizeKey(group.text)
        if (key.length < MIN_HINT_LENGTH) continue
        if (group.text.length >= MAX_FURNITURE_LENGTH) continue
        if (group.inHeaderBand() && key !in headers) headers.add(key)
        if (group.inFooterBand() && key !in footers) footers.add(key)
    }
    return DocumentHints(headerTexts = headers, footerTexts = footers)
}

private val REFERENCE_HEADING = Regex("^(?:references|bibliography|works cited)$", RegexOption.IGNORE_CASE)
private val LIST_ITEM = Regex("^(?:[-•●▪]|[0-9]{1,2}[.)]|[A-Za-z][.)])\\s+\\S")
private val FOOTNOTE_START = Regex("^[0-9]+\\s+\\S")
private val CAPTION = Regex("^fig(?:ure)?\\.?\\s*\\d+|^table\\s+\\d+", RegexOption.IGNORE_CASE)
private val ENDS_SENTENCE = Regex("[.!?]$")

private const val SMALL_FONT_RATIO = 0.78
private const val FOOTNOTE_FONT_RATIO = 0.7
private const val TITLE_FONT_RATIO = 0.92
private const val TITLE_MEDIAN_RATIO = 1.35
private const val HEADING_MEDIAN_RATIO = 1.22
private const val TITLE_MAX_Y = 0.28
private const val HEADING_MAX_LENGTH = 90
private const val DEFAULT_FONT_SIZE = 0.02

private fun medianFont(groups: List<ParagraphGroup>): Double {
    val sizes = groups.map { it.fontSize }.sorted()
    if (sizes.isEmpty()) return DEFAULT_FONT_SIZE
    return sizes[sizes.size / 2]
}

/** Furniture recognised because this exact text repeats across pages. */
private fun repeatedFurniture(
    text: String,
    hints: DocumentHints,
    header: Boolean,
    footer: Boolean,
): DocumentBlockType? {
    val key = normalizeKey(text)
    if (key.isEmpty()) return null
    if (header && key in hints.headerTexts) return DocumentBlockType.HEADER
    if (footer && key in hints.footerTexts) return DocumentBlockType.FOOTER
    return null
}

/** Furniture recognised because it sits at a page edge in smaller type. */
private fun edgeFurniture(
    text: String,
    header: Boolean,
    footer: Boolean,
): DocumentBlockType? {
    if (text.length >= MAX_FURNITURE_LENGTH) return null
    if (header) return DocumentBlockType.HEADER
    if (!footer) return null
    return if (isPageNumber(text)) DocumentBlockType.PAGE_NUMBER else DocumentBlockType.FOOTER
}

/** Page furniture: repeated headers, footers and page stamps. Never spoken. */
private fun furnitureType(
    group: ParagraphGroup,
    text: String,
    hints: DocumentHints,
    isSmall: Boolean,
): DocumentBlockType? {
    val header = group.inHeaderBand()
    val footer = group.inFooterBand()
    if (isPageNumber(text) && (header || footer)) return DocumentBlockType.PAGE_NUMBER
    repeatedFurniture(text, hints, header, footer)?.let { return it }
    return if (isSmall) edgeFurniture(text, header, footer) else null
}

/** A heading or title, judged by font size relative to the rest of the page. */
private fun prominenceType(
    group: ParagraphGroup,
    text: String,
    all: List<ParagraphGroup>,
    median: Double,
): DocumentBlockType? {
    val largest = all.maxOfOrNull { it.fontSize } ?: group.fontSize
    if (group.fontSize >= largest * TITLE_FONT_RATIO && group.fontSize > median * TITLE_MEDIAN_RATIO) {
        val top = group.bounds.firstOrNull()?.y
        return if (top != null && top < TITLE_MAX_Y) DocumentBlockType.TITLE else DocumentBlockType.HEADING
    }
    val standsOut = group.fontSize > median * HEADING_MEDIAN_RATIO &&
        text.length < HEADING_MAX_LENGTH &&
        !ENDS_SENTENCE.containsMatchIn(text)
    return if (standsOut) DocumentBlockType.HEADING else null
}

/**
 * Decides what a paragraph group is, which in turn decides whether it is spoken
 * (FR-004). Furniture is checked first so a running header set in body-sized
 * type is still suppressed.
 */
private fun isFootnote(group: ParagraphGroup, text: String, median: Double): Boolean =
    group.inFooterBand() &&
        FOOTNOTE_START.containsMatchIn(text) &&
        group.fontSize < median * FOOTNOTE_FONT_RATIO

/** Structural kinds recognised from the text itself, independent of type size. */
private fun textualType(text: String): DocumentBlockType? = when {
    REFERENCE_HEADING.matches(text) -> DocumentBlockType.REFERENCE
    LIST_ITEM.containsMatchIn(text) -> DocumentBlockType.LIST_ITEM
    else -> null
}

/**
 * Decides what a paragraph group is, which in turn decides whether it is spoken
 * (FR-004). Furniture is checked first so a running header set in body-sized
 * type is still suppressed.
 */
fun classifyGroup(
    group: ParagraphGroup,
    all: List<ParagraphGroup>,
    hints: DocumentHints,
): DocumentBlockType {
    val text = group.text.trim()
    if (text.isEmpty()) return DocumentBlockType.UNKNOWN

    val median = medianFont(all)
    val isSmall = group.fontSize < median * SMALL_FONT_RATIO
    furnitureType(group, text, hints, isSmall)?.let { return it }
    if (isSmall && isFootnote(group, text, median)) return DocumentBlockType.FOOTNOTE
    textualType(text)?.let { return it }
    prominenceType(group, text, all, median)?.let { return it }
    if (CAPTION.containsMatchIn(text)) return DocumentBlockType.CAPTION
    return DocumentBlockType.PARAGRAPH
}

package com.evangeline.reader.narration

import com.evangeline.reader.model.DocumentBlock
import com.evangeline.reader.model.SCAN_TEXT_THRESHOLD

/** Below this, a page with a single text run is a caption on an image. */
private const val LONE_BLOCK_THRESHOLD = 40

/** Below this share of decodable characters, the text layer is noise. */
private const val MIN_DECODE_QUALITY = 0.7

private const val REPLACEMENT_CHAR = '\uFFFD'

private val NON_WORD = Regex("[^\\p{L}\\p{N}]+")

/** Letters and digits only, so punctuation and whitespace cannot pad a page out. */
internal fun meaningfulLength(blocks: List<DocumentBlock>): Int =
    blocks.joinToString(" ") { it.text }.replace(NON_WORD, "").length

/** The share of characters that decoded into something narratable. */
internal fun decodeQuality(blocks: List<DocumentBlock>): Double {
    val joined = blocks.joinToString("") { it.text }
    if (joined.isEmpty()) return 0.0
    val usable = joined.count { it != REPLACEMENT_CHAR }
    return usable.toDouble() / joined.length
}

/**
 * A page whose text layer is too thin to narrate is treated as scanned, so it
 * is sent for recognition rather than read as a handful of stray glyphs (FR-015).
 */
fun isLikelyScanned(blocks: List<DocumentBlock>): Boolean {
    val length = meaningfulLength(blocks)
    if (length < SCAN_TEXT_THRESHOLD) return true
    if (blocks.size <= 1 && length < LONE_BLOCK_THRESHOLD) return true
    return decodeQuality(blocks) < MIN_DECODE_QUALITY
}

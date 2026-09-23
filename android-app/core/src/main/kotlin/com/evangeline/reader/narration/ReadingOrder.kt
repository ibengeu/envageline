package com.evangeline.reader.narration

import com.evangeline.reader.model.COLUMN_GUTTER_MIN
import com.evangeline.reader.model.DocumentBlock
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val MIN_BLOCKS_FOR_COLUMNS = 4
private const val MIN_BLOCKS_PER_COLUMN = 2
private const val GUTTER_MIN_X = 0.28
private const val GUTTER_MAX_X = 0.72
private const val MIN_COLUMN_OVERLAP = 0.45
private const val SAME_LINE_RATIO = 0.4

private fun DocumentBlock.centreX(): Double = bounds.x + bounds.width / 2
private fun DocumentBlock.centreY(): Double = bounds.y + bounds.height / 2

/** Top to bottom, then left to right for blocks sharing a line. */
private fun sortVisual(blocks: List<DocumentBlock>): List<DocumentBlock> =
    blocks.sortedWith { a, b ->
        val dy = a.centreY() - b.centreY()
        val sameLine = abs(dy) <= min(a.bounds.height, b.bounds.height) * SAME_LINE_RATIO
        if (sameLine) a.bounds.x.compareTo(b.bounds.x) else dy.compareTo(0.0)
    }

private data class Span(val min: Double, val max: Double)

private fun verticalSpan(blocks: List<DocumentBlock>): Span {
    var lowest = 1.0
    var highest = 0.0
    for (block in blocks) {
        lowest = min(lowest, block.bounds.y)
        highest = max(highest, block.bounds.y + block.bounds.height)
    }
    return Span(lowest, highest)
}

/** The midpoint of the widest horizontal gap between block centres. */
private fun widestGapCentre(blocks: List<DocumentBlock>): Pair<Double, Double> {
    val centres = blocks.map { it.centreX() }.sorted()
    var bestGap = 0.0
    var splitAt = -1.0
    for (i in 1 until centres.size) {
        val gap = centres[i] - centres[i - 1]
        if (gap > bestGap) {
            bestGap = gap
            splitAt = (centres[i - 1] + centres[i]) / 2
        }
    }
    return bestGap to splitAt
}

/**
 * Two column runs only count as columns when they sit side by side over roughly
 * the same vertical range. Without this a heading above a block of text would
 * split into phantom columns and be read out of order.
 */
private fun runsSideBySide(left: List<DocumentBlock>, right: List<DocumentBlock>): Boolean {
    val leftSpan = verticalSpan(left)
    val rightSpan = verticalSpan(right)
    val overlap = min(leftSpan.max, rightSpan.max) - max(leftSpan.min, rightSpan.min)
    val union = max(leftSpan.max, rightSpan.max) - min(leftSpan.min, rightSpan.min)
    return union > 0 && overlap / union >= MIN_COLUMN_OVERLAP
}

private fun splitByGutter(blocks: List<DocumentBlock>): List<List<DocumentBlock>> {
    if (blocks.size < MIN_BLOCKS_FOR_COLUMNS) return listOf(blocks)

    val (bestGap, splitAt) = widestGapCentre(blocks)
    if (bestGap < COLUMN_GUTTER_MIN || splitAt < GUTTER_MIN_X || splitAt > GUTTER_MAX_X) {
        return listOf(blocks)
    }

    val (left, right) = blocks.partition { it.centreX() < splitAt }
    if (left.size < MIN_BLOCKS_PER_COLUMN || right.size < MIN_BLOCKS_PER_COLUMN) {
        return listOf(blocks)
    }
    return if (runsSideBySide(left, right)) listOf(left, right) else listOf(blocks)
}

/**
 * Puts a page's text blocks into the order a person would read them: each
 * column finished before the next begins (FR-005).
 *
 * Blocks carrying no visible text are dropped so they never become silent
 * passages.
 */
fun orderBlocks(blocks: List<DocumentBlock>): List<DocumentBlock> {
    val usable = blocks.filter { it.text.isNotBlank() }
    return splitByGutter(usable).flatMap(::sortVisual)
}

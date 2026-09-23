package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import com.evangeline.reader.model.DocumentBlock
import kotlin.test.Test
import kotlin.test.assertEquals

private fun blk(
    id: String,
    text: String,
    x: Double,
    y: Double,
    width: Double = 0.3,
    height: Double = 0.02,
) = DocumentBlock(
    id = id,
    page = 1,
    text = text,
    bounds = BoundingBox(x, y, width, height),
)

class ReadingOrderTest {
    @Test
    fun `the left column is read fully before the right`() {
        val page = listOf(
            blk("L1", "Left one", 0.08, 0.20),
            blk("L2", "Left two", 0.08, 0.30),
            blk("L3", "Left three", 0.08, 0.40),
            blk("R1", "Right one", 0.55, 0.20),
            blk("R2", "Right two", 0.55, 0.30),
            blk("R3", "Right three", 0.55, 0.40),
        )

        assertEquals(
            listOf("L1", "L2", "L3", "R1", "R2", "R3"),
            orderBlocks(page).map { it.id },
        )
    }

    @Test
    fun `a single-column page keeps its top-to-bottom order`() {
        val page = listOf(
            blk("A", "Line A", 0.1, 0.20, width = 0.8),
            blk("B", "Line B", 0.1, 0.30, width = 0.8),
            blk("C", "Line C", 0.1, 0.40, width = 0.8),
            blk("D", "Line D", 0.1, 0.50, width = 0.8),
        )

        assertEquals(listOf("A", "B", "C", "D"), orderBlocks(page).map { it.id })
    }

    @Test
    fun `blocks sharing a line are read left to right`() {
        val page = listOf(
            blk("X", "first", 0.5, 0.2, width = 0.1),
            blk("Y", "second", 0.1, 0.2, width = 0.1),
        )

        assertEquals(listOf("Y", "X"), orderBlocks(page).map { it.id })
    }

    @Test
    fun `a block carrying no visible text is dropped`() {
        val page = listOf(blk("P", "text", 0.1, 0.2), blk("Q", "   ", 0.1, 0.3))

        assertEquals(listOf("P"), orderBlocks(page).map { it.id })
    }

    // One stray block far to the right is a marginal note or page stamp, not a
    // column. The interleaved result proves no column split happened: a split
    // would have read L1,L2,L3 before R1. Several guards independently prevent
    // the split here, so this pins the outcome, not one mechanism.
    @Test
    fun `a lone block to one side does not become a column`() {
        val page = listOf(
            blk("L1", "a", 0.08, 0.20, width = 0.1),
            blk("L2", "b", 0.08, 0.30, width = 0.1),
            blk("L3", "c", 0.08, 0.40, width = 0.1),
            blk("R1", "note", 0.75, 0.25, width = 0.1),
        )

        assertEquals(listOf("L1", "R1", "L2", "L3"), orderBlocks(page).map { it.id })
    }

    // Fewer than four blocks is too little evidence to judge a gutter. As above,
    // more than one guard prevents the split, so this pins the outcome.
    @Test
    fun `a page with too few blocks is not split into columns`() {
        val page = listOf(
            blk("M", "a", 0.08, 0.2, width = 0.1),
            blk("N", "b", 0.7, 0.2, width = 0.1),
            blk("O", "c", 0.70, 0.3, width = 0.1),
        )

        assertEquals(listOf("M", "N", "O"), orderBlocks(page).map { it.id })
    }
}

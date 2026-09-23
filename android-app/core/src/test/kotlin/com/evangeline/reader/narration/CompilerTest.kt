package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import com.evangeline.reader.model.DocumentBlock
import com.evangeline.reader.model.DocumentHints
import com.evangeline.reader.model.ExtractedPage
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private const val BODY_SIZE = 0.02

private fun blk(
    id: String,
    text: String,
    y: Double,
    x: Double = 0.1,
    width: Double = 0.7,
    fontSize: Double = BODY_SIZE,
) = DocumentBlock(
    id = id,
    page = 1,
    text = text,
    bounds = BoundingBox(x, y, width, BODY_SIZE),
    fontSize = fontSize,
)

private fun page(vararg blocks: DocumentBlock) = ExtractedPage(
    documentId = "doc",
    page = 1,
    width = 612.0,
    height = 792.0,
    blocks = blocks.toList(),
    scanned = false,
    textLength = blocks.sumOf { it.text.length },
)

class CompilerTest {
    @Test
    fun `a page number is not spoken`() {
        val result = compilePage(
            page(
                blk("b1", "The opening paragraph runs across the page and is read aloud.", 0.30),
                blk("b2", "7", 0.95, x = 0.48, width = 0.04),
            ),
        )

        val spoken = result.segments.map { it.spokenText }
        assertTrue(spoken.any { it.contains("opening paragraph") }, "body text is spoken")
        assertFalse(spoken.any { it.trim() == "seven" }, "the page number is not spoken")
    }

    // A running header repeats at the same place on every page. Once learned as
    // a hint it is furniture, not prose, and is not spoken (FR-004).
    @Test
    fun `a running header learned from earlier pages is not spoken`() {
        val hints = DocumentHints(headerTexts = listOf("quarterly financial report"))

        val result = compilePage(
            page(
                blk("b1", "Quarterly Financial Report", 0.04),
                blk("b2", "The opening paragraph runs across the page and is read aloud.", 0.30),
            ),
            hints,
        )

        val spoken = result.segments.map { it.spokenText }
        assertTrue(spoken.any { it.contains("opening paragraph") }, "body text is spoken")
        assertFalse(
            spoken.any { it.contains("Quarterly Financial Report", ignoreCase = true) },
            "the running header is not spoken",
        )
    }

    // FR-006: citation markers are print apparatus, not prose. Reading "[14]"
    // aloud as "fourteen" breaks the sentence.
    @Test
    fun `citation markers in a spoken sentence are not read aloud`() {
        val result = compilePage(
            page(
                blk("b1", "Revenue increased sharply [14] over the last year (Smith, 2019).", 0.30),
            ),
        )

        val spoken = result.segments.joinToString(" ") { it.spokenText }
        assertTrue(spoken.contains("Revenue increased sharply"), "the sentence is still spoken")
        assertFalse(spoken.contains("fourteen"), "the numeric citation is not spoken")
        assertFalse(spoken.contains("Smith"), "the author-year citation is not spoken")
    }

    // FR-007: the highlight follows the voice, so each passage carries the
    // rectangles of its own sentence rather than the whole paragraph's.
    @Test
    fun `each passage carries the bounds of its own sentence`() {
        val result = compilePage(
            page(
                blk("b1", "The first sentence sits on the opening line.", 0.30),
                blk("b2", "The second sentence sits lower down the page.", 0.34),
            ),
        )

        val passages = result.segments
        assertTrue(passages.size >= 2, "the paragraph produced a passage per sentence")
        assertTrue(passages.all { it.bounds.isNotEmpty() }, "every passage can be highlighted")
        assertTrue(
            passages[0].bounds != passages[1].bounds,
            "consecutive sentences highlight different places on the page",
        )
    }

    // FR-005: a two-column page is read down the left column before the right.
    // This pins the end-to-end outcome. Column detection itself is pinned by
    // ReadingOrderTest; here line and paragraph grouping also keep the columns
    // apart, so the outcome holds through more than one mechanism.
    @Test
    fun `a two-column page is narrated left column first`() {
        val result = compilePage(
            page(
                blk("l1", "Alpha opens the left column with a full line of prose.", 0.20, x = 0.06, width = 0.38),
                blk("l2", "Bravo continues the left column with another line.", 0.30, x = 0.06, width = 0.38),
                blk("l3", "Charlie closes the left column with a final line.", 0.40, x = 0.06, width = 0.38),
                blk("r1", "Delta opens the right column with a full line of prose.", 0.22, x = 0.56, width = 0.38),
                blk("r2", "Echo continues the right column with another line.", 0.32, x = 0.56, width = 0.38),
                blk("r3", "Foxtrot closes the right column with a final line.", 0.42, x = 0.56, width = 0.38),
            ),
        )

        val spoken = result.segments.joinToString(" ") { it.spokenText }
        assertTrue(
            spoken.indexOf("Charlie") < spoken.indexOf("Delta"),
            "the left column is finished before the right begins: $spoken",
        )
    }

    // OWASP A10:2025 - a page whose geometry is degenerate still narrates its
    // readable text; a bad rectangle costs the highlight, never the sentence.
    @Test
    fun `a page with unusable geometry still narrates its text`() {
        val broken = DocumentBlock(
            id = "b1",
            page = 1,
            text = "The opening paragraph runs across the page and is read aloud.",
            bounds = BoundingBox(Double.NaN, Double.NaN, 0.0, 0.0),
        )

        val result = compilePage(page(broken))

        assertTrue(
            result.segments.any { it.spokenText.contains("opening paragraph") },
            "the text is still spoken",
        )
    }

    @Test
    fun `a page holding no readable text produces no passages`() {
        val result = compilePage(page(blk("b1", "   ", 0.30)))

        assertTrue(result.segments.isEmpty())
    }
}

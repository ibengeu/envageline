package com.evangeline.reader.narration

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private fun assertClose(expected: Double, actual: Double, what: String) =
    assertTrue(kotlin.math.abs(expected - actual) < 1e-9, "$what: expected $expected, was $actual")

class BlockBuilderTest {
    @Test
    fun `a text item is placed at its glyph box on the page`() {
        val blocks = itemsToBlocks(
            pageNumber = 1,
            items = listOf(
                TextItem(text = "Baseline", transform = listOf(12.0, 0.0, 0.0, 12.0, 72.0, 700.0), width = 200.0, height = 12.0),
            ),
            pageWidth = 612.0,
            pageHeight = 792.0,
        )

        val bounds = blocks.single().bounds
        assertClose(72.0 / 612.0, bounds.x, "x")
        assertClose(200.0 / 612.0, bounds.width, "width")
        assertClose(80.0 / 792.0, bounds.y, "y")
        assertClose(12.0 / 792.0, bounds.height, "height")
    }

    // OWASP A10:2025 - an item running off the page edge is clipped to the page
    // rather than producing geometry the overlay cannot draw.
    @Test
    fun `an item running off the page edge is clipped to the page`() {
        val blocks = itemsToBlocks(
            pageNumber = 1,
            items = listOf(
                TextItem(text = "Edge", transform = listOf(1.0, 0.0, 0.0, 1.0, 190.0, 80.0), width = 30.0, height = 20.0),
            ),
            pageWidth = 200.0,
            pageHeight = 100.0,
        )

        val bounds = blocks.single().bounds
        assertClose(0.95, bounds.x, "x")
        assertClose(0.0, bounds.y, "y")
        assertClose(0.05, bounds.width, "width")
        assertClose(0.2, bounds.height, "height")
    }

    // Glyphs run from baseline+descent to baseline+ascent, not across the full
    // em box, so a known font gives a tighter highlight than the item height.
    @Test
    fun `a known font bounds the item by its ascent and descent`() {
        val blocks = itemsToBlocks(
            pageNumber = 1,
            items = listOf(
                TextItem(
                    text = "Heading",
                    transform = listOf(13.0, 0.0, 0.0, 13.0, 100.0, 500.0),
                    width = 130.0,
                    height = 13.0,
                    fontName = "g_d0_f4",
                ),
            ),
            pageWidth = 612.0,
            pageHeight = 792.0,
            styles = mapOf("g_d0_f4" to FontStyle(ascent = 0.764, descent = -0.238)),
        )

        val bounds = blocks.single().bounds
        assertClose((792.0 - (500.0 + 0.764 * 13.0)) / 792.0, bounds.y, "y")
        assertClose((0.764 + 0.238) * 13.0 / 792.0, bounds.height, "height")
    }

    @Test
    fun `a scaled viewport still produces normalised bounds`() {
        val blocks = itemsToBlocks(
            pageNumber = 1,
            items = listOf(
                TextItem(text = "Scaled", transform = listOf(1.0, 0.0, 0.0, 1.0, 20.0, 30.0), width = 30.0, height = 10.0),
            ),
            pageWidth = 400.0,
            pageHeight = 200.0,
            viewportTransform = listOf(2.0, 0.0, 0.0, -2.0, 0.0, 200.0),
        )

        val bounds = blocks.single().bounds
        assertClose(0.1, bounds.x, "x")
        assertClose(0.6, bounds.y, "y")
        assertClose(0.15, bounds.width, "width")
        assertClose(0.1, bounds.height, "height")
    }

    @Test
    fun `a rotated viewport turns the item rectangle with the page`() {
        val blocks = itemsToBlocks(
            pageNumber = 1,
            items = listOf(
                TextItem(text = "Rotated", transform = listOf(1.0, 0.0, 0.0, 1.0, 10.0, 20.0), width = 30.0, height = 10.0),
            ),
            pageWidth = 200.0,
            pageHeight = 100.0,
            viewportTransform = listOf(0.0, 1.0, 1.0, 0.0, 0.0, 0.0),
        )

        val bounds = blocks.single().bounds
        assertClose(0.1, bounds.x, "x")
        assertClose(0.1, bounds.y, "y")
        assertClose(0.05, bounds.width, "width")
        assertClose(0.3, bounds.height, "height")
    }

    // OWASP A02:2025 / A10:2025 - transforms and page sizes come from an
    // untrusted document. A degenerate one yields no block rather than geometry
    // the overlay cannot draw.
    @Test
    fun `an item with unusable geometry produces no block`() {
        val blocks = itemsToBlocks(
            pageNumber = 1,
            items = listOf(
                TextItem(text = "Not finite", transform = listOf(1.0, 0.0, 0.0, 1.0, Double.NaN, 20.0), width = 30.0, height = 10.0),
                TextItem(text = "No width", transform = listOf(1.0, 0.0, 0.0, 1.0, 10.0, 20.0), width = 0.0, height = 10.0),
                TextItem(text = "No height", transform = listOf(1.0, 0.0, 0.0, 1.0, 10.0, 20.0), width = 30.0, height = 0.0),
                TextItem(text = "   ", transform = listOf(1.0, 0.0, 0.0, 1.0, 10.0, 20.0), width = 30.0, height = 10.0),
            ),
            pageWidth = 200.0,
            pageHeight = 100.0,
        )

        assertEquals(emptyList(), blocks)
    }

    @Test
    fun `a page with no usable size produces no blocks`() {
        val blocks = itemsToBlocks(
            pageNumber = 1,
            items = listOf(
                TextItem(text = "Text", transform = listOf(1.0, 0.0, 0.0, 1.0, 10.0, 20.0), width = 30.0, height = 10.0),
            ),
            pageWidth = 0.0,
            pageHeight = 100.0,
        )

        assertEquals(emptyList(), blocks)
    }

    // OWASP A02:2025 - a non-finite page size would divide every coordinate to
    // zero and pass validation as a highlight pinned at the page origin.
    @Test
    fun `a page with a non-finite size produces no blocks`() {
        val blocks = itemsToBlocks(
            pageNumber = 1,
            items = listOf(
                TextItem(text = "Text", transform = listOf(1.0, 0.0, 0.0, 1.0, 10.0, 20.0), width = 30.0, height = 10.0),
            ),
            pageWidth = Double.POSITIVE_INFINITY,
            pageHeight = 100.0,
        )

        assertEquals(emptyList(), blocks)
    }
}

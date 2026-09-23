package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import com.evangeline.reader.model.DocumentBlock
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

private fun block(text: String, id: String = "b1") = DocumentBlock(
    id = id,
    page = 1,
    text = text,
    bounds = BoundingBox(0.1, 0.1, 0.5, 0.02),
)

class PageAnalyzerTest {
    @Test
    fun `a page carrying too little text is treated as scanned`() {
        assertTrue(isLikelyScanned(listOf(block("Short."))))
    }

    @Test
    fun `a page carrying a normal amount of text is not treated as scanned`() {
        val page = listOf(
            block("This first line carries a full sentence of readable prose.", "b1"),
            block("A second line follows it with more readable prose.", "b2"),
        )

        assertFalse(isLikelyScanned(page))
    }

    // A single short run of text is a caption or a page stamp burned into an
    // image, not a readable page.
    @Test
    fun `a page holding one short run of text is treated as scanned`() {
        assertTrue(isLikelyScanned(listOf(block("Figure 4. Annual results"))))
    }

    // A text layer that decoded badly is narrated as noise, so a page whose
    // characters are largely undecodable is sent for recognition instead, even
    // when enough letters survive to clear the length threshold.
    @Test
    fun `a page whose text decoded badly is treated as scanned`() {
        val garbled = "word\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD".repeat(6)
        val page = listOf(block(garbled, "b1"), block(garbled, "b2"))

        assertTrue(isLikelyScanned(page))
    }
}

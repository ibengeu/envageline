package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import com.evangeline.reader.model.DocumentHints
import kotlin.test.Test
import kotlin.test.assertEquals

private fun group(text: String, y: Double) = ParagraphGroup(
    text = text,
    originalParts = listOf(text),
    sourceLines = emptyList(),
    blocks = emptyList(),
    bounds = listOf(BoundingBox(0.1, y, 0.3, 0.02)),
    fontSize = 0.02,
    indent = 0.1,
)

class HintsTest {
    @Test
    fun `text in the header band is remembered as a running header`() {
        val hints = collectHints(listOf(group("Chapter Three Overview", 0.04)), DocumentHints())

        assertEquals(listOf("chapter three overview"), hints.headerTexts)
    }

    @Test
    fun `hints are collected the way the web reader collects them`() {
        val groups = listOf(
            group("Chapter Three Overview", 0.04),
            group("Main body text here", 0.5),
            group("Confidential Draft", 0.95),
            group("abc", 0.03),
            group("Page 12", 0.96),
        )

        val hints = collectHints(groups, DocumentHints())

        assertEquals(listOf("chapter three overview"), hints.headerTexts)
        assertEquals(listOf("confidential draft", "page"), hints.footerTexts)
    }

    // "Page 12" and "Page 13" are the same furniture, so digits are dropped
    // before comparison or every page would look like new text.
    @Test
    fun `a page number varying across pages collapses to one hint`() {
        val first = collectHints(listOf(group("Page 12", 0.96)), DocumentHints())
        val second = collectHints(listOf(group("Page 13", 0.96)), first)

        assertEquals(listOf("page"), second.footerTexts)
    }

    @Test
    fun `body text away from the page edges is not treated as furniture`() {
        val hints = collectHints(listOf(group("Main body text here", 0.5)), DocumentHints())

        assertEquals(emptyList(), hints.headerTexts)
        assertEquals(emptyList(), hints.footerTexts)
    }
}

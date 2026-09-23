package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import com.evangeline.reader.model.DocumentBlockType
import com.evangeline.reader.model.DocumentHints
import kotlin.test.Test
import kotlin.test.assertEquals

private fun grp(text: String, y: Double, fontSize: Double = 0.02) = ParagraphGroup(
    text = text,
    originalParts = listOf(text),
    sourceLines = emptyList(),
    blocks = emptyList(),
    bounds = listOf(BoundingBox(0.1, y, 0.3, fontSize)),
    fontSize = fontSize,
    indent = 0.1,
)

class ClassifyGroupTest {
    @Test
    fun `a large line partway down the page is a heading`() {
        val body = List(4) { grp("Ordinary body text", 0.4 + it * 0.05) }
        val heading = grp("A Section Heading", 0.35, fontSize = 0.032)
        val all = body + heading

        assertEquals(DocumentBlockType.HEADING, classifyGroup(heading, all, DocumentHints()))
    }

    @Test
    fun `groups are classified the way the web reader classifies them`() {
        val body = List(4) { grp("Ordinary body text", 0.4 + it * 0.05) }
        fun classify(g: ParagraphGroup, hints: DocumentHints = DocumentHints()) =
            classifyGroup(g, body + g, hints)

        assertEquals(DocumentBlockType.TITLE, classify(grp("The Document Title", 0.1, 0.05)))
        assertEquals(DocumentBlockType.LIST_ITEM, classify(grp("1. Take notes", 0.5)))
        assertEquals(DocumentBlockType.REFERENCE, classify(grp("References", 0.5)))
        assertEquals(DocumentBlockType.CAPTION, classify(grp("Figure 4 shows it", 0.5)))
        assertEquals(DocumentBlockType.PARAGRAPH, classify(grp("Just ordinary prose here.", 0.5)))
    }

    // These three are the ones that must never be spoken, so they are asserted
    // separately from the general classification table (FR-004).
    @Test
    fun `page furniture is classified so it will not be spoken`() {
        val body = List(4) { grp("Ordinary body text", 0.4 + it * 0.05) }
        val stamp = grp("12", 0.96)
        assertEquals(DocumentBlockType.PAGE_NUMBER, classifyGroup(stamp, body + stamp, DocumentHints()))

        val repeated = grp("Chapter Three", 0.04)
        assertEquals(
            DocumentBlockType.HEADER,
            classifyGroup(repeated, body + repeated, DocumentHints(headerTexts = listOf("chapter three"))),
        )
    }
}

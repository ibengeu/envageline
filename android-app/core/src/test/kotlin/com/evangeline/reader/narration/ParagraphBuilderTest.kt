package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import com.evangeline.reader.model.DocumentBlock
import kotlin.test.Test
import kotlin.test.assertEquals

private fun block(
    id: String,
    text: String,
    x: Double,
    y: Double,
    width: Double = 0.1,
    height: Double = 0.02,
    fontSize: Double = 0.02,
) = DocumentBlock(
    id = id,
    page = 1,
    text = text,
    bounds = BoundingBox(x, y, width, height),
    fontSize = fontSize,
)

class ParagraphBuilderTest {
    @Test
    fun `runs sharing a baseline become one line`() {
        val lines = groupLines(
            listOf(
                block("a", "Hello", x = 0.1, y = 0.2),
                block("b", "world", x = 0.25, y = 0.2),
            ),
        )

        assertEquals(1, lines.size)
        assertEquals("Hello world", lines.first().text)
    }

    @Test
    fun `runs on different baselines become separate lines`() {
        val lines = groupLines(
            listOf(
                block("a", "First line", x = 0.1, y = 0.20),
                block("b", "Second line", x = 0.1, y = 0.30),
            ),
        )

        assertEquals(listOf("First line", "Second line"), lines.map { it.text })
    }

    // A decorative marker is set in a larger face than the words beside it. If it
    // widened the line box, the reading highlight would sit off the text.
    @Test
    fun `a decorative marker does not stretch the line box past the words`() {
        val lines = groupLines(
            listOf(
                block("marker", "\u25AA", x = 0.02, y = 0.2, width = 0.04, height = 0.03),
                block("words", "Item text", x = 0.10, y = 0.2, width = 0.20, height = 0.02),
            ),
        )

        assertEquals(1, lines.size)
        assertEquals(0.10, lines.first().bounds.x, absoluteTolerance = 1e-9)
    }

    @Test
    fun `a line carrying no visible text is dropped`() {
        val lines = groupLines(listOf(block("blank", "   ", x = 0.1, y = 0.2)))

        assertEquals(emptyList(), lines.map { it.text })
    }

    @Test
    fun `a word broken across lines is rejoined`() {
        assertEquals(
            "Consider the established order",
            dehyphenate("Consider the estab-", "lished order"),
        )
    }

    // Removing a hyphen from a real compound changes what the listener hears, so
    // the conservative cases are pinned as carefully as the joining one.
    @Test
    fun `hyphens are resolved the way the web reader resolves them`() {
        val expected = listOf(
            Triple("the com-", "of the thing", "the com-of the thing"),
            Triple("go-", "ing home", "go-ing home"),
            Triple("Well known-", "Next", "Well known-Next"),
            Triple("plain text", "next line", "plain text next line"),
            Triple("ends with-", "Capital", "ends with-Capital"),
            Triple("ab-", "cd", "ab-cd"),
            Triple("multi-", "the end", "multi-the end"),
        )

        expected.forEach { (previous, next, joined) ->
            assertEquals(joined, dehyphenate(previous, next), "dehyphenate($previous, $next)")
        }
    }

    @Test
    fun `consecutive lines of the same paragraph are joined`() {
        val lines = groupLines(
            listOf(
                block("a", "The first line runs on", x = 0.1, y = 0.20),
                block("b", "and continues here.", x = 0.1, y = 0.23),
            ),
        )

        val groups = groupParagraphs(lines)

        assertEquals(1, groups.size)
        assertEquals("The first line runs on and continues here.", groups.first().text)
    }

    @Test
    fun `a wide vertical gap starts a new paragraph`() {
        val lines = groupLines(
            listOf(
                block("a", "End of one idea", x = 0.1, y = 0.20),
                block("b", "Start of another", x = 0.1, y = 0.32),
            ),
        )

        assertEquals(2, groupParagraphs(lines).size)
    }

    @Test
    fun `a list item starts its own paragraph`() {
        val lines = groupLines(
            listOf(
                block("a", "Steps to follow", x = 0.1, y = 0.20),
                block("b", "1. Take notes", x = 0.1, y = 0.23),
            ),
        )

        val groups = groupParagraphs(lines)

        assertEquals(listOf("Steps to follow", "1. Take notes"), groups.map { it.text })
    }

    @Test
    fun `a change of indentation starts a new paragraph`() {
        val lines = groupLines(
            listOf(
                block("a", "Body text here", x = 0.10, y = 0.20),
                block("b", "Indented quote", x = 0.30, y = 0.23),
            ),
        )

        assertEquals(2, groupParagraphs(lines).size)
    }

    // The highlight maps to lines on the page while narration speaks the joined
    // text, so a joined paragraph must keep one bounding box per source line.
    @Test
    fun `a joined paragraph keeps one highlight box per source line`() {
        val lines = groupLines(
            listOf(
                block("a", "The first line runs on", x = 0.1, y = 0.20),
                block("b", "and continues here.", x = 0.1, y = 0.23),
            ),
        )

        assertEquals(2, groupParagraphs(lines).first().bounds.size)
    }
}

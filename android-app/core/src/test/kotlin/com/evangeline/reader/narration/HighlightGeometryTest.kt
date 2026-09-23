package com.evangeline.reader.narration

import com.evangeline.reader.model.BoundingBox
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HighlightGeometryTest {
    @Test
    fun `a sentence is highlighted over the line that carries it`() {
        val bounds = mapSentenceBounds(
            sentences = listOf("First sentence."),
            lines = listOf(SourceLine("First sentence.", BoundingBox(0.1, 0.2, 0.4, 0.03))),
        )

        assertEquals(listOf(listOf(BoundingBox(0.1, 0.2, 0.4, 0.03))), bounds)
    }

    @Test
    fun `each sentence is highlighted over only its own line`() {
        val bounds = mapSentenceBounds(
            sentences = listOf("First sentence.", "Second sentence."),
            lines = listOf(
                SourceLine("First sentence.", BoundingBox(0.1, 0.20, 0.4, 0.03)),
                SourceLine("Second sentence.", BoundingBox(0.1, 0.24, 0.4, 0.03)),
            ),
        )

        assertEquals(
            listOf(
                listOf(BoundingBox(0.1, 0.20, 0.4, 0.03)),
                listOf(BoundingBox(0.1, 0.24, 0.4, 0.03)),
            ),
            bounds,
        )
    }

    // OWASP A10:2025 - geometry arrives from an untrusted PDF transform, so a
    // rectangle that is not a drawable area must produce no highlight rather
    // than an exception or a nonsense overlay.
    @Test
    fun `a line whose rectangle is not drawable is not highlighted`() {
        val bounds = mapSentenceBounds(
            sentences = listOf("Not finite.", "Zero area.", "Off the page."),
            lines = listOf(
                SourceLine("Not finite.", BoundingBox(0.2, Double.NaN, 0.4, 0.03)),
                SourceLine("Zero area.", BoundingBox(0.2, 0.3, 0.0, 0.03)),
                SourceLine("Off the page.", BoundingBox(1.4, 0.4, 0.4, 0.03)),
            ),
        )

        assertEquals(listOf(emptyList(), emptyList(), emptyList()), bounds)
    }

    // OWASP A10:2025 - a full-width line that overruns the page edge by a float
    // artifact is still the line being narrated. Clamping keeps the highlight
    // visible where dropping it would blank the reader mid-sentence.
    @Test
    fun `a line overrunning the page edge is clamped rather than dropped`() {
        val bounds = mapSentenceBounds(
            sentences = listOf("Full width line."),
            lines = listOf(
                SourceLine("Full width line.", BoundingBox(0.08, 0.2, 0.92 + 1e-9, 0.03)),
            ),
        )

        val box = bounds.single().single()
        assertTrue(box.width > 0.9, "the highlight still covers the line")
        assertTrue(box.x + box.width <= 1.0, "the highlight stays on the page")
    }

    @Test
    fun `a sentence spanning two lines is highlighted over both`() {
        val bounds = mapSentenceBounds(
            sentences = listOf("Revenue increased this year."),
            lines = listOf(
                SourceLine("Revenue increased", BoundingBox(0.1, 0.20, 0.4, 0.03)),
                SourceLine("this year.", BoundingBox(0.1, 0.24, 0.4, 0.03)),
            ),
        )

        assertEquals(
            listOf(
                listOf(
                    BoundingBox(0.1, 0.20, 0.4, 0.03),
                    BoundingBox(0.1, 0.24, 0.4, 0.03),
                ),
            ),
            bounds,
        )
    }

    // The spoken sentence is the cleaned text, so tokens the cleanup removed -
    // here a citation marker - still sit in the source between its words.
    @Test
    fun `a sentence still spans its lines when the source carries removed tokens`() {
        val bounds = mapSentenceBounds(
            sentences = listOf("Revenue increased this year."),
            lines = listOf(
                SourceLine("Revenue increased [14]", BoundingBox(0.1, 0.20, 0.4, 0.03)),
                SourceLine("this year.", BoundingBox(0.1, 0.24, 0.4, 0.03)),
            ),
        )

        assertEquals(
            listOf(
                listOf(
                    BoundingBox(0.1, 0.20, 0.4, 0.03),
                    BoundingBox(0.1, 0.24, 0.4, 0.03),
                ),
            ),
            bounds,
        )
    }

    // A line-break hyphen splits one word across lines. The spoken sentence has
    // the whole word, so the highlight must still cover both lines.
    @Test
    fun `a word broken by a line-break hyphen still matches its spoken form`() {
        val bounds = mapSentenceBounds(
            sentences = listOf("The environment changed."),
            lines = listOf(
                SourceLine("The environ-", BoundingBox(0.1, 0.20, 0.4, 0.03)),
                SourceLine("ment changed.", BoundingBox(0.1, 0.24, 0.4, 0.03)),
            ),
        )

        assertEquals(
            listOf(
                listOf(
                    BoundingBox(0.1, 0.20, 0.4, 0.03),
                    BoundingBox(0.1, 0.24, 0.4, 0.03),
                ),
            ),
            bounds,
        )
    }
}

package com.evangeline.reader.narration

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CleanupTest {
    @Test
    fun `a numeric citation is not spoken`() {
        assertEquals("The result held.", stripCitations("The result held [1]."))
    }

    @Test
    fun `an author-year citation is not spoken`() {
        assertEquals("As shown earlier.", stripCitations("As shown (Smith, 2020) earlier."))
    }

    @Test
    fun `citation marks are removed the way the web reader removes them`() {
        val expected = mapOf(
            "Prior work [1, 2, 3] agreed." to "Prior work agreed.",
            "Both (Smith & Jones, 2019) and [4] agree." to "Both and agree.",
            "No citation here." to "No citation here.",
        )

        expected.forEach { (input, spoken) ->
            assertEquals(spoken, stripCitations(input), "stripCitations($input)")
        }
    }

    // Over-stripping is worse than under-stripping: it silently deletes prose the
    // listener needed. These pin the boundary of what must survive.
    @Test
    fun `bracketed text that is not a citation survives`() {
        assertEquals("Values [see note] remain.", stripCitations("Values [see note] remain."))
        assertEquals("Data (n = 42) was used.", stripCitations("Data (n = 42) was used."))
    }

    @Test
    fun `a bare page number is recognised as a page stamp`() {
        assertTrue(isPageNumber("12"))
    }

    @Test
    fun `page stamps are detected the way the web reader detects them`() {
        listOf("12", "Page 7", "page 7", "iv", "XIV", "3 / 12", "3/12").forEach {
            assertTrue(isPageNumber(it), "isPageNumber($it) should be true")
        }
    }

    // Over-detection silences real prose, so the boundary is pinned explicitly.
    @Test
    fun `prose that merely contains a numeral is not a page stamp`() {
        listOf("Chapter 1", "", "   ", "12a", "Page", "- 5 -", "5.").forEach {
            assertFalse(isPageNumber(it), "isPageNumber($it) should be false")
        }
    }

    @Test
    fun `a run of digits too long to be a page stamp is not one`() {
        assertFalse(isPageNumber("1234567890123456789"))
    }

    @Test
    fun `a numbered list item is spoken with its ordinal as a word`() {
        val prefix = ordinalListPrefix("1. Take notes")

        assertEquals("First, Take notes", prefix?.spoken)
    }

    @Test
    fun `list markers are spoken the way the web reader speaks them`() {
        val expected = mapOf(
            "2) Review it" to "Second, Review it",
            "- Bullet item" to "Bullet item",
            "\u2022 Dot item" to "Dot item",
            "10. Tenth thing" to "Tenth, Tenth thing",
        )

        expected.forEach { (input, spoken) ->
            assertEquals(spoken, ordinalListPrefix(input)?.spoken, "ordinalListPrefix($input)")
        }
    }

    // Past twenty there is no ordinal word, so the marker is dropped rather than
    // read aloud as a bare numeral.
    @Test
    fun `a list number above twenty drops its marker`() {
        assertEquals("Too high", ordinalListPrefix("21. Too high")?.spoken)
    }

    @Test
    fun `text without a list marker is not a list item`() {
        assertNull(ordinalListPrefix("Not a list"))
        assertNull(ordinalListPrefix("3.NoSpace"))
    }
}

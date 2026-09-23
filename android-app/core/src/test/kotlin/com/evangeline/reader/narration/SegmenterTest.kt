package com.evangeline.reader.narration

import kotlin.test.Test
import kotlin.test.assertEquals

class SegmenterTest {
    @Test
    fun `an abbreviation does not end a passage`() {
        val text = "Dr. Rivera reviewed the draft. The result held."

        assertEquals(
            listOf("Dr. Rivera reviewed the draft.", "The result held."),
            splitSentences(text),
        )
    }

    @Test
    fun `a decimal number does not end a passage`() {
        val text = "The rate rose to 3.5 percent. Nobody objected."

        assertEquals(
            listOf("The rate rose to 3.5 percent.", "Nobody objected."),
            splitSentences(text),
        )
    }

    @Test
    fun `a multi-letter acronym does not end a passage`() {
        assertEquals(
            listOf("See the U.S. report today."),
            splitSentences("See the U.S. report today."),
        )
    }

    @Test
    fun `an acronym before a capitalised word does not end a passage`() {
        assertEquals(
            listOf("The U.S. Senate met.", "It adjourned."),
            splitSentences("The U.S. Senate met. It adjourned."),
        )
    }


    @Test
    fun `a quoted sentence after a terminator starts a new passage`() {
        assertEquals(
            listOf("He paused.", "\"Stop,\" she said."),
            splitSentences("He paused. \"Stop,\" she said."),
        )
    }

    @Test
    fun `openers that start a quoted or parenthesised sentence are recognised`() {
        val expected = mapOf(
            "He paused. (Later it changed.) Then nothing." to
                listOf("He paused.", "(Later it changed.) Then nothing."),
            "It ended. \u201CGo now,\u201D he replied." to
                listOf("It ended.", "\u201CGo now,\u201D he replied."),
            "It ended. 'Go now,' he replied." to
                listOf("It ended.", "'Go now,' he replied."),
        )

        expected.forEach { (input, passages) ->
            assertEquals(passages, splitSentences(input), "splitSentences($input)")
        }
    }

    @Test
    fun `a single-letter initial does not end a passage`() {
        assertEquals(
            listOf("Written by J. R. R. Tolkien.", "It sold well."),
            splitSentences("Written by J. R. R. Tolkien. It sold well."),
        )
    }

    // Ground truth captured by executing the web reader's own segmenter
    // (see quickstart.md). Pinned so a regex-dialect difference between
    // JavaScript and Java shows up as a failure, not as a subtly worse read.
    @Test
    fun `passage splits match the web reader across the reference corpus`() {
        val expected = mapOf(
            "Written by J. R. R. Tolkien. It sold well." to
                listOf("Written by J. R. R. Tolkien.", "It sold well."),
            "See A. Smith. Then stop." to listOf("See A. Smith.", "Then stop."),
            "Growth was 23.7 percent this year." to listOf("Growth was 23.7 percent this year."),
            "Dr. Smith arrived. Later, rain fell." to
                listOf("Dr. Smith arrived.", "Later, rain fell."),
            "See the U.S. report today." to listOf("See the U.S. report today."),
            "The U.S. Senate met. It adjourned." to
                listOf("The U.S. Senate met.", "It adjourned."),
            "He left at 5 p.m. Traffic was light." to
                listOf("He left at 5 p.m.", "Traffic was light."),
            "See e.g. Adams. Then stop." to listOf("See e.g. Adams.", "Then stop."),
            "Bring pens, paper, etc. Then we start." to
                listOf("Bring pens, paper, etc. Then we start."),
            "The meeting ran long! Yes" to listOf("The meeting ran long!", "Yes"),
        )

        expected.forEach { (input, passages) ->
            assertEquals(passages, splitSentences(input), "splitSentences($input)")
        }
    }

    // Two behaviours the web reader exhibits that are arguably defects. They are
    // pinned here because the port must sound identical, and recorded in
    // research.md as open product questions rather than silently "fixed".
    @Test
    fun `known web-reader quirks are reproduced exactly`() {
        assertEquals(
            listOf("Fig. Two shows it. Fig. Three does not."),
            splitSentences("Fig. Two shows it. Fig. Three does not."),
        )
        assertEquals(listOf("Ready?", "Yes. No."), splitSentences("Ready? Yes. No."))
    }
}

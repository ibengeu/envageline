package com.evangeline.reader.narration

import kotlin.test.Test
import kotlin.test.assertEquals

class NormalizerTest {
    @Test
    fun `a two-digit number is spoken as hyphenated words`() {
        assertEquals("twenty-one", integerToWords(21))
    }

    @Test
    fun `whole numbers are spoken the way the web reader speaks them`() {
        val expected = mapOf(
            0 to "zero",
            15 to "fifteen",
            40 to "forty",
            99 to "ninety-nine",
            100 to "one hundred",
            101 to "one hundred one",
            342 to "three hundred forty-two",
            1_000 to "one thousand",
            2_500 to "two thousand five hundred",
            15_400 to "fifteen thousand four hundred",
            999_999 to "nine hundred ninety-nine thousand nine hundred ninety-nine",
        )

        expected.forEach { (value, words) ->
            assertEquals(words, integerToWords(value), "integerToWords($value)")
        }
    }

    @Test
    fun `a number too large to hear clearly stays in digits`() {
        assertEquals("1000000", integerToWords(1_000_000))
    }

    @Test
    fun `a decimal is spoken digit by digit after the point`() {
        assertEquals("twelve point zero nine", numberToSpoken("12.09"))
    }

    @Test
    fun `numeric tokens are spoken the way the web reader speaks them`() {
        val expected = mapOf(
            "3.5" to "three point five",
            "1,200" to "one thousand two hundred",
            "-7" to "minus seven",
            "0.50" to "zero point five zero",
            "23.7" to "twenty-three point seven",
        )

        expected.forEach { (raw, words) ->
            assertEquals(words, numberToSpoken(raw), "numberToSpoken($raw)")
        }
    }

    @Test
    fun `a percentage is spoken as words followed by percent`() {
        assertEquals(
            "Growth hit twenty-three point seven percent this year.",
            normalizeText("Growth hit 23.7% this year."),
        )
    }

    @Test
    fun `currency amounts are spoken as words followed by the currency`() {
        assertEquals("We paid one thousand two hundred dollars for it.", normalizeText("We paid $1,200 for it."))
        assertEquals("It cost five dollars.", normalizeText("It cost $5."))
    }

    @Test
    fun `titles are expanded to the words they stand for`() {
        assertEquals("Doctor Smith met Professor Jones.", normalizeText("Dr. Smith met Prof. Jones."))
        assertEquals("See figure 4 and volume 2.", normalizeText("See fig. 4 and vol. 2."))
        assertEquals("approximately 12 people", normalizeText("approx. 12 people"))
    }

    @Test
    fun `acronyms are spelled out or spoken as words per the reference lists`() {
        assertEquals("The C P U and G P U were hot.", normalizeText("The CPU and GPU were hot."))
        assertEquals("NASA launched it.", normalizeText("NASA launched it."))
    }

    @Test
    fun `units are expanded to their full names`() {
        assertEquals("He ran five kilometers.", normalizeText("He ran 5 km."))
    }

    // The web reader leaves ordinals as digits; the port must match it, so this
    // pins the absence of expansion rather than assuming it (FR-003).
    @Test
    fun `ordinals are left as digits exactly as the web reader leaves them`() {
        assertEquals("The 1st item.", normalizeText("The 1st item."))
        assertEquals("The 2nd and 3rd items.", normalizeText("The 2nd and 3rd items."))
    }

    @Test
    fun `percentages of whole numbers are spoken as words`() {
        assertEquals("It rose five percent.", normalizeText("It rose 5%."))
        assertEquals("Prices fell by one hundred percent.", normalizeText("Prices fell by 100%."))
    }
}

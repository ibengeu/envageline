package com.evangeline.reader.narration

import kotlin.math.absoluteValue

private val ONES = listOf(
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
)

private val TEENS = listOf(
    "ten", "eleven", "twelve", "thirteen", "fourteen",
    "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
)

private val TENS = listOf(
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
)

private fun underHundred(n: Int): String {
    if (n < 10) return ONES.getOrElse(n) { n.toString() }
    if (n < 20) return TEENS.getOrElse(n - 10) { n.toString() }
    val ten = n / 10
    val one = n % 10
    val tensWord = TENS.getOrElse(ten) { n.toString() }
    return if (one != 0) "$tensWord-${ONES[one]}" else tensWord
}

/**
 * Spells a whole number for narration.
 *
 * Values of a million or more are returned as digits, matching the web reader:
 * spelling them out is longer than it is clear when heard.
 */
fun integerToWords(value: Int): String {
    val n = value.absoluteValue
    if (n < 100) return underHundred(n)
    if (n < 1_000) {
        val hundreds = n / 100
        val rest = n % 100
        val head = "${ONES[hundreds]} hundred"
        return if (rest != 0) "$head ${underHundred(rest)}" else head
    }
    if (n < 1_000_000) {
        val thousands = n / 1_000
        val rest = n % 1_000
        val head = "${integerToWords(thousands)} thousand"
        return if (rest != 0) "$head ${integerToWords(rest)}" else head
    }
    return n.toString()
}

/**
 * Speaks a numeric token: thousands separators dropped, a leading minus spoken,
 * and any fractional part read digit by digit ("12.09" -> "twelve point zero nine").
 *
 * A fraction of only zeros is dropped, since "five point zero" adds nothing when heard.
 */
fun numberToSpoken(raw: String): String {
    val cleaned = raw.replace(",", "")
    val negative = cleaned.startsWith("-")
    val unsigned = if (negative) cleaned.substring(1) else cleaned
    val parts = unsigned.split(".")
    val whole = parts.getOrNull(0)?.toIntOrNull() ?: return raw

    var spoken = integerToWords(whole)
    val fraction = parts.getOrNull(1)
    if (fraction != null && fraction.any { it in '1'..'9' }) {
        val digits = fraction.map { digit ->
            digit.digitToIntOrNull()?.let { ONES[it] } ?: digit.toString()
        }
        spoken = "$spoken point ${digits.joinToString(" ")}"
    }
    return if (negative) "minus $spoken" else spoken
}

private val TITLES = mapOf(
    "Dr." to "Doctor", "Mr." to "Mister", "Mrs." to "Missus", "Ms." to "Miss",
    "Prof." to "Professor", "Sr." to "Senior", "Jr." to "Junior",
    "vs." to "versus", "etc." to "etcetera", "approx." to "approximately",
    "fig." to "figure", "vol." to "volume", "pp." to "pages", "No." to "number",
)

private val UNITS = mapOf(
    "km" to "kilometers", "cm" to "centimeters", "mm" to "millimeters",
    "kg" to "kilograms", "mg" to "milligrams", "lb" to "pounds",
    "ft" to "feet", "mph" to "miles per hour",
    "kb" to "kilobytes", "mb" to "megabytes", "gb" to "gigabytes",
)

private val QUARTERS = mapOf(
    "YoY" to "year over year", "QoQ" to "quarter over quarter",
    "Q1" to "first quarter", "Q2" to "second quarter",
    "Q3" to "third quarter", "Q4" to "fourth quarter",
)

/** Acronyms spoken one letter at a time. */
private val LETTERS = setOf(
    "CPU", "GPU", "API", "PDF", "OCR", "TTS", "HTML", "CSS", "SQL", "HTTP",
    "JSON", "XML", "URL", "USB", "SSD", "RAM", "AI", "ML", "UI", "UX", "ID",
    "UK", "US", "USA", "UN", "FBI", "CEO", "CTO", "CFO",
)

/** Acronyms spoken as a word, not spelled out. */
private val WORDS = setOf("NASA", "NATO", "UNESCO", "FIFA", "AIDS", "LASER")

private const val NUMBER = "(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)"

private val MONEY_USD = Regex("\\$$NUMBER(\\s*[KMB])?\\b")
private val MONEY_EUR = Regex("€$NUMBER(\\s*[KMB])?\\b")
private val PERCENT = Regex("$NUMBER%")
private val UNIT_VALUE = Regex(
    "\\b(\\d+(?:\\.\\d+)?)\\s*(km|cm|mm|kg|mg|lb|ft|mph|kb|mb|gb)\\b",
    RegexOption.IGNORE_CASE,
)
private val TITLE_TOKEN = Regex("\\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|fig|vol|pp|No|approx)\\.")
private val QUARTER_TOKEN = Regex("\\b(YoY|QoQ|Q1|Q2|Q3|Q4)\\b")
private val ACRONYM = Regex("\\b([A-Z]{2,6})\\b")
private val EXTRA_SPACE = Regex("\\s{2,}")

private fun scaleWord(scale: String): String = when (scale.trim().uppercase()) {
    "K" -> "thousand"
    "M" -> "million"
    "B" -> "billion"
    else -> ""
}

private fun money(match: MatchResult, currency: String): String {
    val spoken = numberToSpoken(match.groupValues[1])
    val scale = scaleWord(match.groupValues[2])
    val magnitude = if (scale.isEmpty()) "" else " $scale"
    return "$spoken$magnitude $currency"
}

private fun spellLetters(token: String): String = token.toCharArray().joinToString(" ")

private fun expandAcronym(token: String): String = when {
    token in WORDS -> token
    token in LETTERS -> spellLetters(token)
    else -> token
}

/**
 * Rewrites a passage into the form it should be spoken in: money, percentages,
 * units, titles and acronyms become words.
 *
 * Ordinals ("1st", "2nd") and bare numbers are deliberately left as digits -
 * the speech engine already reads those acceptably, and the web reader does the
 * same. Matching it exactly is the point (FR-003).
 */
fun normalizeText(input: String): String {
    var text = input
    text = MONEY_USD.replace(text) { money(it, "dollars") }
    text = MONEY_EUR.replace(text) { money(it, "euros") }
    text = PERCENT.replace(text) { "${numberToSpoken(it.groupValues[1])} percent" }
    text = UNIT_VALUE.replace(text) { match ->
        val unit = match.groupValues[2].lowercase()
        "${numberToSpoken(match.groupValues[1])} ${UNITS[unit] ?: unit}"
    }
    text = QUARTER_TOKEN.replace(text) { QUARTERS[it.value] ?: it.value }
    text = TITLE_TOKEN.replace(text) { TITLES[it.value] ?: it.value }
    text = text.replace(Regex("\\be\\.g\\."), "for example")
    text = text.replace(Regex("\\bi\\.e\\."), "that is")
    text = text.replace(Regex("\\bU\\.S\\."), "U S")
    text = ACRONYM.replace(text) { expandAcronym(it.value) }
    return EXTRA_SPACE.replace(text, " ").trim()
}

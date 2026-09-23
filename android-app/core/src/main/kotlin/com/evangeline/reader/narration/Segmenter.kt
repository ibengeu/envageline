package com.evangeline.reader.narration

private val ABBREVIATIONS = listOf(
    "Dr.", "Mr.", "Mrs.", "Ms.", "Prof.", "Sr.", "Jr.",
    "vs.", "etc.", "e.g.", "i.e.", "U.S.", "No.", "Fig.", "Vol.", "pp.",
    "approx.", "Inc.", "Ltd.", "Co.", "St.",
    "Jan.", "Feb.", "Mar.", "Apr.", "Jun.", "Jul.", "Aug.",
    "Sep.", "Sept.", "Oct.", "Nov.", "Dec.", "al.",
)

private const val PLACEHOLDER_OPEN = '⟦'
private const val PLACEHOLDER_CLOSE = '⟧'

private val INITIAL = Regex("\\b[A-Z]\\.")
private val DECIMAL = Regex("\\d+\\.\\d+")

private val SENTENCE_BOUNDARY = Regex("(?<=[.!?])\\s+(?=[“\"'(A-Z])")

/**
 * Splits narration text into spoken passages.
 *
 * Abbreviations are protected behind placeholders before the boundary split so
 * that a period inside `Dr.` is not mistaken for the end of a passage.
 */
fun splitSentences(text: String): List<String> {
    val trimmed = text.replace(Regex("\\s+"), " ").trim()
    if (trimmed.isEmpty()) return emptyList()

    val placeholders = mutableListOf<String>()
    var working = trimmed
    for (abbreviation in ABBREVIATIONS) {
        if (!working.contains(abbreviation)) continue
        working = working.replace(abbreviation, protect(abbreviation, placeholders))
    }
    // A single capital followed by a period is an initial ("J. R. R. Tolkien"),
    // and a period inside digits is a decimal ("23.7") - neither ends a passage.
    working = INITIAL.replace(working) { match -> protect(match.value, placeholders) }
    working = DECIMAL.replace(working) { match -> protect(match.value, placeholders) }

    val parts = working.split(SENTENCE_BOUNDARY)
        .map { part -> restore(part, placeholders).trim() }
        .filter { it.isNotEmpty() }

    return parts.ifEmpty { listOf(trimmed) }
}

private fun restore(part: String, placeholders: List<String>): String {
    var restored = part
    placeholders.forEachIndexed { index, value ->
        restored = restored.replace("$PLACEHOLDER_OPEN$index$PLACEHOLDER_CLOSE", value)
    }
    return restored
}

private fun protect(value: String, placeholders: MutableList<String>): String {
    val token = "$PLACEHOLDER_OPEN${placeholders.size}$PLACEHOLDER_CLOSE"
    placeholders.add(value)
    return token
}

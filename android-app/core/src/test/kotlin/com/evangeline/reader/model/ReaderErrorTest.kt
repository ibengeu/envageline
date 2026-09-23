package com.evangeline.reader.model

import kotlin.test.Test
import kotlin.test.assertFalse

class ReaderErrorTest {
    @Test
    fun `a failure carrying a sensitive cause does not expose it in its own message`() {
        val secret = "Patient Jane Doe, diagnosis withheld"
        val cause = IllegalStateException("parse failed near: $secret")

        val failure = ReaderException(ErrorCode.TEXT_EXTRACTION_FAILED, cause)

        assertFalse(
            failure.message.orEmpty().contains("Jane Doe"),
            "the failure message leaked document content: ${failure.message}",
        )
    }
}

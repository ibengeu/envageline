package com.evangeline.reader.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class DocumentIdTest {
    @Test
    fun `the same document content always yields the same identifier`() {
        val content = "A document's bytes".encodeToByteArray()

        assertEquals(documentId(content), documentId(content.copyOf()))
    }

    @Test
    fun `different document content yields a different identifier`() {
        assertNotEquals(
            documentId("One document".encodeToByteArray()),
            documentId("Another document".encodeToByteArray()),
        )
    }

    // FR-018 / OWASP A04:2025 - the stored key must not carry the document's
    // text, so a leaked progress record reveals nothing about what was read.
    @Test
    fun `the identifier carries none of the document text`() {
        val secret = "The patient's diagnosis is confidential."

        val id = documentId(secret.encodeToByteArray())

        assertFalse(id.contains("patient", ignoreCase = true))
        assertFalse(id.contains("diagnosis", ignoreCase = true))
        assertTrue(id.matches(Regex("[0-9a-f]{64}")), "the key is a fixed-length digest: $id")
    }
}

package com.evangeline.reader.model

import java.security.MessageDigest

/**
 * Identifies a document by its content (A04, FR-013, FR-018).
 *
 * Deriving the key from the bytes means reading progress can be stored and
 * restored without keeping the filename or any document text. The same document
 * always resolves to the same key, and a different document never does.
 *
 * This is an identity key, not a secret: it is not a credential and grants no
 * access on its own.
 */
fun documentId(content: ByteArray): String =
    MessageDigest.getInstance("SHA-256")
        .digest(content)
        .joinToString("") { byte -> "%02x".format(byte) }

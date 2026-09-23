package com.evangeline.reader.speech

import java.net.URI

/** Credentials move the real host after the "@": "localhost@evil.com" is evil.com. */
private fun URI.hasCredentials(): Boolean =
    userInfo != null || rawAuthority?.contains('@') == true

/** The configured value is an origin; a path or query could steer the request. */
private fun URI.isBareOrigin(): Boolean =
    path.orEmpty().trimEnd('/').isEmpty() && query == null && fragment == null

/** Exact match only: a prefix test would accept "localhost.evil.com". */
private fun URI.isLoopbackHost(): Boolean {
    val name = host?.lowercase() ?: return false
    return name == "localhost" || name == "127.0.0.1"
}

private fun URI.isHttp(): Boolean {
    val name = scheme?.lowercase()
    return name == "http" || name == "https"
}

/**
 * OWASP A08:2025 Server-Side Request Forgery.
 *
 * The developer-only narration endpoint carries document text, so it may only
 * ever address this device. Every request is checked against this before any
 * text is transmitted (FR-016, FR-017).
 */
fun isLoopbackEndpoint(base: String): Boolean {
    val raw = base.trim()
    if (raw.isEmpty()) return false
    val uri = runCatching { URI(raw) }.getOrNull() ?: return false
    if (uri.hasCredentials()) return false
    if (!uri.isHttp()) return false
    if (!uri.isBareOrigin()) return false
    return uri.isLoopbackHost()
}

/**
 * Carries narration text to a local speech server.
 *
 * A seam, so the validator can be tested for what it transmits without a
 * network.
 */
interface NarrationTransport {
    fun send(endpoint: String, text: String)
}

/**
 * OWASP A08:2025 Server-Side Request Forgery.
 *
 * The single way narration text may leave this process. The endpoint is
 * validated on every call - never once at configuration - and the text is
 * handed to the transport only after it passes, so a refused endpoint receives
 * nothing (A08, FR-016, FR-017).
 *
 * Returns whether the request was sent.
 */
fun sendNarrationRequest(
    endpoint: String,
    text: String,
    transport: NarrationTransport,
): Boolean {
    if (!isLoopbackEndpoint(endpoint)) return false
    transport.send(endpoint, text)
    return true
}

/**
 * OWASP A08:2025 Server-Side Request Forgery.
 *
 * A redirect answered by the local speech server is a fresh destination, not a
 * continuation of a trusted one. It is validated exactly like the original
 * endpoint, so a redirect pointing off the device carries no document text.
 *
 * Returns whether the redirect was followed.
 */
fun followRedirect(location: String, text: String, transport: NarrationTransport): Boolean =
    sendNarrationRequest(location, text, transport)

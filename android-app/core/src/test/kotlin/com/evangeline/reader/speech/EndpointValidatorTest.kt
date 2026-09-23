package com.evangeline.reader.speech

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** A stand-in transport that records what was actually transmitted. */
private class RecordingTransport : NarrationTransport {
    val sent = mutableListOf<String>()

    override fun send(endpoint: String, text: String) {
        sent += text
    }
}

class EndpointValidatorTest {
    @Test
    fun `a loopback endpoint is accepted`() {
        assertTrue(isLoopbackEndpoint("http://127.0.0.1:8880"))
    }

    // OWASP A08:2025 SSRF - the narration path carries document text, so any
    // destination that is not this device must be refused.
    @Test
    fun `a remote endpoint is refused`() {
        assertFalse(isLoopbackEndpoint("http://example.com:8880"))
    }

    // OWASP A08:2025 - a host that merely starts with a loopback name resolves
    // somewhere else entirely. Prefix matching would send document text there.
    @Test
    fun `a lookalike host is refused`() {
        val lookalikes = listOf(
            "http://localhost.evil.com:8880",
            "http://127.0.0.1.evil.com:8880",
            "http://notlocalhost:8880",
        )

        for (endpoint in lookalikes) {
            assertFalse(isLoopbackEndpoint(endpoint), endpoint)
        }
    }

    // OWASP A08:2025 - credentials in the authority move the real host after
    // the "@", so "localhost@evil.com" addresses evil.com.
    @Test
    fun `an endpoint carrying credentials is refused`() {
        assertFalse(isLoopbackEndpoint("http://localhost@evil.com:8880"))
        assertFalse(isLoopbackEndpoint("http://user:pass@127.0.0.1:8880"))
    }

    // OWASP A08:2025 - only HTTP schemes address a local narration server. A
    // file or custom scheme is a different kind of destination entirely.
    @Test
    fun `an endpoint using a non-http scheme is refused`() {
        assertFalse(isLoopbackEndpoint("file:///etc/passwd"))
        assertFalse(isLoopbackEndpoint("ftp://127.0.0.1:8880"))
        assertFalse(isLoopbackEndpoint("javascript:alert(1)"))
    }

    // OWASP A08:2025 - the configured value is an origin. Allowing a path,
    // query or fragment would let the request be steered within the host.
    @Test
    fun `an endpoint carrying a path query or fragment is refused`() {
        assertFalse(isLoopbackEndpoint("http://127.0.0.1:8880/proxy"))
        assertFalse(isLoopbackEndpoint("http://127.0.0.1:8880/?to=evil.com"))
        assertFalse(isLoopbackEndpoint("http://127.0.0.1:8880/#evil"))
    }

    // OWASP A08:2025 - rejection must happen before transmission, so a refused
    // endpoint never receives a single byte of document text.
    @Test
    fun `a refused endpoint is sent no document text`() {
        val transport = RecordingTransport()

        val sent = sendNarrationRequest(
            endpoint = "http://evil.com:8880",
            text = "The patient's diagnosis is confidential.",
            transport = transport,
        )

        assertFalse(sent, "the request was refused")
        assertTrue(transport.sent.isEmpty(), "no text reached the transport")
    }

    // OWASP A08:2025 - validating once at configuration would let a later
    // change to the endpoint go unchecked. Every request is validated.
    @Test
    fun `an endpoint is validated on every request not only the first`() {
        val transport = RecordingTransport()

        val first = sendNarrationRequest("http://127.0.0.1:8880", "First passage.", transport)
        val second = sendNarrationRequest("http://evil.com:8880", "Second passage.", transport)

        assertTrue(first, "the loopback request was allowed")
        assertFalse(second, "the later remote request was still refused")
        assertEquals(listOf("First passage."), transport.sent)
    }

    // OWASP A08:2025 - a loopback server that answers with a redirect would
    // otherwise walk document text off the device, so the redirect target is
    // validated exactly like the original endpoint and a remote one is refused.
    @Test
    fun `a redirect to a remote host is refused rather than followed`() {
        val transport = RecordingTransport()

        val followed = followRedirect(
            location = "http://evil.com/collect",
            text = "The passage text.",
            transport = transport,
        )

        assertFalse(followed, "the redirect was not followed")
        assertTrue(transport.sent.isEmpty(), "no text reached the redirect target")
    }

    @Test
    fun `a redirect that stays on loopback is still validated before sending`() {
        val transport = RecordingTransport()

        val followed = followRedirect("http://127.0.0.1:9999", "The passage text.", transport)

        assertTrue(followed)
        assertEquals(listOf("The passage text."), transport.sent)
    }
}

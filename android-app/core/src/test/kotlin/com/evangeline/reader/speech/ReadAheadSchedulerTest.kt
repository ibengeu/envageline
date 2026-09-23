package com.evangeline.reader.speech

import com.evangeline.reader.model.NarrationSegment
import com.evangeline.reader.model.NarrationSegmentType
import com.evangeline.reader.model.TtsOptions
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.yield
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

private fun passage(id: String) = NarrationSegment(
    id = id,
    documentId = "doc",
    page = 1,
    type = NarrationSegmentType.PARAGRAPH,
    originalText = "Text for $id.",
    spokenText = "Text for $id.",
    sourceBlockIds = listOf("b1"),
    bounds = emptyList(),
    order = 0,
    paragraphId = "g1",
)

private fun options(rate: Double = 1.0, voiceId: String? = "v1") = TtsOptions(rate, voiceId)

/** A stand-in engine that holds preparation open until it is released. */
private class BlockingSynthesizer : TextSynthesizer {
    private val gate = CompletableDeferred<Unit>()
    /** Preparation that reached the engine, and preparation that ran to the end. */
    val started = mutableListOf<String>()
    val completed = mutableListOf<String>()

    fun release() {
        gate.complete(Unit)
    }

    override suspend fun synthesize(
        segment: NarrationSegment,
        options: TtsOptions,
    ): SynthesizedAudio {
        started += segment.id
        gate.await()
        completed += segment.id
        return SynthesizedAudio(audio = ByteArray(0), preparationMs = 500.0)
    }
}

/** A stand-in speech engine that records what it was asked to prepare. */
private class CountingSynthesizer(private val preparationMs: Double = 500.0) : TextSynthesizer {
    private val calls = mutableListOf<String>()

    fun callsFor(id: String): Int = calls.count { it == id }

    override suspend fun synthesize(
        segment: NarrationSegment,
        options: TtsOptions,
    ): SynthesizedAudio {
        calls += segment.id
        return SynthesizedAudio(audio = segment.spokenText.encodeToByteArray(), preparationMs = preparationMs)
    }
}

class ReadAheadSchedulerTest {
    @Test
    fun `preparation never runs further ahead than six passages`() {
        val depth = prefetchDepth(estimatedPreparationMs = 1.0, chunkPlaybackMs = 9000.0)

        assertTrue(depth <= 6, "depth was $depth")
    }

    @Test
    fun `preparation always runs at least one passage ahead`() {
        val depth = prefetchDepth(estimatedPreparationMs = 60_000.0, chunkPlaybackMs = 9000.0)

        assertTrue(depth >= 1, "depth was $depth")
    }

    // OWASP A10:2025 - timing comes from the speech engine and may be absent or
    // nonsense. Unusable timing must fall back to the safe minimum rather than
    // produce an unbounded or negative amount of preparation.
    @Test
    fun `unusable timing prepares only one passage ahead`() {
        val unusable = listOf(0.0, -50.0, Double.NaN, Double.POSITIVE_INFINITY)

        for (timing in unusable) {
            assertEquals(
                1,
                prefetchDepth(estimatedPreparationMs = timing, chunkPlaybackMs = 9000.0),
                "preparation timing $timing",
            )
            assertEquals(
                1,
                prefetchDepth(estimatedPreparationMs = 500.0, chunkPlaybackMs = timing),
                "playback timing $timing",
            )
        }
    }

    // FR-010: depth is how many passages can be prepared inside one passage's
    // playback. When preparation is slow only the next one fits, so depth falls
    // to the floor; when it is fast, more fit and depth rises to the ceiling.
    @Test
    fun `depth falls towards the floor as preparation slows`() {
        val fast = prefetchDepth(estimatedPreparationMs = 1500.0, chunkPlaybackMs = 9000.0)
        val slow = prefetchDepth(estimatedPreparationMs = 4000.0, chunkPlaybackMs = 9000.0)
        val slowest = prefetchDepth(estimatedPreparationMs = 20_000.0, chunkPlaybackMs = 9000.0)

        assertTrue(fast > slow, "fast=$fast was not deeper than slow=$slow")
        assertTrue(slow > slowest, "slow=$slow was not deeper than slowest=$slowest")
        assertEquals(1, slowest, "preparation slower than playback prepares just the next one")
    }

    // User Story 3, scenario 3: audio already prepared is played, not prepared
    // a second time.
    @Test
    fun `a passage already prepared is not prepared again`() = runTest {
        val synthesizer = CountingSynthesizer()
        val scheduler = ReadAheadScheduler(synthesizer, backgroundScope)

        scheduler.audioFor(passage("s1"), options())
        scheduler.audioFor(passage("s1"), options())

        assertEquals(1, synthesizer.callsFor("s1"))
    }

    // FR-011: audio prepared under one voice or rate must never be played back
    // under another, so identity covers all three parts of the request.
    @Test
    fun `audio prepared under a different voice is not reused`() = runTest {
        val synthesizer = CountingSynthesizer()
        val scheduler = ReadAheadScheduler(synthesizer, backgroundScope)

        scheduler.audioFor(passage("s1"), options(voiceId = "v1"))
        scheduler.audioFor(passage("s1"), options(voiceId = "v2"))

        assertEquals(2, synthesizer.callsFor("s1"))
    }

    @Test
    fun `audio prepared under a different rate is not reused`() = runTest {
        val synthesizer = CountingSynthesizer()
        val scheduler = ReadAheadScheduler(synthesizer, backgroundScope)

        scheduler.audioFor(passage("s1"), options(rate = 1.0))
        scheduler.audioFor(passage("s1"), options(rate = 1.5))

        assertEquals(2, synthesizer.callsFor("s1"))
    }

    // FR-011: nothing prepared before a reset may play afterwards. Opening
    // another document must never be narrated with the previous one's audio.
    @Test
    fun `audio prepared before a reset is not reused after it`() = runTest {
        val synthesizer = CountingSynthesizer()
        val scheduler = ReadAheadScheduler(synthesizer, backgroundScope)

        scheduler.audioFor(passage("s1"), options())
        scheduler.reset()
        scheduler.audioFor(passage("s1"), options())

        assertEquals(2, synthesizer.callsFor("s1"))
    }

    // FR-011: preparation still running when the reset happens must be
    // abandoned, not allowed to finish and land in the new context.
    @Test
    fun `preparation still running when a reset happens is abandoned`() = runTest {
        val synthesizer = BlockingSynthesizer()
        val scheduler = ReadAheadScheduler(synthesizer, backgroundScope)

        scheduler.prefetch(listOf(passage("s1"), passage("s2")), currentIndex = 0, options = options())
        yield()
        assertTrue(synthesizer.started.isNotEmpty(), "preparation was running before the reset")

        scheduler.reset()
        synthesizer.release()
        yield()

        assertTrue(synthesizer.completed.isEmpty(), "abandoned preparation still completed")
    }
}

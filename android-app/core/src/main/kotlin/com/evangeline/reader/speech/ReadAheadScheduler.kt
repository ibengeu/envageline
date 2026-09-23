package com.evangeline.reader.speech

import com.evangeline.reader.model.NarrationSegment
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import com.evangeline.reader.model.TtsOptions
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/** Always keep one passage ready, so playback never waits with nothing prepared. */
private const val MIN_AHEAD = 1

/**
 * Never prepare more than this. Preparation costs memory and battery, and a
 * document of untrusted length must not drive it without bound (FR-010).
 */
private const val MAX_AHEAD = 6

/** Aim to have the next passage ready before 90% of the current one has played. */
private const val SAFETY_MARGIN = 0.9

/** How long a passage plays for, as the existing reader assumes. */
private const val DEFAULT_CHUNK_PLAYBACK_MS = 9000.0

/**
 * How many passages ahead to prepare, given how long preparation is taking
 * against how long a passage plays for (FR-010).
 */
fun prefetchDepth(estimatedPreparationMs: Double, chunkPlaybackMs: Double): Int {
    // OWASP A10:2025 Mishandling of Exceptional Conditions - timing reported by
    // the speech engine may be absent or nonsense. Fall back to the safe
    // minimum rather than compute an unbounded or negative depth from it.
    val usable = estimatedPreparationMs.isFinite() && estimatedPreparationMs > 0 &&
        chunkPlaybackMs.isFinite() && chunkPlaybackMs > 0
    if (!usable) return MIN_AHEAD

    val ahead = floor(chunkPlaybackMs / (estimatedPreparationMs / SAFETY_MARGIN)).toInt()
    return min(max(ahead, MIN_AHEAD), MAX_AHEAD)
}

/**
 * Prepares passages ahead of playback and reuses what it has already prepared,
 * so narration does not stall between passages (FR-010, FR-011).
 */
class ReadAheadScheduler(
    private val synthesizer: TextSynthesizer,
    private val scope: CoroutineScope,
    private val chunkPlaybackMs: Double = DEFAULT_CHUNK_PLAYBACK_MS,
) {
    /**
     * FR-011: voice and rate are part of a request's identity, so audio
     * prepared under one setting can never be played back under another.
     */
    private data class PreparedKey(val segmentId: String, val voiceId: String?, val rate: Double)

    private val prepared = mutableMapOf<PreparedKey, SynthesizedAudio>()

    /**
     * Preparation runs in this child scope, so a reset cancels every in-flight
     * request at once rather than letting it finish into a context that has
     * moved on (FR-011). It is a child of the caller's scope, so it also dies
     * with the screen that owns it.
     */
    private val preparation = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]))

    private var lastPreparationMs: Double? = null

    private fun keyFor(segment: NarrationSegment, options: TtsOptions) =
        PreparedKey(segment.id, options.voiceId, options.rate)

    suspend fun audioFor(segment: NarrationSegment, options: TtsOptions): SynthesizedAudio {
        val key = keyFor(segment, options)
        prepared[key]?.let { return it }
        val audio = synthesizer.synthesize(segment, options)
        lastPreparationMs = audio.preparationMs
        prepared[key] = audio
        return audio
    }

    /** How many passages ahead the observed preparation speed allows (FR-010). */
    private fun depth(): Int = prefetchDepth(
        estimatedPreparationMs = lastPreparationMs ?: 0.0,
        chunkPlaybackMs = chunkPlaybackMs,
    )

    /**
     * Starts preparing the passages after [currentIndex], so playback does not
     * wait when it reaches them.
     */
    fun prefetch(
        segments: List<NarrationSegment>,
        currentIndex: Int,
        options: TtsOptions,
    ) {
        for (offset in 1..depth()) {
            val segment = segments.getOrNull(currentIndex + offset) ?: break
            preparation.launch { audioFor(segment, options) }
        }
    }

    /**
     * Discards everything prepared so far. Called when the document, voice or
     * rate changes, so superseded audio can never reach the speaker (FR-011).
     */
    fun reset() {
        preparation.coroutineContext.cancelChildren()
        prepared.clear()
        lastPreparationMs = null
    }
}

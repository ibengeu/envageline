package com.evangeline.reader.speech

import com.evangeline.reader.model.NarrationSegment
import com.evangeline.reader.model.TtsOptions

/**
 * Audio for one passage, with how long it took to prepare so the scheduler can
 * adapt its depth (FR-010).
 */
data class SynthesizedAudio(
    val audio: ByteArray,
    val preparationMs: Double,
) {
    override fun equals(other: Any?): Boolean =
        this === other ||
            (other is SynthesizedAudio && audio.contentEquals(other.audio) && preparationMs == other.preparationMs)

    override fun hashCode(): Int = 31 * audio.contentHashCode() + preparationMs.hashCode()
}

/**
 * Turns one passage into playable audio.
 *
 * The seam that lets scheduler and playback tests run against a fake with
 * programmable latency, with no speech engine and no device.
 *
 * Preparation is cancellable: `synthesize` is a suspending call, so cancelling
 * the calling coroutine abandons the work and produces no audio.
 */
interface TextSynthesizer {
    suspend fun synthesize(segment: NarrationSegment, options: TtsOptions): SynthesizedAudio
}

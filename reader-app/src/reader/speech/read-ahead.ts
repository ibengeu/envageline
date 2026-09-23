import type { NarrationSegment, TTSOptions } from "../core/types.ts";
import type { SynthesisResult } from "./kokoro-tts.ts";

const ALPHA_FAST = 0.3;
const ALPHA_SLOW = 0.05;
const CHUNK_PLAY_MS = 9000;
const MIN_AHEAD = 1;
const MAX_AHEAD = 6;
const DEFAULT_MAX_ENTRIES = 6;
// Measured on the local Kokoro server (per-sentence requests at 1.25x): one
// at a time ~1.1x realtime, two ~1.6x, three ~1.65x. Much of each request's
// ~1.5s fixed cost leaves the CPU idle, so two overlap it; more only compete.
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 4;

interface Job {
  key: string;
  segment: NarrationSegment;
  options: TTSOptions;
  resolve: (result: SynthesisResult) => void;
  reject: (cause: unknown) => void;
  controller: AbortController;
}

export interface AudioSynthesizer {
  synthesize(
    segment: NarrationSegment,
    options: TTSOptions,
    signal?: AbortSignal,
  ): Promise<SynthesisResult>;
}

export interface ReadAheadScheduler {
  audioFor(segment: NarrationSegment, options: TTSOptions): Promise<Blob>;
  prefetch(segments: readonly NarrationSegment[], currentIndex: number, options: TTSOptions): void;
  reset(): void;
}

export interface ReadAheadSchedulerOptions {
  maxEntries?: number;
  chunkPlaybackMs?: number;
  /** Passages synthesized at once. */
  concurrency?: number;
}

export function prefetchDepth({
  estimatedSynthesisMs,
  chunkPlaybackMs,
}: {
  estimatedSynthesisMs: number;
  chunkPlaybackMs: number;
}): number {
  if (
    !Number.isFinite(estimatedSynthesisMs) ||
    estimatedSynthesisMs <= 0 ||
    !Number.isFinite(chunkPlaybackMs) ||
    chunkPlaybackMs <= 0
  ) {
    return MIN_AHEAD;
  }
  const ahead = Math.floor(chunkPlaybackMs / (estimatedSynthesisMs / 0.9));
  return Math.min(Math.max(ahead, MIN_AHEAD), MAX_AHEAD);
}

// OWASP A08:2025 Software or Data Integrity Failures - audio is keyed by the
// exact words it speaks, not the sentence id: a recompile can keep an id while
// changing its text, and audio of the old wording must never play for it.
function cacheKey(segment: NarrationSegment, options: TTSOptions): string {
  return `${options.voiceId ?? ""}\u0000${options.rate}\u0000${segment.spokenText}`;
}

export function createReadAheadScheduler(
  synthesizer: AudioSynthesizer,
  schedulerOptions: ReadAheadSchedulerOptions = {},
): ReadAheadScheduler {
  const maxEntries = Math.max(1, Math.floor(schedulerOptions.maxEntries ?? DEFAULT_MAX_ENTRIES));
  const chunkPlaybackMs = schedulerOptions.chunkPlaybackMs ?? CHUNK_PLAY_MS;
  const entries = new Map<string, Promise<Blob>>();
  let fast: number | null = null;
  let slow: number | null = null;
  let context = 0;
  // OWASP A06:2025 Insecure Design - a fixed, small number of requests in
  // flight, so a long book cannot flood the speech server.
  const concurrency = Math.min(
    MAX_CONCURRENCY,
    Math.max(1, Math.floor(schedulerOptions.concurrency ?? DEFAULT_CONCURRENCY)),
  );
  const queue: Job[] = [];
  const running = new Set<Job>();

  function record(responseMs: number): void {
    if (!Number.isFinite(responseMs) || responseMs <= 0) return;
    if (fast === null) {
      fast = responseMs;
      slow = responseMs;
      return;
    }
    fast = ALPHA_FAST * responseMs + (1 - ALPHA_FAST) * fast;
    slow = ALPHA_SLOW * responseMs + (1 - ALPHA_SLOW) * slow!;
  }

  function lookahead(): number {
    return prefetchDepth({
      estimatedSynthesisMs: fast === null ? 0 : Math.max(fast, slow ?? fast),
      chunkPlaybackMs,
    });
  }

  function trimCache(): void {
    // OWASP A04:2025 Insecure Design.
    // Bound prepared audio entries to prevent untrusted document length from exhausting memory.
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) return;
      entries.delete(oldest);
    }
  }

  function pump(): void {
    while (running.size < concurrency) {
      const job = queue.shift();
      if (!job) return;
      running.add(job);
      Promise.resolve()
        .then(() => synthesizer.synthesize(job.segment, job.options, job.controller.signal))
        .then(job.resolve, job.reject)
        .finally(() => {
          running.delete(job);
          pump();
        });
    }
  }

  // A passage already waiting as read-ahead that the listener now needs moves
  // to the front instead of being requested a second time.
  function promote(key: string): void {
    const index = queue.findIndex((job) => job.key === key);
    if (index > 0) queue.unshift(...queue.splice(index, 1));
  }

  function enqueue(
    key: string,
    segment: NarrationSegment,
    options: TTSOptions,
    urgent: boolean,
  ): Promise<SynthesisResult> {
    return new Promise<SynthesisResult>((resolve, reject) => {
      const job: Job = { key, segment, options, resolve, reject, controller: new AbortController() };
      if (urgent) queue.unshift(job);
      else queue.push(job);
      pump();
    });
  }

  // OWASP A10:2025 Mishandling of Exceptional Conditions - work nobody will
  // listen to is cancelled with a named reason, never left to finish silently
  // ahead of the passage the listener actually needs.
  type AbandonReason = "out-of-window" | "context-changed";

  function abandonOutside(window: ReadonlySet<string>, reason: AbandonReason): void {
    for (const job of queue.filter((queued) => !window.has(queued.key))) {
      queue.splice(queue.indexOf(job), 1);
      job.reject(new DOMException(reason, "AbortError"));
    }
    for (const job of running) {
      if (!window.has(job.key)) job.controller.abort(reason);
    }
  }

  function request(segment: NarrationSegment, options: TTSOptions, urgent: boolean): Promise<Blob> {
    const key = cacheKey(segment, options);
    const existing = entries.get(key);
    if (existing) {
      if (urgent) promote(key);
      return existing;
    }

    const requestContext = context;
    const promise = enqueue(key, segment, options, urgent)
      .then((result) => {
        if (requestContext === context) record(result.synthesisMs);
        return result.blob;
      })
      .catch((error: unknown) => {
        if (entries.get(key) === promise) entries.delete(key);
        throw error;
      });
    entries.set(key, promise);
    trimCache();
    return promise;
  }

  return {
    audioFor(segment, options) {
      return request(segment, options, true);
    },

    prefetch(segments, currentIndex, options) {
      const ahead = lookahead();
      const window = new Set(
        segments.slice(currentIndex, currentIndex + ahead + 1).map((item) => cacheKey(item, options)),
      );
      abandonOutside(window, "out-of-window");
      for (let offset = 1; offset <= ahead; offset += 1) {
        const segment = segments[currentIndex + offset];
        if (!segment) break;
        void request(segment, options, false).catch(() => undefined);
      }
    },

    reset() {
      // OWASP A04:2025 Insecure Design.
      // Invalidate old promises so stale document audio cannot enter a new playback context.
      context += 1;
      abandonOutside(new Set(), "context-changed");
      entries.clear();
      fast = null;
      slow = null;
    },
  };
}

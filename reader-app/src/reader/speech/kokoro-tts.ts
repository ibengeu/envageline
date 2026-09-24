import type { NarrationSegment, TTSOptions, TTSVoice } from "../core/types.ts";
import { loadVoices } from "./kokoro-voice-manager.ts";
import { DEFAULT_KOKORO_BASE, isAllowedNarrationBase, resolveKokoroUrls } from "./kokoro-endpoint.ts";

export interface SynthesisResult {
  blob: Blob;
  synthesisMs: number;
}

export interface TTSEngine {
  initialize(): Promise<void>;
  getVoices(): Promise<TTSVoice[]>;
  speak(segment: NarrationSegment, options: TTSOptions, preparedBlob?: Blob): Promise<void>;
  synthesize(segment: NarrationSegment, options: TTSOptions, signal?: AbortSignal): Promise<SynthesisResult>;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface KokoroSpeechEngineOptions {
  base?: string;
  fetchImpl?: KokoroFetch;
  defaultVoiceId?: string;
  audioFactory?: () => KokoroAudioLike;
  urlApi?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

export type KokoroFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<KokoroResponse>;

export interface KokoroResponse {
  ok: boolean;
  status: number;
  blob?: () => Promise<Blob>;
  json?: () => Promise<unknown>;
}

export interface KokoroAudioLike {
  currentTime: number;
  playbackRate?: number;
  defaultPlaybackRate?: number;
  src?: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  play(): Promise<void> | void;
  pause(): void;
}

// Kokoro synthesizes at 0.5x-2x. Anything beyond is made up by speeding the
// audio element itself, so every rate the player offers is actually heard.
const MIN_SYNTH_SPEED = 0.5;
const MAX_SYNTH_SPEED = 2;

function synthesisSpeed(rate: number): number {
  return Math.min(MAX_SYNTH_SPEED, Math.max(MIN_SYNTH_SPEED, rate));
}

type ActivePlayback = {
  controller: AbortController;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

export class KokoroSpeechEngine implements TTSEngine {
  private readonly base: string;
  private readonly fetchImpl: KokoroFetch;
  private readonly defaultVoiceId: string;
  private readonly audioFactory: () => KokoroAudioLike;
  private readonly urlApi: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  private audio: KokoroAudioLike | null = null;
  private objectUrl: string | null = null;
  private active: ActivePlayback | null = null;
  private playbackCleanup: (() => void) | null = null;
  private playbackFailed: (() => void) | null = null;
  // Remembers a pause that arrived while audio was still being synthesized,
  // so the clip does not start on its own once it lands.
  private paused = false;

  constructor(options: KokoroSpeechEngineOptions = {}) {
    this.base = options.base ?? DEFAULT_KOKORO_BASE;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.defaultVoiceId = options.defaultVoiceId ?? "af_heart";
    this.audioFactory = options.audioFactory ?? (() => new Audio());
    this.urlApi = options.urlApi ?? URL;
  }

  async initialize(): Promise<void> {}

  async getVoices(): Promise<TTSVoice[]> {
    return loadVoices({
      base: this.base,
      defaultVoiceId: this.defaultVoiceId,
      fetchImpl: this.fetchImpl,
    });
  }

  speak(segment: NarrationSegment, options: TTSOptions, preparedBlob?: Blob): Promise<void> {
    if (!segment.spokenText.trim()) return Promise.resolve();
    // OWASP A01:2025 Broken Access Control (SSRF) - synthesis may only go to
    // Kokoro on this machine or the reader's own site, checked before any request.
    if (!isAllowedNarrationBase(this.base)) {
      return Promise.reject(new DOMException("endpoint-rejected", "SecurityError"));
    }
    this.cancelActivePlayback();
    return new Promise<void>((resolve, reject) => {
      const active: ActivePlayback = {
        controller: new AbortController(),
        resolve,
        reject,
      };
      this.active = active;
      void this.preparePlayback(segment, options, preparedBlob, active);
    });
  }

  // Cancellation belongs to the caller (the read-ahead scheduler decides what
  // is still worth preparing); stopping playback leaves prepared audio alone.
  async synthesize(
    segment: NarrationSegment,
    options: TTSOptions,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SynthesisResult> {
    if (!segment.spokenText.trim()) {
      return { blob: new Blob(), synthesisMs: 0 };
    }
    // OWASP A01:2025 Broken Access Control (SSRF) - refuse any other host
    // before fetch can reach it.
    if (!isAllowedNarrationBase(this.base)) {
      throw new DOMException("endpoint-rejected", "SecurityError");
    }
    return this.requestAudio(segment, options, signal);
  }

  pause(): void {
    this.paused = true;
    this.audio?.pause();
  }

  resume(): void {
    this.paused = false;
    if (this.audio) this.playAudio(this.audio);
  }

  stop(): void {
    this.paused = false;
    this.cancelActivePlayback();
  }

  private async preparePlayback(
    segment: NarrationSegment,
    options: TTSOptions,
    preparedBlob: Blob | undefined,
    active: ActivePlayback,
  ): Promise<void> {
    try {
      const result = preparedBlob
        ? { blob: preparedBlob, synthesisMs: 0 }
        : await this.requestAudio(segment, options, active.controller.signal);
      if (!this.isActive(active)) return;
      this.startPlayback(result.blob, active, options.rate);
    } catch (cause) {
      if (this.isActive(active)) this.finish(active, this.asPlaybackError(cause));
    }
  }

  private async requestAudio(
    segment: NarrationSegment,
    options: TTSOptions,
    signal: AbortSignal,
  ): Promise<SynthesisResult> {
    const { speechUrl } = resolveKokoroUrls(this.base);
    const startedAt = Date.now();
    try {
      // OWASP A07:2025 Injection.
      // Send segment text as a JSON value with a fixed request schema.
      const response = await this.fetchImpl(speechUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: segment.spokenText,
          voice: options.voiceId ?? this.defaultVoiceId,
          response_format: "wav",
          speed: synthesisSpeed(options.rate),
        }),
        signal,
      });
      if (!response.ok) throw new DOMException("synthesis-failed", "NotSupportedError");
      const blob = response.blob ? await response.blob() : null;
      if (!blob) throw new DOMException("synthesis-failed", "NotSupportedError");
      return { blob, synthesisMs: Math.max(0, Date.now() - startedAt) };
    } catch (cause) {
      if (signal.aborted) throw new DOMException("canceled", "AbortError");
      if (cause instanceof DOMException && cause.message === "synthesis-failed") throw cause;
      throw new DOMException("unavailable", "NotSupportedError");
    }
  }

  private cancelActivePlayback(): void {
    const active = this.active;
    this.active = null;
    active?.controller.abort();
    this.disposeAudio(true);
    active?.reject(new DOMException("canceled", "AbortError"));
  }

  private startPlayback(blob: Blob, active: ActivePlayback, rate: number): void {
    const objectUrl = this.urlApi.createObjectURL(blob);
    if (!this.isActive(active)) {
      this.urlApi.revokeObjectURL(objectUrl);
      return;
    }
    const audio = this.audioFactory();
    audio.src = objectUrl;
    // Both are set: loading a source resets playbackRate to the default rate.
    audio.defaultPlaybackRate = rate / synthesisSpeed(rate);
    audio.playbackRate = rate / synthesisSpeed(rate);
    this.audio = audio;
    this.objectUrl = objectUrl;
    const onEnded = () => this.finish(active);
    // The audio arrived; the browser could not play it. Named apart from a
    // synthesis failure so the listener is not sent to check the server.
    const onError = () =>
      this.finish(active, new DOMException("playback-failed", "NotSupportedError"));
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    this.playbackFailed = onError;
    this.playbackCleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      this.playbackFailed = null;
    };
    if (this.paused) return;
    this.playAudio(audio);
  }

  // A play() interrupted by our own pause or stop rejects with AbortError;
  // that is the listener pausing, not a failure - the clip stays loaded and
  // resume() plays it again. Any other rejection is a real playback failure.
  private playAudio(audio: KokoroAudioLike): void {
    const failed = () => this.playbackFailed?.();
    try {
      Promise.resolve(audio.play()).catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        failed();
      });
    } catch {
      failed();
    }
  }

  private asPlaybackError(cause: unknown): DOMException {
    if (cause instanceof DOMException) return cause;
    return new DOMException("unavailable", "NotSupportedError");
  }

  private isActive(active: ActivePlayback): boolean {
    return this.active === active;
  }

  private finish(active: ActivePlayback, error?: DOMException): void {
    if (!this.isActive(active)) return;
    this.active = null;
    this.disposeAudio(Boolean(error));
    if (error) active.reject(error);
    else active.resolve();
  }

  private disposeAudio(reset: boolean): void {
    this.playbackCleanup?.();
    this.playbackCleanup = null;
    if (this.audio && reset) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this.audio = null;
    this.releaseObjectUrl();
  }

  private releaseObjectUrl(): void {
    if (this.objectUrl) this.urlApi.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}

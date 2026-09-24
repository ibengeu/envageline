import assert from "node:assert/strict";
import { it } from "node:test";
import type { NarrationSegment, TTSOptions } from "../core/types.ts";
import { KokoroSpeechEngine, type KokoroResponse } from "./kokoro-tts.ts";

const segment: NarrationSegment = {
  id: "segment-1",
  documentId: "document-1",
  page: 1,
  type: "paragraph",
  originalText: "Hello world.",
  spokenText: "Hello world.",
  sourceBlockIds: ["block-1"],
  bounds: [],
  order: 0,
  paragraphId: "paragraph-1",
};

const options: TTSOptions = { rate: 1, voiceId: "af_heart" };

class FakeAudio {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  playCalls = 0;
  private readonly listeners = new Map<string, () => void>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }

  finish(): void {
    this.listeners.get("ended")?.();
  }
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

it("rejects before fetch when the configured endpoint is not loopback", async () => {
  let fetchCalls = 0;
  const engine = new KokoroSpeechEngine({
    base: "http://example.invalid:8880",
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response();
    },
  });

  await assert.rejects(
    engine.speak(segment, options),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "endpoint-rejected" &&
      error.name === "SecurityError",
  );
  assert.equal(fetchCalls, 0);
});

it("narrates through the reader's own site when built to", async () => {
  const urls: string[] = [];
  const engine = new KokoroSpeechEngine({
    base: "",
    fetchImpl: async (input) => {
      urls.push(String(input));
      return { ok: true, status: 200, blob: async () => new Blob(["wav"]) };
    },
  });

  await engine.synthesize(segment, options);

  assert.deepEqual(urls, ["/v1/audio/speech"]);
});

it("resolves without fetch when the segment has no spoken text", async () => {
  let fetchCalls = 0;
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response();
    },
  });
  const emptySegment = { ...segment, spokenText: " \n\t" };

  await engine.speak(emptySegment, options);
  assert.equal(fetchCalls, 0);
});

it("posts Kokoro speech input with the required request fields", async () => {
  let request: { url: string; init: RequestInit } | null = null;
  const engine = new KokoroSpeechEngine({
    fetchImpl: async (input, init) => {
      request = { url: String(input), init: init ?? {} };
      return new Response(null, { status: 400 });
    },
  });

  await assert.rejects(engine.speak(segment, { rate: 9, voiceId: "am_michael" }));
  const captured = request as unknown as CapturedRequest;
  assert.ok(captured);
  assert.equal(captured.url, "http://127.0.0.1:8880/v1/audio/speech");
  assert.equal(captured.init.method, "POST");
  assert.deepEqual(JSON.parse(String(captured.init.body)), {
    input: segment.spokenText,
    voice: "am_michael",
    response_format: "wav",
    speed: 2,
  });
});

it("returns prepared audio with a synthesis duration", async () => {
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["wav"]),
    }),
  });

  const result = await engine.synthesize(segment, options);

  assert.equal(result.blob.size, 3);
  assert.equal(typeof result.synthesisMs, "number");
  assert.ok(result.synthesisMs >= 0);
});

it("plays prepared audio without synthesizing it again", async () => {
  const audio = new FakeAudio();
  let fetchCalls = 0;
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(null, { status: 500 });
    },
    audioFactory: () => audio,
    urlApi: {
      createObjectURL: () => "blob:prepared",
      revokeObjectURL: () => undefined,
    },
  });

  const playback = engine.speak(segment, options, new Blob(["wav"]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(fetchCalls, 0);
  assert.equal(audio.playCalls, 1);
  audio.finish();
  await playback;
});

it("classifies a network failure as unavailable", async () => {
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });

  await assert.rejects(
    engine.speak(segment, options),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "unavailable" &&
      error.name === "NotSupportedError",
  );
});

it("classifies a non-success response as synthesis-failed", async () => {
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => new Response(null, { status: 500 }),
  });

  await assert.rejects(
    engine.speak(segment, options),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "synthesis-failed" &&
      error.name === "NotSupportedError",
  );
});

it("resolves after successful audio playback ends", async () => {
  const audio = new FakeAudio();
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["wav"]),
    }),
    audioFactory: () => audio,
    urlApi: {
      createObjectURL: () => "blob:kokoro-1",
      revokeObjectURL: () => undefined,
    },
  });

  const playback = engine.speak(segment, options);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(audio.playCalls, 1);
  audio.finish();
  await playback;
});

it("cancels a synthesis request that is in flight", async () => {
  let resolveFetch: ((response: { ok: boolean; status: number }) => void) | undefined;
  const fetchPending = new Promise<{ ok: boolean; status: number }>((resolve) => {
    resolveFetch = resolve;
  });
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => fetchPending,
  });

  const playback = engine.speak(segment, options);
  engine.stop();
  resolveFetch?.({ ok: false, status: 500 });

  await assert.rejects(
    playback,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

it("keeps preparing upcoming audio when playback stops, so a jump can still use it", async () => {
  let abortSeen = false;
  let respond: ((response: KokoroResponse) => void) | undefined;
  const engine = new KokoroSpeechEngine({
    fetchImpl: async (_input, init) =>
      new Promise<KokoroResponse>((resolve) => {
        respond = resolve;
        init?.signal?.addEventListener("abort", () => {
          abortSeen = true;
        });
      }),
  });

  const synthesis = engine.synthesize(segment, options);
  engine.stop();
  respond?.({ ok: true, status: 200, blob: async () => new Blob(["audio"]) });

  assert.equal((await synthesis).blob.size, 5);
  assert.equal(abortSeen, false);
});

it("cancels preparing audio the requester no longer wants", async () => {
  let abortSeen = false;
  const engine = new KokoroSpeechEngine({
    fetchImpl: async (_input, init) =>
      new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          abortSeen = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  });
  const requester = new AbortController();

  const synthesis = engine.synthesize(segment, options, requester.signal);
  requester.abort("out-of-window");

  await assert.rejects(
    synthesis,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(abortSeen, true);
});

it("pauses without resetting position and resumes the same audio", async () => {
  const audio = new FakeAudio();
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["wav"]),
    }),
    audioFactory: () => audio,
    urlApi: {
      createObjectURL: () => "blob:kokoro-2",
      revokeObjectURL: () => undefined,
    },
  });

  const playback = engine.speak(segment, options);
  await new Promise((resolve) => setTimeout(resolve, 0));
  audio.currentTime = 12.5;
  engine.pause();
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 12.5);
  engine.resume();
  assert.equal(audio.playCalls, 2);
  assert.equal(audio.currentTime, 12.5);
  audio.finish();
  await playback;
});

// Behaves like a browser media element while its source is still loading:
// play() stays pending, and pause() in that window rejects it with AbortError
// ("The play() request was interrupted by a call to pause()").
class LoadingAudio extends FakeAudio {
  private rejectPending: ((cause: unknown) => void) | null = null;

  override play(): Promise<void> {
    this.playCalls += 1;
    this.paused = false;
    return new Promise((_resolve, reject) => {
      this.rejectPending = reject;
    });
  }

  override pause(): void {
    this.paused = true;
    this.rejectPending?.(new DOMException("The play() request was interrupted by a call to pause().", "AbortError"));
    this.rejectPending = null;
  }
}

it("pausing in the instant a passage starts is not a failure; resuming plays it to the end", async () => {
  const audio = new LoadingAudio();
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => ({ ok: true, status: 200, blob: async () => new Blob(["wav"]) }),
    audioFactory: () => audio,
    urlApi: { createObjectURL: () => "blob:kokoro-3", revokeObjectURL: () => undefined },
  });

  const playback = engine.speak(segment, options);
  await new Promise((resolve) => setTimeout(resolve, 0));
  engine.pause();
  await new Promise((resolve) => setTimeout(resolve, 0));
  engine.resume();
  audio.finish();

  await playback;
  assert.equal(audio.playCalls, 2);
});

it("reports a browser refusing to play as a playback problem, not a speech-server one", async () => {
  const audio = new FakeAudio();
  audio.play = () => Promise.reject(new DOMException("play() needs a user gesture", "NotAllowedError"));
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => ({ ok: true, status: 200, blob: async () => new Blob(["wav"]) }),
    audioFactory: () => audio,
    urlApi: { createObjectURL: () => "blob:kokoro-4", revokeObjectURL: () => undefined },
  });

  await assert.rejects(
    engine.speak(segment, options),
    (error: unknown) => error instanceof DOMException && error.message === "playback-failed",
  );
});

it("stops playback, resets position, and revokes the object URL", async () => {
  const audio = new FakeAudio();
  const revokedUrls: string[] = [];
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["wav"]),
    }),
    audioFactory: () => audio,
    urlApi: {
      createObjectURL: () => "blob:kokoro-3",
      revokeObjectURL: (url) => revokedUrls.push(url),
    },
  });

  const playback = engine.speak(segment, options);
  await new Promise((resolve) => setTimeout(resolve, 0));
  audio.currentTime = 8;
  engine.stop();

  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
  assert.deepEqual(revokedUrls, ["blob:kokoro-3"]);
  await assert.rejects(
    playback,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

it("stays silent when paused before the synthesized audio arrives, until resumed", async () => {
  const audio = new FakeAudio();
  let deliver: (() => void) | undefined;
  const arrived = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  const engine = new KokoroSpeechEngine({
    fetchImpl: async () => {
      await arrived;
      return { ok: true, status: 200, blob: async () => new Blob(["wav"]) };
    },
    audioFactory: () => audio,
    urlApi: { createObjectURL: () => "blob:kokoro-4", revokeObjectURL: () => undefined },
  });

  const playback = engine.speak(segment, options);
  engine.pause();
  deliver?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(audio.paused, true);

  engine.resume();
  assert.equal(audio.paused, false);
  audio.finish();
  await playback;
});

it("plays at the requested speed even beyond the synthesizer's own speed limit", async () => {
  const audio = new FakeAudio();
  let synthesizedSpeed = 0;
  const engine = new KokoroSpeechEngine({
    fetchImpl: async (_input, init) => {
      synthesizedSpeed = JSON.parse(String(init?.body)).speed;
      return { ok: true, status: 200, blob: async () => new Blob(["wav"]) };
    },
    audioFactory: () => audio,
    urlApi: { createObjectURL: () => "blob:kokoro-5", revokeObjectURL: () => undefined },
  });

  const playback = engine.speak(segment, { ...options, rate: 3 });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(synthesizedSpeed * audio.playbackRate, 3);
  audio.finish();
  await playback;
});

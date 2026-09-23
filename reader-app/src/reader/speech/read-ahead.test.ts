import assert from "node:assert/strict";
import { it } from "node:test";
import type { NarrationSegment, TTSOptions } from "../core/types.ts";
import { createReadAheadScheduler, prefetchDepth, type AudioSynthesizer } from "./read-ahead.ts";

const options: TTSOptions = { rate: 1, voiceId: "af_heart" };

function segment(id: string): NarrationSegment {
  return {
    id,
    documentId: "document-1",
    page: 1,
    type: "paragraph",
    originalText: id,
    spokenText: id,
    sourceBlockIds: [id],
    bounds: [],
    order: Number(id.replace("segment-", "")),
    paragraphId: `paragraph-${id}`,
  };
}

class FakeSynthesizer implements AudioSynthesizer {
  calls: Array<{ segmentId: string; spokenText: string; options: TTSOptions }> = [];
  private readonly failures = new Set<string>();

  failNext(segmentId: string): void {
    this.failures.add(segmentId);
  }

  async synthesize(
    current: NarrationSegment,
    currentOptions: TTSOptions,
  ): Promise<{ blob: Blob; synthesisMs: number }> {
    this.calls.push({ segmentId: current.id, spokenText: current.spokenText, options: currentOptions });
    if (this.failures.delete(current.id)) throw new Error("temporary failure");
    return { blob: new Blob([current.id]), synthesisMs: 1000 };
  }
}

it("keeps the legacy adaptive depth between one and six passages", () => {
  assert.equal(prefetchDepth({ estimatedSynthesisMs: 0, chunkPlaybackMs: 9000 }), 1);
  assert.equal(prefetchDepth({ estimatedSynthesisMs: 3000, chunkPlaybackMs: 9000 }), 2);
  assert.equal(prefetchDepth({ estimatedSynthesisMs: 1000, chunkPlaybackMs: 9000 }), 6);
  assert.equal(prefetchDepth({ estimatedSynthesisMs: -1, chunkPlaybackMs: 9000 }), 1);
});

it("shares one synthesis request for the same passage and settings", async () => {
  const synthesizer = new FakeSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer);
  const current = segment("segment-1");

  const first = scheduler.audioFor(current, options);
  const second = scheduler.audioFor(current, options);

  assert.strictEqual(first, second);
  await first;
  assert.equal(synthesizer.calls.length, 1);
});

it("prepares upcoming passages without making a background failure fatal", async () => {
  const synthesizer = new FakeSynthesizer();
  synthesizer.failNext("segment-2");
  const scheduler = createReadAheadScheduler(synthesizer);
  const passages = [segment("segment-1"), segment("segment-2"), segment("segment-3")];

  assert.doesNotThrow(() => scheduler.prefetch(passages, 0, options));
  await scheduler.audioFor(passages[0]!, options);
  await new Promise((resolve) => setTimeout(resolve, 0));
  scheduler.prefetch(passages, 0, options);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(synthesizer.calls.filter((call) => call.segmentId === "segment-2").length, 2);
  assert.equal(synthesizer.calls.filter((call) => call.segmentId === "segment-3").length, 1);
  await scheduler.audioFor(passages[1]!, options);
  assert.equal(synthesizer.calls.filter((call) => call.segmentId === "segment-2").length, 2);
});

it("separates settings and evicts old entries from the bounded cache", async () => {
  const synthesizer = new FakeSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer, { maxEntries: 2 });
  const first = segment("segment-1");
  const second = segment("segment-2");
  const third = segment("segment-3");

  await scheduler.audioFor(first, options);
  await scheduler.audioFor(second, options);
  await scheduler.audioFor(third, options);
  await scheduler.audioFor(first, { ...options, rate: 1.1 });
  await scheduler.audioFor(first, options);

  assert.equal(synthesizer.calls.filter((call) => call.segmentId === "segment-1").length, 3);
  assert.equal(synthesizer.calls.filter((call) => call.options.rate === 1.1).length, 1);
});

it("does not reuse a completion that belongs to a reset context", async () => {
  const synthesizer = new FakeSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer);
  const current = segment("segment-1");

  const oldAudio = scheduler.audioFor(current, options);
  scheduler.reset();
  await oldAudio;
  await scheduler.audioFor(current, options);

  assert.equal(synthesizer.calls.length, 2);
});

it("speaks a sentence's new wording when a recompile changed it under the same id", async () => {
  const synthesizer = new FakeSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer);
  const before = { ...segment("segment-1"), spokenText: "The results were" };
  const after = { ...before, spokenText: "The results were conclusive." };

  await scheduler.audioFor(before, options);
  await scheduler.audioFor(after, options);

  assert.deepEqual(
    synthesizer.calls.map((call) => call.spokenText),
    ["The results were", "The results were conclusive."],
  );
});

it("synthesizes a repeated sentence once when its wording and settings match", async () => {
  const synthesizer = new FakeSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer);
  const first = { ...segment("segment-1"), spokenText: "See figure two." };
  const repeat = { ...segment("segment-9"), spokenText: "See figure two." };

  await scheduler.audioFor(first, options);
  await scheduler.audioFor(repeat, options);

  assert.equal(synthesizer.calls.length, 1);
});

// A synthesizer whose requests stay in flight until the test lets each one
// finish, so the order and overlap of requests the server sees is observable.
class GatedSynthesizer implements AudioSynthesizer {
  started: string[] = [];
  aborted: string[] = [];
  inFlight = 0;
  mostAtOnce = 0;
  private readonly pending = new Map<string, () => void>();

  synthesize(
    current: NarrationSegment,
    _options: TTSOptions,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; synthesisMs: number }> {
    this.started.push(current.id);
    this.inFlight += 1;
    this.mostAtOnce = Math.max(this.mostAtOnce, this.inFlight);
    return new Promise((resolve, reject) => {
      const done = () => {
        this.inFlight -= 1;
        this.pending.delete(current.id);
      };
      this.pending.set(current.id, () => {
        done();
        resolve({ blob: new Blob([current.id]), synthesisMs: 500 });
      });
      signal?.addEventListener("abort", () => {
        done();
        this.aborted.push(current.id);
        reject(new DOMException("canceled", "AbortError"));
      });
    });
  }

  async finish(id: string): Promise<void> {
    this.pending.get(id)?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

it("keeps the speech server working on two passages at once, never more", async () => {
  // Measured on the local Kokoro server: two requests at once give ~1.6x
  // realtime against ~1.1x for one at a time; a third adds almost nothing.
  const synthesizer = new GatedSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer);
  const passages = Array.from({ length: 12 }, (_, index) => segment(`segment-${index}`));
  const playing = scheduler.audioFor(passages[0]!, options);
  await tick();
  await synthesizer.finish("segment-0");
  await playing;

  scheduler.prefetch(passages, 0, options);
  await tick();
  for (let index = 1; index <= 6; index += 1) await synthesizer.finish(`segment-${index}`);

  assert.equal(synthesizer.mostAtOnce, 2);
});

it("prepares the passage the listener is waiting for before queued read-ahead", async () => {
  const synthesizer = new GatedSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer, { concurrency: 1 });
  const passages = Array.from({ length: 12 }, (_, index) => segment(`segment-${index}`));
  const playing = scheduler.audioFor(passages[0]!, options);
  await tick();
  await synthesizer.finish("segment-0");
  await playing;

  scheduler.prefetch(passages, 0, options);
  await tick();
  void scheduler.audioFor(passages[10]!, options);
  await synthesizer.finish("segment-1");

  assert.deepEqual(synthesizer.started.slice(0, 3), ["segment-0", "segment-1", "segment-10"]);
});

it("prepares a passage already queued for read-ahead next, and only once, when the listener jumps to it", async () => {
  const synthesizer = new GatedSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer, { concurrency: 1 });
  const passages = Array.from({ length: 12 }, (_, index) => segment(`segment-${index}`));
  const playing = scheduler.audioFor(passages[0]!, options);
  await tick();
  await synthesizer.finish("segment-0");
  await playing;

  scheduler.prefetch(passages, 0, options);
  await tick();
  void scheduler.audioFor(passages[5]!, options);
  await synthesizer.finish("segment-1");
  await synthesizer.finish("segment-5");

  assert.equal(synthesizer.started[2], "segment-5");
  assert.equal(synthesizer.started.filter((id) => id === "segment-5").length, 1);
});

it("abandons read-ahead left behind by a jump instead of making the listener wait for it", async () => {
  const synthesizer = new GatedSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer, { concurrency: 1 });
  const passages = Array.from({ length: 40 }, (_, index) => segment(`segment-${index}`));
  const playing = scheduler.audioFor(passages[0]!, options);
  await tick();
  await synthesizer.finish("segment-0");
  await playing;
  scheduler.prefetch(passages, 0, options);
  await tick();

  void scheduler.audioFor(passages[20]!, options);
  scheduler.prefetch(passages, 20, options);
  await tick();
  await synthesizer.finish("segment-20");

  assert.deepEqual(synthesizer.aborted, ["segment-1"]);
  assert.deepEqual(synthesizer.started.slice(0, 3), ["segment-0", "segment-1", "segment-20"]);
  assert.ok(!synthesizer.started.includes("segment-2"));
});

it("drops audio still being prepared for the old voice or speed once they change", async () => {
  const synthesizer = new GatedSynthesizer();
  const scheduler = createReadAheadScheduler(synthesizer, { concurrency: 1 });
  const passages = Array.from({ length: 12 }, (_, index) => segment(`segment-${index}`));
  const playing = scheduler.audioFor(passages[0]!, options);
  await tick();
  await synthesizer.finish("segment-0");
  await playing;
  scheduler.prefetch(passages, 0, options);
  await tick();

  scheduler.reset();
  void scheduler.audioFor(passages[1]!, { ...options, rate: 1.5 });
  await tick();

  assert.deepEqual(synthesizer.aborted, ["segment-1"]);
  assert.deepEqual(synthesizer.started, ["segment-0", "segment-1", "segment-1"]);
});

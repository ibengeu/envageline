import assert from "node:assert/strict";
import { it } from "node:test";
import { reportTtsFailure } from "./controller-failure.ts";
import { useReaderStore } from "./core/store.ts";
import type { NarrationSegment, TTSOptions } from "./core/types.ts";
import {
  closestSegment,
  findSegmentByBlockId,
  getActiveReadingProfileId,
  resolveHover,
  setReadingProfile,
  speakSegment,
} from "./controller.ts";

const options: TTSOptions = { rate: 1, voiceId: "af_heart" };

function segment(overrides: Partial<NarrationSegment> = {}): NarrationSegment {
  return {
    id: "segment-1",
    documentId: "document-1",
    page: 1,
    type: "paragraph",
    originalText: "text",
    spokenText: "text",
    sourceBlockIds: [],
    bounds: [],
    order: 0,
    paragraphId: "paragraph-1",
    ...overrides,
  };
}

function recordingDeps(overrides: Partial<Parameters<typeof speakSegment>[2]> = {}) {
  const calls: string[] = [];
  const deps: Parameters<typeof speakSegment>[2] = {
    tts: {
      speak: async () => {
        calls.push("speak");
      },
    },
    readAhead: {
      audioFor: async () => {
        calls.push("audioFor");
        return new Blob();
      },
    },
    sleep: async (ms: number) => {
      calls.push(`sleep:${ms}`);
    },
    isCurrent: () => true,
    isContextStale: () => false,
    ...overrides,
  };
  return { deps, calls };
}

it("surfaces local narration unavailability as a playback error", () => {
  const store = useReaderStore.getState();
  store.setError(null);
  store.setNotice(null);
  store.patchPlayback({ status: "playing" });

  reportTtsFailure(new DOMException("unavailable", "NotSupportedError"));

  const state = useReaderStore.getState();
  assert.equal(state.playback.status, "error");
  assert.match(state.notice ?? "", /local narration is unavailable/i);
});

it("never asks a visitor of the hosted reader to start a local server", () => {
  for (const kind of ["unavailable", "synthesis-failed"]) {
    const store = useReaderStore.getState();
    store.setError(null);
    store.setNotice(null);

    reportTtsFailure(new DOMException(kind, "NotSupportedError"), { hosted: true });

    const state = useReaderStore.getState();
    const shown = `${state.notice ?? ""} ${state.error?.message ?? ""}`;
    assert.match(shown, /try again/i, kind);
    assert.doesNotMatch(shown, /local|kokoro/i, kind);
  }
});

it("allows the reader to select and persist a non-default reading profile", async () => {
  await setReadingProfile("inclusive");
  assert.equal(getActiveReadingProfileId(), "inclusive");
  await setReadingProfile("audiobook");
  assert.equal(getActiveReadingProfileId(), "audiobook");
});

it("surfaces a synthesis failure as a passage error", () => {
  const store = useReaderStore.getState();
  store.setError(null);
  store.setNotice(null);
  store.patchPlayback({ status: "playing" });

  reportTtsFailure(new DOMException("synthesis-failed", "NotSupportedError"));

  const state = useReaderStore.getState();
  assert.equal(state.playback.status, "error");
  assert.equal(state.notice, null);
  assert.match(state.error?.message ?? "", /passage/i);
  assert.doesNotMatch(state.error?.message ?? "", /local narration is unavailable/i);
});

it("tells the listener the browser could not play a passage, without blaming the speech server", () => {
  const store = useReaderStore.getState();
  store.setError(null);
  store.setNotice(null);
  store.patchPlayback({ status: "playing" });

  reportTtsFailure(new DOMException("playback-failed", "NotSupportedError"));

  const state = useReaderStore.getState();
  assert.equal(state.playback.status, "error");
  assert.match(state.error?.message ?? "", /could not be played/i);
  assert.doesNotMatch(state.error?.message ?? "", /server/i);
});

it("pauses before and after a title, in order, around speaking it", async () => {
  const { deps, calls } = recordingDeps();
  const titleSegment = segment({
    type: "title",
    speech: { pauseBeforeMs: 180, pauseAfterMs: 280 },
  });

  const outcome = await speakSegment(titleSegment, options, deps);

  assert.deepEqual(calls, ["sleep:180", "audioFor", "speak", "sleep:280"]);
  assert.equal(outcome, "completed");
});

it("does not pause when the segment has no configured pause", async () => {
  const { deps, calls } = recordingDeps();
  const plainSegment = segment({ type: "paragraph" });

  const outcome = await speakSegment(plainSegment, options, deps);

  assert.deepEqual(calls, ["audioFor", "speak"]);
  assert.equal(outcome, "completed");
});

it("stops without speaking when playback is superseded before audio arrives", async () => {
  let currentCalls = 0;
  const { deps, calls } = recordingDeps({
    isCurrent: () => {
      currentCalls += 1;
      return currentCalls === 1;
    },
  });
  const titleSegment = segment({
    type: "title",
    speech: { pauseBeforeMs: 180, pauseAfterMs: 280 },
  });

  const outcome = await speakSegment(titleSegment, options, deps);

  assert.deepEqual(calls, ["sleep:180", "audioFor"]);
  assert.equal(outcome, "aborted");
});

it("skips speaking and reports stale context when voice/rate changed mid-fetch", async () => {
  const { deps, calls } = recordingDeps({ isContextStale: () => true });
  const plainSegment = segment({ type: "paragraph" });

  const outcome = await speakSegment(plainSegment, options, deps);

  assert.deepEqual(calls, ["audioFor"]);
  assert.equal(outcome, "stale-context");
});

it("resolves a tap in the gap between lines to the vertically nearer line, not the horizontally nearer one", () => {
  // A short line ends early (a heading, or the last line of a paragraph),
  // directly above the start of the next, full-width paragraph.
  const shortLine = segment({
    id: "short-line",
    bounds: [{ x: 0.1, y: 0.2, width: 0.15, height: 0.02 }],
  });
  const nextParagraph = segment({
    id: "next-paragraph",
    bounds: [{ x: 0.1, y: 0.24, width: 0.8, height: 0.02 }],
  });

  // Tapped just below the short line, but far to the right - past where the
  // short line ends, though still within the next paragraph's own line width.
  const found = closestSegment([shortLine, nextParagraph], 0.6, 0.215);

  assert.equal(found?.id, "short-line");
});

it("prefers a box the tap actually lands inside over any nearer box outside it", () => {
  const above = segment({
    id: "above",
    bounds: [{ x: 0.1, y: 0.1, width: 0.8, height: 0.02 }],
  });
  const tapped = segment({
    id: "tapped",
    bounds: [{ x: 0.1, y: 0.14, width: 0.8, height: 0.02 }],
  });

  const found = closestSegment([above, tapped], 0.15, 0.15);

  assert.equal(found?.id, "tapped");
});

it("finds the segment that owns a clicked block id exactly, ignoring geometry", () => {
  const first = segment({ id: "seg-1", sourceBlockIds: ["p1-b0", "p1-b1"] });
  const second = segment({ id: "seg-2", sourceBlockIds: ["p1-b2"] });

  const found = findSegmentByBlockId([first, second], "p1-b2");

  assert.equal(found?.id, "seg-2");
});

it("returns null for a block id no segment owns, such as a skipped header", () => {
  const first = segment({ id: "seg-1", sourceBlockIds: ["p1-b0"] });

  const found = findSegmentByBlockId([first], "p1-b99");

  assert.equal(found, null);
});

it("resolves hover to the segment owning the hovered block id", () => {
  const first = segment({ id: "seg-1", sourceBlockIds: ["p1-b0"] });
  const second = segment({ id: "seg-2", sourceBlockIds: ["p1-b1"] });

  const next = resolveHover({
    segments: [first, second],
    previousHover: null,
    previousBlockId: null,
    blockId: "p1-b1",
  });

  assert.equal(next.hover?.id, "seg-2");
  assert.equal(next.blockId, "p1-b1");
});

it("clears hover when the pointer leaves every block", () => {
  const first = segment({ id: "seg-1", sourceBlockIds: ["p1-b0"] });

  const next = resolveHover({
    segments: [first],
    previousHover: first,
    previousBlockId: "p1-b0",
    blockId: undefined,
  });

  assert.equal(next.hover, null);
  assert.equal(next.blockId, null);
});

it("keeps the same hover reference when the pointer moves within the same block", () => {
  const first = segment({ id: "seg-1", sourceBlockIds: ["p1-b0"] });

  const next = resolveHover({
    segments: [first],
    previousHover: first,
    previousBlockId: "p1-b0",
    blockId: "p1-b0",
  });

  assert.equal(next.hover, first);
  assert.equal(next.skipped, true);
});

it("drops a stale hover that no longer exists in a freshly recompiled segment list", () => {
  const stale = segment({ id: "seg-1", sourceBlockIds: ["p1-b0"] });
  // The page recompiled: seg-1 is gone, but a mouse move hasn't happened yet
  // to naturally refresh hover state, so the caller re-resolves against the
  // new segments using the same blockId the pointer was last over.
  const next = resolveHover({
    segments: [],
    previousHover: stale,
    previousBlockId: "p1-b0",
    blockId: "p1-b0",
  });

  assert.equal(next.hover, null);
});

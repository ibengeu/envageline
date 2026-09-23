import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NarrationSegment } from "../core/types.ts";
import { chapterTarget, listeningProgress, skipTarget } from "./listening.ts";

function sentence(index: number, overrides: Partial<NarrationSegment> = {}): NarrationSegment {
  return {
    id: `s${index}`,
    documentId: "book",
    page: 1 + Math.floor(index / 10),
    type: "paragraph",
    originalText: "",
    spokenText:
      "The ship left the harbour at dawn and the whole town came down to the water to watch it go.",
    sourceBlockIds: [],
    bounds: [],
    order: index,
    paragraphId: `p${index}`,
    ...overrides,
  };
}

const book = Array.from({ length: 40 }, (_, index) => sentence(index));

describe("skip intervals", () => {
  it("skips further for a longer interval and always moves at least one sentence", () => {
    const short = skipTarget(book, 10, 10, 1);
    const long = skipTarget(book, 10, 60, 1);

    assert.ok(short > 10);
    assert.ok(long > short);
    assert.ok(skipTarget(book, 10, -60, 1) < skipTarget(book, 10, -10, 1));
    assert.ok(skipTarget(book, 10, -10, 1) < 10);
  });

  it("stops at the first and last sentences instead of running off either end", () => {
    assert.equal(skipTarget(book, 0, -30, 1), 0);
    assert.equal(skipTarget(book, 39, 30, 1), 39);
    assert.equal(skipTarget(book, 38, 600, 1), 39);
  });
});

describe("listening progress", () => {
  it("advances through the book, shrinking the time left, and finishes at 100%", () => {
    const start = listeningProgress(book, 0, 1);
    const middle = listeningProgress(book, 20, 1);
    const end = listeningProgress(book, 39, 1);

    assert.equal(start.percent, 0);
    assert.ok(middle.percent > 40 && middle.percent < 60);
    assert.ok(middle.remainingSeconds < start.remainingSeconds);
    assert.ok(listeningProgress(book, 20, 2).remainingSeconds < middle.remainingSeconds);
    assert.equal(end.percent, 100);
  });
});

describe("chapter navigation", () => {
  const chapters = book.map((item, index) =>
    index % 10 === 0 ? { ...item, type: "heading" as const, spokenText: `Chapter ${index / 10 + 1}` } : item,
  );

  it("jumps to the next chapter, and reports none after the last", () => {
    assert.equal(chapterTarget(chapters, 3, 1), 10);
    assert.equal(chapterTarget(chapters, 10, 1), 20);
    assert.equal(chapterTarget(chapters, 35, 1), null);
  });

  it("goes back to the start of the current chapter, then to the one before", () => {
    assert.equal(chapterTarget(chapters, 14, -1), 10);
    assert.equal(chapterTarget(chapters, 10, -1), 0);
    assert.equal(chapterTarget(chapters, 0, -1), 0);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NarrationSegment, RecentDocument } from "../core/types.ts";
import { latestDocument, progressToSave, restoredSegment } from "./position.ts";

const sentence = (id: string, page: number): NarrationSegment => ({
  id,
  documentId: "book",
  page,
  type: "paragraph",
  originalText: id,
  spokenText: id,
  sourceBlockIds: [],
  bounds: [],
  order: 0,
  paragraphId: id,
});

const book = [sentence("a", 1), sentence("b", 2), sentence("c", 2), sentence("d", 3)];

describe("restoring the listening position", () => {
  it("returns to the page the listener was on when the saved sentence no longer exists", () => {
    const restored = restoredSegment(book, { segmentId: "gone", page: 2, segmentIndex: 0 });

    assert.equal(restored?.id, "b");
  });

  it("returns to the exact sentence that was playing when it still exists", () => {
    assert.equal(restoredSegment(book, { segmentId: "c", page: 2, segmentIndex: 2 })?.id, "c");
  });

  it("never overwrites a saved position with an empty one while a book is still opening", () => {
    assert.equal(progressToSave("book", null, 1), null);
    assert.equal(progressToSave("book", sentence("c", 2), 1)?.segmentId, "c");
  });
});

const doc = (id: string, lastOpenedAt: number, listenedAt?: number): RecentDocument => ({
  id,
  filename: `${id}.pdf`,
  pageCount: 10,
  createdAt: 0,
  lastOpenedAt,
  processingVersion: 1,
  byteLength: 1,
  progress:
    listenedAt === undefined
      ? undefined
      : { documentId: id, page: 3, segmentId: null, segmentIndex: 0, updatedAt: listenedAt },
});

describe("choosing the book to continue", () => {
  it("offers the book with the most recent activity", () => {
    const recents = [doc("older", 100), doc("newest", 300), doc("middle", 200)];
    assert.equal(latestDocument(recents)?.id, "newest");
  });

  it("counts listening as activity, so the book being listened to stays on offer", () => {
    // Opened at 100 and listened to until 500; the other was opened at 300.
    const recents = [doc("glanced", 300), doc("listening", 100, 500)];
    assert.equal(latestDocument(recents)?.id, "listening");
  });

  it("offers nothing when no book has been opened yet", () => {
    assert.equal(latestDocument([]), null);
  });
});

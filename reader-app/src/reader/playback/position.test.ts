import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NarrationSegment } from "../core/types.ts";
import { progressToSave, restoredSegment } from "./position.ts";

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

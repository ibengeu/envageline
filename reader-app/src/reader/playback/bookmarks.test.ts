import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addBookmark, MAX_BOOKMARKS, MAX_NOTE_LENGTH } from "./bookmarks.ts";

const at = (segmentId: string, order: number, note = "") => ({
  segmentId,
  order,
  page: 1,
  excerpt: "The ship left the harbour.",
  note,
  createdAt: 0,
});

describe("bookmarks", () => {
  it("keeps one bookmark per sentence, listed in book order", () => {
    let list = addBookmark([], at("s9", 9));
    list = addBookmark(list, at("s2", 2));
    list = addBookmark(list, at("s9", 9, "second thoughts"));

    assert.deepEqual(list.map((mark) => mark.segmentId), ["s2", "s9"]);
    assert.equal(list[1]?.note, "second thoughts");
  });

  it("strips control characters, caps note length, and bounds how many are kept", () => {
    const noisy = addBookmark([], at("s1", 1, `hello\u0000\u001b[31m${"x".repeat(5000)}`));
    // eslint-disable-next-line no-control-regex -- asserting control characters are gone
    assert.doesNotMatch(noisy[0]!.note, /[\u0000-\u001f]/);
    assert.ok(noisy[0]!.note.length <= MAX_NOTE_LENGTH);

    let many = noisy;
    for (let index = 2; index < MAX_BOOKMARKS + 50; index += 1) many = addBookmark(many, at(`s${index}`, index));
    assert.equal(many.length, MAX_BOOKMARKS);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NarrationSegment } from "../core/types.ts";
import { nextAfter, resolveSegment } from "./resolve.ts";

function sentence(id: string, spokenText: string, sourceBlockIds: string[]): NarrationSegment {
  return {
    id,
    documentId: "doc",
    page: 3,
    type: "paragraph",
    originalText: spokenText,
    spokenText,
    sourceBlockIds,
    bounds: [],
    order: 0,
    paragraphId: "paragraph",
  };
}

describe("finding where the listener is after the page recompiles", () => {
  it("finds the sentence being read when nothing about it changed", () => {
    const page = [
      sentence("doc-p3-b0-s0", "First sentence.", ["p3-b0"]),
      sentence("doc-p3-b0-s1", "Second sentence.", ["p3-b0", "p3-b1"]),
      sentence("doc-p3-b0-s2", "Third sentence.", ["p3-b1"]),
    ];
    assert.equal(resolveSegment(page[1]!, page), 1);
  });

  it("finds the sentence after layout analysis regrouped its paragraph under a new id", () => {
    const before = sentence("doc-p3-b4-s0", "Second sentence.", ["p3-b4"]);
    const after = [
      sentence("doc-p3-b2-s0", "First sentence.", ["p3-b2", "p3-b3"]),
      sentence("doc-p3-b2-s1", "Second sentence.", ["p3-b4"]),
      sentence("doc-p3-b2-s2", "Third sentence.", ["p3-b5"]),
    ];
    assert.equal(resolveSegment(before, after), 1);
  });

  it("finds the same sentence, not its neighbour, when an earlier sentence in the paragraph was dropped", () => {
    // Before: s0 "See note 3.", s1 "Rates rose.", s2 "Prices fell."
    // A footnote-reference filter drops s0, so every later -s{index} shifts
    // and the old id doc-p3-b0-s1 now names "Prices fell.".
    const before = sentence("doc-p3-b0-s1", "Rates rose.", ["p3-b0"]);
    const after = [
      sentence("doc-p3-b0-s0", "Rates rose.", ["p3-b0"]),
      sentence("doc-p3-b0-s1", "Prices fell.", ["p3-b0"]),
    ];
    assert.equal(resolveSegment(before, after), 0);
  });

  it("finds the sentence that now holds the ending when the sentence grew", () => {
    // The paragraph ran onto a page that had not been analysed yet; once it
    // is, the last sentence absorbs the continuation.
    const before = sentence("doc-p3-b7-s1", "The results were", ["p3-b8"]);
    const after = [
      sentence("doc-p3-b7-s0", "Earlier sentence.", ["p3-b7"]),
      sentence("doc-p3-b7-s1", "The results were conclusive across all trials.", ["p3-b8", "p4-b0"]),
    ];
    assert.equal(resolveSegment(before, after), 1);
  });

  it("stays on the same printed words when a profile change rewrites how they are spoken", () => {
    const before = sentence("doc-p3-b2-s0", "Dr. Smith agreed.", ["p3-b2"]);
    const after = [
      sentence("doc-p3-b1-s0", "Heading.", ["p3-b1"]),
      sentence("doc-p3-b2-s0", "Doctor Smith agreed, see figure two.", ["p3-b2"]),
    ];
    assert.equal(resolveSegment(before, after), 1);
  });

  it("reports that it cannot tell, rather than guessing, when nothing still shares its text", () => {
    const before = sentence("doc-p3-b2-s0", "Scanned words.", ["p3-b2"]);
    const after = [
      sentence("doc-p3-ocr0-s0", "Recognised words.", ["p3-ocr0"]),
      sentence("doc-p3-ocr1-s0", "More recognised words.", ["p3-ocr1"]),
    ];
    assert.equal(resolveSegment(before, after), null);
  });
});

describe("choosing what to read next", () => {
  it("still reads the rest of the page after the page recompiles mid-sentence under new ids", () => {
    const speaking = sentence("doc-p3-b0-s1", "Second sentence.", ["p3-b1"]);
    const recompiled = [
      sentence("doc-p3-b1-s0", "Second sentence.", ["p3-b1"]),
      sentence("doc-p3-b1-s1", "Third sentence.", ["p3-b2"]),
    ];
    assert.deepEqual(nextAfter(speaking, recompiled), { kind: "next", segment: recompiled[1] });
  });

  it("moves on to the next page only after the last sentence of this one", () => {
    const page = [sentence("a", "Only.", ["p3-b0"]), sentence("b", "Last.", ["p3-b1"])];
    assert.deepEqual(nextAfter(page[1]!, page), { kind: "end-of-page" });
  });

  it("says so when it cannot place the sentence just read, instead of pretending the page ended", () => {
    const speaking = sentence("gone", "Vanished.", ["p3-b9"]);
    const page = [sentence("a", "Other.", ["p3-b0"])];
    assert.deepEqual(nextAfter(speaking, page), { kind: "unresolved" });
  });
});

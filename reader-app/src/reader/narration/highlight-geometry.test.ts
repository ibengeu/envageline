import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BoundingBox } from "../core/types.ts";
import { mapSentenceBounds, mapSentenceLineIndexes, placeSentences } from "./highlight-geometry.ts";

function line(text: string, x: number, y: number): { text: string; bounds: BoundingBox } {
  return { text, bounds: { x, y, width: 0.4, height: 0.03 } };
}

it("maps each sentence to only its matching source line", () => {
  const result = mapSentenceBounds(
    ["First sentence.", "Second sentence."],
    [line("First sentence.", 0.1, 0.2), line("Second sentence.", 0.1, 0.24)],
  );

  assert.deepEqual(result, [
    [{ x: 0.1, y: 0.2, width: 0.4, height: 0.03 }],
    [{ x: 0.1, y: 0.24, width: 0.4, height: 0.03 }],
  ]);
});

it("maps a sentence across lines and skips removed source tokens", () => {
  const result = mapSentenceBounds(
    ["Revenue increased this year."],
    [line("Revenue increased [14]", 0.1, 0.2), line("this year.", 0.1, 0.24)],
  );

  assert.deepEqual(result, [
    [
      { x: 0.1, y: 0.2, width: 0.4, height: 0.03 },
      { x: 0.1, y: 0.24, width: 0.4, height: 0.03 },
    ],
  ]);
});

it("omits invalid source rectangles", () => {
  const result = mapSentenceBounds(
    ["Visible sentence."],
    [{ text: "Visible sentence.", bounds: { x: Number.NaN, y: 0.2, width: 0.4, height: 0.03 } }],
  );

  assert.deepEqual(result, [[]]);
});

it("omits zero, non-finite, and out-of-range rectangles", () => {
  const result = mapSentenceBounds(
    ["Zero.", "Infinite.", "Outside."],
    [
      { text: "Zero.", bounds: { x: 0.2, y: 0.2, width: 0, height: 0.03 } },
      {
        text: "Infinite.",
        bounds: {
          x: 0.2,
          y: Number.POSITIVE_INFINITY,
          width: 0.4,
          height: 0.03,
        },
      },
      {
        text: "Outside.",
        bounds: { x: 0.9, y: 0.2, width: 0.2, height: 0.03 },
      },
    ],
  );

  assert.deepEqual(result, [[], [], []]);
});

it("maps each sentence to only the lines it actually spans, not the whole paragraph", () => {
  const lines = [
    line("A long paragraph starts on this first line and", 0.1, 0.1),
    line("continues onto a second line before the first", 0.1, 0.14),
    line("sentence ends right here. Then a second sentence", 0.1, 0.18),
    line("begins and runs to its own end on this line.", 0.1, 0.22),
  ];

  const indexes = mapSentenceLineIndexes(
    [
      "A long paragraph starts on this first line and continues onto a second line before the first sentence ends right here.",
      "Then a second sentence begins and runs to its own end on this line.",
    ],
    lines,
  );

  assert.deepEqual(indexes, [
    [0, 1, 2],
    [2, 3],
  ]);
});

it("matches a word that was split across a hyphenated line wrap and later rejoined", () => {
  // "to-" at the end of one line and "day" starting the next are two source
  // tokens once split on the hyphen, but dehyphenation already joined them
  // into one word ("today") in the sentence text being matched back.
  const indexes = mapSentenceLineIndexes(
    ["A person would have to be deaf and blind and locked away in a cave today not to notice the emergence"],
    [
      line("A person would have to be deaf and blind and locked away in a cave to-", 0.1, 0.1),
      line("day not to notice the emergence", 0.1, 0.14),
    ],
  );

  assert.deepEqual(indexes, [[0, 1]]);
});

it("still highlights a full-width line that overflows the page edge by rounding", () => {
  const result = mapSentenceBounds(
    ["Full width line."],
    [
      {
        text: "Full width line.",
        bounds: { x: 0.08, y: 0.2, width: 0.92 + 1e-9, height: 0.03 },
      },
    ],
  );

  assert.equal(result[0]?.length, 1);
  assert.ok((result[0]?.[0]?.width ?? 0) > 0.9);
});

describe("placeSentences", () => {
  it("estimates an unlocatable sentence's position instead of covering every line", () => {
    const blocks = [0.2, 0.24, 0.28, 0.32].map((y, index) => ({
      id: `b${index}`,
      page: 1,
      text: "░░░ ░░░ ░░░",
      bounds: { x: 0.1, y, width: 0.8, height: 0.03 },
    }));

    const [first, second] = placeSentences(["An opening line.", "A closing line."], blocks);

    assert.ok(first && first.length > 0 && first.length < blocks.length);
    assert.ok(second && second.length > 0 && second.length < blocks.length);
    assert.ok(Math.max(...first.map((p) => p.bounds.y)) <= Math.min(...second.map((p) => p.bounds.y)));
  });
});

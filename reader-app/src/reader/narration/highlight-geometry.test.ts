import assert from "node:assert/strict";
import { it } from "node:test";
import type { BoundingBox } from "../core/types.ts";
import { mapSentenceBounds } from "./highlight-geometry.ts";

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

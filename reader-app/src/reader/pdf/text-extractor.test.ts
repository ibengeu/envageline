import assert from "node:assert/strict";
import { it } from "node:test";
import { itemsToBlocks } from "./text-extractor.ts";

it("uses the page viewport transform for text item rectangles", () => {
  const [block] = itemsToBlocks(
    1,
    {
      items: [
        {
          str: "Rotated",
          transform: [1, 0, 0, 1, 10, 20],
          width: 30,
          height: 10,
        },
      ],
    },
    200,
    100,
    [0, 1, 1, 0, 0, 0],
  );

  assert.equal(block?.bounds.x, 0.1);
  assert.equal(block?.bounds.y, 0.1);
  assert.ok(Math.abs((block?.bounds.width ?? 0) - 0.05) < 1e-9);
  assert.ok(Math.abs((block?.bounds.height ?? 0) - 0.3) < 1e-9);
});

it("keeps normalized geometry aligned when the viewport is scaled", () => {
  const [block] = itemsToBlocks(
    1,
    {
      items: [
        {
          str: "Scaled",
          transform: [1, 0, 0, 1, 20, 30],
          width: 30,
          height: 10,
        },
      ],
    },
    400,
    200,
    [2, 0, 0, -2, 0, 200],
  );

  assert.ok(Math.abs((block?.bounds.x ?? 0) - 0.1) < 1e-9);
  assert.ok(Math.abs((block?.bounds.y ?? 0) - 0.6) < 1e-9);
  assert.ok(Math.abs((block?.bounds.width ?? 0) - 0.15) < 1e-9);
  assert.ok(Math.abs((block?.bounds.height ?? 0) - 0.1) < 1e-9);
});

it("clips text item rectangles to the normalized page bounds", () => {
  const [block] = itemsToBlocks(
    1,
    {
      items: [
        {
          str: "Edge",
          transform: [1, 0, 0, 1, 190, 80],
          width: 30,
          height: 20,
        },
      ],
    },
    200,
    100,
  );

  assert.equal(block?.bounds.x, 0.95);
  assert.equal(block?.bounds.y, 0);
  assert.ok(Math.abs((block?.bounds.width ?? 0) - 0.05) < 1e-9);
  assert.equal(block?.bounds.height, 0.2);
});

it("places a text item at its glyph box when the font matrix carries the scale", () => {
  const [block] = itemsToBlocks(
    1,
    {
      items: [
        {
          str: "Baseline",
          transform: [12, 0, 0, 12, 72, 700],
          width: 200,
          height: 12,
        },
      ],
    },
    612,
    792,
  );

  assert.ok(Math.abs((block?.bounds.x ?? 0) - 72 / 612) < 1e-9);
  assert.ok(Math.abs((block?.bounds.width ?? 0) - 200 / 612) < 1e-9);
  assert.ok(Math.abs((block?.bounds.y ?? 0) - 80 / 792) < 1e-9);
  assert.ok(Math.abs((block?.bounds.height ?? 0) - 12 / 792) < 1e-9);
});

it("bounds a text item by its font ascent and descent when the style is known", () => {
  const [block] = itemsToBlocks(
    1,
    {
      items: [
        {
          str: "Heading",
          transform: [13, 0, 0, 13, 100, 500],
          width: 130,
          height: 13,
          fontName: "g_d0_f4",
        },
      ],
      styles: { g_d0_f4: { ascent: 0.764, descent: -0.238 } },
    },
    612,
    792,
  );

  // Glyphs run from baseline+descent to baseline+ascent, not across the full em box.
  const expectedTop = 792 - (500 + 0.764 * 13);
  const expectedHeight = (0.764 + 0.238) * 13;
  assert.ok(Math.abs((block?.bounds.y ?? 0) - expectedTop / 792) < 1e-9);
  assert.ok(Math.abs((block?.bounds.height ?? 0) - expectedHeight / 792) < 1e-9);
});

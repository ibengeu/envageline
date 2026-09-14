import assert from "node:assert/strict";
import { it } from "node:test";
import type { DocumentBlock } from "../core/types.ts";
import { groupLines } from "./paragraph-builder.ts";

function block(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
): DocumentBlock {
  return {
    id,
    page: 1,
    text,
    bounds: { x, y, width, height },
    fontSize: height,
    source: "pdf-text",
  };
}

it("keeps a line box on the body text when a taller ornament shares the line", () => {
  // A decorative marker set in a larger face, sitting slightly above the words.
  const ornament = block("b0", "❚", 0.1, 0.176, 0.01, 0.0215);
  const heading = block("b1", "The Person Who Will", 0.13, 0.178, 0.3, 0.02);

  const [line] = groupLines([ornament, heading]);

  assert.equal(line?.text, "❚ The Person Who Will");
  assert.ok(Math.abs((line?.bounds.y ?? 0) - 0.178) < 1e-9);
  assert.ok(Math.abs((line?.bounds.height ?? 0) - 0.02) < 1e-9);
});

it("ignores a leading ornament even when it opens the line", () => {
  const ornament = block("b0", "❚", 0.1, 0.176, 0.01, 0.0215);
  const heading = block("b1", "Change Your Life", 0.13, 0.178, 0.3, 0.02);
  const trailing = block("b2", "❚", 0.45, 0.176, 0.01, 0.0215);

  const [line] = groupLines([ornament, heading, trailing]);

  assert.ok(Math.abs((line?.bounds.y ?? 0) - 0.178) < 1e-9);
  assert.ok(Math.abs((line?.bounds.height ?? 0) - 0.02) < 1e-9);
  assert.ok(Math.abs((line?.bounds.x ?? 0) - 0.13) < 1e-9);
});

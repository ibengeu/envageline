import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentBlock } from "../core/types.ts";
import { layoutRenderScale } from "./pdf-engine.ts";
import { needsOcrVerification } from "./page-analyzer.ts";

function block(id: string, text: string, x: number, y: number): DocumentBlock {
  return {
    id,
    page: 1,
    text,
    bounds: { x, y, width: 0.72, height: 0.03 },
    fontSize: 0.025,
    source: "pdf-text",
  };
}

describe("needsOcrVerification", () => {
  it("requests an OCR witness for a suspicious lowercase page opener", () => {
    const blocks = [
      block("line-1", "used to think that the best person to solve a problem", 0.06, 0.1),
      block("line-2", "tion was the person who first recognized it.", 0.06, 0.15),
    ];

    assert.equal(needsOcrVerification(blocks), true);
  });

  it("keeps ordinary digital prose on the native fast path", () => {
    const blocks = [
      block("line-1", "The best person to solve a problem recognized it first.", 0.08, 0.1),
      block("line-2", "The account continues in the next paragraph.", 0.08, 0.15),
    ];

    assert.equal(needsOcrVerification(blocks), false);
  });
});

describe("layoutRenderScale", () => {
  it("bounds each raster side for an extreme page aspect ratio", () => {
    const scale = layoutRenderScale(1_000_000, 10);

    assert.ok(1_000_000 * scale <= 4_096);
    assert.ok(scale > 0);
  });

  it("rejects invalid page dimensions", () => {
    assert.throws(() => layoutRenderScale(Number.NaN, 800), /dimensions/i);
  });
});

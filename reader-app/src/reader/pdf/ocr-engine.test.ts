import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentBlock } from "../core/types.ts";
import {
  detectVisualDropCapI,
  ocrResultToBlocks,
  reconcileOcrBlocks,
  recognizePageImage,
} from "./ocr-engine.ts";

it("recognizes a solid vertical initial beside a lowercase OCR line as a drop-cap I", () => {
  const width = 20;
  const height = 50;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 4; y < 39; y += 1) {
    for (let x = 4; x < 8; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 0;
      pixels[offset + 1] = 0;
      pixels[offset + 2] = 0;
      pixels[offset + 3] = 255;
    }
  }

  const detected = detectVisualDropCapI({
    data: pixels,
    width,
    height,
    originX: 20,
    originY: 10,
    pageWidth: 200,
    pageHeight: 100,
  }, 1, 15);

  assert.equal(detected?.text, "I");
  assert.equal(detected?.source, "ocr");
  assert.ok((detected?.confidence ?? 0) < 0.8);
});

describe("ocrResultToBlocks", () => {
  it("converts OCR lines to ordered normalized document blocks", () => {
    const blocks = ocrResultToBlocks(4, {
      blocks: [{
        paragraphs: [{
          lines: [
            { text: "Chapter One", confidence: 96, bbox: { x0: 100, y0: 80, x1: 500, y1: 130 } },
            { text: "The story begins.", confidence: 91, bbox: { x0: 100, y0: 180, x1: 900, y1: 240 } },
          ],
        }],
      }],
    }, 1000, 2000);

    assert.deepEqual(blocks.map((block) => block.text), ["Chapter One", "The story begins."]);
    assert.deepEqual(blocks[0]?.bounds, { x: 0.1, y: 0.04, width: 0.4, height: 0.025 });
    assert.equal(blocks[0]?.confidence, 0.96);
    assert.equal(blocks[0]?.source, "ocr");
  });

  it("rejects malformed OCR geometry without losing valid lines", () => {
    const blocks = ocrResultToBlocks(1, {
      blocks: [{
        paragraphs: [{
          lines: [
            { text: "Invalid", confidence: 50, bbox: { x0: 0, y0: 0, x1: Number.NaN, y1: 20 } },
            { text: "Valid", confidence: 80, bbox: { x0: 10, y0: 20, x1: 80, y1: 40 } },
          ],
        }],
      }],
    }, 100, 100);

    assert.deepEqual(blocks.map((block) => block.text), ["Valid"]);
  });

  it("reconciles overlapping native and OCR witnesses without duplicate narration", () => {
    const [native] = ocrResultToBlocks(1, {
      blocks: [{ paragraphs: [{ lines: [{
        text: "The story begins.",
        confidence: 95,
        bbox: { x0: 100, y0: 100, x1: 500, y1: 150 },
      }] }] }],
    }, 1000, 1000);
    const [ocr] = ocrResultToBlocks(1, {
      blocks: [{ paragraphs: [{ lines: [{
        text: "The story begins.",
        confidence: 88,
        bbox: { x0: 90, y0: 98, x1: 520, y1: 155 },
      }] }] }],
    }, 1000, 1000);

    const reconciled = reconcileOcrBlocks([
      { ...native!, source: "pdf-text" },
    ], [ocr!]);

    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0]?.source, "mixed");
    assert.equal(reconciled[0]?.witnesses?.length, 2);
  });

  it("restores a drop-cap prefix that is missing from native PDF text", () => {
    const native: DocumentBlock[] = [{
      id: "native-line",
      page: 1,
      text: "used to think that the best person",
      bounds: { x: 0.06, y: 0.1, width: 0.72, height: 0.04 },
      fontSize: 0.035,
      source: "pdf-text",
    }];
    const ocr: DocumentBlock[] = [{
      id: "ocr-line",
      page: 1,
      text: "I used to think that the best person",
      bounds: { x: 0.03, y: 0.08, width: 0.75, height: 0.07 },
      fontSize: 0.04,
      source: "ocr",
      confidence: 0.93,
    }];

    const reconciled = reconcileOcrBlocks(native, ocr);

    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0]?.text, "I used to think that the best person");
    assert.equal(reconciled[0]?.source, "mixed");
    assert.deepEqual(reconciled[0]?.witnesses?.map((witness) => witness.text), [
      "used to think that the best person",
      "I used to think that the best person",
    ]);
  });

  it("rejects an oversized page before it starts an OCR job", async () => {
    await assert.rejects(
      recognizePageImage("unused", 1, 5000, 5000),
      /safe pixel limit/,
    );
  });
});

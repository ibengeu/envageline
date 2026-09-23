import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentBlock } from "../core/types.ts";
import {
  applyPageLayout,
  applyLayoutRegions,
  classifyLayoutPixels,
  classifyLayoutPixelsSafely,
  decodeLayoutDetections,
  verifyLayoutModelChecksum,
} from "./layout-classifier.ts";

describe("decodeLayoutDetections", () => {
  it("maps valid PP-DocLayout-S detections to normalized semantic regions", () => {
    const regions = decodeLayoutDetections(
      new Float32Array([
        0,
        0.91,
        60,
        80,
        540,
        160,
        15,
        0.96,
        120,
        760,
        480,
        792,
        5,
        0.88,
        72,
        180,
        528,
        620,
        8,
        Number.NaN,
        0,
        0,
        600,
        800,
      ]),
      4,
      600,
      800,
    );

    assert.deepEqual(
      regions.map((region) => region.role),
      ["heading", "footer", "navigation"],
    );
    assert.deepEqual(regions[0]?.bounds, {
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.1,
    });
    assert.equal(regions[1]?.modelId, "pp-doclayout-s-onnx");
  });
});

describe("verifyLayoutModelChecksum", () => {
  it("rejects model bytes that do not match the pinned checksum", async () => {
    await assert.rejects(
      verifyLayoutModelChecksum(new Uint8Array([1, 2, 3])),
      /integrity check failed/i,
    );
  });
});

describe("classifyLayoutPixels", () => {
  it("normalizes a bounded page image and decodes backend output", async () => {
    const data = new Uint8ClampedArray(480 * 480 * 4);
    data.fill(255);
    let receivedScale: Float32Array | undefined;

    const regions = await classifyLayoutPixels(
      { data, width: 480, height: 480, pageWidth: 600, pageHeight: 800 },
      {
        run: async (_image, scaleFactor) => {
          receivedScale = scaleFactor;
          return {
            detections: new Float32Array([15, 0.95, 0, 760, 600, 800]),
            count: 1,
          };
        },
      },
    );

    assert.deepEqual([...(receivedScale ?? [])], [0.6000000238418579, 0.800000011920929]);
    assert.equal(regions[0]?.role, "footer");
  });

  it("returns a diagnostic and no destructive vote when inference fails", async () => {
    const data = new Uint8ClampedArray(480 * 480 * 4);
    const result = await classifyLayoutPixelsSafely(
      { data, width: 480, height: 480, pageWidth: 600, pageHeight: 800 },
      {
        run: async () => {
          throw new Error("model unavailable");
        },
      },
    );

    assert.deepEqual(result.regions, []);
    assert.equal(result.diagnostic, "Layout classifier unavailable; retained rule-based content.");
  });

  it("retains rule-based content when inference exceeds its time limit", async () => {
    const data = new Uint8ClampedArray(480 * 480 * 4);
    const result = await classifyLayoutPixelsSafely(
      { data, width: 480, height: 480, pageWidth: 600, pageHeight: 800 },
      { run: () => new Promise(() => undefined) },
      1,
    );

    assert.deepEqual(result.regions, []);
    assert.equal(result.diagnostic, "Layout classifier unavailable; retained rule-based content.");
  });
});

describe("applyLayoutRegions", () => {
  it("adds a confident overlapping model role and provenance to a text block", () => {
    const block: DocumentBlock = {
      id: "caption-text",
      page: 3,
      text: "Figure 2. The river basin.",
      bounds: { x: 0.1, y: 0.72, width: 0.6, height: 0.05 },
      source: "pdf-text",
    };

    const result = applyLayoutRegions(
      [block],
      [
        {
          role: "caption",
          confidence: 0.93,
          bounds: { x: 0.08, y: 0.7, width: 0.66, height: 0.1 },
          modelId: "pp-doclayout-s-onnx",
          classId: 6,
        },
      ],
    );

    assert.equal(result.blocks[0]?.type, "caption");
    assert.deepEqual(result.blocks[0]?.layout, {
      modelId: "pp-doclayout-s-onnx",
      role: "caption",
      confidence: 0.93,
    });
  });

  it("keeps a text block unchanged when the model confidence is weak", () => {
    const block: DocumentBlock = {
      id: "body",
      page: 1,
      text: "The narrative continues through this paragraph.",
      bounds: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
      source: "pdf-text",
    };

    const result = applyLayoutRegions(
      [block],
      [
        {
          role: "footer",
          confidence: 0.51,
          bounds: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
          modelId: "pp-doclayout-s-onnx",
          classId: 15,
        },
      ],
    );

    assert.equal(result.blocks[0], block);
    assert.deepEqual(
      result.unmatchedRegions.map((region) => region.role),
      ["footer"],
    );
  });
});

describe("applyPageLayout", () => {
  it("retains every source block and records a diagnostic after safe fallback", () => {
    const block: DocumentBlock = {
      id: "body",
      page: 1,
      text: "Narrative text must survive model failure.",
      bounds: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
      source: "pdf-text",
    };
    const page = {
      documentId: "book",
      page: 1,
      width: 600,
      height: 800,
      blocks: [block],
      scanned: false,
      textLength: block.text.length,
    };

    const result = applyPageLayout(page, {
      regions: [],
      diagnostic: "Layout classifier unavailable; retained rule-based content.",
    });

    assert.equal(result.blocks[0], block);
    assert.equal(result.layoutAttempted, true);
    assert.deepEqual(result.diagnostics, [
      "Layout classifier unavailable; retained rule-based content.",
    ]);
  });
});

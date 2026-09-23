import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentElement } from "../core/types.ts";
import { applyLayoutVote } from "./ambiguous-classifier.ts";

function paragraph(): DocumentElement {
  return {
    id: "p",
    page: 1,
    text: "A visual item near this text.",
    bounds: [{ x: 0.7, y: 0.3, width: 0.2, height: 0.1 }],
    sourceBlockIds: ["b"],
    source: "pdf-text",
    role: "paragraph",
    roleConfidence: 0.7,
    omissionConfidence: 0,
    evidence: [],
    relationships: [],
    readingOrder: 0,
  };
}

describe("applyLayoutVote", () => {
  it("accepts a confident optional layout vote without raising omission confidence", () => {
    const result = applyLayoutVote(paragraph(), {
      classify: () => ({ role: "sidebar", confidence: 0.92, modelId: "local-layout-v1" }),
    });

    assert.equal(result.role, "sidebar");
    assert.equal(result.roleConfidence, 0.92);
    assert.equal(result.omissionConfidence, 0);
    assert.equal(result.evidence[0]?.signal, "layout-model");
  });

  it("abstains on a weak vote and keeps the narrative element", () => {
    const result = applyLayoutVote(paragraph(), {
      classify: () => ({ role: "callout", confidence: 0.54, modelId: "local-layout-v1" }),
    });

    assert.equal(result.role, "paragraph");
    assert.equal(result.omissionConfidence, 0);
  });
});

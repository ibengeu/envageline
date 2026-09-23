import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentElement } from "../core/types.ts";
import {
  AUDIOBOOK_READING_PROFILE,
  INCLUSIVE_READING_PROFILE,
  decideReadingAction,
} from "./reading-profile.ts";

function element(role: DocumentElement["role"], omissionConfidence: number): DocumentElement {
  return {
    id: `element-${role}`,
    page: 1,
    text: "Visible source text",
    bounds: [{ x: 0.1, y: 0.1, width: 0.8, height: 0.03 }],
    sourceBlockIds: ["block-1"],
    source: "pdf-text",
    role,
    roleConfidence: 0.95,
    omissionConfidence,
    evidence: [],
    relationships: [],
    readingOrder: 0,
  };
}

describe("reading profiles", () => {
  it("omits a high-confidence page number in audiobook mode", () => {
    assert.equal(
      decideReadingAction(element("page-number", 0.99), AUDIOBOOK_READING_PROFILE),
      "omit",
    );
  });

  it("retains an ambiguous element in audiobook mode", () => {
    assert.equal(decideReadingAction(element("header", 0.52), AUDIOBOOK_READING_PROFILE), "inline");
  });

  it("exposes non-narrative content in inclusive mode", () => {
    assert.equal(
      decideReadingAction(element("footnote", 0.98), INCLUSIVE_READING_PROFILE),
      "inline",
    );
  });

  it("supports separate and summary-required policies", () => {
    const profile = {
      ...AUDIOBOOK_READING_PROFILE,
      policies: {
        ...AUDIOBOOK_READING_PROFILE.policies,
        footnote: "separate" as const,
        table: "summary-required" as const,
      },
    };

    assert.equal(decideReadingAction(element("footnote", 0.99), profile), "separate");
    assert.equal(decideReadingAction(element("table", 0.99), profile), "summary-required");
  });

  it("reads a low-confidence element inline even when its configured action is separate", () => {
    const profile = {
      ...AUDIOBOOK_READING_PROFILE,
      policies: {
        ...AUDIOBOOK_READING_PROFILE.policies,
        footnote: "separate" as const,
      },
    };
    const uncertain = { ...element("footnote", 0.99), roleConfidence: 0.5 };

    assert.equal(decideReadingAction(uncertain, profile), "inline");
  });

  it("reads model-only text inline when no independent omission evidence exists", () => {
    const modelOnly = {
      ...element("caption", 0),
      evidence: [
        {
          signal: "layout-model" as const,
          weight: 0.96,
          detail: "model classified caption",
        },
      ],
    };

    assert.equal(decideReadingAction(modelOnly, AUDIOBOOK_READING_PROFILE), "inline");
  });
});

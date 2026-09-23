import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentAnalysis, DocumentElement } from "../core/types.ts";
import { AUDIOBOOK_READING_PROFILE } from "../narration/reading-profile.ts";
import { analyzeDocument } from "../document/analyzer.ts";
import { evaluateAnalysis, evaluateCorpus } from "./metrics.ts";

function element(id: string, role: DocumentElement["role"], order: number): DocumentElement {
  return {
    id,
    page: 1,
    text: id,
    bounds: [],
    sourceBlockIds: [id],
    source: "pdf-text",
    role,
    roleConfidence: 0.9,
    omissionConfidence: role === "paragraph" ? 0 : 0.95,
    evidence: [],
    relationships: [],
    readingOrder: order,
  };
}

describe("evaluateAnalysis", () => {
  it("reports retention, removal, role, and reading-order quality separately", () => {
    const analysis: DocumentAnalysis = {
      documentId: "book",
      elements: [
        element("paragraph-1", "paragraph", 0),
        element("header", "header", 1),
        element("paragraph-2", "paragraph", 2),
        element("ambiguous", "header", 3),
      ],
      sections: [],
      nonNarrative: [],
      diagnostics: [],
    };
    analysis.elements[3]!.omissionConfidence = 0.4;

    const metrics = evaluateAnalysis(analysis, [
      { id: "paragraph-1", narrative: true, role: "paragraph", order: 0 },
      { id: "header", narrative: false, role: "header", order: 1 },
      { id: "paragraph-2", narrative: true, role: "paragraph", order: 2 },
      { id: "ambiguous", narrative: true, role: "paragraph", order: 3 },
    ], AUDIOBOOK_READING_PROFILE);

    assert.equal(metrics.narrativeRetentionRecall, 1);
    assert.equal(metrics.narrativeDeletionRate, 0);
    assert.equal(metrics.nonNarrativeRemovalPrecision, 1);
    assert.equal(metrics.nonNarrativeRemovalRecall, 1);
    assert.ok(metrics.roleMacroF1 < 1);
    assert.equal(metrics.readingOrderPairwiseAccuracy, 1);
    assert.equal(metrics.hierarchyAccuracy, 1);
    assert.equal(metrics.relationshipPrecision, 1);
    assert.equal(metrics.relationshipRecall, 1);
    assert.ok(metrics.omissionConfidenceCalibrationError >= 0);
  });

  it("reports the document with the lowest narrative retention", () => {
    const first: DocumentAnalysis = {
      documentId: "high-recall",
      elements: [element("story", "paragraph", 0)],
      sections: [],
      nonNarrative: [],
      diagnostics: [],
    };
    const second: DocumentAnalysis = {
      documentId: "low-recall",
      elements: [],
      sections: [],
      nonNarrative: [],
      diagnostics: [],
    };
    const documents = evaluateCorpus([
      { analysis: first, labels: [{ id: "story", narrative: true, role: "paragraph", order: 0 }] },
      { analysis: second, labels: [{ id: "missing", narrative: true, role: "paragraph", order: 0 }] },
    ], AUDIOBOOK_READING_PROFILE);

    assert.equal(documents.worstNarrativeRetentionDocumentId, "low-recall");
  });

  it("scores narrative retention and header removal on the XVI regression fixture", () => {
    const pages = [14, 15, 16].map((number) => ({
      documentId: "roman-book",
      page: number,
      width: 600,
      height: 800,
      scanned: false,
      textLength: 120,
      blocks: [
        {
          id: `folio-${number}`,
          page: number,
          text: ["XIV", "XV", "XVI"][number - 14]!,
          bounds: { x: 0.08, y: 0.12, width: 0.04, height: 0.02 },
          fontSize: 0.012,
          source: "pdf-text" as const,
        },
        {
          id: `header-${number}`,
          page: number,
          text: "Introduction",
          bounds: { x: 0.35, y: 0.12, width: 0.18, height: 0.02 },
          fontSize: 0.016,
          source: "pdf-text" as const,
        },
        {
          id: `body-${number}`,
          page: number,
          text: `Narrative text for page ${number}.`,
          bounds: { x: 0.12, y: 0.3, width: 0.7, height: 0.03 },
          fontSize: 0.018,
          source: "pdf-text" as const,
        },
      ],
    }));
    const analysis = analyzeDocument(pages);
    const labels = pages.flatMap((page) => [
      { id: `folio-${page.page}`, narrative: false, role: "page-number" as const, order: (page.page - 14) * 3 },
      { id: `header-${page.page}`, narrative: false, role: "header" as const, order: (page.page - 14) * 3 + 1 },
      {
        id: `element-body-${page.page}`,
        narrative: true,
        role: "paragraph" as const,
        order: (page.page - 14) * 3 + 2,
      },
    ]);
    const metrics = evaluateAnalysis(analysis, labels, AUDIOBOOK_READING_PROFILE);

    assert.equal(metrics.narrativeRetentionPrecision, 1);
    assert.equal(metrics.narrativeRetentionRecall, 1);
    assert.equal(metrics.narrativeDeletionRate, 0);
    assert.equal(metrics.nonNarrativeRemovalPrecision, 1);
    assert.equal(metrics.nonNarrativeRemovalRecall, 1);
  });
});

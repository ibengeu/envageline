import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentBlock, ExtractedPage } from "../core/types.ts";
import { analyzeDocument } from "./analyzer.ts";

function block(page: number, id: string, text: string, y: number, fontSize = 0.02): DocumentBlock {
  return {
    id,
    page,
    text,
    bounds: { x: 0.12, y, width: 0.72, height: fontSize * 1.2 },
    fontSize,
    source: "pdf-text",
  };
}

function page(pageNumber: number, blocks: DocumentBlock[]): ExtractedPage {
  return {
    documentId: "book",
    page: pageNumber,
    width: 600,
    height: 800,
    blocks,
    scanned: false,
    textLength: blocks.reduce((total, item) => total + item.text.length, 0),
  };
}

describe("analyzeDocument", () => {
  it("classifies a footnote continuation and links it to the prior page", () => {
    const result = analyzeDocument([
      page(1, [
        block(1, "body-1", "Narrative body text continues across the page.", 0.3),
        block(1, "note-1", "1 First part of the explanatory note,", 0.86, 0.012),
      ]),
      page(2, [
        block(2, "note-2", "continued from the preceding page.", 0.08, 0.012),
        block(2, "body-2", "The narrative resumes here.", 0.3),
      ]),
    ]);

    const first = result.elements.find((item) => item.sourceBlockIds.includes("note-1"));
    const continuation = result.elements.find((item) => item.sourceBlockIds.includes("note-2"));

    assert.equal(first?.role, "footnote");
    assert.equal(continuation?.role, "footnote");
    assert.deepEqual(continuation?.relationships, [
      { type: "continues", targetId: first?.id, confidence: 0.82 },
    ]);
  });

  it("classifies aligned table rows as a separate table element", () => {
    const cells = [
      ["Quarter", "Revenue"],
      ["Q1", "42"],
      ["Q2", "48"],
    ].flatMap((row, rowIndex) =>
      row.map((text, columnIndex) => ({
        ...block(1, `r${rowIndex}c${columnIndex}`, text, 0.2 + rowIndex * 0.05),
        bounds: {
          x: 0.12 + columnIndex * 0.38,
          y: 0.2 + rowIndex * 0.05,
          width: 0.2,
          height: 0.02,
        },
      })),
    );

    const result = analyzeDocument([page(1, cells)]);
    const tables = result.elements.filter((element) => element.role === "table");

    assert.equal(tables.length, 1);
    assert.deepEqual(
      tables[0]?.sourceBlockIds,
      cells.map((cell) => cell.id),
    );
    assert.ok((tables[0]?.omissionConfidence ?? 0) >= 0.8);
  });

  it("preserves layout roles supplied by OCR or an optional layout model", () => {
    const labeled = [
      { ...block(1, "caption", "An image caption.", 0.2), type: "caption" as const },
      { ...block(1, "sidebar", "Background context.", 0.4), type: "sidebar" as const },
      { ...block(1, "callout", "Remember this point.", 0.6), type: "callout" as const },
    ];

    const result = analyzeDocument([page(1, labeled)]);

    assert.deepEqual(
      result.elements.map((element) => element.role),
      ["caption", "sidebar", "callout"],
    );
  });

  it("keeps legitimate headings near both page edges", () => {
    const blocks = [
      block(1, "top-heading", "A New Chapter", 0.08, 0.03),
      block(1, "body-1", "The first paragraph starts here.", 0.22, 0.018),
      block(1, "body-2", "The second paragraph continues here.", 0.34, 0.018),
      block(1, "body-3", "The third paragraph continues here.", 0.46, 0.018),
      block(1, "body-4", "The fourth paragraph continues here.", 0.58, 0.018),
      block(1, "body-5", "The fifth paragraph continues here.", 0.7, 0.018),
      block(1, "bottom-heading", "A Closing Note", 0.9, 0.03),
    ];

    const result = analyzeDocument([page(1, blocks)]);
    const top = result.elements.find((element) => element.sourceBlockIds.includes("top-heading"));
    const bottom = result.elements.find((element) =>
      element.sourceBlockIds.includes("bottom-heading"),
    );

    assert.ok(top?.role === "heading" || top?.role === "title");
    assert.ok(bottom?.role === "heading" || bottom?.role === "title");
    assert.notEqual(top?.role, "header");
    assert.notEqual(bottom?.role, "footer");
  });

  it("builds parent links for the chapter and section hierarchy", () => {
    const blocks = [
      block(1, "chapter", "Chapter One", 0.08, 0.04),
      block(1, "section", "Section One", 0.16, 0.025),
      block(1, "body-a", "The first paragraph.", 0.28, 0.018),
      block(1, "body-b", "The second paragraph.", 0.4, 0.018),
      block(1, "body-c", "The third paragraph.", 0.52, 0.018),
      block(1, "body-d", "The fourth paragraph.", 0.64, 0.018),
    ];
    const result = analyzeDocument([page(1, blocks)]);
    const chapter = result.sections.find(
      (section) => section.headingElementId === "element-chapter",
    );
    const section = result.sections.find((item) => item.headingElementId === "element-section");

    assert.equal(chapter?.level, 1);
    assert.equal(section?.level, 2);
    assert.equal(section?.parentId, chapter?.id);
    const body = result.elements.find((element) => element.sourceBlockIds.includes("body-a"));
    assert.deepEqual(body?.relationships, [
      { type: "belongs-to-section", targetId: section?.id, confidence: 0.86 },
    ]);
  });

  it("uses numbered heading depth to build nested sections", () => {
    const result = analyzeDocument([
      page(1, [
        block(1, "chapter", "1 Introduction", 0.08, 0.024),
        block(1, "section", "1.1 Background", 0.2, 0.022),
        block(1, "body-a", "The first paragraph starts here.", 0.34, 0.018),
        block(1, "body-b", "The second paragraph continues here.", 0.46, 0.018),
        block(1, "body-c", "The third paragraph continues here.", 0.58, 0.018),
      ]),
    ]);
    const chapter = result.sections.find(
      (section) => section.headingElementId === "element-chapter",
    );
    const section = result.sections.find((item) => item.headingElementId === "element-section");

    assert.equal(chapter?.level, 1);
    assert.equal(section?.level, 2);
    assert.equal(section?.parentId, chapter?.id);
  });

  it("links a caption to the nearby table element", () => {
    const cells = [
      ["Quarter", "Revenue"],
      ["Q1", "42"],
      ["Q2", "48"],
    ].flatMap((row, rowIndex) =>
      row.map((text, columnIndex) => ({
        ...block(1, `caption-r${rowIndex}c${columnIndex}`, text, 0.2 + rowIndex * 0.05),
        bounds: {
          x: 0.12 + columnIndex * 0.38,
          y: 0.2 + rowIndex * 0.05,
          width: 0.2,
          height: 0.02,
        },
      })),
    );
    const result = analyzeDocument([
      page(1, [block(1, "caption", "Table 1. Revenue by quarter.", 0.1), ...cells]),
    ]);
    const caption = result.elements.find((element) => element.sourceBlockIds.includes("caption"));
    const table = result.elements.find((element) => element.role === "table");

    assert.deepEqual(caption?.relationships, [
      { type: "caption-for", targetId: table?.id, confidence: 0.8 },
    ]);
  });

  it("classifies reference headings and standalone source markers", () => {
    const result = analyzeDocument([
      page(1, [
        block(1, "references", "References", 0.08, 0.04),
        block(1, "marker", "[12]", 0.2),
        block(1, "entry", "A source entry with publication details.", 0.25),
      ]),
    ]);
    const references = result.elements.find((element) =>
      element.sourceBlockIds.includes("references"),
    );
    const marker = result.elements.find((element) => element.sourceBlockIds.includes("marker"));

    assert.equal(references?.role, "reference");
    assert.ok(
      result.sections.some(
        (section) => section.headingElementId === references?.id && section.title === "References",
      ),
    );
    assert.equal(marker?.role, "citation");
    assert.equal(
      result.elements.find((element) => element.sourceBlockIds.includes("entry"))?.role,
      "reference",
    );
  });

  it("preserves OCR narrative and carries OCR confidence into classification", () => {
    const scanned = page(1, [
      {
        ...block(1, "ocr-body", "A scanned paragraph is readable.", 0.3),
        source: "ocr",
        confidence: 0.61,
      },
    ]);
    const result = analyzeDocument([scanned]);
    const paragraph = result.elements[0];

    assert.equal(paragraph?.text, "A scanned paragraph is readable.");
    assert.equal(paragraph?.source, "ocr");
    assert.equal(paragraph?.role, "paragraph");
    assert.equal(paragraph?.roleConfidence, 0.61);
    assert.ok((paragraph?.omissionConfidence ?? 1) < 0.8);
  });

  it("classifies a narrow side region and a callout without silently omitting either", () => {
    const blocks = [
      {
        ...block(1, "main-1", "Main narrative starts here.", 0.25),
        bounds: { x: 0.1, y: 0.25, width: 0.62, height: 0.024 },
      },
      {
        ...block(1, "main-2", "Main narrative continues here.", 0.35),
        bounds: { x: 0.1, y: 0.35, width: 0.62, height: 0.024 },
      },
      {
        ...block(1, "side-1", "Background detail one.", 0.48),
        bounds: { x: 0.79, y: 0.48, width: 0.18, height: 0.02 },
      },
      {
        ...block(1, "side-2", "Background detail two.", 0.56),
        bounds: { x: 0.79, y: 0.56, width: 0.18, height: 0.02 },
      },
      {
        ...block(1, "callout", "Note: keep this point in mind.", 0.68),
        bounds: { x: 0.2, y: 0.68, width: 0.55, height: 0.024 },
      },
    ];
    const result = analyzeDocument([page(1, blocks)]);
    const sidebar = result.elements.find((element) => element.sourceBlockIds.includes("side-1"));
    const callout = result.elements.find((element) => element.sourceBlockIds.includes("callout"));

    assert.equal(sidebar?.role, "sidebar");
    assert.equal(callout?.role, "callout");
    assert.ok((sidebar?.roleConfidence ?? 1) < 0.8);
    assert.ok((callout?.roleConfidence ?? 1) < 0.8);
  });

  it("uses an optional layout classifier only for ambiguous narrative groups", () => {
    const result = analyzeDocument(
      [page(1, [block(1, "ambiguous", "A short isolated note.", 0.3)])],
      {
        classify: () => ({ role: "callout", confidence: 0.91, modelId: "test-layout-model" }),
      },
    );
    const element = result.elements[0];

    assert.equal(element?.role, "callout");
    assert.equal(element?.omissionConfidence, 0);
    assert.equal(element?.evidence.at(-1)?.signal, "layout-model");
  });

  it("retains a model-only table region and relates it to the preceding narrative", () => {
    const input = page(1, [block(1, "body", "The passage introduces the results below.", 0.2)]);
    input.layoutRegions = [
      {
        role: "table",
        confidence: 0.94,
        bounds: { x: 0.1, y: 0.4, width: 0.8, height: 0.3 },
        modelId: "pp-doclayout-s-onnx",
        classId: 8,
      },
    ];

    const result = analyzeDocument([input]);
    const body = result.elements.find((element) => element.sourceBlockIds.includes("body"));
    const table = result.elements.find((element) => element.role === "table");

    assert.equal(table?.text, "");
    assert.deepEqual(table?.relationships, [
      {
        type: "reading-order-after",
        targetId: body?.id,
        confidence: 0.94,
      },
    ]);
    assert.ok(result.nonNarrative.includes(table!));
  });

  it("does not add a model-only element from a weak detection", () => {
    const input = page(1, [block(1, "body", "The passage remains ordinary narrative.", 0.2)]);
    input.layoutRegions = [
      {
        role: "table",
        confidence: 0.42,
        bounds: { x: 0.1, y: 0.4, width: 0.8, height: 0.3 },
        modelId: "pp-doclayout-s-onnx",
        classId: 8,
      },
    ];

    const result = analyzeDocument([input]);

    assert.equal(result.elements.length, 1);
    assert.equal(result.elements[0]?.role, "paragraph");
  });

  it("places a model-only region before text that follows it on the page", () => {
    const input = page(1, [block(1, "body", "Narrative text follows the visual element.", 0.4)]);
    input.layoutRegions = [
      {
        role: "decorative",
        confidence: 0.9,
        bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
        modelId: "pp-doclayout-s-onnx",
        classId: 1,
      },
    ];

    const result = analyzeDocument([input]);
    const region = result.elements.find((element) => element.role === "decorative");
    const body = result.elements.find((element) => element.sourceBlockIds.includes("body"));

    assert.ok((region?.readingOrder ?? Number.POSITIVE_INFINITY) < (body?.readingOrder ?? 0));
  });

  it("keeps model-labeled furniture readable when omission evidence is absent", () => {
    const mislabeled = {
      ...block(1, "narrative", "This paragraph remains part of the story.", 0.4),
      type: "footer" as const,
      layout: {
        modelId: "pp-doclayout-s-onnx",
        role: "footer" as const,
        confidence: 0.93,
      },
    };

    const result = analyzeDocument([page(1, [mislabeled])]);
    const element = result.elements[0];

    assert.equal(element?.role, "footer");
    assert.equal(element?.omissionConfidence, 0);
    assert.equal(element?.evidence[0]?.signal, "layout-model");
    assert.deepEqual(result.diagnostics, [
      "Retained element-narrative: layout model classified footer without omission evidence.",
    ]);
  });

  it("does not relabel a merged paragraph when model evidence covers only one block", () => {
    const first = {
      ...block(1, "first-line", "The narrative starts on this line", 0.3),
      type: "footer" as const,
      layout: {
        modelId: "pp-doclayout-s-onnx",
        role: "footer" as const,
        confidence: 0.94,
      },
    };
    const second = block(1, "second-line", "and continues on the next line.", 0.326);

    const result = analyzeDocument([page(1, [first, second])]);
    const merged = result.elements.find(
      (element) =>
        element.sourceBlockIds.includes("first-line") &&
        element.sourceBlockIds.includes("second-line"),
    );

    assert.equal(merged?.role, "paragraph");
    assert.equal(merged?.omissionConfidence, 0);
  });
});

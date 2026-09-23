import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentBlock, ExtractedPage } from "../core/types.ts";
import { buildDocumentProfile } from "./document-profile.ts";

function block(page: number, id: string, text: string, x: number, y = 0.12): DocumentBlock {
  return {
    id,
    page,
    text,
    bounds: { x, y, width: text.length * 0.012, height: 0.025 },
    fontSize: text === "Introduction" ? 0.016 : 0.012,
    source: "pdf-text",
  };
}

function page(pageNumber: number, folio: string, header = "Introduction"): ExtractedPage {
  return {
    documentId: "book",
    page: pageNumber,
    width: 600,
    height: 800,
    scanned: false,
    textLength: 100,
    blocks: [
      block(pageNumber, `folio-${pageNumber}`, folio, 0.08),
      block(pageNumber, `header-${pageNumber}`, header, 0.35),
      {
        ...block(pageNumber, `body-${pageNumber}`, `Body text on page ${pageNumber}.`, 0.12),
        bounds: { x: 0.12, y: 0.25, width: 0.7, height: 0.04 },
        fontSize: 0.018,
      },
    ],
  };
}

describe("buildDocumentProfile", () => {
  it("separates a sequenced Roman folio from a repeated running header", () => {
    const profile = buildDocumentProfile([
      page(14, "XIV"),
      page(15, "XV"),
      page(16, "XVI"),
    ]);

    assert.equal(profile.decisions["folio-16"]?.role, "page-number");
    assert.ok((profile.decisions["folio-16"]?.omissionConfidence ?? 0) >= 0.8);
    assert.equal(profile.decisions["header-16"]?.role, "header");
    assert.ok((profile.decisions["header-16"]?.omissionConfidence ?? 0) >= 0.8);
    assert.equal(profile.decisions["body-16"], undefined);
  });

  it("detects Arabic folios and repeated footer templates", () => {
    const pages = [1, 2, 3].map((number) => ({
      ...page(number, String(number)),
      blocks: [
        block(number, `folio-${number}`, String(number), 0.48, 0.94),
        block(number, `footer-${number}`, "The Auralis Book", 0.3, 0.94),
        block(number, `body-${number}`, `Body ${number}.`, 0.12, 0.3),
      ],
    }));
    const profile = buildDocumentProfile(pages);

    assert.equal(profile.decisions["folio-2"]?.role, "page-number");
    assert.equal(profile.decisions["footer-2"]?.role, "footer");
  });

  it("keeps chapter-local headers separate when the header changes", () => {
    const pages = [
      page(1, "1", "Chapter One"),
      page(2, "2", "Chapter One"),
      page(3, "3", "Chapter Two"),
      page(4, "4", "Chapter Two"),
    ];
    const profile = buildDocumentProfile(pages);

    assert.equal(profile.decisions["header-1"]?.role, "header");
    assert.equal(profile.decisions["header-3"]?.role, "header");
  });

  it("detects a repeated centered watermark without matching body prose", () => {
    const pages = [1, 2, 3].map((number) => ({
      ...page(number, String(number)),
      blocks: [
        {
          ...block(number, `watermark-${number}`, "DRAFT COPY", 0.5, 0.5),
          bounds: { x: 0.43, y: 0.5, width: 0.14, height: 0.01 },
          fontSize: 0.01,
        },
        {
          ...block(number, `body-${number}`, `Body ${number}.`, 0.3, 0.3),
          fontSize: 0.018,
        },
      ],
    }));
    const profile = buildDocumentProfile(pages);

    assert.equal(profile.decisions["watermark-2"]?.role, "watermark");
    assert.ok((profile.decisions["watermark-2"]?.omissionConfidence ?? 0) >= 0.8);
  });

  it("does not classify sequential numbers in body text as page numbers", () => {
    const pages = [1, 2, 3].map((number) => ({
      ...page(number, String(number)),
      blocks: [
        block(number, `list-${number}`, String(number), 0.4, 0.42),
        block(number, `body-${number}`, `Item text ${number}.`, 0.3, 0.3),
      ],
    }));
    const profile = buildDocumentProfile(pages);

    assert.equal(profile.decisions["list-2"], undefined);
  });

  it("does not omit a large repeated chapter title as a running header", () => {
    const pages = [1, 2, 3].map((number) => ({
      ...page(number, String(number), "A New Chapter"),
      blocks: [
        { ...block(number, `title-${number}`, "A New Chapter", 0.2, 0.08), fontSize: 0.05 },
        { ...block(number, `body-${number}`, `Body text ${number}.`, 0.3, 0.3), fontSize: 0.018 },
      ],
    }));
    const profile = buildDocumentProfile(pages);

    assert.equal(profile.decisions["title-2"], undefined);
  });

  it("reduces omission confidence when OCR witnesses are uncertain", () => {
    const pages = [1, 2].map((number) => ({
      ...page(number, String(number)),
      blocks: [
        { ...block(number, `ocr-header-${number}`, "Introduction", 0.35), source: "ocr" as const, confidence: 0.65 },
        { ...block(number, `body-${number}`, `Narrative ${number}.`, 0.35, 0.3), fontSize: 0.018 },
      ],
    }));
    const profile = buildDocumentProfile(pages);

    assert.equal(profile.decisions["ocr-header-1"]?.role, "header");
    assert.ok((profile.decisions["ocr-header-1"]?.omissionConfidence ?? 1) < 0.8);
  });
});

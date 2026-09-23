import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentBlock, ExtractedPage } from "../core/types.ts";
import { isPageNumber, stripCitations } from "./cleanup.ts";
import { compileDocument, compilePage } from "./compiler.ts";
import { normalizeText } from "./normalizer.ts";
import { dehyphenate } from "./paragraph-builder.ts";
import { splitSentences } from "./segmenter.ts";
import { INCLUSIVE_READING_PROFILE } from "./reading-profile.ts";

describe("stripCitations", () => {
  it("removes numeric and author-year citations", () => {
    assert.equal(
      stripCitations("Revenue increased 23.7% YoY [14]."),
      "Revenue increased 23.7% YoY.",
    );
    assert.equal(
      stripCitations("Later work (Smith, 2024) confirmed this [5, 8, 17]."),
      "Later work confirmed this.",
    );
  });
});

describe("normalizeText", () => {
  it("speaks percentages, money, and titles", () => {
    assert.equal(
      normalizeText("Revenue increased 23.7% YoY."),
      "Revenue increased twenty-three point seven percent year over year.",
    );
    assert.equal(
      normalizeText("The company reported $12.4M."),
      "The company reported twelve point four million dollars.",
    );
    assert.equal(normalizeText("Dr. Smith arrived."), "Doctor Smith arrived.");
    assert.equal(normalizeText("Q3 results"), "third quarter results");
    assert.equal(normalizeText("5 km north"), "five kilometers north");
    assert.equal(normalizeText("The CPU and NASA"), "The C P U and NASA");
  });
});

describe("splitSentences", () => {
  it("starts a new sentence at an abbreviated title such as Dr. or Mr.", () => {
    assert.deepEqual(splitSentences("It is sequence. Dr. Rivera has argued the point."), [
      "It is sequence.",
      "Dr. Rivera has argued the point.",
    ]);
  });

  it("keeps titles and decimals intact", () => {
    assert.deepEqual(splitSentences("Dr. Smith arrived. Later, rain fell."), [
      "Dr. Smith arrived.",
      "Later, rain fell.",
    ]);
    assert.deepEqual(splitSentences("Growth was 23.7 percent this year."), [
      "Growth was 23.7 percent this year.",
    ]);
    assert.deepEqual(splitSentences("See the U.S. report today."), ["See the U.S. report today."]);
  });
});

describe("dehyphenate", () => {
  it("joins broken words conservatively", () => {
    assert.equal(dehyphenate("inter-", "national"), "international");
    assert.equal(dehyphenate("state-", "of-the-art"), "state-of-the-art");
  });
});

describe("isPageNumber", () => {
  it("detects common page stamps", () => {
    assert.equal(isPageNumber("17"), true);
    assert.equal(isPageNumber("Page 17"), true);
    assert.equal(isPageNumber("17 / 340"), true);
    assert.equal(isPageNumber("xviii"), true);
    assert.equal(isPageNumber("Chapter 17 begins here"), false);
  });
});

function block(
  id: string,
  text: string,
  x: number,
  y: number,
  w = 0.4,
  h = 0.03,
  fontSize = 0.018,
): DocumentBlock {
  return {
    id,
    page: 1,
    text,
    bounds: { x, y, width: w, height: h },
    fontSize,
    source: "pdf-text",
  };
}

describe("compilePage", () => {
  it("assigns sentence-specific bounds when a paragraph has multiple lines", () => {
    const page: ExtractedPage = {
      documentId: "doc",
      page: 1,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 80,
      blocks: [
        block("s1", "First sentence.", 0.1, 0.2, 0.4, 0.03),
        block("s2", "Second sentence.", 0.1, 0.24, 0.4, 0.03),
      ],
    };

    const { segments } = compilePage(page);

    assert.deepEqual(
      segments.map((segment) => segment.bounds),
      [
        [{ x: 0.1, y: 0.2, width: 0.4, height: 0.03 }],
        [{ x: 0.1, y: 0.24, width: 0.4, height: 0.03 }],
      ],
    );
  });

  it("skips headers, footers, page numbers, and citations", () => {
    const page: ExtractedPage = {
      documentId: "doc",
      page: 1,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        block("h", "EVANGELINE SAMPLE", 0.12, 0.04, 0.5, 0.02, 0.01),
        block("t", "Spoken Documents", 0.12, 0.16, 0.7, 0.04, 0.032),
        block(
          "p",
          "Revenue increased 23.7% YoY [14]. Dr. Smith arrived.",
          0.12,
          0.28,
          0.7,
          0.04,
          0.018,
        ),
        block("n", "1", 0.48, 0.94, 0.04, 0.02, 0.01),
      ],
    };
    const { segments } = compilePage(page);
    const spoken = segments.map((segment) => segment.spokenText).join(" ");
    assert.match(spoken, /twenty-three point seven percent/);
    assert.match(spoken, /Doctor Smith/);
    assert.equal(spoken.includes("EVANGELINE SAMPLE"), false);
    assert.equal(/\[\d+\]/.test(spoken), false);
    assert.equal(
      segments.some((segment) => segment.originalText === "1"),
      false,
    );
  });

  it("reads left column then right column", () => {
    const page: ExtractedPage = {
      documentId: "doc",
      page: 1,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 80,
      blocks: [
        block("a1", "Alpha one.", 0.1, 0.2, 0.32, 0.03, 0.018),
        block("b1", "Beta one.", 0.58, 0.2, 0.32, 0.03, 0.018),
        block("a2", "Alpha two.", 0.1, 0.28, 0.32, 0.03, 0.018),
        block("b2", "Beta two.", 0.58, 0.28, 0.32, 0.03, 0.018),
      ],
    };
    const { segments } = compilePage(page);
    const spoken = segments.map((segment) => segment.spokenText);
    assert.deepEqual(spoken, ["Alpha one.", "Alpha two.", "Beta one.", "Beta two."]);
  });

  it("skips a copyright/imprint page entirely", () => {
    const page: ExtractedPage = {
      documentId: "doc",
      page: 4,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 400,
      blocks: [
        block("l1", "PENGUIN BOOKS", 0.2, 0.1, 0.3, 0.02, 0.014),
        block("l2", "Published by the Penguin Group,", 0.18, 0.14, 0.4, 0.02, 0.014),
        block(
          "l3",
          "Penguin Putnam Inc., 375 Hudson Street, New York, New York 10014, U.S.A.",
          0.1,
          0.18,
          0.6,
          0.02,
          0.014,
        ),
        block(
          "l4",
          "Copyright © Mark H. McCormack Enterprises, Inc., 2000",
          0.15,
          0.4,
          0.5,
          0.02,
          0.014,
        ),
        block("l5", "All rights reserved.", 0.25, 0.44, 0.3, 0.02, 0.014),
        block("l6", "ISBN 0 7865 2890 7", 0.25, 0.5, 0.3, 0.02, 0.014),
      ],
    };

    const { segments } = compilePage(page);

    assert.deepEqual(segments, []);
  });

  it("drops a stray page-number stamp sharing a heading's line", () => {
    const page: ExtractedPage = {
      documentId: "doc",
      page: 10,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        block("num", "x", 0.1, 0.16, 0.02, 0.02, 0.014),
        block("ornament", "❚", 0.16, 0.16, 0.01, 0.02, 0.014),
        block("heading", "Introduction", 0.3, 0.16, 0.3, 0.03, 0.032),
        block("p", "The first sentence of the chapter.", 0.12, 0.24, 0.7, 0.04, 0.018),
      ],
    };

    const { segments } = compilePage(page);
    const spoken = segments.map((segment) => segment.spokenText).join(" ");

    assert.match(spoken, /^Introduction/);
    assert.equal(/\bx\b/.test(spoken), false);
  });

  it("does not re-read a chapter heading repeated on the next page", () => {
    const heading = (page: number) =>
      block(`h${page}`, "Introduction", 0.3, 0.16, 0.3, 0.03, 0.032);
    const body = (page: number, id: string, text: string, y: number) =>
      block(id, text, 0.12, y, 0.7, 0.04, 0.018);

    const first: ExtractedPage = {
      documentId: "doc",
      page: 6,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        heading(6),
        body(6, "p6a", "The chapter opens here.", 0.2),
        body(6, "p6b", "It continues with more body text.", 0.3),
      ],
    };
    const second: ExtractedPage = {
      documentId: "doc",
      page: 7,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        heading(7),
        body(7, "p7a", "The chapter continues here.", 0.2),
        body(7, "p7b", "And more body text follows.", 0.3),
      ],
    };

    const firstResult = compilePage(first);
    const secondResult = compilePage(second, firstResult.hints);

    const firstSpoken = firstResult.segments.map((segment) => segment.spokenText);
    const secondSpoken = secondResult.segments.map((segment) => segment.spokenText);

    assert.deepEqual(firstSpoken, [
      "Introduction",
      "The chapter opens here.",
      "It continues with more body text.",
    ]);
    assert.deepEqual(secondSpoken, [
      "The chapter continues here.",
      "And more body text follows.",
    ]);
  });

  it("reads a heading again once a different heading has appeared since", () => {
    const introHeading = (page: number) =>
      block(`h${page}`, "Introduction", 0.3, 0.16, 0.3, 0.03, 0.032);
    const summaryHeading = (page: number) =>
      block(`s${page}`, "Summary", 0.3, 0.16, 0.3, 0.03, 0.032);
    const body = (id: string, text: string, y: number) =>
      block(id, text, 0.12, y, 0.7, 0.04, 0.018);

    const pageA: ExtractedPage = {
      documentId: "doc",
      page: 6,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        introHeading(6),
        body("p6a", "Opening chapter content.", 0.2),
        body("p6b", "More opening content.", 0.3),
      ],
    };
    const pageB: ExtractedPage = {
      documentId: "doc",
      page: 7,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        summaryHeading(7),
        body("p7a", "A different section.", 0.2),
        body("p7b", "More of that section.", 0.3),
      ],
    };
    const pageC: ExtractedPage = {
      documentId: "doc",
      page: 20,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        introHeading(20),
        body("p20a", "A later, unrelated chapter also called Introduction.", 0.2),
        body("p20b", "More of that later chapter.", 0.3),
      ],
    };

    const resultA = compilePage(pageA);
    const resultB = compilePage(pageB, resultA.hints);
    const resultC = compilePage(pageC, resultB.hints);

    assert.equal(
      resultC.segments.some((segment) => segment.spokenText === "Introduction"),
      true,
    );
  });

  it("recognizes a heading set only modestly larger than body text, a common real book ratio", () => {
    // 12.5pt heading over 10.5pt body - about 1.19x - is an ordinary
    // chapter-heading/body-text ratio in real printed books, not an edge case.
    const page: ExtractedPage = {
      documentId: "doc",
      page: 6,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 400,
      blocks: [
        block("heading", "Introduction", 0.16, 0.24, 0.2, 0.02, 0.0158),
        block("p1", "A person would have to be deaf and blind and locked away.", 0.16, 0.28, 0.7, 0.02, 0.0133),
        block("p2", "That is certainly the overwhelming impression you would get.", 0.16, 0.31, 0.7, 0.02, 0.0133),
        block("p3", "It is not just the bootstrapping stories of entrepreneurs.", 0.16, 0.34, 0.7, 0.02, 0.0133),
        // A real paragraph gap, so classification runs against a realistic,
        // several-group page median rather than a two-group edge case.
        block("q1", "Dont get me wrong. Im not a complete Luddite who thinks so.", 0.16, 0.42, 0.7, 0.02, 0.0133),
        block("q2", "Its here to stay and there is too much money invested in it.", 0.16, 0.45, 0.7, 0.02, 0.0133),
      ],
    };

    const { segments } = compilePage(page);

    assert.equal(segments[0]?.type, "heading");
    assert.equal(segments[0]?.spokenText, "Introduction");
    assert.equal(segments[1]?.type, "paragraph");
  });

  it("reads a table row by row, cell by cell, instead of as run-on prose", () => {
    const page: ExtractedPage = {
      documentId: "doc",
      page: 5,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        block("h1", "Quarter", 0.1, 0.1, 0.15, 0.02),
        block("h2", "Revenue", 0.4, 0.1, 0.15, 0.02),
        block("h3", "Growth", 0.7, 0.1, 0.15, 0.02),
        block("r1c1", "Q1", 0.1, 0.14, 0.15, 0.02),
        block("r1c2", "42", 0.4, 0.14, 0.15, 0.02),
        block("r1c3", "12%", 0.7, 0.14, 0.15, 0.02),
        block("r2c1", "Q2", 0.1, 0.18, 0.15, 0.02),
        block("r2c2", "48", 0.4, 0.18, 0.15, 0.02),
        block("r2c3", "15%", 0.7, 0.18, 0.15, 0.02),
      ],
    };

    const { segments } = compilePage(page);

    assert.deepEqual(
      segments.map((segment) => segment.spokenText),
      [
        "Quarter, Revenue, Growth.",
        "first quarter, 42, twelve percent.",
        "second quarter, 48, fifteen percent.",
      ],
    );
    assert.ok(segments.every((segment) => segment.type === "table-row"));
  });

  it("keeps a table's surrounding prose in the normal reading position", () => {
    const page: ExtractedPage = {
      documentId: "doc",
      page: 5,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        block("before", "Here is the quarterly summary.", 0.1, 0.04, 0.7, 0.03, 0.018),
        block("h1", "Quarter", 0.1, 0.1, 0.15, 0.02),
        block("h2", "Revenue", 0.4, 0.1, 0.15, 0.02),
        block("h3", "Growth", 0.7, 0.1, 0.15, 0.02),
        block("r1c1", "Q1", 0.1, 0.14, 0.15, 0.02),
        block("r1c2", "42", 0.4, 0.14, 0.15, 0.02),
        block("r1c3", "12%", 0.7, 0.14, 0.15, 0.02),
        block("r2c1", "Q2", 0.1, 0.18, 0.15, 0.02),
        block("r2c2", "48", 0.4, 0.18, 0.15, 0.02),
        block("r2c3", "15%", 0.7, 0.18, 0.15, 0.02),
        block("after", "That concludes the summary.", 0.1, 0.28, 0.7, 0.03, 0.018),
      ],
    };

    const { segments } = compilePage(page);
    const types = segments.map((segment) => segment.type);
    const spoken = segments.map((segment) => segment.spokenText);

    assert.equal(types[0], "paragraph");
    assert.equal(spoken[0], "Here is the quarterly summary.");
    assert.equal(types.at(-1), "paragraph");
    assert.equal(spoken.at(-1), "That concludes the summary.");
    assert.ok(types.slice(1, -1).every((type) => type === "table-row"));
  });

  it("keys each sentence's sourceBlockIds to only the lines it spans, not the whole paragraph", () => {
    const page: ExtractedPage = {
      documentId: "doc",
      page: 6,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 400,
      blocks: [
        block("l0", "A long paragraph starts on this first line and", 0.14, 0.1, 0.7, 0.02, 0.018),
        block("l1", "continues onto a second line before the first", 0.14, 0.14, 0.7, 0.02, 0.018),
        block("l2", "sentence ends right here. Then a second sentence", 0.14, 0.18, 0.7, 0.02, 0.018),
        block("l3", "begins and runs to its own end on this line.", 0.14, 0.22, 0.7, 0.02, 0.018),
      ],
    };

    const { segments } = compilePage(page);

    assert.deepEqual(
      segments.map((segment) => segment.sourceBlockIds),
      [
        ["l0", "l1", "l2"],
        ["l2", "l3"],
      ],
    );
  });

  it("falls back to the paragraph's own bounds when a spoken prefix has no matching source line", () => {
    // ordinalListPrefix rewrites "3." to a spoken "Third," that never appeared
    // in the source text, which can desync the sentence-to-line token matcher
    // for the rest of the sentence too. A segment must still highlight
    // *something* on the page rather than render no box at all.
    const page: ExtractedPage = {
      documentId: "doc",
      page: 6,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 200,
      blocks: [
        block("l0", "3. Start the opening item text that continues", 0.14, 0.1, 0.7, 0.02, 0.018),
        block("l1", "onto a second wrapped line for this list entry.", 0.14, 0.14, 0.7, 0.02, 0.018),
      ],
    };

    const { segments } = compilePage(page);

    assert.equal(segments.length, 1);
    assert.ok(
      (segments[0]?.bounds.length ?? 0) > 0,
      "expected a non-empty bounds fallback, got an empty highlight box list",
    );
  });

  it("keeps extracted markup-looking text literal", () => {
    const page: ExtractedPage = {
      documentId: "doc",
      page: 1,
      width: 612,
      height: 792,
      scanned: false,
      textLength: 40,
      blocks: [block("literal", "<em>Visible</em> sentence.", 0.1, 0.2)],
    };

    const [segment] = compilePage(page).segments;

    assert.equal(segment?.originalText, "<em>Visible</em> sentence.");
    assert.equal(segment?.spokenText, "<em>Visible</em> sentence.");
  });
});

describe("compileDocument", () => {
  it("does not combine a Roman folio and running header into a section title", () => {
    const pages = [14, 15, 16].map((number) => ({
      documentId: "book",
      page: number,
      width: 600,
      height: 800,
      scanned: false,
      textLength: 100,
      blocks: [
        { ...block(`folio-${number}`, ["XIV", "XV", "XVI"][number - 14]!, 0.08, 0.12), page: number },
        { ...block(`header-${number}`, "Introduction", 0.35, 0.12), page: number },
        { ...block(`body-${number}`, `Narrative page ${number}.`, 0.12, 0.3), page: number },
      ],
    } satisfies ExtractedPage));

    const result = compileDocument(pages);
    const spoken = result.segments.map((segment) => segment.originalText).join(" ");

    assert.equal(spoken.includes("XVI Introduction"), false);
    assert.equal(spoken.includes("Introduction"), false);
    assert.match(spoken, /Narrative page 16/);
    assert.equal(
      result.analysis.elements.find((element) => element.id === "folio-16")?.role,
      "page-number",
    );
    assert.equal(
      result.analysis.elements.find((element) => element.id === "header-16")?.role,
      "header",
    );
  });

  it("keeps two-column narrative in left-column then right-column order", () => {
    const page: ExtractedPage = {
      documentId: "columns",
      page: 1,
      width: 600,
      height: 800,
      scanned: false,
      textLength: 100,
      blocks: [
        block("left-1", "Left column starts.", 0.1, 0.2, 0.32, 0.03),
        block("right-1", "Right column starts.", 0.58, 0.2, 0.32, 0.03),
        block("left-2", "Left column continues.", 0.1, 0.28, 0.32, 0.03),
        block("right-2", "Right column continues.", 0.58, 0.28, 0.32, 0.03),
        block("left-3", "Left column continues again.", 0.1, 0.36, 0.32, 0.03),
        block("right-3", "Right column continues again.", 0.58, 0.36, 0.32, 0.03),
        block("left-4", "Left column ends.", 0.1, 0.44, 0.32, 0.03),
        block("right-4", "Right column ends.", 0.58, 0.44, 0.32, 0.03),
      ],
    };

    const result = compileDocument([page]);
    assert.deepEqual(
      result.segments.map((segment) => segment.spokenText),
      [
        "Left column starts.",
        "Left column continues.",
        "Left column continues again.",
        "Left column ends.",
        "Right column starts.",
        "Right column continues.",
        "Right column continues again.",
        "Right column ends.",
      ],
    );
  });

  it("allows an inclusive profile to retain inline source markers", () => {
    const page: ExtractedPage = {
      documentId: "citations",
      page: 1,
      width: 600,
      height: 800,
      scanned: false,
      textLength: 50,
      blocks: [block("body", "The result is supported [12].", 0.1, 0.3, 0.7, 0.03)],
    };

    const audiobook = compileDocument([page]);
    const inclusive = compileDocument([page], INCLUSIVE_READING_PROFILE);

    assert.equal(audiobook.segments.some((segment) => segment.originalText.includes("[12]")), false);
    assert.equal(inclusive.segments.some((segment) => segment.originalText.includes("[12]")), true);
  });

  it("reads narrative text when the layout model alone labels it as furniture", () => {
    const narrative = block(
      "body",
      "This paragraph remains part of the story.",
      0.1,
      0.4,
      0.8,
      0.04,
    );
    narrative.type = "footer";
    narrative.layout = {
      modelId: "pp-doclayout-s-onnx",
      role: "footer",
      confidence: 0.93,
    };
    const page: ExtractedPage = {
      documentId: "safe-abstention",
      page: 1,
      width: 600,
      height: 800,
      scanned: false,
      textLength: narrative.text.length,
      blocks: [narrative],
    };

    const result = compileDocument([page]);

    assert.equal(result.segments[0]?.spokenText, "This paragraph remains part of the story.");
  });
});

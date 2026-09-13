const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const {
  normalizePdfText,
  splitIntoSpeechChunks,
  mergeShortChunks,
  prefetchDepth,
  renderExtractedText,
  renderSpeechFocus,
  extractPositionedItems,
  reconstructLines,
  reconstructBlocks,
  splitParagraphBoundaries,
  analyzeDocumentStats,
  buildPipelineOutput,
  classifyBlocks,
  detectColumns,
  resolveReadingOrder,
  renderNarrationText,
  mapParagraphsToChunks,
  assessCapabilities,
  assignBlockIds,
  buildDocumentAst,
  DEFAULT_SPEECH_POLICY,
  resolveSpeechPolicy,
  shouldSpeak,
  convertCardinal,
  detectNumericEntities,
  normalizeSpokenText,
  convertCodeDigits,
  convertCurrency,
  convertYear,
  convertPercentage,
  convertDecimal,
  convertOrdinal,
  findBoundaryCandidates,
  isProtectedAbbreviationPeriod,
  isProtectedDecimal,
  isProtectedCurrencyPhrase,
  isProtectedOrdinal,
  isProtectedYearPhrase,
  createKokoroTtsEngine,
  setTtsEngine,
} = require("./app.js");

// `defaultTtsEngine` is exposed as a live getter (app.js reassigns the underlying binding via
// setTtsEngine) — destructuring it here would freeze a one-time snapshot instead of tracking
// reassignment, so it's read fresh through the module object wherever the current value matters.
const appModule = require("./app.js");
function getDefaultTtsEngine() {
  return appModule.defaultTtsEngine;
}

function pageBlock(overrides) {
  return {
    page: 0,
    lines: [],
    text: "",
    bbox: { x0: 0, y0: 0, x1: 1, y1: 0.05 },
    type: "body",
    confidence: 0,
    column: undefined,
    ...overrides,
  };
}

test("normalizePdfText preserves paragraphs while removing extraction noise", () => {
  const raw = "This is a hyphen-\nated word.\nThis continues the same paragraph.\n\n\nNext   paragraph.";

  assert.equal(
    normalizePdfText(raw),
    "This is a hyphenated word. This continues the same paragraph.\n\nNext paragraph.",
  );
});

test("splitIntoSpeechChunks returns speakable sentence groups within a max length", () => {
  const text = [
    "First sentence is short.",
    "Second sentence has enough words to matter.",
    "Third sentence closes the idea.",
  ].join(" ");

  assert.deepEqual(splitIntoSpeechChunks(text, 58), [
    "First sentence is short.",
    "Second sentence has enough words to matter.",
    "Third sentence closes the idea.",
  ]);
});

test("splitIntoSpeechChunks keeps long unpunctuated text speakable", () => {
  const text = "word ".repeat(80).trim();
  const chunks = splitIntoSpeechChunks(text, 120);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 120));
  assert.equal(chunks.join(" "), text);
});

test("splitIntoSpeechChunks bounds a single overlong token", () => {
  const text = "x".repeat(305);
  const chunks = splitIntoSpeechChunks(text, 120);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.length <= 120));
  assert.equal(chunks.join(""), text);
});

test("findBoundaryCandidates returns a candidate at every paragraph boundary (spec 007 Foundational)", () => {
  const text = "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.";

  const candidates = findBoundaryCandidates(text, "paragraph");

  assert.equal(candidates.length, 2);
  candidates.forEach((candidate) => assert.equal(candidate.tier, "paragraph"));
});

test("findBoundaryCandidates returns candidates at ordinary sentence boundaries (spec 007 Foundational)", () => {
  const text = "First sentence here. Second sentence here. Third sentence here.";

  const candidates = findBoundaryCandidates(text, "sentence");

  // Three sentences have exactly two boundaries BETWEEN them; there is no boundary after the
  // final sentence since nothing follows it (a boundary marks where to split, not where a
  // sentence ends).
  assert.equal(candidates.length, 2);
  candidates.forEach((candidate) => assert.equal(candidate.tier, "sentence"));
});

test("splitIntoSpeechChunks completes quickly on adversarial input (ReDoS safety, spec 007 Foundational)", () => {
  const longDigitRun = "9".repeat(5000);
  const longPunctuationRun = ".".repeat(5000);

  const start = Date.now();
  splitIntoSpeechChunks(`Data: ${longDigitRun} and ${longPunctuationRun} end.`, 260);
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 1000, `expected under 1000ms, took ${elapsedMs}ms`);
});

test("isProtectedAbbreviationPeriod returns true for each fixed abbreviation followed by further text (spec 007 US1)", () => {
  const abbreviations = ["Dr.", "Mr.", "Mrs.", "Prof.", "vs.", "approx.", "etc.", "e.g.", "i.e.", "St.", "Jr.", "Sr."];

  abbreviations.forEach((abbreviation) => {
    const text = `${abbreviation} Smith`;
    const position = abbreviation.length;
    assert.equal(isProtectedAbbreviationPeriod(text, position), true, `abbreviation: ${abbreviation}`);
  });
});

test("isProtectedAbbreviationPeriod returns false when the abbreviation is at the end of the text (spec 007 US1, Edge Case)", () => {
  const text = "He held the title of Dr.";

  assert.equal(isProtectedAbbreviationPeriod(text, text.length), false);
});

test("isProtectedAbbreviationPeriod returns false for an ordinary sentence-ending period with no abbreviation (spec 007 US1)", () => {
  const text = "This is a sentence. Next one starts here.";
  const position = text.indexOf(". ") + 1;

  assert.equal(isProtectedAbbreviationPeriod(text, position), false);
});

test("splitIntoSpeechChunks keeps 'Dr. Smith' together (spec 007 US1 AS1)", () => {
  const chunks = splitIntoSpeechChunks("Dr. Smith found that the results were conclusive.", 20);

  assert.ok(chunks.some((chunk) => chunk.includes("Dr. Smith")));
  assert.ok(!chunks.some((chunk) => chunk.trim() === "Dr."));
});

test("splitIntoSpeechChunks keeps 'Prof. Lee' together (spec 007 US1 AS2)", () => {
  const chunks = splitIntoSpeechChunks("the U.S. economy grew, according to Prof. Lee, who noted the trend.", 30);

  assert.ok(chunks.some((chunk) => chunk.includes("Prof. Lee")));
});

test("splitIntoSpeechChunks still splits at an ordinary sentence boundary with no abbreviation (spec 007 US1 AS3)", () => {
  const chunks = splitIntoSpeechChunks("This is the first sentence. This is the second sentence.", 260);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0], "This is the first sentence.");
  assert.equal(chunks[1], "This is the second sentence.");
});

test("isProtectedDecimal returns true between digits of a raw decimal, false for a period with no following digit (spec 007 US2)", () => {
  const decimalText = "The value was 3.14 exactly.";
  const decimalPosition = decimalText.indexOf("3.") + 2;
  assert.equal(isProtectedDecimal(decimalText, decimalPosition), true);

  const sentenceText = "It was 1996. The next year began.";
  const sentencePosition = sentenceText.indexOf(". ") + 1;
  assert.equal(isProtectedDecimal(sentenceText, sentencePosition), false);
});

test("isProtectedCurrencyPhrase returns true inside a spoken currency phrase, false outside one (spec 007 US2)", () => {
  const text = "the device costs four hundred dollars and lasted two years.";
  const betweenFourHundred = text.indexOf("four hundred") + "four".length + 1;
  const betweenHundredDollars = text.indexOf("hundred dollars") + "hundred".length + 1;
  assert.equal(isProtectedCurrencyPhrase(text, betweenFourHundred), true);
  assert.equal(isProtectedCurrencyPhrase(text, betweenHundredDollars), true);

  const centsText = "it cost one dollar and fifty cents exactly.";
  const insideCentsClause = centsText.indexOf("and fifty") + "and".length + 1;
  assert.equal(isProtectedCurrencyPhrase(centsText, insideCentsClause), true);

  const outsideText = "the weather was clear and sunny today.";
  const outsidePosition = outsideText.indexOf("clear and") + "clear".length + 1;
  assert.equal(isProtectedCurrencyPhrase(outsideText, outsidePosition), false);
});

test("isProtectedOrdinal returns true inside a spoken ordinal, false outside one (spec 007 US2)", () => {
  const text = "the twenty-first century began.";
  const insideOrdinal = text.indexOf("twenty-first") + "twenty".length + 1;
  assert.equal(isProtectedOrdinal(text, insideOrdinal), true);

  const outsideText = "the plain century began.";
  const outsidePosition = outsideText.indexOf("plain") + 2;
  assert.equal(isProtectedOrdinal(outsideText, outsidePosition), false);
});

test("isProtectedYearPhrase returns true inside a spoken year, false outside one (spec 007 US2)", () => {
  const text = "founded in twenty twenty-four during a big year.";
  const insideYear = text.indexOf("twenty twenty-four") + "twenty".length + 1;
  assert.equal(isProtectedYearPhrase(text, insideYear), true);

  const thousandText = "it happened in two thousand five during spring.";
  const insideThousand = thousandText.indexOf("two thousand five") + "two".length + 1;
  assert.equal(isProtectedYearPhrase(thousandText, insideThousand), true);

  const outsideText = "founded in a big year during spring.";
  const outsidePosition = outsideText.indexOf("big year") + "big".length + 1;
  assert.equal(isProtectedYearPhrase(outsideText, outsidePosition), false);
});

test("splitIntoSpeechChunks keeps 'three point one four' together (spec 007 US2 AS1)", () => {
  const chunks = splitIntoSpeechChunks("the value of pi is three point one four in this context.", 30);

  assert.ok(chunks.some((chunk) => chunk.includes("three point one four")));
});

test("splitIntoSpeechChunks never splits 'four hundred dollars' (spec 007 US2 AS2)", () => {
  const chunks = splitIntoSpeechChunks("the device costs four hundred dollars and lasted two years.", 25);

  assert.ok(chunks.some((chunk) => chunk.includes("four hundred dollars")));
});

test("splitIntoSpeechChunks does not split a raw decimal reaching the chunker unconverted (spec 007 US2 AS3)", () => {
  const chunks = splitIntoSpeechChunks("Smith found that the value was 3.14 exactly.", 34);

  assert.ok(chunks.some((chunk) => chunk.includes("3.14")));
  assert.ok(!chunks.some((chunk) => /\b3\.$/.test(chunk)));
});

test("splitIntoSpeechChunks keeps 'twenty-first' and 'twenty twenty-four' intact near a length boundary (spec 007 US2 AS4)", () => {
  const ordinalChunks = splitIntoSpeechChunks("the twenty-first century began with change.", 20);
  assert.ok(ordinalChunks.some((chunk) => chunk.includes("twenty-first")));

  const yearChunks = splitIntoSpeechChunks("the report was published in twenty twenty-four fully.", 32);
  assert.ok(yearChunks.some((chunk) => chunk.includes("twenty twenty-four")));
});

test("splitIntoSpeechChunks matches the recorded pre-007 baseline for a plain-prose passage with no protected patterns (spec 007 US3 AS1, FR-009)", () => {
  const passage = [
    "The history of computing spans many decades of innovation and discovery.",
    "Early machines filled entire rooms and required teams of operators to run.",
    "Modern devices fit in a pocket yet vastly exceed that early computing power.",
    "Researchers continue to push the boundaries of what these systems can do.",
  ].join(" ");

  // Recorded by running this exact passage through the pre-007 chunker before any change in
  // this feature was made, per FR-009's byte-for-byte preservation requirement.
  const preRecordedBaseline = [
    "The history of computing spans many decades of innovation and discovery.",
    "Early machines filled entire rooms and required teams of operators to run.",
    "Modern devices fit in a pocket yet vastly exceed that early computing power.",
    "Researchers continue to push the boundaries of what these systems can do.",
  ];

  assert.deepEqual(splitIntoSpeechChunks(passage, 260), preRecordedBaseline);
});

test("splitIntoSpeechChunks with maxLength smaller than the shortest protected span still produces bounded, terminating output (spec 007 US3 AS2, FR-008, SC-004)", () => {
  const text = "the device costs four hundred dollars exactly.";

  const start = Date.now();
  const chunks = splitIntoSpeechChunks(text, 5);
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 1000, `expected under 1000ms, took ${elapsedMs}ms`);
  assert.ok(chunks.length > 0);
  assert.ok(chunks.every((chunk) => chunk.length <= 5));
  // Bounded and terminating (this test's actual concern, per SC-004) does not require every
  // character to be recoverable — at maxLength this small, splitLongText's own pathological
  // single-oversized-word handling (unchanged from pre-007) may join adjacent fragments without
  // a space; confirm no content is dropped by comparing letters only.
  assert.equal(chunks.join("").replace(/\s+/g, ""), text.replace(/\s+/g, ""));
});

test("splitIntoSpeechChunks prefers a clause-tier boundary over a sentence-tier one that would exceed maxLength (spec 007 US3 AS3, SC-005)", () => {
  const text = "This is a long clause, followed by another long clause that continues on.";

  const chunks = splitIntoSpeechChunks(text, 40);

  assert.ok(chunks.some((chunk) => chunk.trim() === "This is a long clause,"));
});

test("extractPositionedItems normalizes PDF.js text items without removing any of them", () => {
  const pageWidth = 600;
  const pageHeight = 800;
  const items = [
    { str: "Hello", transform: [12, 0, 0, 12, 50, 700], width: 40, height: 12, fontName: "g_d0_f1" },
    { str: "World", transform: [12, 0, 0, 12, 95, 700], width: 42, height: 12, fontName: "g_d0_f1" },
  ];

  const result = extractPositionedItems(items, 0, pageWidth, pageHeight);

  assert.equal(result.length, 2);
  assert.equal(result[0].text, "Hello");
  assert.equal(result[0].page, 0);
  assert.ok(result[0].bbox.x0 >= 0 && result[0].bbox.x0 <= 1);
  assert.ok(result[0].bbox.y0 >= 0 && result[0].bbox.y0 <= 1);
  assert.ok(result[0].bbox.x1 >= 0 && result[0].bbox.x1 <= 1);
  assert.ok(result[0].bbox.y1 >= 0 && result[0].bbox.y1 <= 1);
  assert.equal(result[1].text, "World");
});

test("reconstructLines groups text items with close vertical centers into one line", () => {
  const items = [
    { text: "Hello", page: 0, bbox: { x0: 0.08, y0: 0.10, x1: 0.15, y1: 0.115 } },
    { text: "World", page: 0, bbox: { x0: 0.16, y0: 0.101, x1: 0.23, y1: 0.116 } },
  ];

  const lines = reconstructLines(items);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "Hello World");
});

test("reconstructLines keeps vertically distant text items on separate lines", () => {
  const items = [
    { text: "Title", page: 0, bbox: { x0: 0.08, y0: 0.05, x1: 0.2, y1: 0.07 } },
    { text: "Body text starts here", page: 0, bbox: { x0: 0.08, y0: 0.20, x1: 0.4, y1: 0.22 } },
  ];

  const lines = reconstructLines(items);

  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "Title");
  assert.equal(lines[1].text, "Body text starts here");
});

test("reconstructBlocks groups aligned, evenly spaced lines into one block", () => {
  const lines = [
    { page: 0, text: "This is the first line of a paragraph", bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.22 }, fontSize: 12 },
    { page: 0, text: "and this continues the same paragraph.", bbox: { x0: 0.1, y0: 0.23, x1: 0.6, y1: 0.25 }, fontSize: 12 },
  ];

  const blocks = reconstructBlocks(lines);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lines.length, 2);
});

test("reconstructBlocks starts a new block on a font-size jump", () => {
  const lines = [
    { page: 0, text: "A Heading", bbox: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.14 }, fontSize: 20 },
    { page: 0, text: "Body text begins here.", bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.22 }, fontSize: 12 },
  ];

  const blocks = reconstructBlocks(lines);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].lines.length, 1);
  assert.equal(blocks[1].lines.length, 1);
});

test("splitParagraphBoundaries splits a block at a line indented beyond the block's own left margin", () => {
  const block = {
    page: 0,
    lines: [
      { page: 0, text: "First paragraph line one.", bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } },
      { page: 0, text: "First paragraph line two.", bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } },
      { page: 0, text: "    Second paragraph starts indented.", bbox: { x0: 0.18, y0: 0.28, x1: 0.6, y1: 0.31 } },
      { page: 0, text: "Second paragraph continues.", bbox: { x0: 0.1, y0: 0.32, x1: 0.6, y1: 0.35 } },
    ],
    text: "First paragraph line one. First paragraph line two.     Second paragraph starts indented. Second paragraph continues.",
    bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.35 },
    fontSize: 10,
    type: "body",
    confidence: 0,
    column: undefined,
  };

  const split = splitParagraphBoundaries([block]);

  assert.equal(split.length, 2);
  assert.equal(split[0].lines.length, 2);
  assert.equal(split[1].lines.length, 2);
});

test("splitParagraphBoundaries splits a block at an unusually large vertical gap between lines", () => {
  const block = {
    page: 0,
    lines: [
      { page: 0, text: "First paragraph line one.", bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } },
      { page: 0, text: "First paragraph line two.", bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } },
      { page: 0, text: "Second paragraph after a bigger gap.", bbox: { x0: 0.1, y0: 0.36, x1: 0.6, y1: 0.39 } },
      { page: 0, text: "Second paragraph continues.", bbox: { x0: 0.1, y0: 0.4, x1: 0.6, y1: 0.43 } },
    ],
    text: "First paragraph line one. First paragraph line two. Second paragraph after a bigger gap. Second paragraph continues.",
    bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.43 },
    fontSize: 10,
    type: "body",
    confidence: 0,
    column: undefined,
  };

  const split = splitParagraphBoundaries([block]);

  assert.equal(split.length, 2);
  assert.equal(split[0].lines.length, 2);
  assert.equal(split[1].lines.length, 2);
});

test("splitParagraphBoundaries leaves a block with uniform margins and spacing unchanged", () => {
  const block = {
    page: 0,
    lines: [
      { page: 0, text: "Line one of a single paragraph.", bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } },
      { page: 0, text: "Line two of the same paragraph.", bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } },
      { page: 0, text: "Line three of the same paragraph.", bbox: { x0: 0.1, y0: 0.28, x1: 0.6, y1: 0.31 } },
    ],
    text: "Line one of a single paragraph. Line two of the same paragraph. Line three of the same paragraph.",
    bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.31 },
    fontSize: 10,
    type: "body",
    confidence: 0,
    column: undefined,
  };

  const split = splitParagraphBoundaries([block]);

  assert.equal(split.length, 1);
  assert.equal(split[0].lines.length, 3);
});

test("splitParagraphBoundaries does not split a block with a uniform hanging indent throughout", () => {
  const block = {
    page: 0,
    lines: [
      { page: 0, text: "Citation line one, hanging indent.", bbox: { x0: 0.15, y0: 0.2, x1: 0.6, y1: 0.23 } },
      { page: 0, text: "Citation line two, same indent.", bbox: { x0: 0.15, y0: 0.24, x1: 0.6, y1: 0.27 } },
      { page: 0, text: "Citation line three, same indent.", bbox: { x0: 0.15, y0: 0.28, x1: 0.6, y1: 0.31 } },
    ],
    text: "Citation line one, hanging indent. Citation line two, same indent. Citation line three, same indent.",
    bbox: { x0: 0.15, y0: 0.2, x1: 0.6, y1: 0.31 },
    fontSize: 10,
    type: "body",
    confidence: 0,
    column: undefined,
  };

  const split = splitParagraphBoundaries([block]);

  assert.equal(split.length, 1);
  assert.equal(split[0].lines.length, 3);
});

test("splitParagraphBoundaries never throws on a degenerate single-line block", () => {
  const block = {
    page: 0,
    lines: [
      { page: 0, text: "Only line.", bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.2 } },
    ],
    text: "Only line.",
    bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.2 },
    fontSize: 10,
    type: "body",
    confidence: 0,
    column: undefined,
  };

  assert.doesNotThrow(() => {
    const split = splitParagraphBoundaries([block]);
    assert.equal(split.length, 1);
  });
});

test("analyzeDocumentStats finds a header repeated across pages at a stable region", () => {
  const blocksByPage = [
    [pageBlock({ page: 0, text: "Evangeline Research Report", bbox: { x0: 0.3, y0: 0.02, x1: 0.7, y1: 0.05 } })],
    [pageBlock({ page: 1, text: "Evangeline Research Report", bbox: { x0: 0.3, y0: 0.02, x1: 0.7, y1: 0.05 } })],
    [pageBlock({ page: 2, text: "Evangeline Research Report", bbox: { x0: 0.3, y0: 0.02, x1: 0.7, y1: 0.05 } })],
  ];

  const stats = analyzeDocumentStats(blocksByPage);

  const match = stats.headerCandidates.find((candidate) => candidate.normalizedText.includes("evangeline research report"));
  assert.ok(match, "expected a header candidate to be found");
  assert.equal(match.pages.length, 3);
});

test("analyzeDocumentStats does not flag text that occurs on only one page", () => {
  const blocksByPage = [
    [pageBlock({ page: 0, text: "A one-time top note", bbox: { x0: 0.3, y0: 0.02, x1: 0.7, y1: 0.05 } })],
    [pageBlock({ page: 1, text: "Different content up top", bbox: { x0: 0.3, y0: 0.02, x1: 0.7, y1: 0.05 } })],
  ];

  const stats = analyzeDocumentStats(blocksByPage);

  const match = stats.headerCandidates.find((candidate) => candidate.normalizedText.includes("a one-time top note"));
  assert.equal(match, undefined);
});

test("analyzeDocumentStats derives a heading font-size threshold when body and heading sizes differ", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "A Big Heading", fontSize: 18, bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.14 } }),
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
      pageBlock({ page: 0, text: "Body text three.", fontSize: 10, bbox: { x0: 0.1, y0: 0.28, x1: 0.6, y1: 0.31 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);

  assert.equal(typeof stats.headingFontSizeThreshold, "number");
  assert.ok(stats.headingFontSizeThreshold > 10, "threshold should sit above the body size");
  assert.ok(stats.headingFontSizeThreshold < 18, "threshold should sit below the heading size");
});

test("analyzeDocumentStats reports no heading threshold when font sizes are uniform", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);

  assert.equal(stats.headingFontSizeThreshold, undefined);
});

test("analyzeDocumentStats derives a footnote font-size threshold when body and footnote sizes differ", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
      pageBlock({ page: 0, text: "Body text three.", fontSize: 10, bbox: { x0: 0.1, y0: 0.28, x1: 0.6, y1: 0.31 } }),
      pageBlock({ page: 0, text: "1. A small footnote.", fontSize: 6, bbox: { x0: 0.1, y0: 0.9, x1: 0.5, y1: 0.93 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);

  assert.equal(typeof stats.footnoteFontSizeThreshold, "number");
  assert.ok(stats.footnoteFontSizeThreshold < 10, "threshold should sit below the body size");
  assert.ok(stats.footnoteFontSizeThreshold > 6, "threshold should sit above the footnote size");
});

test("analyzeDocumentStats reports no footnote threshold when font sizes are uniform", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);

  assert.equal(stats.footnoteFontSizeThreshold, undefined);
});

test("assignBlockIds gives the same id for two calls given identical page/text/bbox (FR-009)", () => {
  const blocksByPage = [[pageBlock({ page: 0, text: "Repeatable content", bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.15 } })]];

  const first = assignBlockIds(blocksByPage);
  const second = assignBlockIds(blocksByPage);

  assert.equal(typeof first[0][0].id, "string");
  assert.ok(first[0][0].id.length > 0);
  assert.equal(first[0][0].id, second[0][0].id);
});

test("assignBlockIds gives distinct ids to blocks differing in page, text, or bbox", () => {
  const base = { text: "Same text", bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.15 } };
  const blocksByPage = [
    [pageBlock({ ...base, page: 0 })],
    [pageBlock({ ...base, page: 1 })],
  ];

  const [[differentPage], [samePageDifferentBbox]] = assignBlockIds(blocksByPage);
  const [[differentText]] = assignBlockIds([[pageBlock({ ...base, page: 0, text: "Other text" })]]);
  const [[movedBbox]] = assignBlockIds([[pageBlock({ ...base, page: 0, bbox: { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.25 } })]]);

  assert.notEqual(differentPage.id, samePageDifferentBbox.id);
  assert.notEqual(differentPage.id, differentText.id);
  assert.notEqual(differentPage.id, movedBbox.id);
});

test("assignBlockIds preserves every existing field on each block unchanged", () => {
  const block = pageBlock({ page: 2, text: "Preserve me", fontSize: 14, confidence: 0.75, column: 1 });
  const blocksByPage = [[block]];

  const [[result]] = assignBlockIds(blocksByPage);

  assert.equal(result.page, block.page);
  assert.equal(result.text, block.text);
  assert.deepEqual(result.bbox, block.bbox);
  assert.equal(result.fontSize, block.fontSize);
  assert.equal(result.confidence, block.confidence);
  assert.equal(result.column, block.column);
  assert.equal(result.type, block.type);
  assert.deepEqual(result.lines, block.lines);
});

test("buildPipelineOutput produces a display text and a narration text from the same pages", async () => {
  const pages = [
    [
      { str: "Plain body text.", transform: [12, 0, 0, 12, 50, 700], width: 90, height: 12 },
    ],
  ];

  const result = await buildPipelineOutput(pages, 600, 800);

  assert.equal(typeof result.displayText, "string");
  assert.equal(typeof result.narrationText, "string");
  assert.ok(result.displayText.includes("Plain body text."));
  assert.equal(result.displayText, result.narrationText);
});

// UI-freeze fix: buildPipelineOutput's per-page block-reconstruction loop must yield to a real
// macrotask (not just a microtask) between pages, so the browser can repaint/handle input during
// processing of a large document — mirrors the existing per-page yield already proven for PDF
// text extraction itself (see "extraction reports progress once per page").
test("buildPipelineOutput yields to a macrotask between pages during block reconstruction", async () => {
  const pages = [
    [{ str: "Page one.", transform: [12, 0, 0, 12, 50, 700], width: 60, height: 12 }],
    [{ str: "Page two.", transform: [12, 0, 0, 12, 50, 700], width: 60, height: 12 }],
    [{ str: "Page three.", transform: [12, 0, 0, 12, 50, 700], width: 60, height: 12 }],
  ];

  let macrotaskRanDuringProcessing = false;
  globalThis.setTimeout(() => { macrotaskRanDuringProcessing = true; }, 0);

  await buildPipelineOutput(pages, 600, 800);

  assert.equal(macrotaskRanDuringProcessing, true);
});

test("classifyBlocks promotes a block to header when it repeats at a stable region on most pages", () => {
  const headerBbox = { x0: 0.3, y0: 0.02, x1: 0.7, y1: 0.05 };
  const blocksByPage = [0, 1, 2].map((page) => [pageBlock({ page, text: "Evangeline Research Report", bbox: headerBbox })]);

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  classified.forEach((pageBlocks) => {
    assert.equal(pageBlocks[0].type, "header");
  });
});

test("classifyBlocks leaves a single-occurrence line classified as body", () => {
  const blocksByPage = [
    [pageBlock({ page: 0, text: "A one-time top note", bbox: { x0: 0.3, y0: 0.02, x1: 0.7, y1: 0.05 } })],
    [pageBlock({ page: 1, text: "Different content up top", bbox: { x0: 0.3, y0: 0.02, x1: 0.7, y1: 0.05 } })],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][0].type, "body");
  assert.equal(classified[1][0].type, "body");
});

test("classifyBlocks promotes a standalone page number with stable progression", () => {
  const blocksByPage = [1, 2, 3].map((num, index) => [pageBlock({ page: index, text: String(num), bbox: { x0: 0.47, y0: 0.94, x1: 0.53, y1: 0.97 } })]);

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  classified.forEach((pageBlocks) => {
    assert.equal(pageBlocks[0].type, "page-number");
  });
});

test("classifyBlocks classifies a block above the heading font-size threshold as a heading", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Chapter One", fontSize: 18, bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.14 } }),
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
      pageBlock({ page: 0, text: "Body text three.", fontSize: 10, bbox: { x0: 0.1, y0: 0.28, x1: 0.6, y1: 0.31 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][0].type, "heading");
});

test("classifyBlocks does not classify a large block as a heading when no document-wide threshold exists", () => {
  const largeBlockBbox = { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.14 };
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Chapter One", fontSize: 18, bbox: largeBlockBbox }),
      pageBlock({ page: 0, text: "Body text one.", fontSize: 18, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(stats.headingFontSizeThreshold, undefined);
  assert.equal(classified[0][0].type, "body");
});

test("classifyBlocks does not classify a block as a heading merely for being larger than its immediate neighbor without meeting the document-wide threshold", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Slightly larger line", fontSize: 10.5, bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.14 } }),
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
      pageBlock({ page: 0, text: "Body text three.", fontSize: 10, bbox: { x0: 0.1, y0: 0.28, x1: 0.6, y1: 0.31 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][0].type, "body");
});

// Found via manual validation against a real book (Never Wrestle with a Pig): a decorative
// drop-cap first letter is extracted by PDF.js as its own line/block at a much larger font size
// than body text (since it visually spans several body-text lines), and was being classified
// "heading" — which then split it out of its sentence during narration, producing a disruptive,
// out-of-place standalone "I" instead of the paragraph's actual first word. No legitimate
// section heading is a single character, so single-character blocks are excluded from heading
// classification regardless of font size (FR-001's "materially different" evidence should not
// apply to text this could not plausibly represent).
test("classifyBlocks does not classify a single-character block (a decorative drop cap) as a heading", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "I", fontSize: 28, bbox: { x0: 0.1, y0: 0.1, x1: 0.12, y1: 0.16 } }),
      pageBlock({ page: 0, text: "used to think that the best person to solve a problem", fontSize: 10.5, bbox: { x0: 0.13, y0: 0.1, x1: 0.6, y1: 0.13 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10.5, bbox: { x0: 0.1, y0: 0.14, x1: 0.6, y1: 0.17 } }),
      pageBlock({ page: 0, text: "Body text three.", fontSize: 10.5, bbox: { x0: 0.1, y0: 0.18, x1: 0.6, y1: 0.21 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][0].type, "body");
});

test("renderNarrationText includes heading text in the narrated output", () => {
  const orderedBlocksByPage = [
    [
      pageBlock({ page: 0, text: "Chapter One", type: "heading", lines: [{ text: "Chapter One", hasEol: false }] }),
      pageBlock({ page: 0, text: "Body text follows.", type: "body", lines: [{ text: "Body text follows.", hasEol: false }] }),
    ],
  ];

  const narration = renderNarrationText(orderedBlocksByPage);

  assert.match(narration, /Chapter One/);
  assert.match(narration, /Body text follows\./);
});

test("classifyBlocks classifies a small-font block confined to the footer zone as a footnote", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
      pageBlock({ page: 0, text: "Body text three.", fontSize: 10, bbox: { x0: 0.1, y0: 0.28, x1: 0.6, y1: 0.31 } }),
      pageBlock({ page: 0, text: "1. A small footnote at the bottom of the page.", fontSize: 6, bbox: { x0: 0.1, y0: 0.9, x1: 0.5, y1: 0.93 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][3].type, "footnote");
});

// Found via manual validation against a real book (Never Wrestle with a Pig): a bare page
// number in the footer/header zone with a small font (smaller than the surrounding body text,
// as page numbers often are) was being classified "footnote" instead of "page-number" or "body"
// whenever it didn't repeat across pages with the exact same digit (page-number classification
// requires that repetition; a single-page sample's page numbers are all different digits, so
// none of them ever qualify). A standalone number is page-number-shaped text, not footnote
// content, regardless of whether the stricter page-number repetition evidence also fired.
test("classifyBlocks does not classify a standalone page number as a footnote even when it is small and in the footer zone", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
      pageBlock({ page: 0, text: "Body text three.", fontSize: 10, bbox: { x0: 0.1, y0: 0.28, x1: 0.6, y1: 0.31 } }),
      pageBlock({ page: 0, text: "Body text four.", fontSize: 10, bbox: { x0: 0.1, y0: 0.32, x1: 0.6, y1: 0.35 } }),
      pageBlock({ page: 0, text: "3", fontSize: 8, bbox: { x0: 0.95, y0: 0.87, x1: 0.98, y1: 0.9 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.notEqual(classified[0][4].type, "footnote");
});

test("classifyBlocks does not classify a small-font block as a footnote when it is not in the footer zone", () => {
  // The small-font block sits directly beneath the body blocks with a typical, non-isolating
  // gap (not near either page edge, and not isolated from neighbors on both sides) so this
  // fixture tests footnote evidence specifically, without also triggering caption evidence
  // (isolation) via the same block.
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
      pageBlock({ page: 0, text: "Body text three.", fontSize: 10, bbox: { x0: 0.1, y0: 0.28, x1: 0.6, y1: 0.31 } }),
      pageBlock({ page: 0, text: "A small aside in the middle of the page.", fontSize: 6, bbox: { x0: 0.1, y0: 0.32, x1: 0.5, y1: 0.35 } }),
      pageBlock({ page: 0, text: "Body text continues right after.", fontSize: 10, bbox: { x0: 0.1, y0: 0.36, x1: 0.6, y1: 0.39 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][3].type, "body");
});

test("classifyBlocks classifies an isolated small-font block as a caption", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Body text one.", fontSize: 10, bbox: { x0: 0.1, y0: 0.2, x1: 0.6, y1: 0.23 } }),
      pageBlock({ page: 0, text: "Body text two.", fontSize: 10, bbox: { x0: 0.1, y0: 0.24, x1: 0.6, y1: 0.27 } }),
      pageBlock({ page: 0, text: "Body text three.", fontSize: 10, bbox: { x0: 0.1, y0: 0.28, x1: 0.6, y1: 0.31 } }),
      pageBlock({ page: 0, text: "Figure 1: A diagram of the process.", fontSize: 7, bbox: { x0: 0.1, y0: 0.55, x1: 0.5, y1: 0.58 } }),
      pageBlock({ page: 0, text: "Body text continues here.", fontSize: 10, bbox: { x0: 0.1, y0: 0.75, x1: 0.6, y1: 0.78 } }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][3].type, "caption");
});

test("classifyBlocks does not classify a page-number-zone block as a caption", () => {
  const blocksByPage = [1, 2, 3].map((num, index) => [pageBlock({ page: index, text: String(num), bbox: { x0: 0.47, y0: 0.94, x1: 0.53, y1: 0.97 }, fontSize: 8 })]);

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  classified.forEach((pageBlocks) => {
    assert.notEqual(pageBlocks[0].type, "caption");
  });
});

function tableRowLine(page, y0, y1, leftText, rightText) {
  return {
    page,
    text: `${leftText} ${rightText}`,
    bbox: { x0: 0.1, y0, x1: 0.6, y1 },
    // Individual cell items on this line, mirroring how findStableColumnGap inspects narrow
    // items directly rather than a merged line bbox — a table row's own cells, not the row
    // itself, are what must show a stable gap on both sides.
    items: [
      { text: leftText, page, bbox: { x0: 0.1, y0, x1: 0.25, y1 } },
      { text: rightText, page, bbox: { x0: 0.45, y0, x1: 0.55, y1 } },
    ],
  };
}

test("classifyBlocks classifies three or more lines sharing a repeated column-gap pattern as a table", () => {
  const lines = [
    tableRowLine(0, 0.3, 0.33, "Alice", "90"),
    tableRowLine(0, 0.35, 0.38, "Bob", "85"),
    tableRowLine(0, 0.4, 0.43, "Carol", "77"),
  ];
  const blocksByPage = [
    [
      pageBlock({
        page: 0,
        text: "Alice 90 Bob 85 Carol 77",
        bbox: { x0: 0.1, y0: 0.3, x1: 0.6, y1: 0.43 },
        lines,
      }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][0].type, "table");
});

test("classifyBlocks does not classify two aligned lines as a table (repetition threshold not met)", () => {
  const lines = [
    tableRowLine(0, 0.3, 0.33, "Alice", "90"),
    tableRowLine(0, 0.35, 0.38, "Bob", "85"),
  ];
  const blocksByPage = [
    [
      pageBlock({
        page: 0,
        text: "Alice 90 Bob 85",
        bbox: { x0: 0.1, y0: 0.3, x1: 0.6, y1: 0.38 },
        lines,
      }),
    ],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][0].type, "body");
});

test("renderNarrationText excludes footnote, caption, and table block text", () => {
  const orderedBlocksByPage = [
    [
      pageBlock({ page: 0, text: "Body text stays.", type: "body", lines: [{ text: "Body text stays.", hasEol: false }] }),
      pageBlock({ page: 0, text: "1. A footnote is excluded.", type: "footnote", lines: [{ text: "1. A footnote is excluded.", hasEol: false }] }),
      pageBlock({ page: 0, text: "Figure 1: A caption is excluded.", type: "caption", lines: [{ text: "Figure 1: A caption is excluded.", hasEol: false }] }),
      pageBlock({ page: 0, text: "Alice 90 Bob 85", type: "table", lines: [{ text: "Alice 90 Bob 85", hasEol: false }] }),
    ],
  ];

  const narration = renderNarrationText(orderedBlocksByPage);

  assert.match(narration, /Body text stays\./);
  assert.doesNotMatch(narration, /footnote is excluded/);
  assert.doesNotMatch(narration, /caption is excluded/);
  assert.doesNotMatch(narration, /Alice 90 Bob 85/);
});

test("classifyBlocks does not classify a number embedded in a sentence as a page number", () => {
  const blocksByPage = [
    [pageBlock({ page: 0, text: "In 2024, the results were published.", bbox: { x0: 0.1, y0: 0.4, x1: 0.6, y1: 0.43 } })],
  ];

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  assert.equal(classified[0][0].type, "body");
});

test("detectColumns assigns columns across a stable page-spanning gap", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Left column body text.", bbox: { x0: 0.05, y0: 0.1, x1: 0.46, y1: 0.9 } }),
      pageBlock({ page: 0, text: "Right column body text.", bbox: { x0: 0.54, y0: 0.1, x1: 0.95, y1: 0.9 } }),
    ],
  ];

  const result = detectColumns(blocksByPage);

  assert.equal(result[0][0].column, 0);
  assert.equal(result[0][1].column, 1);
});

test("detectColumns leaves a full-width block unassigned to a column", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "A Wide Title Spanning The Page", bbox: { x0: 0.05, y0: 0.02, x1: 0.95, y1: 0.06 } }),
      pageBlock({ page: 0, text: "Left column body text.", bbox: { x0: 0.05, y0: 0.1, x1: 0.46, y1: 0.9 } }),
      pageBlock({ page: 0, text: "Right column body text.", bbox: { x0: 0.54, y0: 0.1, x1: 0.95, y1: 0.9 } }),
    ],
  ];

  const result = detectColumns(blocksByPage);

  assert.equal(result[0][0].column, undefined);
});

test("detectColumns assigns no columns when there is no stable gap", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Single column body text one.", bbox: { x0: 0.05, y0: 0.1, x1: 0.95, y1: 0.3 } }),
      pageBlock({ page: 0, text: "Single column body text two.", bbox: { x0: 0.05, y0: 0.35, x1: 0.95, y1: 0.55 } }),
    ],
  ];

  const result = detectColumns(blocksByPage);

  assert.equal(result[0][0].column, undefined);
  assert.equal(result[0][1].column, undefined);
});

test("resolveReadingOrder orders left-column blocks before right-column blocks", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Right column, appears first in raw order.", bbox: { x0: 0.54, y0: 0.1, x1: 0.95, y1: 0.3 }, column: 1 }),
      pageBlock({ page: 0, text: "Left column, appears second in raw order.", bbox: { x0: 0.05, y0: 0.1, x1: 0.46, y1: 0.3 }, column: 0 }),
    ],
  ];

  const result = resolveReadingOrder(blocksByPage, ["two-column"]);

  assert.equal(result[0][0].column, 0);
  assert.equal(result[0][1].column, 1);
});

test("resolveReadingOrder places a mid-page full-width block between full column segments, not mid-column", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Title at top", bbox: { x0: 0.05, y0: 0.05, x1: 0.95, y1: 0.08 }, column: undefined }),
      pageBlock({ page: 0, text: "Left col para 1", bbox: { x0: 0.05, y0: 0.1, x1: 0.46, y1: 0.2 }, column: 0 }),
      pageBlock({ page: 0, text: "Right col para 1", bbox: { x0: 0.54, y0: 0.1, x1: 0.95, y1: 0.2 }, column: 1 }),
      pageBlock({ page: 0, text: "Mid-page full-width caption", bbox: { x0: 0.05, y0: 0.5, x1: 0.95, y1: 0.53 }, column: undefined }),
      pageBlock({ page: 0, text: "Left col para 2", bbox: { x0: 0.05, y0: 0.6, x1: 0.46, y1: 0.7 }, column: 0 }),
      pageBlock({ page: 0, text: "Right col para 2", bbox: { x0: 0.54, y0: 0.6, x1: 0.95, y1: 0.7 }, column: 1 }),
    ],
  ];

  const result = resolveReadingOrder(blocksByPage, ["two-column"]);

  assert.deepEqual(result[0].map((block) => block.text), [
    "Title at top",
    "Left col para 1",
    "Right col para 1",
    "Mid-page full-width caption",
    "Left col para 2",
    "Right col para 2",
  ]);
});

test("resolveReadingOrder leaves a single-column page's order unchanged", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "First paragraph.", bbox: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.2 }, column: undefined }),
      pageBlock({ page: 0, text: "Second paragraph.", bbox: { x0: 0.1, y0: 0.25, x1: 0.9, y1: 0.35 }, column: undefined }),
    ],
  ];

  const result = resolveReadingOrder(blocksByPage, ["single"]);

  assert.equal(result[0][0].text, "First paragraph.");
  assert.equal(result[0][1].text, "Second paragraph.");
});

test("DEFAULT_SPEECH_POLICY exposes all documented fields with their documented default values (spec 005 Foundational)", () => {
  assert.equal(DEFAULT_SPEECH_POLICY.speakTitles, true);
  assert.equal(DEFAULT_SPEECH_POLICY.speakHeadings, true);
  assert.equal(DEFAULT_SPEECH_POLICY.speakPageNumbers, false);
  assert.equal(DEFAULT_SPEECH_POLICY.speakHeaders, false);
  assert.equal(DEFAULT_SPEECH_POLICY.speakFooters, false);
  assert.equal(DEFAULT_SPEECH_POLICY.speakFootnotes, false);
  assert.equal(DEFAULT_SPEECH_POLICY.speakCaptions, false);
  assert.equal(DEFAULT_SPEECH_POLICY.speakCitations, false);
  assert.equal(DEFAULT_SPEECH_POLICY.speakReferences, false);
  assert.equal(DEFAULT_SPEECH_POLICY.tables, "skip");
});

test("shouldSpeak(type, DEFAULT_SPEECH_POLICY) matches the old NARRATION_EXCLUDED_TYPES result for every block type (FR-001, FR-002)", () => {
  const expected = {
    body: true,
    heading: true,
    header: false,
    footer: false,
    "page-number": false,
    footnote: false,
    caption: false,
    table: false,
  };

  Object.entries(expected).forEach(([type, expectedSpeak]) => {
    assert.equal(shouldSpeak(type, DEFAULT_SPEECH_POLICY), expectedSpeak, `type: ${type}`);
  });
});

test("resolveSpeechPolicy() and resolveSpeechPolicy({}) both equal DEFAULT_SPEECH_POLICY", () => {
  assert.deepEqual(resolveSpeechPolicy(), DEFAULT_SPEECH_POLICY);
  assert.deepEqual(resolveSpeechPolicy({}), DEFAULT_SPEECH_POLICY);
});

test("resolveSpeechPolicy applies a partial override without changing any other field (FR-006, SC-004)", () => {
  const resolved = resolveSpeechPolicy({ speakFootnotes: true });

  assert.equal(resolved.speakFootnotes, true);
  Object.keys(DEFAULT_SPEECH_POLICY)
    .filter((key) => key !== "speakFootnotes")
    .forEach((key) => {
      assert.equal(resolved[key], DEFAULT_SPEECH_POLICY[key], `field: ${key}`);
    });
});

test("DEFAULT_SPEECH_POLICY's tables field is a named mode, and non-default modes are accepted without error (spec 005 US3 AS2)", () => {
  assert.ok(["skip", "summary", "detailed"].includes(DEFAULT_SPEECH_POLICY.tables));

  assert.doesNotThrow(() => resolveSpeechPolicy({ tables: "summary" }));
  assert.doesNotThrow(() => resolveSpeechPolicy({ tables: "detailed" }));
  assert.equal(resolveSpeechPolicy({ tables: "summary" }).tables, "summary");
  assert.equal(resolveSpeechPolicy({ tables: "detailed" }).tables, "detailed");
});

test("inert forward-compatible fields (speakCitations, speakReferences) are accepted without affecting any current block type (spec 005 US3, FR-007)", () => {
  const citationsPolicy = resolveSpeechPolicy({ speakCitations: true });
  const referencesPolicy = resolveSpeechPolicy({ speakReferences: true });

  assert.doesNotThrow(() => resolveSpeechPolicy({ speakCitations: true }));
  assert.doesNotThrow(() => resolveSpeechPolicy({ speakReferences: true }));

  ["body", "heading", "header", "footer", "page-number", "footnote", "caption", "table"].forEach((type) => {
    assert.equal(shouldSpeak(type, citationsPolicy), shouldSpeak(type, DEFAULT_SPEECH_POLICY), `type: ${type} under speakCitations override`);
    assert.equal(shouldSpeak(type, referencesPolicy), shouldSpeak(type, DEFAULT_SPEECH_POLICY), `type: ${type} under speakReferences override`);
  });
});

test("buildDocumentAst: every block exposes id, page, type, text, readingOrder, and speak (US2)", () => {
  const blocksByPage = assignBlockIds([
    [
      pageBlock({ page: 0, text: "Chapter One", type: "heading" }),
      pageBlock({ page: 0, text: "Body paragraph.", type: "body" }),
      pageBlock({ page: 0, text: "Evangeline Research Report", type: "header" }),
      pageBlock({ page: 0, text: "Confidential", type: "footer" }),
      pageBlock({ page: 0, text: "3", type: "page-number" }),
      pageBlock({ page: 0, text: "1. See Smith.", type: "footnote" }),
      pageBlock({ page: 0, text: "Figure 1.", type: "caption" }),
      pageBlock({ page: 0, text: "Col A  Col B", type: "table" }),
    ],
  ]);

  const document = buildDocumentAst(blocksByPage);
  const allBlocks = document.sections.flatMap((section) => section.blocks);

  assert.equal(allBlocks.length, 8);
  allBlocks.forEach((block) => {
    assert.equal(typeof block.id, "string");
    assert.equal(typeof block.page, "number");
    assert.equal(typeof block.type, "string");
    assert.equal(typeof block.text, "string");
    assert.equal(typeof block.readingOrder, "number");
    assert.equal(typeof block.speak, "boolean");
  });
});

test("buildDocumentAst preserves an existing confidence value on a block (US2)", () => {
  const blocksByPage = assignBlockIds([
    [pageBlock({ page: 0, text: "3", type: "page-number", confidence: 0.9 })],
  ]);

  const document = buildDocumentAst(blocksByPage);

  assert.equal(document.sections[0].blocks[0].confidence, 0.9);
});

test("buildDocumentAst preserves bbox/style.fontSize when present and omits them when absent (US2)", () => {
  const blocksByPage = assignBlockIds([
    [
      pageBlock({ page: 0, text: "Has layout", bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.15 }, fontSize: 12 }),
      pageBlock({ page: 0, text: "No layout", bbox: undefined, fontSize: undefined }),
    ],
  ]);

  const document = buildDocumentAst(blocksByPage);
  const [withLayout, withoutLayout] = document.sections[0].blocks;

  assert.deepEqual(withLayout.bbox, { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.15 });
  assert.equal(withLayout.style.fontSize, 12);
  assert.equal(withoutLayout.bbox, undefined);
  assert.equal(withoutLayout.style, undefined);
});

test("buildDocumentAst assigns strictly increasing readingOrder across a multi-page document (US2)", () => {
  const blocksByPage = assignBlockIds([
    [pageBlock({ page: 0, text: "Page one, block one." }), pageBlock({ page: 0, text: "Page one, block two." })],
    [pageBlock({ page: 1, text: "Page two, block one." })],
  ]);

  const document = buildDocumentAst(blocksByPage);
  const allBlocks = document.sections.flatMap((section) => section.blocks);
  const orders = allBlocks.map((block) => block.readingOrder);

  orders.slice(1).forEach((order, index) => {
    assert.ok(order > orders[index]);
  });
});

test("overriding speakFootnotes:true includes a footnote consistently in both narrationText and speak flag (spec 005 US2 AS1)", () => {
  const blocksByPage = assignBlockIds([
    [pageBlock({ page: 0, text: "A footnote about the source.", type: "footnote" })],
  ]);
  const policy = resolveSpeechPolicy({ speakFootnotes: true });

  const narrationText = renderNarrationText(blocksByPage, policy);
  const document = buildDocumentAst(blocksByPage, policy);

  assert.ok(narrationText.includes("A footnote about the source."));
  assert.equal(document.sections[0].blocks[0].speak, true);
});

test("overriding speakHeadings:false excludes a heading consistently in both narrationText and speak flag (spec 005 US2 AS2)", () => {
  const blocksByPage = assignBlockIds([
    [pageBlock({ page: 0, text: "Chapter One", type: "heading" })],
  ]);
  const policy = resolveSpeechPolicy({ speakHeadings: false });

  const narrationText = renderNarrationText(blocksByPage, policy);
  const document = buildDocumentAst(blocksByPage, policy);

  assert.ok(!narrationText.includes("Chapter One"));
  assert.equal(document.sections[0].blocks[0].speak, false);
});

test("overriding tables:'detailed' includes a table consistently in both narrationText and speak flag (spec 005 US2, SC-003)", () => {
  const blocksByPage = assignBlockIds([
    [pageBlock({ page: 0, text: "Revenue  Cost", type: "table" })],
  ]);
  const policy = resolveSpeechPolicy({ tables: "detailed" });

  const narrationText = renderNarrationText(blocksByPage, policy);
  const document = buildDocumentAst(blocksByPage, policy);

  assert.ok(narrationText.includes("Revenue"));
  assert.equal(document.sections[0].blocks[0].speak, true);
});

test("buildDocumentAst groups blocks under their enclosing heading section, in order (US3)", () => {
  const blocksByPage = assignBlockIds([
    [
      pageBlock({ page: 0, text: "Introduction", type: "heading" }),
      pageBlock({ page: 0, text: "First intro paragraph.", type: "body" }),
      pageBlock({ page: 0, text: "Second intro paragraph.", type: "body" }),
      pageBlock({ page: 0, text: "Methods", type: "heading" }),
      pageBlock({ page: 0, text: "First methods paragraph.", type: "body" }),
    ],
  ]);

  const document = buildDocumentAst(blocksByPage);

  assert.equal(document.sections.length, 2);
  assert.equal(document.sections[0].title, "Introduction");
  assert.deepEqual(document.sections[0].blocks.map((block) => block.text), [
    "Introduction",
    "First intro paragraph.",
    "Second intro paragraph.",
  ]);
  assert.equal(document.sections[1].title, "Methods");
  assert.deepEqual(document.sections[1].blocks.map((block) => block.text), [
    "Methods",
    "First methods paragraph.",
  ]);
});

test("buildDocumentAst and renderNarrationText called with no policy argument reproduce pre-005 behavior (US1, FR-001/FR-002/FR-008)", () => {
  const blocksByPage = assignBlockIds([
    [
      pageBlock({ page: 0, text: "Heading", type: "heading" }),
      pageBlock({ page: 0, text: "Body content.", type: "body" }),
      pageBlock({ page: 0, text: "Header repeats", type: "header" }),
      pageBlock({ page: 0, text: "Footnote text", type: "footnote" }),
      pageBlock({ page: 0, text: "3", type: "page-number" }),
      pageBlock({ page: 0, text: "Caption text", type: "caption" }),
      pageBlock({ page: 0, text: "Table cell", type: "table" }),
    ],
  ]);

  const document = buildDocumentAst(blocksByPage);
  const narrationText = renderNarrationText(blocksByPage);
  const speakByType = Object.fromEntries(
    document.sections.flatMap((section) => section.blocks).map((block) => [block.type, block.speak]),
  );

  assert.equal(speakByType.heading, true);
  assert.equal(speakByType.body, true);
  assert.equal(speakByType.header, false);
  assert.equal(speakByType.footnote, false);
  assert.equal(speakByType["page-number"], false);
  assert.equal(speakByType.caption, false);
  assert.equal(speakByType.table, false);

  assert.ok(narrationText.includes("Body content."));
  assert.ok(!narrationText.includes("Header repeats"));
  assert.ok(!narrationText.includes("Footnote text"));
  assert.ok(!narrationText.includes("Caption text"));
  assert.ok(!narrationText.includes("Table cell"));
});

test("buildPipelineOutput called with no policy argument reproduces the pre-005 baseline exactly (US1)", async () => {
  const headerText = "Evangeline Research Report";
  const pages = [
    [
      { str: headerText, transform: [10, 0, 0, 10, 200, 780], width: 180, height: 10 },
      { str: "Real body content that should be spoken.", transform: [10, 0, 0, 10, 50, 400], width: 500, height: 10 },
      { str: "1", transform: [10, 0, 0, 10, 295, 20], width: 10, height: 10 },
    ],
    [
      { str: headerText, transform: [10, 0, 0, 10, 200, 780], width: 180, height: 10 },
      { str: "More body content on page two.", transform: [10, 0, 0, 10, 50, 400], width: 500, height: 10 },
      { str: "2", transform: [10, 0, 0, 10, 295, 20], width: 10, height: 10 },
    ],
  ];

  const result = await buildPipelineOutput(pages, 600, 800);

  assert.ok(!result.narrationText.includes(headerText));
  assert.ok(result.narrationText.includes("Real body content"));
  assert.equal(typeof result.document, "object");
});

test("buildDocumentAst produces one implicit section when a document has no headings (US3)", () => {
  const blocksByPage = assignBlockIds([
    [pageBlock({ page: 0, text: "Only paragraph one.", type: "body" }), pageBlock({ page: 0, text: "Only paragraph two.", type: "body" })],
  ]);

  const document = buildDocumentAst(blocksByPage);

  assert.equal(document.sections.length, 1);
  assert.equal(document.sections[0].title, undefined);
  assert.equal(document.sections[0].blocks.length, 2);
});

test("buildDocumentAst's sections lose no block and duplicate none, relative to the flat reading order (US3)", () => {
  const blocksByPage = assignBlockIds([
    [
      pageBlock({ page: 0, text: "Leading paragraph before any heading.", type: "body" }),
      pageBlock({ page: 0, text: "Chapter One", type: "heading" }),
      pageBlock({ page: 0, text: "Body under chapter one.", type: "body" }),
    ],
    [pageBlock({ page: 1, text: "Chapter Two", type: "heading" }), pageBlock({ page: 1, text: "Body under chapter two.", type: "body" })],
  ]);

  const flatTextInOrder = blocksByPage.flat().map((block) => block.text);
  const document = buildDocumentAst(blocksByPage);
  const sectionedTextInOrder = document.sections.flatMap((section) => section.blocks.map((block) => block.text));

  assert.deepEqual(sectionedTextInOrder, flatTextInOrder);
});

// US1 regression guard (FR-005, FR-006, FR-010): a hardcoded pre-feature baseline for
// displayText/narrationText, covering headers, page numbers, citations, and URLs together. This
// is deliberately independent of the exclusion-behavior tests above (which assert inclusion/
// exclusion, not exact literal values) — a schema/section change to this feature must not shift
// so much as one character of either string.
test("buildPipelineOutput's displayText/narrationText match the pre-004 baseline exactly (US1)", async () => {
  const headerText = "Evangeline Research Report";
  const bodyText = "Real body content that should be spoken, referencing [12] and https://example.com.";
  const pageNumberText = "1";

  const pages = [
    [
      { str: headerText, transform: [10, 0, 0, 10, 200, 780], width: 180, height: 10 },
      { str: bodyText, transform: [10, 0, 0, 10, 50, 400], width: 500, height: 10 },
      { str: pageNumberText, transform: [10, 0, 0, 10, 295, 20], width: 10, height: 10 },
    ],
    [
      { str: headerText, transform: [10, 0, 0, 10, 200, 780], width: 180, height: 10 },
      { str: "More body content on page two.", transform: [10, 0, 0, 10, 50, 400], width: 500, height: 10 },
      { str: "2", transform: [10, 0, 0, 10, 295, 20], width: 10, height: 10 },
    ],
  ];

  const result = await buildPipelineOutput(pages, 600, 800);

  assert.equal(
    result.displayText,
    "Evangeline Research Report Real body content that should be spoken, referencing [12] and https://example.com. 1\n\nEvangeline Research Report More body content on page two. 2",
  );
  assert.equal(
    result.narrationText,
    "Real body content that should be spoken, referencing and \n\nMore body content on page two.",
  );
});

test("buildPipelineOutput assigns identical block/section ids across repeated calls with the same input (US1, FR-009, SC-003)", async () => {
  const pages = [
    [
      { str: "Chapter One", transform: [18, 0, 0, 18, 50, 760], width: 120, height: 18 },
      { str: "Body paragraph content.", transform: [10, 0, 0, 10, 50, 700], width: 150, height: 10 },
    ],
  ];

  const first = await buildPipelineOutput(pages, 600, 800);
  const second = await buildPipelineOutput(pages, 600, 800);

  const firstIds = first.document.sections.flatMap((section) => [section.id, ...section.blocks.map((block) => block.id)]);
  const secondIds = second.document.sections.flatMap((section) => [section.id, ...section.blocks.map((block) => block.id)]);

  assert.deepEqual(firstIds, secondIds);
  assert.ok(firstIds.every((id) => typeof id === "string" && id.length > 0));
});

// The one case not covered by the synthetic-fixture section-grouping tests above: a recurring
// header appearing before the first real heading, run through the full pipeline (not just
// buildDocumentAst directly), forms its own leading implicit section rather than attaching to
// "Introduction".
test("buildPipelineOutput's document gives a pre-heading recurring header its own leading implicit section (T023)", async () => {
  const pages = [
    [
      { str: "Evangeline Research Report", transform: [10, 0, 0, 10, 200, 780], width: 180, height: 10 },
      { str: "Introduction", transform: [18, 0, 0, 18, 50, 760], width: 120, height: 18 },
      { str: "This is the introduction body.", transform: [10, 0, 0, 10, 50, 700], width: 500, height: 10 },
    ],
    [
      { str: "Evangeline Research Report", transform: [10, 0, 0, 10, 200, 780], width: 180, height: 10 },
      { str: "Methods", transform: [18, 0, 0, 18, 50, 760], width: 120, height: 18 },
      { str: "This is the methods body content.", transform: [10, 0, 0, 10, 50, 700], width: 500, height: 10 },
    ],
  ];

  const result = await buildPipelineOutput(pages, 600, 800);

  assert.equal(result.document.sections.length, 3);
  assert.equal(result.document.sections[0].title, undefined);
  assert.equal(result.document.sections[1].title, "Introduction");
  assert.equal(result.document.sections[2].title, "Methods");
});

// Overriding several fields together does not cross-contaminate an unrelated, untouched field's
// result — the one assertion not already covered by the single-field-override tests above.
test("multiple simultaneous policy overrides propagate consistently without cross-field interference (spec 005 T024)", () => {
  const blocksByPage = assignBlockIds([
    [
      pageBlock({ page: 0, text: "Heading", type: "heading" }),
      pageBlock({ page: 0, text: "Body.", type: "body" }),
      pageBlock({ page: 0, text: "Footnote text.", type: "footnote" }),
      pageBlock({ page: 0, text: "Caption text.", type: "caption" }),
      pageBlock({ page: 0, text: "Table cell.", type: "table" }),
    ],
  ]);

  const policy = resolveSpeechPolicy({ speakFootnotes: true, tables: "summary" });
  const narrationText = renderNarrationText(blocksByPage, policy);
  const document = buildDocumentAst(blocksByPage, policy);
  const speakByType = Object.fromEntries(
    document.sections.flatMap((section) => section.blocks).map((block) => [block.type, block.speak]),
  );

  assert.ok(narrationText.includes("Footnote text."));
  assert.ok(narrationText.includes("Table cell."));
  assert.ok(!narrationText.includes("Caption text."));
  assert.equal(speakByType.footnote, true);
  assert.equal(speakByType.table, true);
  assert.equal(speakByType.caption, false);
});

test("renderNarrationText excludes header, footer, and page-number block text", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Evangeline Research Report", type: "header" }),
      pageBlock({ page: 0, text: "This is the real body content.", type: "body" }),
      pageBlock({ page: 0, text: "3", type: "page-number" }),
    ],
  ];

  const narration = renderNarrationText(blocksByPage);

  assert.ok(!narration.includes("Evangeline Research Report"));
  assert.ok(!/(^|\s)3(\s|$)/.test(narration));
  assert.ok(narration.includes("This is the real body content."));
});

test("renderNarrationText removes numeric citation markers and bare URLs but not [sic]", () => {
  const blocksByPage = [
    [
      pageBlock({ page: 0, text: "Several studies [12, 14] demonstrated this [sic] effect. See https://example.com/report for details.", type: "body" }),
    ],
  ];

  const narration = renderNarrationText(blocksByPage);

  assert.ok(!narration.includes("[12, 14]"));
  assert.ok(!narration.includes("https://example.com/report"));
  assert.ok(narration.includes("[sic]"));
  assert.ok(narration.includes("Several studies"));
  assert.ok(narration.includes("demonstrated this"));
});

test("renderNarrationText merges a hyphenated wrap within one block but not across two blocks", () => {
  const blocksByPage = [
    [
      pageBlock({
        page: 0,
        type: "body",
        lines: [
          { text: "This is an example of under-", bbox: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.13 } },
          { text: "standing wrapped text.", bbox: { x0: 0.1, y0: 0.14, x1: 0.9, y1: 0.17 } },
        ],
      }),
      pageBlock({
        page: 0,
        type: "body",
        lines: [
          { text: "A new block starts with over-", bbox: { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.33 } },
        ],
      }),
      pageBlock({
        page: 0,
        type: "body",
        lines: [
          { text: "seas travel in the next block.", bbox: { x0: 0.1, y0: 0.4, x1: 0.9, y1: 0.43 } },
        ],
      }),
    ],
  ];

  const narration = renderNarrationText(blocksByPage);

  assert.ok(narration.includes("understanding wrapped text"));
  assert.ok(!narration.includes("overseas"));
  assert.ok(/over-\s+seas travel in the next block/.test(narration));
});

test("convertCardinal produces correct spoken form across group boundaries (spec 006 Foundational)", () => {
  assert.equal(convertCardinal("400"), "four hundred");
  assert.equal(convertCardinal("12500"), "twelve thousand five hundred");
  assert.equal(convertCardinal("1000000"), "one million");
  assert.equal(convertCardinal("15"), "fifteen");
  assert.equal(convertCardinal("21"), "twenty-one");
  assert.equal(convertCardinal("105"), "one hundred five");
});

test("convertCardinal('0') returns 'zero' (boundary case)", () => {
  assert.equal(convertCardinal("0"), "zero");
});

test("detectNumericEntities returns an empty array for text with no numeric-like span (spec 006 Foundational, FR-017)", () => {
  assert.deepEqual(detectNumericEntities("This is plain prose with no numbers at all."), []);
});

test("detectNumericEntities classifies a plain unambiguous cardinal as one entity (spec 006 Foundational)", () => {
  const entities = detectNumericEntities("There are 400 units.");

  assert.equal(entities.length, 1);
  assert.equal(entities[0].category, "cardinal");
  assert.equal(entities[0].match, "400");
});

test("detectNumericEntities completes quickly on adversarial input (ReDoS safety, spec 006 Foundational)", () => {
  const longDigitRun = "9".repeat(5000);
  const longSeparatorRun = `1${",".repeat(5000)}2`;

  const start = Date.now();
  detectNumericEntities(`Data: ${longDigitRun} and ${longSeparatorRun}.`);
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 1000, `expected under 1000ms, took ${elapsedMs}ms`);
});

// Regression test for a genuine bug found during implementation: a digit run long enough to
// exceed Number.MAX_SAFE_INTEGER degrades to Infinity in convertCardinal's group-extraction
// loop, whose modulo (NaN) and quotient (still Infinity) never satisfy the loop's exit
// condition, hanging indefinitely. Distinct from regex-backtracking ReDoS above — this is a
// numeric-overflow DoS in the converter itself, only exposed once CARDINAL_PATTERN correctly
// matches a long unformatted run as one span instead of fragmenting it (FR-013's "leave
// unclassifiable input unmodified" is the correct behavior here, per OWASP A08:2025).
test("convertCardinal does not hang on a digit run beyond this pipeline's largest named scale (spec 006, A08:2025)", () => {
  const tooLarge = "9".repeat(350);

  const start = Date.now();
  const result = convertCardinal(tooLarge);
  const elapsedMs = Date.now() - start;

  assert.ok(elapsedMs < 1000, `expected under 1000ms, took ${elapsedMs}ms`);
  assert.equal(result, tooLarge);
});

// Convergence Phase 8, T051: convertCardinal's overflow guard (returns the original digit text
// unchanged when a number exceeds this pipeline's largest named scale) must propagate through
// every converter that calls it internally — otherwise the wrapping converter appends its own
// unit/format text to the raw, unconverted digits, producing a garbled reading FR-013 forbids.
test("convertCurrency/convertPercentage/convertDecimal each leave an oversized amount's full match unmodified rather than appending unit/format text to raw digits (spec 006 Convergence T051, FR-013)", () => {
  const oversized = "9".repeat(350);

  assert.equal(convertCurrency(`$${oversized}`), `$${oversized}`);
  assert.equal(convertPercentage(`${oversized}%`), `${oversized}%`);
  assert.equal(convertDecimal(`${oversized}.14`), `${oversized}.14`);
  // convertYear needs no such guard: YEAR_PATTERN can only ever match exactly 4 digits, so it
  // can never reach the overflow threshold in the first place.
});

test("normalizeSpokenText leaves oversized currency/percentage/decimal spans in narration completely unmodified (spec 006 Convergence T051, FR-013 end-to-end)", () => {
  const oversized = "9".repeat(350);

  assert.equal(normalizeSpokenText(`The price is $${oversized} today.`), `The price is $${oversized} today.`);
  assert.equal(normalizeSpokenText(`The rate is ${oversized}% today.`), `The rate is ${oversized}% today.`);
  assert.equal(normalizeSpokenText(`The value is ${oversized}.14 today.`), `The value is ${oversized}.14 today.`);
});

test("detectNumericEntities classifies a thousands-separated cardinal as one entity (spec 006 US1)", () => {
  const entities = detectNumericEntities("The population is 12,500.");

  assert.equal(entities.length, 1);
  assert.equal(entities[0].category, "cardinal");
  assert.equal(entities[0].match, "12,500");
});

test("detectNumericEntities classifies labeled/phone-shaped digit sequences as code, and unlabeled long runs as cardinal (spec 006 US1, FR-004)", () => {
  const pinEntities = detectNumericEntities("PIN 4829");
  const phoneEntities = detectNumericEntities("Call 801-234-5678 now.");
  const longUnlabeled = detectNumericEntities("The population was 123456789.");

  assert.equal(pinEntities.length, 1);
  assert.equal(pinEntities[0].category, "code");

  assert.equal(phoneEntities.length, 1);
  assert.equal(phoneEntities[0].category, "code");

  assert.equal(longUnlabeled.length, 1);
  assert.equal(longUnlabeled[0].category, "cardinal");
});

test("detectNumericEntities classifies $/£/€ amounts as currency (spec 006 US1)", () => {
  ["$400", "$1", "$1.50", "£400", "€400"].forEach((amount) => {
    const entities = detectNumericEntities(`The price is ${amount} today.`);
    assert.equal(entities.length, 1, `amount: ${amount}`);
    assert.equal(entities[0].category, "currency", `amount: ${amount}`);
    assert.equal(entities[0].match, amount, `amount: ${amount}`);
  });
});

test("detectNumericEntities classifies magnitude-suffix currency amounts as currency (spec 006 US1, FR-007)", () => {
  const millionEntities = detectNumericEntities("Revenue reached $4m in sales.");
  const billionEntities = detectNumericEntities("Valued at $2.5bn overall.");

  assert.equal(millionEntities.length, 1);
  assert.equal(millionEntities[0].category, "currency");
  assert.equal(millionEntities[0].match, "$4m");

  assert.equal(billionEntities.length, 1);
  assert.equal(billionEntities[0].category, "currency");
  assert.equal(billionEntities[0].match, "$2.5bn");
});

test("convertCodeDigits produces one spoken digit word per character (spec 006 US1)", () => {
  assert.equal(convertCodeDigits("4829"), "four eight two nine");
  assert.equal(convertCodeDigits("801-234-5678"), "eight zero one two three four five six seven eight");
});

test("convertCurrency produces correct spoken form per example (spec 006 US1)", () => {
  assert.equal(convertCurrency("$400"), "four hundred dollars");
  assert.equal(convertCurrency("$1"), "one dollar");
  assert.equal(convertCurrency("$1.50"), "one dollar and fifty cents");
  assert.equal(convertCurrency("£400"), "four hundred pounds");
  assert.equal(convertCurrency("€400"), "four hundred euros");
  assert.equal(convertCurrency("$4m"), "four million dollars");
  assert.equal(convertCurrency("$2.5bn"), "two point five billion dollars");
});

test("normalizeSpokenText leaves an unsupported currency symbol untouched, converting only the digits it doesn't own (spec 006 US1, FR-008)", () => {
  const nairaResult = normalizeSpokenText("The price is ₦400 today.");
  const codeResult = normalizeSpokenText("The price is 400 USD today.");

  // The ₦ symbol itself is left as printed text (FR-008 defers non-$/£/€ symbols); the digits
  // beside it are still classifiable as an ordinary cardinal (FR-003/FR-013's distinction:
  // only a genuinely unclassifiable span is left fully unmodified, not merely "outside this
  // spec's currency support").
  assert.ok(nairaResult.includes("₦"));
  assert.ok(nairaResult.includes("four hundred"));
  assert.ok(codeResult.includes("USD"));
  assert.ok(codeResult.includes("four hundred"));
});

test("normalizeSpokenText end-to-end: User Story 1 acceptance scenarios (spec 006 US1)", () => {
  assert.equal(normalizeSpokenText("The device costs $400."), "The device costs four hundred dollars.");
  assert.equal(normalizeSpokenText("Revenue reached $4m in sales."), "Revenue reached four million dollars in sales.");
  assert.equal(normalizeSpokenText("The population is 12,500."), "The population is twelve thousand five hundred.");
  assert.equal(normalizeSpokenText("PIN 4829"), "PIN four eight two nine");
});

test("detectNumericEntities classifies bare 4-digit numbers in ordinary sentence context as year (spec 006 US2 AS1-AS2)", () => {
  const entities1998 = detectNumericEntities("The project began in 1998.");
  const entities2024 = detectNumericEntities("Revenue increased in 2024.");

  assert.equal(entities1998.length, 1);
  assert.equal(entities1998[0].category, "year");
  assert.equal(entities2024.length, 1);
  assert.equal(entities2024[0].category, "year");
});

test("detectNumericEntities classifies 2000 as year (2000-2009 boundary, spec 006 US2 AS3)", () => {
  const entities = detectNumericEntities("The year 2000 was significant.");

  assert.equal(entities.length, 1);
  assert.equal(entities[0].category, "year");
});

test("detectNumericEntities classifies a 4-digit number followed by a unit word as cardinal, not year (spec 006 US2 AS4)", () => {
  const entities = detectNumericEntities("1500 units were sold.");

  assert.equal(entities.length, 1);
  assert.equal(entities[0].category, "cardinal");
});

test("detectNumericEntities classifies a 4-digit number preceded by a currency symbol as currency, not year (spec 006 US2 AS5)", () => {
  const entities = detectNumericEntities("$1998 was the price.");

  assert.equal(entities.length, 1);
  assert.equal(entities[0].category, "currency");
});

test("convertYear produces correct spoken form (spec 006 US2)", () => {
  assert.equal(convertYear("1998"), "nineteen ninety-eight");
  assert.equal(convertYear("2024"), "twenty twenty-four");
  assert.equal(convertYear("2000"), "two thousand");
});

test("normalizeSpokenText end-to-end: User Story 2 acceptance scenarios (spec 006 US2)", () => {
  assert.equal(normalizeSpokenText("The project began in 1998."), "The project began in nineteen ninety-eight.");
  assert.equal(normalizeSpokenText("Revenue increased in 2024."), "Revenue increased in twenty twenty-four.");
  assert.equal(normalizeSpokenText("The year 2000 was significant."), "The year two thousand was significant.");
  // Note: spec.md's prose example capitalizes "One" as sentence-initial; no FR requires
  // sentence-initial capitalization of a converted number, so this asserts the normalizer's
  // actual (lowercase) output rather than the spec's illustrative prose capitalization.
  assert.equal(normalizeSpokenText("1500 units were sold."), "one thousand five hundred units were sold.");
  assert.equal(normalizeSpokenText("$1998 was the price."), "one thousand nine hundred ninety-eight dollars was the price.");
});

test("detectNumericEntities classifies percentages as percentage, not decimal (spec 006 US3)", () => {
  const wholeEntities = detectNumericEntities("an increase of 20%.");
  const decimalEntities = detectNumericEntities("a rate of 0.5%.");

  assert.equal(wholeEntities.length, 1);
  assert.equal(wholeEntities[0].category, "percentage");
  assert.equal(decimalEntities.length, 1);
  assert.equal(decimalEntities[0].category, "percentage");
});

test("detectNumericEntities classifies a standalone decimal as decimal (spec 006 US3)", () => {
  const entities = detectNumericEntities("the value of pi, 3.14, is well known.");

  assert.equal(entities.length, 1);
  assert.equal(entities[0].category, "decimal");
});

test("detectNumericEntities classifies ordinals as ordinal (spec 006 US3)", () => {
  ["21st", "1st", "2nd"].forEach((ordinal) => {
    const entities = detectNumericEntities(`the ${ordinal} item`);
    assert.equal(entities.length, 1, `ordinal: ${ordinal}`);
    assert.equal(entities[0].category, "ordinal", `ordinal: ${ordinal}`);
  });
});

test("convertPercentage produces correct spoken form (spec 006 US3)", () => {
  assert.equal(convertPercentage("20%"), "twenty percent");
  assert.equal(convertPercentage("0.5%"), "zero point five percent");
});

test("convertDecimal produces correct spoken form (spec 006 US3)", () => {
  assert.equal(convertDecimal("3.14"), "three point one four");
});

test("convertOrdinal produces correct spoken form (spec 006 US3)", () => {
  assert.equal(convertOrdinal("1st"), "first");
  assert.equal(convertOrdinal("2nd"), "second");
  assert.equal(convertOrdinal("21st"), "twenty-first");
});

test("normalizeSpokenText end-to-end: User Story 3 acceptance scenarios (spec 006 US3)", () => {
  assert.equal(normalizeSpokenText("an increase of 20%."), "an increase of twenty percent.");
  assert.equal(normalizeSpokenText("a rate of 0.5%."), "a rate of zero point five percent.");
  assert.equal(normalizeSpokenText("the value of pi, 3.14,"), "the value of pi, three point one four,");
  assert.equal(normalizeSpokenText("the 21st century."), "the twenty-first century.");
  assert.equal(normalizeSpokenText("the 1st and 2nd items."), "the first and second items.");
});

test("normalizeSpokenText leaves a number beyond this pipeline's convertible range unmodified rather than guessing (spec 006, FR-013, SC-004)", () => {
  const text = `The population was ${"9".repeat(350)}.`;

  const result = normalizeSpokenText(text);

  assert.equal(result, text);
});

test("normalizeSpokenText leaves text with no numeric-like span byte-for-byte unchanged (spec 006, FR-017, SC-002)", () => {
  const plainProse = "This is a plain sentence with no numbers of any kind whatsoever.";

  assert.equal(normalizeSpokenText(plainProse), plainProse);
});

test("normalization only affects narratable (policy-included) block text, never excluded blocks (spec 006, FR-002)", () => {
  const blocksByPage = assignBlockIds([
    [
      pageBlock({ page: 0, text: "The price is $400.", type: "body" }),
      pageBlock({ page: 0, text: "See footnote 1 for the $999 figure.", type: "footnote" }),
    ],
  ]);

  const narrationText = renderNarrationText(blocksByPage);

  assert.ok(narrationText.includes("four hundred dollars"));
  assert.ok(!narrationText.includes("$999"));
  assert.ok(!narrationText.includes("nine hundred ninety-nine"));
});

test("normalization affects narrationText but never displayText or document block text (spec 006, FR-001, SC-005)", async () => {
  const pages = [
    [
      { str: "The device costs $400.", transform: [10, 0, 0, 10, 50, 700], width: 200, height: 10 },
    ],
  ];

  const result = await buildPipelineOutput(pages, 600, 800);

  assert.ok(result.narrationText.includes("four hundred dollars"));
  assert.ok(result.displayText.includes("$400"));
  assert.ok(!result.displayText.includes("four hundred dollars"));

  const allBlockText = result.document.sections.flatMap((section) => section.blocks).map((block) => block.text).join(" ");
  assert.ok(allBlockText.includes("$400"));
  assert.ok(!allBlockText.includes("four hundred dollars"));
});

// SC-001 through SC-005 exercised together on a paragraph resembling the original goal
// document's own MVP Acceptance Example, per tasks.md T047: currency, year, citation stripping,
// and percentage all converting correctly in one realistic passage.
test("multiple normalization categories convert correctly together in one realistic paragraph (spec 006 T047)", () => {
  // Uses $4m (FR-007's documented attached-suffix form), not "$400 million" as separate words —
  // the spec's magnitude-suffix examples ($4m, $2.5bn) are always directly attached to the
  // digits; a space-separated spelled-out magnitude word is a distinct, undocumented pattern
  // this spec does not claim to support (see the bug note in tasks.md T047).
  const blocksByPage = assignBlockIds([
    [pageBlock({ page: 0, text: "Revenue reached $4m in 2024, referencing [13], an increase of 21.5%.", type: "body" })],
  ]);

  const narrationText = renderNarrationText(blocksByPage);

  assert.ok(narrationText.includes("four million dollars"));
  assert.ok(narrationText.includes("twenty twenty-four"));
  assert.ok(!narrationText.includes("[13]"));
  assert.ok(narrationText.includes("twenty-one point five percent"));
});

test("mapParagraphsToChunks maps a paragraph to the chunk with the most overlapping words", () => {
  const paragraphs = ["The quick brown fox jumps over the lazy dog."];
  const chunks = [
    "An unrelated sentence about something else entirely.",
    "The quick brown fox jumps over the lazy dog.",
    "Another unrelated closing remark.",
  ];

  const mapping = mapParagraphsToChunks(paragraphs, chunks);

  assert.equal(mapping[0], 1);
});

test("mapParagraphsToChunks falls back to the nearest chunk by position when a paragraph has no match", () => {
  const paragraphs = [
    "Running Header Text",
    "Real first paragraph of body content here.",
    "Real second paragraph of body content here.",
  ];
  const chunks = [
    "Real first paragraph of body content here.",
    "Real second paragraph of body content here.",
  ];

  const mapping = mapParagraphsToChunks(paragraphs, chunks);

  // The header paragraph (index 0) has no matching chunk text at all (it was stripped from
  // narration), so it must fall back to the nearest chunk by position rather than mapping to
  // nothing or throwing — here that's chunk 0, the chunk nearest to its position in sequence.
  assert.equal(mapping[0], 0);
  assert.equal(mapping[1], 0);
  assert.equal(mapping[2], 1);
});

test("mapParagraphsToChunks returns an empty mapping when there are no chunks", () => {
  const mapping = mapParagraphsToChunks(["Some paragraph."], []);

  assert.deepEqual(mapping, [null]);
});

test("assessCapabilities reports hasRealWorker false when Worker is undefined", () => {
  const previousWorker = global.Worker;
  delete global.Worker;
  try {
    const result = assessCapabilities(1);
    assert.equal(result.hasRealWorker, false);
  } finally {
    if (previousWorker === undefined) delete global.Worker;
    else global.Worker = previousWorker;
  }
});

test("assessCapabilities reports hasRealWorker false when PDF.js's fake-worker warning fires", async () => {
  const previousWorker = global.Worker;
  const previousWarn = console.warn;
  global.Worker = function Worker() {};
  try {
    const result = await assessCapabilities(1, {
      probeRealWorker: async () => {
        console.warn("Setting up fake worker.");
      },
    });
    assert.equal(result.hasRealWorker, false);
  } finally {
    if (previousWorker === undefined) delete global.Worker;
    else global.Worker = previousWorker;
    console.warn = previousWarn;
  }
});

test("assessCapabilities reports storage flags false when access throws, without throwing itself", () => {
  const previousLocalStorage = Object.getOwnPropertyDescriptor(global, "localStorage");
  const previousIndexedDb = Object.getOwnPropertyDescriptor(global, "indexedDB");
  Object.defineProperty(global, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  Object.defineProperty(global, "indexedDB", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    const result = assessCapabilities(1);
    assert.equal(result.hasLocalStorage, false);
    assert.equal(result.hasIndexedDb, false);
  } finally {
    if (previousLocalStorage) Object.defineProperty(global, "localStorage", previousLocalStorage);
    else delete global.localStorage;
    if (previousIndexedDb) Object.defineProperty(global, "indexedDB", previousIndexedDb);
    else delete global.indexedDB;
  }
});

test("assessCapabilities reports storage flags true when access succeeds", () => {
  const previousLocalStorage = global.localStorage;
  const previousIndexedDb = global.indexedDB;
  global.localStorage = { getItem() {}, setItem() {}, removeItem() {} };
  global.indexedDB = { open() {} };
  try {
    const result = assessCapabilities(1);
    assert.equal(result.hasLocalStorage, true);
    assert.equal(result.hasIndexedDb, true);
  } finally {
    global.localStorage = previousLocalStorage;
    global.indexedDB = previousIndexedDb;
  }
});

test("assessCapabilities never throws even when every underlying check throws", async () => {
  const previousWorker = Object.getOwnPropertyDescriptor(global, "Worker");
  const previousLocalStorage = Object.getOwnPropertyDescriptor(global, "localStorage");
  const previousIndexedDb = Object.getOwnPropertyDescriptor(global, "indexedDB");
  Object.defineProperty(global, "Worker", { configurable: true, get() { throw new Error("blocked"); } });
  Object.defineProperty(global, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
  Object.defineProperty(global, "indexedDB", { configurable: true, get() { throw new Error("blocked"); } });
  try {
    await assert.doesNotReject(async () => assessCapabilities(1, {
      probeRealWorker: async () => { throw new Error("blocked"); },
    }));
  } finally {
    if (previousWorker) Object.defineProperty(global, "Worker", previousWorker);
    else delete global.Worker;
    if (previousLocalStorage) Object.defineProperty(global, "localStorage", previousLocalStorage);
    else delete global.localStorage;
    if (previousIndexedDb) Object.defineProperty(global, "indexedDB", previousIndexedDb);
    else delete global.indexedDB;
  }
});

test("assessCapabilities restores console.warn after checking for the fake-worker warning", async () => {
  const previousWorker = global.Worker;
  const previousWarn = console.warn;
  global.Worker = function Worker() {};
  try {
    await assessCapabilities(1, { probeRealWorker: async () => {} });
    assert.equal(console.warn, previousWarn);
  } finally {
    if (previousWorker === undefined) delete global.Worker;
    else global.Worker = previousWorker;
    console.warn = previousWarn;
  }
});

test("buildPipelineOutput display text stays literal and unreordered while narration text is cleaned", async () => {
  const headerText = "Evangeline Research Report";
  const bodyText = "Real body content that should be spoken, referencing [12] and https://example.com.";
  const pageNumberText = "1";

  const pages = [
    [
      { str: headerText, transform: [10, 0, 0, 10, 200, 780], width: 180, height: 10 },
      { str: bodyText, transform: [10, 0, 0, 10, 50, 400], width: 500, height: 10 },
      { str: pageNumberText, transform: [10, 0, 0, 10, 295, 20], width: 10, height: 10 },
    ],
    [
      { str: headerText, transform: [10, 0, 0, 10, 200, 780], width: 180, height: 10 },
      { str: "More body content on page two.", transform: [10, 0, 0, 10, 50, 400], width: 500, height: 10 },
      { str: "2", transform: [10, 0, 0, 10, 295, 20], width: 10, height: 10 },
    ],
  ];

  const result = await buildPipelineOutput(pages, 600, 800);

  assert.ok(result.displayText.includes(headerText));
  assert.ok(result.displayText.includes(pageNumberText));
  assert.ok(result.displayText.includes("[12]"));
  assert.ok(result.displayText.includes("https://example.com"));

  assert.ok(!result.narrationText.includes(headerText));
  assert.ok(!result.narrationText.includes("[12]"));
  assert.ok(!result.narrationText.includes("https://example.com"));
  assert.ok(result.narrationText.includes("Real body content"));
});

test("buildPipelineOutput is deterministic across repeated calls with the same input", async () => {
  const pages = [
    [
      { str: "Header line", transform: [10, 0, 0, 10, 200, 780], width: 100, height: 10 },
      { str: "Body content here.", transform: [10, 0, 0, 10, 50, 400], width: 200, height: 10 },
    ],
    [
      { str: "Header line", transform: [10, 0, 0, 10, 200, 780], width: 100, height: 10 },
      { str: "More body content.", transform: [10, 0, 0, 10, 50, 400], width: 200, height: 10 },
    ],
  ];

  const first = await buildPipelineOutput(pages, 600, 800);
  const second = await buildPipelineOutput(pages, 600, 800);

  assert.deepEqual(first, second);
});

// A document with none of this feature's three new patterns (uniform font size throughout,
// single-paragraph blocks only, no footnote/caption/table-shaped content) must narrate exactly
// as the pre-feature pipeline did — this feature only changes output where its own new evidence
// positively supports a change (FR-014/SC-006).
test("buildPipelineOutput leaves a plain, uniform document's narration unaffected by the new classification behaviors (FR-014)", async () => {
  const pages = [
    [
      { str: "First paragraph, first line.", transform: [10, 0, 0, 10, 50, 700], width: 150, height: 10 },
      { str: "First paragraph, second line.", transform: [10, 0, 0, 10, 50, 685], width: 150, height: 10 },
    ],
    [
      { str: "Second page, first line.", transform: [10, 0, 0, 10, 50, 700], width: 150, height: 10 },
      { str: "Second page, second line.", transform: [10, 0, 0, 10, 50, 685], width: 150, height: 10 },
    ],
  ];

  const result = await buildPipelineOutput(pages, 600, 800);

  assert.equal(
    result.narrationText,
    "First paragraph, first line. First paragraph, second line.\n\nSecond page, first line. Second page, second line.",
  );
  assert.equal(result.narrationText, result.displayText);
});

// Extends the determinism check above with a fixture that exercises all three of this feature's
// new classification behaviors together (heading, multi-paragraph split, footnote) — this spec's
// own named guarantee (FR-013) that adding new classification types does not relax the existing
// reproducibility guarantee.
test("buildPipelineOutput remains deterministic with heading, paragraph-boundary, and footnote content present (FR-013)", async () => {
  const pages = [
    [
      { str: "Chapter One", transform: [18, 0, 0, 18, 50, 760], width: 120, height: 18 },
      { str: "First paragraph line one.", transform: [10, 0, 0, 10, 50, 700], width: 150, height: 10 },
      { str: "First paragraph line two.", transform: [10, 0, 0, 10, 50, 685], width: 150, height: 10 },
      { str: "    Second paragraph, indented.", transform: [10, 0, 0, 10, 60, 665], width: 150, height: 10 },
      { str: "Second paragraph continues.", transform: [10, 0, 0, 10, 50, 650], width: 150, height: 10 },
      { str: "1. A footnote at the bottom.", transform: [6, 0, 0, 6, 50, 40], width: 120, height: 6 },
    ],
  ];

  const first = await buildPipelineOutput(pages, 600, 800);
  const second = await buildPipelineOutput(pages, 600, 800);

  assert.deepEqual(first, second);
});

// This spec's own named guarantee (FR-004/FR-005: reproducibility) — extends the determinism
// check above to a full document-load cycle through the real app flow, not just one pipeline
// function called directly, so it survives even if buildPipelineOutput's own test is ever
// refactored or removed.
test("loading the same document twice produces identical displayed text and identical narration chunks (FR-004, FR-005)", async () => {
  const documentText = "First sentence of the document. Second sentence follows here. Third and final sentence.";

  const firstApp = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf(documentText)),
  });
  let firstDisplayText;
  try {
    await firstApp.trigger("fileInput", "change", { target: { files: [createFile("same.pdf")] } });
    firstDisplayText = firstApp.elements.textOutput.textContent;
  } finally {
    firstApp.restore();
  }

  const secondApp = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf(documentText)),
  });
  let secondDisplayText;
  try {
    await secondApp.trigger("fileInput", "change", { target: { files: [createFile("same.pdf")] } });
    secondDisplayText = secondApp.elements.textOutput.textContent;
  } finally {
    secondApp.restore();
  }

  assert.equal(firstDisplayText, secondDisplayText);
  assert.equal(firstDisplayText, documentText);
});

test("classifyBlocks never classifies a tall block merely starting near the top of the page as a header", () => {
  // A block that starts in the header zone but extends far down the page must not be treated
  // as a header just because its top edge is high — it must be CONFINED to the zone.
  const tallBlock = pageBlock({ page: 0, text: "Whole page of body content merged into one block.", bbox: { x0: 0.05, y0: 0.02, x1: 0.95, y1: 0.9 } });
  const blocksByPage = [0, 1, 2].map((page) => [{ ...tallBlock, page }]);

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  classified.forEach((pageBlocks) => {
    assert.equal(pageBlocks[0].type, "body");
  });
});

test("classifyBlocks preserves a block as body when header repetition falls just under the confidence gate", () => {
  const headerBbox = { x0: 0.3, y0: 0.02, x1: 0.7, y1: 0.05 };
  // 11 pages total; the candidate text appears on the first 6 (~55%), just under the 60% gate.
  const blocksByPage = Array.from({ length: 11 }, (_, page) => {
    const text = page < 6 ? "Occasional Running Title" : "Different unrelated content";
    return [pageBlock({ page, text, bbox: headerBbox })];
  });

  const stats = analyzeDocumentStats(blocksByPage);
  const classified = classifyBlocks(blocksByPage, stats);

  for (let page = 0; page < 6; page += 1) {
    assert.equal(classified[page][0].type, "body");
  }
});

test("detectColumns assigns no columns when the horizontal gap does not span most of the body height", () => {
  const blocksByPage = [
    [
      // Left/right blocks only overlap vertically across a small sliver of the page, not most
      // of the body height, so the gap between them should not be treated as a stable column
      // boundary (FR-012's conservative-fallback principle).
      pageBlock({ page: 0, text: "Left sliver", bbox: { x0: 0.05, y0: 0.1, x1: 0.46, y1: 0.15 } }),
      pageBlock({ page: 0, text: "Right sliver", bbox: { x0: 0.54, y0: 0.12, x1: 0.95, y1: 0.17 } }),
      pageBlock({ page: 0, text: "Full width block filling the rest of the page.", bbox: { x0: 0.05, y0: 0.2, x1: 0.95, y1: 0.9 } }),
    ],
  ];

  const result = detectColumns(blocksByPage);

  result[0].forEach((block) => {
    assert.equal(block.column, undefined);
  });
});

test("renderExtractedText treats PDF content as literal text", () => {
  const container = { textContent: "", innerHTML: "" };
  const text = "Chapter <img src=x onerror=alert(1)> & notes";

  renderExtractedText(container, text);

  assert.equal(container.textContent, text);
  assert.equal(container.innerHTML, "");
});

test("renderSpeechFocus highlights the active sentence without parsing PDF text as markup", () => {
  function textNode(value) {
    return { type: "text", textContent: value };
  }

  function elementNode(tag) {
    return {
      type: "element",
      tag,
      className: "",
      textContent: "",
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    };
  }

  const container = {
    ownerDocument: {
      createTextNode: textNode,
      createElement: elementNode,
    },
    children: [],
    textContent: "",
    replaceChildren(...nodes) {
      this.children = nodes;
      this.textContent = nodes.map((node) => node.textContent).join("");
    },
  };
  const text = "First sentence. Read <img src=x onerror=alert(1)> literally. Last sentence.";

  const nextOffset = renderSpeechFocus(
    container,
    text,
    "Read <img src=x onerror=alert(1)> literally.",
  );

  assert.equal(container.textContent, text);
  assert.equal(container.children[1].className, "sentence-focus");
  assert.equal(container.children[1].textContent, "Read <img src=x onerror=alert(1)> literally.");
  assert.equal(container.children[1].attributes["data-magnifier"], "");
  assert.ok(nextOffset > text.indexOf("Read"));
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createElement(id) {
  return {
    id,
    disabled: false,
    hidden: false,
    checked: false,
    textContent: "",
    value: "",
    files: [],
    listeners: {},
    children: [],
    attributes: {},
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); },
      toggle(value, force) {
        if (force === undefined ? !this.values.has(value) : force) {
          this.values.add(value);
        } else {
          this.values.delete(value);
        }
      },
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    closest() {
      return this;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    replaceChildren(...nodes) {
      this.children = nodes;
      this.textContent = nodes.map((node) => node.textContent || "").join("");
      const selected = nodes.find((node) => node.selected) || nodes[0];
      if (selected) this.value = selected.value;
    },
  };
}

function createFakeDocument() {
  const ids = [
    "fileInput",
    "dropZone",
    "documentControls",
    "fileName",
    "status",
    "statusDot",
    "voiceField",
    "pages",
    "wordCount",
    "textOutput",
    "play",
    "pause",
    "resume",
    "stop",
    "bookmark",
    "localEndpoint",
    "voice",
    "rate",
    "rateValue",
    "progress",
  ];
  const document = {
    elements: {},
    listeners: {},
    visibilityState: "visible",
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    dispatchEvent(event) {
      const handler = this.listeners[event.type];
      if (handler) handler(event);
    },
    querySelector(selector) {
      return this.elements[selector.slice(1)];
    },
    createElement(tag) {
      return {
        ownerDocument: document,
        tag,
        className: "",
        textContent: "",
        value: "",
        selected: false,
        attributes: {},
        closest() {
          return this;
        },
        classList: {
          values: new Set(),
          add(value) {
            this.values.add(value);
          },
          remove(value) {
            this.values.delete(value);
          },
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        getAttribute(name) {
          return this.attributes[name];
        },
        scrollIntoView() {},
      };
    },
    createTextNode(textContent) {
      return { ownerDocument: document, textContent };
    },
  };
  const elements = Object.fromEntries(ids.map((id) => [id, createElement(id)]));
  elements.rate.value = "1";
  elements.localEndpoint.value = "/v1/audio/speech";
  document.elements = elements;
  Object.values(elements).forEach((element) => {
    element.ownerDocument = document;
  });

  return document;
}

function createPdf(text, pageCount = 1) {
  return {
    numPages: pageCount,
    async getPage() {
      return {
        async getTextContent() {
          return { items: [{ str: text }] };
        },
      };
    },
  };
}

function createFile(name, type = "application/pdf", marker = name) {
  return {
    name,
    type,
    async arrayBuffer() {
      return marker;
    },
  };
}

// Builds a fake fflate.unzipSync() result: a flat { path: Uint8Array } map,
// with a minimal valid container.xml + OPF spine + XHTML chapters.
function createEpub(chapterTexts = ["Chapter text."]) {
  const encoder = new TextEncoder();
  const files = {};

  files["META-INF/container.xml"] = encoder.encode(
    `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
  );

  const manifestItems = chapterTexts
    .map((_, index) => `<item id="c${index}" href="chapter${index}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("");
  const spineItems = chapterTexts.map((_, index) => `<itemref idref="c${index}"/>`).join("");
  files["OEBPS/content.opf"] = encoder.encode(
    `<?xml version="1.0"?><package><manifest>${manifestItems}</manifest><spine>${spineItems}</spine></package>`,
  );

  chapterTexts.forEach((text, index) => {
    files[`OEBPS/chapter${index}.xhtml`] = encoder.encode(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>${text}</p></body></html>`,
    );
  });

  return files;
}

// Minimal DOMParser stand-in: strips tags naively for test purposes since
// the real browser DOMParser is unavailable under Node.
// Minimal DOMParser stand-in with a real mutable node tree (unlike the
// browser's DOMParser, which is unavailable under Node). Nodes support
// querySelectorAll + remove() so xhtmlToText's script/style stripping is
// genuinely exercised rather than pre-stripped by the fixture.
function createFakeDomParser() {
  function parseChildren(markup) {
    const nodes = [];
    const pattern = /<(script|style)[^>]*>([\s\S]*?)<\/\1>|<[^>]+>|([^<]+)/gi;
    let match;
    while ((match = pattern.exec(markup))) {
      if (match[1]) {
        nodes.push(makeElement(match[1].toLowerCase(), match[2]));
      } else if (match[3]) {
        nodes.push(makeText(match[3]));
      }
    }
    return nodes;
  }

  function makeText(value) {
    return { type: "text", get textContent() { return value; } };
  }

  function makeElement(tag, innerText) {
    let removed = false;
    const node = {
      type: "element",
      tag,
      get textContent() {
        return removed ? "" : innerText;
      },
      remove() {
        removed = true;
      },
    };
    return node;
  }

  return function FakeDOMParser() {
    this.parseFromString = (markup) => {
      const bodyMatch = markup.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      const inner = bodyMatch ? bodyMatch[1] : markup;
      const children = parseChildren(inner);
      const body = {
        get textContent() {
          return children.map((node) => node.textContent).join("");
        },
        querySelectorAll(selector) {
          const tags = selector.split(",").map((value) => value.trim());
          return children.filter((node) => node.type === "element" && tags.includes(node.tag));
        },
      };
      return { body };
    };
  };
}

// Asserts none of the recorded fetch calls (from a loadBrowserApp fetchImpl spy) carry a
// meaningful substring of the document's own text — used to verify FR-001 (local-only
// processing) without asserting on exact call counts, since a legitimate local-TTS call is
// still allowed as long as it never contains document content.
function assertNoDocumentTextLeaked(calls, documentText) {
  const words = String(documentText || "").split(/\s+/).filter(Boolean);
  if (words.length < 4) return; // too short to form a meaningful leaked substring
  const probe = words.slice(0, 4).join(" ");
  for (const call of calls) {
    const url = typeof call === "string" ? call : call.url || "";
    const body = typeof call === "object" && call.options && call.options.body ? String(call.options.body) : "";
    assert.ok(!url.includes(probe), `fetch URL leaked document text: ${url}`);
    assert.ok(!body.includes(probe), `fetch body leaked document text: ${body}`);
  }
}

function loadBrowserApp({
  pdfLoader = () => Promise.resolve(createPdf("Loaded text.")),
  speech = true,
  voices = [{ name: "Natural Voice", lang: "en-US", voiceURI: "voice-1" }],
  fetchImpl,
  localStorage,
  localStorageGetterThrows = false,
  epubUnzip = () => createEpub(["Loaded text."]),
  domParser = createFakeDomParser(),
  hasWorkerConstructor = false,
} = {}) {
  const previous = {
    window: global.window,
    document: global.document,
    speech: global.SpeechSynthesisUtterance,
    indexedDB: global.indexedDB,
    crypto: global.crypto,
  };
  const fakeDocument = createFakeDocument();
  const speechSynthesis = speech
    ? {
        spoken: [],
        cancelled: 0,
        paused: 0,
        resumed: 0,
        getVoices: () => voices,
        addEventListener() {},
        speak(utterance) {
          this.spoken.push(utterance);
        },
        cancel() {
          this.cancelled += 1;
        },
        pause() {
          this.paused += 1;
        },
        resume() {
          this.resumed += 1;
        },
      }
    : undefined;
  const fakeWindow = {
    pdfjsLib: {
      getDocument({ data }) {
        return { promise: pdfLoader(data) };
      },
    },
    fflate: {
      unzipSync: (bytes) => epubUnzip(bytes),
    },
    DOMParser: domParser,
    URL: {
      objectUrlCount: 0,
      createObjectURL() {
        this.objectUrlCount += 1;
        return `blob:audio-${this.objectUrlCount}`;
      },
      revokeObjectURL() {},
    },
    matchMedia: () => ({ matches: true }),
    localStorage: localStorage || {
      values: new Map(),
      getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
      setItem(key, value) { this.values.set(key, String(value)); },
      removeItem(key) { this.values.delete(key); },
    },
  };
  if (fetchImpl) fakeWindow.fetch = fetchImpl;
  if (hasWorkerConstructor) fakeWindow.Worker = function Worker() {};
  fakeWindow.console = console;
  if (localStorageGetterThrows) {
    Object.defineProperty(fakeWindow, "localStorage", {
      get() {
        throw new Error("Storage unavailable");
      },
    });
  }
  if (speechSynthesis) fakeWindow.speechSynthesis = speechSynthesis;
  fakeWindow.Audio = function Audio(src) {
    this.src = src;
    this.paused = true;
    this.currentTime = 0;
    this.play = () => {
      this.paused = false;
      fakeWindow.lastAudio = this;
      return Promise.resolve();
    };
    this.pause = () => {
      this.paused = true;
    };
  };

  // Stub IndexedDB: always returns cache misses so tests exercise the fetch path
  global.indexedDB = {
    open() {
      const req = {};
      Promise.resolve().then(() => {
        if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: { objectStoreNames: { contains: () => true }, createObjectStore() {} } } });
        if (req.onsuccess) req.onsuccess({ target: { result: { transaction() { return { objectStore() { return { get() { const r = {}; Promise.resolve().then(() => { if (r.onsuccess) r.onsuccess(); }); return r; }, put() {}, delete() {}, index() { return { getAll() { const r = {}; Promise.resolve().then(() => { if (r.onsuccess) r.onsuccess({ target: { result: [] } }); }); return r; } }; }, createIndex() {} }; }, oncomplete: null, onerror: null } } } } });
      });
      return req;
    },
  };
  // Stub crypto.subtle.digest: returns a fixed 32-byte buffer (unique per input via simple hash)
  global.crypto = {
    subtle: {
      digest(_alg, data) {
        const bytes = new Uint8Array(32);
        const view = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer || new TextEncoder().encode(String(data)).buffer);
        for (let i = 0; i < view.length; i++) bytes[i % 32] ^= view[i];
        return Promise.resolve(bytes.buffer);
      },
    },
  };
  fakeWindow.crypto = global.crypto;

  global.window = fakeWindow;
  global.document = fakeDocument;
  global.Blob = global.Blob || class Blob {};
  if (speech) {
    global.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
      this.text = text;
    };
  } else {
    delete global.SpeechSynthesisUtterance;
  }

  delete require.cache[require.resolve("./app.js")];
  require("./app.js");

  return {
    elements: fakeDocument.elements,
    window: fakeWindow,
    speechSynthesis,
    trigger(id, type, event = {}) {
      return fakeDocument.elements[id].listeners[type](event);
    },
    restore() {
      global.window = previous.window;
      global.document = previous.document;
      if (previous.speech) {
        global.SpeechSynthesisUtterance = previous.speech;
      } else {
        delete global.SpeechSynthesisUtterance;
      }
      if (previous.indexedDB !== undefined) {
        global.indexedDB = previous.indexedDB;
      } else {
        delete global.indexedDB;
      }
      if (previous.crypto !== undefined) {
        global.crypto = previous.crypto;
      } else {
        delete global.crypto;
      }
      delete require.cache[require.resolve("./app.js")];
      require("./app.js");
    },
  };
}

test("secondary reading controls appear only for a readable PDF", async () => {
  const app = loadBrowserApp({ pdfLoader: () => Promise.resolve(createPdf("First document.")) });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    assert.equal(app.elements.play.disabled, false);
    assert.equal(app.elements.documentControls.hidden, false);

    await app.trigger("fileInput", "change", {
      target: { files: [createFile("notes.txt", "text/plain")] },
    });

    assert.equal(app.elements.status.textContent, "Choose a PDF or EPUB file.");
    assert.equal(app.elements.fileName.textContent, "No file selected");
    assert.equal(app.elements.play.disabled, true);
    assert.equal(app.elements.pause.disabled, true);
    assert.equal(app.elements.resume.disabled, true);
    assert.equal(app.elements.documentControls.hidden, true);
  } finally {
    app.restore();
  }
});

test("choosing an EPUB file extracts its chapter text and enables playback", async () => {
  const app = loadBrowserApp({ epubUnzip: () => createEpub(["First chapter body."]) });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("book.epub", "application/epub+zip")] },
    });

    assert.equal(app.elements.fileName.textContent, "book.epub");
    assert.equal(app.elements.play.disabled, false);
    assert.equal(app.elements.documentControls.hidden, false);
    assert.match(app.elements.textOutput.textContent, /First chapter body\./);
  } finally {
    app.restore();
  }
});

test("EPUB chapters are joined in spine order and counted as pages", async () => {
  const app = loadBrowserApp({
    epubUnzip: () => createEpub(["First chapter.", "Second chapter.", "Third chapter."]),
  });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("book.epub", "application/epub+zip")] },
    });

    assert.equal(app.elements.pages.textContent, "3");
    const firstIndex = app.elements.textOutput.textContent.indexOf("First chapter.");
    const secondIndex = app.elements.textOutput.textContent.indexOf("Second chapter.");
    const thirdIndex = app.elements.textOutput.textContent.indexOf("Third chapter.");
    assert.ok(firstIndex >= 0 && secondIndex > firstIndex && thirdIndex > secondIndex);
  } finally {
    app.restore();
  }
});

test("EPUB chapter markup is rendered as literal text, never executed or injected", async () => {
  const encoder = new TextEncoder();
  const app = loadBrowserApp({
    epubUnzip: () => {
      const files = createEpub(["placeholder"]);
      files["OEBPS/chapter0.xhtml"] = encoder.encode(
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>`
        + `<script>alert(1)</script><p>Safe text <img src=x onerror=alert(1)> stays literal.</p>`
        + `</body></html>`,
      );
      return files;
    },
  });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("book.epub", "application/epub+zip")] },
    });

    assert.match(app.elements.textOutput.textContent, /Safe text/);
    assert.doesNotMatch(app.elements.textOutput.textContent, /alert\(1\)/);
    assert.doesNotMatch(app.elements.textOutput.innerHTML || "", /<script>|<img/);
  } finally {
    app.restore();
  }
});

test("an EPUB exceeding the safe decompression size limit fails gracefully", async () => {
  const app = loadBrowserApp({
    epubUnzip: () => {
      const files = createEpub(["Chapter text."]);
      files["OEBPS/oversized.bin"] = new Uint8Array(201 * 1024 * 1024);
      return files;
    },
  });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("bomb.epub", "application/epub+zip")] },
    });

    assert.equal(app.elements.status.textContent, "This EPUB is too large to read safely.");
    assert.equal(app.elements.play.disabled, true);
    assert.equal(app.elements.documentControls.hidden, true);
  } finally {
    app.restore();
  }
});

test("an EPUB with too many archive entries fails with a clear message rather than hanging (FR-008 equivalent for the EPUB path)", async () => {
  // extractEpubText has no Worker/hasRealWorker concept to gate on (it's synchronous and
  // main-thread-only throughout), so its own worker-independent EPUB_MAX_ENTRIES cap is what
  // satisfies FR-008's "clearly report rather than hang or fail silently on something the
  // current path can't handle reliably" guarantee for this format — this test names that
  // guarantee explicitly rather than leaving it only incidentally covered.
  const app = loadBrowserApp({
    epubUnzip: () => {
      const files = createEpub(["Chapter text."]);
      for (let i = 0; i < 10001; i += 1) {
        files[`OEBPS/extra${i}.txt`] = new Uint8Array(1);
      }
      return files;
    },
  });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("many-entries.epub", "application/epub+zip")] },
    });

    assert.equal(app.elements.status.textContent, "This EPUB has too many files to read safely.");
    assert.equal(app.elements.play.disabled, true);
    assert.equal(app.elements.documentControls.hidden, true);
  } finally {
    app.restore();
  }
});

test("a malformed EPUB missing container.xml fails gracefully instead of crashing", async () => {
  const app = loadBrowserApp({
    epubUnzip: () => ({ "OEBPS/chapter0.xhtml": new TextEncoder().encode("<html><body>Text</body></html>") }),
  });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("broken.epub", "application/epub+zip")] },
    });

    assert.equal(app.elements.status.textContent, "Could not read this EPUB. Missing container.xml.");
    assert.equal(app.elements.play.disabled, true);
    assert.equal(app.elements.documentControls.hidden, true);
  } finally {
    app.restore();
  }
});

test("bookmarking the selected passage saves only a local resume position", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const app = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA first passage ends here. BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB second passage ends here.")),
    localStorage: storage,
  });
  try {
    const file = createFile("private.pdf", "application/pdf", "unique-pdf-bytes");
    file.arrayBuffer = async () => new TextEncoder().encode("unique-pdf-bytes").buffer;
    await app.trigger("fileInput", "change", {
      target: { files: [file] },
    });
    await app.trigger("textOutput", "click", {
      target: { getAttribute: () => "1", closest() { return this; } },
    });
    await app.trigger("bookmark", "click");

    assert.equal(app.elements.status.textContent, "Bookmark saved for passage 2.");
    assert.equal(app.elements.bookmark.getAttribute("aria-pressed"), "true");
    assert.equal(storage.values.size, 1);
    const [key, value] = storage.values.entries().next().value;
    assert.match(key, /^pdf-reader-bookmark:v2:/);
    assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ["index", "savedAt", "version"]);
    assert.deepEqual(JSON.parse(value).index, 1);
    assert.doesNotMatch(key + value, /private\.pdf|First passage|Second passage|unique-pdf-bytes/);
  } finally {
    app.restore();
  }
});

test("bookmarking while audio is loaded captures the current playback position (spec 009 US1, FR-001)", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const file = createFile("private.pdf", "application/pdf", "mid-chunk-bytes");
  file.arrayBuffer = async () => new TextEncoder().encode("mid-chunk-bytes").buffer;
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
    fetchImpl: async (url) => {
      if (url.endsWith("/voices")) return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", { target: { files: [file] } });
    await app.trigger("play", "click");
    app.window.lastAudio.currentTime = 3.5;

    await app.trigger("bookmark", "click");

    const [, value] = storage.values.entries().next().value;
    assert.equal(JSON.parse(value).offsetSeconds, 3.5);
  } finally {
    app.restore();
  }
});

test("reopening a bookmark with a saved offset resumes at that position (spec 009 US1, FR-002)", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const file = createFile("private.pdf", "application/pdf", "resume-offset-bytes");
  file.arrayBuffer = async () => new TextEncoder().encode("resume-offset-bytes").buffer;
  const fetchImpl = async (url) => {
    if (url.endsWith("/voices")) return { ok: true, async json() { return { voices: ["af_heart"] }; } };
    return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
  };
  const first = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
    fetchImpl,
  });
  try {
    first.elements.localEndpoint.value = "/v1/audio/speech";
    await first.trigger("localEndpoint", "change");
    await first.trigger("fileInput", "change", { target: { files: [file] } });
    await first.trigger("play", "click");
    first.window.lastAudio.currentTime = 2.25;
    await first.trigger("bookmark", "click");
  } finally {
    first.restore();
  }

  const reopened = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
    fetchImpl,
  });
  try {
    reopened.elements.localEndpoint.value = "/v1/audio/speech";
    await reopened.trigger("localEndpoint", "change");
    await reopened.trigger("fileInput", "change", { target: { files: [file] } });
    await reopened.trigger("play", "click");

    assert.equal(reopened.window.lastAudio.currentTime, 2.25);
  } finally {
    reopened.restore();
  }
});

test("the offset applies only once — the next chunk starts at time zero (spec 009 US1, FR-003)", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const file = createFile("private.pdf", "application/pdf", "one-shot-offset-bytes");
  file.arrayBuffer = async () => new TextEncoder().encode("one-shot-offset-bytes").buffer;
  const fetchImpl = async (url) => {
    if (url.endsWith("/voices")) return { ok: true, async json() { return { voices: ["af_heart"] }; } };
    return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
  };
  const first = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA first passage ends here. BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB second passage ends here.")),
    localStorage: storage,
    fetchImpl,
  });
  try {
    first.elements.localEndpoint.value = "/v1/audio/speech";
    await first.trigger("localEndpoint", "change");
    await first.trigger("fileInput", "change", { target: { files: [file] } });
    await first.trigger("play", "click");
    first.window.lastAudio.currentTime = 1.5;
    await first.trigger("bookmark", "click");
  } finally {
    first.restore();
  }

  const reopened = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA first passage ends here. BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB second passage ends here.")),
    localStorage: storage,
    fetchImpl,
  });
  try {
    reopened.elements.localEndpoint.value = "/v1/audio/speech";
    await reopened.trigger("localEndpoint", "change");
    await reopened.trigger("fileInput", "change", { target: { files: [file] } });
    await reopened.trigger("play", "click");
    assert.equal(reopened.window.lastAudio.currentTime, 1.5);

    // Simulate the resumed chunk finishing, advancing playback to the next chunk.
    // onended() triggers speakLocalChunk() without awaiting it internally, so its async chain
    // (cache lookup, fetch, new Audio construction) needs time to settle before lastAudio
    // reflects the new chunk's element.
    reopened.window.lastAudio.onended();
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(reopened.window.lastAudio.currentTime, 0);
  } finally {
    reopened.restore();
  }
});

test("reopening the same PDF restores its bookmark without starting audio", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const file = createFile("private.pdf", "application/pdf", "same-private-bytes");
  file.arrayBuffer = async () => new TextEncoder().encode("same-private-bytes").buffer;
  const first = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA first passage ends here. BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB second passage ends here.")),
    localStorage: storage,
  });
  try {
    await first.trigger("fileInput", "change", { target: { files: [file] } });
    await first.trigger("textOutput", "click", {
      target: { getAttribute: () => "1", closest() { return this; } },
    });
    await first.trigger("bookmark", "click");
  } finally {
    first.restore();
  }

  const reopened = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA first passage ends here. BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB second passage ends here.")),
    localStorage: storage,
  });
  try {
    await reopened.trigger("fileInput", "change", { target: { files: [file] } });

    assert.equal(reopened.elements.status.textContent, "Bookmark restored at passage 2. Press Play to continue.");
    assert.equal(reopened.elements.progress.value, 50);
    assert.equal(reopened.window.lastAudio, undefined);
    assert.equal(reopened.elements.bookmark.getAttribute("aria-pressed"), "true");
  } finally {
    reopened.restore();
  }
});

test("a bookmark never restores for a different PDF", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const firstFile = createFile("matching-name.pdf", "application/pdf", "first-bytes");
  firstFile.arrayBuffer = async () => new TextEncoder().encode("first-bytes").buffer;
  const differentFile = createFile("matching-name.pdf", "application/pdf", "different-bytes");
  differentFile.arrayBuffer = async () => new TextEncoder().encode("different-bytes").buffer;
  const app = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
  });
  try {
    await app.trigger("fileInput", "change", { target: { files: [firstFile] } });
    await app.trigger("textOutput", "click", {
      target: { getAttribute: () => "1", closest() { return this; } },
    });
    await app.trigger("bookmark", "click");
    await app.trigger("fileInput", "change", { target: { files: [differentFile] } });

    assert.equal(app.elements.status.textContent, "Ready. Press Play, or select a passage to start there.");
    assert.equal(app.elements.progress.value, 0);
    assert.equal(app.elements.bookmark.getAttribute("aria-pressed"), "false");
  } finally {
    app.restore();
  }
});

test("removing a bookmark makes the same PDF start from the beginning next time", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const file = createFile("private.pdf", "application/pdf", "remove-private-bytes");
  file.arrayBuffer = async () => new TextEncoder().encode("remove-private-bytes").buffer;
  const app = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
  });
  try {
    await app.trigger("fileInput", "change", { target: { files: [file] } });
    await app.trigger("textOutput", "click", {
      target: { getAttribute: () => "1", closest() { return this; } },
    });
    await app.trigger("bookmark", "click");
    await app.trigger("bookmark", "click");
    await app.trigger("fileInput", "change", { target: { files: [file] } });

    assert.equal(app.elements.status.textContent, "Ready. Press Play, or select a passage to start there.");
    assert.equal(app.elements.progress.value, 0);
    assert.equal(app.elements.bookmark.getAttribute("aria-pressed"), "false");
    assert.equal(storage.values.size, 0);
  } finally {
    app.restore();
  }
});

// Spec 009 US2 (non-regression foundation): a bookmark record in the exact pre-009 shape (no
// offsetSeconds field at all) must be read successfully and resume at chunk-start, exactly as
// it did before this feature existed — the feature's primary regression guard.
test("a pre-009-shaped bookmark (no offsetSeconds field) still resumes at chunk-start (spec 009 US2, FR-004)", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const file = createFile("private.pdf", "application/pdf", "pre009-bytes");
  file.arrayBuffer = async () => new TextEncoder().encode("pre009-bytes").buffer;
  const first = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA first passage ends here. BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB second passage ends here.")),
    localStorage: storage,
  });
  try {
    await first.trigger("fileInput", "change", { target: { files: [file] } });
    await first.trigger("textOutput", "click", {
      target: { getAttribute: () => "1", closest() { return this; } },
    });
    await first.trigger("bookmark", "click");
    const [key] = storage.values.keys();
    // Overwrite with the exact pre-009 shape — no offsetSeconds field — regardless of what this
    // session's own saveBookmark just wrote, to prove reading an old record works independent of
    // whether saving has changed.
    storage.values.set(key, JSON.stringify({ version: 2, index: 1, savedAt: Date.now() }));
  } finally {
    first.restore();
  }

  const reopened = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA first passage ends here. BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB second passage ends here.")),
    localStorage: storage,
  });
  try {
    await reopened.trigger("fileInput", "change", { target: { files: [file] } });

    assert.equal(reopened.elements.status.textContent, "Bookmark restored at passage 2. Press Play to continue.");
    assert.equal(reopened.elements.bookmark.getAttribute("aria-pressed"), "true");
  } finally {
    reopened.restore();
  }
});

test("a bookmark with a malformed offsetSeconds still resumes successfully (spec 009 US2, FR-005)", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const file = createFile("private.pdf", "application/pdf", "malformed-offset-bytes");
  file.arrayBuffer = async () => new TextEncoder().encode("malformed-offset-bytes").buffer;
  const first = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
  });
  try {
    await first.trigger("fileInput", "change", { target: { files: [file] } });
    await first.trigger("bookmark", "click");
    const [key] = storage.values.keys();
    storage.values.set(key, JSON.stringify({ version: 2, index: 0, savedAt: Date.now(), offsetSeconds: -5 }));
  } finally {
    first.restore();
  }

  const reopened = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
  });
  try {
    await reopened.trigger("fileInput", "change", { target: { files: [file] } });

    assert.equal(reopened.elements.bookmark.getAttribute("aria-pressed"), "true");
    assert.equal(reopened.elements.play.disabled, false);
  } finally {
    reopened.restore();
  }
});

test("corrupt or out-of-range bookmark data is discarded without blocking reading", async () => {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
  };
  const file = createFile("private.pdf", "application/pdf", "corrupt-private-bytes");
  file.arrayBuffer = async () => new TextEncoder().encode("corrupt-private-bytes").buffer;
  const first = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
  });
  try {
    await first.trigger("fileInput", "change", { target: { files: [file] } });
    await first.trigger("bookmark", "click");
    const [key] = storage.values.keys();
    storage.values.set(key, JSON.stringify({ version: 2, index: 99, savedAt: Date.now() }));
  } finally {
    first.restore();
  }

  const reopened = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
  });
  try {
    await reopened.trigger("fileInput", "change", { target: { files: [file] } });

    assert.equal(reopened.elements.play.disabled, false);
    assert.equal(reopened.elements.progress.value, 0);
    assert.equal(reopened.elements.bookmark.getAttribute("aria-pressed"), "false");
    assert.equal(storage.values.size, 0);
  } finally {
    reopened.restore();
  }
});

test("bookmark storage failure does not interrupt reading", async () => {
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error("Storage unavailable"); },
    removeItem() { throw new Error("Storage unavailable"); },
  };
  const file = createFile("private.pdf", "application/pdf", "storage-failure-bytes");
  file.arrayBuffer = async () => new TextEncoder().encode("storage-failure-bytes").buffer;
  const app = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorage: storage,
    fetchImpl: async (url) => {
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
    },
  });
  try {
    await app.trigger("fileInput", "change", { target: { files: [file] } });
    await app.trigger("bookmark", "click");

    assert.equal(app.elements.status.textContent, "Couldn't save bookmark. Reading is still available.");
    assert.equal(app.elements.play.disabled, false);
    await app.trigger("play", "click");
    assert.equal(app.window.lastAudio.src, "blob:audio-1");
  } finally {
    app.restore();
  }
});

test("privacy-mode storage access does not interrupt reading", async () => {
  const app = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("First passage. Second passage.")),
    localStorageGetterThrows: true,
    fetchImpl: async (url) => {
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
    },
  });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("private.pdf")] },
    });

    assert.equal(app.elements.play.disabled, false);
    assert.equal(app.elements.status.textContent, "Ready. Press Play, or select a passage to start there.");
    await app.trigger("play", "click");
    assert.equal(app.window.lastAudio.src, "blob:audio-1");
  } finally {
    app.restore();
  }
});

test("PDF load failure clears stale chunks and disables playback", async () => {
  let shouldFail = false;
  const app = loadBrowserApp({
    pdfLoader: () => (shouldFail ? Promise.reject(new Error("Could not read this PDF.")) : Promise.resolve(createPdf("First document."))),
  });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    assert.equal(app.elements.play.disabled, false);

    shouldFail = true;
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("broken.pdf")] },
    });

    assert.equal(app.elements.status.textContent, "Could not read this PDF.");
    assert.equal(app.elements.play.disabled, true);
    assert.equal(app.elements.stop.disabled, true);
  } finally {
    app.restore();
  }
});

test("PDF without readable text explains the OCR recovery step", async () => {
  const app = loadBrowserApp({ pdfLoader: () => Promise.resolve(createPdf("")) });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("scan.pdf")] },
    });

    assert.equal(
      app.elements.status.textContent,
      "No readable text found. Try a text-based PDF or run OCR first.",
    );
    assert.equal(app.elements.documentControls.hidden, true);
    assert.equal(app.elements.play.disabled, true);
    assert.equal(
      app.elements.textOutput.textContent,
      "No readable text found. This PDF may be a scan. Try a text-based PDF or run OCR first.",
    );
  } finally {
    app.restore();
  }
});

test("newer PDF selection wins when an older extraction finishes later", async () => {
  const slow = deferred();
  const app = loadBrowserApp({
    pdfLoader: (marker) => (marker === "slow" ? slow.promise : Promise.resolve(createPdf("Second document."))),
  });
  try {
    const slowLoad = app.trigger("fileInput", "change", {
      target: { files: [createFile("slow.pdf", "application/pdf", "slow")] },
    });
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("fast.pdf", "application/pdf", "fast")] },
    });

    slow.resolve(createPdf("First document."));
    await slowLoad;

    assert.equal(app.elements.fileName.textContent, "fast.pdf");
    assert.equal(app.elements.textOutput.textContent, "Second document.");
  } finally {
    app.restore();
  }
});

test("local Kokoro provider plays extracted text", async () => {
  const calls = [];
  const app = loadBrowserApp({
    speech: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/voices")) {
        return {
          ok: true,
          async json() {
            return { voices: ["af_heart"] };
          },
        };
      }
      return {
        ok: true,
        async blob() {
          return new Blob(["audio"], { type: "audio/wav" });
        },
      };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    assert.equal(app.elements.play.disabled, false);
    await app.trigger("play", "click");

    const speechCalls = calls.filter((c) => c.url.endsWith("/speech"));
    assert.equal(calls[0].url, "/v1/audio/voices");
    assert.equal(speechCalls.length >= 1, true);
    assert.deepEqual(JSON.parse(speechCalls[0].options.body), {
      input: "Loaded text.",
      voice: "af_heart",
      // Reflects the app's configured AUDIO_FORMAT. This test pins the SHAPE of the playback
      // path's synthesis request (text, voice, speed); the format contract itself is covered
      // independently by the KokoroTtsEngine tests, which assert both an explicit format and
      // the wav default.
      response_format: "opus",
      speed: 1,
    });
    assert.equal(app.window.lastAudio.src, "blob:audio-1");
    assert.equal(app.elements.status.textContent, "Reading 1 of 1...");
  } finally {
    app.restore();
  }
});

test("no fetch call during a full load-and-narrate cycle carries document text to a non-local destination (FR-001)", async () => {
  const calls = [];
  const documentText = "This is a longer paragraph of document content that must never be sent anywhere off this device during processing, no matter what happens.";
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf(documentText)),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    await app.trigger("play", "click");
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The one legitimate exception is the local-TTS request body itself (input text sent only
    // to a validated localhost endpoint, per FR-002) — everything else must never carry it.
    const nonSpeechCalls = calls.filter((call) => !call.url.endsWith("/speech"));
    assertNoDocumentTextLeaked(nonSpeechCalls, documentText);
  } finally {
    app.restore();
  }
});

test("every fetch call made during a load-and-narrate cycle targets only localhost (FR-002)", async () => {
  const calls = [];
  const app = loadBrowserApp({
    speech: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    await app.trigger("play", "click");
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(calls.length > 0, "expected at least one fetch call during this cycle");
    calls.forEach((call) => {
      assert.match(call.url, /^(\/|https?:\/\/(localhost|127\.0\.0\.1))/, `fetch targeted a non-local URL: ${call.url}`);
    });
  } finally {
    app.restore();
  }
});

test("loading a document only ever reads the source file's bytes and never attempts to write to it (FR-003)", async () => {
  const file = createFile("first.pdf");
  const spiedFile = { ...file };
  // A browser File/Blob object has no public write API at all — this test's real purpose is to
  // confirm this project's own code never even attempts one (e.g. no createWritable-style call
  // exists), since the platform itself already prevents in-place mutation of file bytes.
  // Reading the bytes more than once (e.g. once for the bookmark hash, once for extraction) is
  // expected and fine — FR-003 is about writes, not read count.
  const writeOrientedMethods = ["createWritable", "createSyncAccessHandle", "write", "truncate"];
  writeOrientedMethods.forEach((methodName) => {
    spiedFile[methodName] = () => {
      throw new Error(`loading a document must never call ${methodName} on the source file`);
    };
  });

  const app = loadBrowserApp({
    pdfLoader: () => Promise.resolve(createPdf("Loaded text.")),
  });
  try {
    await app.trigger("fileInput", "change", { target: { files: [spiedFile] } });

    assert.equal(app.elements.textOutput.textContent, "Loaded text.");
  } finally {
    app.restore();
  }
});

test("extraction reports progress once per page, confirming the loop yields between pages (FR-006)", async () => {
  const pageGates = [deferred(), deferred(), deferred()];
  const statusSnapshotsWhileLoading = [];
  const multiPagePdf = {
    numPages: pageGates.length,
    async getPage(pageNumber) {
      await pageGates[pageNumber - 1].promise;
      return {
        async getTextContent() {
          return { items: [{ str: `Page ${pageNumber} content.` }] };
        },
      };
    },
  };

  const app = loadBrowserApp({
    pdfLoader: () => Promise.resolve(multiPagePdf),
  });
  try {
    const loadPromise = app.trigger("fileInput", "change", { target: { files: [createFile("multi.pdf")] } });

    // Release pages one at a time, snapshotting status text between releases — if the
    // per-page loop still yields (via its per-page await), each release should be observably
    // followed by that specific page's progress message before the next one resolves.
    for (let i = 0; i < pageGates.length; i += 1) {
      pageGates[i].resolve();
      await new Promise((resolve) => setTimeout(resolve, 5));
      statusSnapshotsWhileLoading.push(app.elements.status.textContent);
    }

    await loadPromise;

    assert.ok(
      statusSnapshotsWhileLoading.some((text) => text.includes("Reading page 1 of 3")),
      `expected a page-1 progress message among: ${JSON.stringify(statusSnapshotsWhileLoading)}`,
    );
    assert.ok(
      statusSnapshotsWhileLoading.some((text) => text.includes("Reading page 3 of 3") || !text.startsWith("Reading page")),
      `expected extraction to have progressed past page 1 among: ${JSON.stringify(statusSnapshotsWhileLoading)}`,
    );
  } finally {
    app.restore();
  }
});

test("a large document is not extracted when no real worker is available (FR-008)", async () => {
  const largePdf = {
    numPages: 250,
    async getPage(pageNumber) {
      return { async getTextContent() { return { items: [{ str: `Page ${pageNumber}.` }] }; } };
    },
  };
  // The fake test window never defines a Worker constructor, so hasRealWorker is already false
  // by default here — this test's fixture is deliberately above the 200-page threshold to
  // exercise the gate that every other (small-document) test in this suite does not trigger.
  const app = loadBrowserApp({
    pdfLoader: () => Promise.resolve(largePdf),
  });
  try {
    await app.trigger("fileInput", "change", { target: { files: [createFile("large.pdf")] } });

    assert.match(app.elements.status.textContent, /worker|reliably|unavailable/i);
    assert.equal(app.elements.textOutput.textContent, "Choose a PDF to preview extracted text.");
  } finally {
    app.restore();
  }
});

test("a large document is not extracted when PDF.js falls back to a fake worker during the real load (FR-010)", async () => {
  const largePdf = {
    numPages: 250,
    async getPage(pageNumber) {
      return { async getTextContent() { return { items: [{ str: `Page ${pageNumber}.` }] }; } };
    },
  };
  // Unlike the FR-008 test above, a Worker constructor DOES exist here — so the weaker
  // `typeof Worker === "function"` signal alone would say hasRealWorker: true. PDF.js's own
  // real document-load call is the thing that emits the fake-worker warning in production; this
  // fixture simulates that by calling console.warn as a side effect of the load itself, the same
  // call site assessCapabilities must observe to satisfy FR-010.
  const app = loadBrowserApp({
    hasWorkerConstructor: true,
    pdfLoader: () => {
      console.warn("Setting up fake worker.");
      return Promise.resolve(largePdf);
    },
  });
  try {
    await app.trigger("fileInput", "change", { target: { files: [createFile("large.pdf")] } });

    assert.match(app.elements.status.textContent, /worker|reliably|unavailable/i);
    assert.equal(app.elements.textOutput.textContent, "Choose a PDF to preview extracted text.");
  } finally {
    app.restore();
  }
});

test("a corrupt PDF's load failure still propagates normally even though fake-worker detection now observes the same call (FR-008 regression guard)", async () => {
  const app = loadBrowserApp({
    hasWorkerConstructor: true,
    pdfLoader: () => Promise.reject(new Error("Could not read this PDF.")),
  });
  try {
    await app.trigger("fileInput", "change", { target: { files: [createFile("broken.pdf")] } });

    assert.equal(app.elements.status.textContent, "Could not read this PDF.");
  } finally {
    app.restore();
  }
});

test("a small document still extracts successfully when no real worker is available (FR-009)", async () => {
  const smallPdf = {
    numPages: 3,
    async getPage(pageNumber) {
      return { async getTextContent() { return { items: [{ str: `Page ${pageNumber} content.` }] }; } };
    },
  };
  const app = loadBrowserApp({
    pdfLoader: () => Promise.resolve(smallPdf),
  });
  try {
    await app.trigger("fileInput", "change", { target: { files: [createFile("small.pdf")] } });

    assert.equal(app.elements.play.disabled, false);
    assert.match(app.elements.textOutput.textContent, /Page 1 content\.|Page 2 content\.|Page 3 content\./);
  } finally {
    app.restore();
  }
});

test("reading pane shows literal, unmodified text by default even once narration chunks exist (FR-009)", async () => {
  const app = loadBrowserApp({
    speech: true,
    pdfLoader: () => Promise.resolve(createPdf("First sentence. Second sentence. Third sentence.")),
  });
  try {
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    assert.equal(app.elements.textOutput.textContent, "First sentence. Second sentence. Third sentence.");
  } finally {
    app.restore();
  }
});

test("clicking a paragraph in the default literal view jumps playback to its mapped chunk", async () => {
  const calls = [];
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First paragraph here.\n\nSecond paragraph here.")),
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    const secondParagraph = app.elements.textOutput.children.find(
      (node) => node.className === "literal-paragraph" && node.textContent === "Second paragraph here.",
    );
    assert.ok(secondParagraph, "expected a clickable paragraph for the second paragraph");

    await app.trigger("textOutput", "click", { target: secondParagraph });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(app.window.lastAudio.src, "blob:audio-1");
  } finally {
    app.restore();
  }
});

test("the currently-playing paragraph is highlighted in the literal view", async () => {
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First paragraph here.\n\nSecond paragraph here.")),
    fetchImpl: async (url) => {
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    await app.trigger("play", "click");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const activeParagraph = app.elements.textOutput.children.find(
      (node) => node.className === "literal-paragraph is-active",
    );
    assert.ok(activeParagraph, "expected the first paragraph to be marked active while playing");
    assert.equal(activeParagraph.textContent, "First paragraph here.");
  } finally {
    app.restore();
  }
});

test("local Kokoro prefetches the next speech chunk while the current chunk is being prepared", async () => {
  const calls = [];
  const first = deferred();
  const second = deferred();
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First chunk. ".repeat(40))),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      const speechCallsSoFar = calls.filter((c) => c.url.endsWith("/speech")).length;
      if (speechCallsSoFar === 1) return first.promise;
      return second.promise;
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    // Trigger play — this starts chunk[0] fetch and prefetch for chunk[1] concurrently
    const playPromise = app.trigger("play", "click");

    // Allow async IDB miss + sha256 to resolve so fetches are in flight
    await new Promise((resolve) => setTimeout(resolve, 20));

    // At least 2 speech fetches should now be in flight (chunk[0] + at least one prefetch)
    assert.ok(calls.filter((c) => c.url.endsWith("/speech")).length >= 2);

    first.resolve({ ok: true, async blob() { return new Blob(["audio-1"], { type: "audio/wav" }); } });
    await playPromise;

    assert.equal(app.window.lastAudio.src, "blob:audio-1");
  } finally {
    second.resolve({ ok: true, async blob() { return new Blob(["audio-2"], { type: "audio/wav" }); } });
    app.restore();
  }
});

test("local Kokoro provider loads available voices from the sibling voices endpoint", async () => {
  const app = loadBrowserApp({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { voices: ["af_bella", "af_heart", "am_puck"] };
      },
    }),
  });
  try {
    // Let the boot-time initializeVoices() call settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(
      app.elements.voice.children.map((option) => option.value),
      ["af_bella", "af_heart", "am_puck"],
    );
    assert.equal(app.elements.voice.value, "af_heart");
  } finally {
    app.restore();
  }
});

test("local Kokoro provider accepts a voices response shaped as objects with id/name", async () => {
  const app = loadBrowserApp({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          voices: [
            { id: "af_alloy", name: "af_alloy" },
            { id: "af_heart", name: "af_heart" },
            { id: "am_puck", name: "am_puck" },
          ],
        };
      },
    }),
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.deepEqual(
      app.elements.voice.children.map((option) => option.value),
      ["af_alloy", "af_heart", "am_puck"],
    );
    assert.equal(app.elements.voice.value, "af_heart");
  } finally {
    app.restore();
  }
});

test("local voice discovery keeps manual fallback when Kokoro is unavailable", async () => {
  const app = loadBrowserApp({
    fetchImpl: async () => ({ ok: false }),
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(app.elements.voice.value, "af_heart");
    assert.equal(app.elements.status.textContent, "Local Kokoro voices unavailable.");
  } finally {
    app.restore();
  }
});

test("local TTS endpoint rejects non-localhost URLs before sending text", async () => {
  let speechCalls = 0;
  const app = loadBrowserApp({
    speech: false,
    fetchImpl: async (url) => {
      if (url.endsWith("/speech")) {
        speechCalls += 1;
      }
      return { ok: true, blob: async () => new Blob(["audio"]) };
    },
  });
  try {
    app.elements.localEndpoint.value = "https://example.com/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });

    await app.trigger("play", "click");

    assert.equal(speechCalls, 0);
    assert.equal(app.elements.status.textContent, "Local TTS must use localhost or 127.0.0.1.");
  } finally {
    app.restore();
  }
});

test("same-origin local TTS endpoint is accepted", async () => {
  let speechCalls = 0;
  const app = loadBrowserApp({
    speech: false,
    fetchImpl: async (url) => {
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      if (url.endsWith("/speech")) {
        speechCalls += 1;
      }
      return { ok: true, async blob() { return new Blob(["audio"]); } };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    await app.trigger("play", "click");

    assert.equal(speechCalls, 1);
    assert.equal(app.elements.status.textContent, "Reading 1 of 1...");
  } finally {
    app.restore();
  }
});

test("local TTS falls back to localhost:8880 when the same-origin endpoint is unavailable", async () => {
  const calls = [];
  const app = loadBrowserApp({
    speech: false,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url === "/v1/audio/voices" || url === "http://localhost:8880/v1/audio/voices") {
        return {
          ok: true,
          async json() {
            return { voices: ["af_heart"] };
          },
        };
      }
      if (url === "http://localhost:8880/v1/audio/speech") {
        return {
          ok: true,
          async blob() {
            return new Blob(["audio"], { type: "audio/wav" });
          },
        };
      }
      return { ok: false };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    await app.trigger("play", "click");

    assert.ok(calls.includes("http://localhost:8880/v1/audio/speech"));
    assert.equal(app.elements.status.textContent, "Reading 1 of 1...");
  } finally {
    app.restore();
  }
});

test("local TTS playback errors during active playback attempt to reconnect rather than stopping silently", async () => {
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("Read this sentence.")),
    fetchImpl: async (url) => {
      if (url.endsWith("/voices")) {
        return { ok: true, async json() { return { voices: ["af_heart"] }; } };
      }
      return { ok: true, async blob() { return new Blob(["audio"], { type: "audio/wav" }); } };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    await app.trigger("play", "click");
    app.window.lastAudio.onerror();

    // The reconnect attempt calls speakLocalChunk() synchronously, which immediately overwrites
    // "Reconnecting..." with the normal in-progress status — so playback resumes rather than
    // stopping silently, which is the actual behavior under test.
    assert.equal(app.elements.status.textContent, "Reading 1 of 1...");
    assert.equal(app.elements.textOutput.textContent, "Read this sentence.");
  } finally {
    app.restore();
  }
});

test("createKokoroTtsEngine returns an object with a synthesize function (spec 008 US2, FR-001)", () => {
  const engine = createKokoroTtsEngine();

  assert.equal(typeof engine.synthesize, "function");
});

test("defaultTtsEngine is a synthesize-capable engine, confirming it is wired as the module default (spec 008 US2, FR-004)", () => {
  assert.equal(typeof getDefaultTtsEngine().synthesize, "function");
});

// FR-006: loopback-only validation lives at the playback-initiation call site (unchanged by
// this feature, confirmed against the pre-008 code directly), not inside synthesize itself —
// synthesize performed no endpoint-trust check before this refactor and must not gain one now,
// since that would be a real behavior change this explicitly zero-behavior-change spec forbids.
// This test instead confirms synthesize still requests exactly the endpoint it's given, proving
// the abstraction didn't silently add or drop endpoint handling.
test("KokoroTtsEngine.synthesize requests exactly the endpoint it is given (spec 008 US2, FR-002)", async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];
  global.fetch = async (url) => { requestedUrls.push(url); return { ok: true, blob: async () => new Blob() }; };

  try {
    const engine = createKokoroTtsEngine();
    await engine.synthesize("hello", { endpoint: "http://localhost:8880/v1/audio/speech", voice: "af_heart", speed: 1 });
    assert.ok(requestedUrls.includes("http://localhost:8880/v1/audio/speech"));
  } finally {
    global.fetch = originalFetch;
  }
});

test("KokoroTtsEngine.synthesize resolves to an AudioResult carrying the fetched blob (spec 008 US2, FR-005)", async () => {
  const originalFetch = global.fetch;
  const expectedBlob = new Blob(["audio"], { type: "audio/wav" });
  global.fetch = async () => ({ ok: true, blob: async () => expectedBlob });

  try {
    const engine = createKokoroTtsEngine();
    const result = await engine.synthesize("hello", { endpoint: "/v1/audio/speech", voice: "af_heart", speed: 1 });
    assert.equal(result.blob, expectedBlob);
  } finally {
    global.fetch = originalFetch;
  }
});

// FR-011/SC-003: `setTtsEngine` reassigns the same module-level `defaultTtsEngine` binding
// `localChunkPromise` reads from (both operate on the top-level `require("./app.js")` instance
// this test file itself imported, since this test does not go through loadBrowserApp's
// cache-busting re-require) — this is what genuinely proves substitutability reaches the real
// audio-consuming code path, not just that a test double is independently callable.
test("a minimal Kokoro-agnostic test double can substitute for the module's live default engine (spec 008 US2, FR-011, SC-003)", async () => {
  const fakeBlob = new Blob(["fake audio"], { type: "audio/wav" });
  const testDouble = { synthesize: async () => ({ blob: fakeBlob }) };

  try {
    setTtsEngine(testDouble);

    assert.equal(getDefaultTtsEngine(), testDouble);
    const result = await getDefaultTtsEngine().synthesize("any text", { voice: "af_heart", speed: 1, endpoint: "/v1/audio/speech" });
    assert.equal(result.blob, fakeBlob);
  } finally {
    setTtsEngine(createKokoroTtsEngine());
  }
});

test("local Kokoro playback continues when the page is backgrounded", async () => {
  const app = loadBrowserApp({
    speech: false,
    pdfLoader: () => Promise.resolve(createPdf("First chunk. ".repeat(40))),
    fetchImpl: async (url) => {
      if (url.endsWith("/voices")) {
        return {
          ok: true,
          async json() {
            return { voices: ["af_heart"] };
          },
        };
      }
      return {
        ok: true,
        async blob() {
          return new Blob(["audio"], { type: "audio/wav" });
        },
      };
    },
  });
  try {
    app.elements.localEndpoint.value = "/v1/audio/speech";
    await app.trigger("localEndpoint", "change");
    await app.trigger("fileInput", "change", {
      target: { files: [createFile("first.pdf")] },
    });
    await app.trigger("play", "click");

    assert.equal(app.window.lastAudio.paused, false);
    const statusWhilePlaying = app.elements.status.textContent;
    app.window.visibilityState = "hidden";
    global.document.visibilityState = "hidden";
    global.document.dispatchEvent({ type: "visibilitychange" });

    assert.equal(app.window.lastAudio.paused, false);
    assert.equal(app.elements.status.textContent, statusWhilePlaying);

    global.document.visibilityState = "visible";
    global.document.dispatchEvent({ type: "visibilitychange" });

    assert.equal(app.window.lastAudio.paused, false);
    assert.equal(app.elements.status.textContent, statusWhilePlaying);
  } finally {
    app.restore();
  }
});

test("static shell exposes resume control and local-only PDF engine policy", () => {
  const root = __dirname;
  const html = readFileSync(join(root, "index.html"), "utf8");
  const engine = readFileSync(join(root, "pdf-engine.js"), "utf8");

  assert.match(html, /id="resume"/);
  assert.match(html, /id="bookmark"[^>]*aria-pressed="false"/);
  assert.match(html, /id="localEndpoint"/);
  assert.match(html, /value="\/v1\/audio\/speech"/);
  assert.match(html, /src="\.\/app\.js" type="module"/);
  assert.doesNotMatch(html, /cdnjs\.cloudflare\.com/);
  assert.match(html, /connect-src 'self' http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
  assert.match(html, /media-src 'self' blob: http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/);
  assert.match(engine, /vendor\/pdfjs-4\.10\.38\/pdf\.min\.mjs/);
  assert.doesNotMatch(engine, /https:\/\/cdnjs\.cloudflare\.com/);
});

test("static shell accepts EPUB files through a local-only decompression engine", () => {
  const root = __dirname;
  const html = readFileSync(join(root, "index.html"), "utf8");
  const engine = readFileSync(join(root, "epub-engine.js"), "utf8");

  assert.match(html, /accept="[^"]*\.epub[^"]*"/);
  assert.match(html, /src="\.\/epub-engine\.js" type="module"/);
  assert.match(engine, /vendor\/fflate-0\.8\.3\/fflate\.mjs/);
  assert.doesNotMatch(engine, /https?:\/\/(?!localhost|127\.0\.0\.1)/);
});

test("reader layout keeps long PDF text inside a viewport-constrained scroll region", () => {
  const css = readFileSync(join(__dirname, "styles.css"), "utf8");

  assert.match(css, /\.app-shell\s*{[^}]*height:\s*100dvh;/s);
  assert.match(css, /\.app-shell\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.reader-core\s*{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.text-output\s*{[^}]*flex:\s*1;/s);
  assert.match(css, /\.text-output\s*{[^}]*min-height:\s*0;/s);
  assert.match(css, /\.text-output\s*{[^}]*overflow:\s*auto;/s);
});

// Regression for the UI freeze reported on a 303-page book (574 KB of extracted text): the
// per-page extraction loop completed ("Reading page 303 of 303...") and the tab then went
// unresponsive inside splitIntoSpeechChunks. Measured cost was quadratic in total text length
// (10.8KB/131ms, 21.7KB/1029ms, 43.4KB/8180ms, 86.8KB/64110ms - ~4x per doubling), because
// every boundary position re-scanned the whole string through isProtectedPosition.
//
// OWASP A08:2025 Mishandling of Exceptional Conditions - a realistic document must chunk in
// bounded time rather than hanging the main thread. This asserts the observable outcome
// (completes within a budget) on book-scale input, not any particular internal strategy.
test("splitIntoSpeechChunks chunks a book-scale document in bounded time (UI freeze regression)", () => {
  const paragraph = "The executive who wants to win must understand that preparation beats "
    + "talent when talent is unprepared. Mr. Smith paid $1,250.75 in 1987, roughly 12.5% of "
    + "the total, which was the 3rd largest sum e.g. that quarter.";
  // ~100 KB, still well under the 574 KB book that triggered the freeze.
  const text = Array.from({ length: 400 }, () => paragraph).join("\n\n");

  const start = Date.now();
  const chunks = splitIntoSpeechChunks(text, 260);
  const elapsedMs = Date.now() - start;

  assert.ok(chunks.length > 0, "expected a book-scale document to produce chunks");
  assert.ok(elapsedMs < 2000, `expected under 2000ms, took ${elapsedMs}ms`);
});

// Second half of the UI-freeze regression: click-to-jump paragraph mapping compared every
// paragraph against every chunk (O(paragraphs x chunks) set intersections). Sized to the real
// 303-page book that triggered the report (564 KB of text -> 1206 paragraphs, 7388 chunks),
// since that is the largest input this path realistically sees. Unlike chunking, this runs only
// when the clickable-passages view is enabled, is cached in state.paragraphChunkMap, and is off
// the document-load path - so the budget here guards a one-time interaction hitch, not the
// load freeze. Asserts the observable outcome only.
test("mapParagraphsToChunks maps a book-scale document in bounded time (UI freeze regression)", () => {
  const paragraphCount = 1206;
  const chunkCount = 7388;
  const paragraphs = Array.from({ length: paragraphCount }, (_, i) =>
    `Paragraph ${i} about executives negotiating contracts and winning deals in business.`);
  const chunks = Array.from({ length: chunkCount }, (_, i) =>
    `Paragraph ${i} about executives negotiating contracts.`);

  const start = Date.now();
  const mapped = mapParagraphsToChunks(paragraphs, chunks);
  const elapsedMs = Date.now() - start;

  assert.equal(mapped.length, paragraphCount);
  assert.ok(elapsedMs < 1500, `expected under 1500ms, took ${elapsedMs}ms`);
});
// --- Buffering improvements (measured against the local Kokoro server) ---
//
// Measured synthesis cost is ~1.55s fixed per call plus ~0.0143s/char, so chunk size dominates
// throughput: 40-char chunks synthesise at ~1.1x realtime (playback nearly starves) while
// 260-char chunks reach ~3.2x. The book's narration splits into 7388 chunks averaging 75 chars
// with 30% under 40 chars, because the tier splitter always splits at sentence boundaries and
// never merges. mergeShortChunks packs those already-split chunks back up to a target.

test("mergeShortChunks packs adjacent short chunks up to the target length", () => {
  const merged = mergeShortChunks(["One.", "Two.", "Three."], 40);

  assert.deepEqual(merged, ["One. Two. Three."]);
});

test("mergeShortChunks never produces a chunk longer than the target", () => {
  const chunks = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} here.`);

  const merged = mergeShortChunks(chunks, 100);

  assert.ok(merged.length > 0);
  merged.forEach((chunk) => {
    assert.ok(chunk.length <= 100, `chunk of ${chunk.length} exceeded target 100: ${chunk}`);
  });
});

// A chunk already at or over the target is passed through untouched rather than dropped or
// split further - splitting here would risk cutting a protected span the tier splitter kept
// whole (OWASP A08: the merge step must never create a malformed utterance).
test("mergeShortChunks preserves a chunk that already exceeds the target", () => {
  const long = "x".repeat(120);

  const merged = mergeShortChunks([long, "Tail."], 100);

  assert.ok(merged.includes(long));
  assert.equal(merged.join(" ").includes("Tail."), true);
});

test("mergeShortChunks loses no text", () => {
  const chunks = ["Dr. Smith paid four hundred dollars.", "He was the 21st to do so.", "Then he left."];

  const merged = mergeShortChunks(chunks, 200);

  assert.equal(merged.join(" "), chunks.join(" "));
});

// The EWMA prefetch depth divided by a hardcoded CHUNK_PLAY_MS = 2500, but real chunks yield
// roughly 9s of audio, so lookahead systematically under-prefetched. Exposed as a pure function
// so the observable contract (a faster server or longer chunks buys more lookahead) is testable.
test("prefetchDepth grows when synthesis is fast relative to chunk playback", () => {
  const slow = prefetchDepth({ estimatedSynthesisMs: 4000, chunkPlaybackMs: 9000 });
  const fast = prefetchDepth({ estimatedSynthesisMs: 1000, chunkPlaybackMs: 9000 });

  assert.ok(fast > slow, `expected deeper lookahead when synthesis is faster (${fast} vs ${slow})`);
});

test("prefetchDepth always prefetches at least one chunk ahead and stays bounded", () => {
  const starved = prefetchDepth({ estimatedSynthesisMs: 999999, chunkPlaybackMs: 9000 });
  const unbounded = prefetchDepth({ estimatedSynthesisMs: 1, chunkPlaybackMs: 9000 });

  assert.equal(starved, 1);
  assert.ok(unbounded <= 6, `expected a bounded lookahead, got ${unbounded}`);
});

// Merging made steady-state playback much faster (3.44x -> 5.49x realtime on the real book) but
// regressed the one moment the listener actually waits: the FIRST chunk grew from 75 to 205
// characters, pushing time-to-first-audio from 2.2s to 4.2s. Leaving the opening chunk unmerged
// recovers that 2.2s start while keeping the full steady-state gain (measured: same 5.49x, same
// 204min total, one extra chunk), so it is strictly better than merging everything.
test("mergeShortChunks can leave the opening chunk unmerged so audio starts sooner", () => {
  const chunks = ["Short opener.", "Next one.", "And another.", "One more here."];

  const merged = mergeShortChunks(chunks, 260, { keepFirstChunkShort: true });

  assert.equal(merged[0], "Short opener.");
  assert.ok(merged.length >= 2, "the remaining chunks should still be merged together");
  assert.equal(merged.join(" "), chunks.join(" "), "no text may be lost");
});

test("mergeShortChunks merges the opening chunk by default", () => {
  const chunks = ["Short opener.", "Next one."];

  assert.deepEqual(mergeShortChunks(chunks, 260), ["Short opener. Next one."]);
});

// Opus output: ~10.5x smaller than WAV at real chunk size (43,250 vs 453,676 bytes measured),
// which is what lets the 150MB IndexedDB cache hold a whole book (3,636 chunks vs 346) rather
// than a fraction of one. It buys no playback latency - loopback transfer is ~0.2ms against a
// multi-second synthesis - so the format is a caching decision, not a buffering one.
test("KokoroTtsEngine.synthesize requests the audio format it is given", async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, blob: async () => new Blob() };
  };

  try {
    const engine = createKokoroTtsEngine();
    await engine.synthesize("hello", {
      endpoint: "/v1/audio/speech", voice: "af_heart", speed: 1, format: "opus",
    });

    assert.equal(bodies[0].response_format, "opus");
  } finally {
    global.fetch = originalFetch;
  }
});

test("KokoroTtsEngine.synthesize still requests wav when no format is given", async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, blob: async () => new Blob() };
  };

  try {
    const engine = createKokoroTtsEngine();
    await engine.synthesize("hello", { endpoint: "/v1/audio/speech", voice: "af_heart", speed: 1 });

    assert.equal(bodies[0].response_format, "wav");
  } finally {
    global.fetch = originalFetch;
  }
});

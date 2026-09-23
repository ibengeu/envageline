import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BoundingBox, DocumentBlock, ExtractedPage, NarrationSegment } from "../core/types.ts";
import { findSegmentByBlockId } from "../controller.ts";
import { compileDocument } from "./compiler.ts";

const LINE_HEIGHT = 0.03;

function line(id: string, text: string, y: number, page = 1, x = 0.1, width = 0.8): DocumentBlock {
  return {
    id,
    page,
    text,
    bounds: { x, y, width, height: LINE_HEIGHT },
    fontSize: 0.018,
    source: "pdf-text",
  };
}

function pageOf(blocks: DocumentBlock[], page = 1, documentId = "book"): ExtractedPage {
  return {
    documentId,
    page,
    width: 600,
    height: 800,
    scanned: false,
    textLength: blocks.reduce((sum, block) => sum + block.text.length, 0),
    blocks,
  };
}

function spoken(segments: NarrationSegment[], text: string): NarrationSegment {
  const found = segments.find((segment) => segment.originalText === text);
  assert.ok(found, `expected a narrated sentence "${text}", got ${segments.map((s) => s.originalText).join(" | ")}`);
  return found;
}

function withinLine(box: BoundingBox, source: DocumentBlock): boolean {
  const top = source.bounds.y - 1e-9;
  const bottom = source.bounds.y + source.bounds.height + 1e-9;
  return box.y >= top && box.y + box.height <= bottom;
}

const threeLineParagraph = [
  line("l1", "The storm came quickly. Rain", 0.2),
  line("l2", "fell on the empty harbour all", 0.24),
  line("l3", "night long. Morning was calm.", 0.28),
];

describe("sentence highlighting", () => {
  it("highlights only the line a short sentence sits on, not the whole paragraph", () => {
    const { segments } = compileDocument([pageOf(threeLineParagraph)]);

    const first = spoken(segments, "The storm came quickly.");

    assert.equal(first.bounds.length, 1);
    assert.ok(withinLine(first.bounds[0]!, threeLineParagraph[0]!));
  });

  it("starts a mid-line sentence at its own first character, clear of the sentence before it", () => {
    const { segments } = compileDocument([pageOf(threeLineParagraph)]);

    const before = spoken(segments, "The storm came quickly.").bounds[0]!;
    const after = spoken(segments, "Rain fell on the empty harbour all night long.").bounds[0]!;

    assert.ok(withinLine(after, threeLineParagraph[0]!));
    assert.ok(before.x + before.width <= after.x + 1e-9, "the two sentences overlap on the shared line");
  });

  it("gives a sentence that wraps across lines one box per line, ending before the next sentence", () => {
    const { segments } = compileDocument([pageOf(threeLineParagraph)]);

    const wrapped = spoken(segments, "Rain fell on the empty harbour all night long.").bounds;
    const next = spoken(segments, "Morning was calm.").bounds[0]!;

    assert.equal(wrapped.length, 3);
    threeLineParagraph.forEach((source, index) => assert.ok(withinLine(wrapped[index]!, source)));
    const end = wrapped[2]!;
    assert.ok(end.x + end.width <= next.x + 1e-9, "the wrapped sentence runs into the next one");
    assert.ok(end.width < threeLineParagraph[2]!.bounds.width / 2);
  });

  it("keeps the highlight on the spoken words when a citation was dropped from the narration", () => {
    const cited = line("c1", "Early studies [4] showed the effect clearly. Later work agreed.", 0.2);
    const { segments } = compileDocument([pageOf([cited])]);

    const first = spoken(segments, "Early studies showed the effect clearly.").bounds[0]!;
    const second = spoken(segments, "Later work agreed.").bounds[0]!;

    const gap = second.x - (first.x + first.width);
    assert.ok(gap >= -1e-9, "the sentences overlap");
    assert.ok(gap < 0.02, `the first highlight stops ${gap.toFixed(3)} short of the next sentence`);
  });

  it("resolves a tap on a line to the sentence actually spoken on that line", () => {
    const { segments } = compileDocument([pageOf(threeLineParagraph)]);

    const tapped = findSegmentByBlockId(segments, "l2");

    assert.equal(tapped?.originalText, "Rain fell on the empty harbour all night long.");
  });

  it("narrates a sentence broken by a page turn once, highlighted on both pages", () => {
    const pageOne = pageOf([
      line("a1", "The corridor was long and dark. He walked", 0.7),
      line("a2", "slowly past the locked doors", 0.74),
      line("a-folio", "12", 0.93, 1, 0.48, 0.04),
    ]);
    const pageTwo = pageOf([
      line("b1", "into the quiet room. She was waiting there.", 0.1, 2),
      line("b-folio", "13", 0.93, 2, 0.48, 0.04),
    ].map((block) => ({ ...block, page: 2 })), 2);

    const { segments } = compileDocument([pageOne, pageTwo]);

    const crossing = spoken(segments, "He walked slowly past the locked doors into the quiet room.");
    assert.equal(segments.some((segment) => segment.originalText.startsWith("into the quiet")), false);
    assert.equal(crossing.page, 1);
    assert.ok(crossing.bounds.every((box) => box.y >= 0.7 - 1e-9 && box.y < 0.8));
    assert.equal(crossing.continuedOn?.page, 2);
    assert.equal(crossing.continuedOn?.bounds.length, 1);
    assert.ok(withinLine(crossing.continuedOn!.bounds[0]!, pageTwo.blocks[0]!));
    assert.ok(spoken(segments, "She was waiting there.").page === 2);
  });

  it("keeps a sentence's identity when an earlier page gains text, so saved positions stay valid", () => {
    const later = pageOf([line("q1", "The second page begins here.", 0.2, 2)].map((b) => ({ ...b, page: 2 })), 2);
    const earlier = pageOf([line("e1", "A scanned first page finally recognized.", 0.2)]);

    const before = compileDocument([later]).segments;
    const after = compileDocument([earlier, later]).segments;

    assert.equal(
      spoken(after, "The second page begins here.").id,
      spoken(before, "The second page begins here.").id,
    );
  });

  it("ends the highlight on the full stop even when a dropped citation sits before it", () => {
    const cited = line("c2", "The claim is well supported [12]. Critics disagreed.", 0.2);
    const { segments } = compileDocument([pageOf([cited])]);

    const first = spoken(segments, "The claim is well supported.").bounds[0]!;
    const second = spoken(segments, "Critics disagreed.").bounds[0]!;

    const gap = second.x - (first.x + first.width);
    assert.ok(gap >= -1e-9, "the sentences overlap");
    assert.ok(gap < 0.02, `the highlight stops ${gap.toFixed(3)} short of its full stop`);
  });

  it("resolves a tap on a line shared by two sentences to the one under the pointer", () => {
    const shared = line("sh", "Documents were never written to be heard. A page is a map of attention.", 0.2);
    const { segments } = compileDocument([pageOf([shared])]);

    const left = findSegmentByBlockId(segments, "sh", { x: 0.15, y: 0.21 });
    const right = findSegmentByBlockId(segments, "sh", { x: 0.85, y: 0.21 });

    assert.equal(left?.originalText, "Documents were never written to be heard.");
    assert.equal(right?.originalText, "A page is a map of attention.");
  });
});

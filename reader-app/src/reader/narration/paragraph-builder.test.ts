import assert from "node:assert/strict";
import { it } from "node:test";
import type { DocumentBlock } from "../core/types.ts";
import { groupLines, groupParagraphs } from "./paragraph-builder.ts";

function block(
  id: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
): DocumentBlock {
  return {
    id,
    page: 1,
    text,
    bounds: { x, y, width, height },
    fontSize: height,
    source: "pdf-text",
  };
}

it("keeps a line box on the body text when a taller ornament shares the line", () => {
  // A decorative marker set in a larger face, sitting slightly above the words.
  const ornament = block("b0", "❚", 0.1, 0.176, 0.01, 0.0215);
  const heading = block("b1", "The Person Who Will", 0.13, 0.178, 0.3, 0.02);

  const [line] = groupLines([ornament, heading]);

  assert.equal(line?.text, "❚ The Person Who Will");
  assert.ok(Math.abs((line?.bounds.y ?? 0) - 0.178) < 1e-9);
  assert.ok(Math.abs((line?.bounds.height ?? 0) - 0.02) < 1e-9);
});

it("ignores a leading ornament even when it opens the line", () => {
  const ornament = block("b0", "❚", 0.1, 0.176, 0.01, 0.0215);
  const heading = block("b1", "Change Your Life", 0.13, 0.178, 0.3, 0.02);
  const trailing = block("b2", "❚", 0.45, 0.176, 0.01, 0.0215);

  const [line] = groupLines([ornament, heading, trailing]);

  assert.ok(Math.abs((line?.bounds.y ?? 0) - 0.178) < 1e-9);
  assert.ok(Math.abs((line?.bounds.height ?? 0) - 0.02) < 1e-9);
  assert.ok(Math.abs((line?.bounds.x ?? 0) - 0.13) < 1e-9);
});

it("drops a same-size roman-numeral folio separated from a heading by a wide gap", () => {
  // Some books set the running folio at the same size as the heading instead
  // of visibly smaller, so a font-size-ratio check alone won't catch it. The
  // folio still sits apart from the heading with a much wider gap than the
  // heading's own word spacing.
  const folio = block("b0", "xvi", 0.08, 0.1, 0.03, 0.02);
  const heading = block("b1", "Introduction", 0.4, 0.1, 0.2, 0.02);

  const [line] = groupLines([folio, heading]);

  assert.equal(line?.text, "Introduction");
});

it("reads letter-tracked title text as words, not spelled-out letters", () => {
  // pdf.js hands back tracked/kerned display type (title pages, covers) as a
  // single text item per glyph, e.g. "P e n g u i n" with real spaces baked in.
  const tracked = block("b0", "P e n g u i n", 0.2, 0.1, 0.3, 0.02);

  const [line] = groupLines([tracked]);

  assert.equal(line?.text, "Penguin");
});

it("joins a detached typographic drop cap to its paragraph", () => {
  const dropCap = block("cap", "I", 0.03, 0.08, 0.025, 0.11);
  const firstLine = block(
    "line-1",
    "used to think that the best person to solve a problem in our organiza-",
    0.07,
    0.1,
    0.86,
    0.04,
  );
  const secondLine = block(
    "line-2",
    "tion was the person who first recognized the problem and presented it",
    0.07,
    0.15,
    0.86,
    0.04,
  );

  const paragraphs = groupParagraphs(groupLines([dropCap, firstLine, secondLine]));

  assert.equal(paragraphs.length, 1);
  assert.equal(
    paragraphs[0]?.text,
    "I used to think that the best person to solve a problem in our organization was the person who first recognized the problem and presented it",
  );
});

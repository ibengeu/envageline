import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DocumentBlock } from "../core/types.ts";
import { groupLines } from "./paragraph-builder.ts";
import { detectTables } from "./table-detector.ts";

function block(id: string, text: string, x: number, y: number, w = 0.15, h = 0.02): DocumentBlock {
  return {
    id,
    page: 1,
    text,
    bounds: { x, y, width: w, height: h },
    fontSize: h,
    source: "pdf-text",
  };
}

describe("detectTables", () => {
  it("finds a table from three aligned rows and reads it cell by cell, left to right", () => {
    const blocks = [
      block("h1", "Quarter", 0.1, 0.1),
      block("h2", "Revenue", 0.4, 0.1),
      block("h3", "Growth", 0.7, 0.1),
      block("r1c1", "Q1", 0.1, 0.14),
      block("r1c2", "42", 0.4, 0.14),
      block("r1c3", "12%", 0.7, 0.14),
      block("r2c1", "Q2", 0.1, 0.18),
      block("r2c2", "48", 0.4, 0.18),
      block("r2c3", "15%", 0.7, 0.18),
    ];
    const lines = groupLines(blocks);

    const tables = detectTables(lines);

    assert.equal(tables.length, 1);
    assert.deepEqual(
      tables[0]?.rows.map((row) => row.cells),
      [
        ["Quarter", "Revenue", "Growth"],
        ["Q1", "42", "12%"],
        ["Q2", "48", "15%"],
      ],
    );
  });

  it("does not flag ordinary prose lines as a table", () => {
    const blocks = [
      block("p1", "This is a normal paragraph that spans most of the line.", 0.1, 0.1, 0.7),
      block("p2", "It continues here with more regular prose text.", 0.1, 0.14, 0.7),
      block("p3", "And wraps up the paragraph on this final line.", 0.1, 0.18, 0.7),
    ];
    const lines = groupLines(blocks);

    const tables = detectTables(lines);

    assert.deepEqual(tables, []);
  });

  it("does not flag two lines that merely happen to align", () => {
    const blocks = [
      block("a1", "Name", 0.1, 0.1),
      block("a2", "Score", 0.5, 0.1),
      block("b1", "Alex", 0.1, 0.14),
      block("b2", "90", 0.5, 0.14),
    ];
    const lines = groupLines(blocks);

    const tables = detectTables(lines);

    assert.deepEqual(tables, []);
  });

  it("requires most rows in the run to share the column bands", () => {
    const blocks = [
      block("h1", "Quarter", 0.1, 0.1),
      block("h2", "Revenue", 0.4, 0.1),
      block("r1c1", "Q1", 0.1, 0.14),
      block("r1c2", "42", 0.4, 0.14),
      block("solo", "A single unrelated sentence spanning the row.", 0.1, 0.18, 0.7),
    ];
    const lines = groupLines(blocks);

    const tables = detectTables(lines);

    assert.deepEqual(tables, []);
  });
});

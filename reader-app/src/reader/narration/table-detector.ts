import type { DocumentBlock } from "../core/types.ts";
import type { TextLine } from "./paragraph-builder.ts";

export interface TableRow {
  cells: string[];
  sourceLines: TextLine[];
}

export interface DetectedTable {
  rows: TableRow[];
  blocks: DocumentBlock[];
  firstLineIndex: number;
  lastLineIndex: number;
}

const MIN_TABLE_ROWS = 3;
const MIN_TABLE_COLUMNS = 2;
const COLUMN_BAND_TOLERANCE = 0.02;
const MIN_ROW_COLUMN_COVERAGE = 0.8;

function blockStarts(line: TextLine): number[] {
  return line.blocks.map((b) => b.bounds.x).sort((a, b) => a - b);
}

// Groups x-start positions that recur across a run of lines into shared
// column bands - the network/stream approach real table-extraction tools
// (Camelot, pdfplumber) fall back to when a PDF draws no ruling lines: no
// grid geometry to read, only where text happens to line up.
function columnBands(lines: TextLine[]): number[] {
  const allStarts = lines.flatMap(blockStarts).sort((a, b) => a - b);
  const bands: number[] = [];
  for (const start of allStarts) {
    const last = bands.at(-1);
    if (last === undefined || start - last > COLUMN_BAND_TOLERANCE) {
      bands.push(start);
    }
  }
  return bands;
}

function rowCoversColumns(line: TextLine, bands: number[]): number {
  const starts = blockStarts(line);
  let covered = 0;
  for (const band of bands) {
    if (starts.some((start) => Math.abs(start - band) <= COLUMN_BAND_TOLERANCE)) {
      covered += 1;
    }
  }
  return covered;
}

function numericSecondColumnRun(lines: TextLine[]): boolean {
  let numericRows = 0;
  for (const line of lines) {
    const cells = [...line.blocks].sort((left, right) => left.bounds.x - right.bounds.x);
    const value = cells.at(-1)?.text.trim() ?? "";
    if (/^[\p{N}$€£¥.,%()+−–—/-]+$/u.test(value)) numericRows += 1;
  }
  return numericRows / lines.length >= 0.6;
}

function isTableRun(lines: TextLine[]): boolean {
  if (lines.length < MIN_TABLE_ROWS) return false;
  if (lines.some((line) => line.blocks.length < MIN_TABLE_COLUMNS)) return false;

  const bands = columnBands(lines);
  if (bands.length < MIN_TABLE_COLUMNS) return false;
  // Two aligned text columns also describe a normal book page. Require a
  // numeric/value-like second column before classifying that layout as a table.
  if (bands.length === 2 && !numericSecondColumnRun(lines)) return false;

  const wellCoveredRows = lines.filter(
    (line) => rowCoversColumns(line, bands) >= MIN_TABLE_COLUMNS,
  ).length;
  return wellCoveredRows / lines.length >= MIN_ROW_COLUMN_COVERAGE;
}

function toRow(line: TextLine): TableRow {
  const cells = [...line.blocks]
    .sort((a, b) => a.bounds.x - b.bounds.x)
    .map((b) => b.text.trim())
    .filter(Boolean);
  return { cells, sourceLines: [line] };
}

// Only flags runs with strong, repeated column alignment across several
// consecutive lines (MIN_TABLE_ROWS+), by design: a look-alike (a two-column
// page layout, a list with one aligned trailing number) should fall through
// to ordinary paragraph reading rather than get mis-split into table cells.
export function detectTables(lines: TextLine[]): DetectedTable[] {
  const tables: DetectedTable[] = [];
  let i = 0;
  while (i <= lines.length - MIN_TABLE_ROWS) {
    let end = i + MIN_TABLE_ROWS;
    if (!isTableRun(lines.slice(i, end))) {
      i += 1;
      continue;
    }
    while (end < lines.length && isTableRun(lines.slice(i, end + 1))) {
      end += 1;
    }
    const run = lines.slice(i, end);
    tables.push({
      rows: run.map(toRow),
      blocks: run.flatMap((line) => line.blocks),
      firstLineIndex: i,
      lastLineIndex: end - 1,
    });
    i = end;
  }
  return tables;
}

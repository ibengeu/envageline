import type { BoundingBox } from "../core/types.ts";

export interface SourceLineGeometry {
  text: string;
  bounds: BoundingBox;
}

interface SourceToken {
  value: string;
  lineIndex: number;
}

// Rounding slack for normalized geometry. A rectangle that spills past the page
// edge by less than this is a float artifact of the PDF transform, not bad data.
const EDGE_EPSILON = 1e-6;

export function isValidBoundingBox(box: BoundingBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.x >= 0 &&
    box.y >= 0 &&
    box.width > 0 &&
    box.height > 0 &&
    box.x + box.width <= 1 + EDGE_EPSILON &&
    box.y + box.height <= 1 + EDGE_EPSILON
  );
}

// OWASP A10:2025 Mishandling of Exceptional Conditions - clamp validated geometry
// to the page instead of dropping it, so a rounding artifact never silently
// removes a highlight the reader is currently narrating.
export function clampBoundingBox(box: BoundingBox): BoundingBox {
  return {
    x: box.x,
    y: box.y,
    width: Math.min(box.width, 1 - box.x),
    height: Math.min(box.height, 1 - box.y),
  };
}

function tokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu)?.map((token) => token.toLowerCase()) ?? [];
}

function tokenMatches(source: string, target: string): boolean {
  if (source === target) return true;
  return source.replace(/-/g, "") === target.replace(/-/g, "");
}

function sourceTokens(lines: SourceLineGeometry[]): SourceToken[] {
  const result: SourceToken[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    for (const value of tokens(line.text)) result.push({ value, lineIndex });
  }
  return result;
}

function boundsForMatch(
  sentence: string,
  source: SourceToken[],
  lines: SourceLineGeometry[],
  start: number,
): { bounds: BoundingBox[]; next: number } {
  const wanted = tokens(sentence);
  if (wanted.length === 0) return { bounds: [], next: start };

  const lineIndexes = new Set<number>();
  let sourceIndex = start;
  let wantedIndex = 0;
  while (sourceIndex < source.length && wantedIndex < wanted.length) {
    const current = source[sourceIndex];
    if (current && tokenMatches(current.value, wanted[wantedIndex]!)) {
      lineIndexes.add(current.lineIndex);
      wantedIndex += 1;
    }
    sourceIndex += 1;
  }
  if (wantedIndex !== wanted.length) return { bounds: [], next: start };

  const bounds = [...lineIndexes]
    .sort((left, right) => left - right)
    .map((index) => lines[index]?.bounds)
    .filter((box): box is BoundingBox => Boolean(box) && isValidBoundingBox(box))
    .map(clampBoundingBox);
  return { bounds, next: sourceIndex };
}

export function mapSentenceBounds(
  sentences: string[],
  lines: SourceLineGeometry[],
): BoundingBox[][] {
  const source = sourceTokens(lines);
  let cursor = 0;
  return sentences.map((sentence) => {
    const match = boundsForMatch(sentence, source, lines, cursor);
    cursor = match.next;
    return match.bounds;
  });
}

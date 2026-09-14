import { LINE_Y_TOLERANCE, PARAGRAPH_GAP_FACTOR } from "../core/config.ts";
import type { BoundingBox, DocumentBlock } from "../core/types.ts";

export interface TextLine {
  text: string;
  blocks: DocumentBlock[];
  bounds: BoundingBox;
  fontSize: number;
}

export interface ParagraphGroup {
  text: string;
  originalParts: string[];
  sourceLines: TextLine[];
  blocks: DocumentBlock[];
  bounds: BoundingBox[];
  fontSize: number;
  indent: number;
}

function unionBounds(boxes: BoundingBox[]): BoundingBox {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

// Decorative markers - section bullets, drop-cap rules, dingbats - are set in a
// larger face than the words they sit beside. Letting them into the line box
// pushes the reading highlight off the text, so the box follows the blocks that
// actually carry words whenever the line has any.
function wordBearing(blocks: DocumentBlock[]): DocumentBlock[] {
  const words = blocks.filter((block) => /[\p{L}\p{N}]/u.test(block.text));
  return words.length > 0 ? words : blocks;
}

function lineBounds(blocks: DocumentBlock[]): BoundingBox {
  return unionBounds(wordBearing(blocks).map((block) => block.bounds));
}

function joinLineText(blocks: DocumentBlock[]): string {
  return blocks
    .map((block) => block.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function groupLines(blocks: DocumentBlock[]): TextLine[] {
  const lines: TextLine[] = [];
  for (const block of blocks) {
    const last = lines.at(-1);
    if (!last) {
      lines.push({
        text: block.text,
        blocks: [block],
        bounds: { ...block.bounds },
        fontSize: block.fontSize ?? block.bounds.height,
      });
      continue;
    }

    const lastSize = last.fontSize || 0.02;
    const yClose =
      Math.abs(
        block.bounds.y + block.bounds.height / 2 - (last.bounds.y + last.bounds.height / 2),
      ) <=
      lastSize * LINE_Y_TOLERANCE;
    const sizeClose = Math.abs((block.fontSize ?? lastSize) - lastSize) <= lastSize * 0.45;

    if (yClose && sizeClose) {
      last.blocks.push(block);
      last.bounds = lineBounds(last.blocks);
      last.text = joinLineText(last.blocks);
      last.fontSize = Math.max(last.fontSize, block.fontSize ?? last.fontSize);
    } else {
      lines.push({
        text: block.text,
        blocks: [block],
        bounds: { ...block.bounds },
        fontSize: block.fontSize ?? block.bounds.height,
      });
    }
  }
  return lines.filter((line) => line.text.trim().length > 0);
}

const KEEP_HYPHEN_NEXT = new Set(["of", "the", "and", "to", "in", "for", "with", "or", "a", "an"]);

export function dehyphenate(previous: string, next: string): string {
  const match = previous.match(/^(.*?)([A-Za-z]{2,})-$/);
  if (!match) {
    if (previous.endsWith("-")) return `${previous}${next}`;
    return `${previous} ${next}`;
  }
  const stem = match[1] ?? "";
  const prefix = match[2] ?? "";
  const nextWord = (next.match(/^[A-Za-z']+/)?.[0] ?? "").toLowerCase();
  if (/^[a-z]/.test(next) && prefix.length >= 4 && !KEEP_HYPHEN_NEXT.has(nextWord)) {
    return `${stem}${prefix}${next}`;
  }
  return `${stem}${prefix}-${next}`;
}

function looksLikeList(text: string): boolean {
  return /^(?:[-•●▪]|[0-9]{1,2}[.)]|[A-Za-z][.)])\s+\S/.test(text.trim());
}

function looksLikeBreak(
  line: { bounds: BoundingBox; fontSize: number; text: string },
  next: { bounds: BoundingBox; fontSize: number; text: string },
): boolean {
  const gap = next.bounds.y - (line.bounds.y + line.bounds.height);
  const size = line.fontSize || 0.02;
  if (gap > size * PARAGRAPH_GAP_FACTOR) return true;
  if (Math.abs(next.bounds.x - line.bounds.x) > 0.08) return true;
  if (Math.abs(next.fontSize - line.fontSize) > line.fontSize * 0.35) return true;
  if (looksLikeList(next.text)) return true;
  if (/[:]$/.test(line.text) && looksLikeList(next.text)) return true;
  const ratio = line.bounds.width === 0 ? 1 : line.bounds.width;
  if (line.bounds.width < 0.35 && /[.!?]$/.test(line.text) && ratio < 0.45) {
    return true;
  }
  return false;
}

export function groupParagraphs(lines: TextLine[]): ParagraphGroup[] {
  const groups: ParagraphGroup[] = [];
  for (const line of lines) {
    const last = groups.at(-1);
    if (!last) {
      groups.push({
        text: line.text.trim(),
        originalParts: [line.text.trim()],
        sourceLines: [line],
        blocks: [...line.blocks],
        bounds: [line.bounds],
        fontSize: line.fontSize,
        indent: line.bounds.x,
      });
      continue;
    }

    const lastLine = {
      bounds: last.bounds.at(-1) ?? line.bounds,
      fontSize: last.fontSize,
      text: last.originalParts.at(-1) ?? last.text,
    };

    if (looksLikeBreak(lastLine, line) || looksLikeList(line.text)) {
      groups.push({
        text: line.text.trim(),
        originalParts: [line.text.trim()],
        sourceLines: [line],
        blocks: [...line.blocks],
        bounds: [line.bounds],
        fontSize: line.fontSize,
        indent: line.bounds.x,
      });
      continue;
    }

    last.text = dehyphenate(last.text, line.text.trim());
    last.originalParts.push(line.text.trim());
    last.sourceLines.push(line);
    last.blocks.push(...line.blocks);
    last.bounds.push(line.bounds);
    last.fontSize = Math.max(last.fontSize, line.fontSize);
  }
  return groups;
}

import { COLUMN_GUTTER_MIN } from "../core/config.ts";
import type { DocumentBlock } from "../core/types.ts";

function centerX(block: DocumentBlock): number {
  return block.bounds.x + block.bounds.width / 2;
}

function centerY(block: DocumentBlock): number {
  return block.bounds.y + block.bounds.height / 2;
}

function sortVisual(blocks: DocumentBlock[]): DocumentBlock[] {
  return [...blocks].sort((a, b) => {
    const dy = centerY(a) - centerY(b);
    if (Math.abs(dy) > Math.min(a.bounds.height, b.bounds.height) * 0.4) {
      return dy;
    }
    return a.bounds.x - b.bounds.x;
  });
}

function splitByGutter(blocks: DocumentBlock[]): DocumentBlock[][] {
  if (blocks.length < 4) return [blocks];

  const centers = blocks.map(centerX).sort((a, b) => a - b);
  let bestGap = 0;
  let splitAt = -1;
  for (let i = 1; i < centers.length; i++) {
    const left = centers[i - 1] ?? 0;
    const right = centers[i] ?? 0;
    const gap = right - left;
    if (gap > bestGap) {
      bestGap = gap;
      splitAt = (left + right) / 2;
    }
  }

  if (bestGap < COLUMN_GUTTER_MIN || splitAt < 0.28 || splitAt > 0.72) {
    return [blocks];
  }

  const left: DocumentBlock[] = [];
  const right: DocumentBlock[] = [];
  for (const block of blocks) {
    if (centerX(block) < splitAt) left.push(block);
    else right.push(block);
  }

  if (left.length < 2 || right.length < 2) return [blocks];

  const leftSpan = verticalSpan(left);
  const rightSpan = verticalSpan(right);
  const overlap =
    Math.min(leftSpan.max, rightSpan.max) - Math.max(leftSpan.min, rightSpan.min);
  const union =
    Math.max(leftSpan.max, rightSpan.max) - Math.min(leftSpan.min, rightSpan.min);
  if (union <= 0 || overlap / union < 0.45) return [blocks];

  return [left, right];
}

function verticalSpan(blocks: DocumentBlock[]): { min: number; max: number } {
  let min = 1;
  let max = 0;
  for (const block of blocks) {
    min = Math.min(min, block.bounds.y);
    max = Math.max(max, block.bounds.y + block.bounds.height);
  }
  return { min, max };
}

export function orderBlocks(blocks: DocumentBlock[]): DocumentBlock[] {
  const usable = blocks.filter((block) => block.text.trim().length > 0);
  const columns = splitByGutter(usable);
  return columns.flatMap(sortVisual);
}

// A table's own column gap can look exactly like a two-column page's gutter
// to a purely geometric split (same gap width, same vertical overlap between
// the two sides). A page with a detected table skips gutter-splitting
// entirely and orders by simple visual position instead, so the table's
// columns are never mistaken for the two sides of a column layout.
export function orderBlocksSimply(blocks: DocumentBlock[]): DocumentBlock[] {
  return sortVisual(blocks.filter((block) => block.text.trim().length > 0));
}

import { SCAN_TEXT_THRESHOLD } from "../core/config.ts";
import type { DocumentBlock } from "../core/types.ts";
import { meaningfulLength, unicodeQuality } from "./text-extractor.ts";

export function isLikelyScanned(blocks: DocumentBlock[]): boolean {
  const length = meaningfulLength(blocks);
  if (length < SCAN_TEXT_THRESHOLD) return true;
  if (blocks.length <= 1 && length < 40) return true;
  if (unicodeQuality(blocks) < 0.7) return true;
  return false;
}

function hasDetachedDropCap(blocks: DocumentBlock[]): boolean {
  const sizes = blocks
    .map((block) => block.fontSize ?? block.bounds.height)
    .filter((size) => size > 0)
    .sort((left, right) => left - right);
  const bodySize = sizes[Math.floor(sizes.length / 2)] ?? 0;
  if (bodySize <= 0) return false;
  return blocks.some((block) =>
    /^\p{Lu}$/u.test(block.text.trim()) &&
    (block.fontSize ?? block.bounds.height) >= bodySize * 1.6,
  );
}

function hasSuspiciousLowercaseOpener(blocks: DocumentBlock[]): boolean {
  const firstProse = [...blocks]
    .filter((block) => {
      const text = block.text.trim();
      return block.bounds.y >= 0.06 && block.bounds.y < 0.9 &&
        block.bounds.x < 0.25 && text.length >= 20 && /\p{L}/u.test(text);
    })
    .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x)[0];
  return firstProse ? /^\p{Ll}/u.test(firstProse.text.trim()) : false;
}

export function needsOcrVerification(blocks: DocumentBlock[]): boolean {
  return isLikelyScanned(blocks) || hasDetachedDropCap(blocks) ||
    hasSuspiciousLowercaseOpener(blocks);
}

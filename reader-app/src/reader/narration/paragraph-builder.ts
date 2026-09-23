import { LINE_Y_TOLERANCE, PARAGRAPH_GAP_FACTOR } from "../core/config.ts";
import type { BoundingBox, DocumentBlock } from "../core/types.ts";

const PAGE_NUMBER_RE =
  /^(?:page\s+)?(?:[ivxlcdm]+|\d+)(?:\s*\/\s*\d+)?$|^[ivxlcdm]+$|^\d+\s*$/i;

export function isPageNumber(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 18) return false;
  return PAGE_NUMBER_RE.test(trimmed);
}

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

// A running page-number stamp (roman or arabic) sometimes shares a line with
// a chapter heading instead of sitting alone in the header/footer band. Most
// books set it well below the heading's font size, unlike a real word the
// heading would use at full size, so a small isolated page-number token is
// dropped from the spoken line. Some books set the folio at the heading's own
// size instead, so a stamp is also dropped when it sits apart from its
// nearest neighbor by a much wider gap than the line's own word spacing -
// true of a folio parked in the margin, not of a word inside the heading.
function dropStrayPageNumbers(blocks: DocumentBlock[]): DocumentBlock[] {
  if (blocks.length < 2) return blocks;
  const dominant = Math.max(...blocks.map((block) => block.fontSize ?? 0));
  if (dominant <= 0) return blocks;
  const filtered = blocks.filter((block, index) => {
    if (!isPageNumber(block.text)) return true;
    const size = block.fontSize ?? dominant;
    const isSmallStamp = size < dominant * 0.7;
    const isIsolatedStamp = isFarFromNeighbors(blocks, index);
    return !(isSmallStamp || isIsolatedStamp);
  });
  return filtered.length > 0 ? filtered : blocks;
}

function gapBetween(a: DocumentBlock, b: DocumentBlock): number {
  return Math.max(0, b.bounds.x - (a.bounds.x + a.bounds.width));
}

// A folio stamp set apart from the rest of the line sits behind a gap several
// character-widths wider than ordinary word spacing, regardless of the page's
// absolute scale. A block's own font size is a stand-in for its character
// width, since normalized page coordinates carry no font metrics directly.
const STRAY_GAP_EMS = 2.5;

function isFarFromNeighbors(blocks: DocumentBlock[], index: number): boolean {
  const block = blocks[index]!;
  const em = block.fontSize ?? block.bounds.height;
  const threshold = em * STRAY_GAP_EMS;
  const before = index > 0 ? gapBetween(blocks[index - 1]!, block) : Infinity;
  const after = index < blocks.length - 1 ? gapBetween(block, blocks[index + 1]!) : Infinity;
  return Math.min(before, after) >= threshold;
}

// Letter-tracked display type (title pages, covers) reaches pdf.js as text
// where every glyph is its own space-separated token, e.g. "P e n g u i n".
// Read as-is, a TTS engine spells the word out letter by letter, so runs of
// single-character tokens are collapsed back into one word before joining.
function collapseLetterTracking(text: string): string {
  return text.replace(
    /(?:^|(?<=\s))\p{L}(?:\s\p{L}){2,}(?=\s|$)/gu,
    (run) => run.replace(/\s+/g, ""),
  );
}

function joinLineText(rawBlocks: DocumentBlock[], preserveFolio: boolean): string {
  const blocks = preserveFolio ? rawBlocks : dropStrayPageNumbers(rawBlocks);
  const joined = blocks
    .map((block) => block.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return collapseLetterTracking(joined);
}

function isDropCapContinuation(line: TextLine, block: DocumentBlock): boolean {
  if (line.blocks.length !== 1 || !/^\p{Lu}$/u.test(line.text.trim())) return false;
  const cap = line.blocks[0];
  if (!cap) return false;
  const bodySize = block.fontSize ?? block.bounds.height;
  const capSize = cap.fontSize ?? cap.bounds.height;
  const capBottom = cap.bounds.y + cap.bounds.height;
  const horizontalGap = block.bounds.x - (cap.bounds.x + cap.bounds.width);
  return capSize >= bodySize * 1.6 &&
    horizontalGap >= 0 && horizontalGap <= bodySize * 1.5 &&
    cap.bounds.y <= block.bounds.y + block.bounds.height / 2 &&
    capBottom >= block.bounds.y;
}

export function groupLines(
  blocks: DocumentBlock[],
  options: { preserveFolio?: boolean } = {},
): TextLine[] {
  const preserveFolio = options.preserveFolio ?? false;
  const lines: TextLine[] = [];
  for (const block of blocks) {
    const last = lines.at(-1);
    if (!last) {
      lines.push({
        text: joinLineText([block], preserveFolio),
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
      last.text = joinLineText(last.blocks, preserveFolio);
      last.fontSize = Math.max(last.fontSize, block.fontSize ?? last.fontSize);
    } else if (isDropCapContinuation(last, block)) {
      last.blocks.push(block);
      last.bounds = unionBounds(last.blocks.map((item) => item.bounds));
      last.text = joinLineText(last.blocks, preserveFolio);
      last.fontSize = block.fontSize ?? block.bounds.height;
    } else {
      lines.push({
        text: joinLineText([block], preserveFolio),
        blocks: [block],
        bounds: { ...block.bounds },
        fontSize: block.fontSize ?? block.bounds.height,
      });
    }
  }
  return lines.filter(
    (line) => line.text.trim().length > 0 && (preserveFolio || !isFolioLine(line)),
  );
}

// A line made up of nothing but a page-number stamp (optionally beside a
// decorative rule or bullet) is a running folio, not prose - regardless of
// which document it came from. Left in, it merges into whichever paragraph
// sits on the next line (often a chapter heading) and gets read aloud with it.
function isFolioLine(line: TextLine): boolean {
  const prose = wordBearing(line.blocks).filter((block) =>
    /\p{L}{2,}/u.test(block.text),
  );
  if (prose.length !== 0) return false;
  const words = line.blocks.filter((block) => /[\p{L}\p{N}]/u.test(block.text));
  return words.length > 0 && words.every((block) => isPageNumber(block.text));
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
  // A ~15%+ font-size change reliably marks a new heading or label starting
  // (real headings commonly run only ~15-20% larger than body text - a 35%
  // threshold missed those and let a heading merge into the paragraph after it).
  if (Math.abs(next.fontSize - line.fontSize) > line.fontSize * 0.15) return true;
  if (looksLikeList(next.text)) return true;
  if (/[:]$/.test(line.text) && looksLikeList(next.text)) return true;
  if (/^\[(?:\d+(?:[,;–-]\s*\d+)*)\]$/.test(line.text.trim())) return true;
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

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

// A hyphenated line wrap ("to-" / "day") is two source tokens once split on
// the hyphen, but dehyphenation already rejoined them into one sentence
// token ("today") before matching runs. When a source token only opens the
// wanted token, later source tokens are folded in until they either
// complete it or the accumulated text no longer fits - so the match still
// finds every line the merged word actually came from.
function consumeSplitWord(
  source: SourceToken[],
  sourceIndex: number,
  wanted: string,
): { lineIndexes: number[]; consumed: number } | null {
  let combined = "";
  const lineIndexes: number[] = [];
  let index = sourceIndex;
  while (index < source.length && combined.length < wanted.length) {
    const current = source[index];
    if (!current) break;
    combined += current.value;
    lineIndexes.push(current.lineIndex);
    index += 1;
    if (combined === wanted) return { lineIndexes, consumed: index - sourceIndex };
    if (!wanted.startsWith(combined)) return null;
  }
  return null;
}

function lineIndexesForMatch(
  sentence: string,
  source: SourceToken[],
  start: number,
): { lineIndexes: number[]; next: number } {
  const wanted = tokens(sentence);
  if (wanted.length === 0) return { lineIndexes: [], next: start };

  const lineIndexes = new Set<number>();
  let sourceIndex = start;
  let wantedIndex = 0;
  while (sourceIndex < source.length && wantedIndex < wanted.length) {
    const current = source[sourceIndex];
    if (!current) break;
    if (tokenMatches(current.value, wanted[wantedIndex]!)) {
      lineIndexes.add(current.lineIndex);
      wantedIndex += 1;
      sourceIndex += 1;
      continue;
    }
    const split = consumeSplitWord(source, sourceIndex, wanted[wantedIndex]!);
    if (split) {
      for (const lineIndex of split.lineIndexes) lineIndexes.add(lineIndex);
      wantedIndex += 1;
      sourceIndex += split.consumed;
      continue;
    }
    sourceIndex += 1;
  }
  if (wantedIndex !== wanted.length) return { lineIndexes: [], next: start };

  return { lineIndexes: [...lineIndexes].sort((left, right) => left - right), next: sourceIndex };
}

// Which source lines each sentence actually spans, in the same left-to-right,
// top-to-bottom reading order the paragraph was extracted in. A sentence deep
// in a long paragraph only spans a few of the paragraph's many lines, so this
// - not the whole paragraph's line list - is what a click on one of its lines
// should resolve back to.
export function mapSentenceLineIndexes(
  sentences: string[],
  lines: SourceLineGeometry[],
): number[][] {
  const source = sourceTokens(lines);
  let cursor = 0;
  return sentences.map((sentence) => {
    const match = lineIndexesForMatch(sentence, source, cursor);
    cursor = match.next;
    return match.lineIndexes;
  });
}

export function mapSentenceBounds(
  sentences: string[],
  lines: SourceLineGeometry[],
): BoundingBox[][] {
  const source = sourceTokens(lines);
  let cursor = 0;
  return sentences.map((sentence) => {
    const match = lineIndexesForMatch(sentence, source, cursor);
    cursor = match.next;
    return match.lineIndexes
      .map((index) => lines[index]?.bounds)
      .filter((box): box is BoundingBox => Boolean(box) && isValidBoundingBox(box))
      .map(clampBoundingBox);
  });
}

export interface SourceBlockGeometry {
  id: string;
  page: number;
  text: string;
  bounds: BoundingBox;
}

export interface SentencePlacement {
  page: number;
  bounds: BoundingBox;
  blockIds: string[];
}

interface CharToken {
  value: string;
  block: number;
  start: number;
  end: number;
}

interface CharSpan {
  block: number;
  start: number;
  end: number;
}

function charTokens(blocks: readonly SourceBlockGeometry[]): CharToken[] {
  const result: CharToken[] = [];
  for (const [block, source] of blocks.entries()) {
    for (const match of source.text.matchAll(/[\p{L}\p{N}]+/gu)) {
      const start = match.index ?? 0;
      result.push({
        value: match[0].normalize("NFKC").toLowerCase(),
        block,
        start,
        end: start + match[0].length,
      });
    }
  }
  return result;
}

function wantedTokens(sentence: string): string[] {
  return sentence.normalize("NFKC").match(/[\p{L}\p{N}]+/gu)?.map((token) => token.toLowerCase()) ?? [];
}

// OWASP A06:2025 Insecure Design - each word is searched for only a few
// tokens ahead, so a hostile or garbled text layer costs linear work and a
// word that is missing from the source (a dropped citation, an OCR slip)
// cannot drag the rest of the sentence out of alignment.
const ALIGN_LOOKAHEAD = 8;

function splitWordLength(source: readonly { value: string }[], index: number, wanted: string): number | null {
  let combined = "";
  for (let cursor = index; cursor < source.length && combined.length < wanted.length; cursor += 1) {
    combined += source[cursor]!.value;
    if (combined === wanted) return cursor - index + 1;
    if (!wanted.startsWith(combined)) return null;
  }
  return null;
}

function findWanted(
  source: readonly CharToken[],
  from: number,
  wanted: string,
): { index: number; consumed: number } | null {
  const limit = Math.min(source.length, from + ALIGN_LOOKAHEAD);
  for (let index = from; index < limit; index += 1) {
    if (tokenMatches(source[index]!.value, wanted)) return { index, consumed: 1 };
    const consumed = splitWordLength(source, index, wanted);
    if (consumed !== null && consumed > 1) return { index, consumed };
  }
  return null;
}

function alignSentence(
  wanted: string[],
  source: CharToken[],
  cursor: number,
): { first: number; last: number; next: number } | null {
  let index = cursor;
  let first = -1;
  let last = -1;
  for (const token of wanted) {
    const hit = findWanted(source, index, token);
    if (!hit) continue;
    if (first < 0) first = hit.index;
    index = hit.index + hit.consumed;
    last = index - 1;
  }
  if (first < 0) return null;
  return { first, last, next: index };
}

// Punctuation glued to a sentence's outer words - an opening quote, the
// closing full stop - belongs to the highlight even though it is not a word.
// A citation marker the narration dropped ("supported [12].") can sit
// between the last spoken word and the sentence's full stop; the highlight
// still runs through to that stop.
const TRAILING_CITATION = /^\s*(?:\[[\d,;\s–-]+\]|\([^()]{1,40}\d{4}[a-z]?\))(?=[.!?…])/u;

function widenToPunctuation(text: string, start: number, end: number): { start: number; end: number } {
  let from = start;
  let to = end;
  while (from > 0 && /[^\s\p{L}\p{N}]/u.test(text[from - 1] ?? "")) from -= 1;
  to += text.slice(to).match(TRAILING_CITATION)?.[0].length ?? 0;
  while (to < text.length && /[^\s\p{L}\p{N}]/u.test(text[to] ?? "")) to += 1;
  return { start: from, end: to };
}

function sentenceSpans(first: CharToken, last: CharToken, blocks: readonly SourceBlockGeometry[]): CharSpan[] {
  const spans: CharSpan[] = [];
  for (let block = first.block; block <= last.block; block += 1) {
    const text = blocks[block]?.text ?? "";
    const rawStart = block === first.block ? first.start : 0;
    const rawEnd = block === last.block ? last.end : text.length;
    const widened = widenToPunctuation(text, rawStart, rawEnd);
    spans.push({
      block,
      start: block === first.block ? widened.start : rawStart,
      end: block === last.block ? widened.end : rawEnd,
    });
  }
  return spans;
}

// Proportional fonts give "m" roughly three times the advance of "i", so an
// even per-character split drifts badly across a line. These are coarse
// typical advances (in ems) - enough to land a cut within a glyph or two.
function glyphAdvance(char: string): number {
  if (/\s/u.test(char)) return 0.25;
  if (/[ijlt.,;:'!|’‘]/u.test(char)) return 0.28;
  if (/[fr()-]/u.test(char)) return 0.34;
  if (/[mwMW]/u.test(char)) return 0.8;
  if (/\p{Lu}/u.test(char)) return 0.68;
  if (/\p{N}/u.test(char)) return 0.5;
  return 0.46;
}

function advanceFraction(text: string, index: number): number {
  const chars = [...text];
  const total = chars.reduce((sum, char) => sum + glyphAdvance(char), 0);
  if (total <= 0) return 0;
  const before = [...text.slice(0, index)].reduce((sum, char) => sum + glyphAdvance(char), 0);
  return before / total;
}

function spanBox(span: CharSpan, source: SourceBlockGeometry): BoundingBox {
  const left = advanceFraction(source.text, span.start);
  const right = advanceFraction(source.text, span.end);
  return {
    x: source.bounds.x + source.bounds.width * left,
    y: source.bounds.y,
    width: source.bounds.width * Math.max(0, right - left),
    height: source.bounds.height,
  };
}

function sameVisualLine(left: SentencePlacement, page: number, box: BoundingBox): boolean {
  if (left.page !== page) return false;
  const centre = box.y + box.height / 2;
  return centre >= left.bounds.y && centre <= left.bounds.y + left.bounds.height;
}

function unionBox(left: BoundingBox, right: BoundingBox): BoundingBox {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return {
    x,
    y,
    width: Math.max(left.x + left.width, right.x + right.width) - x,
    height: Math.max(left.y + left.height, right.y + right.height) - y,
  };
}

function placementsFor(spans: CharSpan[], blocks: readonly SourceBlockGeometry[]): SentencePlacement[] {
  const placements: SentencePlacement[] = [];
  for (const span of spans) {
    const source = blocks[span.block];
    if (!source || span.end <= span.start) continue;
    const box = spanBox(span, source);
    // OWASP A10:2025 Mishandling of Exceptional Conditions - malformed PDF
    // geometry is dropped here rather than turned into an overlay style.
    if (!isValidBoundingBox(box)) continue;
    const previous = placements.at(-1);
    if (previous && sameVisualLine(previous, source.page, box)) {
      previous.bounds = unionBox(previous.bounds, box);
      previous.blockIds.push(source.id);
      continue;
    }
    placements.push({ page: source.page, bounds: clampBoundingBox(box), blockIds: [source.id] });
  }
  return placements;
}

// Maps a character range of the blocks' concatenated text ("a b" joined by
// single spaces) back onto per-block spans.
function spansForRange(blocks: readonly SourceBlockGeometry[], from: number, to: number): CharSpan[] {
  const spans: CharSpan[] = [];
  let offset = 0;
  for (const [block, source] of blocks.entries()) {
    const start = Math.max(from - offset, 0);
    const end = Math.min(to - offset, source.text.length);
    if (end > start) spans.push({ block, start, end });
    offset += source.text.length + 1;
  }
  return spans;
}

// OWASP A10:2025 Mishandling of Exceptional Conditions - when a sentence can't
// be found word-for-word (garbled OCR, an unusual encoding), its place is
// estimated from where it falls in the text rather than lighting up the whole
// paragraph, which is what made the highlight swallow entire pages.
function estimatedPlacements(
  sentences: string[],
  index: number,
  blocks: readonly SourceBlockGeometry[],
): SentencePlacement[] {
  const total = sentences.reduce((sum, sentence) => sum + sentence.length, 0);
  const joined = blocks.reduce((sum, source) => sum + source.text.length + 1, -1);
  if (total <= 0 || joined <= 0) return [];
  const before = sentences.slice(0, index).reduce((sum, sentence) => sum + sentence.length, 0);
  const from = Math.floor((before / total) * joined);
  const to = Math.ceil(((before + (sentences[index]?.length ?? 0)) / total) * joined);
  return placementsFor(spansForRange(blocks, from, to), blocks);
}

// Where each sentence sits on the page, down to the character: the first box
// opens at the sentence's first character and the last closes on its final
// punctuation mark, with one box per visual line in between. Blocks may come
// from consecutive pages, so a sentence crossing a page break keeps a box on
// each page it touches.
export function placeSentences(
  sentences: string[],
  blocks: readonly SourceBlockGeometry[],
): SentencePlacement[][] {
  const source = charTokens(blocks);
  let cursor = 0;
  return sentences.map((sentence, index) => {
    const match = alignSentence(wantedTokens(sentence), source, cursor);
    if (!match) return estimatedPlacements(sentences, index, blocks);
    cursor = match.next;
    return placementsFor(sentenceSpans(source[match.first]!, source[match.last]!, blocks), blocks);
  });
}

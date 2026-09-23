import { NARRATION_POLICY } from "../core/config.ts";
import type {
  DocumentAnalysis,
  DocumentBlock,
  DocumentElement,
  DocumentBlockType,
  DocumentHints,
  ExtractedPage,
  NarrationSegment,
  NarrationSegmentType,
  ReadingProfile,
} from "../core/types.ts";
import { analyzeDocument } from "../document/analyzer.ts";
import {
  classifyGroup,
  collectHints,
  isBoilerplatePage,
  ordinalListPrefix,
  stripCitations,
} from "./cleanup.ts";
import {
  mapSentenceBounds,
  mapSentenceLineIndexes,
  placeSentences,
  type SentencePlacement,
} from "./highlight-geometry.ts";
import { normalizeText } from "./normalizer.ts";
import {
  dehyphenate,
  groupLines,
  groupParagraphs,
  type ParagraphGroup,
  type TextLine,
} from "./paragraph-builder.ts";
import { orderBlocks, orderBlocksSimply } from "./reading-order.ts";
import { splitSentences } from "./segmenter.ts";
import { detectTables, type DetectedTable } from "./table-detector.ts";
import { AUDIOBOOK_READING_PROFILE, decideReadingAction } from "./reading-profile.ts";

export interface CompileResult {
  segments: NarrationSegment[];
  hints: DocumentHints;
}

export interface DocumentCompileResult {
  segments: NarrationSegment[];
  analysis: DocumentAnalysis;
}

function segmentType(type: string): NarrationSegmentType {
  if (type === "title") return "title";
  if (type === "heading") return "heading";
  if (type === "list-item") return "list";
  if (type === "caption") return "caption";
  return "paragraph";
}

function listSpoken(original: string): string {
  const mapped = ordinalListPrefix(original);
  return mapped ? mapped.spoken : original;
}

function normalizeHeadingKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function spokenCell(cell: string): string {
  return normalizeText(stripCitations(cell));
}

function tableRowSegments(
  table: DetectedTable,
  page: ExtractedPage,
  order: number,
): { segments: NarrationSegment[]; nextOrder: number } {
  const segments: NarrationSegment[] = [];
  let next = order;
  for (const [rowIndex, row] of table.rows.entries()) {
    const spokenCells = row.cells.map(spokenCell).filter(Boolean);
    if (spokenCells.length === 0) continue;
    const spokenText = `${spokenCells.join(", ")}.`;
    const originalText = row.cells.join(", ");
    const line = row.sourceLines[0];
    segments.push({
      id: `${page.documentId}-p${page.page}-s${next}`,
      documentId: page.documentId,
      page: page.page,
      type: "table-row",
      originalText,
      spokenText,
      sourceBlockIds: line ? line.blocks.map((block) => block.id) : [],
      bounds: line ? [line.bounds] : [],
      order: next,
      paragraphId: `${page.documentId}-p${page.page}-table${table.firstLineIndex}-r${rowIndex}`,
      speech: { pauseBeforeMs: 0, pauseAfterMs: 80 },
    });
    next += 1;
  }
  return { segments, nextOrder: next };
}

function typeForGroup(
  group: ParagraphGroup,
  all: ParagraphGroup[],
  hints: DocumentHints,
): DocumentBlockType {
  return classifyGroup(group, all, hints);
}

function headingIsDuplicate(type: DocumentBlockType, text: string, hints: DocumentHints): boolean {
  if (type !== "heading" && type !== "title") return false;
  const key = normalizeHeadingKey(text);
  if (key && key === hints.lastHeading) return true;
  hints.lastHeading = key || hints.lastHeading;
  return false;
}

function narrateGroup(
  group: ParagraphGroup,
  page: ExtractedPage,
  type: DocumentBlockType,
  order: number,
  chunkIndex: number,
  groupIndex: number,
): NarrationSegment[] {
  const originalText = group.text.trim();
  const cleaned = type === "list-item"
    ? listSpoken(stripCitations(originalText))
    : stripCitations(originalText);
  if (originalText.length < 2 || !cleaned) return [];

  const sentences = splitSentences(cleaned);
  const sourceLineGeometry = group.sourceLines.map((line) => ({
    text: line.text,
    bounds: line.bounds,
  }));
  const sentenceBounds = mapSentenceBounds(sentences, sourceLineGeometry);
  const sentenceLineIndexes = mapSentenceLineIndexes(sentences, sourceLineGeometry);
  const paragraphId = `${page.documentId}-p${page.page}-c${chunkIndex}-g${groupIndex}`;
  const segments: NarrationSegment[] = [];

  for (const [sentenceIndex, sentence] of sentences.entries()) {
    const spoken = normalizeText(sentence);
    if (!spoken) continue;
    const heading = type === "title" || type === "heading";
    const ownLines = sentenceLineIndexes[sentenceIndex] ?? [];
    const sourceBlockIds = ownLines.length > 0
      ? ownLines.flatMap((lineIndex) => group.sourceLines[lineIndex]?.blocks.map((block) => block.id) ?? [])
      : group.blocks.map((block) => block.id);
    const ownBounds = sentenceBounds[sentenceIndex] ?? [];
    segments.push({
      id: `${page.documentId}-p${page.page}-s${order + segments.length}`,
      documentId: page.documentId,
      page: page.page,
      type: segmentType(type),
      originalText: sentence,
      spokenText: spoken,
      sourceBlockIds,
      bounds: ownBounds.length > 0 ? ownBounds : group.bounds,
      order: order + segments.length,
      paragraphId,
      speech: {
        pauseBeforeMs: heading || order === 0 ? 180 : 0,
        pauseAfterMs: heading ? 280 : 80,
      },
    });
  }
  return segments;
}

function compileProseChunk(
  chunkLines: TextLine[],
  page: ExtractedPage,
  hints: DocumentHints,
  order: number,
  chunkIndex: number,
): { segments: NarrationSegment[]; nextOrder: number } {
  const groups = groupParagraphs(chunkLines);
  const segments: NarrationSegment[] = [];
  let skippedReference = false;
  let next = order;

  for (const [index, group] of groups.entries()) {
    const type = typeForGroup(group, groups, hints);
    if (type === "reference") skippedReference = true;
    if (skippedReference && type !== "heading" && type !== "title") continue;

    const policy = NARRATION_POLICY[type] ?? "read";
    if (policy === "skip") continue;

    const originalText = group.text.trim();
    if (originalText.length < 2) continue;
    if (headingIsDuplicate(type, originalText, hints)) continue;
    const nextSegments = narrateGroup(group, page, type, next, chunkIndex, index);
    segments.push(...nextSegments);
    next += nextSegments.length;
  }

  return { segments, nextOrder: next };
}

export function compilePage(
  page: ExtractedPage,
  hints: DocumentHints = { headerTexts: [], footerTexts: [], lastHeading: null },
): CompileResult {
  const columnOrdered = orderBlocks(page.blocks);
  const probeLines = groupLines(columnOrdered);
  const hasTable = detectTables(probeLines).length > 0;

  const lines = hasTable ? groupLines(orderBlocksSimply(page.blocks)) : probeLines;
  const tables = hasTable ? detectTables(lines) : [];

  const allGroups = groupParagraphs(lines);
  const nextHints = collectHints(allGroups, hints);

  if (isBoilerplatePage(allGroups)) {
    return { segments: [], hints: nextHints };
  }

  // A repeated header/footer is only recognizable once it has appeared on a
  // PRIOR page - classifying against nextHints (which already folds in this
  // page's own lines) makes a line match itself the first time it occurs and
  // silently skips content that was never actually a repeat. lastHeading is
  // different: it is meant to update live as headings are read within this
  // same page, so it is shared with nextHints rather than frozen like this.
  const classifyHints: DocumentHints = {
    headerTexts: hints.headerTexts,
    footerTexts: hints.footerTexts,
    get lastHeading() {
      return nextHints.lastHeading;
    },
    set lastHeading(value) {
      nextHints.lastHeading = value;
    },
  };

  const segments: NarrationSegment[] = [];
  let order = 0;
  let cursor = 0;
  let chunkIndex = 0;

  for (const table of tables) {
    const proseLines = lines.slice(cursor, table.firstLineIndex);
    if (proseLines.length > 0) {
      const result = compileProseChunk(proseLines, page, classifyHints, order, chunkIndex);
      segments.push(...result.segments);
      order = result.nextOrder;
      chunkIndex += 1;
    }
    const tableResult = tableRowSegments(table, page, order);
    segments.push(...tableResult.segments);
    order = tableResult.nextOrder;
    cursor = table.lastLineIndex + 1;
  }

  const trailingLines = lines.slice(cursor);
  if (trailingLines.length > 0) {
    const result = compileProseChunk(trailingLines, page, classifyHints, order, chunkIndex);
    segments.push(...result.segments);
  }

  return { segments, hints: nextHints };
}

export function processPage(
  page: ExtractedPage,
  hints?: DocumentHints,
): Promise<NarrationSegment[]> {
  return Promise.resolve(compilePage(page, hints).segments);
}

function narrationTypeForElement(element: DocumentElement): NarrationSegmentType {
  return segmentType(element.role);
}

// Consecutive narrated elements that are really one piece of prose: a
// paragraph cut off by a page turn mid-sentence continues in the first
// paragraph of the next page, and the two must be spoken (and highlighted)
// as one sentence rather than two fragments.
interface NarrationRun {
  elements: DocumentElement[];
  text: string;
}

const TERMINAL_PUNCTUATION = /[.!?…]["'”’)\]]*$/u;

function continuesOnNextPage(previous: DocumentElement, next: DocumentElement): boolean {
  if (previous.role !== "paragraph" || next.role !== "paragraph") return false;
  if (next.page !== previous.page + 1) return false;
  const before = previous.text.trim();
  const after = next.text.trim();
  if (!before || !after || TERMINAL_PUNCTUATION.test(before)) return false;
  return /^\p{Ll}/u.test(after) || /[,;:\-–—]$/u.test(before);
}

function narrationRuns(elements: DocumentElement[]): NarrationRun[] {
  const runs: NarrationRun[] = [];
  for (const element of elements) {
    const last = runs.at(-1);
    const tail = last?.elements.at(-1);
    if (last && tail && continuesOnNextPage(tail, element)) {
      last.elements.push(element);
      last.text = dehyphenate(last.text.trim(), element.text.trim());
      continue;
    }
    runs.push({ elements: [element], text: element.text });
  }
  return runs;
}

function splitByPage(
  placements: SentencePlacement[],
  fallbackPage: number,
): Pick<NarrationSegment, "page" | "bounds" | "continuedOn"> {
  const page = placements[0]?.page ?? fallbackPage;
  const bounds = placements.filter((item) => item.page === page).map((item) => item.bounds);
  const rest = placements.filter((item) => item.page !== page);
  const nextPage = rest[0]?.page;
  if (nextPage === undefined) return { page, bounds };
  return {
    page,
    bounds,
    continuedOn: {
      page: nextPage,
      bounds: rest.filter((item) => item.page === nextPage).map((item) => item.bounds),
    },
  };
}

function segmentsForRun(
  run: NarrationRun,
  documentId: string,
  startOrder: number,
  includeInlineCitations: boolean,
  blocksById: ReadonlyMap<string, DocumentBlock>,
): NarrationSegment[] {
  const element = run.elements[0]!;
  const originalText = includeInlineCitations ? run.text : stripCitations(run.text);
  const sentences = splitSentences(originalText);
  const sourceGeometry = run.elements.flatMap((item) =>
    item.sourceBlockIds.flatMap((id) => {
      const source = blocksById.get(id);
      return source ? [source] : [];
    }),
  );
  const placements = placeSentences(sentences, sourceGeometry);
  return sentences.flatMap((sentence, index) => {
    const spokenText = normalizeText(sentence);
    if (!spokenText) return [];
    const heading = element.role === "heading" || element.role === "title";
    const own = placements[index] ?? [];
    const geometry = own.length > 0
      ? splitByPage(own, element.page)
      : { page: element.page, bounds: element.bounds };
    return [{
      // Keyed to the run's own first source block, never to a running count:
      // recompiling another page (OCR arriving, a profile change) must not
      // shift which sentence a saved position or the live highlight names.
      id: `${documentId}-${element.sourceBlockIds[0] ?? element.id}-s${index}`,
      documentId,
      ...geometry,
      type: narrationTypeForElement(element),
      originalText: sentence,
      spokenText,
      sourceBlockIds: own.length > 0
        ? [...new Set(own.flatMap((placement) => placement.blockIds))]
        : element.sourceBlockIds,
      order: startOrder + index,
      paragraphId: element.id,
      speech: {
        pauseBeforeMs: heading ? 180 : 0,
        pauseAfterMs: heading ? 280 : 80,
      },
    } satisfies NarrationSegment];
  });
}

export function compileDocument(
  pages: ExtractedPage[],
  profile: ReadingProfile = AUDIOBOOK_READING_PROFILE,
): DocumentCompileResult {
  const analysis = analyzeDocument(pages);
  const blocksById = new Map(pages.flatMap((page) => page.blocks.map((item) => [item.id, item] as const)));
  const narrated = analysis.elements.filter(
    (element) => decideReadingAction(element, profile) === "inline",
  );
  const segments: NarrationSegment[] = [];
  for (const run of narrationRuns(narrated)) {
    segments.push(...segmentsForRun(
      run,
      analysis.documentId,
      segments.length,
      profile.includeInlineCitations ?? false,
      blocksById,
    ));
  }
  return { segments, analysis };
}

import type {
  ClassificationEvidence,
  DocumentAnalysis,
  DocumentElement,
  DocumentSection,
  ElementRole,
  ExtractedPage,
} from "../core/types.ts";
import { isBoilerplatePage } from "../narration/cleanup.ts";
import {
  groupLines,
  groupParagraphs,
  type ParagraphGroup,
} from "../narration/paragraph-builder.ts";
import { orderBlocks, orderBlocksSimply } from "../narration/reading-order.ts";
import { detectTables, type DetectedTable } from "../narration/table-detector.ts";
import { buildDocumentProfile, type DocumentProfile } from "./document-profile.ts";
import { markContentsPages, markMatterSections } from "./matter-classifier.ts";
import {
  applyLayoutVote,
  NO_AMBIGUITY_CLASSIFIER,
  type AmbiguousElementClassifier,
} from "./ambiguous-classifier.ts";

interface RoleDecision {
  role: ElementRole;
  roleConfidence: number;
  omissionConfidence: number;
  evidence: ClassificationEvidence[];
  headingLevel?: number;
}

const PRIMARY_NARRATIVE_ROLES = new Set<ElementRole>([
  "title",
  "heading",
  "paragraph",
  "list-item",
  "quote",
  "code",
  "unknown",
]);

function numberedHeadingDepth(text: string, sizeRatio: number): number | null {
  if (sizeRatio < 1.08 || text.length > 100 || /[.!?]$/.test(text)) return null;
  const match = text.match(/^(?:chapter\s+)?(\d+(?:\.\d+)*)(?:[.):])?\s+\S/i);
  if (!match?.[1]) return null;
  return Math.min(match[1].split(".").length, 6);
}

function groupDecision(group: ParagraphGroup, profile: DocumentProfile): RoleDecision {
  const text = group.text.trim();
  const bottom = Math.max(...group.bounds.map((box) => box.y + box.height));
  const sizeRatio = group.fontSize / Math.max(profile.bodyFontSize, 0.001);
  if (/^(?:references|bibliography|works cited)$/i.test(text)) {
    return {
      ...decision("reference", 0.94, 0.84, "lexical-shape", "reference-section label"),
      headingLevel: 1,
    };
  }
  if (/^(?:note|tip|warning|important|remember)\s*[:—-]/i.test(text)) {
    return {
      role: "callout",
      roleConfidence: 0.76,
      omissionConfidence: 0.62,
      evidence: [
        { signal: "lexical-shape", weight: 0.55, detail: "callout-style label" },
        { signal: "neighbor-context", weight: 0.45, detail: "short standalone text block" },
      ],
    };
  }
  if (/^(?:fig(?:ure)?\.?|table)\s*[\dIVXLC]+\b/i.test(text)) {
    return decision("caption", 0.92, 0.82, "lexical-shape", "caption label");
  }
  const numberedDepth = numberedHeadingDepth(text, sizeRatio);
  if (numberedDepth !== null) {
    return {
      ...decision("heading", 0.9, 0, "document-structure", "numbered heading structure"),
      headingLevel: numberedDepth,
    };
  }
  if (sizeRatio < 0.78 && bottom > 0.72 && /^(?:\d+|[*†‡])\s*\S/.test(text)) {
    return {
      role: "footnote",
      roleConfidence: 0.9,
      omissionConfidence: 0.84,
      evidence: [
        { signal: "typography", weight: 0.45, detail: "smaller than document body text" },
        { signal: "position", weight: 0.3, detail: "lower page region" },
        { signal: "lexical-shape", weight: 0.25, detail: "footnote marker prefix" },
      ],
    };
  }
  if (/^(?:[-•●▪]|\d{1,2}[.)]|[A-Za-z][.)])\s+\S/.test(text)) {
    return decision("list-item", 0.94, 0, "lexical-shape", "list marker prefix");
  }
  if (/^\[(?:\d+(?:[,;–-]\s*\d+)*)\]$/.test(text)) {
    return decision("citation", 0.9, 0.82, "lexical-shape", "standalone source marker");
  }
  if (looksLikeFormula(text)) {
    return decision("formula", 0.82, 0.7, "lexical-shape", "dense mathematical notation");
  }
  if (sizeRatio >= 1.5 && text.length < 120 && !/[.!?]$/.test(text)) {
    return { ...decision("title", 0.9, 0, "typography", "large display text"), headingLevel: 1 };
  }
  if (sizeRatio >= 1.15 && text.length < 100 && !/[.!?]$/.test(text)) {
    return {
      ...decision("heading", 0.86, 0, "typography", "short enlarged line"),
      headingLevel: 2,
    };
  }
  return decision("paragraph", 0.82, 0, "neighbor-context", "prose flow");
}

function decision(
  role: ElementRole,
  roleConfidence: number,
  omissionConfidence: number,
  signal: ClassificationEvidence["signal"],
  detail: string,
): RoleDecision {
  return {
    role,
    roleConfidence,
    omissionConfidence,
    evidence: [{ signal, weight: 1, detail }],
  };
}

function looksLikeFormula(text: string): boolean {
  if (text.length < 3) return false;
  const mathMarks = text.match(/[=+×÷∑∫√^_<>≤≥]/g)?.length ?? 0;
  return mathMarks >= 2 && mathMarks / text.length >= 0.08;
}

function sourceFor(group: ParagraphGroup): DocumentElement["source"] {
  const sources = new Set(group.blocks.map((block) => block.source));
  if (sources.size > 1) return "mixed";
  return group.blocks[0]?.source ?? "pdf-text";
}

function suppliedRole(group: ParagraphGroup): RoleDecision | undefined {
  const roles = new Set(group.blocks.map((block) => block.type).filter(Boolean));
  if (roles.size !== 1) return undefined;
  const role = [...roles][0];
  if (!role || role === "unknown") return undefined;
  if (!group.blocks.every((block) => block.type === role)) return undefined;
  const layoutVotes = group.blocks
    .map((block) => block.layout)
    .filter((vote) => vote?.role === role);
  if (layoutVotes.length > 0) {
    const confidence = Math.min(...layoutVotes.map((vote) => vote?.confidence ?? 0));
    return {
      role,
      roleConfidence: confidence,
      omissionConfidence: 0,
      evidence: [
        {
          signal: "layout-model",
          weight: confidence,
          detail: `${layoutVotes[0]?.modelId ?? "layout model"} classified ${role}`,
        },
      ],
    };
  }
  const omissionConfidence = ["caption", "sidebar", "callout", "table", "footnote"].includes(role)
    ? 0.84
    : 0;
  return {
    role,
    roleConfidence: Math.min(...group.blocks.map((block) => block.confidence ?? 0.9)),
    omissionConfidence,
    evidence: [
      {
        signal: "source-confidence",
        weight: 1,
        detail: "role supplied by OCR or layout classifier",
      },
    ],
  };
}

function layoutRegionElements(
  page: ExtractedPage,
  startOrder: number,
  existing: DocumentElement[],
): DocumentElement[] {
  return (page.layoutRegions ?? [])
    .filter((region) => region.confidence >= 0.65)
    .sort((left, right) => left.bounds.y - right.bounds.y)
    .map((region, index) => {
      const prior = existing
        .filter((element) => topOf(element) <= region.bounds.y)
        .sort((left, right) => topOf(right) - topOf(left))[0];
      const next = existing
        .filter((element) => topOf(element) > region.bounds.y)
        .sort((left, right) => topOf(left) - topOf(right))[0];
      const readingOrder =
        prior && next
          ? (prior.readingOrder + next.readingOrder) / 2
          : prior
            ? prior.readingOrder + 0.25 + index / 1_000
            : next
              ? next.readingOrder - 0.25 + index / 1_000
              : startOrder + index;
      return {
        id: `layout-${page.page}-${region.classId}-${index}`,
        page: page.page,
        text: "",
        bounds: [region.bounds],
        sourceBlockIds: [],
        source: "mixed",
        role: region.role,
        roleConfidence: region.confidence,
        omissionConfidence: 0,
        evidence: [
          {
            signal: "layout-model",
            weight: region.confidence,
            detail: `${region.modelId} detected a non-text ${region.role} region`,
          },
        ],
        relationships: prior
          ? [
              {
                type: "reading-order-after" as const,
                targetId: prior.id,
                confidence: region.confidence,
              },
            ]
          : [],
        readingOrder,
      };
    });
}

function elementFromGroup(
  group: ParagraphGroup,
  page: number,
  readingOrder: number,
  profile: DocumentProfile,
  forcedRole?: RoleDecision,
  classifier: AmbiguousElementClassifier = NO_AMBIGUITY_CLASSIFIER,
): DocumentElement {
  const role = forcedRole ?? suppliedRole(group) ?? groupDecision(group, profile);
  const ocrConfidence = Math.min(
    ...group.blocks
      .filter((block) => block.source !== "pdf-text")
      .map((block) => block.confidence ?? 0.5),
    1,
  );
  const hasOcrWitness = group.blocks.some((block) => block.source !== "pdf-text");
  const evidence = hasOcrWitness
    ? [
        ...role.evidence,
        {
          signal: "source-confidence" as const,
          weight: 1,
          detail: `OCR witness confidence ${ocrConfidence.toFixed(2)}`,
        },
      ]
    : role.evidence;
  const sourceIds = group.blocks.map((block) => block.id);
  const element: DocumentElement = {
    id: `element-${sourceIds.join("-")}`,
    page,
    text: group.text,
    bounds: group.bounds,
    sourceBlockIds: sourceIds,
    source: sourceFor(group),
    role: role.role,
    roleConfidence: hasOcrWitness
      ? Math.min(role.roleConfidence, ocrConfidence)
      : role.roleConfidence,
    omissionConfidence: hasOcrWitness
      ? Math.min(role.omissionConfidence, ocrConfidence)
      : role.omissionConfidence,
    evidence,
    relationships: [],
    readingOrder,
    headingLevel: role.headingLevel,
    fontSize: group.fontSize,
    fontName: group.blocks[0]?.fontName,
  };
  return applyLayoutVote(element, classifier);
}

function profileElement(
  block: ExtractedPage["blocks"][number],
  profile: DocumentProfile,
  readingOrder: number,
): DocumentElement | null {
  const role = profile.decisions[block.id];
  if (!role) return null;
  return {
    id: block.id,
    page: block.page,
    text: block.text,
    bounds: [block.bounds],
    sourceBlockIds: [block.id],
    source: block.source,
    role: role.role,
    roleConfidence: role.roleConfidence,
    omissionConfidence: role.omissionConfidence,
    evidence: role.evidence,
    relationships: [],
    readingOrder,
    fontSize: block.fontSize,
    fontName: block.fontName,
  };
}

function tableElement(table: DetectedTable, page: number, readingOrder: number): DocumentElement {
  return {
    id: `table-${page}-${table.blocks[0]?.id ?? readingOrder}`,
    page,
    text: table.rows.map((row) => row.cells.join(" | ")).join("\n"),
    bounds: table.rows.flatMap((row) => row.sourceLines.map((line) => line.bounds)),
    sourceBlockIds: table.blocks.map((block) => block.id),
    source:
      new Set(table.blocks.map((block) => block.source)).size > 1
        ? "mixed"
        : (table.blocks[0]?.source ?? "pdf-text"),
    role: "table",
    roleConfidence: 0.94,
    omissionConfidence: 0.86,
    evidence: [
      { signal: "position", weight: 0.55, detail: "repeated aligned column bands" },
      { signal: "document-structure", weight: 0.45, detail: "three or more tabular rows" },
    ],
    relationships: [],
    readingOrder,
  };
}

function analyzePage(
  page: ExtractedPage,
  profile: DocumentProfile,
  startOrder: number,
  classifier: AmbiguousElementClassifier,
): DocumentElement[] {
  const ordered = orderBlocks(page.blocks);
  const blockOrder = new Map(ordered.map((block, index) => [block.id, index]));
  const firstBlockOrder = (ids: string[]): number =>
    Math.min(...ids.map((id) => blockOrder.get(id) ?? ordered.length));
  const classified = ordered.flatMap((block, index) => {
    const element = profileElement(block, profile, startOrder + index);
    return element ? [element] : [];
  });
  const content = ordered.filter((block) => !profile.decisions[block.id]);
  const tableLines = groupLines(orderBlocksSimply(content), { preserveFolio: true });
  const tables = detectTables(tableLines);
  const tableBlockIds = new Set(tables.flatMap((table) => table.blocks.map((block) => block.id)));
  const proseBlocks = content.filter((block) => !tableBlockIds.has(block.id));
  const groups = groupParagraphs(groupLines(orderBlocks(proseBlocks), { preserveFolio: true }));
  const metadata = isBoilerplatePage(groups);
  const groupElements = groups.map((group) => {
    const forced = metadata
      ? decision("metadata", 0.94, 0.9, "document-structure", "publishing metadata page")
      : undefined;
    return elementFromGroup(
      group,
      page.page,
      startOrder + firstBlockOrder(group.blocks.map((block) => block.id)),
      profile,
      forced,
      classifier,
    );
  });
  const tableElements = tables.map((table) =>
    tableElement(
      table,
      page.page,
      startOrder + firstBlockOrder(table.blocks.map((block) => block.id)),
    ),
  );
  const existingElements = [...classified, ...groupElements, ...tableElements];
  const regionElements = layoutRegionElements(
    page,
    startOrder + ordered.length + groups.length,
    existingElements,
  );
  return [...classified, ...groupElements, ...tableElements, ...regionElements].sort(
    (left, right) => left.readingOrder - right.readingOrder,
  );
}

function buildSections(elements: DocumentElement[]): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const stack: DocumentSection[] = [];
  for (const element of elements) {
    const isHeading =
      element.role === "title" ||
      element.role === "heading" ||
      (element.role === "reference" && element.headingLevel !== undefined);
    if (!isHeading) continue;
    const level = element.headingLevel ?? 2;
    while (stack.at(-1) && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
    const section: DocumentSection = {
      id: `section-${element.id}`,
      title: element.text,
      level,
      page: element.page,
      headingElementId: element.id,
      parentId: stack.at(-1)?.id,
    };
    sections.push(section);
    stack.push(section);
  }
  return sections;
}

function linkElementsToSections(elements: DocumentElement[], sections: DocumentSection[]): void {
  const sectionsByHeading = new Map(sections.map((section) => [section.headingElementId, section]));
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  const stack: DocumentSection[] = [];
  for (const element of elements) {
    const section = sectionsByHeading.get(element.id);
    if (section) {
      while (stack.at(-1) && (stack.at(-1)?.level ?? 0) >= section.level) stack.pop();
      stack.push(section);
      continue;
    }
    const parent = stack.at(-1);
    if (!parent) continue;
    const heading = elementsById.get(parent.headingElementId);
    element.relationships.push({
      type: "belongs-to-section",
      targetId: parent.id,
      confidence: heading?.roleConfidence ?? 0.5,
    });
  }
}

function topOf(element: DocumentElement): number {
  return Math.min(...element.bounds.map((box) => box.y));
}

function horizontalBounds(element: DocumentElement): { left: number; right: number } {
  return {
    left: Math.min(...element.bounds.map((box) => box.x)),
    right: Math.max(...element.bounds.map((box) => box.x + box.width)),
  };
}

function markSidebars(elements: DocumentElement[]): void {
  const pages = new Map<number, DocumentElement[]>();
  for (const element of elements) {
    pages.set(element.page, [...(pages.get(element.page) ?? []), element]);
  }
  for (const pageElements of pages.values()) {
    const mainFlow = pageElements.filter((element) => {
      const bounds = horizontalBounds(element);
      return element.role === "paragraph" && bounds.right - bounds.left >= 0.4;
    });
    if (mainFlow.length < 2) continue;
    const candidates = pageElements.filter((element) => {
      if (element.role !== "paragraph") return false;
      const bounds = horizontalBounds(element);
      const width = bounds.right - bounds.left;
      return width <= 0.24 && (bounds.left <= 0.08 || bounds.right >= 0.76);
    });
    if (candidates.length < 2) continue;
    for (const candidate of candidates) {
      candidate.role = "sidebar";
      candidate.roleConfidence = 0.76;
      candidate.omissionConfidence = 0.68;
      candidate.evidence.push(
        { signal: "position", weight: 0.55, detail: "narrow text region beside the main flow" },
        {
          signal: "neighbor-context",
          weight: 0.45,
          detail: "multiple aligned blocks form a side region",
        },
      );
    }
  }
}

function markFootnoteContinuations(elements: DocumentElement[]): void {
  const footnotes = elements.filter((element) => element.role === "footnote");
  for (const element of elements) {
    if (element.role !== "paragraph" || topOf(element) > 0.15) continue;
    const previous = [...footnotes]
      .reverse()
      .find(
        (candidate) => candidate.page === element.page - 1 && similarFontSize(candidate, element),
      );
    if (!previous) continue;
    element.role = "footnote";
    element.roleConfidence = 0.84;
    element.omissionConfidence = 0.8;
    element.evidence = [
      { signal: "neighbor-context", weight: 0.5, detail: "footnote on prior page" },
      { signal: "position", weight: 0.25, detail: "starts at top of following page" },
      { signal: "typography", weight: 0.25, detail: "matches prior footnote size" },
    ];
    element.relationships.push({
      type: "continues",
      targetId: previous.id,
      confidence: 0.82,
    });
  }
}

function isReferenceHeading(element: DocumentElement): boolean {
  return (
    element.role === "reference" &&
    /^(?:references|bibliography|works cited)$/i.test(element.text.trim())
  );
}

function markReferenceSection(elements: DocumentElement[]): void {
  let active = false;
  for (const element of elements) {
    if (isReferenceHeading(element)) {
      active = true;
      continue;
    }
    if (!active) continue;
    if ((element.role === "heading" || element.role === "title") && element.headingLevel === 1) {
      active = false;
      continue;
    }
    if (element.role !== "paragraph") continue;
    element.role = "reference";
    element.roleConfidence = Math.max(element.roleConfidence, 0.84);
    element.omissionConfidence = Math.max(element.omissionConfidence, 0.82);
    element.evidence.push({
      signal: "document-structure",
      weight: 0.82,
      detail: "element follows a reference-section heading",
    });
  }
}

function similarFontSize(left: DocumentElement, right: DocumentElement): boolean {
  const leftSize = left.fontSize ?? 0;
  const rightSize = right.fontSize ?? 0;
  if (leftSize <= 0 || rightSize <= 0) return false;
  return Math.abs(leftSize - rightSize) / Math.max(leftSize, rightSize) <= 0.2;
}

function linkCaptions(elements: DocumentElement[]): void {
  const tables = elements.filter((element) => element.role === "table");
  for (const caption of elements.filter((element) => element.role === "caption")) {
    const nearby = tables
      .filter((table) => table.page === caption.page)
      .map((table) => ({ table, distance: Math.abs(topOf(table) - topOf(caption)) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearby || nearby.distance > 0.25) continue;
    caption.relationships.push({
      type: "caption-for",
      targetId: nearby.table.id,
      confidence: 0.8,
    });
  }
}

export function analyzeDocument(
  pages: ExtractedPage[],
  classifier: AmbiguousElementClassifier = NO_AMBIGUITY_CLASSIFIER,
): DocumentAnalysis {
  const profile = buildDocumentProfile(pages);
  let readingOrder = 0;
  const elements: DocumentElement[] = [];
  for (const page of [...pages].sort((left, right) => left.page - right.page)) {
    const pageElements = analyzePage(page, profile, readingOrder, classifier);
    elements.push(...pageElements);
    readingOrder += page.blocks.length + pageElements.length;
  }
  markSidebars(elements);
  markFootnoteContinuations(elements);
  markReferenceSection(elements);
  markMatterSections(elements);
  markContentsPages(elements);
  linkCaptions(elements);
  const sections = buildSections(elements);
  linkElementsToSections(elements, sections);
  const nonNarrative = elements.filter((element) => !PRIMARY_NARRATIVE_ROLES.has(element.role));
  const abstentions = elements.flatMap((element) => {
    const modelClassified = element.evidence.some((item) => item.signal === "layout-model");
    if (
      !modelClassified ||
      !element.text ||
      PRIMARY_NARRATIVE_ROLES.has(element.role) ||
      element.omissionConfidence >= 0.8
    )
      return [];
    return [
      `Retained ${element.id}: layout model classified ${element.role} without omission evidence.`,
    ];
  });
  return {
    documentId: pages[0]?.documentId ?? "",
    elements,
    sections,
    nonNarrative,
    diagnostics: [...pages.flatMap((page) => page.diagnostics ?? []), ...abstentions],
  };
}

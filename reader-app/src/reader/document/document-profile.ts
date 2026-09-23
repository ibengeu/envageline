import type {
  ClassificationEvidence,
  DocumentBlock,
  ElementRole,
  ExtractedPage,
} from "../core/types.ts";

export interface ProfileDecision {
  role: ElementRole;
  roleConfidence: number;
  omissionConfidence: number;
  evidence: ClassificationEvidence[];
}

export interface DocumentProfile {
  decisions: Record<string, ProfileDecision>;
  pageCount: number;
  bodyFontSize: number;
}

interface NumberCandidate {
  block: DocumentBlock;
  value: number;
}

function sourceConfidence(block: DocumentBlock): number {
  if (block.source === "pdf-text") return 1;
  return Math.min(1, Math.max(0, block.confidence ?? 0.5));
}

function median(values: number[]): number {
  if (values.length === 0) return 0.02;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0.02;
}

function romanValue(text: string): number | null {
  const roman = text.trim().toUpperCase();
  if (!/^[IVXLCDM]+$/.test(roman)) return null;
  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };
  let total = 0;
  for (let index = 0; index < roman.length; index += 1) {
    const current = values[roman[index] ?? ""] ?? 0;
    const next = values[roman[index + 1] ?? ""] ?? 0;
    total += current < next ? -current : current;
  }
  return total > 0 && toRoman(total) === roman ? total : null;
}

function toRoman(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999) return "";
  const tokens: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let remaining = value;
  let result = "";
  for (const [amount, token] of tokens) {
    while (remaining >= amount) {
      result += token;
      remaining -= amount;
    }
  }
  return result;
}

function pageNumberValue(text: string): number | null {
  const normalized = text.trim().replace(/^page\s+/i, "");
  const numerator = normalized.split("/")[0]?.trim() ?? "";
  if (/^\d{1,6}$/.test(numerator)) return Number(numerator);
  return romanValue(numerator);
}

function nearSamePosition(left: DocumentBlock, right: DocumentBlock): boolean {
  return (
    Math.abs(left.bounds.x - right.bounds.x) <= 0.08 &&
    Math.abs(left.bounds.y - right.bounds.y) <= 0.05
  );
}

function followsPageSequence(
  candidate: NumberCandidate,
  candidates: NumberCandidate[],
): boolean {
  return candidates.some((other) => {
    if (other.block.id === candidate.block.id) return false;
    const pageDelta = other.block.page - candidate.block.page;
    if (pageDelta === 0 || Math.abs(pageDelta) > 3) return false;
    return other.value - candidate.value === pageDelta &&
      nearSamePosition(candidate.block, other.block);
  });
}

function normalizeTemplate(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^\p{L}#]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inRunningBand(block: DocumentBlock): boolean {
  const bottom = block.bounds.y + block.bounds.height;
  return block.bounds.y < 0.2 || bottom > 0.88;
}

function addPageNumberDecisions(
  blocks: DocumentBlock[],
  decisions: Record<string, ProfileDecision>,
): void {
  const candidates = blocks.flatMap((block) => {
    if (!inRunningBand(block)) return [];
    const value = pageNumberValue(block.text);
    return value === null ? [] : [{ block, value }];
  });
  for (const candidate of candidates) {
    const matching = candidates.filter((other) =>
      other.block.id !== candidate.block.id &&
      other.value - candidate.value === other.block.page - candidate.block.page &&
      nearSamePosition(candidate.block, other.block),
    );
    if (!followsPageSequence(candidate, candidates) || matching.length === 0) continue;
    const witnessConfidence = Math.min(
      sourceConfidence(candidate.block),
      ...matching.map((match) => sourceConfidence(match.block)),
    );
    decisions[candidate.block.id] = {
      role: "page-number",
      roleConfidence: 0.98 * witnessConfidence,
      omissionConfidence: 0.97 * witnessConfidence,
      evidence: [
        { signal: "lexical-shape", weight: 0.45, detail: "valid page-number form" },
        { signal: "sequence", weight: 0.55, detail: "value follows physical page sequence" },
      ],
    };
  }
}

function repeatedTemplateIds(blocks: DocumentBlock[], bodyFontSize: number): Set<string> {
  const byKey = new Map<string, DocumentBlock[]>();
  for (const block of blocks) {
    if (!inRunningBand(block) || pageNumberValue(block.text) !== null) continue;
    const fontSize = block.fontSize ?? block.bounds.height;
    if (fontSize > bodyFontSize * 1.25) continue;
    const key = normalizeTemplate(block.text);
    if (key.length < 3 || key.length > 100) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), block]);
  }
  const repeated = new Set<string>();
  for (const matches of byKey.values()) {
    const pages = new Set(matches.map((block) => block.page));
    if (pages.size < 2 || !hasPositionCluster(matches)) continue;
    for (const match of matches) repeated.add(match.id);
  }
  return repeated;
}

function hasPositionCluster(blocks: DocumentBlock[]): boolean {
  return blocks.some((block, index) =>
    blocks.slice(index + 1).some((other) => nearSamePosition(block, other)),
  );
}

function addRunningDecisions(
  blocks: DocumentBlock[],
  bodyFontSize: number,
  decisions: Record<string, ProfileDecision>,
): void {
  const repeated = repeatedTemplateIds(blocks, bodyFontSize);
  for (const block of blocks) {
    if (!repeated.has(block.id) || decisions[block.id]) continue;
    const role = block.bounds.y < 0.5 ? "header" : "footer";
    const repeatedConfidence = Math.min(...blocks.filter((item) => repeated.has(item.id))
      .map(sourceConfidence));
    decisions[block.id] = {
      role,
      roleConfidence: 0.94 * repeatedConfidence,
      omissionConfidence: 0.9 * repeatedConfidence,
      evidence: [
        { signal: "repetition", weight: 0.6, detail: "same template repeats on multiple pages" },
        { signal: "position", weight: 0.4, detail: `stable ${role} band position` },
      ],
    };
  }
}

function addWatermarkDecisions(
  blocks: DocumentBlock[],
  bodyFontSize: number,
  decisions: Record<string, ProfileDecision>,
): void {
  const byKey = new Map<string, DocumentBlock[]>();
  for (const block of blocks) {
    const center = block.bounds.x + block.bounds.width / 2;
    const small = (block.fontSize ?? block.bounds.height) < bodyFontSize * 0.7;
    if (inRunningBand(block) || center < 0.35 || center > 0.65 || !small) continue;
    const key = normalizeTemplate(block.text);
    if (key.length < 3 || key.length > 80) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), block]);
  }
  for (const matches of byKey.values()) {
    if (new Set(matches.map((block) => block.page)).size < 3) continue;
    const witnessConfidence = Math.min(...matches.map(sourceConfidence));
    for (const block of matches) {
      if (decisions[block.id]) continue;
      decisions[block.id] = {
        role: "watermark",
        roleConfidence: 0.86 * witnessConfidence,
        omissionConfidence: 0.84 * witnessConfidence,
        evidence: [
          { signal: "repetition", weight: 0.45, detail: "same centered text repeats across pages" },
          { signal: "position", weight: 0.3, detail: "text is centered outside running bands" },
          { signal: "typography", weight: 0.25, detail: "text is smaller than body text" },
        ],
      };
    }
  }
}

export function buildDocumentProfile(pages: ExtractedPage[]): DocumentProfile {
  const blocks = pages.flatMap((page) => page.blocks);
  const decisions: Record<string, ProfileDecision> = {};
  const bodyBlocks = blocks.filter((block) =>
    block.bounds.y >= 0.18 && block.bounds.y + block.bounds.height <= 0.88,
  );
  const bodyFontSize = median(
    (bodyBlocks.length > 0 ? bodyBlocks : blocks).map(
      (block) => block.fontSize ?? block.bounds.height,
    ),
  );
  addPageNumberDecisions(blocks, decisions);
  addRunningDecisions(blocks, bodyFontSize, decisions);
  addWatermarkDecisions(blocks, bodyFontSize, decisions);
  return {
    decisions,
    pageCount: pages.length,
    bodyFontSize,
  };
}

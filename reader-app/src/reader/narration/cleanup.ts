import { FOOTER_BAND, HEADER_BAND } from "../core/config.ts";
import type { DocumentBlockType, DocumentHints } from "../core/types.ts";
import { isPageNumber, type ParagraphGroup } from "./paragraph-builder.ts";

export { isPageNumber };

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9]+/g, "")
    .replace(/[^\p{L}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inHeaderBand(group: ParagraphGroup): boolean {
  const top = Math.min(...group.bounds.map((box) => box.y));
  return top < HEADER_BAND;
}

function inFooterBand(group: ParagraphGroup): boolean {
  const bottom = Math.max(...group.bounds.map((box) => box.y + box.height));
  return bottom > 1 - FOOTER_BAND;
}

export function classifyGroup(
  group: ParagraphGroup,
  all: ParagraphGroup[],
  hints: DocumentHints,
): DocumentBlockType {
  const text = group.text.trim();
  if (!text) return "unknown";
  if (isPageNumber(text) && (inHeaderBand(group) || inFooterBand(group))) {
    return "page-number";
  }

  const key = normalizeKey(text);
  if (key && inHeaderBand(group) && hints.headerTexts.includes(key)) {
    return "header";
  }
  if (key && inFooterBand(group) && hints.footerTexts.includes(key)) {
    return "footer";
  }

  const median = medianFont(all);
  const small = group.fontSize < median * 0.78;
  if (small && inHeaderBand(group) && text.length < 80) return "header";
  if (small && inFooterBand(group) && text.length < 80) {
    return isPageNumber(text) ? "page-number" : "footer";
  }

  if (
    small &&
    inFooterBand(group) &&
    /^[0-9]+\s+\S/.test(text) &&
    group.fontSize < median * 0.7
  ) {
    return "footnote";
  }

  if (/^(?:references|bibliography|works cited)$/i.test(text)) {
    return "reference";
  }

  if (/^(?:[-•●▪]|[0-9]{1,2}[.)]|[A-Za-z][.)])\s+\S/.test(text)) {
    return "list-item";
  }

  const largest = Math.max(...all.map((item) => item.fontSize));
  if (group.fontSize >= largest * 0.92 && group.fontSize > median * 1.35) {
    return group.bounds[0] && group.bounds[0].y < 0.28 ? "title" : "heading";
  }
  // A ~1.15-1.2x heading/body ratio is ordinary in printed books (this file's
  // own test book uses 12.5pt over 10.5pt, ~1.19x) - too close to body size
  // for a font-size check alone to be reliable, so it's paired with the
  // short-line, no-terminal-punctuation shape a genuine heading also has.
  if (group.fontSize > median * 1.15 && text.length < 90 && !/[.!?]$/.test(text)) {
    return "heading";
  }
  if (/^fig(?:ure)?\.?\s*\d+/i.test(text) || /^table\s+\d+/i.test(text)) {
    return "caption";
  }
  return "paragraph";
}

const BOILERPLATE_SIGNAL_RE =
  /(?:©|copyright\b|all rights reserved\b|isbn\b|published (?:by|as|in)\b|first published\b|library of congress\b|printed in\b|no part of this (?:book|publication)\b|[a-z]+ (?:books?|press|publishing|publishers?) (?:ltd|inc|llc|group)\b)/i;

const LEGAL_NOTICE_RE =
  /(?:work of fiction|resemblance to (?:actual|real) persons|products? of the author'?s imagination|used fictitiously|without (?:the )?(?:prior )?(?:written )?permission|scanning, uploading|registered trademarks?|cover (?:design|art|illustration) by)/i;

// A run-on narrative sentence - a lowercase clause continuing past its own
// line - is the one shape a copyright/imprint page never has, since every
// line there is its own short publisher, address, or rights notice.
const NARRATIVE_FLOW_RE = /[a-z][,;:]?\s+(?:and|but|so|that|which|who|because)\b/i;

// A copyright/imprint page is built almost entirely from short publisher,
// ISBN, and rights-notice lines rather than prose. Any single title uses its
// own publisher's name and address, so this looks at the *shape* shared by
// nearly all such pages - dense boilerplate signals, no narrative sentences -
// instead of matching one publisher's wording.
export function isBoilerplatePage(groups: ParagraphGroup[]): boolean {
  const candidates = groups.filter((group) => group.text.trim().length > 0);
  if (candidates.length < 3) return false;
  const boilerplateLines = candidates.filter((group) =>
    BOILERPLATE_SIGNAL_RE.test(group.text.trim()) || LEGAL_NOTICE_RE.test(group.text),
  );
  // A legal notice ("names, characters, places, and incidents...") reads as
  // a run-on sentence but is itself imprint boilerplate, not narrative.
  const narrative = candidates.filter(
    (group) => NARRATIVE_FLOW_RE.test(group.text) && !LEGAL_NOTICE_RE.test(group.text),
  );
  return boilerplateLines.length / candidates.length >= 0.4 && narrative.length === 0;
}

function medianFont(groups: ParagraphGroup[]): number {
  const sizes = groups.map((group) => group.fontSize).sort((a, b) => a - b);
  if (sizes.length === 0) return 0.02;
  const mid = Math.floor(sizes.length / 2);
  return sizes[mid] ?? 0.02;
}

export function collectHints(
  groups: ParagraphGroup[],
  hints: DocumentHints,
): DocumentHints {
  const next: DocumentHints = {
    headerTexts: [...hints.headerTexts],
    footerTexts: [...hints.footerTexts],
    lastHeading: hints.lastHeading,
  };
  for (const group of groups) {
    const key = normalizeKey(group.text);
    if (!key || key.length < 4) continue;
    if (inHeaderBand(group) && group.text.length < 80) {
      if (!next.headerTexts.includes(key)) next.headerTexts.push(key);
    }
    if (inFooterBand(group) && group.text.length < 80) {
      if (!next.footerTexts.includes(key)) next.footerTexts.push(key);
    }
  }
  return next;
}

const CITATION_NUMERIC = /\[(?:\d+(?:\s*[,;–-]\s*\d+)*)\]/g;
const CITATION_AUTHOR =
  /\((?:[A-Z][A-Za-z-]+(?:\s+(?:et al\.?|& [A-Z][A-Za-z-]+))?,?\s+\d{4}[a-z]?(?:,\s*p+\.?\s*\d+)?)\)/g;
const SUPER_REF = /(?<=\S)[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g;

export function stripCitations(text: string): string {
  return text
    .replace(CITATION_NUMERIC, "")
    .replace(CITATION_AUTHOR, "")
    .replace(SUPER_REF, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function ordinalListPrefix(
  text: string,
): { spoken: string; rest: string } | null {
  const match = text.match(/^(?:([0-9]{1,2})[.)]|[-•●▪])\s+(.*)$/);
  if (!match) return null;
  const rest = match[2] ?? "";
  const n = match[1] ? Number(match[1]) : null;
  if (n && n >= 1 && n <= 20) {
    const words = [
      "First",
      "Second",
      "Third",
      "Fourth",
      "Fifth",
      "Sixth",
      "Seventh",
      "Eighth",
      "Ninth",
      "Tenth",
      "Eleventh",
      "Twelfth",
      "Thirteenth",
      "Fourteenth",
      "Fifteenth",
      "Sixteenth",
      "Seventeenth",
      "Eighteenth",
      "Nineteenth",
      "Twentieth",
    ];
    return { spoken: `${words[n - 1]}, ${rest}`, rest };
  }
  return { spoken: rest, rest };
}

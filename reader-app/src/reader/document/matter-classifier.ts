import type { DocumentElement, ElementRole } from "../core/types.ts";

interface MatterRule {
  role: ElementRole;
  detail: string;
  /** How far past its heading's page the section may run. */
  reach: "own-page" | "contents-entries" | { pages: number };
}

interface MatterHeading extends MatterRule {
  pattern: RegExp;
}

// Front and back matter a listener does not want read as part of the book.
// Keyed on the section's own heading, since the pages under it look like any
// other prose. Introductions, forewords, prologues, and appendices are
// deliberately absent: they are part of the work.
const MATTER_HEADINGS: MatterHeading[] = [
  {
    pattern:
      /^(?:an?\s+)?(?:note|letter|message|word)s?\s+(?:from|by)\s+the\s+(?:publishers?|editors?)\b|^(?:about|from)\s+the\s+publishers?\b/i,
    role: "metadata",
    detail: "publisher's note",
    reach: "own-page",
  },
  {
    pattern: /^(?:table\s+of\s+)?contents$|^index$|^list\s+of\s+(?:illustrations|figures|tables|maps|plates)$/i,
    role: "navigation",
    detail: "table of contents or index",
    reach: "contents-entries",
  },
  {
    pattern:
      /^(?:about\s+the\s+(?:authors?|illustrators?|translators?)|also\s+by\b|(?:other\s+)?(?:books|titles|works)\s+by\b|praise\s+for\b|acknowledge?ments?$|reading\s+group\s+guide|discussion\s+questions|(?:a\s+)?(?:preview|excerpt|sneak\s+peek)\s+(?:of|from)\b|read\s+on\s+for\b)/i,
    role: "back-matter",
    detail: "back-matter",
    reach: { pages: 6 },
  },
];

const CONTENTS_LISTING: MatterRule = {
  role: "navigation",
  detail: "contents listing",
  reach: "own-page",
};

// A contents entry: a short title closed by a page number, optionally after
// dot leaders ("The Harbour . . . . 17"). Entries often merge into a single
// paragraph, so they are counted rather than matched line by line.
const CONTENTS_ENTRY = /(?:(?:\s*\.){2,}\s*|\s+)\d{1,4}(?=\s+[\p{Lu}\d]|\s*$)/gu;
const SENTENCE_BREAK = /[a-z][.!?]["'”’]?\s+\p{Lu}/u;

function contentsEntries(text: string): number {
  const entries = text.match(CONTENTS_ENTRY)?.length ?? 0;
  if (entries === 0 || SENTENCE_BREAK.test(text)) return 0;
  return text.length / entries <= 80 ? entries : 0;
}

function isHeading(element: DocumentElement): boolean {
  return element.role === "title" || element.role === "heading";
}

function matterFor(element: DocumentElement): MatterHeading | null {
  if (!isHeading(element)) return null;
  const heading = element.text.replace(/\s+/g, " ").trim();
  return MATTER_HEADINGS.find((entry) => entry.pattern.test(heading)) ?? null;
}

function markAsMatter(element: DocumentElement, matter: MatterRule): void {
  element.role = matter.role;
  element.roleConfidence = Math.max(element.roleConfidence, 0.9);
  element.omissionConfidence = Math.max(element.omissionConfidence, 0.9);
  element.evidence.push({
    signal: "document-structure",
    weight: 0.9,
    detail: `inside a ${matter.detail} section`,
  });
}

interface ActiveMatter {
  rule: MatterRule;
  page: number;
}

// OWASP A06:2025 Insecure Design - a matter heading with no heading after it
// must not silence the rest of the book, so every section has a bounded reach.
function stillInside(active: ActiveMatter, element: DocumentElement): boolean {
  if (element.page === active.page) return true;
  const { reach } = active.rule;
  if (reach === "own-page") return false;
  if (reach === "contents-entries") return contentsEntries(element.text) > 0;
  return element.page <= active.page + reach.pages;
}

// A matter section runs from its heading to the next heading that is not
// itself matter, or until it runs out of reach.
export function markMatterSections(elements: DocumentElement[]): void {
  let active: ActiveMatter | null = null;
  for (const element of elements) {
    const matter = matterFor(element);
    if (matter) active = { rule: matter, page: element.page };
    else if (isHeading(element) || (active && !stillInside(active, element))) active = null;
    if (active) markAsMatter(element, active.rule);
  }
}

function pagesOf(elements: DocumentElement[]): Map<number, DocumentElement[]> {
  const pages = new Map<number, DocumentElement[]>();
  for (const element of elements) {
    pages.set(element.page, [...(pages.get(element.page) ?? []), element]);
  }
  return pages;
}

// A page made almost entirely of contents entries is navigation even with no
// "Contents" heading, as in many converted e-books.
export function markContentsPages(elements: DocumentElement[]): void {
  for (const pageElements of pagesOf(elements).values()) {
    const prose = pageElements.filter((element) => element.text.trim() && element.role === "paragraph");
    const listed = prose.filter((element) => contentsEntries(element.text) > 0);
    const entries = listed.reduce((sum, element) => sum + contentsEntries(element.text), 0);
    const listedChars = listed.reduce((sum, element) => sum + element.text.length, 0);
    const proseChars = prose.reduce((sum, element) => sum + element.text.length, 0);
    if (entries < 3 || proseChars === 0 || listedChars / proseChars < 0.8) continue;
    for (const element of listed) markAsMatter(element, CONTENTS_LISTING);
  }
}

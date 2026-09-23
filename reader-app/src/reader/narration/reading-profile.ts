import type { DocumentElement, ElementRole, ReadingAction, ReadingProfile } from "../core/types.ts";

const INLINE_ROLES: ElementRole[] = [
  "title",
  "heading",
  "paragraph",
  "list-item",
  "quote",
  "code",
  "unknown",
];

const OMIT_ROLES: ElementRole[] = [
  "header",
  "footer",
  "page-number",
  "watermark",
  "metadata",
  "navigation",
  "back-matter",
  "decorative",
  "citation",
  "reference",
  "formula",
];

function policies(defaultAction: ReadingAction): Record<ElementRole, ReadingAction> {
  const result = {} as Record<ElementRole, ReadingAction>;
  const roles: ElementRole[] = [
    ...INLINE_ROLES,
    ...OMIT_ROLES,
    "caption",
    "footnote",
    "table",
    "sidebar",
    "callout",
  ];
  for (const role of roles) result[role] = defaultAction;
  return result;
}

const audiobookPolicies = policies("inline");
for (const role of OMIT_ROLES) audiobookPolicies[role] = "omit";
audiobookPolicies.caption = "separate";
audiobookPolicies.footnote = "separate";
audiobookPolicies.table = "summary-required";
audiobookPolicies.sidebar = "separate";
audiobookPolicies.callout = "separate";

export const AUDIOBOOK_READING_PROFILE: ReadingProfile = {
  id: "audiobook",
  minimumClassificationConfidence: 0.8,
  minimumOmissionConfidence: 0.8,
  includeInlineCitations: false,
  policies: audiobookPolicies,
};

export const INCLUSIVE_READING_PROFILE: ReadingProfile = {
  id: "inclusive",
  minimumClassificationConfidence: 0.8,
  minimumOmissionConfidence: 1,
  includeInlineCitations: true,
  policies: policies("inline"),
};

export const DIAGNOSTIC_READING_PROFILE: ReadingProfile = {
  id: "diagnostic",
  minimumClassificationConfidence: 0.8,
  minimumOmissionConfidence: 1,
  includeInlineCitations: true,
  policies: policies("inline"),
};

export function decideReadingAction(
  element: DocumentElement,
  profile: ReadingProfile,
): ReadingAction {
  const configuredAction = profile.policies[element.role];
  if (configuredAction === "inline") return "inline";
  if (configuredAction === "omit") {
    return element.omissionConfidence >= profile.minimumOmissionConfidence ? "omit" : "inline";
  }
  if (element.text && element.omissionConfidence < profile.minimumOmissionConfidence)
    return "inline";
  return element.roleConfidence >= profile.minimumClassificationConfidence
    ? configuredAction
    : "inline";
}

/** Listener-facing switches for what narration leaves out. `true` skips. */
export interface ContentFilters {
  /** Copyright pages, legal notices, publisher's notes. */
  skipPublisherMatter: boolean;
  /** Tables of contents, indexes, lists of figures. */
  skipNavigation: boolean;
  /** About the author, acknowledgments, "also by", previews. */
  skipBackMatter: boolean;
  /** Running headers, footers, page numbers. */
  skipRunningText: boolean;
  footnotes: "skip" | "read";
  /** Bibliographies and inline source markers. */
  skipReferences: boolean;
}

export const DEFAULT_CONTENT_FILTERS: ContentFilters = {
  skipPublisherMatter: true,
  skipNavigation: true,
  skipBackMatter: true,
  skipRunningText: true,
  footnotes: "skip",
  skipReferences: true,
};

const FILTERED_ROLES: Array<[keyof ContentFilters, ElementRole[]]> = [
  ["skipPublisherMatter", ["metadata"]],
  ["skipNavigation", ["navigation"]],
  ["skipBackMatter", ["back-matter"]],
  ["skipRunningText", ["header", "footer", "page-number", "watermark"]],
  ["skipReferences", ["reference", "citation"]],
];

// Layers the listener's filter switches over a base profile. Turning a filter
// off reads that material inline, where it appears in the book.
export function withContentFilters(
  profile: ReadingProfile,
  filters: ContentFilters,
): ReadingProfile {
  const policies = { ...profile.policies };
  for (const [key, roles] of FILTERED_ROLES) {
    for (const role of roles) policies[role] = filters[key] ? "omit" : "inline";
  }
  if (filters.footnotes === "read") policies.footnote = "inline";
  return {
    ...profile,
    policies,
    includeInlineCitations: profile.includeInlineCitations || !filters.skipReferences,
  };
}

import type { DocumentElement, ElementRole } from "../core/types.ts";

export interface AmbiguousElementFeatures {
  text: string;
  page: number;
  bounds: DocumentElement["bounds"];
  fontSize?: number;
  currentRole: ElementRole;
}

export interface LayoutClassificationVote {
  role: Extract<ElementRole, "caption" | "sidebar" | "callout" | "formula" | "table">;
  confidence: number;
  modelId: string;
}

export interface AmbiguousElementClassifier {
  classify(features: AmbiguousElementFeatures): LayoutClassificationVote | null;
}

export const NO_AMBIGUITY_CLASSIFIER: AmbiguousElementClassifier = {
  classify: () => null,
};

export function applyLayoutVote(
  element: DocumentElement,
  classifier: AmbiguousElementClassifier,
): DocumentElement {
  if (element.role !== "paragraph" && element.role !== "unknown") return element;
  const vote = classifier.classify({
    text: element.text,
    page: element.page,
    bounds: element.bounds,
    fontSize: element.fontSize,
    currentRole: element.role,
  });
  if (!vote || !Number.isFinite(vote.confidence) || vote.confidence < 0.8) return element;
  return {
    ...element,
    role: vote.role,
    roleConfidence: vote.confidence,
    omissionConfidence: Math.min(element.omissionConfidence, vote.confidence),
    evidence: [
      ...element.evidence,
      {
        signal: "layout-model",
        weight: vote.confidence,
        detail: `layout vote ${vote.modelId} classified ${vote.role}`,
      },
    ],
  };
}

import type {
  DocumentAnalysis,
  ElementRole,
  ElementRelationshipType,
  ReadingProfile,
} from "../core/types.ts";
import { decideReadingAction } from "../narration/reading-profile.ts";

export interface ElementLabel {
  id: string;
  narrative: boolean;
  role: ElementRole;
  order: number;
  headingLevel?: number;
  parentHeadingId?: string;
  relationships?: Array<{ type: ElementRelationshipType; targetId: string }>;
}

export interface EvaluationMetrics {
  narrativeRetentionPrecision: number;
  narrativeRetentionRecall: number;
  narrativeDeletionRate: number;
  nonNarrativeRemovalPrecision: number;
  nonNarrativeRemovalRecall: number;
  roleMacroF1: number;
  readingOrderPairwiseAccuracy: number;
  hierarchyAccuracy: number;
  relationshipPrecision: number;
  relationshipRecall: number;
  omissionConfidenceCalibrationError: number;
}

export interface CorpusEvaluation {
  documents: Array<{ documentId: string; metrics: EvaluationMetrics }>;
  worstNarrativeRetentionDocumentId: string | null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function f1(precision: number, recall: number): number {
  return precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
}

function roleScore(
  role: ElementRole,
  labels: ElementLabel[],
  predictedRoles: Map<string, ElementRole>,
): number {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const label of labels) {
    const predicted = predictedRoles.get(label.id);
    if (predicted === role && label.role === role) truePositive += 1;
    if (predicted === role && label.role !== role) falsePositive += 1;
    if (predicted !== role && label.role === role) falseNegative += 1;
  }
  return f1(
    ratio(truePositive, truePositive + falsePositive),
    ratio(truePositive, truePositive + falseNegative),
  );
}

function macroRoleF1(
  labels: ElementLabel[],
  predictedRoles: Map<string, ElementRole>,
): number {
  const roles = new Set<ElementRole>(labels.map((label) => label.role));
  for (const role of predictedRoles.values()) roles.add(role);
  if (roles.size === 0) return 1;
  const total = [...roles].reduce(
    (sum, role) => sum + roleScore(role, labels, predictedRoles),
    0,
  );
  return total / roles.size;
}

function pairwiseOrderAccuracy(
  labels: ElementLabel[],
  predictedOrder: Map<string, number>,
): number {
  let correct = 0;
  let compared = 0;
  for (let left = 0; left < labels.length; left += 1) {
    for (let right = left + 1; right < labels.length; right += 1) {
      const a = labels[left]!;
      const b = labels[right]!;
      const predictedA = predictedOrder.get(a.id);
      const predictedB = predictedOrder.get(b.id);
      if (predictedA === undefined || predictedB === undefined) continue;
      compared += 1;
      if ((a.order < b.order) === (predictedA < predictedB)) correct += 1;
    }
  }
  return ratio(correct, compared);
}

function hierarchyAccuracy(analysis: DocumentAnalysis, labels: ElementLabel[]): number {
  const headings = labels.filter((label) => label.headingLevel !== undefined);
  if (headings.length === 0) return 1;
  const sections = new Map(
    analysis.sections.map((section) => [section.headingElementId, section]),
  );
  const sectionById = new Map(analysis.sections.map((section) => [section.id, section]));
  const correct = headings.filter((label) => {
    const section = sections.get(label.id);
    const parent = section?.parentId ? sectionById.get(section.parentId) : undefined;
    const parentHeadingId = parent?.headingElementId;
    return section?.level === label.headingLevel && parentHeadingId === label.parentHeadingId;
  }).length;
  return ratio(correct, headings.length);
}

function relationScores(analysis: DocumentAnalysis, labels: ElementLabel[]): {
  precision: number;
  recall: number;
} {
  const expected = labels.flatMap((label) =>
    (label.relationships ?? []).map((relation) =>
      `${label.id}:${relation.type}:${relation.targetId}`,
    ),
  );
  const predicted = analysis.elements.flatMap((element) =>
    element.relationships.map((relation) =>
      `${element.id}:${relation.type}:${relation.targetId}`,
    ),
  );
  const expectedSet = new Set(expected);
  const predictedSet = new Set(predicted);
  const correct = [...predictedSet].filter((item) => expectedSet.has(item)).length;
  return {
    precision: ratio(correct, predictedSet.size),
    recall: ratio(correct, expectedSet.size),
  };
}

function confidenceCalibrationError(
  analysis: DocumentAnalysis,
  labels: ElementLabel[],
): number {
  const byId = new Map(analysis.elements.map((element) => [element.id, element]));
  const examples = labels.flatMap((label) => {
    const element = byId.get(label.id);
    return element ? [{ confidence: element.omissionConfidence, actual: Number(!label.narrative) }] : [];
  });
  if (examples.length === 0) return 0;
  const bins = Array.from({ length: 5 }, (_, index) =>
    examples.filter((example) => Math.min(4, Math.floor(example.confidence * 5)) === index),
  );
  return bins.reduce((total, bin) => {
    if (bin.length === 0) return total;
    const predicted = bin.reduce((sum, item) => sum + item.confidence, 0) / bin.length;
    const actual = bin.reduce((sum, item) => sum + item.actual, 0) / bin.length;
    return total + Math.abs(predicted - actual) * bin.length / examples.length;
  }, 0);
}

export function evaluateAnalysis(
  analysis: DocumentAnalysis,
  labels: ElementLabel[],
  profile: ReadingProfile,
): EvaluationMetrics {
  const elements = new Map(analysis.elements.map((element) => [element.id, element]));
  const predictedNarrative = new Set(
    analysis.elements
      .filter((element) => decideReadingAction(element, profile) === "inline")
      .map((element) => element.id),
  );
  const trueNarrative = labels.filter((label) => label.narrative);
  const trueNonNarrative = labels.filter((label) => !label.narrative);
  const retainedTrue = trueNarrative.filter((label) => predictedNarrative.has(label.id)).length;
  const retainedTotal = labels.filter((label) => predictedNarrative.has(label.id)).length;
  const removedTrue = trueNonNarrative.filter((label) => !predictedNarrative.has(label.id)).length;
  const removedTotal = labels.filter((label) => !predictedNarrative.has(label.id)).length;
  const predictedRoles = new Map(
    [...elements].map(([id, element]) => [id, element.role] as const),
  );
  const predictedOrder = new Map(
    [...elements].map(([id, element]) => [id, element.readingOrder] as const),
  );
  const relations = relationScores(analysis, labels);
  const retentionRecall = ratio(retainedTrue, trueNarrative.length);
  return {
    narrativeRetentionPrecision: ratio(retainedTrue, retainedTotal),
    narrativeRetentionRecall: retentionRecall,
    narrativeDeletionRate: 1 - retentionRecall,
    nonNarrativeRemovalPrecision: ratio(removedTrue, removedTotal),
    nonNarrativeRemovalRecall: ratio(removedTrue, trueNonNarrative.length),
    roleMacroF1: macroRoleF1(labels, predictedRoles),
    readingOrderPairwiseAccuracy: pairwiseOrderAccuracy(labels, predictedOrder),
    hierarchyAccuracy: hierarchyAccuracy(analysis, labels),
    relationshipPrecision: relations.precision,
    relationshipRecall: relations.recall,
    omissionConfidenceCalibrationError: confidenceCalibrationError(analysis, labels),
  };
}

export function evaluateCorpus(
  documents: Array<{ analysis: DocumentAnalysis; labels: ElementLabel[] }>,
  profile: ReadingProfile,
): CorpusEvaluation {
  const results = documents.map(({ analysis, labels }) => ({
    documentId: analysis.documentId,
    metrics: evaluateAnalysis(analysis, labels, profile),
  }));
  const worst = [...results].sort(
    (left, right) =>
      left.metrics.narrativeRetentionRecall - right.metrics.narrativeRetentionRecall,
  )[0];
  return {
    documents: results,
    worstNarrativeRetentionDocumentId: worst?.documentId ?? null,
  };
}

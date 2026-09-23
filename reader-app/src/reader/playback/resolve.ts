import type { NarrationSegment } from "../core/types.ts";

type Rule = (previous: NarrationSegment, candidate: NarrationSegment) => boolean;

function sharesBlock(previous: NarrationSegment, candidate: NarrationSegment): boolean {
  return candidate.sourceBlockIds.some((id) => previous.sourceBlockIds.includes(id));
}

const sameSentence: Rule = (previous, candidate) =>
  candidate.id === previous.id && candidate.spokenText === previous.spokenText;

// Layout analysis regrouping a paragraph renames its sentences (ids are keyed
// to the run's first block) without changing what they say or where they sit.
const renamedSentence: Rule = (previous, candidate) =>
  candidate.spokenText === previous.spokenText && sharesBlock(previous, candidate);

const TAIL_WORDS = 3;

function tail(text: string): string {
  return text.trim().split(/\s+/).slice(-TAIL_WORDS).join(" ");
}

function holdsLastBlock(previous: NarrationSegment, candidate: NarrationSegment): boolean {
  const last = previous.sourceBlockIds.at(-1);
  return last !== undefined && candidate.sourceBlockIds.includes(last);
}

// A sentence that grew (its paragraph ran on to a page analysed later) or was
// re-split still contains the words the listener last heard; carrying on from
// there neither repeats nor skips them.
const holdsEnding: Rule = (previous, candidate) =>
  holdsLastBlock(previous, candidate) && candidate.spokenText.includes(tail(previous.spokenText));

// Last resort that still has evidence: the sentence now covering the printed
// text the listener was on, even if a profile change rewrote how it is spoken.
const coversSamePrint: Rule = holdsLastBlock;

// Rules in order of confidence: the first one that matches anything wins.
const RULES: readonly Rule[] = [sameSentence, renamedSentence, holdsEnding, coversSamePrint];

// Where the listener is in a freshly compiled list: the index of the sentence
// that now covers what `previous` covered, or null when nothing can be said
// with confidence - callers must then stay put rather than guess.
export function resolveSegment(
  previous: NarrationSegment,
  ordered: readonly NarrationSegment[],
): number | null {
  for (const rule of RULES) {
    const index = ordered.findIndex((candidate) => rule(previous, candidate));
    if (index >= 0) return index;
  }
  return null;
}

export type NextStep =
  | { kind: "next"; segment: NarrationSegment }
  | { kind: "end-of-page" }
  | { kind: "unresolved" };

// What follows the sentence just finished on its (possibly recompiled) page.
// "unresolved" is distinct from "end-of-page" so the caller can record that it
// had to fall back instead of silently skipping the rest of the page.
export function nextAfter(
  previous: NarrationSegment,
  pageSegments: readonly NarrationSegment[],
): NextStep {
  const index = resolveSegment(previous, pageSegments);
  if (index === null) return { kind: "unresolved" };
  const segment = pageSegments[index + 1];
  return segment ? { kind: "next", segment } : { kind: "end-of-page" };
}

import type { NarrationSegment } from "../core/types.ts";

// A typical audiobook pace at 1x. Only used to translate "skip 30 seconds"
// and "time left" into sentences, so a rough figure is enough.
const WORDS_PER_MINUTE = 155;

/** Estimated listening time for one sentence at `rate`, pauses included. */
export function estimateSeconds(segment: NarrationSegment, rate: number): number {
  const words = segment.spokenText.split(/\s+/).filter(Boolean).length;
  const pauses = ((segment.speech?.pauseBeforeMs ?? 0) + (segment.speech?.pauseAfterMs ?? 0)) / 1000;
  const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return (words / WORDS_PER_MINUTE) * 60 / speed + pauses;
}

// Where an Audible-style "skip N seconds" lands: the sentence about `seconds`
// of listening away (negative skips back), never less than one sentence and
// never past either end of the book.
export function skipTarget(
  segments: readonly NarrationSegment[],
  currentIndex: number,
  seconds: number,
  rate: number,
): number {
  const last = segments.length - 1;
  if (last < 0) return 0;
  const from = Math.min(Math.max(currentIndex, 0), last);
  const step = seconds < 0 ? -1 : 1;
  let index = from;
  let covered = 0;
  while (covered < Math.abs(seconds)) {
    const next = index + step;
    if (next < 0 || next > last) break;
    covered += estimateSeconds(segments[step > 0 ? index : next]!, rate);
    index = next;
  }
  return index;
}

export interface ListeningProgress {
  percent: number;
  elapsedSeconds: number;
  remainingSeconds: number;
}

export function listeningProgress(
  segments: readonly NarrationSegment[],
  currentIndex: number,
  rate: number,
): ListeningProgress {
  if (segments.length === 0) return { percent: 0, elapsedSeconds: 0, remainingSeconds: 0 };
  const index = Math.min(Math.max(currentIndex, 0), segments.length - 1);
  let elapsed = 0;
  let remaining = 0;
  for (const [position, segment] of segments.entries()) {
    if (position < index) elapsed += estimateSeconds(segment, rate);
    else remaining += estimateSeconds(segment, rate);
  }
  const last = index === segments.length - 1;
  const percent = last ? 100 : Math.round((elapsed / Math.max(elapsed + remaining, 1e-9)) * 100);
  return { percent, elapsedSeconds: elapsed, remainingSeconds: remaining };
}

function isChapterStart(segment: NarrationSegment): boolean {
  return segment.type === "title" || segment.type === "heading";
}

// Next chapter: the next heading after the current sentence (null past the
// last). Previous chapter works like Audible's back button: first to the
// start of the chapter being heard, then - once already there - to the one
// before it.
export function chapterTarget(
  segments: readonly NarrationSegment[],
  currentIndex: number,
  direction: -1 | 1,
): number | null {
  if (direction > 0) {
    const next = segments.findIndex((segment, index) => index > currentIndex && isChapterStart(segment));
    return next < 0 ? null : next;
  }
  const starts = segments.flatMap((segment, index) =>
    index <= currentIndex && isChapterStart(segment) ? [index] : [],
  );
  const current = starts.at(-1);
  if (current === undefined) return 0;
  if (current < currentIndex) return current;
  return starts.at(-2) ?? 0;
}

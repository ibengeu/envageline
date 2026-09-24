import type { NarrationSegment, ReadingProgress, RecentDocument } from "../core/types.ts";

// Where a reopened book resumes: the exact saved sentence when it still
// exists, otherwise the top of the page the listener had reached (a
// recompile or a reading-profile change can retire individual sentences).
export function restoredSegment(
  segments: readonly NarrationSegment[],
  progress: Pick<ReadingProgress, "segmentId" | "page" | "segmentIndex"> | null,
): NarrationSegment | null {
  if (!progress) return segments[0] ?? null;
  const exact = progress.segmentId ? segments.find((segment) => segment.id === progress.segmentId) : undefined;
  return exact ?? segments.find((segment) => segment.page >= progress.page) ?? segments.at(-1) ?? null;
}

// What to persist for the current position. With no sentence selected yet
// (the book is still opening, or its pages are still being analyzed) there
// is nothing worth saving, and writing an empty position would erase the one
// the listener actually reached last time.
export function progressToSave(
  documentId: string,
  segment: NarrationSegment | null,
  segmentIndex: number,
): ReadingProgress | null {
  if (!segment) return null;
  return { documentId, page: segment.page, segmentId: segment.id, segmentIndex, updatedAt: Date.now() };
}

// When a book was last used: opened, or listened to (progress is saved as
// the listener goes), whichever is later.
function lastActivity(doc: RecentDocument): number {
  return Math.max(doc.lastOpenedAt, doc.progress?.updatedAt ?? 0);
}

// The one book the landing page offers to continue.
export function latestDocument(recents: readonly RecentDocument[]): RecentDocument | null {
  let latest: RecentDocument | null = null;
  for (const doc of recents) {
    if (!latest || lastActivity(doc) > lastActivity(latest)) latest = doc;
  }
  return latest;
}

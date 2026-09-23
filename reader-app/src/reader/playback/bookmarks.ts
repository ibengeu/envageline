export interface Bookmark {
  segmentId: string;
  /** Narration order, so bookmarks list in the order they occur in the book. */
  order: number;
  page: number;
  excerpt: string;
  note: string;
  createdAt: number;
}

export const MAX_NOTE_LENGTH = 500;
export const MAX_EXCERPT_LENGTH = 160;
export const MAX_BOOKMARKS = 500;

function cleanText(value: string, limit: number): string {
  // OWASP A05:2025 Injection - notes are typed by the reader and excerpts come
  // from the PDF: control and escape characters are removed and the length
  // is capped before either is stored or displayed (always as text, never HTML).
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim().slice(0, limit);
}

// Bookmarking a sentence that already has one replaces it (a new note wins)
// rather than stacking duplicates.
export function addBookmark(list: readonly Bookmark[], mark: Bookmark): Bookmark[] {
  const clean: Bookmark = {
    ...mark,
    note: cleanText(mark.note, MAX_NOTE_LENGTH),
    excerpt: cleanText(mark.excerpt, MAX_EXCERPT_LENGTH),
  };
  // OWASP A06:2025 Insecure Design - bounded per book so storage cannot grow
  // without limit; the oldest bookmark gives way to the newest.
  const kept = list.filter((item) => item.segmentId !== mark.segmentId);
  while (kept.length >= MAX_BOOKMARKS) {
    const oldest = kept.reduce((left, right) => (right.createdAt < left.createdAt ? right : left));
    kept.splice(kept.indexOf(oldest), 1);
  }
  return [...kept, clean].sort((left, right) => left.order - right.order);
}

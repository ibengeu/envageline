import { X } from "lucide-react";
import { goToBookmark, goToPage, removeBookmark, seekToSegment } from "@/reader/controller";
import { useReaderStore } from "@/reader/core/store";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const documentSlice = useReaderStore((s) => s.document);
  const currentPage = useReaderStore((s) => s.viewer.currentPage);
  const currentSegmentId = useReaderStore((s) => s.playback.currentSegmentId);
  const segmentsByPage = useReaderStore((s) => s.segmentsByPage);
  const pageStates = useReaderStore((s) => s.processing.pageStates);
  const open = useReaderStore((s) => s.sidebarOpen);
  const bookmarks = useReaderStore((s) => s.bookmarks);

  if (!documentSlice) return null;
  const headings = Object.values(segmentsByPage)
    .flat()
    .filter((segment) => segment.type === "title" || segment.type === "heading");

  return (
    <aside
      className={cn(
        "flex h-full w-[min(280px,84vw)] shrink-0 flex-col overflow-hidden border-r border-border bg-surface",
        "max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:z-20 max-lg:shadow-[var(--shadow-page)]",
        "transition-[transform,margin-left] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        open ? "max-lg:translate-x-0" : "max-lg:-translate-x-full lg:-ml-[min(280px,84vw)]",
      )}
      aria-hidden={!open}
    >
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-subtle">Pages</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <ol className="space-y-0.5">
          {documentSlice.model.pages.map((page) => {
            const state = pageStates[page.page];
            return (
              <li key={page.page}>
                <button
                  type="button"
                  onClick={() => {
                    goToPage(page.page);
                    useReaderStore.getState().setSidebarOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm",
                    page.page === currentPage
                      ? "bg-surface-2 text-fg"
                      : "text-muted hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <span>Page {page.page}</span>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      state === "narration-ready"
                        ? "bg-accent"
                        : state === "ocr-required" || state === "error"
                          ? "bg-danger"
                          : state === "extracting" || state === "layout-processing"
                            ? "bg-muted"
                            : "bg-border",
                    )}
                    aria-hidden="true"
                  />
                </button>
              </li>
            );
          })}
        </ol>
        {bookmarks.length > 0 && (
          <div className="mt-6 px-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-subtle">
              Bookmarks
            </p>
            <ul className="space-y-1">
              {bookmarks.map((mark) => (
                <li key={mark.segmentId} className="flex items-start gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      goToBookmark(mark.segmentId);
                      useReaderStore.getState().setSidebarOpen(false);
                    }}
                    className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left text-sm leading-snug text-muted hover:text-fg"
                  >
                    <span className="block text-[11px] tabular-nums text-subtle">Page {mark.page}</span>
                    <span className="line-clamp-2">{mark.note || mark.excerpt}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Remove bookmark"
                    className="mt-2 rounded p-1 text-subtle hover:text-fg"
                    onClick={() => removeBookmark(mark.segmentId)}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {headings.length > 0 && (
          <div className="mt-6 px-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-subtle">
              Chapters
            </p>
            <ul className="space-y-1">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void seekToSegment(heading.id);
                      useReaderStore.getState().setSidebarOpen(false);
                    }}
                    className={cn(
                      "w-full rounded-lg px-2 py-2 text-left text-sm leading-snug",
                      heading.id === currentSegmentId
                        ? "bg-surface-2 text-fg"
                        : "text-muted hover:text-fg",
                    )}
                  >
                    {heading.originalText}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}

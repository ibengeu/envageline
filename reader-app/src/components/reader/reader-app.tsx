import {
  ChevronLeft,
  ChevronRight,
  List,
  Minus,
  PanelLeft,
  Plus,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  addBookmarkHere,
  closeDocument,
  goToPage,
  initReader,
  nextSegment,
  openLocalFile,
  previousSegment,
  returnToNarration,
  setFitWidth,
  setContentFilters,
  setReadingProfile,
  setSkipInterval,
  setZoom,
  skipInterval,
  togglePlay,
} from "@/reader/controller";
import { MAX_ZOOM, MIN_ZOOM } from "@/reader/core/config";
import { useReaderStore } from "@/reader/core/store";
import type { ContentFilters } from "@/reader/narration/reading-profile";
import { SKIP_INTERVALS } from "@/reader/storage/settings";
import { shouldHandleShortcut } from "./input-guards";
import { EvangelineWordmark } from "./logo";

const FILTER_OPTIONS: Array<[Exclude<keyof ContentFilters, "footnotes">, string]> = [
  ["skipPublisherMatter", "Copyright, legal & publisher's notes"],
  ["skipNavigation", "Table of contents & index"],
  ["skipBackMatter", "About the author, acknowledgments, previews"],
  ["skipRunningText", "Running headers, footers & page numbers"],
  ["skipReferences", "Bibliographies & citation markers"],
];
import { Landing } from "./landing";
import { PdfViewer } from "./pdf-viewer";
import { Player } from "./player";
import { Sidebar } from "./sidebar";

export function ReaderApp() {
  const documentSlice = useReaderStore((s) => s.document);
  const viewer = useReaderStore((s) => s.viewer);
  const error = useReaderStore((s) => s.error);
  const notice = useReaderStore((s) => s.notice);
  const settingsOpen = useReaderStore((s) => s.settingsOpen);
  const sidebarOpen = useReaderStore((s) => s.sidebarOpen);
  const playback = useReaderStore((s) => s.playback);
  const readingProfileId = useReaderStore((s) => s.readingProfileId);
  const contentFilters = useReaderStore((s) => s.contentFilters);
  const skipIntervalSeconds = useReaderStore((s) => s.skipIntervalSeconds);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initReader();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const handled = shouldHandleShortcut({
        tagName: target?.tagName ?? "",
        isContentEditable: target?.isContentEditable ?? false,
        role: target?.getAttribute("role") ?? null,
        defaultPrevented: event.defaultPrevented,
      });
      if (!handled) return;
      if (!useReaderStore.getState().document) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void nextSegment();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        void previousSegment();
      } else if (event.key === "j") {
        skipInterval(-1);
      } else if (event.key === "l") {
        skipInterval(1);
      } else if (event.key === "b") {
        addBookmarkHere();
      } else if (event.key === "+" || event.key === "=") {
        const zoom = useReaderStore.getState().viewer.zoom;
        setZoom(Math.min(MAX_ZOOM, zoom + 0.1));
      } else if (event.key === "-" || event.key === "_") {
        const zoom = useReaderStore.getState().viewer.zoom;
        setZoom(Math.max(MIN_ZOOM, zoom - 0.1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!documentSlice) return <Landing />;

  return (
    <div className="relative flex h-dvh bg-bg text-fg">
      <Sidebar />
      {sidebarOpen && (
        <button
          type="button"
          className="absolute inset-0 z-10 bg-bg/50 lg:hidden"
          aria-label="Close contents"
          onClick={() => useReaderStore.getState().setSidebarOpen(false)}
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-2 sm:px-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle contents"
            onClick={() =>
              useReaderStore.getState().setSidebarOpen(!sidebarOpen)
            }
          >
            <PanelLeft />
          </Button>
          <EvangelineWordmark className="hidden sm:flex" />
          <p className="min-w-0 flex-1 truncate text-sm text-muted">
            {documentSlice.model.metadata.title || documentSlice.model.filename}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              onClick={() => goToPage(viewer.currentPage - 1)}
            >
              <ChevronLeft />
            </Button>
            <label className="flex items-center gap-1 text-xs text-muted">
              <input
                type="number"
                min={1}
                max={documentSlice.model.pageCount}
                value={viewer.currentPage}
                onChange={(event) => goToPage(Number(event.target.value))}
                className="h-8 w-12 rounded-md bg-surface-2 text-center text-fg tabular-nums shadow-[var(--shadow-border)]"
                aria-label="Current page"
              />
              <span className="tabular-nums">/ {documentSlice.model.pageCount}</span>
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              onClick={() => goToPage(viewer.currentPage + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="hidden items-center gap-1 md:flex">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom out"
              onClick={() => {
                setFitWidth(false);
                setZoom(Math.max(MIN_ZOOM, viewer.zoom - 0.1));
              }}
            >
              <Minus />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFitWidth(true)}>
              Fit
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom in"
              onClick={() => {
                setFitWidth(false);
                setZoom(Math.min(MAX_ZOOM, viewer.zoom + 0.1));
              }}
            >
              <Plus />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Listening help"
            onClick={() => useReaderStore.getState().setSettingsOpen(true)}
          >
            <Settings2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close document"
            onClick={() => closeDocument()}
          >
            <X />
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openLocalFile(file);
              event.target.value = "";
            }}
          />
        </header>

        <div className="relative min-h-0 flex-1">
          <PdfViewer />
          {viewer.userScrolling && (
            <Button
              className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full"
              onClick={() => returnToNarration()}
            >
              Return to current narration
            </Button>
          )}
        </div>

        {(error || notice) && (
          <div className="border-t border-border bg-surface px-4 py-2 text-sm text-muted">
            {error ? <span className="text-danger">{error.message}</span> : notice}
          </div>
        )}

        <Player />
      </div>

      {settingsOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-bg/60 p-4 sm:items-center"
          onClick={() => useReaderStore.getState().setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-surface p-5 shadow-[var(--shadow-page)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-labelledby="listening-title"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="listening-title" className="font-display text-xl tracking-tight">
                Listening
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close"
                onClick={() => useReaderStore.getState().setSettingsOpen(false)}
              >
                <X />
              </Button>
            </div>
            <ul className="space-y-3 text-sm text-muted">
              <li>
                <span className="text-fg">Space</span> play or pause
              </li>
              <li>
                <span className="text-fg">Left / Right</span> previous or next sentence
              </li>
              <li>
                <span className="text-fg">J / L</span> skip back or forward {skipIntervalSeconds}s
              </li>
              <li>
                <span className="text-fg">B</span> bookmark the current sentence
              </li>
              <li>
                <span className="text-fg">+ / −</span> zoom
              </li>
              <li>Tap a paragraph on the page to start reading there.</li>
              <li>
                Voice:{" "}
                {playback.voices.find((voice) => voice.id === playback.voiceId)?.name ??
                  "browser default"}
              </li>
            </ul>
            <label className="mt-5 flex flex-col gap-2 text-sm text-muted">
              Reading profile
              <select
                className="h-10 rounded-lg bg-surface-2 px-3 text-fg shadow-[var(--shadow-border)]"
                aria-label="Reading profile"
                value={readingProfileId}
                onChange={(event) => {
                  const profileId = event.target.value;
                  if (profileId === "audiobook" || profileId === "inclusive" || profileId === "diagnostic") {
                    void setReadingProfile(profileId);
                  }
                }}
              >
                <option value="audiobook">Audiobook — skip repeated publishing elements</option>
                <option value="inclusive">Inclusive — read classified elements inline</option>
                <option value="diagnostic">Diagnostic — read every extracted element</option>
              </select>
            </label>
            {readingProfileId === "audiobook" && (
              <fieldset className="mt-5 space-y-2 text-sm text-muted">
                <legend className="mb-2">Skip while listening</legend>
                {FILTER_OPTIONS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={contentFilters[key]}
                      onChange={(event) =>
                        void setContentFilters({ ...contentFilters, [key]: event.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={contentFilters.footnotes === "skip"}
                    onChange={(event) =>
                      void setContentFilters({
                        ...contentFilters,
                        footnotes: event.target.checked ? "skip" : "read",
                      })
                    }
                  />
                  Footnotes
                </label>
              </fieldset>
            )}
            <label className="mt-5 flex flex-col gap-2 text-sm text-muted">
              Skip interval
              <select
                className="h-10 rounded-lg bg-surface-2 px-3 text-fg shadow-[var(--shadow-border)]"
                aria-label="Skip interval"
                value={skipIntervalSeconds}
                onChange={(event) => setSkipInterval(Number(event.target.value))}
              >
                {SKIP_INTERVALS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ))}
              </select>
            </label>
            <Button
              className="mt-6 w-full rounded-xl"
              variant="secondary"
              onClick={() => fileRef.current?.click()}
            >
              <List className="size-4" />
              Open another PDF
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

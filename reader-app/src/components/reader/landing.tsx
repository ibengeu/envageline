import { FileUp, Headphones, Lock, Play } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { openLocalFile, openRecent, openSample } from "@/reader/controller";
import { useReaderStore } from "@/reader/core/store";
import { cn } from "@/lib/utils";
import { HOSTED_NARRATION } from "@/reader/speech/kokoro-endpoint";
import { EvangelineMark } from "./logo";

export function Landing() {
  const recents = useReaderStore((s) => s.recents);
  const error = useReaderStore((s) => s.error);
  const ttsSupported = useReaderStore((s) => s.ttsSupported);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file || file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return;
    }
    setBusy(true);
    try {
      await openLocalFile(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-bg text-fg">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent)]"
      />
      <header className="relative mx-auto flex w-full max-w-6xl shrink-0 items-center justify-between px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2.5">
          <EvangelineMark />
          <span className="font-display text-lg tracking-tight">Evangeline</span>
        </span>
        <p className="hidden text-xs text-muted sm:block">
            {HOSTED_NARRATION ? "PDF listening with highlighting" : "On-device PDF listening"}
          </p>
      </header>

      <main className="relative mx-auto grid w-full max-w-6xl flex-1 content-center gap-10 px-5 py-10 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:gap-16 lg:py-16">
        <section className="stagger-in max-w-xl">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
            Audible reader
          </p>
          <h1 className="mt-4 font-display text-[2.6rem] leading-[1.08] tracking-[-0.03em] text-fg sm:text-6xl">
            Listen to any PDF.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted">
            Open a document, press play, and follow the spoken sentence on the
            page. Headers, page numbers, and citations stay quiet.{" "}
            {HOSTED_NARRATION ? "Your file stays on this device." : "Nothing is uploaded."}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              className="rounded-xl px-5"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <FileUp />
              Open PDF
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-xl px-5"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await openSample();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Headphones />
              Try a sample
            </Button>
          </div>
          {!ttsSupported && (
            <p className="mt-4 text-sm text-danger">
              This browser has no speech engine. You can still open and view PDFs.
            </p>
          )}
          {error && (
            <p className="mt-4 text-sm text-danger" role="alert">
              {error.message}
            </p>
          )}
          <ul className="mt-10 grid gap-3 text-sm text-muted sm:grid-cols-3">
            <li className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
              <Lock className="mb-3 size-4 text-accent" />
              {HOSTED_NARRATION ? "Files stay on this device" : "Stays on this device"}
            </li>
            <li className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
              <Play className="mb-3 size-4 text-accent" />
              Speaks the current page first
            </li>
            <li className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
              <Headphones className="mb-3 size-4 text-accent" />
              Highlight follows the voice
            </li>
          </ul>
        </section>

        <section className="min-w-0">
          <label
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void handleFile(event.dataTransfer.files[0]);
            }}
            className={cn(
              "flex min-h-[280px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed px-6 py-12 text-center transition-[border-color,background-color] duration-200",
              dragging
                ? "border-accent bg-surface"
                : "border-border bg-surface/60 hover:border-muted",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="sr-only"
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <EvangelineMark className="size-12" />
            <p className="mt-5 font-display text-2xl tracking-tight">Drop a PDF here</p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">
              {HOSTED_NARRATION
                ? "Your PDF stays on this device. Only the sentence being read is sent to the Evangeline server to be spoken, and it isn't stored."
                : "Local files only. Evangeline extracts text, rebuilds reading order, and starts speaking as soon as the first page is ready."}
            </p>
          </label>

          {recents.length > 0 && (
            <div className="mt-6">
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-subtle">
                Continue
              </p>
              <ul className="space-y-2">
                {recents.slice(0, 4).map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      onClick={() => void openRecent(doc.id)}
                      className="flex w-full items-center justify-between rounded-xl bg-surface px-4 py-3 text-left shadow-[var(--shadow-border)] transition-colors duration-150 hover:bg-surface-2"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-fg">
                          {doc.title || doc.filename}
                        </span>
                        <span className="text-xs text-muted">
                          {doc.pageCount} pages
                          {doc.progress?.page ? ` · p. ${doc.progress.page}` : ""}
                        </span>
                      </span>
                      <Play className="size-4 shrink-0 text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

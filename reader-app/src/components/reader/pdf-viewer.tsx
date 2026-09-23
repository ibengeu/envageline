import { useEffect, useRef, useState } from "react";
import {
  cancelRender,
  cancelTextLayer,
  markUserScrolling,
  renderPage,
  renderTextLayer,
  resolveHover,
  tapBlock,
  tapPage,
} from "@/reader/controller";
import { VIRTUAL_PAGE_WINDOW } from "@/reader/core/config";
import { useReaderStore } from "@/reader/core/store";
import type { BoundingBox, NarrationSegment, PageMetadata } from "@/reader/core/types";
import { isValidBoundingBox } from "@/reader/narration/highlight-geometry";
import { cn } from "@/lib/utils";
import { isDeliberateTap, type TapFacts } from "./input-guards";
import { scrollPageIntoView } from "./page-navigation";

const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);

function HighlightLayer({
  segment,
  page,
  variant = "active",
}: {
  segment: NarrationSegment | null;
  page: number;
  variant?: "active" | "hover";
}) {
  if (!segment) return null;
  // A sentence broken by a page turn draws its first half on its own page and
  // the rest on the next, so each page shows exactly the words spoken there.
  const own =
    segment.page === page
      ? segment.bounds
      : segment.continuedOn?.page === page
        ? segment.continuedOn.bounds
        : null;
  if (!own) return null;
  // OWASP A02:2025 Security Misconfiguration.
  // Reject invalid PDF geometry before CSS generation to prevent malformed overlay styles.
  const bounds = own.filter(isValidBoundingBox);
  const className = variant === "hover" ? "highlight-box highlight-box-hover" : "highlight-box";
  return (
    <>
      {bounds.map((box: BoundingBox, index) => (
        <div
          key={`${segment.id}-${index}`}
          className={className}
          data-highlight={variant}
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.width * 100}%`,
            height: `${Math.max(box.height, 0.012) * 100}%`,
            zIndex: 1,
          }}
        />
      ))}
    </>
  );
}

// When the window last came to the front: the click that does that is
// switching apps, not asking narration to jump.
let windowFocusedAt = Number.NEGATIVE_INFINITY;
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    windowFocusedAt = performance.now();
  });
}

interface Press {
  x: number;
  y: number;
  at: number;
}

// What a click on the page looked like, for telling a tap on a sentence
// apart from the end of a text selection, a drag or a window switch.
function tapFacts(event: { clientX: number; clientY: number }, press: Press | null): TapFacts {
  const now = performance.now();
  return {
    selectedText: window.getSelection()?.toString() ?? "",
    travelPx: press ? Math.hypot(event.clientX - press.x, event.clientY - press.y) : 0,
    pressMs: press ? now - press.at : 0,
    msSinceWindowFocus: now - windowFocusedAt,
  };
}

function PageCanvas({
  documentId,
  meta,
  width,
  active,
  segments,
}: {
  documentId: string;
  meta: PageMetadata;
  width: number;
  active: NarrationSegment | null;
  segments: NarrationSegment[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const scale = meta.width > 0 ? width / meta.width : 1;
  const [hovered, setHovered] = useState<NarrationSegment | null>(null);
  const hoveredBlockId = useRef<string | null>(null);
  const press = useRef<Press | null>(null);

  // The page can recompile (or the reader can navigate) without a mouseleave
  // ever firing, which would otherwise leave `hovered` pointing at a segment
  // object from the previous compile - stale bounds, wrong highlight
  // position. Dropping hover whenever the owning segment list changes keeps
  // it honest; the next mouse move re-resolves it against the new list.
  useEffect(() => {
    setHovered(null);
    hoveredBlockId.current = null;
  }, [segments]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 40) return;
    void renderPage(documentId, meta.page, canvas, scale);
    return () => {
      cancelRender(canvas);
    };
  }, [documentId, meta.page, scale, width]);

  useEffect(() => {
    const container = textLayerRef.current;
    if (!container || width < 40) return;
    void renderTextLayer(documentId, meta.page, container, scale).then((spans) => {
      for (const { element, itemIndex } of spans) {
        element.dataset.blockId = `p${meta.page}-b${itemIndex}`;
      }
    });
    return () => {
      cancelTextLayer(container);
    };
  }, [documentId, meta.page, scale, width]);

  return (
    <div
      ref={wrapRef}
      data-page={meta.page}
      className="relative mx-auto overflow-hidden rounded-sm bg-paper shadow-[var(--shadow-page)]"
      style={{ width, height: meta.height * scale }}
      onPointerDown={(event) => {
        press.current = { x: event.clientX, y: event.clientY, at: performance.now() };
      }}
      onClick={(event) => {
        const deliberate = isDeliberateTap(tapFacts(event, press.current));
        press.current = null;
        if (!deliberate) return;
        const rect = wrapRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const target = event.target instanceof HTMLElement ? event.target : null;
        const blockId = target?.dataset.blockId;
        if (blockId) {
          tapBlock(meta.page, blockId, x, y);
        } else {
          tapPage(meta.page, x, y);
        }
      }}
      onMouseOver={(event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        const resolution = resolveHover({
          segments,
          previousHover: hovered,
          previousBlockId: hoveredBlockId.current,
          blockId: target?.dataset.blockId,
        });
        hoveredBlockId.current = resolution.blockId;
        if (resolution.skipped) return;
        setHovered(resolution.hover);
      }}
      onMouseLeave={() => {
        hoveredBlockId.current = null;
        setHovered(null);
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div
        ref={textLayerRef}
        className="textLayer"
        style={
          {
            "--total-scale-factor": scale,
            "--scale-round-x": "1px",
            "--scale-round-y": "1px",
          } as React.CSSProperties
        }
      />
      <div className="pointer-events-none absolute inset-0">
        <HighlightLayer segment={active} page={meta.page} />
        {hovered?.id !== active?.id && (
          <HighlightLayer segment={hovered} page={meta.page} variant="hover" />
        )}
      </div>
    </div>
  );
}

export function PdfViewer() {
  const documentSlice = useReaderStore((s) => s.document);
  const currentPage = useReaderStore((s) => s.viewer.currentPage);
  const fitWidth = useReaderStore((s) => s.viewer.fitWidth);
  const zoom = useReaderStore((s) => s.viewer.zoom);
  const userScrolling = useReaderStore((s) => s.viewer.userScrolling);
  const segmentId = useReaderStore((s) => s.playback.currentSegmentId);
  const segmentsByPage = useReaderStore((s) => s.segmentsByPage);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(720);
  const programmatic = useRef(false);
  const scrollTimer = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const active =
    (documentSlice
      ? Object.values(segmentsByPage)
          .flat()
          .find((segment) => segment.id === segmentId)
      : null) ?? null;

  useEffect(() => {
    if (userScrolling) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let frame: number | null = null;
    let timeout: number | null = null;
    let attempts = 0;
    const navigate = () => {
      attempts += 1;
      programmatic.current = true;
      if (scrollPageIntoView(scroller, currentPage)) {
        timeout = window.setTimeout(() => {
          programmatic.current = false;
        }, 420);
        return;
      }
      programmatic.current = false;
      if (attempts < 4) {
        frame = window.requestAnimationFrame(navigate);
      }
    };

    navigate();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (timeout !== null) window.clearTimeout(timeout);
      programmatic.current = false;
    };
  }, [currentPage, userScrolling]);

  useEffect(() => {
    if (userScrolling || !active) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const highlight = scroller.querySelector('[data-highlight="active"]');
    if (!(highlight instanceof HTMLElement)) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const box = highlight.getBoundingClientRect();
    const threshold = scrollerRect.top + scrollerRect.height * 0.8;
    if (box.bottom > threshold || box.top < scrollerRect.top + 48) {
      programmatic.current = true;
      highlight.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => {
        programmatic.current = false;
      }, 420);
    }
  }, [active, userScrolling]);

  const takeControl = () => {
    if (!useReaderStore.getState().viewer.userScrolling) markUserScrolling(true);
  };

  if (!documentSlice) return null;
  const { model } = documentSlice;
  const pad = 48;
  const available = Math.max(280, containerWidth - pad);
  const first = model.pages[0];
  const baseWidth = first?.width ?? 612;

  function pageWidth(meta: PageMetadata): number {
    if (fitWidth) return Math.min(available, 920);
    return Math.min(available, meta.width * zoom);
  }

  const start = Math.max(1, currentPage - VIRTUAL_PAGE_WINDOW);
  const end = Math.min(model.pageCount, currentPage + VIRTUAL_PAGE_WINDOW);
  const visible = model.pages.filter((page) => page.page >= start && page.page <= end);

  return (
    <div
      ref={scrollerRef}
      className={cn("pdf-scroll h-full overflow-y-auto bg-bg px-3 py-6 sm:px-6")}
      // Only a real gesture hands the view to the reader. Scroll events alone
      // also fire for layout shifts while pages render and for the tail of our
      // own smooth follow-scroll, which used to switch auto-follow off within
      // seconds of opening a book.
      onWheel={takeControl}
      onTouchMove={takeControl}
      onPointerDown={(event) => {
        if (event.target === scrollerRef.current) takeControl();
      }}
      onKeyDown={(event) => {
        if (NAVIGATION_KEYS.has(event.key)) takeControl();
      }}
      onScroll={() => {
        if (programmatic.current || !userScrolling) return;
        if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
        scrollTimer.current = window.setTimeout(() => {
          const scroller = scrollerRef.current;
          if (!scroller) return;
          const center = scroller.scrollTop + scroller.clientHeight / 3;
          let closest = currentPage;
          let dist = Infinity;
          scroller.querySelectorAll("[data-page]").forEach((node) => {
            const page = Number(node.getAttribute("data-page"));
            const top = (node as HTMLElement).offsetTop;
            const d = Math.abs(top - center);
            if (d < dist) {
              dist = d;
              closest = page;
            }
          });
          if (closest !== currentPage) {
            useReaderStore.getState().patchViewer({ currentPage: closest });
          }
        }, 80);
      }}
    >
      <div className="mx-auto flex max-w-[960px] flex-col gap-8">
        {start > 1 && (
          <button
            type="button"
            className="self-center text-xs text-muted"
            onClick={() =>
              useReaderStore.getState().patchViewer({
                currentPage: Math.max(1, currentPage - 3),
                userScrolling: false,
              })
            }
          >
            Load earlier pages
          </button>
        )}
        {visible.map((meta) => (
          <PageCanvas
            key={meta.page}
            documentId={model.id}
            meta={meta}
            width={pageWidth(meta) || Math.min(available, baseWidth)}
            active={active}
            segments={segmentsByPage[meta.page] ?? []}
          />
        ))}
        {end < model.pageCount && (
          <button
            type="button"
            className="self-center text-xs text-muted"
            onClick={() =>
              useReaderStore.getState().patchViewer({
                currentPage: Math.min(model.pageCount, currentPage + 3),
                userScrolling: false,
              })
            }
          >
            Load later pages
          </button>
        )}
      </div>
    </div>
  );
}

import { appError, logError } from "../core/errors.ts";
import { hashBuffer } from "../core/hash.ts";
import type { ExtractedPage, PageMetadata, PDFDocumentModel } from "../core/types.ts";
import { isLikelyScanned, needsOcrVerification } from "./page-analyzer.ts";
import { recognizePageImage, reconcileOcrBlocks } from "./ocr-engine.ts";
import { itemsToBlocks, meaningfulLength } from "./text-extractor.ts";
import { OCR_DPI } from "../core/config.ts";
import {
  applyPageLayout,
  classifyLayoutPixelsSafely,
  LAYOUT_INPUT_SIZE,
  type SafeLayoutResult,
} from "../document/layout-classifier.ts";
import { getBrowserLayoutBackend } from "../document/onnx-layout-backend.ts";

type Pdfjs = typeof import("pdfjs-dist");
type PdfDocument = import("pdfjs-dist").PDFDocumentProxy;

let pdfjsLoader: Promise<Pdfjs> | null = null;
const docs = new Map<string, PdfDocument>();
const LAYOUT_PIXEL_BUDGET = 1_200_000;
const MAX_LAYOUT_CANVAS_SIDE = 4_096;

export function layoutRenderScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Layout page dimensions must be positive finite numbers.");
  }
  const areaScale = Math.sqrt(LAYOUT_PIXEL_BUDGET / (width * height));
  const sideScale = MAX_LAYOUT_CANVAS_SIDE / Math.max(width, height);
  return Math.min(1.5, areaScale, sideScale);
}

export async function getPdfjs(): Promise<Pdfjs> {
  if (!pdfjsLoader) {
    pdfjsLoader = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      return pdfjs;
    })();
  }
  return pdfjsLoader;
}

export async function openPdf(file: File): Promise<PDFDocumentModel> {
  const pdfjs = await getPdfjs();
  const buffer = await file.arrayBuffer();
  const id = await hashBuffer(buffer);
  if (docs.has(id)) {
    const existing = docs.get(id);
    if (existing) {
      return modelFrom(existing, id, file.name);
    }
  }
  try {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: "/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/standard_fonts/",
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    docs.set(id, pdf);
    return await modelFrom(pdf, id, file.name);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/password/i.test(message)) {
      throw appError("PDF_PASSWORD_REQUIRED", cause);
    }
    logError("PDF_LOAD_FAILED", cause);
    throw appError("PDF_LOAD_FAILED", cause);
  }
}

async function modelFrom(
  pdf: PdfDocument,
  id: string,
  filename: string,
): Promise<PDFDocumentModel> {
  const metadata = await pdf.getMetadata().catch(() => null);
  const info = (metadata?.info ?? {}) as {
    Title?: string;
    Author?: string;
  };
  const pages: PageMetadata[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({
      page: i,
      width: viewport.width,
      height: viewport.height,
      rotation: page.rotate,
    });
  }
  return {
    id,
    filename,
    pageCount: pdf.numPages,
    metadata: {
      title: info.Title || undefined,
      author: info.Author || undefined,
    },
    pages,
  };
}

export function getOpenPdf(id: string): PdfDocument | null {
  return docs.get(id) ?? null;
}

const inflight = new WeakMap<
  HTMLCanvasElement,
  { cancel: () => void; promise: Promise<unknown> }
>();
const renderGen = new WeakMap<HTMLCanvasElement, number>();
const renderLock = new WeakMap<HTMLCanvasElement, Promise<void>>();

async function withCanvasLock<T>(canvas: HTMLCanvasElement, fn: () => Promise<T>): Promise<T> {
  const previous = renderLock.get(canvas) ?? Promise.resolve();
  let release = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  renderLock.set(
    canvas,
    previous.then(
      () => current,
      () => current,
    ),
  );
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

export function cancelRender(canvas: HTMLCanvasElement): void {
  renderGen.set(canvas, (renderGen.get(canvas) ?? 0) + 1);
  const task = inflight.get(canvas);
  inflight.delete(canvas);
  if (!task) return;
  try {
    task.cancel();
  } catch {
    /* ignore */
  }
}

function isCancelled(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const name = "name" in cause ? String(cause.name) : "";
  const message = "message" in cause ? String(cause.message) : String(cause);
  return name === "RenderingCancelledException" || /cancel/i.test(name) || /cancel/i.test(message);
}

export async function renderPage(
  documentId: string,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  zoom: number,
): Promise<{ width: number; height: number }> {
  const pdf = docs.get(documentId);
  if (!pdf) throw appError("PAGE_RENDER_FAILED");
  const gen = (renderGen.get(canvas) ?? 0) + 1;
  renderGen.set(canvas, gen);

  return withCanvasLock(canvas, async () => {
    if (renderGen.get(canvas) !== gen) {
      return { width: canvas.clientWidth, height: canvas.clientHeight };
    }
    const previous = inflight.get(canvas);
    if (previous) {
      try {
        previous.cancel();
      } catch {
        /* ignore */
      }
      try {
        await previous.promise;
      } catch {
        /* cancelled */
      }
      inflight.delete(canvas);
    }
    if (renderGen.get(canvas) !== gen) {
      return { width: canvas.clientWidth, height: canvas.clientHeight };
    }
    try {
      const page = await pdf.getPage(pageNumber);
      if (renderGen.get(canvas) !== gen) {
        return { width: canvas.clientWidth, height: canvas.clientHeight };
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: zoom * dpr });
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw appError("PAGE_RENDER_FAILED");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const task = page.render({
        canvas,
        viewport,
      });
      inflight.set(canvas, task);
      await task.promise;
      inflight.delete(canvas);
      return {
        width: viewport.width / dpr,
        height: viewport.height / dpr,
      };
    } catch (cause) {
      inflight.delete(canvas);
      if (isCancelled(cause) || renderGen.get(canvas) !== gen) {
        return { width: canvas.clientWidth, height: canvas.clientHeight };
      }
      logError("PAGE_RENDER_FAILED", cause);
      throw appError("PAGE_RENDER_FAILED", cause);
    }
  });
}

const textLayerGen = new WeakMap<HTMLElement, number>();
const textLayerTask = new WeakMap<HTMLElement, { cancel: () => void; promise: Promise<unknown> }>();

export interface TextLayerSpan {
  element: HTMLElement;
  /** Matches DocumentBlock.itemIndex for the same page's extracted blocks. */
  itemIndex: number;
}

// Builds an invisible, precisely positioned text layer over a rendered page
// using pdf.js's own TextLayer - the same mechanism its standard viewer uses
// for text selection. Each span's position in the returned array matches its
// position in getTextContent().items, the same array itemsToBlocks() walks
// to assign DocumentBlock.itemIndex, so a caller can join a clicked span back
// to the exact block/segment it belongs to with no geometry guessing.
export async function renderTextLayer(
  documentId: string,
  pageNumber: number,
  container: HTMLElement,
  zoom: number,
): Promise<TextLayerSpan[]> {
  const pdf = docs.get(documentId);
  if (!pdf) throw appError("PAGE_RENDER_FAILED");
  const gen = (textLayerGen.get(container) ?? 0) + 1;
  textLayerGen.set(container, gen);

  const previous = textLayerTask.get(container);
  if (previous) {
    try {
      previous.cancel();
    } catch {
      /* ignore */
    }
    try {
      await previous.promise;
    } catch {
      /* cancelled */
    }
    textLayerTask.delete(container);
  }
  if (textLayerGen.get(container) !== gen) return [];

  try {
    const pdfjs = await getPdfjs();
    const page = await pdf.getPage(pageNumber);
    if (textLayerGen.get(container) !== gen) return [];
    const viewport = page.getViewport({ scale: zoom });
    const textContent = await page.getTextContent();
    if (textLayerGen.get(container) !== gen) return [];

    container.replaceChildren();
    const textLayer = new pdfjs.TextLayer({
      textContentSource: textContent,
      container,
      viewport,
    });
    textLayerTask.set(container, {
      cancel: () => textLayer.cancel(),
      promise: textLayer.render(),
    });
    await textLayerTask.get(container)?.promise;
    textLayerTask.delete(container);
    if (textLayerGen.get(container) !== gen) return [];

    return textLayer.textDivs.map((element, itemIndex) => ({ element, itemIndex }));
  } catch (cause) {
    textLayerTask.delete(container);
    if (isCancelled(cause) || textLayerGen.get(container) !== gen) return [];
    logError("PAGE_RENDER_FAILED", cause);
    return [];
  }
}

export function cancelTextLayer(container: HTMLElement): void {
  textLayerGen.set(container, (textLayerGen.get(container) ?? 0) + 1);
  const task = textLayerTask.get(container);
  textLayerTask.delete(container);
  if (!task) return;
  try {
    task.cancel();
  } catch {
    /* ignore */
  }
}

export async function extractPage(documentId: string, pageNumber: number): Promise<ExtractedPage> {
  const pdf = docs.get(documentId);
  if (!pdf) throw appError("TEXT_EXTRACTION_FAILED");
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const blocks = itemsToBlocks(
      pageNumber,
      content,
      viewport.width,
      viewport.height,
      viewport.transform as [number, number, number, number, number, number],
    );
    const textLength = meaningfulLength(blocks);
    return {
      documentId,
      page: pageNumber,
      width: viewport.width,
      height: viewport.height,
      blocks,
      scanned: isLikelyScanned(blocks),
      textLength,
    };
  } catch (cause) {
    logError("TEXT_EXTRACTION_FAILED", cause);
    throw appError("TEXT_EXTRACTION_FAILED", cause);
  }
}

function createOcrCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function classifyPageLayout(
  pdfPage: Awaited<ReturnType<PdfDocument["getPage"]>>,
  extracted: ExtractedPage,
): Promise<ExtractedPage> {
  let result: SafeLayoutResult;
  try {
    const base = pdfPage.getViewport({ scale: 1 });
    // OWASP A04:2025 Insecure Design.
    // Bound total pixels and each canvas side to limit memory use from hostile page dimensions.
    const scale = layoutRenderScale(base.width, base.height);
    const viewport = pdfPage.getViewport({ scale });
    const source = createOcrCanvas(
      Math.max(1, Math.floor(viewport.width)),
      Math.max(1, Math.floor(viewport.height)),
    );
    await pdfPage.render({ canvas: source, viewport }).promise;
    const input = createOcrCanvas(LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE);
    const context = input.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("Layout canvas is unavailable.");
    context.fillStyle = "white";
    context.fillRect(0, 0, LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE);
    context.drawImage(source, 0, 0, LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE);
    const image = context.getImageData(0, 0, LAYOUT_INPUT_SIZE, LAYOUT_INPUT_SIZE);
    const backend = await getBrowserLayoutBackend();
    result = await classifyLayoutPixelsSafely(
      {
        data: image.data,
        width: image.width,
        height: image.height,
        pageWidth: source.width,
        pageHeight: source.height,
      },
      backend,
    );
  } catch {
    result = {
      regions: [],
      diagnostic: "Layout classifier unavailable; retained rule-based content.",
    };
  }
  return applyPageLayout(extracted, result);
}

export async function extractPageWithOcr(
  documentId: string,
  pageNumber: number,
): Promise<ExtractedPage> {
  const native = await extractPage(documentId, pageNumber);
  const pdf = docs.get(documentId);
  if (!pdf) throw appError("OCR_FAILED");
  try {
    const page = await pdf.getPage(pageNumber);
    if (!needsOcrVerification(native.blocks)) {
      return classifyPageLayout(page, native);
    }
    const viewport = page.getViewport({ scale: OCR_DPI / 72 });
    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));
    const canvas = createOcrCanvas(width, height);
    const task = page.render({ canvas, viewport });
    await task.promise;
    const ocrBlocks = await recognizePageImage(canvas, pageNumber, width, height);
    const blocks = reconcileOcrBlocks(native.blocks, ocrBlocks);
    const reconciled = {
      ...native,
      blocks,
      ocrApplied: true,
      textLength: meaningfulLength(blocks),
    };
    return classifyPageLayout(page, reconciled);
  } catch (cause) {
    logError("OCR_FAILED", cause);
    throw appError("OCR_FAILED", cause);
  }
}

export function releasePdf(documentId: string): void {
  const pdf = docs.get(documentId);
  if (pdf) {
    void pdf.cleanup();
    docs.delete(documentId);
  }
}

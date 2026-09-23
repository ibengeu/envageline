import type { DocumentBlock } from "../core/types.ts";

interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface OcrLine {
  text: string;
  confidence: number;
  bbox: OcrBox;
}

interface OcrResultData {
  blocks: Array<{
    paragraphs: Array<{
      lines: OcrLine[];
    }>;
  }> | null;
}

export interface PixelWindow {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  originX: number;
  originY: number;
  pageWidth: number;
  pageHeight: number;
}

interface InkColumn {
  x: number;
  count: number;
  top: number;
  bottom: number;
}

type OcrImage = string | HTMLImageElement | HTMLCanvasElement | Blob | File | OffscreenCanvas;

const MAX_OCR_PIXELS = 20_000_000;
let workerPromise: Promise<import("tesseract.js").Worker> | null = null;
let jobQueue: Promise<void> = Promise.resolve();

function inkColumn(window: PixelWindow, x: number): InkColumn {
  let count = 0;
  let top = window.height;
  let bottom = -1;
  for (let y = 0; y < window.height; y += 1) {
    const offset = (y * window.width + x) * 4;
    const alpha = window.data[offset + 3] ?? 0;
    const luminance = ((window.data[offset] ?? 255) +
      (window.data[offset + 1] ?? 255) + (window.data[offset + 2] ?? 255)) / 3;
    if (alpha < 128 || luminance > 70) continue;
    count += 1;
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  return { x, count, top, bottom };
}

function solidVerticalBands(window: PixelWindow, minimumHeight: number): InkColumn[][] {
  const bands: InkColumn[][] = [];
  for (let x = 0; x < window.width; x += 1) {
    const column = inkColumn(window, x);
    if (column.count < minimumHeight) continue;
    const last = bands.at(-1);
    if (last && x - (last.at(-1)?.x ?? x) <= 2) last.push(column);
    else bands.push([column]);
  }
  return bands;
}

export function detectVisualDropCapI(
  window: PixelWindow,
  page: number,
  lineHeightPixels: number,
): DocumentBlock | null {
  const minimumHeight = Math.max(4, Math.floor(lineHeightPixels * 1.2));
  const bands = solidVerticalBands(window, minimumHeight);
  for (const band of bands) {
    const left = band[0]?.x ?? 0;
    const right = (band.at(-1)?.x ?? left) + 1;
    const top = Math.min(...band.map((column) => column.top));
    const bottom = Math.max(...band.map((column) => column.bottom)) + 1;
    const width = right - left;
    const height = bottom - top;
    const ink = band.reduce((sum, column) => sum + column.count, 0);
    if (width < 2 || height / width < 3 || ink / (width * height) < 0.55) continue;
    return {
      id: `p${page}-ocr-visual-drop-cap-i`,
      page,
      text: "I",
      bounds: {
        x: (window.originX + left) / window.pageWidth,
        y: (window.originY + top) / window.pageHeight,
        width: width / window.pageWidth,
        height: height / window.pageHeight,
      },
      fontSize: height / window.pageHeight,
      source: "ocr",
      confidence: 0.78,
    };
  }
  return null;
}

function finiteBox(box: OcrBox, width: number, height: number): boolean {
  return [box.x0, box.y0, box.x1, box.y1, width, height].every(Number.isFinite) &&
    width > 0 && height > 0 && box.x1 > box.x0 && box.y1 > box.y0;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function overlap(left: DocumentBlock["bounds"], right: DocumentBlock["bounds"]): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const leftArea = left.width * left.height;
  const rightArea = right.width * right.height;
  const smaller = Math.min(leftArea, rightArea);
  return smaller <= 0 ? 0 : intersection / smaller;
}

function normalizedText(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function sameWitnessText(left: string, right: string): boolean {
  const a = normalizedText(left);
  const b = normalizedText(right);
  return a === b || (a.length > 3 && (a.includes(b) || b.includes(a)));
}

function witnessText(blocks: DocumentBlock[]): string {
  return [...blocks]
    .sort((left, right) => left.bounds.x - right.bounds.x)
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join(" ");
}

function mixedWitness(
  nativeBlocks: DocumentBlock[],
  ocr: DocumentBlock,
): DocumentBlock {
  const nativeText = witnessText(nativeBlocks);
  const ocrAddsVisibleText = normalizedText(ocr.text).length > normalizedText(nativeText).length &&
    normalizedText(ocr.text).includes(normalizedText(nativeText));
  const first = nativeBlocks[0] ?? ocr;
  return {
    ...(ocrAddsVisibleText ? ocr : first),
    id: first.id,
    page: first.page,
    source: "mixed",
    confidence: ocr.confidence,
    witnesses: [
      { source: "pdf-text", text: nativeText },
      { source: "ocr", text: ocr.text, confidence: ocr.confidence },
    ],
  };
}

function matchingNativeBlocks(
  blocks: DocumentBlock[],
  ocr: DocumentBlock,
): DocumentBlock[] {
  return blocks.filter((native) =>
    native.source !== "ocr" && overlap(native.bounds, ocr.bounds) >= 0.35,
  );
}

export function reconcileOcrBlocks(
  nativeBlocks: DocumentBlock[],
  ocrBlocks: DocumentBlock[],
): DocumentBlock[] {
  let result = [...nativeBlocks];
  for (const ocr of ocrBlocks) {
    const matches = matchingNativeBlocks(result, ocr);
    if (matches.length === 0) {
      result.push(ocr);
      continue;
    }
    const nativeText = witnessText(matches);
    if (sameWitnessText(nativeText, ocr.text) && (ocr.confidence ?? 0) >= 0.7) {
      const matchedIds = new Set(matches.map((block) => block.id));
      result = result.filter((block) => !matchedIds.has(block.id));
      result.push(mixedWitness(matches, ocr));
      continue;
    }
    const witness = matches[0];
    if (!witness) continue;
    if ((ocr.confidence ?? 0) > 0.8 && (witness.confidence ?? 1) < 0.65) {
      const index = result.findIndex((block) => block.id === witness.id);
      if (index >= 0) {
        result[index] = {
          ...ocr,
          id: witness.id,
          source: "mixed",
          witnesses: [
            { source: "pdf-text", text: witness.text, confidence: witness.confidence },
            { source: "ocr", text: ocr.text, confidence: ocr.confidence },
          ],
        };
      }
    } else {
      const index = result.findIndex((block) => block.id === witness.id);
      if (index >= 0) {
        result[index] = {
          ...witness,
          source: "mixed",
          witnesses: [
            { source: "pdf-text", text: witness.text, confidence: witness.confidence },
            { source: "ocr", text: ocr.text, confidence: ocr.confidence },
          ],
        };
      }
    }
  }
  return result.sort((left, right) =>
    left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x,
  );
}

export function ocrResultToBlocks(
  page: number,
  data: OcrResultData,
  imageWidth: number,
  imageHeight: number,
): DocumentBlock[] {
  const lines = data.blocks?.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines),
  ) ?? [];
  return lines.flatMap((line, index) => {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!text || !finiteBox(line.bbox, imageWidth, imageHeight)) return [];
    const left = clamp(line.bbox.x0 / imageWidth);
    const top = clamp(line.bbox.y0 / imageHeight);
    const right = clamp(line.bbox.x1 / imageWidth);
    const bottom = clamp(line.bbox.y1 / imageHeight);
    if (right <= left || bottom <= top) return [];
    return [{
      id: `p${page}-ocr${index}`,
      page,
      text,
      bounds: { x: left, y: top, width: right - left, height: bottom - top },
      fontSize: bottom - top,
      source: "ocr" as const,
      confidence: clamp(line.confidence / 100),
      itemIndex: index,
    }];
  });
}

interface PixelCanvasContext {
  getImageData(x: number, y: number, width: number, height: number): ImageData;
}

interface PixelCanvasSource {
  getContext(type: "2d", options?: { willReadFrequently?: boolean }): PixelCanvasContext | null;
}

function visualDropCapBlock(
  image: OcrImage,
  blocks: DocumentBlock[],
  page: number,
  imageWidth: number,
  imageHeight: number,
): DocumentBlock | null {
  const firstLine = [...blocks]
    .filter((block) => /^\p{Ll}/u.test(block.text.trim()) && block.text.trim().length >= 10)
    .sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x)[0];
  if (!firstLine || typeof image !== "object" || image === null || !("getContext" in image)) {
    return null;
  }
  const lineHeight = Math.max(1, Math.ceil(firstLine.bounds.height * imageHeight));
  const originX = Math.max(0, Math.floor((firstLine.bounds.x - 0.12) * imageWidth));
  const right = Math.max(originX + 1, Math.floor(firstLine.bounds.x * imageWidth));
  const originY = Math.max(0, Math.floor((firstLine.bounds.y - firstLine.bounds.height * 0.5) * imageHeight));
  const bottom = Math.min(
    imageHeight,
    Math.ceil((firstLine.bounds.y + firstLine.bounds.height * 3) * imageHeight),
  );
  const context = (image as unknown as PixelCanvasSource).getContext("2d", {
    willReadFrequently: true,
  });
  if (!context || right <= originX || bottom <= originY) return null;
  // OWASP A04:2025 Insecure Design.
  // Read only the bounded margin window to avoid a second full-page pixel allocation.
  const pixels = context.getImageData(originX, originY, right - originX, bottom - originY);
  return detectVisualDropCapI({
    data: pixels.data,
    width: pixels.width,
    height: pixels.height,
    originX,
    originY,
    pageWidth: imageWidth,
    pageHeight: imageHeight,
  }, page, lineHeight);
}

async function localWorker(): Promise<import("tesseract.js").Worker> {
  if (!workerPromise) {
    workerPromise = createLocalWorker();
  }
  return workerPromise;
}

async function createLocalWorker(): Promise<import("tesseract.js").Worker> {
  const [{ createWorker, OEM }, coreModule, workerModule] = await Promise.all([
    import("tesseract.js"),
    import("tesseract.js-core/tesseract-core-lstm.wasm.js?url"),
    import("tesseract.js/dist/worker.min.js?url"),
  ]);
  // OWASP A02:2025 Security Misconfiguration.
  // Local-only asset paths prevent document access patterns from leaking to OCR CDNs.
  return createWorker("eng", OEM.LSTM_ONLY, {
    corePath: coreModule.default,
    workerPath: workerModule.default,
    langPath: "/ocr/lang",
    gzip: true,
    workerBlobURL: false,
  });
}

export async function recognizePageImage(
  image: OcrImage,
  page: number,
  imageWidth: number,
  imageHeight: number,
): Promise<DocumentBlock[]> {
  // OWASP A04:2025 Insecure Design.
  // Bound OCR pixels and serialize jobs to prevent memory and worker exhaustion.
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) ||
      imageWidth <= 0 || imageHeight <= 0 || imageWidth * imageHeight > MAX_OCR_PIXELS) {
    throw new Error("OCR image exceeds the safe pixel limit");
  }
  let release = () => {};
  const previous = jobQueue;
  jobQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const worker = await localWorker();
    const result = await worker.recognize(image, {}, { blocks: true, text: true });
    const blocks = ocrResultToBlocks(page, result.data, imageWidth, imageHeight);
    const dropCap = visualDropCapBlock(image, blocks, page, imageWidth, imageHeight);
    return dropCap ? [dropCap, ...blocks] : blocks;
  } finally {
    release();
  }
}

export async function terminateOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (pending) await (await pending).terminate();
}

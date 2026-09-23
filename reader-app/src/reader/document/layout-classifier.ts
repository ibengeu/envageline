import type { BoundingBox, DocumentBlock, ElementRole, ExtractedPage } from "../core/types.ts";

export const LAYOUT_MODEL_ID = "pp-doclayout-s-onnx";
export const LAYOUT_MODEL_PATH = "/models/pp_doclayout_s.onnx";
export const LAYOUT_MODEL_SHA256 =
  "33688dbee1c23e34b81777e97cb428eb40f24b242c02b5f623484959e830aec8";
export const LAYOUT_INPUT_SIZE = 480;

const IMAGE_MEAN = [0.485, 0.456, 0.406] as const;
const IMAGE_STD = [0.229, 0.224, 0.225] as const;

const CLASS_ROLES: ReadonlyArray<ElementRole> = [
  "heading",
  "decorative",
  "paragraph",
  "page-number",
  "paragraph",
  "navigation",
  "caption",
  "formula",
  "table",
  "caption",
  "reference",
  "title",
  "footnote",
  "header",
  "code",
  "footer",
  "decorative",
  "caption",
  "decorative",
  "formula",
  "decorative",
  "decorative",
  "sidebar",
];

export interface LayoutRegion {
  role: ElementRole;
  confidence: number;
  bounds: BoundingBox;
  modelId: typeof LAYOUT_MODEL_ID;
  classId: number;
}

export interface AppliedLayoutRegions {
  blocks: DocumentBlock[];
  unmatchedRegions: LayoutRegion[];
}

export interface LayoutPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

export interface LayoutInferenceBackend {
  run(
    image: Float32Array,
    scaleFactor: Float32Array,
  ): Promise<{ detections: ArrayLike<number>; count: number }>;
}

function normalizedImage(pixels: LayoutPixels): Float32Array {
  // OWASP A04:2025 Insecure Design.
  // Require the fixed model input size to bound memory and CPU use from untrusted PDFs.
  if (
    pixels.width !== LAYOUT_INPUT_SIZE ||
    pixels.height !== LAYOUT_INPUT_SIZE ||
    pixels.data.length !== LAYOUT_INPUT_SIZE * LAYOUT_INPUT_SIZE * 4
  ) {
    throw new Error("Layout input must be a 480 by 480 RGBA image.");
  }
  const plane = LAYOUT_INPUT_SIZE * LAYOUT_INPUT_SIZE;
  const result = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const rgbaOffset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = (pixels.data[rgbaOffset + channel] ?? 0) / 255;
      result[channel * plane + pixel] = (value - IMAGE_MEAN[channel]) / IMAGE_STD[channel];
    }
  }
  return result;
}

export async function classifyLayoutPixels(
  pixels: LayoutPixels,
  backend: LayoutInferenceBackend,
): Promise<LayoutRegion[]> {
  if (pixels.pageWidth <= 0 || pixels.pageHeight <= 0) {
    throw new Error("Layout page dimensions must be positive.");
  }
  const scaleFactor = new Float32Array([
    LAYOUT_INPUT_SIZE / pixels.pageHeight,
    LAYOUT_INPUT_SIZE / pixels.pageWidth,
  ]);
  const output = await backend.run(normalizedImage(pixels), scaleFactor);
  return decodeLayoutDetections(
    output.detections,
    output.count,
    pixels.pageWidth,
    pixels.pageHeight,
  );
}

export interface SafeLayoutResult {
  regions: LayoutRegion[];
  diagnostic?: string;
}

const DEFAULT_INFERENCE_TIMEOUT_MS = 30_000;

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Layout classifier timed out.")), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function classifyLayoutPixelsSafely(
  pixels: LayoutPixels,
  backend: LayoutInferenceBackend,
  timeoutMs = DEFAULT_INFERENCE_TIMEOUT_MS,
): Promise<SafeLayoutResult> {
  try {
    // OWASP A04:2025 Insecure Design.
    // Bound model execution time so a malformed page cannot block playback indefinitely.
    return { regions: await withTimeout(classifyLayoutPixels(pixels, backend), timeoutMs) };
  } catch {
    return {
      regions: [],
      diagnostic: "Layout classifier unavailable; retained rule-based content.",
    };
  }
}

function hexadecimal(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function verifyLayoutModelChecksum(bytes: Uint8Array): Promise<void> {
  // OWASP A03:2025 Software Supply Chain Failures.
  // Verify the pinned model before execution to prevent tampered inference code or weights.
  const ownedBytes = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", ownedBytes);
  if (hexadecimal(new Uint8Array(digest)) !== LAYOUT_MODEL_SHA256) {
    throw new Error("Layout model integrity check failed.");
  }
}

function intersectionArea(left: BoundingBox, right: BoundingBox): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return width * height;
}

function coverage(block: DocumentBlock, region: LayoutRegion): number {
  const area = block.bounds.width * block.bounds.height;
  return area > 0 ? intersectionArea(block.bounds, region.bounds) / area : 0;
}

function bestRegion(block: DocumentBlock, regions: LayoutRegion[]): LayoutRegion | undefined {
  return regions
    .filter((region) => region.confidence >= 0.65 && coverage(block, region) >= 0.5)
    .sort(
      (left, right) =>
        right.confidence * coverage(block, right) - left.confidence * coverage(block, left),
    )[0];
}

export function applyLayoutRegions(
  blocks: DocumentBlock[],
  regions: LayoutRegion[],
): AppliedLayoutRegions {
  const matched = new Set<LayoutRegion>();
  const annotated = blocks.map((block) => {
    const region = bestRegion(block, regions);
    if (!region) return block;
    matched.add(region);
    return {
      ...block,
      type: region.role,
      layout: {
        modelId: region.modelId,
        role: region.role,
        confidence: region.confidence,
      },
    };
  });
  return {
    blocks: annotated,
    unmatchedRegions: regions.filter((region) => !matched.has(region)),
  };
}

export function applyPageLayout(page: ExtractedPage, result: SafeLayoutResult): ExtractedPage {
  const applied = applyLayoutRegions(page.blocks, result.regions);
  return {
    ...page,
    blocks: applied.blocks,
    layoutAttempted: true,
    layoutRegions: applied.unmatchedRegions,
    diagnostics: result.diagnostic
      ? [...(page.diagnostics ?? []), result.diagnostic]
      : page.diagnostics,
  };
}

function normalizedBounds(
  values: ArrayLike<number>,
  offset: number,
  pageWidth: number,
  pageHeight: number,
): BoundingBox | null {
  const x1 = values[offset + 2];
  const y1 = values[offset + 3];
  const x2 = values[offset + 4];
  const y2 = values[offset + 5];
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  const left = Math.max(0, Math.min(pageWidth, x1 ?? 0));
  const top = Math.max(0, Math.min(pageHeight, y1 ?? 0));
  const right = Math.max(left, Math.min(pageWidth, x2 ?? 0));
  const bottom = Math.max(top, Math.min(pageHeight, y2 ?? 0));
  if (right === left || bottom === top) return null;
  return {
    x: left / pageWidth,
    y: top / pageHeight,
    width: (right - left) / pageWidth,
    height: (bottom - top) / pageHeight,
  };
}

export function decodeLayoutDetections(
  detections: ArrayLike<number>,
  count: number,
  pageWidth: number,
  pageHeight: number,
): LayoutRegion[] {
  if (pageWidth <= 0 || pageHeight <= 0) return [];
  const available = Math.min(Math.max(0, Math.floor(count)), Math.floor(detections.length / 6));
  const regions: LayoutRegion[] = [];
  for (let index = 0; index < available; index += 1) {
    const offset = index * 6;
    const classId = Math.floor(detections[offset] ?? -1);
    const confidence = detections[offset + 1] ?? Number.NaN;
    const role = CLASS_ROLES[classId];
    const bounds = normalizedBounds(detections, offset, pageWidth, pageHeight);
    if (!role || !Number.isFinite(confidence) || confidence < 0.3 || !bounds) continue;
    regions.push({ role, confidence, bounds, modelId: LAYOUT_MODEL_ID, classId });
  }
  return regions;
}

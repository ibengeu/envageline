import type { DocumentBlock } from "../core/types.ts";

interface PdfTextItem {
  str?: string;
  dir?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
}

interface PdfTextStyle {
  ascent?: number;
  descent?: number;
}

interface PdfTextContent {
  items: unknown[];
  styles?: Record<string, PdfTextStyle | undefined>;
}

interface GlyphExtent {
  rise: number;
  drop: number;
}

type Transform = readonly [number, number, number, number, number, number];

const DEFAULT_VIEWPORT_TRANSFORM = (pageHeight: number): Transform => [1, 0, 0, -1, 0, pageHeight];

export function itemsToBlocks(
  pageNumber: number,
  content: PdfTextContent,
  pageWidth: number,
  pageHeight: number,
  viewportTransform: Transform = DEFAULT_VIEWPORT_TRANSFORM(pageHeight),
): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  for (const [itemIndex, raw] of content.items.entries()) {
    const item = raw as PdfTextItem;
    const text = (item.str ?? "").replace(/\u00a0/g, " ");
    if (!text.trim()) continue;
    const transform = item.transform ?? [1, 0, 0, 1, 0, 0];
    const horizontalScale = Math.hypot(transform[0] ?? 0, transform[1] ?? 0);
    const verticalScale = Math.hypot(transform[2] ?? 0, transform[3] ?? 0);
    const widthPdf = item.width ?? horizontalScale * text.length * 0.5;
    const heightPdf = item.height ?? (verticalScale || horizontalScale || 12);
    const fontSize = verticalScale || horizontalScale || heightPdf;
    const extent = glyphExtent(content.styles?.[item.fontName ?? ""], fontSize, heightPdf);
    const bounds = normalizedItemBounds(
      transform,
      widthPdf,
      extent,
      viewportTransform,
      pageWidth,
      pageHeight,
    );
    if (!bounds) continue;
    blocks.push({
      id: `p${pageNumber}-b${itemIndex}`,
      page: pageNumber,
      text,
      bounds: {
        ...bounds,
      },
      fontSize: pageHeight === 0 ? fontSize : fontSize / pageHeight,
      fontName: item.fontName,
      source: "pdf-text",
      itemIndex,
      direction: item.dir,
      hasEOL: item.hasEOL,
      transform: [...transform],
    });
  }
  return blocks;
}

// pdf.js reports ascent/descent as em fractions of the font size. They describe
// where glyphs actually sit around the baseline, which is tighter and lower than
// the full em box the item height spans.
function glyphExtent(
  style: PdfTextStyle | undefined,
  fontSize: number,
  fallbackHeight: number,
): GlyphExtent {
  const ascent = style?.ascent;
  const descent = style?.descent;
  const usable =
    Number.isFinite(ascent) &&
    Number.isFinite(descent) &&
    (ascent as number) > 0 &&
    fontSize > 0;
  // A font without usable metrics keeps the em box instead of an empty rectangle.
  if (!usable) return { rise: fallbackHeight, drop: 0 };
  return {
    rise: (ascent as number) * fontSize,
    drop: Math.abs(descent as number) * fontSize,
  };
}

function normalizedItemBounds(
  itemTransform: number[],
  width: number,
  extent: GlyphExtent,
  viewportTransform: Transform,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } | null {
  const itemMatrix: Transform = [
    itemTransform[0] ?? 0,
    itemTransform[1] ?? 0,
    itemTransform[2] ?? 0,
    itemTransform[3] ?? 0,
    itemTransform[4] ?? 0,
    itemTransform[5] ?? 0,
  ];
  // OWASP A04:2025 Insecure Design.
  // Validate untrusted PDF geometry before it can create invalid layout values.
  if (
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    pageWidth <= 0 ||
    pageHeight <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(extent.rise) ||
    !Number.isFinite(extent.drop) ||
    width <= 0 ||
    extent.rise + extent.drop <= 0 ||
    [...itemMatrix, ...viewportTransform].some((value) => !Number.isFinite(value))
  ) {
    return null;
  }
  const combined = multiplyTransform(viewportTransform, itemMatrix);
  // pdf.js reports item.width/item.height in unscaled page units, so the glyph
  // box is built from the item origin and the viewport scale only. Pushing the
  // size through `combined` would re-apply the font matrix scale.
  const origin = applyTransform(combined, 0, 0);
  const scaleX = Math.hypot(viewportTransform[0], viewportTransform[1]);
  const scaleY = Math.hypot(viewportTransform[2], viewportTransform[3]);
  const spanX = applyTransform(combined, 1, 0);
  const spanY = applyTransform(combined, 0, 1);
  const unitX = unitVector(spanX[0] - origin[0], spanX[1] - origin[1]);
  const unitY = unitVector(spanY[0] - origin[0], spanY[1] - origin[1]);
  const deviceWidth = width * scaleX;
  const ascentPoint = offsetPoint(origin, unitY, extent.rise * scaleY);
  const descentPoint = offsetPoint(origin, unitY, -extent.drop * scaleY);
  const points = [
    descentPoint,
    offsetPoint(descentPoint, unitX, deviceWidth),
    offsetPoint(ascentPoint, unitX, deviceWidth),
    ascentPoint,
  ];
  const minX = Math.min(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxX = Math.max(...points.map(([x]) => x));
  const maxY = Math.max(...points.map(([, y]) => y));
  const left = clamp01(minX / pageWidth);
  const top = clamp01(minY / pageHeight);
  const right = clamp01(maxX / pageWidth);
  const bottom = clamp01(maxY / pageHeight);
  if (right <= left || bottom <= top) return null;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function unitVector(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length === 0) return [0, 0];
  return [x / length, y / length];
}

function offsetPoint(
  point: [number, number],
  unit: [number, number],
  distance: number,
): [number, number] {
  return [point[0] + unit[0] * distance, point[1] + unit[1] * distance];
}

function multiplyTransform(left: Transform, right: readonly number[]): Transform {
  return [
    left[0] * (right[0] ?? 0) + left[2] * (right[1] ?? 0),
    left[1] * (right[0] ?? 0) + left[3] * (right[1] ?? 0),
    left[0] * (right[2] ?? 0) + left[2] * (right[3] ?? 0),
    left[1] * (right[2] ?? 0) + left[3] * (right[3] ?? 0),
    left[0] * (right[4] ?? 0) + left[2] * (right[5] ?? 0) + left[4],
    left[1] * (right[4] ?? 0) + left[3] * (right[5] ?? 0) + left[5],
  ];
}

function applyTransform(transform: Transform, x: number, y: number): [number, number] {
  return [
    transform[0] * x + transform[2] * y + transform[4],
    transform[1] * x + transform[3] * y + transform[5],
  ];
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function meaningfulLength(blocks: DocumentBlock[]): number {
  const text = blocks
    .map((block) => block.text)
    .join(" ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
  return text.length;
}

export function unicodeQuality(blocks: DocumentBlock[]): number {
  const joined = blocks.map((block) => block.text).join("");
  if (!joined.length) return 0;
  let ok = 0;
  for (const char of joined) {
    const code = char.charCodeAt(0);
    if (code === 32 || (code >= 9 && code <= 13) || (code >= 32 && code !== 0xfffd)) {
      ok += 1;
    }
  }
  return ok / joined.length;
}

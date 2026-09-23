import type { ContentFilters } from "../narration/reading-profile.ts";

export type ProcessingState =
  | "unprocessed"
  | "extracting"
  | "text-ready"
  | "ocr-required"
  | "ocr-processing"
  | "layout-processing"
  | "narration-ready"
  | "error";

export type PlaybackState =
  | "idle"
  | "preparing"
  | "playing"
  | "paused"
  | "buffering"
  | "completed"
  | "error";

export type DocumentBlockType =
  | "title"
  | "heading"
  | "paragraph"
  | "list-item"
  | "quote"
  | "caption"
  | "footnote"
  | "header"
  | "footer"
  | "page-number"
  | "table"
  | "code"
  | "reference"
  | "unknown";

export type ElementRole =
  | DocumentBlockType
  | "sidebar"
  | "callout"
  | "formula"
  | "watermark"
  | "metadata"
  | "citation"
  | "navigation"
  | "back-matter"
  | "decorative";

export type ReadingAction = "inline" | "separate" | "summary-required" | "omit";
export type BuiltInReadingProfileId = "audiobook" | "inclusive" | "diagnostic";

export type ClassificationSignal =
  | "position"
  | "repetition"
  | "sequence"
  | "typography"
  | "lexical-shape"
  | "neighbor-context"
  | "document-structure"
  | "source-confidence"
  | "layout-model";

export interface ClassificationEvidence {
  signal: ClassificationSignal;
  weight: number;
  detail: string;
}

export type ElementRelationshipType =
  | "belongs-to-section"
  | "footnote-for"
  | "continues"
  | "caption-for"
  | "citation-for"
  | "reading-order-after";

export interface ElementRelationship {
  type: ElementRelationshipType;
  targetId: string;
  confidence: number;
}

export interface DocumentElement {
  id: string;
  page: number;
  text: string;
  bounds: BoundingBox[];
  sourceBlockIds: string[];
  source: "pdf-text" | "ocr" | "mixed";
  role: ElementRole;
  roleConfidence: number;
  omissionConfidence: number;
  evidence: ClassificationEvidence[];
  relationships: ElementRelationship[];
  readingOrder: number;
  headingLevel?: number;
  fontSize?: number;
  fontName?: string;
}

export interface DocumentSection {
  id: string;
  title: string;
  level: number;
  page: number;
  headingElementId: string;
  parentId?: string;
}

export interface ReadingProfile {
  id: "audiobook" | "inclusive" | "diagnostic" | string;
  minimumClassificationConfidence: number;
  minimumOmissionConfidence: number;
  includeInlineCitations?: boolean;
  policies: Record<ElementRole, ReadingAction>;
}

export interface DocumentAnalysis {
  documentId: string;
  elements: DocumentElement[];
  sections: DocumentSection[];
  nonNarrative: DocumentElement[];
  diagnostics: string[];
}

export type NarrationSegmentType =
  | "title"
  | "heading"
  | "paragraph"
  | "list"
  | "caption"
  | "table-row";

export type ErrorCode =
  | "PDF_LOAD_FAILED"
  | "PDF_PASSWORD_REQUIRED"
  | "PAGE_RENDER_FAILED"
  | "TEXT_EXTRACTION_FAILED"
  | "OCR_FAILED"
  | "NARRATION_FAILED"
  | "TTS_FAILED"
  | "STORAGE_FAILED";

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentBlock {
  id: string;
  page: number;
  text: string;
  bounds: BoundingBox;
  fontSize?: number;
  fontName?: string;
  source: "pdf-text" | "ocr" | "mixed";
  confidence?: number;
  witnesses?: Array<{
    source: "pdf-text" | "ocr";
    text: string;
    confidence?: number;
  }>;
  layout?: {
    modelId: string;
    role: ElementRole;
    confidence: number;
  };
  type?: ElementRole;
  direction?: string;
  hasEOL?: boolean;
  transform?: number[];
  /** Position of this block's source item in pdf.js's raw getTextContent()
   * items array - lets a rendered text-layer span (indexed the same way) be
   * matched back to this block without re-deriving the extractor's filtering. */
  itemIndex?: number;
}

export interface NarrationSegment {
  id: string;
  documentId: string;
  page: number;
  type: NarrationSegmentType;
  originalText: string;
  spokenText: string;
  sourceBlockIds: string[];
  bounds: BoundingBox[];
  /** Where a sentence that crosses a page break carries on: its boxes on the
   * following page. `bounds` always belongs to `page`. */
  continuedOn?: {
    page: number;
    bounds: BoundingBox[];
  };
  order: number;
  paragraphId: string;
  speech?: {
    rateModifier?: number;
    pauseBeforeMs?: number;
    pauseAfterMs?: number;
  };
}

export interface PageMetadata {
  page: number;
  width: number;
  height: number;
  rotation: number;
}

export interface PDFDocumentModel {
  id: string;
  filename: string;
  pageCount: number;
  metadata: {
    title?: string;
    author?: string;
  };
  pages: PageMetadata[];
}

export interface ExtractedPage {
  documentId: string;
  page: number;
  width: number;
  height: number;
  blocks: DocumentBlock[];
  scanned: boolean;
  ocrApplied?: boolean;
  layoutAttempted?: boolean;
  layoutRegions?: Array<{
    role: ElementRole;
    confidence: number;
    bounds: BoundingBox;
    modelId: string;
    classId: number;
  }>;
  diagnostics?: string[];
  textLength: number;
}

export interface DocumentHints {
  headerTexts: string[];
  footerTexts: string[];
  lastHeading: string | null;
}

export interface ReadingProgress {
  documentId: string;
  page: number;
  segmentId: string | null;
  segmentIndex: number;
  updatedAt: number;
}

export interface StoredDocument {
  id: string;
  filename: string;
  pageCount: number;
  title?: string;
  createdAt: number;
  lastOpenedAt: number;
  processingVersion: number;
  byteLength: number;
}

export interface RecentDocument extends StoredDocument {
  progress?: ReadingProgress;
}

export interface TTSVoice {
  id: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface TTSOptions {
  rate: number;
  voiceId: string | null;
}

export interface AppError {
  code: ErrorCode;
  message: string;
}

export interface ReaderSettings {
  rate: number;
  voiceId: string | null;
  skipCaptions: boolean;
  skipFootnotes: boolean;
  skipReferences: boolean;
  readingProfileId: BuiltInReadingProfileId;
  contentFilters: ContentFilters;
  skipIntervalSeconds: number;
}

export interface ViewerState {
  currentPage: number;
  zoom: number;
  fitWidth: boolean;
  userScrolling: boolean;
}

export interface PlaybackSlice {
  status: PlaybackState;
  currentSegmentId: string | null;
  currentSegmentIndex: number;
  rate: number;
  voiceId: string | null;
  voices: TTSVoice[];
}

export interface ProcessingSlice {
  activePage: number | null;
  queuedPages: number[];
  pageStates: Record<number, ProcessingState>;
}

export interface DocumentSlice {
  model: PDFDocumentModel;
  file: File;
}

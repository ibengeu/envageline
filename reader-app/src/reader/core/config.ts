export const APP_NAME = "Auralis";
export const APP_TAGLINE = "Listen to any PDF.";

export const PROCESSING_VERSION = 8;

export const SCAN_TEXT_THRESHOLD = 20;
export const HEADER_BAND = 0.12;
export const FOOTER_BAND = 0.12;
export const COLUMN_GUTTER_MIN = 0.08;
export const LINE_Y_TOLERANCE = 0.45;
export const PARAGRAPH_GAP_FACTOR = 1.6;
export const PREFETCH_PAGES = 2;
export const MAX_PREFETCH_PAGES = 6;
export const VIRTUAL_PAGE_WINDOW = 2;
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 2.4;
export const DEFAULT_RATE = 1;
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;
export const RATE_STEP = 0.05;
export const RATE_PRESETS = [0.75, 1, 1.25, 1.5, 2] as const;
export const DB_NAME = "auralis";
export const DB_VERSION = 2;
export const MAX_CACHED_DOCUMENTS = 6;
export const MAX_CACHED_BYTES = 80 * 1024 * 1024;
export const OCR_DPI = 180;

export const NARRATION_POLICY = {
  title: "read",
  heading: "read",
  paragraph: "read",
  list: "read",
  quote: "read",
  caption: "skip",
  header: "skip",
  footer: "skip",
  "page-number": "skip",
  footnote: "skip",
  table: "skip",
  code: "skip",
  reference: "skip",
  "list-item": "read",
  unknown: "read",
} as const;

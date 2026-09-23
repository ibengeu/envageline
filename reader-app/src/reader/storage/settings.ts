import { DEFAULT_RATE, MAX_RATE, MIN_RATE } from "../core/config.ts";
import type { BuiltInReadingProfileId, ReaderSettings } from "../core/types.ts";
import { DEFAULT_CONTENT_FILTERS, type ContentFilters } from "../narration/reading-profile.ts";

export const SKIP_INTERVALS = [10, 15, 30, 45, 60] as const;
export const DEFAULT_SKIP_INTERVAL = 30;

export const DEFAULT_SETTINGS: ReaderSettings = {
  rate: DEFAULT_RATE,
  voiceId: null,
  skipCaptions: true,
  skipFootnotes: true,
  skipReferences: true,
  readingProfileId: "audiobook",
  contentFilters: { ...DEFAULT_CONTENT_FILTERS },
  skipIntervalSeconds: DEFAULT_SKIP_INTERVAL,
};

const PROFILE_IDS: BuiltInReadingProfileId[] = ["audiobook", "inclusive", "diagnostic"];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function contentFilters(value: unknown): ContentFilters {
  const row = record(value);
  const defaults = DEFAULT_CONTENT_FILTERS;
  return {
    skipPublisherMatter: flag(row.skipPublisherMatter, defaults.skipPublisherMatter),
    skipNavigation: flag(row.skipNavigation, defaults.skipNavigation),
    skipBackMatter: flag(row.skipBackMatter, defaults.skipBackMatter),
    skipRunningText: flag(row.skipRunningText, defaults.skipRunningText),
    footnotes: row.footnotes === "read" || row.footnotes === "skip" ? row.footnotes : defaults.footnotes,
    skipReferences: flag(row.skipReferences, defaults.skipReferences),
  };
}

// OWASP A08:2025 Software or Data Integrity Failures - persisted settings are
// read back as untrusted input: every field is type- and range-checked, and
// anything unexpected falls back to its default instead of reaching the
// player or the reading profile.
export function sanitizeSettings(value: unknown): ReaderSettings {
  const row = record(value);
  const rate = typeof row.rate === "number" && Number.isFinite(row.rate)
    ? Math.min(MAX_RATE, Math.max(MIN_RATE, row.rate))
    : DEFAULT_SETTINGS.rate;
  const interval = SKIP_INTERVALS.find((seconds) => seconds === row.skipIntervalSeconds);
  return {
    rate,
    voiceId: typeof row.voiceId === "string" && row.voiceId.length <= 100 ? row.voiceId : null,
    skipCaptions: flag(row.skipCaptions, true),
    skipFootnotes: flag(row.skipFootnotes, true),
    skipReferences: flag(row.skipReferences, true),
    readingProfileId: PROFILE_IDS.find((id) => id === row.readingProfileId) ?? "audiobook",
    contentFilters: contentFilters(row.contentFilters),
    skipIntervalSeconds: interval ?? DEFAULT_SKIP_INTERVAL,
  };
}

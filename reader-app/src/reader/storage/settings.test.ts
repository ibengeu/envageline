import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CONTENT_FILTERS } from "../narration/reading-profile.ts";
import { sanitizeSettings } from "./settings.ts";

describe("stored settings", () => {
  it("falls back to safe defaults for malformed or tampered values", () => {
    const settings = sanitizeSettings({
      rate: "fast",
      voiceId: { evil: true },
      readingProfileId: "<script>",
      contentFilters: { skipPublisherMatter: "no", footnotes: 7 },
      skipIntervalSeconds: -40,
    });

    assert.equal(settings.rate, 1);
    assert.equal(settings.voiceId, null);
    assert.equal(settings.readingProfileId, "audiobook");
    assert.deepEqual(settings.contentFilters, DEFAULT_CONTENT_FILTERS);
    assert.equal(settings.skipIntervalSeconds, 30);
  });
});

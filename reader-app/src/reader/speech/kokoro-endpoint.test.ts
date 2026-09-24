import assert from "node:assert/strict";
import { it } from "node:test";
import {
  DEFAULT_KOKORO_BASE,
  isAllowedNarrationBase,
  isLoopbackEndpoint,
  narrationBase,
  resolveKokoroUrls,
  SAME_ORIGIN,
} from "./kokoro-endpoint.ts";

it("accepts a loopback Kokoro endpoint", () => {
  assert.equal(isLoopbackEndpoint("http://127.0.0.1:8880"), true);
});

it("rejects a non-loopback Kokoro endpoint", () => {
  assert.equal(isLoopbackEndpoint("http://example.invalid:8880"), false);
});

it("derives Kokoro speech and voice URLs from the base endpoint", () => {
  assert.deepEqual(resolveKokoroUrls("http://127.0.0.1:8880"), {
    speechUrl: "http://127.0.0.1:8880/v1/audio/speech",
    voicesUrl: "http://127.0.0.1:8880/v1/audio/voices",
  });
});

it("uses the documented loopback Kokoro endpoint by default", () => {
  assert.equal(DEFAULT_KOKORO_BASE, "http://127.0.0.1:8880");
});

it("accepts narration served by the reader's own site", () => {
  assert.equal(isAllowedNarrationBase(SAME_ORIGIN), true);
});

it("speaks through the reader's own site when narration is served there", () => {
  assert.deepEqual(resolveKokoroUrls(SAME_ORIGIN), {
    speechUrl: "/v1/audio/speech",
    voicesUrl: "/v1/audio/voices",
  });
});

it("still refuses narration on any other host, however it is written", () => {
  for (const base of ["https://evil.example", "//evil.example", "http://evil.example:8880", "evil.example", " ", "/elsewhere"]) {
    assert.equal(isAllowedNarrationBase(base), false, base);
  }
  assert.equal(isAllowedNarrationBase("http://127.0.0.1:8880"), true);
});

it("narrates through the site itself only when the build asks for it", () => {
  assert.equal(narrationBase("same-origin"), SAME_ORIGIN);
  assert.equal(narrationBase(undefined), "http://127.0.0.1:8880");
  assert.equal(narrationBase("https://evil.example"), "http://127.0.0.1:8880");
});

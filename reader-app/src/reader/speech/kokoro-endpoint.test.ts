import assert from "node:assert/strict";
import { it } from "node:test";
import {
  DEFAULT_KOKORO_BASE,
  isLoopbackEndpoint,
  resolveKokoroUrls,
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

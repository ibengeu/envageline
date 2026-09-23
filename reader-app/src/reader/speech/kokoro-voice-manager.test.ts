import assert from "node:assert/strict";
import { it } from "node:test";
import type { TTSVoice } from "../core/types.ts";
import {
  isSpeechSupported,
  loadVoices,
  pickDefaultVoice,
} from "./kokoro-voice-manager.ts";

it("returns no voices without fetch for a non-loopback endpoint", async () => {
  let fetchCalls = 0;
  const voices = await loadVoices({
    base: "http://example.invalid:8880",
    fetchImpl: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ voices: ["af_heart"] }),
      };
    },
  });

  assert.deepEqual(voices, []);
  assert.equal(fetchCalls, 0);
});

it("returns no voices when the Kokoro voice request fails", async () => {
  const voices = await loadVoices({
    fetchImpl: async () => {
      throw new Error("connection refused");
    },
  });

  assert.deepEqual(voices, []);
});

it("returns no voices when Kokoro responds with an error", async () => {
  const voices = await loadVoices({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ voices: [] }),
    }),
  });

  assert.deepEqual(voices, []);
});

it("maps Kokoro voice ids to local human-readable TTS voices", async () => {
  let requestedUrl = "";
  const voices = await loadVoices({
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return {
        ok: true,
        status: 200,
        json: async () => ({ voices: ["af_heart", "am_michael"] }),
      };
    },
  });

  assert.equal(requestedUrl, "http://127.0.0.1:8880/v1/audio/voices");
  assert.equal(voices[0]?.id, "af_heart");
  assert.equal(voices[0]?.name, "Heart (US Female)");
  assert.equal(voices[0]?.localService, true);
  assert.equal(voices[1]?.id, "am_michael");
  assert.equal(voices[1]?.name, "Michael (US Male)");
  assert.equal(voices[1]?.localService, true);
});

it("marks only the configured default voice", async () => {
  const voices = await loadVoices({
    defaultVoiceId: "am_michael",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ voices: ["af_heart", "am_michael"] }),
    }),
  });

  assert.deepEqual(
    voices.map((voice) => [voice.id, voice.default]),
    [
      ["af_heart", false],
      ["am_michael", true],
    ],
  );
});

it("reports whether the current environment can use fetch for local speech", () => {
  assert.equal(
    isSpeechSupported(),
    typeof window !== "undefined" && typeof fetch === "function",
  );
});

it("keeps the preferred voice when it is still available", () => {
  const voices: TTSVoice[] = [
    {
      id: "af_heart",
      name: "Heart (US Female)",
      lang: "en-US",
      localService: true,
      default: true,
    },
  ];

  assert.equal(pickDefaultVoice(voices, "af_heart"), "af_heart");
});

it("falls back to a valid default when the preferred voice is stale", () => {
  const voices: TTSVoice[] = [
    {
      id: "af_heart",
      name: "Heart (US Female)",
      lang: "en-US",
      localService: true,
      default: true,
    },
    {
      id: "am_michael",
      name: "Michael (US Male)",
      lang: "en-US",
      localService: true,
      default: false,
    },
  ];

  assert.equal(pickDefaultVoice(voices, "removed-voice"), "af_heart");
});

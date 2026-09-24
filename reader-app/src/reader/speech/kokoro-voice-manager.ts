import type { TTSVoice } from "../core/types.ts";
import {
  DEFAULT_KOKORO_BASE,
  isAllowedNarrationBase,
  resolveKokoroUrls,
} from "./kokoro-endpoint.ts";
import type { KokoroFetch } from "./kokoro-tts.ts";

export interface KokoroVoiceManagerOptions {
  base?: string;
  fetchImpl?: KokoroFetch;
  defaultVoiceId?: string;
}

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && typeof fetch === "function";
}

export async function loadVoices(
  options: KokoroVoiceManagerOptions = {},
): Promise<TTSVoice[]> {
  const base = options.base ?? DEFAULT_KOKORO_BASE;
  // OWASP A02:2025 and A09:2025. Validate the destination before fetch.
  // This prevents voice requests from reaching a non-loopback host.
  if (!isAllowedNarrationBase(base)) return [];
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) return [];
  try {
    const { voicesUrl } = resolveKokoroUrls(base);
    const response = await fetchImpl(voicesUrl);
    if (!response.ok) return [];
    if (!response.json) return [];
    const data = await response.json();
    const values =
      data && typeof data === "object" && "voices" in data
        ? (data as { voices?: unknown }).voices
        : [];
    if (!Array.isArray(values)) return [];
    return values
      .map((value): string | null => {
        if (typeof value === "string") return value;
        if (value && typeof value === "object" && "id" in value) {
          const id = (value as { id?: unknown }).id;
          return typeof id === "string" ? id : null;
        }
        return null;
      })
      .filter((id): id is string => Boolean(id))
      .map((id) => mapVoice(id, options.defaultVoiceId ?? "af_heart"));
  } catch {
    return [];
  }
}

const LOCALE_BY_PREFIX: Record<string, string> = {
  a: "en-US",
  b: "en-GB",
  e: "es-ES",
  f: "fr-FR",
  h: "hi-IN",
  i: "it-IT",
  j: "ja-JP",
  p: "pt-BR",
  z: "zh-CN",
};

function mapVoice(id: string, defaultVoiceId: string): TTSVoice {
  const [prefix = "", rawName = id] = id.split("_", 2);
  const locale = LOCALE_BY_PREFIX[prefix[0]?.toLowerCase() ?? ""] ?? "en-US";
  const gender = prefix.toLowerCase().endsWith("f") ? "Female" : "Male";
  const name = rawName
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const region = locale.split("-")[1] ?? "Local";
  return {
    id,
    name: `${name} (${region} ${gender})`,
    lang: locale,
    localService: true,
    default: id === defaultVoiceId,
  };
}

export function pickDefaultVoice(
  voices: TTSVoice[],
  preferredId: string | null,
): string | null {
  if (preferredId && voices.some((voice) => voice.id === preferredId)) {
    return preferredId;
  }
  const english = voices.filter((voice) => /^en\b/i.test(voice.lang));
  const pool = english.length > 0 ? english : voices;
  const local = pool.find((voice) => voice.localService);
  return (local ?? pool.find((voice) => voice.default) ?? pool[0])?.id ?? null;
}

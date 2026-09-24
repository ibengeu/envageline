const LOOPBACK_KOKORO_BASE = "http://127.0.0.1:8880";

// OWASP A02:2025 Security Misconfiguration and A09:2025 SSRF.
// Enforce an HTTP loopback origin before any narration request is sent.
// This control prevents document text from reaching a remote destination.
export function isLoopbackEndpoint(base: string): boolean {
  const raw = base.trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const validProtocol = url.protocol === "http:" || url.protocol === "https:";
    const validHost = hostname === "localhost" || hostname === "127.0.0.1";
    const noCredentials = url.username === "" && url.password === "";
    const isOrigin = url.pathname === "/" && url.search === "" && url.hash === "";
    return validProtocol && validHost && noCredentials && isOrigin;
  } catch {
    return false;
  }
}

/** Narration served by the same site as the reader (proxied to Kokoro). */
export const SAME_ORIGIN = "";

export function isAllowedNarrationBase(base: string): boolean {
  return base === SAME_ORIGIN || isLoopbackEndpoint(base);
}

// Where narration is requested from. A hosted build sets
// VITE_NARRATION_BASE=same-origin so the reader speaks through its own site
// (nginx proxies /v1/audio/ to Kokoro); anything else - unset, or even a URL -
// means Kokoro on the listener's own machine.
// OWASP A01:2025 Broken Access Control - a build flag can never point
// narration at an arbitrary host; only "same-origin" or loopback exist.
export function narrationBase(flag: string | undefined): string {
  return flag === "same-origin" ? SAME_ORIGIN : LOOPBACK_KOKORO_BASE;
}

export const DEFAULT_KOKORO_BASE = narrationBase(
  typeof import.meta.env === "object" ? import.meta.env.VITE_NARRATION_BASE : undefined,
);

/** True for the hosted build, whose sentences are spoken by the site's server. */
export const HOSTED_NARRATION = DEFAULT_KOKORO_BASE === SAME_ORIGIN;

export function resolveKokoroUrls(base: string): {
  speechUrl: string;
  voicesUrl: string;
} {
  const root = base.trim().replace(/\/+$/, "");
  return {
    speechUrl: `${root}/v1/audio/speech`,
    voicesUrl: `${root}/v1/audio/voices`,
  };
}

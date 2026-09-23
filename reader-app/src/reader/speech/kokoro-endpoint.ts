export const DEFAULT_KOKORO_BASE = "http://127.0.0.1:8880";

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

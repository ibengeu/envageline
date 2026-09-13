# PDF Read Aloud

Local browser tool for opening a text-based PDF or EPUB, extracting its text, and reading it aloud with a local Kokoro TTS server.

## Run

```sh
cd pdf-reader
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Notes

- PDF and EPUB files are read in the browser. The app does not upload document contents.
- PDF.js is vendored locally under `vendor/pdfjs-4.10.38` to avoid executing runtime CDN code.
- EPUB parsing uses `fflate`, vendored locally under `vendor/fflate-0.8.3`, to decompress the archive; chapter XHTML is parsed with the browser's built-in `DOMParser` and only its text content is used.
- All narration is played through a local Kokoro TTS server; the reader requires it to be running and sends text only to a same-origin or localhost-compatible endpoint, defaulting to `/v1/audio/speech`.
- Available voices are loaded from the matching `/v1/audio/voices` endpoint.
- The reader adaptively prefetches 1–6 speech chunks ahead using EWMA response-time estimation so local playback stays continuous.
- The reading pane shows the document's literal, unmodified text by default. Enable "Show clickable passages to jump playback" to switch to an interactive view where clicking any passage jumps playback to that section.
- Bookmark one passage per PDF to resume later on the same browser. A bookmark stores only a versioned passage index and save time in browser-local storage, keyed by a SHA-256 digest of the PDF bytes. It never stores the filename, document text, excerpts, or PDF bytes, and restoring a bookmark never starts audio automatically.
- One Docker image can serve both the reader and Kokoro TTS from `http://localhost:8880`.
- Scanned PDFs need OCR, which is intentionally out of scope.
- EPUB support covers standard reflowable EPUB 2/3 archives with a spine-ordered manifest. DRM-protected EPUBs cannot be read.
- Naturalness depends on the Kokoro voice selected and the local TTS server's model.

## Security

- OWASP A03:2025 Supply Chain Failures - PDF.js and fflate are both pinned to a concrete vendored version; neither is fetched from a CDN at runtime.
- OWASP A07:2025 Injection - extracted PDF and EPUB text is untrusted and is rendered only as literal text through `textContent`. EPUB chapter markup is parsed with `DOMParser`, `<script>`/`<style>` elements are removed before extraction, and the resulting document is never inserted as HTML.
- OWASP A08:2025 Mishandling of Exceptional Conditions - EPUB decompression is bounded by a total uncompressed size cap (200 MB) and an entry-count cap, so a crafted archive (zip bomb) fails with a clear error instead of exhausting memory.
- OWASP A09:2025 SSRF - local TTS requests are constrained to `localhost` or `127.0.0.1`. EPUB parsing performs no network requests.
- OWASP A05:2025 Cryptographic Failures - bookmark keys use SHA-256 PDF byte digests and retain no document content or source metadata.
- OWASP A02:2025 Security Misconfiguration - `index.html` includes a restrictive static CSP. Production hosting should also set equivalent HTTP security headers.

## Verify

```sh
node --test reader.test.js
```

## Docker

```sh
docker build -t pdf-reader .
docker run --rm -p 8880:8880 pdf-reader
```

The first run downloads the Kokoro ONNX model and voices into the container's `/models` directory.

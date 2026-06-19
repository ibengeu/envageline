# PDF Read Aloud

Local browser tool for opening a text-based PDF, extracting its text, and reading it aloud with browser speech synthesis.

## Run

```sh
cd pdf-reader
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## Notes

- PDF files are read in the browser. The app does not upload document contents.
- PDF.js is vendored locally under `vendor/pdfjs-4.10.38` to avoid executing runtime CDN code.
- Browser voices are private but depend on voices installed on the device.
- Local Kokoro mode sends text only to a same-origin or localhost-compatible endpoint, defaulting to `/v1/audio/speech`.
- When Local Kokoro is selected, voices are loaded from the matching `/v1/audio/voices` endpoint.
- The reader adaptively prefetches 1–6 speech chunks ahead using EWMA response-time estimation so local playback stays continuous.
- Click any rendered text chunk to jump playback to that section and start reading there.
- One Docker image can serve both the reader and Kokoro TTS from `http://localhost:8880`.
- Scanned PDFs need OCR, which is intentionally out of scope.
- Naturalness depends on the voices installed or exposed by the browser and operating system.

## Security

- OWASP A03:2025 Supply Chain Failures - PDF.js is pinned to a concrete vendored version.
- OWASP A07:2025 Injection - extracted PDF text is untrusted and is rendered only as literal text through `textContent`.
- OWASP A09:2025 SSRF - local TTS requests are constrained to `localhost` or `127.0.0.1`.
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

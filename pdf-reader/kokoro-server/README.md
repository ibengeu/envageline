# Local Kokoro TTS Server

OpenAI-style local endpoint for the PDF reader.

## Run With Docker

```sh
cd pdf-reader/kokoro-server
docker compose up --build
```

The first run downloads:

- `kokoro-v1.0.onnx` - about 326 MB
- `voices-v1.0.bin` - about 28 MB

Files are stored in `pdf-reader/kokoro-server/models/` and reused on later runs.

## Verify

```sh
curl http://localhost:8880/health
curl http://localhost:8880/v1/audio/voices
```

## Use From The Reader

In `http://localhost:4175`:

- TTS Provider: `Local Kokoro`
- Local endpoint: `http://localhost:8880/v1/audio/speech`
- Local voice: `af_heart`

The browser only sends text to `localhost` or `127.0.0.1`.

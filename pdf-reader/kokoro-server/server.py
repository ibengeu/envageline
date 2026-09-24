from __future__ import annotations

import os
import urllib.request
from io import BytesIO
from pathlib import Path
from typing import Literal

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from kokoro_onnx import Kokoro
from pydantic import BaseModel, Field

from integrity import ensure_verified
from phonemes import install_shared_phonemizer

# kokoro-onnx 0.4.7 builds (and leaks) a new espeak backend for every sentence;
# share one per language instead. Must run before the first synthesis.
install_shared_phonemizer()


MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

MODEL_DIR = Path(os.getenv("KOKORO_MODEL_DIR", "/models"))
MODEL_PATH = MODEL_DIR / "kokoro-v1.0.onnx"
VOICES_PATH = MODEL_DIR / "voices-v1.0.bin"
# Pinned on first use from the v1.0 release files (the release publishes no
# checksums of its own). Update both together when bumping the model.
MODEL_SHA256 = "7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5"
VOICES_SHA256 = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"
DEFAULT_VOICE = os.getenv("KOKORO_DEFAULT_VOICE", "af_heart")
# Serving the reader's static files is optional: in the container it is baked in at
# /app/pdf-reader, but running this server directly on a workstation (no Docker) has no such
# path, and mounting a missing directory raises at import time. Overridable like
# KOKORO_MODEL_DIR, and skipped entirely when the directory is absent, so `docker compose up`
# behaves exactly as before while a local `uvicorn server:app` still starts.
READER_DIR = Path(os.getenv("KOKORO_READER_DIR", "/app/pdf-reader"))

app = FastAPI(title="Local Kokoro TTS", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:8880",
        "http://127.0.0.1:8880",
        "http://localhost:4175",
        "http://127.0.0.1:4175",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

_kokoro: Kokoro | None = None


# "opus" is opt-in and never the default. Measured on loopback, transferring a WAV chunk takes
# ~0.2ms against a ~4s synthesis, so the format buys no playback latency; Opus is ~11x smaller
# (13KB vs 144KB for 3s) but costs ~120ms to encode. It exists purely so the browser's 150MB
# IndexedDB audio cache can hold far more of a book, not to reduce buffering.
AUDIO_FORMATS = {
    "wav": ("WAV", "PCM_16", "audio/wav"),
    "opus": ("OGG", "OPUS", "audio/ogg"),
}


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=6000)
    voice: str = DEFAULT_VOICE
    response_format: Literal["wav", "opus"] = "wav"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    lang: str = "en-us"


def download_if_missing(url: str, path: Path, sha256: str) -> None:
    if path.exists() and path.stat().st_size > 0:
        ensure_verified(path, sha256)
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    print(f"Downloading {path.name}...")
    urllib.request.urlretrieve(url, tmp_path)
    tmp_path.replace(path)
    ensure_verified(path, sha256)


def get_kokoro() -> Kokoro:
    global _kokoro
    if _kokoro is None:
        download_if_missing(MODEL_URL, MODEL_PATH, MODEL_SHA256)
        download_if_missing(VOICES_URL, VOICES_PATH, VOICES_SHA256)
        _kokoro = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
    return _kokoro


@app.on_event("startup")
def warm_up() -> None:
    # The first synthesis of the process pays ONNX graph initialisation on top of its own cost
    # (measured 2.00s cold vs 1.73s warm), which would otherwise land on the reader's very first
    # chunk - the one moment the listener is actually waiting. Priming here moves that cost to
    # server start. Failure is non-fatal: the model loads lazily on first request as before, so
    # a warm-up problem must not prevent the server from serving.
    try:
        get_kokoro().create("Ready.", voice=DEFAULT_VOICE)
        print("Warm-up complete.")
    except Exception as error:  # noqa: BLE001 - startup must degrade, never abort
        print(f"Warm-up skipped: {error}")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/audio/voices")
def voices() -> dict[str, list[str]]:
    return {"voices": get_kokoro().get_voices()}


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest) -> Response:
    kokoro = get_kokoro()
    if request.voice not in kokoro.get_voices():
        raise HTTPException(status_code=400, detail=f"Unknown voice: {request.voice}")

    try:
        audio, sample_rate = kokoro.create(
            request.input,
            voice=request.voice,
            speed=request.speed,
            lang=request.lang,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    container, subtype, media_type = AUDIO_FORMATS[request.response_format]
    output = BytesIO()
    sf.write(output, audio, sample_rate, format=container, subtype=subtype)
    return Response(content=output.getvalue(), media_type=media_type)


if READER_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(READER_DIR), html=True), name="reader")

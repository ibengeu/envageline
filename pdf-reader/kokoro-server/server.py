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


MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

MODEL_DIR = Path(os.getenv("KOKORO_MODEL_DIR", "/models"))
MODEL_PATH = MODEL_DIR / "kokoro-v1.0.onnx"
VOICES_PATH = MODEL_DIR / "voices-v1.0.bin"
DEFAULT_VOICE = os.getenv("KOKORO_DEFAULT_VOICE", "af_heart")

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


class SpeechRequest(BaseModel):
    input: str = Field(min_length=1, max_length=6000)
    voice: str = DEFAULT_VOICE
    response_format: Literal["wav"] = "wav"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    lang: str = "en-us"


def download_if_missing(url: str, path: Path) -> None:
    if path.exists() and path.stat().st_size > 0:
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    print(f"Downloading {path.name}...")
    urllib.request.urlretrieve(url, tmp_path)
    tmp_path.replace(path)


def get_kokoro() -> Kokoro:
    global _kokoro
    if _kokoro is None:
        download_if_missing(MODEL_URL, MODEL_PATH)
        download_if_missing(VOICES_URL, VOICES_PATH)
        _kokoro = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
    return _kokoro


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

    output = BytesIO()
    sf.write(output, audio, sample_rate, format="WAV")
    return Response(content=output.getvalue(), media_type="audio/wav")


app.mount("/", StaticFiles(directory="/app/pdf-reader", html=True), name="reader")

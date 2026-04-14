#!/usr/bin/env python3
"""
Local OpenAI-compatible gateway for Qwen3-TTS VoiceDesign.

Routes:
  - GET  /healthz
  - GET  /v1/catalog
  - GET  /v1/audio/voices
  - POST /v1/audio/speech
  - POST /v1/voice/design
"""

from __future__ import annotations

import argparse
import io
import json
import os
import traceback
from typing import Any, Dict, Optional, Tuple

import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

MODEL_HANDLE = None
MODEL_ID = ""
MODEL_DIR = ""


class SpeechRequest(BaseModel):
    model: str
    input: str
    voice: Optional[str] = None
    response_format: Optional[str] = None
    speed: Optional[float] = None
    language: Optional[str] = None
    instruct: Optional[str] = None


def _normalize_language(value: Optional[str]) -> str:
    raw = (value or "").strip()
    if not raw:
        return "auto"
    return raw


def _normalize_instruct(value: Optional[str]) -> str:
    raw = (value or "").strip()
    return raw


def _coerce_audio_output(result: Any) -> Tuple[np.ndarray, int]:
    if isinstance(result, tuple) and len(result) >= 2:
        audio, sample_rate = result[0], int(result[1])
        return np.asarray(audio, dtype=np.float32), sample_rate

    if isinstance(result, dict):
        audio = result.get("audio")
        if audio is None:
            audio = result.get("wav")
        sample_rate = int(result.get("sample_rate") or result.get("sampling_rate") or 24000)
        if audio is None:
            raise RuntimeError("QWEN_TTS_GATEWAY_OUTPUT_INVALID: missing audio field")
        return np.asarray(audio, dtype=np.float32), sample_rate

    return np.asarray(result, dtype=np.float32), 24000


def _encode_wav(audio: np.ndarray, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format="WAV")
    return buffer.getvalue()


def _encode_ogg(audio: np.ndarray, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, audio, sample_rate, format="OGG", subtype="VORBIS")
    return buffer.getvalue()


def _encode_pcm(audio: np.ndarray) -> bytes:
    clipped = np.clip(audio, -1.0, 1.0)
    int16 = (clipped * 32767.0).astype(np.int16)
    return int16.tobytes()


def _response_format_and_mime(request_format: Optional[str]) -> Tuple[str, str]:
    normalized = (request_format or "wav").strip().lower()
    if normalized == "opus":
        return "opus", "audio/ogg"
    if normalized == "pcm":
        return "pcm", "audio/L16"
    # qwen gateway always emits WAV for mp3/wav fallback to avoid mp3 codec dependency.
    return "wav", "audio/wav"


def _load_qwen_model(model_dir: str):
    try:
        from qwen_tts import Qwen3TTSModel
    except Exception as error:
        raise RuntimeError(
            f"LOCAL_AI_QWEN_BOOTSTRAP_FAILED: import qwen_tts failed: {error}"
        ) from error

    try:
        return Qwen3TTSModel(model_dir)
    except Exception as error:
        raise RuntimeError(
            f"LOCAL_AI_QWEN_MODEL_LOAD_FAILED: failed to load model from {model_dir}: {error}"
        ) from error


def create_app(model_dir: str, model_id: str) -> FastAPI:
    app = FastAPI()

    global MODEL_HANDLE, MODEL_ID, MODEL_DIR
    MODEL_HANDLE = _load_qwen_model(model_dir)
    MODEL_ID = model_id
    MODEL_DIR = model_dir

    @app.get("/healthz")
    def healthz() -> Dict[str, Any]:
        return {
            "status": "ok",
            "ready": True,
        }

    @app.get("/v1/catalog")
    def list_models() -> Dict[str, Any]:
        return {
            "models": [
                {
                    "id": MODEL_ID,
                    "ready": True,
                    "capabilities": [
                        "audio.synthesize",
                    ],
                }
            ],
        }

    @app.get("/v1/audio/voices")
    def list_voices() -> Dict[str, Any]:
        return {
            "object": "list",
            "data": [
                {
                    "id": "qwen-voice-design",
                    "providerId": "openai-compatible",
                    "name": "Qwen VoiceDesign",
                    "langs": ["auto", "zh", "en", "ja"],
                }
            ],
        }

    @app.post("/v1/audio/speech")
    def synthesize_speech(request: SpeechRequest):
        if MODEL_HANDLE is None:
            raise HTTPException(
                status_code=503,
                detail="LOCAL_AI_QWEN_MODEL_NOT_READY: model handle is unavailable",
            )

        text = (request.input or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="input is required")

        language = _normalize_language(request.language)
        instruct = _normalize_instruct(request.instruct)

        try:
            result = MODEL_HANDLE.generate_voice_design(
                text=text,
                language=language,
                instruct=instruct,
            )
            audio, sample_rate = _coerce_audio_output(result)
            encode_format, mime_type = _response_format_and_mime(request.response_format)

            if encode_format == "opus":
                payload = _encode_ogg(audio, sample_rate)
            elif encode_format == "pcm":
                payload = _encode_pcm(audio)
            else:
                payload = _encode_wav(audio, sample_rate)

            return Response(
                content=payload,
                media_type=mime_type,
                headers={
                    "x-local-engine": "qwen-tts-python",
                    "x-local-model-id": MODEL_ID,
                    "x-local-sample-rate": str(sample_rate),
                    "x-local-format": encode_format,
                },
            )
        except HTTPException:
            raise
        except Exception as error:
            detail = f"LOCAL_AI_QWEN_TTS_FAILED: {error}"
            traceback.print_exc()
            return JSONResponse(
                status_code=500,
                content={
                    "error": {
                        "type": "internal_error",
                        "message": detail,
                    }
                },
            )

    @app.post("/v1/voice/design")
    def design_voice(request: SpeechRequest):
        return synthesize_speech(request)

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=38100)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--log-level", default="warning")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    app = create_app(model_dir=args.model_dir, model_id=args.model_id)

    try:
        import uvicorn
    except Exception as error:
        raise RuntimeError(
            f"LOCAL_AI_QWEN_BOOTSTRAP_FAILED: import uvicorn failed: {error}"
        ) from error

    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=str(args.log_level or "warning"),
        access_log=False,
    )


if __name__ == "__main__":
    main()

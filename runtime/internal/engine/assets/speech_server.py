#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import pathlib
import tempfile
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
import uvicorn
from speech_server_runtime import (
    QWEN3_TTS_DRIVER_ENV,
    build_host_state,
    driver_command_state,
    find_ready_model,
    infer_workflow_family,
    local_workflow_not_admitted_response,
    plain_speech_unavailable_response,
    public_model_payload,
    run_driver_command,
    synthesize_with_driver,
    transcribe_with_driver,
    truthy_form_value,
    voice_workflow_result_from_driver,
    workflow_execution_unavailable_response,
)


class SpeechSynthesizeRequest:
    def __init__(
        self,
        model: str,
        input: str,
        voice: str | None = None,
        language: str | None = None,
        audio_format: str | None = None,
        sample_rate_hz: int | None = None,
        speed: float | None = None,
        pitch: float | None = None,
        volume: float | None = None,
        emotion: str | None = None,
        extensions: dict[str, Any] | None = None,
    ) -> None:
        self.model = model
        self.input = input
        self.voice = voice
        self.language = language
        self.audio_format = audio_format
        self.sample_rate_hz = sample_rate_hz
        self.speed = speed
        self.pitch = pitch
        self.volume = volume
        self.emotion = emotion
        self.extensions = extensions or {}

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "SpeechSynthesizeRequest":
        return cls(
            model=str(payload.get("model") or "").strip(),
            input=str(payload.get("input") or "").strip(),
            voice=str(payload.get("voice") or "").strip() or None,
            language=str(payload.get("language") or "").strip() or None,
            audio_format=str(payload.get("audio_format") or "").strip() or None,
            sample_rate_hz=int(payload["sample_rate_hz"]) if payload.get("sample_rate_hz") is not None else None,
            speed=float(payload["speed"]) if payload.get("speed") is not None else None,
            pitch=float(payload["pitch"]) if payload.get("pitch") is not None else None,
            volume=float(payload["volume"]) if payload.get("volume") is not None else None,
            emotion=str(payload.get("emotion") or "").strip() or None,
            extensions=payload.get("extensions") if isinstance(payload.get("extensions"), dict) else {},
        )


def create_app() -> FastAPI:
    app = FastAPI()

    @app.get("/healthz")
    def healthz():
        state = build_host_state()
        return {
            "status": state.status,
            "ready": state.ready,
            "detail": state.detail,
            "checks": {
                "qwen3_tts_driver": state.qwen3_tts_configured,
                "qwen3_tts_driver_ready": state.qwen3_tts_ready,
                "qwen3_tts_driver_detail": state.qwen3_tts_detail,
                "qwen3_asr_driver": state.qwen3_asr_configured,
                "qwen3_asr_driver_ready": state.qwen3_asr_ready,
                "qwen3_asr_driver_detail": state.qwen3_asr_detail,
                "models_ready": len([model for model in state.models if model.ready]),
            },
        }

    @app.get("/v1/catalog")
    def catalog():
        state = build_host_state()
        return {
            "status": state.status,
            "ready": state.ready,
            "detail": state.detail,
            "not_admitted_capabilities": [],
            "models": [public_model_payload(model) for model in state.models],
        }

    @app.post("/v1/audio/speech")
    async def synthesize(payload: dict[str, Any]):
        request = SpeechSynthesizeRequest.from_payload(payload)
        if not request.model or not request.input:
            return plain_speech_unavailable_response(
                "audio synthesis",
                "audio synthesis requires non-empty model and input",
                "speech_request_invalid",
            )
        try:
            model = find_ready_model(request.model, "audio.synthesize")
            audio, content_type = synthesize_with_driver(
                model,
                {
                    "driver": model.capability_drivers.get("audio.synthesize", ""),
                    "operation": "audio.synthesize",
                    "model": model.model_id,
                    "manifest_path": model.manifest_path,
                    "bundle_dir": model.bundle_dir,
                    "entry_path": model.entry_path,
                    "declared_files": model.declared_files,
                    "input": request.input,
                    "voice": request.voice,
                    "language": request.language,
                    "audio_format": request.audio_format,
                    "sample_rate_hz": request.sample_rate_hz,
                    "speed": request.speed,
                    "pitch": request.pitch,
                    "volume": request.volume,
                    "emotion": request.emotion,
                    "extensions": request.extensions,
                },
            )
        except HTTPException:
            raise
        except Exception as error:
            return plain_speech_unavailable_response(
                "audio synthesis",
                f"local supervised speech synthesis failed: {error}",
                "speech_driver_execution_failed",
            )
        return Response(
            content=audio,
            media_type=content_type,
            headers={
                "x-local-engine": model.capability_drivers.get("audio.synthesize", "speech"),
                "x-local-model-id": model.model_id,
            },
        )

    @app.post("/v1/audio/transcriptions")
    async def transcribe(
        model: str = Form(...),
        file: UploadFile = File(...),
        mime_type: str | None = Form(None),
        language: str | None = Form(None),
        prompt: str | None = Form(None),
        response_format: str | None = Form(None),
        timestamps: str | None = Form(None),
        diarization: str | None = Form(None),
        speaker_count: str | None = Form(None),
        extensions: str | None = Form(None),
    ):
        target_model = model.strip()
        if not target_model:
            return plain_speech_unavailable_response(
                "audio transcription",
                "audio transcription requires a non-empty model",
                "speech_request_invalid",
            )
        try:
            active_model = find_ready_model(target_model, "audio.transcribe")
            raw_audio = await file.read()
            if not raw_audio:
                return plain_speech_unavailable_response(
                    "audio transcription",
                    "audio transcription requires non-empty audio bytes",
                    "speech_request_invalid",
                )
            with tempfile.TemporaryDirectory(prefix="nimi-speech-audio-") as temp_dir:
                audio_path = pathlib.Path(temp_dir) / (file.filename or "audio.bin")
                audio_path.write_bytes(raw_audio)
                text = transcribe_with_driver(
                    active_model,
                    {
                        "driver": active_model.capability_drivers.get("audio.transcribe", ""),
                        "operation": "audio.transcribe",
                        "model": active_model.model_id,
                        "manifest_path": active_model.manifest_path,
                        "bundle_dir": active_model.bundle_dir,
                        "entry_path": active_model.entry_path,
                        "declared_files": active_model.declared_files,
                        "audio_path": str(audio_path),
                        "mime_type": (mime_type or "").strip(),
                        "language": (language or "").strip(),
                        "prompt": (prompt or "").strip(),
                        "response_format": (response_format or "").strip(),
                        "timestamps": truthy_form_value(timestamps),
                        "diarization": truthy_form_value(diarization),
                        "speaker_count": int(speaker_count) if (speaker_count or "").strip() else 0,
                        "extensions": json.loads(extensions) if (extensions or "").strip() else {},
                    },
                )
        except HTTPException:
            raise
        except Exception as error:
            return plain_speech_unavailable_response(
                "audio transcription",
                f"local supervised speech transcription failed: {error}",
                "speech_driver_execution_failed",
            )
        return {"text": text}

    @app.post("/v1/voice/clone")
    def clone_voice(payload: dict[str, Any]):
        workflow_model_id = str(payload.get("workflow_model_id") or "").strip()
        target_model_id = str(payload.get("target_model_id") or "").strip()
        workflow_family = infer_workflow_family(target_model_id, workflow_model_id)
        if workflow_family != "qwen3_tts":
            return local_workflow_not_admitted_response("voice clone", workflow_family)
        try:
            model = find_ready_model(target_model_id, "audio.synthesize")
            response = run_driver_command(
                driver_command_state(QWEN3_TTS_DRIVER_ENV, "qwen3_tts")[0],
                {
                    "driver": "qwen3_tts",
                    "operation": "voice.clone",
                    "workflow_type": "tts_v2v",
                    "workflow_model_id": workflow_model_id,
                    "target_model_id": model.model_id,
                    "manifest_path": model.manifest_path,
                    "bundle_dir": model.bundle_dir,
                    "entry_path": model.entry_path,
                    "declared_files": model.declared_files,
                    "input": payload.get("input") if isinstance(payload.get("input"), dict) else {},
                    "extensions": payload.get("extensions") if isinstance(payload.get("extensions"), dict) else {},
                },
            )
            return voice_workflow_result_from_driver(response)
        except HTTPException:
            raise
        except Exception as error:
            return workflow_execution_unavailable_response(
                "voice clone",
                f"local qwen3_tts workflow execution failed: {error}",
                "speech_workflow_execution_failed",
            )

    @app.post("/v1/voice/design")
    def design_voice(payload: dict[str, Any]):
        workflow_model_id = str(payload.get("workflow_model_id") or "").strip()
        target_model_id = str(payload.get("target_model_id") or "").strip()
        workflow_family = infer_workflow_family(target_model_id, workflow_model_id)
        if workflow_family != "qwen3_tts":
            return local_workflow_not_admitted_response("voice design", workflow_family)
        try:
            model = find_ready_model(target_model_id, "audio.synthesize")
            response = run_driver_command(
                driver_command_state(QWEN3_TTS_DRIVER_ENV, "qwen3_tts")[0],
                {
                    "driver": "qwen3_tts",
                    "operation": "voice.design",
                    "workflow_type": "tts_t2v",
                    "workflow_model_id": workflow_model_id,
                    "target_model_id": model.model_id,
                    "manifest_path": model.manifest_path,
                    "bundle_dir": model.bundle_dir,
                    "entry_path": model.entry_path,
                    "declared_files": model.declared_files,
                    "input": payload.get("input") if isinstance(payload.get("input"), dict) else {},
                    "extensions": payload.get("extensions") if isinstance(payload.get("extensions"), dict) else {},
                },
            )
            return voice_workflow_result_from_driver(response)
        except HTTPException:
            raise
        except Exception as error:
            return workflow_execution_unavailable_response(
                "voice design",
                f"local qwen3_tts workflow execution failed: {error}",
                "speech_workflow_execution_failed",
            )

    return app


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8330)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    uvicorn.run(
        create_app(),
        host=args.host,
        port=args.port,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()

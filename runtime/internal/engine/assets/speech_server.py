#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import mimetypes
import pathlib
import re
import threading
from typing import Any
import uuid

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
import uvicorn
from speech_server_runtime import (
    MODELS_ROOT_ENV,
    HostState,
    QWEN3_ASR_DRIVER_ENV,
    QWEN3_ASR_TRANSFORMERS_DRIVER_ENV,
    QWEN3_TTS_DRIVER_ENV,
    QWEN3_TTS_PREFLIGHT_CACHE,
    VOXCPM_BACKEND_ENV,
    VOXCPM_DRIVER_ENV,
    DriverAudioArtifact,
    SpeechModelState,
    build_host_state,
    create_voice_with_driver,
    driver_command_state,
    driver_work_root,
    find_ready_model as runtime_find_ready_model,
    find_ready_voice_creation_model as runtime_find_ready_voice_creation_model,
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


SPEECH_RESPONSE_CHUNK_BYTES = 256 * 1024
SPEECH_DISCONNECT_POLL_SECONDS = 0.05


async def run_synthesis_for_request(
    request: Request,
    model: SpeechModelState,
    request_payload: dict[str, Any],
) -> DriverAudioArtifact:
    cancel_event = threading.Event()
    task = asyncio.create_task(
        run_in_threadpool(synthesize_with_driver, model, request_payload, cancel_event)
    )
    disconnected = False
    try:
        while not task.done():
            if await request.is_disconnected():
                cancel_event.set()
                try:
                    await task
                except Exception:
                    pass
                disconnected = True
                break
            done, _ = await asyncio.wait(
                (task,),
                timeout=SPEECH_DISCONNECT_POLL_SECONDS,
            )
            if done:
                return task.result()
    except asyncio.CancelledError:
        cancel_event.set()
        try:
            await task
        except Exception:
            pass
        raise
    if disconnected:
        raise asyncio.CancelledError()
    return task.result()


async def run_transcription_for_request(
    request: Request,
    model: SpeechModelState,
    request_payload: dict[str, Any],
) -> str:
    cancel_event = threading.Event()
    task = asyncio.create_task(
        run_in_threadpool(transcribe_with_driver, model, request_payload, cancel_event)
    )
    disconnected = False
    try:
        while not task.done():
            if await request.is_disconnected():
                cancel_event.set()
                try:
                    await task
                except Exception:
                    pass
                disconnected = True
                break
            done, _ = await asyncio.wait(
                (task,),
                timeout=SPEECH_DISCONNECT_POLL_SECONDS,
            )
            if done:
                return task.result()
    except asyncio.CancelledError:
        cancel_event.set()
        try:
            await task
        except Exception:
            pass
        raise
    if disconnected:
        raise asyncio.CancelledError()
    return task.result()


async def stream_driver_audio_artifact(artifact: DriverAudioArtifact):
    try:
        with artifact.path.open("rb") as handle:
            while True:
                chunk = await run_in_threadpool(handle.read, SPEECH_RESPONSE_CHUNK_BYTES)
                if not chunk:
                    break
                yield chunk
    finally:
        artifact.cleanup()


def find_ready_model(model_id: str, capability: str) -> SpeechModelState:
    target = model_id.strip()
    normalized_target = target.lower()
    candidate_targets = {normalized_target}
    if "/" in normalized_target:
        _, suffix = normalized_target.split("/", 1)
        if suffix:
            candidate_targets.add(suffix)
    elif normalized_target:
        candidate_targets.add(f"speech/{normalized_target}")
    for model in build_host_state().models:
        normalized_model_id = model.model_id.strip().lower()
        if (
            normalized_model_id in candidate_targets
            and model.ready
            and capability in model.ready_capabilities
        ):
            return model
    return runtime_find_ready_model(model_id, capability)


def find_ready_voice_creation_model(model_id: str, creation_source: str, workflow_model_id: str) -> SpeechModelState:
    model = find_ready_model(model_id, "voice.create")
    if creation_source not in model.voice_creation_sources:
        return runtime_find_ready_voice_creation_model(model_id, creation_source, workflow_model_id)
    return model


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


_SAFE_UPLOAD_SUFFIX = re.compile(r"^\.[A-Za-z0-9]{1,8}$")


def safe_uploaded_audio_path(temp_dir: str | pathlib.Path, filename: str | None, mime_type: str | None) -> pathlib.Path:
    suffix = ""
    if filename:
        normalized_name = str(filename).replace("\\", "/")
        suffix = pathlib.PurePosixPath(normalized_name).name
        suffix = pathlib.PurePosixPath(suffix).suffix.lower()
    if not _SAFE_UPLOAD_SUFFIX.fullmatch(suffix or ""):
        suffix = mimetypes.guess_extension(str(mime_type or "").strip()) or ".bin"
    if not _SAFE_UPLOAD_SUFFIX.fullmatch(suffix):
        suffix = ".bin"
    return pathlib.Path(temp_dir) / f"upload-{uuid.uuid4().hex}{suffix}"


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
                "qwen3_asr_transformers_driver": state.qwen3_asr_transformers_configured,
                "qwen3_asr_transformers_driver_ready": state.qwen3_asr_transformers_ready,
                "qwen3_asr_transformers_driver_detail": state.qwen3_asr_transformers_detail,
                "voxcpm_driver": state.voxcpm_configured,
                "voxcpm_driver_ready": state.voxcpm_ready,
                "voxcpm_driver_detail": state.voxcpm_detail,
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
    async def synthesize(payload: dict[str, Any], request: Request):
        speech_request = SpeechSynthesizeRequest.from_payload(payload)
        if not speech_request.model or not speech_request.input:
            return plain_speech_unavailable_response(
                "audio synthesis",
                "audio synthesis requires non-empty model and input",
                "speech_request_invalid",
            )
        try:
            model = find_ready_model(speech_request.model, "audio.synthesize")
            artifact = await run_synthesis_for_request(
                request,
                model,
                {
                    "driver": model.capability_drivers.get("audio.synthesize", ""),
                    "operation": "audio.synthesize",
                    "model": model.model_id,
                    "manifest_path": model.manifest_path,
                    "bundle_dir": model.bundle_dir,
                    "entry_path": model.entry_path,
                    "declared_files": model.declared_files,
                    "input": speech_request.input,
                    "voice": speech_request.voice,
                    "language": speech_request.language,
                    "audio_format": speech_request.audio_format,
                    "sample_rate_hz": speech_request.sample_rate_hz,
                    "speed": speech_request.speed,
                    "pitch": speech_request.pitch,
                    "volume": speech_request.volume,
                    "emotion": speech_request.emotion,
                    "extensions": speech_request.extensions,
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
        return StreamingResponse(
            stream_driver_audio_artifact(artifact),
            media_type=artifact.content_type,
            headers={
                "x-local-engine": model.capability_drivers.get("audio.synthesize", "speech"),
                "x-local-model-id": model.model_id,
                "content-length": str(artifact.size_bytes),
            },
            background=BackgroundTask(artifact.cleanup),
        )

    @app.post("/v1/audio/transcriptions")
    async def transcribe(
        request: Request,
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
            audio_path = safe_uploaded_audio_path(driver_work_root(), file.filename, mime_type)
            try:
                audio_path.write_bytes(raw_audio)
                text = await run_transcription_for_request(
                    request,
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
            finally:
                audio_path.unlink(missing_ok=True)
        except HTTPException:
            raise
        except Exception as error:
            return plain_speech_unavailable_response(
                "audio transcription",
                f"local supervised speech transcription failed: {error}",
                "speech_driver_execution_failed",
            )
        return {"text": text}

    @app.post("/v1/voice/create")
    def create_voice(payload: dict[str, Any]):
        workflow_model_id = str(payload.get("workflow_model_id") or "").strip()
        target_model_id = str(payload.get("target_model_id") or "").strip()
        creation_source = str(payload.get("creation_source") or "").strip()
        if not workflow_model_id or not target_model_id or creation_source not in {"reference_audio", "text_description"}:
            return local_workflow_not_admitted_response("voice.create", "")
        try:
            model = find_ready_voice_creation_model(target_model_id, creation_source, workflow_model_id)
            response = create_voice_with_driver(
                model,
                {
                    "driver": model.capability_drivers.get("voice.create", ""),
                    "operation": "voice.create",
                    "creation_source": creation_source,
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
                "voice.create",
                f"local voice.create execution failed: {error}",
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

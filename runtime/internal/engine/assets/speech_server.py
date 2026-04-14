#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import dataclasses
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import tempfile
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
import uvicorn

MODELS_ROOT_ENV = "NIMI_RUNTIME_LOCAL_MODELS_PATH"
KOKORO_DRIVER_ENV = "NIMI_RUNTIME_SPEECH_KOKORO_CMD"
WHISPERCPP_DRIVER_ENV = "NIMI_RUNTIME_SPEECH_WHISPERCPP_CMD"
DRIVER_TIMEOUT_MS_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS"
DEFAULT_DRIVER_TIMEOUT_MS = 60_000
DEFAULT_MODELS_ROOT = os.path.expanduser("~/.nimi/data/models")
WORKFLOW_NOT_ADMITTED = [
    "voice_workflow.tts_v2v",
    "voice_workflow.tts_t2v",
]
PLAIN_SPEECH_CAPABILITIES = [
    "audio.synthesize",
    "audio.transcribe",
]


@dataclasses.dataclass
class SpeechModelState:
    model_id: str
    declared_capabilities: list[str]
    ready_capabilities: list[str]
    capability_drivers: dict[str, str]
    ready: bool
    detail: str
    manifest_path: str
    bundle_dir: str
    entry_path: str
    declared_files: list[str]


@dataclasses.dataclass
class HostState:
    ready: bool
    status: str
    detail: str
    models: list[SpeechModelState]
    kokoro_configured: bool
    kokoro_ready: bool
    kokoro_detail: str
    whispercpp_configured: bool
    whispercpp_ready: bool
    whispercpp_detail: str


def default_models_root() -> str:
    return os.path.expanduser(
        os.environ.get(MODELS_ROOT_ENV, "").strip() or DEFAULT_MODELS_ROOT
    )


def configured_driver_command(env_name: str) -> list[str]:
    raw = os.environ.get(env_name, "").strip()
    if not raw:
        return []
    return shlex.split(raw)


def driver_command_state(env_name: str, driver_kind: str) -> tuple[list[str], bool, str]:
    command = configured_driver_command(env_name)
    if not command:
        return [], False, f"{driver_kind} driver not configured"

    executable = command[0].strip()
    if not executable:
        return command, False, f"{driver_kind} driver executable empty"

    resolved = ""
    if os.path.isabs(executable) or "/" in executable or "\\" in executable:
        candidate = pathlib.Path(executable)
        if not candidate.exists():
            return command, False, f"{driver_kind} driver executable missing"
        if not os.access(candidate, os.X_OK):
            return command, False, f"{driver_kind} driver executable not executable"
        resolved = str(candidate)
    else:
        resolved = shutil.which(executable) or ""
        if not resolved:
            return command, False, f"{driver_kind} driver executable unresolved"

    normalized_command = command.copy()
    normalized_command[0] = resolved
    return normalized_command, True, f"{driver_kind} driver ready"


def driver_timeout_seconds() -> float:
    raw = os.environ.get(DRIVER_TIMEOUT_MS_ENV, "").strip()
    if not raw:
        return DEFAULT_DRIVER_TIMEOUT_MS / 1000.0
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_DRIVER_TIMEOUT_MS / 1000.0
    value = min(max(value, 5_000), 300_000)
    return value / 1000.0


def plain_speech_unavailable_response(operation: str, detail: str, reason: str) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": {
                "message": detail,
                "reason": reason,
                "operation": operation,
            }
        },
    )


def workflow_not_admitted_response(operation: str) -> JSONResponse:
    return JSONResponse(
        status_code=501,
        content={
            "detail": {
                "message": f"local speech workflow not admitted: {operation} is outside the current local plain-speech baseline",
                "reason": "speech_workflow_not_admitted",
                "admission_state": "workflow_not_admitted",
            }
        },
    )


def truthy_form_value(value: str | None) -> bool:
    normalized = (value or "").strip().lower()
    return normalized in {"1", "true", "yes", "on"}


def normalized_capabilities(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        capability = item.strip()
        if not capability:
            continue
        normalized = capability.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(capability)
    return result


def infer_runtime_native_driver(
    model_id: str,
    capability: str,
    entry_path: str,
    declared_files: list[str],
) -> str:
    normalized_model = model_id.strip().lower()
    normalized_entry = pathlib.Path(entry_path).name.strip().lower()
    normalized_files = [item.strip().lower() for item in declared_files]
    if capability == "audio.synthesize":
        if "kokoro" in normalized_model or "kokoro" in normalized_entry or any("kokoro" in item for item in normalized_files):
            return "kokoro"
        return ""
    if capability == "audio.transcribe":
        if "whisper" in normalized_model or "whisper" in normalized_entry or any("whisper" in item for item in normalized_files):
            return "whispercpp"
        return ""
    return ""


def voices_file_valid(bundle_dir: str) -> tuple[bool, str]:
    voices_path = pathlib.Path(bundle_dir) / "voices.json"
    if not voices_path.exists():
        return True, ""
    try:
        payload = json.loads(voices_path.read_text(encoding="utf-8"))
    except Exception as error:
        return False, f"voices.json invalid: {error}"
    voices = []
    if isinstance(payload, dict):
        raw = payload.get("voices")
        if isinstance(raw, list):
            voices = [item for item in raw if isinstance(item, str) and item.strip()]
    elif isinstance(payload, list):
        voices = [item for item in payload if isinstance(item, str) and item.strip()]
    if not voices:
        return False, "voices.json invalid: no voices declared"
    return True, ""


def manifest_speech_model_state(
    manifest_path: pathlib.Path,
    kokoro_driver_state: tuple[list[str], bool, str],
    whispercpp_driver_state: tuple[list[str], bool, str],
) -> SpeechModelState | None:
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    engine = str(payload.get("engine", "")).strip().lower()
    if engine != "speech":
        return None
    model_id = str(payload.get("asset_id") or payload.get("assetId") or "").strip()
    if not model_id:
        return None
    declared_capabilities = [
        capability
        for capability in normalized_capabilities(payload.get("capabilities"))
        if capability in PLAIN_SPEECH_CAPABILITIES
    ]
    if not declared_capabilities:
        return None

    bundle_dir = manifest_path.parent
    entry_value = str(payload.get("entry") or "").strip()
    entry_path = bundle_dir / entry_value if entry_value else None
    declared_files = normalized_capabilities(payload.get("files"))
    problems: list[str] = []
    if entry_path is None:
        problems.append("entry missing")
        resolved_entry = ""
    else:
        resolved_entry = str(entry_path)
        if not entry_path.exists():
            problems.append(f'entry missing: "{entry_value}"')
        elif not entry_path.is_file():
            problems.append(f'entry not regular: "{entry_value}"')

    for file_name in declared_files:
        candidate = bundle_dir / file_name
        if not candidate.exists():
            problems.append(f'managed bundle file "{file_name}" missing')

    ready_capabilities: list[str] = []
    capability_drivers: dict[str, str] = {}
    for capability in declared_capabilities:
        driver_kind = infer_runtime_native_driver(model_id, capability, resolved_entry, declared_files)
        if not driver_kind:
            problems.append(f"{capability} runtime-native driver unresolved")
            continue
        capability_drivers[capability] = driver_kind
        if capability == "audio.synthesize":
            if driver_kind != "kokoro":
                problems.append(f"audio.synthesize requires unsupported driver {driver_kind}")
                continue
            if not kokoro_driver_state[1]:
                problems.append(kokoro_driver_state[2])
                continue
            voices_ok, voices_detail = voices_file_valid(str(bundle_dir))
            if not voices_ok:
                problems.append(voices_detail)
                continue
            ready_capabilities.append(capability)
            continue
        if capability == "audio.transcribe":
            if driver_kind != "whispercpp":
                problems.append(f"audio.transcribe requires unsupported driver {driver_kind}")
                continue
            if not whispercpp_driver_state[1]:
                problems.append(whispercpp_driver_state[2])
                continue
            ready_capabilities.append(capability)

    ready = len(ready_capabilities) > 0 and len(problems) == 0
    detail = "ready" if ready else "; ".join(dict.fromkeys(problems)) or "runtime-native speech driver unavailable"
    return SpeechModelState(
        model_id=model_id,
        declared_capabilities=declared_capabilities,
        ready_capabilities=ready_capabilities,
        capability_drivers=capability_drivers,
        ready=ready,
        detail=detail,
        manifest_path=str(manifest_path),
        bundle_dir=str(bundle_dir),
        entry_path=resolved_entry,
        declared_files=declared_files,
    )


def discover_speech_models(
    models_root: str,
    kokoro_driver_state: tuple[list[str], bool, str],
    whispercpp_driver_state: tuple[list[str], bool, str],
) -> list[SpeechModelState]:
    resolved_root = pathlib.Path(models_root) / "resolved"
    if not resolved_root.exists():
        return []
    models: list[SpeechModelState] = []
    for manifest_path in sorted(resolved_root.glob("**/asset.manifest.json")):
        if not manifest_path.is_file():
            continue
        state = manifest_speech_model_state(manifest_path, kokoro_driver_state, whispercpp_driver_state)
        if state is not None:
            models.append(state)
    return models


def build_host_state() -> HostState:
    kokoro_driver_state = driver_command_state(KOKORO_DRIVER_ENV, "kokoro")
    whispercpp_driver_state = driver_command_state(WHISPERCPP_DRIVER_ENV, "whispercpp")
    models = discover_speech_models(default_models_root(), kokoro_driver_state, whispercpp_driver_state)
    ready_models = [model for model in models if model.ready]
    if ready_models:
        detail = f"{len(ready_models)} ready local speech model(s) discovered"
        status = "ok"
        ready = True
    elif not kokoro_driver_state[0] and not whispercpp_driver_state[0]:
        detail = "no runtime-native speech drivers configured"
        status = "not_ready"
        ready = False
    elif not models:
        detail = "speech drivers configured but no managed speech bundles discovered"
        status = "not_ready"
        ready = False
    else:
        detail = "speech drivers configured but managed speech bundles are not ready"
        status = "not_ready"
        ready = False
    return HostState(
        ready=ready,
        status=status,
        detail=detail,
        models=models,
        kokoro_configured=bool(kokoro_driver_state[0]),
        kokoro_ready=kokoro_driver_state[1],
        kokoro_detail=kokoro_driver_state[2],
        whispercpp_configured=bool(whispercpp_driver_state[0]),
        whispercpp_ready=whispercpp_driver_state[1],
        whispercpp_detail=whispercpp_driver_state[2],
    )


def public_model_payload(model: SpeechModelState) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": model.model_id,
        "ready": model.ready,
        "detail": model.detail,
        "capabilities": model.ready_capabilities if model.ready_capabilities else model.declared_capabilities,
        "declared_capabilities": model.declared_capabilities,
        "capability_drivers": model.capability_drivers,
    }
    if model.declared_files:
        payload["declared_files"] = model.declared_files
    return payload


def find_ready_model(model_id: str, capability: str) -> SpeechModelState:
    target = model_id.strip()
    for model in build_host_state().models:
        if model.model_id == target and model.ready and capability in model.ready_capabilities:
            return model
    raise HTTPException(
        status_code=503,
        detail={
            "message": f'local speech model "{target}" is not ready for {capability}',
            "reason": "speech_model_not_ready",
            "model": target,
            "capability": capability,
        },
    )


def run_driver_command(command: list[str], request_payload: dict[str, Any]) -> dict[str, Any]:
    if not command:
        raise RuntimeError("speech driver command is not configured")
    with tempfile.TemporaryDirectory(prefix="nimi-speech-driver-") as temp_dir:
        request_path = pathlib.Path(temp_dir) / "request.json"
        response_path = pathlib.Path(temp_dir) / "response.json"
        request_path.write_text(json.dumps(request_payload, ensure_ascii=True), encoding="utf-8")
        proc = subprocess.run(
            [*command, "--request", str(request_path), "--response", str(response_path)],
            capture_output=True,
            text=True,
            timeout=driver_timeout_seconds(),
            check=False,
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip() or "driver exited non-zero"
            raise RuntimeError(f"speech driver failed: {detail}")
        if not response_path.exists():
            raise RuntimeError("speech driver did not write a response")
        try:
            payload = json.loads(response_path.read_text(encoding="utf-8"))
        except Exception as error:
            raise RuntimeError(f"speech driver response invalid: {error}") from error
        if not isinstance(payload, dict):
            raise RuntimeError("speech driver response must be an object")
    return payload


def synthesize_with_driver(model: SpeechModelState, request_payload: dict[str, Any]) -> tuple[bytes, str]:
    driver_kind = model.capability_drivers.get("audio.synthesize", "").strip()
    if driver_kind != "kokoro":
        raise RuntimeError(f"audio.synthesize runtime-native driver unavailable: {driver_kind or 'unset'}")
    command, ready, detail = driver_command_state(KOKORO_DRIVER_ENV, "kokoro")
    if not ready:
        raise RuntimeError(detail)
    response = run_driver_command(command, request_payload)
    if isinstance(response.get("audio_base64"), str) and response["audio_base64"].strip():
        try:
            payload = base64.b64decode(response["audio_base64"])
        except Exception as error:
            raise RuntimeError(f"speech driver audio_base64 invalid: {error}") from error
    else:
        audio_path = str(response.get("audio_path") or "").strip()
        if not audio_path:
            raise RuntimeError("speech driver response missing audio output")
        payload = pathlib.Path(audio_path).read_bytes()
    content_type = str(response.get("content_type") or "audio/wav").strip() or "audio/wav"
    if not payload:
        raise RuntimeError("speech driver returned empty audio payload")
    return payload, content_type


def transcribe_with_driver(model: SpeechModelState, request_payload: dict[str, Any]) -> str:
    driver_kind = model.capability_drivers.get("audio.transcribe", "").strip()
    if driver_kind != "whispercpp":
        raise RuntimeError(f"audio.transcribe runtime-native driver unavailable: {driver_kind or 'unset'}")
    command, ready, detail = driver_command_state(WHISPERCPP_DRIVER_ENV, "whispercpp")
    if not ready:
        raise RuntimeError(detail)
    response = run_driver_command(command, request_payload)
    text = str(response.get("text") or "").strip()
    if not text:
        raise RuntimeError("speech driver response missing transcription text")
    return text


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
                "kokoro_driver": state.kokoro_configured,
                "kokoro_driver_ready": state.kokoro_ready,
                "kokoro_driver_detail": state.kokoro_detail,
                "whispercpp_driver": state.whispercpp_configured,
                "whispercpp_driver_ready": state.whispercpp_ready,
                "whispercpp_driver_detail": state.whispercpp_detail,
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
            "not_admitted_capabilities": WORKFLOW_NOT_ADMITTED,
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
    def clone_voice():
        return workflow_not_admitted_response("voice clone")

    @app.post("/v1/voice/design")
    def design_voice():
        return workflow_not_admitted_response("voice design")

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

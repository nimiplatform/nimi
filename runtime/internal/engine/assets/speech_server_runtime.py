from __future__ import annotations
# @nimi-authority: definition.nimi.runtime.local-compute.speech-engine-plane
# @nimi-authority: rule.nimi.runtime.local-compute.r074
# @nimi-authority: rule.nimi.runtime.ai-provider.r112

import dataclasses
import hashlib
import json
import os
import pathlib
import secrets
import shlex
import shutil
import stat
import subprocess
import tempfile
import time
import uuid
from typing import Any

from fastapi.responses import JSONResponse

MODELS_ROOT_ENV = "NIMI_RUNTIME_LOCAL_MODELS_PATH"
ADMISSION_TOKEN_ENV = "NIMI_RUNTIME_SPEECH_ADMISSION_TOKEN"
ADMISSION_TOKEN_HEADER = "x-nimi-speech-admission-token"
QWEN3_TTS_DRIVER_ENV = "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
QWEN3_ASR_DRIVER_ENV = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"
QWEN3_ASR_TRANSFORMERS_DRIVER_ENV = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD"
VOXCPM_DRIVER_ENV = "NIMI_RUNTIME_SPEECH_VOXCPM_CMD"
VOXCPM_BACKEND_ENV = "NIMI_RUNTIME_SPEECH_VOXCPM_BACKEND"
DRIVER_TIMEOUT_MS_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS"
DRIVER_WORK_ROOT_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_WORK_ROOT"
DRIVER_OUTPUT_PATH_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_OUTPUT_PATH"
DEFAULT_DRIVER_TIMEOUT_MS = 30 * 60_000
MAX_DRIVER_TIMEOUT_MS = 30 * 60_000
SPEECH_DRIVER_ENV_BY_KIND = {
    "qwen3_tts": QWEN3_TTS_DRIVER_ENV,
    "qwen3_asr": QWEN3_ASR_DRIVER_ENV,
    "qwen3_asr_transformers": QWEN3_ASR_TRANSFORMERS_DRIVER_ENV,
    "voxcpm": VOXCPM_DRIVER_ENV,
}
REGISTERED_DRIVER_FACTS = {
    "nimi.runtime.driver.qwen3-tts": {
        "driver": "qwen3_tts",
        "family": "qwen3_tts",
        "backend": "qwen_tts",
        "capabilities": {"audio.synthesize", "voice.create"},
    },
    "nimi.runtime.driver.qwen3-asr": {
        "driver": "qwen3_asr",
        "family": "qwen3_asr",
        "backend": "qwen_asr",
        "capabilities": {"audio.transcribe"},
    },
    "nimi.runtime.driver.qwen3-asr-transformers": {
        "driver": "qwen3_asr_transformers",
        "family": "qwen3_asr",
        "backend": "transformers",
        "capabilities": {"audio.transcribe"},
    },
    "nimi.runtime.driver.voxcpm": {
        "driver": "voxcpm",
        "family": "voxcpm",
        "backend": "",
        "capabilities": {"audio.synthesize"},
    },
}
DEFAULT_MODELS_ROOT = ""
VOICE_CREATE_CAPABILITY = "voice.create"
VOICE_CREATION_SOURCES = {"reference_audio", "text_description"}


@dataclasses.dataclass
class SpeechModelState:
    model_id: str
    declared_capabilities: list[str]
    ready_capabilities: list[str]
    capability_drivers: dict[str, str]
    ready: bool
    detail: str
    bundle_dir: str
    entry_path: str
    declared_files: list[str]
    verified_content_id: str = ""
    entry_sha256: str = ""
    declared_file_sha256: dict[str, str] = dataclasses.field(default_factory=dict)
    driver_family: str = ""
    driver_backend: str = ""
    voice_creation_sources: list[str] = dataclasses.field(default_factory=list)
    workflow_model_bindings: dict[str, list[str]] = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class DriverAudioArtifact:
    path: pathlib.Path
    content_type: str
    size_bytes: int

    def cleanup(self) -> None:
        self.path.unlink(missing_ok=True)


@dataclasses.dataclass
class HostState:
    ready: bool
    status: str
    detail: str
    models: list[SpeechModelState]
    qwen3_tts_configured: bool
    qwen3_tts_ready: bool
    qwen3_tts_detail: str
    qwen3_asr_configured: bool
    qwen3_asr_ready: bool
    qwen3_asr_detail: str
    qwen3_asr_transformers_configured: bool
    qwen3_asr_transformers_ready: bool
    qwen3_asr_transformers_detail: str
    voxcpm_configured: bool = False
    voxcpm_ready: bool = False
    voxcpm_detail: str = "voxcpm driver not configured"


def default_models_root() -> str:
    return os.path.expanduser(
        os.environ.get(MODELS_ROOT_ENV, "").strip() or DEFAULT_MODELS_ROOT
    )


def configured_driver_command(env_name: str) -> list[str]:
    raw = os.environ.get(env_name, "").strip()
    if not raw:
        return []
    return [strip_matching_quotes(part) for part in shlex.split(raw, posix=os.name != "nt")]


def strip_matching_quotes(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


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


def driver_command_for_kind(driver_kind: str) -> list[str]:
    normalized = str(driver_kind or "").strip()
    env_name = SPEECH_DRIVER_ENV_BY_KIND.get(normalized, "")
    if not env_name:
        raise RuntimeError(f"speech runtime-native driver unavailable: {normalized or 'unset'}")
    command, ready, detail = driver_command_state(env_name, normalized)
    if not ready:
        raise RuntimeError(detail)
    return command


def create_voice_with_driver(model: SpeechModelState, request_payload: dict[str, Any]) -> dict[str, Any]:
    assert_registered_model_content(model)
    driver_kind = model.capability_drivers.get("voice.create", "").strip()
    response = run_driver_command(driver_command_for_kind(driver_kind), request_payload)
    if not isinstance(response, dict):
        raise RuntimeError("voice.create driver returned an invalid result")
    return response


def driver_timeout_seconds() -> float:
    raw = os.environ.get(DRIVER_TIMEOUT_MS_ENV, "").strip()
    if not raw:
        return DEFAULT_DRIVER_TIMEOUT_MS / 1000.0
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_DRIVER_TIMEOUT_MS / 1000.0
    value = min(max(value, 5_000), MAX_DRIVER_TIMEOUT_MS)
    return value / 1000.0


def driver_work_root() -> pathlib.Path:
    raw = os.environ.get(DRIVER_WORK_ROOT_ENV, "").strip()
    if not raw:
        raise RuntimeError("Runtime-owned speech driver work root is not configured")
    root = pathlib.Path(raw)
    if not root.is_absolute():
        raise RuntimeError("Runtime-owned speech driver work root must be absolute")
    if root.is_symlink() or not root.is_dir():
        raise RuntimeError("Runtime-owned speech driver work root is unavailable")
    return root


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


def truthy_form_value(value: str | None) -> bool:
    normalized = (value or "").strip().lower()
    return normalized in {"1", "true", "yes", "on"}


def truthy_payload_value(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return truthy_form_value(value)
    return False


def allow_empty_transcript_request(payload: dict[str, Any]) -> bool:
    extensions = payload.get("extensions")
    if not isinstance(extensions, dict):
        extensions = {}
    is_first_run_probe = truthy_payload_value(payload.get("nimi_first_run_baseline_probe")) or truthy_payload_value(extensions.get("nimi_first_run_baseline_probe"))
    allow_empty = (
        truthy_payload_value(payload.get("nimi_allow_empty_transcript"))
        or truthy_payload_value(payload.get("allow_empty_transcript"))
        or truthy_payload_value(extensions.get("nimi_allow_empty_transcript"))
        or truthy_payload_value(extensions.get("allow_empty_transcript"))
    )
    return is_first_run_probe and allow_empty


def exact_sha256_hex(value: str) -> bool:
    normalized = value.strip()
    if normalized != value or len(normalized) != 64 or normalized.lower() != normalized:
        return False
    try:
        int(normalized, 16)
    except ValueError:
        return False
    return True


def registered_declared_files(value: Any) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError("speech model registration requires declared_files")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            raise ValueError("speech model registration declared_files are invalid")
        declared = item.strip()
        relative = pathlib.PurePosixPath(declared)
        key = declared.lower()
        if (
            not declared
            or declared != item
            or relative.is_absolute()
            or relative.as_posix() != declared
            or declared == "."
            or ".." in relative.parts
            or key in seen
        ):
            raise ValueError("speech model registration declared_files are invalid")
        seen.add(key)
        result.append(declared)
    return result


def speech_model_registration_admitted(headers: Any) -> bool:
    expected = os.environ.get(ADMISSION_TOKEN_ENV, "").strip()
    provided = ""
    if headers is not None:
        provided = str(headers.get(ADMISSION_TOKEN_HEADER) or "")
    return bool(expected and provided and secrets.compare_digest(expected, provided))


def resolved_managed_models_root() -> pathlib.Path:
    configured = pathlib.Path(default_models_root())
    if not configured.is_absolute():
        raise ValueError("speech model registration managed models root is unavailable")
    try:
        resolved = configured.resolve(strict=True)
        info = resolved.stat()
    except OSError as error:
        raise ValueError("speech model registration managed models root is unavailable") from error
    if not stat.S_ISDIR(info.st_mode):
        raise ValueError("speech model registration managed models root is unavailable")
    return resolved


def path_is_within(root: pathlib.Path, candidate: pathlib.Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return True


def registered_speech_model_state(payload: dict[str, Any]) -> SpeechModelState:
    if not isinstance(payload, dict):
        raise ValueError("speech model registration payload must be an object")
    model_id = str(payload.get("model") or "").strip()
    capability = str(payload.get("capability") or "").strip()
    driver_id = str(payload.get("driver_id") or "").strip()
    driver_kind = str(payload.get("driver") or "").strip()
    family = str(payload.get("family") or "").strip()
    backend = str(payload.get("backend") or "").strip()
    facts = REGISTERED_DRIVER_FACTS.get(driver_id)
    if (
        not model_id
        or facts is None
        or capability not in facts["capabilities"]
        or driver_kind != facts["driver"]
        or family != facts["family"]
    ):
        raise ValueError("speech model registration Driver facts are invalid")
    expected_backend = str(facts["backend"])
    if driver_kind == "voxcpm":
        expected_backend = os.environ.get(VOXCPM_BACKEND_ENV, "").strip().lower()
        if expected_backend not in {"standard", "mlx"}:
            raise ValueError("speech model registration VoxCPM backend is unavailable")
    if backend != expected_backend:
        raise ValueError("speech model registration backend does not match the configured Driver")

    creation_source = str(payload.get("creation_source") or "").strip()
    workflow_model_id = str(payload.get("workflow_model_id") or "").strip()
    if capability == VOICE_CREATE_CAPABILITY:
        if creation_source not in VOICE_CREATION_SOURCES or not workflow_model_id:
            raise ValueError("speech voice.create registration requires one source and workflow model binding")
        voice_creation_sources = [creation_source]
        workflow_model_bindings = {creation_source: [workflow_model_id]}
    else:
        if creation_source or workflow_model_id:
            raise ValueError("speech voice.create registration binding is not admitted for this capability")
        voice_creation_sources = []
        workflow_model_bindings = {}

    bundle_dir = pathlib.Path(str(payload.get("bundle_dir") or "").strip())
    entry_path = pathlib.Path(str(payload.get("entry_path") or "").strip())
    declared_files = registered_declared_files(payload.get("declared_files"))
    if not bundle_dir.is_absolute() or not entry_path.is_absolute():
        raise ValueError("speech model registration paths must be absolute")
    managed_root = resolved_managed_models_root()
    try:
        resolved_bundle = bundle_dir.resolve(strict=True)
        bundle_info = resolved_bundle.stat()
    except OSError as error:
        raise ValueError("speech model registration bundle_dir is unavailable") from error
    if not stat.S_ISDIR(bundle_info.st_mode) or not path_is_within(managed_root, resolved_bundle):
        raise ValueError("speech model registration bundle_dir is outside the managed models root")
    try:
        resolved_entry = entry_path.resolve(strict=True)
        entry_relative = resolved_entry.relative_to(resolved_bundle).as_posix()
    except (OSError, ValueError) as error:
        raise ValueError("speech model registration entry_path is outside bundle_dir or unavailable") from error
    if entry_relative not in declared_files:
        raise ValueError("speech model registration entry_path is not declared")

    declared_paths: dict[str, pathlib.Path] = {}
    for declared in declared_files:
        candidate = resolved_bundle.joinpath(*pathlib.PurePosixPath(declared).parts)
        try:
            candidate_info = candidate.lstat()
            resolved_candidate = candidate.resolve(strict=True)
        except OSError as error:
            raise ValueError(f"speech model registration declared file is unavailable: {declared}") from error
        if (
            not stat.S_ISREG(candidate_info.st_mode)
            or not path_is_within(resolved_bundle, resolved_candidate)
            or not path_is_within(managed_root, resolved_candidate)
        ):
            raise ValueError(f"speech model registration declared file is not a managed regular file: {declared}")
        declared_paths[declared] = resolved_candidate
    try:
        entry_info = entry_path.lstat()
    except OSError as error:
        raise ValueError("speech model registration entry_path is unavailable") from error
    if declared_paths.get(entry_relative) != resolved_entry or not stat.S_ISREG(entry_info.st_mode) or entry_info.st_size <= 0:
        raise ValueError("speech model registration entry_path has no non-empty declared regular file")

    verified_content_id = str(payload.get("verified_content_id") or "").strip()
    entry_sha256 = str(payload.get("entry_sha256") or "").strip()
    if not verified_content_id or not exact_sha256_hex(entry_sha256):
        raise ValueError("speech model registration content identity is invalid")
    declared_file_sha256_raw = payload.get("declared_file_sha256")
    if not isinstance(declared_file_sha256_raw, dict) or set(declared_file_sha256_raw) != set(declared_files):
        raise ValueError("speech model registration declared file identities are incomplete")
    declared_file_sha256: dict[str, str] = {}
    for declared in declared_files:
        digest = str(declared_file_sha256_raw.get(declared) or "").strip().lower()
        if not exact_sha256_hex(digest):
            raise ValueError(f"speech model registration declared file identity is invalid: {declared}")
        declared_file_sha256[declared] = digest
    observed_digests = {
        declared: sha256_file(declared_paths[declared])
        for declared in declared_files
    }
    if observed_digests != declared_file_sha256:
        raise ValueError("speech model registration declared file bytes changed")
    if declared_file_sha256[entry_relative] != entry_sha256.lower():
        raise ValueError("speech model registration entry identity does not match declared bytes")

    _command, driver_ready, driver_detail = driver_command_state(
        SPEECH_DRIVER_ENV_BY_KIND[driver_kind],
        driver_kind,
    )
    return SpeechModelState(
        model_id=model_id,
        declared_capabilities=[capability],
        ready_capabilities=[capability] if driver_ready else [],
        capability_drivers={capability: driver_kind},
        ready=driver_ready,
        detail="ready" if driver_ready else driver_detail,
        bundle_dir=str(resolved_bundle),
        entry_path=str(resolved_entry),
        declared_files=declared_files,
        verified_content_id=verified_content_id,
        entry_sha256=entry_sha256,
        declared_file_sha256=declared_file_sha256,
        driver_family=family,
        driver_backend=backend,
        voice_creation_sources=voice_creation_sources,
        workflow_model_bindings=workflow_model_bindings,
    )


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def assert_registered_model_content(model: SpeechModelState) -> None:
    if not model.verified_content_id:
        return
    if not model.declared_files or set(model.declared_files) != set(model.declared_file_sha256):
        raise RuntimeError("registered speech model content seal is incomplete")
    bundle_dir = pathlib.Path(model.bundle_dir)
    observed: dict[str, str] = {}
    for declared in model.declared_files:
        candidate = bundle_dir.joinpath(*pathlib.PurePosixPath(declared).parts)
        info = candidate.lstat()
        if candidate.is_symlink() or not stat.S_ISREG(info.st_mode):
            raise RuntimeError(f"registered speech model file is unavailable: {declared}")
        observed[declared] = sha256_file(candidate)
    if observed != model.declared_file_sha256:
        raise RuntimeError("registered speech model bytes changed before Driver load")
    entry_relative = pathlib.Path(model.entry_path).resolve(strict=True).relative_to(bundle_dir.resolve(strict=True)).as_posix()
    if observed.get(entry_relative) != model.entry_sha256.lower():
        raise RuntimeError("registered speech model entry identity changed before Driver load")


def _read_bounded_process_output(handle: Any, limit: int = 64 * 1024) -> str:
    handle.flush()
    size = handle.seek(0, os.SEEK_END)
    handle.seek(max(0, size - limit), os.SEEK_SET)
    return handle.read(limit).decode("utf-8", errors="replace").strip()


def _terminate_driver_process(proc: subprocess.Popen[Any]) -> None:
    if proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def run_driver_command(
    command: list[str],
    request_payload: dict[str, Any],
    cancel_event: Any | None = None,
) -> dict[str, Any]:
    if not command:
        raise RuntimeError("speech driver command is not configured")
    work_root = driver_work_root()
    exchange_id = uuid.uuid4().hex
    request_path = work_root / f"request-{exchange_id}.json"
    response_path = work_root / f"response-{exchange_id}.json"
    audio_candidate = work_root / f"audio-{exchange_id}.wav" if request_payload.get("operation") == "audio.synthesize" else None
    keep_audio_candidate = False
    proc: subprocess.Popen[Any] | None = None
    try:
        with request_path.open("x", encoding="utf-8") as handle:
            handle.write(json.dumps(request_payload, ensure_ascii=True))
        deadline = time.monotonic() + driver_timeout_seconds()
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            driver_env = os.environ.copy()
            driver_env.pop(ADMISSION_TOKEN_ENV, None)
            if audio_candidate is not None:
                driver_env[DRIVER_OUTPUT_PATH_ENV] = str(audio_candidate)
            proc = subprocess.Popen(
                [*command, "--request", str(request_path), "--response", str(response_path)],
                env=driver_env,
                stdout=stdout,
                stderr=stderr,
            )
            while proc.poll() is None:
                if cancel_event is not None and cancel_event.is_set():
                    _terminate_driver_process(proc)
                    raise RuntimeError("speech driver cancelled")
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    _terminate_driver_process(proc)
                    raise RuntimeError("speech driver timed out")
                time.sleep(min(0.05, remaining))
            if proc.returncode != 0:
                detail = _read_bounded_process_output(stderr) or _read_bounded_process_output(stdout) or "driver exited non-zero"
                raise RuntimeError(f"speech driver failed: {detail}")
        if response_path.is_symlink() or not response_path.is_file():
            raise RuntimeError("speech driver did not write a response")
        try:
            payload = json.loads(response_path.read_text(encoding="utf-8"))
        except Exception as error:
            raise RuntimeError(f"speech driver response invalid: {error}") from error
        if not isinstance(payload, dict):
            raise RuntimeError("speech driver response must be an object")
        if audio_candidate is not None:
            declared_audio = pathlib.Path(str(payload.get("audio_path") or "").strip())
            if not declared_audio.is_absolute() or declared_audio.resolve() != audio_candidate.resolve():
                raise RuntimeError("speech driver did not return the Runtime-owned audio candidate")
            keep_audio_candidate = True
        return payload
    finally:
        if proc is not None and proc.poll() is None:
            _terminate_driver_process(proc)
        request_path.unlink(missing_ok=True)
        response_path.unlink(missing_ok=True)
        if audio_candidate is not None and not keep_audio_candidate:
            audio_candidate.unlink(missing_ok=True)


def claim_driver_audio_artifact(path_value: str, content_type: str) -> DriverAudioArtifact:
    work_root = driver_work_root().resolve()
    audio_path = pathlib.Path(path_value)
    if audio_path.is_symlink() or not audio_path.is_file():
        raise RuntimeError("speech driver audio artifact is unavailable")
    resolved = audio_path.resolve()
    try:
        resolved.relative_to(work_root)
    except ValueError as error:
        raise RuntimeError("speech driver audio artifact escaped Runtime-owned work root") from error
    size_bytes = resolved.stat().st_size
    if size_bytes <= 0:
        resolved.unlink(missing_ok=True)
        raise RuntimeError("speech driver returned empty audio payload")
    return DriverAudioArtifact(
        path=resolved,
        content_type=content_type,
        size_bytes=size_bytes,
    )


def build_host_state() -> HostState:
    qwen3_tts_driver_state = driver_command_state(QWEN3_TTS_DRIVER_ENV, "qwen3_tts")
    qwen3_asr_driver_state = driver_command_state(QWEN3_ASR_DRIVER_ENV, "qwen3_asr")
    qwen3_asr_transformers_driver_state = driver_command_state(QWEN3_ASR_TRANSFORMERS_DRIVER_ENV, "qwen3_asr_transformers")
    voxcpm_driver_state = driver_command_state(VOXCPM_DRIVER_ENV, "voxcpm")
    voxcpm_backend = os.environ.get(VOXCPM_BACKEND_ENV, "").strip().lower()
    if voxcpm_driver_state[0] and voxcpm_backend not in {"standard", "mlx"}:
        voxcpm_driver_state = (voxcpm_driver_state[0], False, "voxcpm backend is not configured")
    models: list[SpeechModelState] = []
    if not qwen3_tts_driver_state[0] and not qwen3_asr_driver_state[0] and not qwen3_asr_transformers_driver_state[0] and not voxcpm_driver_state[0]:
        detail = "no runtime-native speech drivers configured"
        status = "not_ready"
        ready = False
    else:
        detail = "speech drivers configured but no exact speech models registered"
        status = "not_ready"
        ready = False
    qwen3_tts_ready = qwen3_tts_driver_state[1]
    qwen3_tts_detail = qwen3_tts_driver_state[2]
    voxcpm_ready = voxcpm_driver_state[1]
    voxcpm_detail = voxcpm_driver_state[2]
    return HostState(
        ready=ready,
        status=status,
        detail=detail,
        models=models,
        qwen3_tts_configured=bool(qwen3_tts_driver_state[0]),
        qwen3_tts_ready=qwen3_tts_ready,
        qwen3_tts_detail=qwen3_tts_detail,
        qwen3_asr_configured=bool(qwen3_asr_driver_state[0]),
        qwen3_asr_ready=qwen3_asr_driver_state[1],
        qwen3_asr_detail=qwen3_asr_driver_state[2],
        qwen3_asr_transformers_configured=bool(qwen3_asr_transformers_driver_state[0]),
        qwen3_asr_transformers_ready=qwen3_asr_transformers_driver_state[1],
        qwen3_asr_transformers_detail=qwen3_asr_transformers_driver_state[2],
        voxcpm_configured=bool(voxcpm_driver_state[0]),
        voxcpm_ready=voxcpm_ready,
        voxcpm_detail=voxcpm_detail,
    )


def merge_registered_models_into_host_state(
    state: HostState,
    registered_models: list[SpeechModelState],
) -> HostState:
    registered_by_id = {
        model.model_id.strip(): model
        for model in registered_models
        if model.model_id.strip()
    }
    models = list(registered_by_id.values())
    models.extend(
        model
        for model in state.models
        if model.model_id.strip() not in registered_by_id
    )
    ready_models = [model for model in models if model.ready]
    if not ready_models:
        return dataclasses.replace(state, models=models)
    return dataclasses.replace(
        state,
        ready=True,
        status="ok",
        detail=f"{len(ready_models)} ready local speech model(s) available",
        models=models,
    )


def public_model_payload(model: SpeechModelState) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": model.model_id,
        "ready": model.ready,
        "detail": model.detail,
        "capabilities": model.ready_capabilities if model.ready_capabilities else model.declared_capabilities,
        "declared_capabilities": model.declared_capabilities,
        "capability_drivers": model.capability_drivers,
        "workflow_model_bindings": model.workflow_model_bindings,
    }
    if model.declared_files:
        payload["declared_files"] = model.declared_files
    return payload


def synthesize_with_driver(
    model: SpeechModelState,
    request_payload: dict[str, Any],
    cancel_event: Any | None = None,
) -> DriverAudioArtifact:
    assert_registered_model_content(model)
    driver_kind = model.capability_drivers.get("audio.synthesize", "").strip()
    if driver_kind == "qwen3_tts":
        command, ready, detail = driver_command_state(QWEN3_TTS_DRIVER_ENV, "qwen3_tts")
        if not ready:
            raise RuntimeError(detail)
    elif driver_kind == "voxcpm":
        command, ready, detail = driver_command_state(VOXCPM_DRIVER_ENV, "voxcpm")
        if not ready:
            raise RuntimeError(detail)
    else:
        raise RuntimeError(f"audio.synthesize runtime-native driver unavailable: {driver_kind or 'unset'}")
    response = run_driver_command(command, request_payload, cancel_event)
    audio_path = str(response.get("audio_path") or "").strip()
    if not audio_path:
        raise RuntimeError("speech driver response missing audio output")
    content_type = str(response.get("content_type") or "audio/wav").strip() or "audio/wav"
    try:
        return claim_driver_audio_artifact(audio_path, content_type)
    except Exception:
        pathlib.Path(audio_path).unlink(missing_ok=True)
        raise


def transcribe_with_driver(
    model: SpeechModelState,
    request_payload: dict[str, Any],
    cancel_event: Any | None = None,
) -> str:
    assert_registered_model_content(model)
    driver_kind = model.capability_drivers.get("audio.transcribe", "").strip()
    if driver_kind == "qwen3_asr":
        env_name = QWEN3_ASR_DRIVER_ENV
    elif driver_kind == "qwen3_asr_transformers":
        env_name = QWEN3_ASR_TRANSFORMERS_DRIVER_ENV
    else:
        raise RuntimeError(f"audio.transcribe runtime-native driver unavailable: {driver_kind or 'unset'}")
    command, ready, detail = driver_command_state(env_name, driver_kind)
    if not ready:
        raise RuntimeError(detail)
    response = run_driver_command(command, request_payload, cancel_event)
    text = str(response.get("text") or "").strip()
    if not text:
        if allow_empty_transcript_request(request_payload) and truthy_payload_value(response.get("empty_transcript")):
            return ""
        raise RuntimeError("speech driver response missing transcription text")
    return text


def workflow_execution_unavailable_response(operation: str, detail: str, reason: str) -> JSONResponse:
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


def local_workflow_not_admitted_response(operation: str, workflow_family: str) -> JSONResponse:
    family = workflow_family.strip()
    suffix = f": {family}" if family else ""
    return JSONResponse(
        status_code=501,
        content={
            "detail": {
                "message": f"local speech workflow family not admitted for {operation}{suffix}",
                "reason": "speech_workflow_family_not_admitted",
                "admission_state": "workflow_not_admitted",
                "workflow_family": family,
            }
        },
    )


def voice_workflow_result_from_driver(response: dict[str, Any]) -> dict[str, Any]:
    voice_id = str(response.get("voice_id") or response.get("voice_ref") or "").strip()
    if not voice_id:
        raise RuntimeError("speech workflow driver response missing voice_id")
    result = {"voice_id": voice_id}
    job_id = str(response.get("job_id") or "").strip()
    if job_id:
        result["job_id"] = job_id
    if isinstance(response.get("metadata"), dict):
        result["metadata"] = response["metadata"]
    return result

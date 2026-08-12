from __future__ import annotations

import dataclasses
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid
from typing import Any

from fastapi import HTTPException
from fastapi.responses import JSONResponse

MODELS_ROOT_ENV = "NIMI_RUNTIME_LOCAL_MODELS_PATH"
QWEN3_TTS_DRIVER_ENV = "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
QWEN3_ASR_DRIVER_ENV = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"
QWEN3_ASR_TRANSFORMERS_DRIVER_ENV = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD"
DRIVER_TIMEOUT_MS_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_TIMEOUT_MS"
DRIVER_WORK_ROOT_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_WORK_ROOT"
DRIVER_OUTPUT_PATH_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_OUTPUT_PATH"
DEFAULT_DRIVER_TIMEOUT_MS = 30 * 60_000
MAX_DRIVER_TIMEOUT_MS = 30 * 60_000
SPEECH_DRIVER_ENV_BY_KIND = {
    "qwen3_tts": QWEN3_TTS_DRIVER_ENV,
    "qwen3_asr": QWEN3_ASR_DRIVER_ENV,
    "qwen3_asr_transformers": QWEN3_ASR_TRANSFORMERS_DRIVER_ENV,
}
DEFAULT_MODELS_ROOT = ""
VOICE_CREATE_CAPABILITY = "voice.create"
VOICE_CREATION_SOURCES = {"reference_audio", "text_description"}
WORKFLOW_CAPABILITIES = [VOICE_CREATE_CAPABILITY]
PLAIN_SPEECH_CAPABILITIES = [
    "audio.synthesize",
    "audio.transcribe",
]
ADMITTED_SPEECH_CAPABILITIES = PLAIN_SPEECH_CAPABILITIES + WORKFLOW_CAPABILITIES
QWEN3_TTS_PREFLIGHT_CACHE: dict[tuple[str, str], tuple[bool, str]] = {}


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
    artifact_roles: list[str],
) -> str:
    normalized_model = model_id.strip().lower()
    normalized_entry = pathlib.Path(entry_path).name.strip().lower()
    normalized_files = [item.strip().lower() for item in declared_files]
    if capability in {"audio.synthesize", "voice.create"}:
        if "qwen3-tts" in normalized_model or "qwen3tts" in normalized_model:
            return "qwen3_tts"
        if "qwen3-tts" in normalized_entry or "qwen3tts" in normalized_entry:
            return "qwen3_tts"
        if any("qwen3-tts" in item or "qwen3tts" in item for item in normalized_files):
            return "qwen3_tts"
        return ""
    if capability == "audio.transcribe":
        normalized_roles = {item.strip().lower() for item in artifact_roles}
        if "stt_transformers_model" in normalized_roles:
            return "qwen3_asr_transformers"
        if "stt_model" in normalized_roles:
            return "qwen3_asr"
        return ""
    return ""


QWEN3_ASR_REQUIRED_FILES = (
    "model.safetensors",
    "config.json",
    "generation_config.json",
    "preprocessor_config.json",
    "chat_template.json",
    "tokenizer_config.json",
    "vocab.json",
    "merges.txt",
)

QWEN3_ASR_TRANSFORMERS_REQUIRED_FILES = (
    "model.safetensors",
    "config.json",
    "generation_config.json",
    "processor_config.json",
    "chat_template.jinja",
    "tokenizer_config.json",
    "tokenizer.json",
)


def runtime_native_bundle_layout_problems(
    driver_kind: str,
    entry_value: str,
    declared_files: list[str],
) -> list[str]:
    if driver_kind not in {"qwen3_asr", "qwen3_asr_transformers"}:
        return []
    problems: list[str] = []
    normalized_entry = entry_value.strip().replace("\\", "/").lower()
    if normalized_entry != "model.safetensors":
        problems.append("qwen3_asr bundle entry must be model.safetensors")
    normalized_declared = {
        item.strip().replace("\\", "/").lower()
        for item in declared_files
        if item.strip()
    }
    required_files = QWEN3_ASR_REQUIRED_FILES if driver_kind == "qwen3_asr" else QWEN3_ASR_TRANSFORMERS_REQUIRED_FILES
    for required_file in required_files:
        if required_file.lower() not in normalized_declared:
            problems.append(f'managed bundle file "{required_file}" missing')
    return problems


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


def load_entry_payload(entry_path: str) -> dict[str, Any]:
    if not entry_path:
        return {}
    try:
        payload = json.loads(pathlib.Path(entry_path).read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


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


def qwen3_tts_driver_preflight(command: list[str], model_id: str, entry_path: str) -> tuple[bool, str]:
    entry_payload = load_entry_payload(entry_path)
    model_ref = str(entry_payload.get("model_ref") or "").strip() or model_id.strip()
    cache_key = (" ".join(command), model_ref)
    cached = QWEN3_TTS_PREFLIGHT_CACHE.get(cache_key)
    if cached is not None:
        return cached
    try:
        response = run_driver_command(
            command,
            {
                "driver": "qwen3_tts",
                "operation": "driver.preflight",
                "model": model_id,
                "model_ref": model_ref,
                "entry_path": entry_path,
            },
        )
    except Exception as error:
        result = (False, f"qwen3_tts driver preflight failed: {error}")
        QWEN3_TTS_PREFLIGHT_CACHE[cache_key] = result
        return result
    driver_family = str(response.get("driver_family") or "").strip()
    if driver_family and driver_family != "qwen3_tts":
        result = (False, f"qwen3_tts driver preflight invalid family: {driver_family}")
        QWEN3_TTS_PREFLIGHT_CACHE[cache_key] = result
        return result
    result = (True, "qwen3_tts driver ready")
    QWEN3_TTS_PREFLIGHT_CACHE[cache_key] = result
    return result


def normalized_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        values: list[Any] = [value]
    elif isinstance(value, list):
        values = value
    else:
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in values:
        if not isinstance(item, str):
            continue
        normalized = item.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def target_model_ref_matches(ref: str, model_id: str) -> bool:
    normalized_ref = ref.strip().lower()
    normalized_model = model_id.strip().lower()
    if not normalized_ref or not normalized_model:
        return False
    if normalized_ref == normalized_model:
        return True
    if "/" in normalized_model and normalized_ref == normalized_model.split("/", 1)[1]:
        return True
    if "/" in normalized_ref and normalized_model == normalized_ref.split("/", 1)[1]:
        return True
    return False


def binding_target_refs(binding: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    refs.extend(normalized_string_list(binding.get("target_model_refs")))
    refs.extend(normalized_string_list(binding.get("target_model_ids")))
    refs.extend(normalized_string_list(binding.get("target_model_ref")))
    refs.extend(normalized_string_list(binding.get("target_model_id")))
    refs.extend(normalized_string_list(binding.get("target_model")))
    refs.extend(normalized_string_list(binding.get("model_id")))
    refs.extend(normalized_string_list(binding.get("model_ref")))
    return refs


def manifest_workflow_model_bindings(payload: dict[str, Any], model_id: str) -> dict[str, list[str]]:
    workflow_models = payload.get("voice_workflow_models")
    binding_rows = payload.get("model_workflow_bindings")
    if not isinstance(workflow_models, list) or not isinstance(binding_rows, list):
        return {}

    workflow_model_rows: dict[str, dict[str, Any]] = {}
    for row in workflow_models:
        if not isinstance(row, dict):
            continue
        workflow_model_id = str(row.get("workflow_model_id") or "").strip()
        workflow_type = str(row.get("workflow_type") or "").strip()
        if not workflow_model_id or workflow_type not in VOICE_CREATION_SOURCES:
            continue
        target_refs = binding_target_refs(row)
        if not any(target_model_ref_matches(ref, model_id) for ref in target_refs):
            continue
        workflow_model_rows[workflow_model_id] = row

    bindings_by_capability: dict[str, list[str]] = {}
    for row in binding_rows:
        if not isinstance(row, dict):
            continue
        workflow_model_id = str(row.get("workflow_model_id") or "").strip()
        workflow_row = workflow_model_rows.get(workflow_model_id)
        if workflow_row is None:
            continue
        target_refs = binding_target_refs(row)
        if not any(target_model_ref_matches(ref, model_id) for ref in target_refs):
            continue
        workflow_type = str(workflow_row.get("workflow_type") or "").strip()
        bindings_by_capability.setdefault(workflow_type, [])
        if workflow_model_id not in bindings_by_capability[workflow_type]:
            bindings_by_capability[workflow_type].append(workflow_model_id)
    return bindings_by_capability


def manifest_voice_creation_sources(payload: dict[str, Any], model_id: str) -> list[str]:
    sources: set[str] = set()
    roles = {
        item.strip().lower()
        for item in normalized_capabilities(payload.get("artifact_roles") or payload.get("artifactRoles"))
    }
    if "tts_voice_clone_model" in roles:
        sources.add("reference_audio")
    if "tts_voice_design_model" in roles:
        sources.add("text_description")

    # Explicit catalog workflow rows remain useful diagnostic metadata for
    # externally materialized bundles, but execution admission is owned by the
    # exact LocalAsset role rather than by a second copy of provider workflow
    # identities in asset.manifest.json.
    sources.update(manifest_workflow_model_bindings(payload, model_id).keys())
    return sorted(source for source in sources if source in VOICE_CREATION_SOURCES)


def manifest_speech_model_state(
    manifest_path: pathlib.Path,
    qwen3_tts_driver_state: tuple[list[str], bool, str],
    qwen3_asr_driver_state: tuple[list[str], bool, str],
    qwen3_asr_transformers_driver_state: tuple[list[str], bool, str],
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
        if capability in ADMITTED_SPEECH_CAPABILITIES
    ]
    if not declared_capabilities:
        return None

    bundle_dir = manifest_path.parent
    entry_value = str(payload.get("entry") or "").strip()
    entry_path = bundle_dir / entry_value if entry_value else None
    declared_files = normalized_capabilities(payload.get("files"))
    artifact_roles = normalized_capabilities(payload.get("artifact_roles") or payload.get("artifactRoles"))
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
    workflow_bindings = manifest_workflow_model_bindings(payload, model_id)
    voice_creation_sources = manifest_voice_creation_sources(payload, model_id)
    for capability in declared_capabilities:
        if capability == VOICE_CREATE_CAPABILITY:
            if not voice_creation_sources:
                problems.append("voice.create requires an explicit creation-source asset role")
                continue
            driver_kind = infer_runtime_native_driver(model_id, capability, resolved_entry, declared_files, artifact_roles)
            if not driver_kind:
                problems.append("voice.create runtime-native driver unresolved")
                continue
            capability_drivers[capability] = driver_kind
            try:
                driver_command_for_kind(driver_kind)
            except RuntimeError as error:
                problems.append(str(error))
                continue
            ready_capabilities.append(capability)
            continue
        driver_kind = infer_runtime_native_driver(model_id, capability, resolved_entry, declared_files, artifact_roles)
        if not driver_kind:
            problems.append(f"{capability} runtime-native driver unresolved")
            continue
        capability_drivers[capability] = driver_kind
        if capability == "audio.synthesize":
            if driver_kind != "qwen3_tts":
                problems.append(f"audio.synthesize requires unsupported driver {driver_kind}")
                continue
            if not qwen3_tts_driver_state[1]:
                problems.append(qwen3_tts_driver_state[2])
                continue
            qwen3_tts_ready, qwen3_tts_detail = qwen3_tts_driver_preflight(
                qwen3_tts_driver_state[0],
                model_id,
                resolved_entry,
            )
            if not qwen3_tts_ready:
                problems.append(qwen3_tts_detail)
                continue
            ready_capabilities.append(capability)
            continue
        if capability == "audio.transcribe":
            if driver_kind not in {"qwen3_asr", "qwen3_asr_transformers"}:
                problems.append(f"audio.transcribe requires unsupported driver {driver_kind}")
                continue
            layout_problems = runtime_native_bundle_layout_problems(driver_kind, entry_value, declared_files)
            if layout_problems:
                problems.extend(layout_problems)
                continue
            driver_state = qwen3_asr_driver_state if driver_kind == "qwen3_asr" else qwen3_asr_transformers_driver_state
            if not driver_state[1]:
                problems.append(driver_state[2])
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
        voice_creation_sources=voice_creation_sources,
        workflow_model_bindings=workflow_bindings,
    )


def discover_speech_models(
    models_root: str,
    qwen3_tts_driver_state: tuple[list[str], bool, str],
    qwen3_asr_driver_state: tuple[list[str], bool, str],
    qwen3_asr_transformers_driver_state: tuple[list[str], bool, str],
) -> list[SpeechModelState]:
    resolved_root = pathlib.Path(models_root) / "resolved"
    if not resolved_root.exists():
        return []
    models: list[SpeechModelState] = []
    for manifest_path in sorted(resolved_root.glob("**/asset.manifest.json")):
        if not manifest_path.is_file():
            continue
        state = manifest_speech_model_state(manifest_path, qwen3_tts_driver_state, qwen3_asr_driver_state, qwen3_asr_transformers_driver_state)
        if state is not None:
            models.append(state)
    return models


def build_host_state() -> HostState:
    qwen3_tts_driver_state = driver_command_state(QWEN3_TTS_DRIVER_ENV, "qwen3_tts")
    qwen3_asr_driver_state = driver_command_state(QWEN3_ASR_DRIVER_ENV, "qwen3_asr")
    qwen3_asr_transformers_driver_state = driver_command_state(QWEN3_ASR_TRANSFORMERS_DRIVER_ENV, "qwen3_asr_transformers")
    models = discover_speech_models(default_models_root(), qwen3_tts_driver_state, qwen3_asr_driver_state, qwen3_asr_transformers_driver_state)
    ready_models = [model for model in models if model.ready]
    if ready_models:
        detail = f"{len(ready_models)} ready local speech model(s) discovered"
        status = "ok"
        ready = True
    elif not qwen3_tts_driver_state[0] and not qwen3_asr_driver_state[0] and not qwen3_asr_transformers_driver_state[0]:
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
    qwen3_tts_ready = qwen3_tts_driver_state[1]
    qwen3_tts_detail = qwen3_tts_driver_state[2]
    qwen3_tts_models = [
        model for model in models if model.capability_drivers.get("audio.synthesize", "").strip() == "qwen3_tts"
    ]
    if qwen3_tts_models:
        ready_qwen3_tts_models = [
            model for model in qwen3_tts_models if model.ready and "audio.synthesize" in model.ready_capabilities
        ]
        if ready_qwen3_tts_models:
            qwen3_tts_ready = True
            qwen3_tts_detail = "qwen3_tts driver ready"
        else:
            qwen3_tts_ready = False
            qwen3_tts_detail = qwen3_tts_models[0].detail
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
    raise HTTPException(
        status_code=503,
        detail={
            "message": f'local speech model "{target}" is not ready for {capability}',
            "reason": "speech_model_not_ready",
            "model": target,
            "capability": capability,
        },
    )


def find_ready_voice_creation_model(model_id: str, creation_source: str, workflow_model_id: str) -> SpeechModelState:
    source = creation_source.strip()
    if source not in VOICE_CREATION_SOURCES:
        raise HTTPException(status_code=400, detail={"message": "voice.create source is invalid", "reason": "speech_request_invalid"})
    model = find_ready_model(model_id, VOICE_CREATE_CAPABILITY)
    if source not in model.voice_creation_sources:
        raise HTTPException(
            status_code=503,
            detail={
                "message": f'local speech model "{model_id.strip()}" does not support voice.create source "{source}"',
                "reason": "speech_workflow_binding_not_ready",
                "model": model_id.strip(),
                "capability": VOICE_CREATE_CAPABILITY,
                "creation_source": source,
                "workflow_model_id": workflow_model_id.strip(),
            },
        )
    return model


def synthesize_with_driver(
    model: SpeechModelState,
    request_payload: dict[str, Any],
    cancel_event: Any | None = None,
) -> DriverAudioArtifact:
    driver_kind = model.capability_drivers.get("audio.synthesize", "").strip()
    if driver_kind == "qwen3_tts":
        command, ready, detail = driver_command_state(QWEN3_TTS_DRIVER_ENV, "qwen3_tts")
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


def infer_workflow_family(target_model_id: str, workflow_model_id: str) -> str:
    normalized_target = target_model_id.strip().lower()
    normalized_workflow = workflow_model_id.strip().lower()
    if "qwen3-tts" in normalized_target or "qwen3tts" in normalized_target:
        return "qwen3_tts"
    if "qwen3-tts" in normalized_workflow or "qwen3tts" in normalized_workflow:
        return "qwen3_tts"
    return ""


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

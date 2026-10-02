#!/usr/bin/env python3
from __future__ import annotations
# @nimi-authority: rule.nimi.runtime.ai-provider.r112
# @nimi-authority: rule.nimi.runtime.local-compute.r110

import argparse
import base64
import tempfile
import importlib.metadata
import json
import os
import pathlib
import sys
from typing import Any

DRIVER_FAMILY = "voxcpm"
DRIVER_BACKEND = "standard"
DRIVER_WORK_ROOT_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_WORK_ROOT"
DRIVER_OUTPUT_PATH_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_OUTPUT_PATH"
_MODEL_CACHE: dict[str, Any] = {}


def fail(message: str) -> None:
    raise RuntimeError(message)


def read_json(path: str) -> dict[str, Any]:
    payload = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        fail("request payload must be an object")
    return payload


def write_json(path: str, payload: dict[str, Any]) -> None:
    pathlib.Path(path).write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


def require_string(payload: dict[str, Any], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        fail(f"missing required field: {key}")
    return value


def optional_string(payload: dict[str, Any], key: str) -> str:
    return str(payload.get(key) or "").strip()


def ensure_dependencies_importable() -> tuple[Any, Any]:
    try:
        from voxcpm import VoxCPM  # type: ignore
    except Exception as error:
        fail(f"voxcpm import failed: {error}")
    try:
        import soundfile as sf  # type: ignore
    except Exception as error:
        fail(f"soundfile import failed: {error}")
    return VoxCPM, sf


def managed_model_ref(request: dict[str, Any]) -> str:
    bundle_dir = pathlib.Path(optional_string(request, "bundle_dir"))
    if not bundle_dir.is_absolute() or bundle_dir.is_symlink() or not bundle_dir.is_dir():
        fail("VoxCPM managed bundle_dir is unavailable")
    declared = request.get("declared_files")
    if not isinstance(declared, list) or not declared:
        fail("VoxCPM managed bundle has no declared files")
    for item in declared:
        relative = pathlib.PurePosixPath(str(item or "").strip())
        if not str(relative) or relative.is_absolute() or ".." in relative.parts:
            fail("VoxCPM managed bundle declares an invalid file")
        candidate = bundle_dir.joinpath(*relative.parts)
        if candidate.is_symlink() or not candidate.is_file():
            fail(f"VoxCPM managed bundle file is unavailable: {relative}")
    return str(bundle_dir)


def load_model(model_ref: str) -> Any:
    cached = _MODEL_CACHE.get(model_ref)
    if cached is not None:
        return cached
    VoxCPM, _ = ensure_dependencies_importable()
    try:
        model = VoxCPM.from_pretrained(model_ref, load_denoiser=False)
    except Exception as error:
        fail(f"VoxCPM model load failed: {error}")
    _MODEL_CACHE[model_ref] = model
    return model


def driver_work_root() -> pathlib.Path:
    value = str(os.environ.get(DRIVER_WORK_ROOT_ENV) or "").strip()
    root = pathlib.Path(value)
    if not value or not root.is_absolute() or root.is_symlink() or not root.is_dir():
        fail("Runtime-owned speech driver work root is unavailable")
    return root.resolve()


def output_path() -> pathlib.Path:
    work_root = driver_work_root()
    value = str(os.environ.get(DRIVER_OUTPUT_PATH_ENV) or "").strip()
    candidate = pathlib.Path(value)
    if not value or not candidate.is_absolute() or candidate.is_symlink() or candidate.exists():
        fail("Runtime-owned speech output path is invalid")
    try:
        candidate.resolve().relative_to(work_root)
    except ValueError as error:
        fail(f"Runtime-owned speech output path escaped work root: {error}")
    return candidate


def validate_synthesis_request(request: dict[str, Any]) -> str:
    if optional_string(request, "driver") != DRIVER_FAMILY:
        fail("VoxCPM Driver family mismatch")
    text = require_string(request, "input")
    voice = optional_string(request, "voice")
    if voice not in {"", "default"}:
        fail("VoxCPM first release supports only the default synthesis voice")
    audio_format = optional_string(request, "audio_format").lower()
    if audio_format not in {"", "wav", "wave"}:
        fail("VoxCPM supports only WAV output")
    for key in ("language", "emotion"):
        if optional_string(request, key):
            fail(f"VoxCPM synthesis option is unsupported: {key}")
    for key in ("sample_rate_hz", "speed", "pitch", "volume"):
        if request.get(key) is not None:
            fail(f"VoxCPM synthesis option is unsupported: {key}")
    if request.get("extensions") not in (None, {}):
        fail("VoxCPM synthesis extensions are unsupported")
    return text


def handle_preflight() -> dict[str, Any]:
    ensure_dependencies_importable()
    try:
        version = importlib.metadata.version("voxcpm")
    except Exception:
        version = ""
    result: dict[str, Any] = {
        "driver_family": DRIVER_FAMILY,
        "driver_backend": DRIVER_BACKEND,
        "supports": ["audio.synthesize"],
    }
    if version:
        result["voxcpm_version"] = version
    return result


def condition_audio(request, key, directory, sf):
    encoded = request.get(key)
    if encoded is None:
        return None
    if not isinstance(encoded, str) or not encoded or len(encoded) > 4 * ((32 * 1024 * 1024 + 2) // 3):
        fail("invalid captured speech reference")
    try:
        data = base64.b64decode(encoded, validate=True)
    except Exception as error:
        fail(f"invalid captured speech reference encoding: {error}")
    if not data or len(data) > 32 * 1024 * 1024:
        fail("captured speech reference exceeds limits")
    path = pathlib.Path(directory) / (key + ".wav")
    path.write_bytes(data)
    info = sf.info(str(path))
    if info.format != "WAV" or info.duration <= 0 or info.duration > 30:
        fail("captured speech reference is not an admitted canonical timeline")
    return str(path)


def handle_synthesize(request: dict[str, Any]) -> dict[str, Any]:
    text = validate_synthesis_request(request)
    model_ref = managed_model_ref(request)
    model = load_model(model_ref)
    _, sf = ensure_dependencies_importable()
    try:
        with tempfile.TemporaryDirectory(prefix="voxcpm-reference-", dir=driver_work_root()) as directory:
            identity = condition_audio(request, "identity_audio_base64", directory, sf)
            performance = condition_audio(request, "performance_audio_base64", directory, sf)
            transcript = request.get("performance_text")
            if performance:
                if not isinstance(transcript, str) or not transcript.strip() or len(transcript.encode("utf-8")) > 4096:
                    fail("performance reference requires its exact transcript")
            elif transcript is not None:
                fail("performance transcript has no audio")
            options = {}
            if identity:
                options["reference_wav_path"] = identity
            if performance:
                options["prompt_wav_path"] = performance
                options["prompt_text"] = transcript
            wav = model.generate(text=text, cfg_value=2.0, inference_timesteps=10, **options)
    except Exception as error:
        fail(f"VoxCPM generation failed: {error}")
    destination = output_path()
    _, sf = ensure_dependencies_importable()
    try:
        sample_rate = int(model.tts_model.sample_rate)
        sf.write(str(destination), wav, sample_rate)
    except Exception as error:
        destination.unlink(missing_ok=True)
        fail(f"VoxCPM audio write failed: {error}")
    if not destination.is_file() or destination.stat().st_size <= 0:
        destination.unlink(missing_ok=True)
        fail("VoxCPM generation returned no audio")
    return {
        "audio_path": str(destination),
        "content_type": "audio/wav",
    }


def handle_request(request: dict[str, Any]) -> dict[str, Any]:
    operation = require_string(request, "operation")
    if operation == "driver.preflight":
        return handle_preflight()
    if operation == "audio.synthesize":
        return handle_synthesize(request)
    fail(f"unsupported VoxCPM operation: {operation}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        response = handle_request(read_json(args.request))
        write_json(args.response, response)
        return 0
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

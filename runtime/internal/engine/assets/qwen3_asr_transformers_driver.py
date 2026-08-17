#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import pathlib
import sys
from typing import Any


DEFAULT_MAX_NEW_TOKENS = 256
_MODEL_CACHE: dict[tuple[str, str, str], tuple[Any, Any]] = {}


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


def normalized_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := str(item or "").strip())]


def local_bundle_model_ref(request: dict[str, Any]) -> str:
    bundle_dir = optional_string(request, "bundle_dir")
    if not bundle_dir:
        fail("managed Transformers ASR bundle_dir is required")
    bundle_path = pathlib.Path(bundle_dir)
    if not bundle_path.is_dir() or bundle_path.is_symlink():
        fail("managed Transformers ASR bundle_dir is unavailable")
    for file_name in normalized_string_list(request.get("declared_files")):
        candidate = bundle_path / file_name
        if not candidate.is_file() or candidate.is_symlink():
            fail(f"managed Transformers ASR bundle missing declared file: {file_name}")
    entry_path = optional_string(request, "entry_path")
    if entry_path:
        entry = pathlib.Path(entry_path)
        if not entry.is_file() or entry.is_symlink():
            fail("managed Transformers ASR entry_path is unavailable")
        try:
            entry.resolve().relative_to(bundle_path.resolve())
        except ValueError:
            fail("managed Transformers ASR entry_path is outside bundle_dir")
    return str(bundle_path)


def resolve_model_ref(request: dict[str, Any]) -> str:
    return local_bundle_model_ref(request)


def transformers_device_map() -> str:
    requested = str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_DEVICE_MAP") or "").strip()
    if requested:
        return requested
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda:0"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def transformers_dtype():
    try:
        import torch
    except Exception as error:
        fail(f"torch import failed: {error}")
    requested = str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_DTYPE") or "").strip().lower()
    if requested in {"float16", "fp16", "half"}:
        return torch.float16
    if requested in {"bfloat16", "bf16"}:
        return torch.bfloat16
    if requested in {"float32", "fp32"}:
        return torch.float32
    return torch.float32 if transformers_device_map() == "cpu" else torch.bfloat16


def max_new_tokens() -> int:
    raw = str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_MAX_NEW_TOKENS") or "").strip()
    if not raw:
        return DEFAULT_MAX_NEW_TOKENS
    try:
        return max(int(raw), 1)
    except ValueError:
        return DEFAULT_MAX_NEW_TOKENS


def normalized_language(value: str) -> str | None:
    text = str(value or "").strip()
    if not text or text.lower() == "auto":
        return None
    return {
        "zh": "Chinese",
        "zh-cn": "Chinese",
        "en": "English",
        "en-us": "English",
        "en-gb": "English",
        "ja": "Japanese",
        "ko": "Korean",
        "fr": "French",
        "de": "German",
        "es": "Spanish",
        "pt": "Portuguese",
        "ru": "Russian",
    }.get(text.lower(), text)


def bool_request(request: dict[str, Any], key: str) -> bool:
    value = request.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def allow_empty_transcript(request: dict[str, Any]) -> bool:
    extensions = request.get("extensions")
    if not isinstance(extensions, dict):
        extensions = {}
    probe = bool_request(request, "nimi_first_run_baseline_probe") or bool_request(extensions, "nimi_first_run_baseline_probe")
    allowed = (
        bool_request(request, "nimi_allow_empty_transcript")
        or bool_request(request, "allow_empty_transcript")
        or bool_request(extensions, "nimi_allow_empty_transcript")
        or bool_request(extensions, "allow_empty_transcript")
    )
    return probe and allowed


def ensure_transformers_importable() -> None:
    try:
        from transformers import AutoModelForMultimodalLM, AutoProcessor  # noqa: F401
    except Exception as error:
        fail(f"Transformers-native Qwen3-ASR import failed: {error}")


def cache_key(model_ref: str) -> tuple[str, str, str]:
    dtype = transformers_dtype()
    return model_ref, transformers_device_map(), str(dtype)


def load_model(model_ref: str) -> tuple[Any, Any]:
    ensure_transformers_importable()
    key = cache_key(model_ref)
    cached = _MODEL_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        from transformers import AutoModelForMultimodalLM, AutoProcessor

        processor = AutoProcessor.from_pretrained(model_ref, local_files_only=True)
        model = AutoModelForMultimodalLM.from_pretrained(
            model_ref,
            device_map=transformers_device_map(),
            dtype=transformers_dtype(),
            local_files_only=True,
        )
        model.eval()
    except Exception as error:
        fail(f"Transformers-native Qwen3-ASR model load failed: {error}")
    _MODEL_CACHE[key] = (processor, model)
    return processor, model


def handle_preflight(model_ref: str) -> dict[str, Any]:
    ensure_transformers_importable()
    try:
        version = importlib.metadata.version("transformers")
    except Exception:
        version = ""
    response: dict[str, Any] = {
        "driver_family": "qwen3_asr_transformers",
        "driver_backend": "transformers",
        "model_ref": model_ref,
        "supports": ["audio.transcribe"],
    }
    if version:
        response["transformers_version"] = version
    return response


def handle_transcribe(request: dict[str, Any]) -> dict[str, Any]:
    if bool_request(request, "timestamps"):
        fail("Transformers-native Qwen3-ASR timestamps are not admitted")
    if bool_request(request, "diarization") or int(request.get("speaker_count") or 0) != 0:
        fail("Transformers-native Qwen3-ASR diarization is not admitted")
    if optional_string(request, "prompt"):
        fail("Transformers-native Qwen3-ASR prompt is not admitted")
    audio_path = require_string(request, "audio_path")
    if not pathlib.Path(audio_path).is_file():
        fail("audio_path does not exist")
    model_ref = resolve_model_ref(request)
    processor, model = load_model(model_ref)
    language = normalized_language(optional_string(request, "language"))
    try:
        inputs = processor.apply_transcription_request(audio=audio_path, language=language)
        inputs = inputs.to(model.device, model.dtype)
        output_ids = model.generate(**inputs, max_new_tokens=max_new_tokens())
        generated_ids = output_ids[:, inputs["input_ids"].shape[1]:]
        decoded = processor.decode(generated_ids, return_format="transcription_only")
    except Exception as error:
        fail(f"Transformers-native Qwen3-ASR transcription failed: {error}")
    if isinstance(decoded, (list, tuple)):
        text = str(decoded[0] if decoded else "").strip()
    else:
        text = str(decoded or "").strip()
    if not text:
        if allow_empty_transcript(request):
            return {"text": "", "empty_transcript": True}
        fail("Transformers-native Qwen3-ASR returned no transcription")
    return {"text": text}


def handle_request(request: dict[str, Any]) -> dict[str, Any]:
    operation = require_string(request, "operation")
    model_ref = resolve_model_ref(request)
    if operation == "driver.preflight":
        return handle_preflight(model_ref)
    if operation == "audio.transcribe":
        return handle_transcribe(request)
    fail(f"unsupported qwen3_asr_transformers operation: {operation}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        request = read_json(args.request)
        response = handle_request(request)
        write_json(args.response, response)
        return 0
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

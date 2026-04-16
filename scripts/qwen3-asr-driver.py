#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import pathlib
import sys
from typing import Any


DEFAULT_ASR_MODEL = "Qwen/Qwen3-ASR-0.6B"
DEFAULT_MAX_NEW_TOKENS = 256
DEFAULT_FORCED_ALIGNER = "Qwen/Qwen3-ForcedAligner-0.6B"
_MODEL_CACHE: dict[tuple[str, bool, str, str], Any] = {}


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


def load_entry_payload(entry_path: str) -> dict[str, Any]:
    if not entry_path:
        return {}
    try:
        payload = json.loads(pathlib.Path(entry_path).read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def resolve_model_ref(request: dict[str, Any], cli_default: str) -> str:
    if isinstance(request.get("model_ref"), str) and str(request["model_ref"]).strip():
        return str(request["model_ref"]).strip()
    entry_payload = load_entry_payload(optional_string(request, "entry_path"))
    if isinstance(entry_payload.get("model_ref"), str) and str(entry_payload["model_ref"]).strip():
        return str(entry_payload["model_ref"]).strip()
    return str(cli_default or DEFAULT_ASR_MODEL).strip() or DEFAULT_ASR_MODEL


def qwen3_asr_device_map() -> str:
    value = str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_ASR_DEVICE_MAP") or "").strip()
    if value:
        return value
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda:0"
    except Exception:
        pass
    return "cpu"


def qwen3_asr_dtype():
    try:
        import torch
    except Exception as error:
        fail(f"torch import failed: {error}")
    requested = str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_ASR_DTYPE") or "").strip().lower()
    if requested in {"float16", "fp16", "half"}:
        return torch.float16
    if requested in {"bfloat16", "bf16"}:
        return torch.bfloat16
    if requested in {"float32", "fp32"}:
        return torch.float32
    if qwen3_asr_device_map() == "cpu":
        return torch.float32
    return torch.bfloat16


def max_new_tokens() -> int:
    raw = str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_ASR_MAX_NEW_TOKENS") or "").strip()
    if not raw:
        return DEFAULT_MAX_NEW_TOKENS
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_MAX_NEW_TOKENS
    return max(value, 1)


def normalized_language(value: str) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    lowered = text.lower()
    mapping = {
        "auto": None,
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
    }
    if lowered in mapping:
        return mapping[lowered]
    return text


def ensure_qwen_asr_importable() -> None:
    try:
        __import__("qwen_asr")
    except Exception as error:
        fail(f"qwen_asr import failed: {error}")


def bool_request(request: dict[str, Any], key: str) -> bool:
    value = request.get(key)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def forced_aligner_model(return_time_stamps: bool) -> str:
    if not return_time_stamps:
        return ""
    return str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_ASR_FORCED_ALIGNER") or "").strip() or DEFAULT_FORCED_ALIGNER


def qwen3_asr_backend_name() -> str:
    return str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_ASR_BACKEND") or "").strip() or "qwen_asr"


def cache_key(model_ref: str, return_time_stamps: bool) -> tuple[str, bool, str, str]:
    dtype = qwen3_asr_dtype()
    dtype_name = getattr(dtype, "__str__", lambda: repr(dtype))()
    return model_ref, return_time_stamps, qwen3_asr_device_map(), dtype_name


def load_qwen3_asr_model(model_ref: str, return_time_stamps: bool):
    ensure_qwen_asr_importable()
    key = cache_key(model_ref, return_time_stamps)
    cached = _MODEL_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        from qwen_asr import Qwen3ASRModel
    except Exception as error:
        fail(f"qwen_asr import failed: {error}")
    kwargs: dict[str, Any] = {
        "dtype": qwen3_asr_dtype(),
        "device_map": qwen3_asr_device_map(),
        "max_new_tokens": max_new_tokens(),
    }
    forced_aligner = forced_aligner_model(return_time_stamps)
    if forced_aligner:
        kwargs["forced_aligner"] = forced_aligner
        kwargs["forced_aligner_kwargs"] = {
            "dtype": qwen3_asr_dtype(),
            "device_map": qwen3_asr_device_map(),
        }
    try:
        model = Qwen3ASRModel.from_pretrained(model_ref, **kwargs)
    except Exception as error:
        fail(f"qwen3_asr model load failed: {error}")
    _MODEL_CACHE[key] = model
    return model


def handle_preflight(model_ref: str) -> dict[str, Any]:
    ensure_qwen_asr_importable()
    try:
        version = importlib.metadata.version("qwen-asr")
    except Exception:
        version = ""
    response: dict[str, Any] = {
        "driver_family": "qwen3_asr",
        "driver_backend": qwen3_asr_backend_name(),
        "model_ref": model_ref,
        "supports": ["audio.transcribe"],
    }
    if version:
        response["qwen_asr_version"] = version
    return response


def result_attr(result: Any, name: str) -> Any:
    if isinstance(result, dict):
        return result.get(name)
    return getattr(result, name, None)


def serialize_time_stamps(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, (list, tuple)):
        return []
    rows: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            rows.append(item)
            continue
        if hasattr(item, "__dict__"):
            rows.append({key: item.__dict__[key] for key in item.__dict__})
            continue
        if isinstance(item, (list, tuple)) and len(item) >= 3:
            rows.append({"start": item[0], "end": item[1], "text": item[2]})
    return rows


def handle_transcribe(request: dict[str, Any], cli_default_model: str) -> dict[str, Any]:
    audio_path = require_string(request, "audio_path")
    if not pathlib.Path(audio_path).exists():
        fail(f"audio_path does not exist: {audio_path}")
    return_time_stamps = bool_request(request, "timestamps")
    model_ref = resolve_model_ref(request, cli_default_model)
    model = load_qwen3_asr_model(model_ref, return_time_stamps)
    language = normalized_language(optional_string(request, "language"))
    try:
        results = model.transcribe(
            audio=audio_path,
            language=language,
            return_time_stamps=return_time_stamps,
        )
    except TypeError:
        # Some package versions may not accept timestamps on the call itself.
        results = model.transcribe(
            audio=audio_path,
            language=language,
        )
    except Exception as error:
        fail(f"qwen3_asr transcribe failed: {error}")
    if not results:
        fail("qwen3_asr transcribe returned no result")
    first = results[0]
    text = str(result_attr(first, "text") or "").strip()
    if not text:
        fail("qwen3_asr transcribe result missing text")
    response: dict[str, Any] = {"text": text}
    language_value = result_attr(first, "language")
    if isinstance(language_value, str) and language_value.strip():
        response["language"] = language_value.strip()
    if return_time_stamps:
        response["time_stamps"] = serialize_time_stamps(result_attr(first, "time_stamps"))
    return response


def handle_request(request: dict[str, Any], cli_default_model: str) -> dict[str, Any]:
    operation = require_string(request, "operation")
    model_ref = resolve_model_ref(request, cli_default_model)
    if operation == "driver.preflight":
        return handle_preflight(model_ref)
    if operation == "audio.transcribe":
        return handle_transcribe(request, cli_default_model)
    fail(f"unsupported qwen3_asr operation: {operation}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    parser.add_argument("--model", default=DEFAULT_ASR_MODEL)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        request = read_json(args.request)
        response = handle_request(request, str(args.model).strip() or DEFAULT_ASR_MODEL)
        write_json(args.response, response)
        return 0
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

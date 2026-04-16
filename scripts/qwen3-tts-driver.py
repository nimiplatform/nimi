#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import importlib.metadata
import json
import mimetypes
import os
import pathlib
import sys
import tempfile
from typing import Any


VOICE_DESIGN_PREFIX = "qwen3_tts:design:"
VOICE_CLONE_PREFIX = "qwen3_tts:clone:"
DEFAULT_TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice"
DEFAULT_MAX_NEW_TOKENS = 1024

_MODEL_CACHE: dict[tuple[str, str, str], Any] = {}


def fail(message: str) -> None:
    raise RuntimeError(message)


def read_json(path: str) -> dict[str, Any]:
    payload = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        fail("request payload must be an object")
    return payload


def write_json(path: str, payload: dict[str, Any]) -> None:
    pathlib.Path(path).write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


def encode_voice_handle(prefix: str, payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    token = base64.urlsafe_b64encode(blob).decode("ascii").rstrip("=")
    return prefix + token


def decode_handle_payload(token: str) -> dict[str, Any]:
    padded = token + ("=" * ((4 - len(token) % 4) % 4))
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
    except Exception as error:
        fail(f"voice handle invalid: {error}")
    if not isinstance(payload, dict):
        fail("voice handle payload must be an object")
    return payload


def decode_voice_handle(value: str) -> tuple[str, dict[str, Any] | None]:
    if value.startswith(VOICE_DESIGN_PREFIX):
        return "design", decode_handle_payload(value[len(VOICE_DESIGN_PREFIX) :])
    if value.startswith(VOICE_CLONE_PREFIX):
        return "clone", decode_handle_payload(value[len(VOICE_CLONE_PREFIX) :])
    return "", None


def require_string(payload: dict[str, Any], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        fail(f"missing required field: {key}")
    return value


def optional_string(payload: dict[str, Any], key: str) -> str:
    return str(payload.get(key) or "").strip()


def bool_env(name: str, default: bool = False) -> bool:
    raw = str(os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def qwen3_tts_device_map() -> str:
    value = str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_TTS_DEVICE_MAP") or "").strip()
    if value:
        return value
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def qwen3_tts_dtype():
    try:
        import torch
    except Exception as error:
        fail(f"torch import failed: {error}")
    requested = str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_TTS_DTYPE") or "").strip().lower()
    if requested in {"float16", "fp16", "half"}:
        return torch.float16
    if requested in {"bfloat16", "bf16"}:
        return torch.bfloat16
    if requested in {"float32", "fp32"}:
        return torch.float32
    if qwen3_tts_device_map() == "cpu":
        return torch.float32
    return torch.bfloat16


def max_new_tokens() -> int:
    raw = str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_TTS_MAX_NEW_TOKENS") or "").strip()
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
        "cn": "Chinese",
        "en": "English",
        "en-us": "English",
        "en-gb": "English",
        "ja": "Japanese",
        "jp": "Japanese",
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
    return str(cli_default or DEFAULT_TTS_MODEL).strip() or DEFAULT_TTS_MODEL


def qwen_tts_backend_name() -> str:
    return str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_TTS_BACKEND") or "").strip() or "qwen_tts"


def ensure_qwen_tts_importable() -> None:
    try:
        __import__("qwen_tts")
    except Exception as error:
        fail(f"qwen_tts import failed: {error}")
    try:
        __import__("soundfile")
    except Exception as error:
        fail(f"soundfile import failed: {error}")


def cached_model_key(model_ref: str) -> tuple[str, str, str]:
    device_map = qwen3_tts_device_map()
    dtype = qwen3_tts_dtype()
    dtype_name = getattr(dtype, "__str__", lambda: repr(dtype))()
    return model_ref, device_map, dtype_name


def load_qwen_tts_model(model_ref: str):
    ensure_qwen_tts_importable()
    cache_key = cached_model_key(model_ref)
    cached = _MODEL_CACHE.get(cache_key)
    if cached is not None:
        return cached
    try:
        from qwen_tts import Qwen3TTSModel
    except Exception as error:
        fail(f"qwen_tts import failed: {error}")
    try:
        model = Qwen3TTSModel.from_pretrained(
            model_ref,
            device_map=qwen3_tts_device_map(),
            dtype=qwen3_tts_dtype(),
        )
    except Exception as error:
        fail(f"qwen3_tts model load failed: {error}")
    _MODEL_CACHE[cache_key] = model
    return model


def handle_preflight(model_ref: str) -> dict[str, Any]:
    ensure_qwen_tts_importable()
    try:
        version = importlib.metadata.version("qwen-tts")
    except Exception:
        version = ""
    response: dict[str, Any] = {
        "driver_family": "qwen3_tts",
        "driver_backend": qwen_tts_backend_name(),
        "model_ref": model_ref,
        "supports": ["audio.synthesize", "voice.design", "voice.clone"],
    }
    if version:
        response["qwen_tts_version"] = version
    return response


def normalized_speaker(value: str) -> str:
    return str(value or "").strip().lower().replace(" ", "_")


def default_speaker(model: Any) -> str:
    configured = normalized_speaker(str(os.environ.get("NIMI_RUNTIME_SPEECH_QWEN3_TTS_DEFAULT_SPEAKER") or ""))
    if configured:
        return configured
    getter = getattr(model, "get_supported_speakers", None)
    if getter is None:
        return "serena"
    try:
        speakers = getter()
    except Exception:
        return "serena"
    if isinstance(speakers, (list, tuple)):
        for item in speakers:
            speaker = normalized_speaker(str(item or ""))
            if speaker:
                return speaker
    return "serena"


def write_audio_artifact(wav: Any, sample_rate: int) -> tuple[str, str]:
    try:
        import soundfile as sf
    except Exception as error:
        fail(f"soundfile import failed: {error}")
    output_dir = pathlib.Path(tempfile.mkdtemp(prefix="nimi-qwen3-tts-artifact-"))
    output_path = output_dir / "speech.wav"
    sf.write(str(output_path), wav, int(sample_rate))
    return str(output_path), mimetypes.guess_type(str(output_path))[0] or "audio/wav"


def build_design_handle(request: dict[str, Any]) -> dict[str, Any]:
    input_payload = request.get("input")
    if not isinstance(input_payload, dict):
        fail("voice.design requires input object")
    instruction_text = require_string(input_payload, "instruction_text")
    preferred_name = optional_string(input_payload, "preferred_name")
    handle = encode_voice_handle(
        VOICE_DESIGN_PREFIX,
        {
            "instruction_text": instruction_text,
            "preferred_name": preferred_name,
            "language": optional_string(input_payload, "language"),
            "preview_text": optional_string(input_payload, "preview_text"),
            "target_model_id": optional_string(request, "target_model_id"),
            "backend": qwen_tts_backend_name(),
        },
    )
    return {
        "voice_id": handle,
        "metadata": {
            "driver_family": "qwen3_tts",
            "driver_backend": qwen_tts_backend_name(),
            "handle_kind": "design",
            "preferred_name": preferred_name,
        },
    }


def build_clone_handle(request: dict[str, Any]) -> dict[str, Any]:
    input_payload = request.get("input")
    if not isinstance(input_payload, dict):
        fail("voice.clone requires input object")
    reference_audio_base64 = require_string(input_payload, "reference_audio_base64")
    handle = encode_voice_handle(
        VOICE_CLONE_PREFIX,
        {
            "reference_audio_base64": reference_audio_base64,
            "reference_audio_mime": optional_string(input_payload, "reference_audio_mime"),
            "language_hints": input_payload.get("language_hints") if isinstance(input_payload.get("language_hints"), list) else [],
            "preferred_name": optional_string(input_payload, "preferred_name"),
            "text": optional_string(input_payload, "text"),
            "target_model_id": optional_string(request, "target_model_id"),
            "backend": qwen_tts_backend_name(),
        },
    )
    return {
        "voice_id": handle,
        "metadata": {
            "driver_family": "qwen3_tts",
            "driver_backend": qwen_tts_backend_name(),
            "handle_kind": "clone",
            "preferred_name": optional_string(input_payload, "preferred_name"),
        },
    }


def model_mode(model_ref: str) -> str:
    normalized = model_ref.strip().lower()
    if "voicedesign" in normalized:
        return "design"
    if normalized.endswith("-base") or "tts-12hz-0.6b-base" in normalized or "tts-12hz-1.7b-base" in normalized:
        return "clone"
    return "custom"


def synthesize_with_custom_voice(model: Any, request: dict[str, Any]) -> tuple[str, str]:
    text = require_string(request, "input")
    language = normalized_language(optional_string(request, "language"))
    speaker = normalized_speaker(optional_string(request, "voice")) or default_speaker(model)
    instruct = optional_string(request, "emotion")
    if not instruct and isinstance(request.get("extensions"), dict):
        instruct = optional_string(request["extensions"], "instruct")
    try:
        wavs, sample_rate = model.generate_custom_voice(
            text=text,
            language=language,
            speaker=speaker,
            instruct=instruct or None,
            non_streaming_mode=True,
            max_new_tokens=max_new_tokens(),
        )
    except Exception as error:
        fail(f"qwen3_tts custom voice generation failed: {error}")
    if not wavs:
        fail("qwen3_tts custom voice generation returned no audio")
    return write_audio_artifact(wavs[0], sample_rate)


def synthesize_with_design_handle(model: Any, request: dict[str, Any], handle_payload: dict[str, Any]) -> tuple[str, str]:
    text = require_string(request, "input")
    instruction = optional_string(handle_payload, "instruction_text")
    if not instruction:
        fail("voice design handle missing instruction_text")
    language = normalized_language(optional_string(request, "language") or optional_string(handle_payload, "language"))
    try:
        wavs, sample_rate = model.generate_voice_design(
            text=text,
            language=language,
            instruct=instruction,
            non_streaming_mode=True,
            max_new_tokens=max_new_tokens(),
        )
    except Exception as error:
        fail(f"qwen3_tts voice design generation failed: {error}")
    if not wavs:
        fail("qwen3_tts voice design generation returned no audio")
    return write_audio_artifact(wavs[0], sample_rate)


def synthesize_with_clone_handle(model: Any, request: dict[str, Any], handle_payload: dict[str, Any]) -> tuple[str, str]:
    text = require_string(request, "input")
    reference_audio_base64 = optional_string(handle_payload, "reference_audio_base64")
    if not reference_audio_base64:
        fail("voice clone handle missing reference_audio_base64")
    ref_text = optional_string(handle_payload, "text")
    language_hints = handle_payload.get("language_hints")
    language = None
    if isinstance(language_hints, list) and language_hints:
        language = normalized_language(str(language_hints[0] or ""))
    if language is None:
        language = normalized_language(optional_string(request, "language"))
    try:
        audio_bytes = base64.b64decode(reference_audio_base64.encode("ascii"))
    except Exception as error:
        fail(f"voice clone handle audio invalid: {error}")
    if not audio_bytes:
        fail("voice clone handle reference audio is empty")
    with tempfile.TemporaryDirectory(prefix="nimi-qwen3-tts-clone-") as temp_dir:
        audio_path = pathlib.Path(temp_dir) / "reference.wav"
        audio_path.write_bytes(audio_bytes)
        try:
            wavs, sample_rate = model.generate_voice_clone(
                text=text,
                language=language,
                ref_audio=str(audio_path),
                ref_text=ref_text or None,
                x_vector_only_mode=not bool(ref_text),
                max_new_tokens=max_new_tokens(),
            )
        except Exception as error:
            fail(f"qwen3_tts voice clone generation failed: {error}")
    if not wavs:
        fail("qwen3_tts voice clone generation returned no audio")
    return write_audio_artifact(wavs[0], sample_rate)


def handle_synthesize(request: dict[str, Any], cli_default_model: str) -> dict[str, Any]:
    model_ref = resolve_model_ref(request, cli_default_model)
    model = load_qwen_tts_model(model_ref)
    voice = optional_string(request, "voice")
    handle_kind, handle_payload = decode_voice_handle(voice) if voice else ("", None)
    if handle_kind == "design" and handle_payload is not None:
        audio_path, content_type = synthesize_with_design_handle(model, request, handle_payload)
        return {"audio_path": audio_path, "content_type": content_type}
    if handle_kind == "clone" and handle_payload is not None:
        audio_path, content_type = synthesize_with_clone_handle(model, request, handle_payload)
        return {"audio_path": audio_path, "content_type": content_type}

    mode = model_mode(model_ref)
    if mode != "custom":
        fail(f"qwen3_tts plain synthesis requires a voice workflow handle for model_ref={model_ref}")
    audio_path, content_type = synthesize_with_custom_voice(model, request)
    return {"audio_path": audio_path, "content_type": content_type}


def handle_request(request: dict[str, Any], cli_default_model: str) -> dict[str, Any]:
    operation = require_string(request, "operation")
    model_ref = resolve_model_ref(request, cli_default_model)
    if operation == "driver.preflight":
        return handle_preflight(model_ref)
    if operation == "audio.synthesize":
        return handle_synthesize(request, cli_default_model)
    if operation == "voice.design":
        return build_design_handle(request)
    if operation == "voice.clone":
        return build_clone_handle(request)
    fail(f"unsupported qwen3_tts operation: {operation}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    parser.add_argument("--model", default=DEFAULT_TTS_MODEL)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        request = read_json(args.request)
        response = handle_request(request, str(args.model).strip() or DEFAULT_TTS_MODEL)
        write_json(args.response, response)
        return 0
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

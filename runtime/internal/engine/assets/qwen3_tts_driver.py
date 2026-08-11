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
import uuid
from typing import Any


VOICE_DESIGN_PREFIX = "qwen3_tts:design:"
DEFAULT_MAX_NEW_TOKENS = 256
DRIVER_WORK_ROOT_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_WORK_ROOT"
DRIVER_OUTPUT_PATH_ENV = "NIMI_RUNTIME_SPEECH_DRIVER_OUTPUT_PATH"
SYNTHESIS_BATCH_SIZE = 8
SYNTHESIS_CHUNK_CHARACTERS = 160
SYNTHESIS_CJK_CHUNK_CHARACTERS = 64

_MODEL_CACHE: dict[tuple[str, str, str], Any] = {}
_MODEL_PATH_CACHE: dict[str, str] = {}


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
    if value.startswith("qwen3_tts:clone:"):
        fail("qwen3_tts voice clone handles are not admitted without a runtime-owned opaque voice asset lifecycle")
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
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
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
    if qwen3_tts_device_map() == "mps":
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


def synthesis_chunk_limit(text: str, language: str | None) -> int:
    normalized = str(language or "").strip().lower()
    if normalized in {"chinese", "japanese", "korean"}:
        return SYNTHESIS_CJK_CHUNK_CHARACTERS
    if any("\u2e80" <= character <= "\u9fff" or "\u3040" <= character <= "\u30ff" or "\uac00" <= character <= "\ud7af" for character in text):
        return SYNTHESIS_CJK_CHUNK_CHARACTERS
    return SYNTHESIS_CHUNK_CHARACTERS


def split_synthesis_text(text: str, language: str | None) -> list[str]:
    remaining = text.strip()
    if not remaining:
        return []
    limit = synthesis_chunk_limit(remaining, language)
    chunks: list[str] = []
    preferred_breaks = ".!?;:\n。！？；："
    while len(remaining) > limit:
        window = remaining[: limit + 1]
        cut = max(window.rfind(marker) + 1 for marker in preferred_breaks)
        if cut < limit // 2:
            cut = window.rfind(" ") + 1
        if cut < limit // 2:
            cut = limit
        chunk = remaining[:cut].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[cut:].lstrip()
    if remaining:
        chunks.append(remaining)
    return chunks


def load_entry_payload(entry_path: str) -> dict[str, Any]:
    if not entry_path:
        return {}
    try:
        payload = json.loads(pathlib.Path(entry_path).read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def normalized_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if text:
            result.append(text)
    return result


def local_bundle_model_ref(request: dict[str, Any]) -> str:
    bundle_dir = optional_string(request, "bundle_dir")
    if not bundle_dir:
        return ""
    bundle_path = pathlib.Path(bundle_dir)
    if not bundle_path.exists():
        fail(f"managed speech bundle_dir does not exist: {bundle_dir}")
    if not bundle_path.is_dir():
        fail(f"managed speech bundle_dir is not a directory: {bundle_dir}")
    for file_name in normalized_string_list(request.get("declared_files")):
        if not (bundle_path / file_name).exists():
            fail(f"managed speech bundle missing declared file: {file_name}")
    entry_path = optional_string(request, "entry_path")
    if entry_path:
        entry = pathlib.Path(entry_path)
        if not entry.exists():
            fail(f"managed speech entry_path does not exist: {entry_path}")
        try:
            entry.relative_to(bundle_path)
        except ValueError:
            fail("managed speech entry_path is outside bundle_dir")
    return str(bundle_path)


def resolve_model_ref(request: dict[str, Any], cli_default: str) -> str:
    if isinstance(request.get("model_ref"), str) and str(request["model_ref"]).strip():
        return str(request["model_ref"]).strip()
    entry_payload = load_entry_payload(optional_string(request, "entry_path"))
    if isinstance(entry_payload.get("model_ref"), str) and str(entry_payload["model_ref"]).strip():
        return str(entry_payload["model_ref"]).strip()
    bundle_ref = local_bundle_model_ref(request)
    if bundle_ref:
        return bundle_ref
    default_ref = str(cli_default or "").strip()
    if default_ref:
        return default_ref
    fail("qwen3_tts model_ref is required from request, entry payload, managed bundle, or explicit --model")


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


def resolve_hf_cache_dir() -> str | None:
    for name in ("HUGGINGFACE_HUB_CACHE", "HF_HOME"):
        value = str(os.environ.get(name) or "").strip()
        if value:
            return value
    return None


def materialize_model_ref(model_ref: str) -> str:
    cached = _MODEL_PATH_CACHE.get(model_ref)
    if cached:
        return cached
    if os.path.isdir(model_ref):
        _MODEL_PATH_CACHE[model_ref] = model_ref
        return model_ref
    fail("qwen3_tts model_ref must resolve to a runtime-materialized local directory")


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
    resolved_model_ref = materialize_model_ref(model_ref)
    try:
        model = Qwen3TTSModel.from_pretrained(
            resolved_model_ref,
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
        "supports": ["audio.synthesize", "voice_workflow.voice_design"],
    }
    if version:
        response["qwen_tts_version"] = version
    return response


def normalized_speaker(value: str) -> str:
    return str(value or "").strip().lower().replace(" ", "_")


def first_supported_speaker(model: Any) -> str:
    speakers = getattr(model, "get_supported_speakers", None)
    if not callable(speakers):
        return ""
    try:
        values = speakers()
    except Exception:
        return ""
    if not isinstance(values, list):
        return ""
    for item in values:
        speaker = normalized_speaker(str(item or ""))
        if speaker and speaker not in {"user-custom", "default"}:
            return speaker
    return ""


def first_run_baseline_probe_enabled(request: dict[str, Any]) -> bool:
    extensions = request.get("extensions")
    return isinstance(extensions, dict) and bool(extensions.get("nimi_first_run_baseline_probe"))


def write_audio_artifact(wav: Any, sample_rate: int) -> tuple[str, str]:
    raw_work_root = str(os.environ.get(DRIVER_WORK_ROOT_ENV) or "").strip()
    work_root = pathlib.Path(raw_work_root)
    if not raw_work_root or not work_root.is_absolute() or work_root.is_symlink() or not work_root.is_dir():
        fail("Runtime-owned speech driver work root is unavailable")
    try:
        import soundfile as sf
    except Exception as error:
        fail(f"soundfile import failed: {error}")
    requested_output = str(os.environ.get(DRIVER_OUTPUT_PATH_ENV) or "").strip()
    output_path = pathlib.Path(requested_output) if requested_output else work_root / f"audio-{uuid.uuid4().hex}.wav"
    try:
        output_path.resolve().relative_to(work_root.resolve())
    except ValueError as error:
        fail(f"Runtime-owned speech output path escaped work root: {error}")
    if not output_path.is_absolute() or output_path.is_symlink() or output_path.exists():
        fail("Runtime-owned speech output path is invalid")
    sf.write(str(output_path), wav, int(sample_rate))
    return str(output_path), mimetypes.guess_type(str(output_path))[0] or "audio/wav"


def append_audio_artifact(path_value: str, wav: Any, sample_rate: int) -> None:
    try:
        import soundfile as sf
    except Exception as error:
        fail(f"soundfile import failed: {error}")
    with sf.SoundFile(path_value, mode="r+") as output:
        if output.samplerate != int(sample_rate):
            fail("qwen3_tts custom voice generation changed sample rate between batches")
        output.seek(0, 2)
        output.write(wav)


# qwen-tts 0.1.1 decodes and returns only audio from its public generation
# wrappers. Both admitted CustomVoice and VoiceDesign paths call this inner
# talker exactly once, so observe that otherwise-discarded completion state.
def generate_observed_talker_batch(
    model: Any,
    texts: list[str],
    token_limit: int,
    generation_label: str,
    generate_batch: Any,
) -> tuple[list[Any], int]:
    backend = getattr(model, "model", None)
    talker = getattr(backend, "talker", None)
    original_generate = getattr(talker, "generate", None)
    if not callable(original_generate):
        fail(f"qwen3_tts {generation_label} talker generation is unavailable")
    try:
        talker_instance_variables = vars(talker)
    except TypeError as error:
        fail(f"qwen3_tts {generation_label} talker state is unavailable: {error}")
    had_instance_generate = "generate" in talker_instance_variables
    previous_instance_generate = talker_instance_variables.get("generate")
    configured_eos_token = getattr(
        getattr(getattr(backend, "config", None), "talker_config", None),
        "codec_eos_token_id",
        None,
    )
    observed_runs: list[tuple[list[list[int]], int, int]] = []

    def observe_talker_generation(*args: Any, **kwargs: Any) -> Any:
        result = original_generate(*args, **kwargs)
        sequences = getattr(result, "sequences", None)
        try:
            rows = sequences.detach().cpu().tolist()
            observed_limit = int(kwargs["max_new_tokens"])
            observed_eos_token = int(kwargs.get("eos_token_id", configured_eos_token))
        except Exception as error:
            fail(f"qwen3_tts {generation_label} talker completion state is invalid: {error}")
        if not isinstance(rows, list) or any(not isinstance(row, list) for row in rows):
            fail(f"qwen3_tts {generation_label} talker completion state is invalid")
        observed_runs.append((rows, observed_limit, observed_eos_token))
        return result

    setattr(talker, "generate", observe_talker_generation)
    try:
        wavs, sample_rate = generate_batch()
    finally:
        if had_instance_generate:
            setattr(talker, "generate", previous_instance_generate)
        else:
            delattr(talker, "generate")
    if len(observed_runs) != 1:
        fail(f"qwen3_tts {generation_label} generation did not expose one talker completion state")
    token_rows, observed_limit, eos_token = observed_runs[0]
    if observed_limit != token_limit:
        fail(f"qwen3_tts {generation_label} generation changed its token ceiling")
    if len(token_rows) != len(texts):
        fail(f"qwen3_tts {generation_label} generation returned incomplete token batch")
    if len(wavs) != len(texts):
        fail(f"qwen3_tts {generation_label} generation returned incomplete audio batch")
    if any(len(row) > token_limit for row in token_rows):
        fail(f"qwen3_tts {generation_label} talker completion state exceeds its token ceiling")
    if any(eos_token not in row and len(row) >= token_limit for row in token_rows):
        fail(f"qwen3_tts {generation_label} generation reached generation ceiling ({token_limit} codec tokens)")
    if any(eos_token not in row for row in token_rows):
        fail(f"qwen3_tts {generation_label} generation ended without a completion token")
    return wavs, int(sample_rate)


def generate_custom_voice_batch(
    model: Any,
    texts: list[str],
    language: str | None,
    speaker: str,
    instruction: str,
    token_limit: int,
) -> tuple[list[Any], int]:
    return generate_observed_talker_batch(
        model,
        texts,
        token_limit,
        "custom voice",
        lambda: model.generate_custom_voice(
            text=texts,
            language=language,
            speaker=speaker,
            instruct=instruction or None,
            non_streaming_mode=True,
            max_new_tokens=token_limit,
        ),
    )


def generate_voice_design_batch(
    model: Any,
    texts: list[str],
    language: str | None,
    instruction: str,
    token_limit: int,
) -> tuple[list[Any], int]:
    return generate_observed_talker_batch(
        model,
        texts,
        token_limit,
        "voice design",
        lambda: model.generate_voice_design(
            text=texts,
            language=language,
            instruct=instruction,
            non_streaming_mode=True,
            max_new_tokens=token_limit,
        ),
    )


def build_design_handle(request: dict[str, Any]) -> dict[str, Any]:
    input_payload = request.get("input")
    if not isinstance(input_payload, dict):
        fail("voice_workflow.voice_design requires input object")
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
        fail("voice_workflow.voice_clone requires input object")
    fail("qwen3_tts voice clone requires a runtime-owned opaque voice asset lifecycle before local handles are admitted")


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
    speaker = normalized_speaker(optional_string(request, "voice"))
    if speaker in {"", "user-custom", "default"}:
        if first_run_baseline_probe_enabled(request):
            speaker = first_supported_speaker(model)
        if speaker in {"", "user-custom", "default"}:
            fail("qwen3_tts synthesis requires an explicit admitted voice_ref or voice workflow handle")
    instruct = optional_string(request, "emotion")
    if not instruct and isinstance(request.get("extensions"), dict):
        instruct = optional_string(request["extensions"], "instruct")
    chunks = split_synthesis_text(text, language)
    sample_rate = 0
    audio_path = ""
    content_type = "audio/wav"
    token_limit = max_new_tokens()
    try:
        for start in range(0, len(chunks), SYNTHESIS_BATCH_SIZE):
            batch = chunks[start : start + SYNTHESIS_BATCH_SIZE]
            wavs, batch_sample_rate = generate_custom_voice_batch(
                model,
                batch,
                language,
                speaker,
                instruct,
                token_limit,
            )
            if sample_rate and sample_rate != int(batch_sample_rate):
                fail("qwen3_tts custom voice generation changed sample rate between batches")
            sample_rate = int(batch_sample_rate)
            for wav in wavs:
                if not audio_path:
                    audio_path, content_type = write_audio_artifact(wav, sample_rate)
                else:
                    append_audio_artifact(audio_path, wav, sample_rate)
    except Exception as error:
        if audio_path:
            pathlib.Path(audio_path).unlink(missing_ok=True)
        fail(f"qwen3_tts custom voice generation failed: {error}")
    if not audio_path:
        fail("qwen3_tts generation returned no audio segments")
    return audio_path, content_type


def synthesize_with_design_handle(model: Any, request: dict[str, Any], handle_payload: dict[str, Any]) -> tuple[str, str]:
    text = require_string(request, "input")
    instruction = optional_string(handle_payload, "instruction_text")
    if not instruction:
        fail("voice design handle missing instruction_text")
    language = normalized_language(optional_string(request, "language") or optional_string(handle_payload, "language"))
    chunks = split_synthesis_text(text, language)
    sample_rate = 0
    audio_path = ""
    content_type = "audio/wav"
    token_limit = max_new_tokens()
    try:
        for start in range(0, len(chunks), SYNTHESIS_BATCH_SIZE):
            batch = chunks[start : start + SYNTHESIS_BATCH_SIZE]
            wavs, batch_sample_rate = generate_voice_design_batch(
                model,
                batch,
                language,
                instruction,
                token_limit,
            )
            if sample_rate and sample_rate != batch_sample_rate:
                fail("qwen3_tts voice design generation changed sample rate between batches")
            sample_rate = batch_sample_rate
            for wav in wavs:
                if not audio_path:
                    audio_path, content_type = write_audio_artifact(wav, sample_rate)
                else:
                    append_audio_artifact(audio_path, wav, sample_rate)
    except Exception as error:
        if audio_path:
            pathlib.Path(audio_path).unlink(missing_ok=True)
        fail(f"qwen3_tts voice design generation failed: {error}")
    if not audio_path:
        fail("qwen3_tts voice design generation returned no audio")
    return audio_path, content_type


def handle_synthesize(request: dict[str, Any], cli_default_model: str) -> dict[str, Any]:
    model_ref = resolve_model_ref(request, cli_default_model)
    voice = optional_string(request, "voice")
    handle_kind, handle_payload = decode_voice_handle(voice) if voice else ("", None)
    mode = model_mode(model_ref)
    if handle_kind != "design":
        if mode != "custom":
            fail(f"qwen3_tts plain synthesis requires a voice workflow handle for model_ref={model_ref}")
        if normalized_speaker(voice) in {"", "user-custom", "default"} and not first_run_baseline_probe_enabled(request):
            fail("qwen3_tts synthesis requires an explicit admitted voice_ref or voice workflow handle")
    model = load_qwen_tts_model(model_ref)
    if handle_kind == "design" and handle_payload is not None:
        audio_path, content_type = synthesize_with_design_handle(model, request, handle_payload)
        return {"audio_path": audio_path, "content_type": content_type}
    audio_path, content_type = synthesize_with_custom_voice(model, request)
    return {"audio_path": audio_path, "content_type": content_type}


def handle_request(request: dict[str, Any], cli_default_model: str) -> dict[str, Any]:
    operation = require_string(request, "operation")
    model_ref = resolve_model_ref(request, cli_default_model)
    if operation == "driver.preflight":
        return handle_preflight(model_ref)
    if operation == "audio.synthesize":
        return handle_synthesize(request, cli_default_model)
    if operation == "voice_workflow.voice_design":
        return build_design_handle(request)
    if operation == "voice_workflow.voice_clone":
        return build_clone_handle(request)
    fail(f"unsupported qwen3_tts operation: {operation}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    parser.add_argument("--model", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        request = read_json(args.request)
        response = handle_request(request, str(args.model).strip())
        write_json(args.response, response)
        return 0
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.metadata
import json
import math
import unicodedata
import os
import pathlib
import sys
from typing import Any

from speech_audio import normalized_audio_source


DEFAULT_MAX_NEW_TOKENS = 256
_MODEL_CACHE: dict[tuple[str, str, str], tuple[Any, Any]] = {}
_ALIGNER_CACHE: dict[tuple[str, str, str], tuple[Any, Any]] = {}
_ALIGNMENT_LANGUAGES = {"zh", "en", "yue", "fr", "de", "it", "ja", "ko", "pt", "ru", "es"}
_LANGUAGE_CODES = dict(zip(
    ["chinese", "english", "cantonese", "arabic", "german", "french", "spanish", "portuguese", "indonesian", "italian", "korean", "russian", "thai", "vietnamese", "japanese", "turkish", "hindi", "malay", "dutch", "swedish", "danish", "finnish", "polish", "czech", "filipino", "persian", "greek", "hungarian", "macedonian", "romanian"],
    ["zh", "en", "yue", "ar", "de", "fr", "es", "pt", "id", "it", "ko", "ru", "th", "vi", "ja", "tr", "hi", "ms", "nl", "sv", "da", "fi", "pl", "cs", "fil", "fa", "el", "hu", "mk", "ro"],
))


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


# @nimi-authority: rule.nimi.runtime.ai-provider.qwen3-transformers-aligned-transcription
def resolve_alignment_language(reported: str, requested: str | None) -> tuple[str, str]:
    def code(value: str) -> str:
        name = value.strip().lower()
        return _LANGUAGE_CODES.get(name, name if name in _LANGUAGE_CODES.values() else "")

    reported = reported.strip()
    if reported:
        detected = code(reported)
        if detected not in _ALIGNMENT_LANGUAGES:
            fail(f"recognized language is not supported by the captured forced aligner: {reported[:64]!r}")
        return detected, detected
    selected = code(requested or "")
    if selected not in _ALIGNMENT_LANGUAGES:
        fail("recognition did not report a language; an explicit supported source language is required for alignment")
    # The request can guide real alignment, but cannot become a detected result.
    return "", selected


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
        model, loading = AutoModelForMultimodalLM.from_pretrained(
            model_ref,
            device_map=transformers_device_map(),
            dtype=transformers_dtype(),
            local_files_only=True,
            output_loading_info=True,
        )
        if loading.get("missing_keys") or loading.get("mismatched_keys"):
            fail("captured ASR weights do not completely match the execution model")
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


def load_aligner(model_ref: str) -> tuple[Any, Any]:
    key = cache_key(model_ref)
    if key not in _ALIGNER_CACHE:
        from transformers import AutoProcessor, AutoModelForTokenClassification
        processor = AutoProcessor.from_pretrained(model_ref, local_files_only=True)
        config = read_json(str(pathlib.Path(model_ref) / "config.json"))
        if config.get("architectures") != ["Qwen3ASRForTokenClassification"]:
            fail("captured alignment model has the wrong architecture")
        model, loading = AutoModelForTokenClassification.from_pretrained(model_ref, device_map=transformers_device_map(), dtype=transformers_dtype(), local_files_only=True, output_loading_info=True)
        if loading.get("missing_keys") or loading.get("mismatched_keys"):
            fail("captured alignment weights do not completely match the execution model")
        model.eval()
        _ALIGNER_CACHE[key] = (processor, model)
    return _ALIGNER_CACHE[key]


# @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
def alignment_words_from_predictions(text: str, words: list[str], predictions: list[int], segment_ms: float, duration: float) -> list[dict[str, Any]]:
    precision = float(segment_ms) / 1000
    if not math.isfinite(precision) or precision <= 0 or len(predictions) != 2 * len(words):
        fail("forced alignment returned invalid timestamp predictions")
    # Decode the actual timestamp classes. The upstream processor replaces
    # contradictory predictions by snapping/interpolation before returning rows.
    rows = [{"text": word,
             "start_time": round(float(predictions[index * 2]) * precision, 3),
             "end_time": round(float(predictions[index * 2 + 1]) * precision, 3)}
            for index, word in enumerate(words)]
    return restore_alignment_words(text, rows, duration, precision)


def restore_alignment_words(text: str, rows: list[dict[str, Any]], duration: float, precision: float) -> list[dict[str, Any]]:
    # The pinned aligner drops punctuation during tokenization. Retain the
    # recognized text around those exact units without estimating new times.
    kept = [(i, char) for i, char in enumerate(text) if char == "'" or unicodedata.category(char).startswith(("L", "N"))]
    if not rows or "".join(str(row.get("text") or "") for row in rows) != "".join(char for _, char in kept):
        fail("forced alignment units do not cover the recognized text")
    result = []
    cursor = 0
    previous_char = 0
    previous_start = 0.0
    for row in rows:
        start, end = float(row["start_time"]), float(row["end_time"])
        if not math.isfinite(start) or not math.isfinite(end) or start < previous_start or end < start or end > duration + precision:
            fail("forced alignment returned invalid source timing")
        cursor += len(row["text"])
        next_char = kept[cursor][0] if cursor < len(kept) else len(text)
        result.append({"text": text[previous_char:next_char].strip(), "start_seconds": start, "end_seconds": end})
        previous_char, previous_start = next_char, start
    return result


# @nimi-authority: rule.nimi.runtime.ai-provider.qwen3-transformers-aligned-transcription
def handle_transcribe(request: dict[str, Any]) -> dict[str, Any]:
    alignment = request.get("alignment")
    timed = bool_request(request, "timestamps")
    if timed and not isinstance(alignment, dict):
        fail("Transformers-native Qwen3-ASR timestamps require a captured aligner")
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
        with normalized_audio_source(audio_path) as normalized_audio_path:
            duration = 0.0
            if alignment is not None:
                import soundfile as sf
                duration = sf.info(normalized_audio_path).duration
                if not math.isfinite(duration) or duration <= 0:
                    fail("audio input has no valid duration")
                if duration > 300:
                    fail("aligned transcription accepts audio up to 300 seconds; split the source and retain its offset")
            inputs = processor.apply_transcription_request(audio=normalized_audio_path, language=language)
            inputs = inputs.to(model.device, model.dtype)
            budget = max(max_new_tokens(), 8192) if alignment is not None else max_new_tokens()
            output_ids = model.generate(**inputs, max_new_tokens=budget)
            generated_ids = output_ids[:, inputs["input_ids"].shape[1]:]
            if alignment is None:
                decoded = processor.decode(generated_ids, return_format="transcription_only")
                text = str(decoded[0] if isinstance(decoded, (list, tuple)) and decoded else decoded or "").strip()
                if not text:
                    if allow_empty_transcript(request): return {"text": "", "empty_transcript": True}
                    fail("Transformers-native Qwen3-ASR returned no transcription")
                return {"text": text}
            if generated_ids.shape[-1] >= budget:
                fail("aligned transcription reached the recognition token limit")
            decoded = processor.decode(generated_ids, return_format="parsed")[0]
            text = str(decoded.get("transcription") or "").strip()
            language_name = str(decoded.get("language") or "").strip().lower()
            if not text:
                raw = str(processor.decode(generated_ids)[0]).strip().lower()
                if "language none<asr_text>" in raw: return {"text": "", "no_speech": True}
                fail("recognition returned empty text without a no-speech result")
            language_code, alignment_language = resolve_alignment_language(language_name, language)
            response = {"text": text, "language": language_code}
            if timed:
                import torch
                aligner_processor, aligner_model = load_aligner(local_bundle_model_ref(alignment))
                # The pinned processor normalizes language codes before
                # selecting the managed nagisa/soynlp tokenizers for ja/ko.
                aligner_inputs, word_lists = aligner_processor.prepare_forced_aligner_inputs(audio=normalized_audio_path, transcript=text, language=alignment_language)
                aligner_inputs = aligner_inputs.to(aligner_model.device, aligner_model.dtype)
                with torch.inference_mode():
                    outputs = aligner_model(**aligner_inputs)
                timestamp_mask = aligner_inputs["input_ids"][0] == aligner_model.config.timestamp_token_id
                predictions = outputs.logits.argmax(dim=-1)[0][timestamp_mask].cpu().tolist()
                response["words"] = alignment_words_from_predictions(text, word_lists[0], predictions, aligner_processor.timestamp_segment_time, duration)
            return response
    except Exception as error:
        fail(f"Transformers-native Qwen3-ASR transcription failed: {error}")


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

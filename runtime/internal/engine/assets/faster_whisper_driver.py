from __future__ import annotations

import argparse
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import sys
from typing import Any


def captured_bundle(value: dict[str, Any]) -> tuple[str, str]:
    root = Path(str(value.get("bundle_dir") or ""))
    entry = Path(str(value.get("entry_path") or ""))
    files = value.get("declared_files")
    if not root.is_absolute() or not root.is_dir() or root.is_symlink() or not isinstance(files, list) or not files:
        raise RuntimeError("captured local model bundle is required")
    for name in files:
        if not isinstance(name, str) or not name:
            raise RuntimeError("captured model file declaration is invalid")
        file = root / name
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
            raise RuntimeError("captured model file is unavailable")
    if not entry.is_absolute() or not entry.is_file() or entry.is_symlink() or not entry.resolve().is_relative_to(root.resolve()):
        raise RuntimeError("captured model entry is unavailable")
    if entry.relative_to(root).as_posix() not in files:
        raise RuntimeError("captured model entry is not declared")
    return str(root), str(entry)


@lru_cache(maxsize=1)
def load_models(recognition_root: str, vad_entry: str):
    import torch
    from faster_whisper import WhisperModel
    from silero_vad.utils_vad import OnnxWrapper

    # CTranslate2 uses the CUDA libraries supplied by this managed profile.
    dll_directory = None
    if sys.platform == "win32":
        dll_directory = os.add_dll_directory(str(Path(torch.__file__).parent / "lib"))
    device = os.environ.get("NIMI_RUNTIME_SPEECH_FASTER_WHISPER_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
    if device not in {"cpu", "cuda"} or (device == "cuda" and not torch.cuda.is_available()):
        raise RuntimeError("captured Whisper accelerator is unavailable")
    model = WhisperModel(recognition_root, device=device,
                         compute_type="float16" if device == "cuda" else "int8",
                         local_files_only=True)
    vad = OnnxWrapper(vad_entry, force_onnx_cpu=True)
    return model, vad, dll_directory


def transcription_words(segments, duration: float) -> tuple[str, list[dict[str, Any]]]:
    texts, words = [], []
    previous = 0.0
    for segment in segments:
        texts.append(segment.text)
        if segment.text.strip() and not segment.words:
            raise RuntimeError("recognition returned text without word alignment")
        for word in segment.words or []:
            start, end = float(word.start), float(word.end)
            if not word.word.strip() or not math.isfinite(start) or not math.isfinite(end) or start < previous or end < start or end > duration:
                raise RuntimeError("recognition returned invalid source word alignment")
            words.append({"text": word.word.strip(), "start_seconds": start, "end_seconds": end})
            previous = start
    text = "".join(texts).strip()
    if not text or not words:
        raise RuntimeError("recognition returned empty text after detected speech")
    return text, words


# @nimi-authority: rule.nimi.runtime.ai-provider.faster-whisper-transcription
def handle_request(request: dict[str, Any]) -> dict[str, Any]:
    recognition_root, recognition_entry = captured_bundle(request)
    if Path(recognition_entry).name != "model.bin":
        raise RuntimeError("Whisper requires its captured CTranslate2 model.bin")
    for name in ("config.json", "tokenizer.json", "preprocessor_config.json"):
        if name not in request["declared_files"]:
            raise RuntimeError("Whisper model bundle is incomplete")
    operation = request.get("operation")
    if operation == "driver.preflight":
        import faster_whisper  # noqa: F401
        from silero_vad.utils_vad import OnnxWrapper  # noqa: F401
        return {"driver_family": "faster_whisper", "driver_backend": "ctranslate2",
                "model_ref": recognition_root, "supports": ["audio.transcribe"]}
    if operation != "audio.transcribe":
        raise RuntimeError("unsupported Faster Whisper operation")
    if request.get("diarization") or request.get("speaker_count") or request.get("prompt"):
        raise RuntimeError("Whisper diarization and prompts are not admitted")
    vad_input = request.get("vad")
    if not isinstance(vad_input, dict):
        raise RuntimeError("Whisper requires its captured VAD model")
    _, vad_entry = captured_bundle(vad_input)
    source = Path(str(request.get("audio_path") or ""))
    if not source.is_file():
        raise RuntimeError("audio input is unavailable")

    import numpy as np
    import torch
    from faster_whisper.audio import decode_audio
    from faster_whisper.tokenizer import _LANGUAGE_CODES
    from silero_vad import get_speech_timestamps

    language = str(request.get("language") or "").strip().lower()
    if language and language not in _LANGUAGE_CODES:
        raise RuntimeError("unsupported Whisper language code")
    audio = decode_audio(str(source), sampling_rate=16000)
    duration = len(audio) / 16000
    if not 0 < duration <= 300 or not np.isfinite(audio).all():
        raise RuntimeError("Whisper accepts finite audio up to 300 seconds")
    model, vad, _ = load_models(recognition_root, vad_entry)
    speech = get_speech_timestamps(torch.from_numpy(audio), vad, sampling_rate=16000,
                                   threshold=0.5, min_silence_duration_ms=2000, speech_pad_ms=400)
    for span in speech:
        if not 0 <= span["start"] < span["end"] <= len(audio):
            raise RuntimeError("VAD returned invalid source boundaries")
    # VAD can miss quiet dialogue or synthetic voices. Its negative intervals
    # must never remove audio from recognition or manufacture missing words.
    segments, info = model.transcribe(audio, language=language or None, beam_size=5,
                                      temperature=0.0, condition_on_previous_text=False,
                                      vad_filter=False, word_timestamps=True,
                                      hallucination_silence_threshold=2.0)
    segments = list(segments)
    if not segments and not speech:
        return {"text": "", "no_speech": True}
    text, words = transcription_words(segments, duration)
    result = {"text": text, "language": "" if language else info.language}
    if request.get("timestamps"):
        result["words"] = words
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    args = parser.parse_args()
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf-8"))
        if not isinstance(request, dict):
            raise RuntimeError("request payload must be an object")
        response = handle_request(request)
        Path(args.response).write_text(json.dumps(response, ensure_ascii=True), encoding="utf-8")
        return 0
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import struct
import sys
import sysconfig

import librosa
import numpy as np
import onnxruntime as ort
import soundfile as sf

from basic_pitch_decoder import model_frames_to_time, output_to_notes_polyphonic

# @nimi-authority: rule.nimi.runtime.ai-provider.basic-pitch-onnx-note-events
PROTOCOL = "nimi-basic-pitch-onnx/1"
SAMPLE_RATE = 22050
WINDOW_SAMPLES = 43844
FFT_HOP = 256
OVERLAP_FRAMES = 30
MAX_EVENTS = 100000
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
INPUT_NAME = "serving_default_input_2:0"
OUTPUT_NAMES = ["StatefulPartitionedCall:1", "StatefulPartitionedCall:2", "StatefulPartitionedCall:0"]


def probe_environment() -> None:
    if ort.__version__ != "1.20.1" or "CPUExecutionProvider" not in ort.get_available_providers():
        raise ValueError("the admitted ONNX CPU runtime is unavailable")
    allocation = float(np.sum(np.ones(1, dtype=np.float32)))
    print(json.dumps({
        "python_version": platform.python_version(),
        "python_cache_tag": sys.implementation.cache_tag,
        "python_soabi": sysconfig.get_config_var("SOABI") or "",
        "python_platform": sys.platform,
        "python_machine": platform.machine(),
        "python_pointer_bits": struct.calcsize("P") * 8,
        "onnxruntime_version": ort.__version__,
        "torch_version": "", "cuda_abi": "", "device": "cpu",
        "allocation": allocation,
        "installed_distributions": sorted({d.metadata["Name"] for d in importlib.metadata.distributions()}),
    }))


def validate_session(session: ort.InferenceSession) -> None:
    inputs = session.get_inputs()
    if len(inputs) != 1 or inputs[0].name != INPUT_NAME or inputs[0].type != "tensor(float)" or inputs[0].shape[1:] != [43844, 1]:
        raise ValueError("Basic Pitch input signature is invalid")
    expected = {OUTPUT_NAMES[0]: [172, 88], OUTPUT_NAMES[1]: [172, 88], OUTPUT_NAMES[2]: [172, 264]}
    outputs = session.get_outputs()
    if len(outputs) != 3 or set(o.name for o in outputs) != set(expected):
        raise ValueError("Basic Pitch output names are invalid")
    if any(o.type != "tensor(float)" or o.shape[1:] != expected[o.name] for o in outputs):
        raise ValueError("Basic Pitch output tensor signature is invalid")
    if session.get_providers() != ["CPUExecutionProvider"]:
        raise ValueError("Basic Pitch selected a non-CPU provider")


def infer_notes(model_path: Path, audio_path: Path) -> list[dict]:
    facts = sf.info(str(audio_path))
    if facts.format != "WAV" or facts.subtype != "FLOAT" or facts.channels not in (1, 2) or not 8000 <= facts.samplerate <= 96000 or not 0 < facts.frames <= facts.samplerate * 600:
        raise ValueError("Basic Pitch requires captured canonical float32 WAV")
    # Adapted from upstream inference.py v0.4.0: same mono resampling, zero
    # prefix, 30-frame overlap, tail padding and original-length output trim.
    audio, _ = librosa.load(str(audio_path), sr=SAMPLE_RATE, mono=True)
    if audio.dtype != np.float32 or audio.ndim != 1 or not np.isfinite(audio).all():
        raise ValueError("Basic Pitch decoded audio is not finite float32")
    original_length = len(audio)
    overlap = OVERLAP_FRAMES * FFT_HOP
    audio = np.concatenate([np.zeros(overlap // 2, dtype=np.float32), audio])
    options = ort.SessionOptions()
    # Bound the private CPU worker without interpreting thread count as model
    # quality, capacity or a user-supplied inference control.
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
    validate_session(session)
    pieces = {"note": [], "onset": [], "contour": []}
    for start in range(0, len(audio), WINDOW_SAMPLES - overlap):
        window = audio[start:start + WINDOW_SAMPLES]
        window = np.pad(window, (0, WINDOW_SAMPLES - len(window)))
        outputs = session.run(OUTPUT_NAMES, {INPUT_NAME: window[None, :, None]})
        for (name, rows), tensor in zip(pieces.items(), outputs):
            width = 264 if name == "contour" else 88
            if tensor.dtype != np.float32 or tensor.shape != (1, 172, width) or not np.isfinite(tensor).all() or np.any(tensor < 0) or np.any(tensor > 1):
                raise ValueError("Basic Pitch returned invalid native tensors")
            rows.append(tensor)
    n_frames = int(np.floor(original_length * (86 / SAMPLE_RATE)))
    output = {name: np.concatenate(rows)[:, 15:-15, :].reshape(-1, 264 if name == "contour" else 88)[:n_frames] for name, rows in pieces.items()}
    if n_frames < 2:
        return []
    # The upstream predict defaults are fixed here; no App tokenizer/model or
    # tuning options replace the captured capability request.
    native = output_to_notes_polyphonic(
        output["note"], output["onset"], onset_thresh=0.5, frame_thresh=0.3,
        min_note_len=int(np.round(127.7 / 1000 * SAMPLE_RATE / FFT_HOP)),
        infer_onsets=True, min_freq=None, max_freq=None, melodia_trick=True,
    )
    times = model_frames_to_time(output["contour"].shape[0])
    if len(native) > MAX_EVENTS:
        raise ValueError("Basic Pitch native note count exceeds its bound")
    notes = [{"start": float(times[start]), "end": float(times[end]), "pitch": int(pitch)} for start, end, pitch, _ in native]
    notes.sort(key=lambda n: (n["start"], n["end"], n["pitch"]))
    return notes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    model, audio, output = map(Path, (args.model, args.audio, args.output))
    if not model.is_absolute() or not audio.is_absolute() or not output.is_absolute() or output.parent != audio.parent:
        raise ValueError("Basic Pitch invocation paths are invalid")
    payload = json.dumps({"version": 1, "notes": infer_notes(model, audio)}, allow_nan=False, separators=(",", ":")).encode()
    if len(payload) > MAX_OUTPUT_BYTES:
        raise ValueError("Basic Pitch native note output exceeds its bound")
    # No partial result replaces an earlier output. Runtime owns promotion of
    # the complete requested MIDI/timeline set after this process finishes.
    with output.open("xb") as stream:
        stream.write(payload)


if __name__ == "__main__":
    main()

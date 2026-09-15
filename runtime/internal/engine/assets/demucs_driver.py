#!/usr/bin/env python3
from __future__ import annotations

import argparse
from fractions import Fraction
import json
import os
import pathlib
import subprocess
import sys
import tempfile


MAX_SECONDS = 300


def required_path(request: dict, key: str, *, directory: bool = False) -> pathlib.Path:
    value = request.get(key)
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(f"missing {key}")
    path = pathlib.Path(value)
    if not path.is_absolute() or path.is_symlink() or (not path.is_dir() if directory else not path.is_file()):
        raise ValueError(f"{key} is unavailable")
    return path


def load_captured_model(entry: pathlib.Path, device: str):
    import numpy as np
    import torch
    from demucs.htdemucs import HTDemucs

    # The admitted upstream checkpoint contains the HTDemucs class reference
    # and numeric NumPy/Fraction metadata. Never execute a checkpoint-chosen
    # class or enable unrestricted pickle loading.
    with torch.serialization.safe_globals([
        HTDemucs, Fraction, np.dtype, np.dtypes.Float64DType,
        (np._core.multiarray.scalar, "numpy.core.multiarray.scalar"),
    ]):
        checkpoint = torch.load(entry, map_location="cpu", weights_only=True)
    if not isinstance(checkpoint, dict) or checkpoint.get("klass") is not HTDemucs:
        raise ValueError("captured model is not the admitted HTDemucs architecture")
    args, kwargs, state = checkpoint.get("args"), checkpoint.get("kwargs"), checkpoint.get("state")
    if not isinstance(args, (list, tuple)) or not isinstance(kwargs, dict) or not isinstance(state, dict):
        raise ValueError("captured Demucs model has invalid construction data")
    model = HTDemucs(*args, **kwargs)
    model.load_state_dict(state, strict=True)
    if model.sources.count("vocals") != 1 or len(model.sources) < 2 or model.samplerate != 44100 or model.audio_channels != 2:
        raise ValueError("captured Demucs model has unsupported output semantics")
    return model.to(device).eval()


def decode_audio(source: pathlib.Path, output: pathlib.Path) -> None:
    import imageio_ffmpeg

    ffmpeg = pathlib.Path(imageio_ffmpeg.get_ffmpeg_exe())
    if not ffmpeg.is_file() or ffmpeg.is_symlink():
        raise ValueError("managed audio decoder is unavailable")
    # Decode one additional fraction of a second so an overlong source fails
    # its duration check instead of being silently clipped into a valid input.
    result = subprocess.run([
        str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-i", str(source), "-t", str(MAX_SECONDS + 0.1), "-vn", "-ac", "2",
        "-ar", "44100", "-acodec", "pcm_f32le", str(output),
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120, check=False)
    if result.returncode:
        raise ValueError("audio decoding failed: " + result.stderr.decode("utf-8", errors="replace")[-4096:])


# @nimi-authority: rule.nimi.runtime.ai-provider.demucs-local-separation
def separate(request: dict) -> dict:
    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model

    source = required_path(request, "audio_path")
    entry = required_path(request, "entry_path")
    output_dir = required_path(request, "output_dir", directory=True)
    device = str(os.environ.get("NIMI_RUNTIME_SPEECH_DEMUCS_DEVICE") or "cpu")
    if device not in {"cpu", "cuda:0"}:
        raise ValueError("Demucs execution device is not admitted")
    with tempfile.TemporaryDirectory(prefix="demucs-input-", dir=output_dir) as temporary:
        decoded = pathlib.Path(temporary) / "input.wav"
        decode_audio(source, decoded)
        info = sf.info(decoded)
        if info.samplerate != 44100 or info.channels != 2 or info.frames <= 0:
            raise ValueError("decoded separation audio is invalid")
        if info.frames > MAX_SECONDS * info.samplerate:
            raise ValueError("audio separation accepts at most 300 seconds; split the source and retain its offset")
        samples, sample_rate = sf.read(decoded, dtype="float32", always_2d=True)
    if not np.isfinite(samples).all():
        raise ValueError("audio separation source contains non-finite samples")

    model = load_captured_model(entry, device)
    mixture = torch.from_numpy(samples.T.copy())
    reference = mixture.mean(0)
    mean = reference.mean()
    scale = reference.std(unbiased=False).clamp_min(1e-8)
    normalized = (mixture - mean) / scale
    with torch.inference_mode():
        stems = apply_model(model, normalized[None], device=device, shifts=1, split=True,
                            overlap=0.25, progress=False, num_workers=0)[0].cpu()
    stems = stems * scale + mean
    if tuple(stems.shape) != (len(model.sources), 2, info.frames) or not torch.isfinite(stems).all():
        raise ValueError("Demucs did not return a complete finite source timeline")
    vocal_index = model.sources.index("vocals")
    vocals = stems[vocal_index]
    background = torch.stack([stem for index, stem in enumerate(stems) if index != vocal_index]).sum(0)
    for name, waveform in (("vocals", vocals), ("background", background)):
        if not torch.isfinite(waveform).all():
            raise ValueError("separation output contains non-finite samples")
        target = output_dir / f"{name}.wav"
        if target.exists() or target.is_symlink():
            raise ValueError("separation output already exists")
        sf.write(target, waveform.numpy().T, sample_rate, subtype="FLOAT", format="WAV")
        actual = sf.info(target)
        if actual.frames != info.frames or actual.channels != 2 or actual.samplerate != sample_rate:
            raise ValueError("separation output lost source timing")
    return {"sample_rate_hz": sample_rate, "channels": 2, "sample_count": info.frames,
            "vocals_path": str(output_dir / "vocals.wav"), "background_path": str(output_dir / "background.wav")}


def handle_request(request: dict) -> dict:
    operation = request.get("operation")
    if operation == "driver.preflight":
        import demucs
        import torch
        return {"driver_family": "demucs", "driver_backend": "pytorch", "supports": ["audio.separate"],
                "demucs_version": demucs.__version__, "torch_version": torch.__version__}
    if operation == "audio.separate":
        return separate(request)
    raise ValueError("unsupported Demucs operation")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    args = parser.parse_args()
    try:
        request = json.loads(pathlib.Path(args.request).read_text(encoding="utf-8"))
        if not isinstance(request, dict):
            raise ValueError("request must be an object")
        result = handle_request(request)
        pathlib.Path(args.response).write_text(json.dumps(result), encoding="utf-8")
        return 0
    except Exception as error:
        sys.stderr.write(str(error) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

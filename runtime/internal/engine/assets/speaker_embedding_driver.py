from __future__ import annotations
# @nimi-authority: rule.nimi.runtime.speaker-representation.sherpa-speaker-encoder

import argparse
import ctypes
import importlib.metadata
import json
import math
from pathlib import Path
import platform
import struct
import sys
import sysconfig

PROTOCOL = "nimi-speaker-embed/1"
MAX_FRAMES = 30 * 16000
_ort_library = None
_ort_directory = None


def load_managed_ort():
    global _ort_library, _ort_directory
    if _ort_library is not None:
        return
    if sys.platform != "win32":
        raise RuntimeError("speaker encoder platform is unsupported")
    package = importlib.metadata.distribution("onnxruntime")
    library = Path(package.locate_file("onnxruntime/capi/onnxruntime.dll"))
    if not library.is_file() or library.is_symlink() or not library.resolve().is_relative_to(Path(sys.prefix).resolve()):
        raise RuntimeError("managed speaker ONNX dependency is unavailable")
    import os
    _ort_directory = os.add_dll_directory(str(library.parent))
    _ort_library = ctypes.WinDLL(str(library.resolve()))
    class ApiBase(ctypes.Structure):
        _fields_ = [("get_api", ctypes.c_void_p), ("get_version", ctypes.c_void_p)]
    _ort_library.OrtGetApiBase.restype = ctypes.POINTER(ApiBase)
    base = _ort_library.OrtGetApiBase().contents
    if not ctypes.WINFUNCTYPE(ctypes.c_void_p, ctypes.c_uint32)(base.get_api)(28):
        raise RuntimeError("managed speaker ONNX API is incompatible")


class SpeakerInputError(ValueError):
    pass


def probe_environment():
    load_managed_ort()
    import av
    import numpy as np
    import sherpa_onnx
    value = np.zeros(1, dtype=np.float32)
    print(json.dumps({"python_version": platform.python_version(), "device": "cpu",
                      "python_implementation": platform.python_implementation(),
                      "python_cache_tag": sys.implementation.cache_tag,
                      "python_soabi": sysconfig.get_config_var("SOABI") or "",
                      "python_platform": sys.platform, "python_machine": platform.machine(),
                      "python_pointer_bits": struct.calcsize("P") * 8, "device_name": "cpu",
                      "allocation": int(value.size), "torch_version": "", "cuda_abi": "",
                      "installed_distributions": sorted(
                          f"{item.metadata['Name']}=={item.version}" for item in importlib.metadata.distributions())}))


def decode_audio(filename: str):
    import av
    import numpy as np
    chunks = []
    count = 0
    try:
        with av.open(filename) as container:
            if not container.streams.audio:
                raise SpeakerInputError("audio stream is missing")
            resampler = av.AudioResampler(format="fltp", layout="mono", rate=16000)
            for frame in container.decode(container.streams.audio[0]):
                for decoded in resampler.resample(frame):
                    samples = decoded.to_ndarray().reshape(-1)
                    count += samples.size
                    if count > MAX_FRAMES:
                        raise SpeakerInputError("speaker input exceeds 30 seconds")
                    chunks.append(samples)
            for decoded in resampler.resample(None):
                samples = decoded.to_ndarray().reshape(-1)
                count += samples.size
                if count > MAX_FRAMES:
                    raise SpeakerInputError("speaker input exceeds 30 seconds")
                chunks.append(samples)
    except SpeakerInputError:
        raise
    except Exception as error:
        raise SpeakerInputError("audio decoding failed") from error
    if count == 0:
        raise SpeakerInputError("audio is empty")
    result = np.ascontiguousarray(np.concatenate(chunks), dtype=np.float32)
    if not np.isfinite(result).all():
        raise SpeakerInputError("audio samples are invalid")
    return result


def execute_request(request: dict):
    load_managed_ort()
    import sherpa_onnx
    if request.get("protocol") != PROTOCOL:
        raise RuntimeError("speaker protocol is unsupported")
    model = request.get("model") or {}
    root = Path(str(model.get("bundle_dir") or ""))
    entry = Path(str(model.get("entry_path") or ""))
    files = model.get("declared_files")
    if not root.is_absolute() or root.is_symlink() or not root.is_dir() or not isinstance(files, list) or not files:
        raise RuntimeError("captured speaker model bundle is required")
    for name in files:
        if not isinstance(name, str) or not name:
            raise RuntimeError("captured speaker file declaration is invalid")
        file = root / name
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):
            raise RuntimeError("captured speaker file is unavailable")
    if not entry.is_absolute() or not entry.is_file() or entry.is_symlink() or not entry.resolve().is_relative_to(root.resolve()) or entry.relative_to(root).as_posix() not in files:
        raise RuntimeError("captured speaker entry is unavailable")
    dimension = request.get("dimension")
    if isinstance(dimension, bool) or not isinstance(dimension, int) or not 1 <= dimension <= 4096:
        raise RuntimeError("captured speaker dimension is required")
    audio = Path(str(request.get("audio_path") or ""))
    if not audio.is_absolute() or not audio.is_file() or audio.is_symlink():
        raise SpeakerInputError("captured audio is unavailable")
    samples = decode_audio(str(audio))
    config = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(entry), num_threads=1, provider="cpu", debug=False)
    if not config.validate():
        raise RuntimeError("captured speaker extractor configuration is invalid")
    extractor = sherpa_onnx.SpeakerEmbeddingExtractor(config)
    if extractor.dim != dimension:
        raise RuntimeError("speaker extractor disagrees with captured dimension")
    stream = extractor.create_stream()
    stream.accept_waveform(sample_rate=16000, waveform=samples)
    stream.input_finished()
    if not extractor.is_ready(stream):
        raise SpeakerInputError("audio contains no computable speaker features")
    vector = [float(value) for value in extractor.compute(stream)]
    if len(vector) != dimension or not all(math.isfinite(value) for value in vector) or not any(value != 0 for value in vector):
        raise RuntimeError("speaker extractor returned an invalid representation")
    return {"protocol": PROTOCOL, "vector": vector}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    source, output = Path(args.input), Path(args.output)
    if not source.is_absolute() or not output.is_absolute() or source.parent != output.parent:
        raise RuntimeError("speaker work paths are invalid")
    request = json.loads(source.read_text(encoding="utf-8"))
    result = execute_request(request)
    output.write_text(json.dumps(result, allow_nan=False), encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except SpeakerInputError:
        print("speaker input is invalid", file=sys.stderr)
        raise SystemExit(65)
    except Exception:
        print("speaker encoder execution failed", file=sys.stderr)
        raise SystemExit(1)

"""Exact captured Sherpa/Pyannote source-time projection, not person identity."""
from __future__ import annotations

import math
from pathlib import Path


class DiarizationInputError(ValueError):
    pass


class DiarizationUnsupportedError(ValueError):
    pass


def normalize_intervals(raw, frame_count: int, metadata: dict):
    rate = int(metadata["sample_rate"])
    window = int(metadata["window_size"])
    field = int(metadata["receptive_field_size"])
    shift = int(metadata["receptive_field_shift"])
    if rate != 16000 or not 0 < field <= window or not 0 < shift <= window or frame_count <= 0:
        raise DiarizationInputError("invalid captured segmentation time grid")
    duration = frame_count / rate
    window_shift = int(window * 0.1)
    if window_shift <= 0:
        raise DiarizationInputError("invalid captured segmentation window shift")
    chunks = 1 + math.ceil(max(0, frame_count - window) / window_shift)
    # Pinned native inference pads only its final admitted model window; its
    # frame-centre conversion adds half the captured receptive field.
    support_end = ((chunks - 1) * window_shift + window + field * 0.5) / rate
    if len(raw) > 16384:
        raise RuntimeError("diarization interval bound exceeded")
    intervals, previous = [], 0.0
    for value in raw:
        start, end, speaker = value["start"], value["end"], value["speaker"]
        if (not isinstance(start, (int, float)) or isinstance(start, bool)
                or not isinstance(end, (int, float)) or isinstance(end, bool)
                or not math.isfinite(start) or not math.isfinite(end)
                or start < previous or end <= start or end > support_end
                or not isinstance(speaker, int) or isinstance(speaker, bool)
                or not 0 <= speaker < 16384):
            raise RuntimeError("invalid model speaker interval or padded-window support")
        previous = start
        if start >= duration:
            continue  # Pure known padding has no recorded-source person.
        source_end = min(end, duration)
        if source_end > start:
            intervals.append({"speaker_id": f"speaker_{speaker}", "start_seconds": start,
                              "end_seconds": source_end})
    return {"status": "diarized" if intervals else "no_speakers",
            "duration_seconds": duration, "intervals": intervals}


def exact_model(value: dict) -> str:
    if not isinstance(value, dict):
        raise RuntimeError("captured diarization model is unavailable")
    root = Path(str(value.get("bundle_dir") or ""))
    entry = Path(str(value.get("entry_path") or ""))
    files = value.get("declared_files")
    if (not root.is_absolute() or not entry.is_absolute() or not isinstance(files, list)
            or not files or root.is_symlink() or entry.is_symlink()
            or not entry.is_file() or not entry.resolve().is_relative_to(root.resolve())
            or entry.relative_to(root).as_posix() not in files):
        raise RuntimeError("diarization model is not an exact captured entry")
    return str(entry)


def execute_diarization(audio, segmenter: dict, encoder: dict, speaker_count: int = 0):
    # Same exact managed ABI used by the admitted independent speaker encoder.
    from speaker_embedding_driver import load_managed_ort
    load_managed_ort()
    import onnxruntime as ort
    import sherpa_onnx
    segmenter_path, encoder_path = exact_model(segmenter), exact_model(encoder)
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    session = ort.InferenceSession(segmenter_path, sess_options=options, providers=["CPUExecutionProvider"])
    metadata = session.get_modelmeta().custom_metadata_map
    if metadata.get("model_type") != "pyannote-segmentation-3.0" or metadata.get("version") != "1":
        raise RuntimeError("captured segmentation dialect is unsupported")
    if not isinstance(speaker_count, int) or isinstance(speaker_count, bool) or not 0 <= speaker_count <= 32:
        raise DiarizationInputError("speaker count is invalid")
    if speaker_count and len(audio) <= int(metadata["window_size"]):
        # This pinned one-chunk path returns before global clustering.
        raise DiarizationUnsupportedError("short-window explicit speaker count is unsupported")
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=segmenter_path, window_shift_ratio=0.1),
            provider="cpu", num_threads=1),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=encoder_path, provider="cpu", num_threads=1),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=speaker_count or -1, threshold=0.5),
        min_duration_on=0.3, min_duration_off=0.5)
    if not config.validate():
        raise RuntimeError("captured diarization configuration is invalid")
    diarizer = sherpa_onnx.OfflineSpeakerDiarization(config)
    raw = [{"start": value.start, "end": value.end, "speaker": value.speaker}
           for value in diarizer.process(audio).sort_by_start_time()]
    return normalize_intervals(raw, len(audio), metadata)

from __future__ import annotations
# @nimi-authority: definition.nimi.runtime.local-compute.speech-engine-plane

import contextlib
import pathlib
import subprocess
import tempfile


def is_wave_audio(path: pathlib.Path) -> bool:
    try:
        header = path.read_bytes()[:12]
    except OSError:
        return False
    return len(header) == 12 and header[:4] == b"RIFF" and header[8:] == b"WAVE"


@contextlib.contextmanager
def normalized_audio_source(audio_path: str):
    source = pathlib.Path(audio_path)
    if is_wave_audio(source):
        yield str(source)
        return
    try:
        import imageio_ffmpeg

        ffmpeg = pathlib.Path(str(imageio_ffmpeg.get_ffmpeg_exe() or "").strip())
    except Exception as error:
        raise RuntimeError(f"managed audio decoder is unavailable: {error}") from error
    if not ffmpeg.is_file() or ffmpeg.is_symlink():
        raise RuntimeError("managed audio decoder executable is unavailable")
    with tempfile.TemporaryDirectory(prefix="nimi-asr-audio-", dir=str(source.parent)) as temp_dir:
        normalized = pathlib.Path(temp_dir) / "audio.wav"
        try:
            result = subprocess.run(
                [
                    str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                    "-i", str(source), "-vn", "-ac", "1", "-ar", "16000",
                    "-acodec", "pcm_s16le", str(normalized),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=120,
            )
        except Exception as error:
            raise RuntimeError(f"managed audio normalization failed: {error}") from error
        if result.returncode != 0:
            detail = bytes(result.stderr or b"").decode("utf-8", errors="replace").strip()
            raise RuntimeError(f"managed audio normalization failed: {detail or f'exit status {result.returncode}'}")
        if not normalized.is_file() or not is_wave_audio(normalized):
            raise RuntimeError("managed audio normalization returned invalid WAV output")
        yield str(normalized)

from __future__ import annotations

# @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-output

import io
from fractions import Fraction
from pathlib import Path

from face_swap import FaceSwapError

MAX_VIDEO_BYTES = 32 * 1024 * 1024
MAX_VIDEO_OUTPUT_BYTES = 512 * 1024 * 1024
MAX_VIDEO_SECONDS = 300
MAX_VIDEO_FRAMES = 9000


def inspect_video(body: bytes):
    import av

    if not body or len(body) > MAX_VIDEO_BYTES:
        raise FaceSwapError("AI_INPUT_INVALID", "Video is empty or exceeds 32 MiB")
    try:
        with av.open(io.BytesIO(body), mode="r", format="mp4") as container:
            if len(container.streams.video) != 1 or len(container.streams.audio) > 1 or len(container.streams) != len(container.streams.video) + len(container.streams.audio):
                raise FaceSwapError("AI_MEDIA_OPTION_UNSUPPORTED", "Video requires one picture stream and at most one audio stream")
            video = container.streams.video[0]
            rate = video.average_rate
            if video.codec_context.name != "h264" or rate not in (24, 25, 30) or not 0 < video.frames <= MAX_VIDEO_FRAMES:
                raise FaceSwapError("AI_MEDIA_OPTION_UNSUPPORTED", "Video requires bounded constant-rate H.264 content at 24, 25 or 30 frames per second")
            if video.duration is None or not 0 < video.duration * video.time_base <= MAX_VIDEO_SECONDS:
                raise FaceSwapError("AI_MEDIA_OPTION_UNSUPPORTED", "Video duration must be known and at most 300 seconds")
            first = next(container.decode(video))
            rotation = int(first.rotation) % 360
            if rotation not in (0, 90, 180, 270) or first.format.name not in ("yuv420p", "yuvj420p"):
                raise FaceSwapError("AI_MEDIA_OPTION_UNSUPPORTED", "Video requires 8-bit 4:2:0 pixels and a right-angle orientation")
            width, height = first.width, first.height
            sample_aspect_ratio = video.sample_aspect_ratio or Fraction(1, 1)
            if rotation in (90, 270):
                width, height = height, width
                sample_aspect_ratio = 1 / sample_aspect_ratio
            if not 0 < width <= 1920 or not 0 < height <= 1920 or width * height > 1920 * 1080 or width % 2 or height % 2:
                raise FaceSwapError("AI_MEDIA_OPTION_UNSUPPORTED", "Video exceeds the admitted even-dimension 1080p frame bound")
            if container.streams.audio:
                audio = container.streams.audio[0].codec_context
                if audio.name != "aac" or audio.channels not in (1, 2) or not 8000 <= audio.sample_rate <= 96000:
                    raise FaceSwapError("AI_MEDIA_OPTION_UNSUPPORTED", "Video audio must be mono or stereo AAC")
            return {"width": width, "height": height, "rotation": rotation, "frames": video.frames,
                    "sample_aspect_ratio": sample_aspect_ratio,
                    "rate": rate, "time_base": video.time_base, "duration": video.duration,
                    "audio": bool(container.streams.audio)}
    except FaceSwapError:
        raise
    except Exception as error:
        raise FaceSwapError("AI_VIDEO_DECODE_FAILED", "Video could not be decoded") from error


def replace_video(worker, reference: bytes, video_path: str, output_path: str, bindings, no_face_policy: str, progress):
    import av
    import numpy as np

    if no_face_policy not in ("fail", "preserve_frame"):
        raise FaceSwapError("AI_INPUT_INVALID", "A video no-face policy is required")
    source_path, destination_path = Path(video_path), Path(output_path)
    if not source_path.is_absolute() or not destination_path.is_absolute() or source_path == destination_path or not 0 < source_path.stat().st_size <= MAX_VIDEO_BYTES:
        raise FaceSwapError("AI_INPUT_INVALID", "The captured video files are invalid")
    body = source_path.read_bytes()
    info = inspect_video(body)
    prepared = worker.prepare_reference(reference, bindings)
    transformed = preserved = count = 0
    first_pts = last_pts = None
    completed = False
    phase = "decode"
    try:
        with av.open(io.BytesIO(body), mode="r", format="mp4") as source:
            video = source.streams.video[0]
            audio = source.streams.audio[0] if info["audio"] else None
            phase = "encode"
            with av.open(str(destination_path), mode="w", format="mp4", options={"movflags": "+faststart"}) as output:
                encoded = output.add_stream("libx264", rate=info["rate"])
                encoded.width, encoded.height, encoded.pix_fmt = info["width"], info["height"], "yuv420p"
                encoded.codec_context.time_base = info["time_base"]
                encoded.codec_context.sample_aspect_ratio = info["sample_aspect_ratio"]
                encoded.options = {"crf": "18", "preset": "veryfast", "bf": "0"}
                audio_out = output.add_stream_from_template(audio) if audio else None
                if audio_out:
                    audio_out.time_base = audio.time_base
                phase = "decode"
                for packet in source.demux(video, *([audio] if audio else [])):
                    if packet.stream.type == "audio":
                        if packet.dts is not None:
                            phase = "encode"
                            packet.stream = audio_out
                            output.mux(packet)
                            phase = "decode"
                        continue
                    for frame in packet.decode():
                        if frame.pts is None or (last_pts is not None and frame.pts <= last_pts) or int(frame.rotation) % 360 != info["rotation"]:
                            raise FaceSwapError("AI_INPUT_INVALID", "Video timestamps or orientation changed within the stream")
                        if first_pts is None:
                            first_pts = frame.pts
                        last_pts = frame.pts
                        count += 1
                        expected_time = (count - 1) / info["rate"]
                        if abs((last_pts - first_pts) * frame.time_base - expected_time) > frame.time_base:
                            raise FaceSwapError("AI_MEDIA_OPTION_UNSUPPORTED", "Variable-rate video is not admitted")
                        if count > info["frames"] or count > MAX_VIDEO_FRAMES or (last_pts - first_pts) * frame.time_base > MAX_VIDEO_SECONDS:
                            raise FaceSwapError("AI_INPUT_INVALID", "Video exceeds its declared timeline")
                        target = frame.to_ndarray(format="bgr24")
                        if info["rotation"]:
                            target = np.rot90(target, info["rotation"] // 90).copy()
                        if target.shape[:2] != (info["height"], info["width"]):
                            raise FaceSwapError("AI_INPUT_INVALID", "Video frame dimensions changed")
                        try:
                            result = worker.replace_frame(target, prepared)
                            transformed += 1
                        except FaceSwapError as error:
                            if error.reason != "AI_FACE_TARGET_MISSING" or no_face_policy != "preserve_frame":
                                raise
                            result = target
                            preserved += 1
                        phase = "encode"
                        converted = av.VideoFrame.from_ndarray(result, format="bgr24")
                        converted.pts, converted.time_base = frame.pts, frame.time_base
                        for encoded_packet in encoded.encode(converted):
                            output.mux(encoded_packet)
                        if count % max(1, info["frames"] // 20) == 0:
                            progress(count, info["frames"])
                        # With no audio packet to open the muxer, x264 may
                        # buffer its leading frames before creating the file.
                        if destination_path.exists() and destination_path.stat().st_size > MAX_VIDEO_OUTPUT_BYTES:
                            raise FaceSwapError("AI_MEDIA_OPTION_UNSUPPORTED", "Encoded video exceeds 512 MiB")
                        phase = "decode"
                if count != info["frames"]:
                    raise FaceSwapError("AI_VIDEO_DECODE_FAILED", "Video ended before every declared frame was decoded")
                phase = "encode"
                for encoded_packet in encoded.encode():
                    output.mux(encoded_packet)
        if not 0 < destination_path.stat().st_size <= MAX_VIDEO_OUTPUT_BYTES:
            raise FaceSwapError("AI_VIDEO_ENCODE_FAILED", "Encoded video has an invalid size")
        completed = True
        return {"frames_total": count, "frames_transformed": transformed, "frames_preserved": preserved,
                "width": info["width"], "height": info["height"],
                "duration_us": int(info["duration"] * info["time_base"] * 1000000),
                "frame_rate_numerator": info["rate"].numerator, "frame_rate_denominator": info["rate"].denominator,
                "audio_preserved": info["audio"]}
    except FaceSwapError:
        raise
    except Exception as error:
        reason = "AI_VIDEO_ENCODE_FAILED" if phase == "encode" else "AI_VIDEO_DECODE_FAILED"
        raise FaceSwapError(reason, "Video " + phase + " failed") from error
    finally:
        try:
            worker.clear_request_state()
        finally:
            if not completed:
                destination_path.unlink(missing_ok=True)

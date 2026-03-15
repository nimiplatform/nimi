#!/usr/bin/env python3

import argparse
import base64
import io
import json
import os
import tempfile
import threading
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


DEFAULT_IMAGE_MODEL = os.environ.get(
    "NIMI_MEDIA_DEFAULT_IMAGE_MODEL",
    "black-forest-labs/FLUX.1-schnell",
)
DEFAULT_VIDEO_MODEL = os.environ.get(
    "NIMI_MEDIA_DEFAULT_VIDEO_MODEL",
    "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
)
DEVICE = os.environ.get("NIMI_MEDIA_DEVICE", "cuda")
TORCH_DTYPE = os.environ.get("NIMI_MEDIA_TORCH_DTYPE", "float16")
IMAGE_DRIVER = os.environ.get("NIMI_MEDIA_IMAGE_DRIVER", "flux")
VIDEO_DRIVER = os.environ.get("NIMI_MEDIA_VIDEO_DRIVER", "wan")

PIPELINE_LOCK = threading.Lock()
PIPELINE_CACHE = {}


def _json_response(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _error_response(handler, status, code, message, detail=None):
    payload = {
        "error": {
            "code": code,
            "message": str(message),
        }
    }
    if detail:
        payload["error"]["detail"] = str(detail)
    _json_response(handler, status, payload)


def _read_json(handler):
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length)
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


def _torch_modules():
    import torch

    dtype = torch.float16
    if TORCH_DTYPE == "bfloat16":
        dtype = torch.bfloat16
    elif TORCH_DTYPE == "float32":
        dtype = torch.float32
    return torch, dtype


def _ensure_cuda(torch):
    if DEVICE == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is required but not available")


def _parse_size(value):
    text = str(value or "").strip().lower()
    if "x" in text:
        width, height = text.split("x", 1)
        return max(int(width), 64), max(int(height), 64)
    return 1024, 1024


def _parse_frames(payload):
    frames = int(payload.get("frames") or 0)
    if frames > 0:
        return frames
    fps = _parse_fps(payload)
    duration = int(payload.get("duration_sec") or 0)
    if duration > 0 and fps > 0:
        return duration * fps
    return 49


def _parse_fps(payload):
    fps = int(payload.get("fps") or 0)
    if fps > 0:
        return fps
    return 8


def _content_images(payload):
    images = []
    for item in payload.get("content") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "image_url":
            continue
        image_url = item.get("image_url") or {}
        url = str(image_url.get("url") or "").strip()
        if not url:
            continue
        images.append((str(item.get("role") or "").strip(), url))
    return images


def _load_image_from_uri(uri):
    from PIL import Image

    parsed = urllib.parse.urlparse(uri)
    if parsed.scheme in ("http", "https"):
        with urllib.request.urlopen(uri) as response:
            return Image.open(io.BytesIO(response.read())).convert("RGB")
    if parsed.scheme == "data":
        _, encoded = uri.split(",", 1)
        return Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")
    if parsed.scheme == "file":
        return Image.open(parsed.path).convert("RGB")
    return Image.open(uri).convert("RGB")


def _image_to_b64(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _frames_to_b64_mp4(frames, fps):
    from diffusers.utils import export_to_video

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as handle:
        path = handle.name
    try:
        export_to_video(frames, path, fps=fps)
        with open(path, "rb") as handle:
            return base64.b64encode(handle.read()).decode("ascii")
    finally:
        if os.path.exists(path):
            os.unlink(path)


def _seeded_generator(torch, seed):
    if seed:
        return torch.Generator(device=DEVICE).manual_seed(int(seed))
    return None


def _flux_pipeline(model_id):
    key = ("flux", model_id)
    with PIPELINE_LOCK:
        pipeline = PIPELINE_CACHE.get(key)
        if pipeline is not None:
            return pipeline
        torch, dtype = _torch_modules()
        _ensure_cuda(torch)
        from diffusers import FluxPipeline

        pipeline = FluxPipeline.from_pretrained(model_id, torch_dtype=dtype)
        pipeline = pipeline.to(DEVICE)
        PIPELINE_CACHE[key] = pipeline
        return pipeline


def _wan_pipeline(model_id, image_to_video):
    cache_key = ("wan_i2v" if image_to_video else "wan_t2v", model_id)
    with PIPELINE_LOCK:
        pipeline = PIPELINE_CACHE.get(cache_key)
        if pipeline is not None:
            return pipeline
        torch, dtype = _torch_modules()
        _ensure_cuda(torch)
        if image_to_video:
            from diffusers import WanImageToVideoPipeline

            pipeline = WanImageToVideoPipeline.from_pretrained(model_id, torch_dtype=dtype)
        else:
            from diffusers import WanPipeline

            pipeline = WanPipeline.from_pretrained(model_id, torch_dtype=dtype)
        pipeline = pipeline.to(DEVICE)
        PIPELINE_CACHE[cache_key] = pipeline
        return pipeline


def _generate_image(payload):
    model_id = str(payload.get("model") or DEFAULT_IMAGE_MODEL).strip()
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt is required")
    width, height = _parse_size(payload.get("size"))
    steps = int(((payload.get("extensions") or {}).get("steps")) or 4)
    seed = payload.get("seed") or 0
    torch, _ = _torch_modules()
    try:
        pipeline = _flux_pipeline(model_id)
    except Exception as err:
        raise RuntimeError(f"failed to load image model {model_id}: {err}") from err
    image = pipeline(
        prompt=prompt,
        width=width,
        height=height,
        num_inference_steps=max(steps, 1),
        generator=_seeded_generator(torch, seed),
    ).images[0]
    return {"data": [{"b64_json": _image_to_b64(image)}]}


def _generate_video(payload):
    model_id = str(payload.get("model") or DEFAULT_VIDEO_MODEL).strip()
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt is required")
    width, height = _parse_size(payload.get("resolution"))
    frames = _parse_frames(payload)
    fps = _parse_fps(payload)
    seed = payload.get("seed") or 0
    images = _content_images(payload)
    first_frame = None
    for role, uri in images:
        if role == "first_frame":
            first_frame = _load_image_from_uri(uri)
            break
    if first_frame is None and images:
        first_frame = _load_image_from_uri(images[0][1])

    torch, _ = _torch_modules()
    if first_frame is not None:
        try:
            pipeline = _wan_pipeline(model_id, True)
        except Exception as err:
            raise RuntimeError(f"failed to load image-to-video model {model_id}: {err}") from err
        frames_out = pipeline(
            image=first_frame,
            prompt=prompt,
            num_frames=max(frames, 1),
            width=width,
            height=height,
            generator=_seeded_generator(torch, seed),
        ).frames[0]
    else:
        try:
            pipeline = _wan_pipeline(model_id, False)
        except Exception as err:
            raise RuntimeError(f"failed to load text-to-video model {model_id}: {err}") from err
        frames_out = pipeline(
            prompt=prompt,
            num_frames=max(frames, 1),
            width=width,
            height=height,
            generator=_seeded_generator(torch, seed),
        ).frames[0]
    return {"data": [{"b64_mp4": _frames_to_b64_mp4(frames_out, fps)}]}


class Handler(BaseHTTPRequestHandler):
    server_version = "nimi-media/0.1"

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path in ("/readyz", "/healthz"):
            _json_response(self, 200, {"status": "ok"})
            return
        if self.path == "/v1/models":
            data = [
                {
                    "id": DEFAULT_IMAGE_MODEL,
                    "object": "model",
                    "owned_by": "nimi_media",
                    "metadata": {
                        "family": "diffusers",
                        "driver": IMAGE_DRIVER,
                        "modality": "image",
                        "device": DEVICE,
                    },
                },
                {
                    "id": DEFAULT_VIDEO_MODEL,
                    "object": "model",
                    "owned_by": "nimi_media",
                    "metadata": {
                        "family": "diffusers",
                        "driver": VIDEO_DRIVER,
                        "modality": "video",
                        "device": DEVICE,
                    },
                },
            ]
            _json_response(self, 200, {"data": data})
            return
        _error_response(self, 404, "not_found", "route not found")

    def do_POST(self):
        try:
            payload = _read_json(self)
            if self.path == "/v1/images/generations":
                _json_response(self, 200, _generate_image(payload))
                return
            if self.path in ("/v1/video/generations", "/v1/videos/generations"):
                _json_response(self, 200, _generate_video(payload))
                return
            _error_response(self, 404, "not_found", "route not found")
        except ValueError as err:
            _error_response(self, 400, "invalid_request", err)
        except TimeoutError as err:
            _error_response(self, 504, "generation_timeout", err)
        except BrokenPipeError as err:
            _error_response(self, 499, "client_cancelled", err)
        except RuntimeError as err:
            _error_response(self, 503, "engine_unavailable", err)
        except Exception as err:
            _error_response(self, 500, "internal_error", err)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8321)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

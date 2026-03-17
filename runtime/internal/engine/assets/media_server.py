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
STATE_LOCK = threading.Lock()
ENGINE_STATE = {
    "status": "starting",
    "ready": False,
    "detail": "warming default models",
    "checks": {},
    "models": [],
}


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


def _copy_state():
    with STATE_LOCK:
        return {
            "status": ENGINE_STATE["status"],
            "ready": bool(ENGINE_STATE["ready"]),
            "detail": str(ENGINE_STATE["detail"]),
            "checks": dict(ENGINE_STATE["checks"]),
            "models": [dict(item) for item in ENGINE_STATE["models"]],
        }


def _set_state(status, ready, detail, checks=None, models=None):
    with STATE_LOCK:
        ENGINE_STATE["status"] = str(status)
        ENGINE_STATE["ready"] = bool(ready)
        ENGINE_STATE["detail"] = str(detail)
        ENGINE_STATE["checks"] = dict(checks or {})
        ENGINE_STATE["models"] = [dict(item) for item in (models or [])]


def _remember_ready_model(model_id, capability, driver):
    normalized_model = str(model_id or "").strip()
    if not normalized_model:
        return
    normalized_capability = str(capability or "").strip()
    normalized_driver = str(driver or "").strip()
    with STATE_LOCK:
        models = [dict(item) for item in ENGINE_STATE["models"]]
        for item in models:
            if item.get("id") == normalized_model:
                capabilities = list(item.get("capabilities") or [])
                if normalized_capability and normalized_capability not in capabilities:
                    capabilities.append(normalized_capability)
                item["capabilities"] = capabilities
                item["ready"] = True
                if normalized_driver:
                    item["driver"] = normalized_driver
                break
        else:
            models.append(
                {
                    "id": normalized_model,
                    "capabilities": [normalized_capability] if normalized_capability else [],
                    "ready": True,
                    "family": "diffusers",
                    "device": DEVICE,
                    "driver": normalized_driver,
                }
            )
        ENGINE_STATE["models"] = models


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


def _preflight_checks():
    checks = {
        "torch_imported": False,
        "diffusers_imported": False,
        "pillow_imported": False,
        "cuda_available": False,
        "device": DEVICE,
    }
    try:
        torch, _ = _torch_modules()
        checks["torch_imported"] = True
        checks["cuda_available"] = bool(torch.cuda.is_available())
    except Exception as err:
        return checks, "torch import failed: %s" % err
    try:
        import diffusers  # noqa: F401

        checks["diffusers_imported"] = True
    except Exception as err:
        return checks, "diffusers import failed: %s" % err
    try:
        from PIL import Image  # noqa: F401

        checks["pillow_imported"] = True
    except Exception as err:
        return checks, "pillow import failed: %s" % err
    if DEVICE == "cuda" and not checks["cuda_available"]:
        return checks, "CUDA is required but not available"
    return checks, ""


def _parse_size(value):
    text = str(value or "").strip().lower()
    if "x" in text:
        width, height = text.split("x", 1)
        return max(int(width), 64), max(int(height), 64)
    return 1024, 1024


def _parse_frames(spec):
    frames = int(spec.get("frames") or 0)
    if frames > 0:
        return frames
    fps = _parse_fps(spec)
    duration = int(spec.get("duration_sec") or 0)
    if duration > 0 and fps > 0:
        return duration * fps
    return 49


def _parse_fps(spec):
    fps = int(spec.get("fps") or 0)
    if fps > 0:
        return fps
    return 8


def _content_images(spec):
    images = []
    for item in spec.get("content") or []:
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


def _warm_default_models():
    checks, detail = _preflight_checks()
    if detail:
        _set_state("not_ready", False, detail, checks=checks, models=[])
        return

    models = []
    try:
        _flux_pipeline(DEFAULT_IMAGE_MODEL)
        models.append(
            {
                "id": DEFAULT_IMAGE_MODEL,
                "capabilities": ["image.generate"],
                "ready": True,
                "family": "diffusers",
                "device": DEVICE,
                "driver": IMAGE_DRIVER,
            }
        )
    except Exception as err:
        _set_state(
            "not_ready",
            False,
            "failed to warm image model %s: %s" % (DEFAULT_IMAGE_MODEL, err),
            checks=checks,
            models=models,
        )
        return

    try:
        _wan_pipeline(DEFAULT_VIDEO_MODEL, False)
        _wan_pipeline(DEFAULT_VIDEO_MODEL, True)
        models.append(
            {
                "id": DEFAULT_VIDEO_MODEL,
                "capabilities": ["video.generate"],
                "ready": True,
                "family": "diffusers",
                "device": DEVICE,
                "driver": VIDEO_DRIVER,
            }
        )
    except Exception as err:
        _set_state(
            "not_ready",
            False,
            "failed to warm video model %s: %s" % (DEFAULT_VIDEO_MODEL, err),
            checks=checks,
            models=models,
        )
        return

    _set_state("ok", True, "default media models ready", checks=checks, models=models)


def _health_payload():
    snapshot = _copy_state()
    return {
        "status": snapshot["status"],
        "ready": snapshot["ready"],
        "detail": snapshot["detail"],
        "family": "diffusers",
        "device": DEVICE,
        "image_driver": IMAGE_DRIVER,
        "video_driver": VIDEO_DRIVER,
        "checks": snapshot["checks"],
        "models": snapshot["models"],
    }


def _catalog_payload():
    snapshot = _copy_state()
    return {
        "status": snapshot["status"],
        "ready": snapshot["ready"],
        "detail": snapshot["detail"],
        "models": snapshot["models"],
    }


def _generate_image(model_id, spec):
    spec = spec or {}
    model_id = str(model_id or DEFAULT_IMAGE_MODEL).strip() or DEFAULT_IMAGE_MODEL
    prompt = str(spec.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt is required")
    width, height = _parse_size(spec.get("size"))
    steps = int(((spec.get("extensions") or {}).get("steps")) or 4)
    seed = spec.get("seed") or 0
    torch, _ = _torch_modules()
    try:
        pipeline = _flux_pipeline(model_id)
    except Exception as err:
        raise RuntimeError("failed to load image model %s: %s" % (model_id, err)) from err
    image = pipeline(
        prompt=prompt,
        width=width,
        height=height,
        num_inference_steps=max(steps, 1),
        generator=_seeded_generator(torch, seed),
    ).images[0]
    _remember_ready_model(model_id, "image.generate", IMAGE_DRIVER)
    return {
        "artifact": {
            "mime_type": "image/png",
            "data_base64": _image_to_b64(image),
        }
    }


def _generate_video(model_id, spec):
    spec = spec or {}
    model_id = str(model_id or DEFAULT_VIDEO_MODEL).strip() or DEFAULT_VIDEO_MODEL
    prompt = str(spec.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("prompt is required")
    width, height = _parse_size(spec.get("resolution"))
    frames = _parse_frames(spec)
    fps = _parse_fps(spec)
    seed = spec.get("seed") or 0
    images = _content_images(spec)
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
            raise RuntimeError("failed to load image-to-video model %s: %s" % (model_id, err)) from err
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
            raise RuntimeError("failed to load text-to-video model %s: %s" % (model_id, err)) from err
        frames_out = pipeline(
            prompt=prompt,
            num_frames=max(frames, 1),
            width=width,
            height=height,
            generator=_seeded_generator(torch, seed),
        ).frames[0]
    _remember_ready_model(model_id, "video.generate", VIDEO_DRIVER)
    return {
        "artifact": {
            "mime_type": "video/mp4",
            "data_base64": _frames_to_b64_mp4(frames_out, fps),
        }
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "nimi-media/0.2"

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path == "/healthz":
            payload = _health_payload()
            status = 200 if payload["ready"] else 503
            _json_response(self, status, payload)
            return
        if self.path == "/v1/catalog":
            payload = _catalog_payload()
            status = 200 if payload["ready"] else 503
            _json_response(self, status, payload)
            return
        _error_response(self, 404, "not_found", "route not found")

    def do_POST(self):
        try:
            payload = _read_json(self)
            if self.path == "/v1/media/image/generate":
                spec = payload.get("spec")
                if not isinstance(spec, dict):
                    raise ValueError("spec is required")
                _json_response(self, 200, _generate_image(payload.get("model"), spec))
                return
            if self.path == "/v1/media/video/generate":
                spec = payload.get("spec")
                if not isinstance(spec, dict):
                    raise ValueError("spec is required")
                _json_response(self, 200, _generate_video(payload.get("model"), spec))
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

    warm_thread = threading.Thread(target=_warm_default_models, daemon=True)
    warm_thread.start()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

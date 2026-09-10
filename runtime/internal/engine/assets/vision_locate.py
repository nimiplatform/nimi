from __future__ import annotations

# @nimi-authority: rule.nimi.runtime.ai-provider.r126
# @nimi-authority: rule.nimi.runtime.ai-provider.r127
# @nimi-authority: rule.nimi.runtime.local-compute.r117
# @nimi-authority: rule.nimi.runtime.local-compute.r116

import base64
import io
import json
import pathlib
import re
import sys
import time
from typing import Any

PROTOCOL = "nimi-vision-locate/1"
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_QUERY_BYTES = 8 * 1024
# Private JSON budget: up to six bytes per escaped label byte plus geometry
# and envelope syntax. Runtime alone applies the 256 KiB serialized-proto cap.
MAX_WIRE_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_PIXELS = 64 * 1024 * 1024
MAX_NEW_TOKENS = 8192


class LocateError(ValueError):
    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason


def parse_locations(text: str, geometry: str, *, complete: bool) -> list[dict[str, Any]]:
    """Consume the entire grounding stream; never accept a valid prefix."""
    if not complete or not isinstance(text, str):
        raise LocateError("AI_OUTPUT_INVALID", "Locate generation did not finish normally")
    if geometry not in ("BOX", "POINT"):
        raise LocateError("AI_INPUT_INVALID", "Locate geometry must be BOX or POINT")
    locations: list[dict[str, Any]] = []
    label: str | None = None
    negative = False
    remaining = text.strip()
    while remaining:
        if remaining.startswith("<|im_end|>"):
            if remaining[len("<|im_end|>"):].strip():
                raise LocateError("AI_OUTPUT_INVALID", "Locate output continues after its end")
            remaining = ""
            break
        if remaining.startswith("<null>"):
            remaining = remaining[len("<null>"):].lstrip()
            continue
        if remaining.startswith("<ref>"):
            end = remaining.find("</ref>", len("<ref>"))
            if end < 0:
                raise LocateError("AI_OUTPUT_INVALID", "Locate label is incomplete")
            label = remaining[len("<ref>"):end].strip() or None
            if label is not None and ("<" in label or ">" in label):
                raise LocateError("AI_OUTPUT_INVALID", "Locate label contains invalid structure")
            remaining = remaining[end + len("</ref>"):].lstrip()
            continue
        if not remaining.startswith("<box>"):
            raise LocateError("AI_OUTPUT_INVALID", "Locate output contains unrecognized structure")
        end = remaining.find("</box>", len("<box>"))
        if end < 0:
            raise LocateError("AI_OUTPUT_INVALID", "Locate geometry is incomplete")
        body = remaining[len("<box>"):end].strip()
        remaining = remaining[end + len("</box>"):].lstrip()
        if body == "None":
            negative = True
            continue
        tokens = re.findall(r"<([0-9]+)>", body)
        if re.sub(r"<[0-9]+>", "", body).strip():
            raise LocateError("AI_OUTPUT_INVALID", "Locate coordinates contain invalid tokens")
        coordinates = [int(token) for token in tokens]
        expected = 4 if geometry == "BOX" else 2
        if len(coordinates) != expected or any(value < 0 or value > 1000 for value in coordinates):
            raise LocateError("AI_OUTPUT_INVALID", "Locate coordinates do not match the requested geometry")
        if geometry == "BOX" and not (
            coordinates[0] < coordinates[2] and coordinates[1] < coordinates[3]
        ):
            raise LocateError("AI_OUTPUT_INVALID", "Locate box endpoints are not increasing")
        location: dict[str, Any] = {geometry.lower(): [value / 1000 for value in coordinates]}
        if label is not None:
            location["label"] = label
        locations.append(location)
    if not locations and not negative:
        raise LocateError("AI_OUTPUT_INVALID", "Locate returned no complete match or explicit negative")
    if len(json.dumps(locations, ensure_ascii=False).encode("utf-8")) > MAX_WIRE_RESPONSE_BYTES:
        raise LocateError("AI_OUTPUT_INVALID", "Locate output exceeds the private JSON transport bound")
    return locations


def decode_image(encoded: str):
    from PIL import Image, ImageOps

    try:
        body = base64.b64decode(encoded, validate=True)
        if not body or len(body) > MAX_IMAGE_BYTES:
            raise LocateError("AI_INPUT_INVALID", "Locate image is empty or exceeds the image bound")
        image = Image.open(io.BytesIO(body))
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise LocateError("AI_INPUT_INVALID", "Locate image exceeds the pixel bound")
        if getattr(image, "n_frames", 1) != 1:
            raise LocateError("AI_INPUT_INVALID", "Locate accepts only static images")
        image.load()
        return ImageOps.exif_transpose(image).convert("RGB")
    except LocateError:
        raise
    except Exception as error:
        raise LocateError("AI_INPUT_INVALID", "Locate image cannot be decoded") from error


def locate_prompt(query: str, geometry: str) -> str:
    if not isinstance(query, str) or not query.strip() or len(query.encode("utf-8")) > MAX_QUERY_BYTES:
        raise LocateError("AI_INPUT_INVALID", "Locate query is empty or exceeds the text bound")
    if geometry == "POINT":
        return f"Point to: {query.strip()}."
    if geometry == "BOX":
        return f"Locate all the instances that match the following description: {query.strip()}."
    raise LocateError("AI_INPUT_INVALID", "Locate geometry must be BOX or POINT")


class TransformersLocator:
    def __init__(self, model_dir: pathlib.Path):
        import torch
        from transformers import AutoTokenizer
        from locateanything_loader.configuration_locateanything import LocateAnythingConfig
        from locateanything_loader.image_processing_locateanything import LocateAnythingImageProcessor
        from locateanything_loader.modeling_locateanything import LocateAnythingForConditionalGeneration
        from locateanything_loader.processing_locateanything import LocateAnythingProcessor

        if not torch.cuda.is_available():
            raise LocateError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Locate requires NVIDIA CUDA on this platform")
        self.torch = torch
        self.tokenizer = AutoTokenizer.from_pretrained(
            model_dir, local_files_only=True, trust_remote_code=False,
        )
        image_processor = LocateAnythingImageProcessor.from_pretrained(
            model_dir, local_files_only=True,
        )
        self.processor = LocateAnythingProcessor(image_processor=image_processor, tokenizer=self.tokenizer)
        config = LocateAnythingConfig.from_pretrained(model_dir, local_files_only=True)
        config._attn_implementation = "sdpa"
        config.text_config._attn_implementation = "sdpa"
        model, loading = LocateAnythingForConditionalGeneration.from_pretrained(
            model_dir, config=config, torch_dtype=torch.bfloat16,
            local_files_only=True, attn_implementation="sdpa", output_loading_info=True,
        )
        if loading.get("missing_keys") or loading.get("mismatched_keys") or loading.get("error_msgs"):
            raise LocateError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Locate weights do not match the captured model contract")
        self.model = model.to("cuda").eval()
        # The upstream nested Qwen implementation may retain its own eager
        # selection despite the top-level Transformers loading argument.
        for module in self.model.modules():
            if hasattr(module, "_attn_implementation"):
                module._attn_implementation = "sdpa"
            if hasattr(module, "config") and hasattr(module.config, "_attn_implementation"):
                module.config._attn_implementation = "sdpa"

    def predict(self, image, prompt: str) -> tuple[str, bool]:
        messages = [{"role": "user", "content": [
            {"type": "image", "image": image}, {"type": "text", "text": prompt},
        ]}]
        text = self.processor.py_apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        inputs = self.processor(text=[text], images=[image], return_tensors="pt").to("cuda")
        with self.torch.inference_mode():
            response = self.model.generate(
                pixel_values=inputs["pixel_values"].to(self.torch.bfloat16),
                input_ids=inputs["input_ids"],
                image_grid_hws=inputs.get("image_grid_hws"),
                tokenizer=self.tokenizer, use_cache=True,
                generation_mode="slow", do_sample=False,
                max_new_tokens=MAX_NEW_TOKENS, verbose=False,
            )
        if not isinstance(response, str):
            raise LocateError("AI_OUTPUT_INVALID", "Locate loader returned an invalid response")
        # In upstream slow/AR mode only im_end terminates normally.
        return response, response.rstrip().endswith("<|im_end|>")


class MLXLocator:
    def __init__(self, model_dir: pathlib.Path):
        # MLX-VLM's checkpoint-local model_file branch does not honor
        # trust_remote_code. Reject it before importing or calling the loader.
        try:
            config = json.loads((model_dir / "config.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise LocateError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Locate model configuration cannot be read") from error
        if not isinstance(config, dict) or "model_file" in config:
            raise LocateError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Locate requires the built-in MLX loader; model_file is not admitted")

        import mlx.core as mx
        from mlx_vlm import load

        if not mx.metal.is_available():
            raise LocateError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Locate requires the Apple GPU on this platform")
        mx.set_default_device(mx.gpu)
        self.model, self.processor = load(str(model_dir), trust_remote_code=False)

    def predict(self, image, prompt: str) -> tuple[str, bool]:
        from mlx_vlm import generate
        from mlx_vlm.prompt_utils import apply_chat_template

        text = apply_chat_template(self.processor, self.model.config, prompt, num_images=1)
        response = generate(
            model=self.model, processor=self.processor, prompt=text, image=[image],
            max_tokens=MAX_NEW_TOKENS, temperature=0.0, verbose=False,
            skip_special_tokens=False,
        )
        return response.text, response.finish_reason == "stop"


class LocateWorker:
    def __init__(self):
        self.locator = None
        self.identity: tuple[str, ...] | None = None

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        geometry = request["geometry"]
        prompt = locate_prompt(request["query"], geometry)
        image = decode_image(request["image_base64"])
        if image.size != (request["width"], request["height"]):
            raise LocateError("AI_INPUT_INVALID", "Locate image does not match its captured dimensions")
        model_dir = pathlib.Path(request["model_dir"])
        if not model_dir.is_absolute() or not model_dir.is_dir():
            raise LocateError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Captured Locate model directory is unavailable")
        identity = (
            str(model_dir), request["model_content_id"],
            request["profile_digest"], request["backend"], PROTOCOL,
        )
        if self.identity != identity:
            # Host normally replaces a Worker for a changed loading identity.
            # Refuse reuse here so no second model is loaded into the old GPU instance.
            if self.identity is not None:
                raise LocateError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Locate Worker loading identity changed")
            started = time.monotonic()
            if request["backend"] == "transformers" and sys.platform == "win32":
                locator = TransformersLocator(model_dir)
            elif request["backend"] == "mlx" and sys.platform == "darwin":
                locator = MLXLocator(model_dir)
            else:
                raise LocateError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Locate backend is unsupported on this host")
            self.locator = locator
            self.identity = identity
            print(f"[vision] loaded backend={request['backend']} seconds={time.monotonic() - started:.3f}", file=sys.stderr, flush=True)
        text, complete = self.locator.predict(image, prompt)
        locations = parse_locations(text, geometry, complete=complete)
        return {
            "image_artifact_id": request["image_artifact_id"],
            "width": image.width, "height": image.height, "locations": locations,
        }

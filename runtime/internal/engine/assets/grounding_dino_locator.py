from __future__ import annotations

# @nimi-authority: rule.nimi.runtime.ai-provider.r127

import math
import pathlib
from typing import Any


class GroundingDinoLocator:
    def __init__(self, model_dir: pathlib.Path):
        import torch
        from transformers import AutoModelForZeroShotObjectDetection, AutoProcessor

        if not torch.cuda.is_available():
            raise ValueError("Grounding DINO requires the selected CUDA host")
        self.torch = torch
        self.processor = AutoProcessor.from_pretrained(
            str(model_dir), local_files_only=True, trust_remote_code=False
        )
        model, loading = AutoModelForZeroShotObjectDetection.from_pretrained(
            str(model_dir), local_files_only=True, trust_remote_code=False,
            use_safetensors=True, output_loading_info=True,
        )
        if loading.get("missing_keys") or loading.get("mismatched_keys") or loading.get("error_msgs"):
            raise ValueError("Grounding DINO weights do not match the captured model contract")
        self.model = model.to("cuda").eval()

    def predict(self, image, query: str) -> list[dict[str, Any]]:
        # The fixed processor requires a lower-case, period-terminated phrase.
        prompt = query.strip().lower().rstrip(" .!?") + "."
        if prompt == ".":
            raise ValueError("Grounding DINO query is empty")
        inputs = self.processor(images=image, text=prompt, return_tensors="pt").to("cuda")
        with self.torch.inference_mode():
            output = self.model(**inputs)
        result = self.processor.post_process_grounded_object_detection(
            output, inputs.input_ids, threshold=0.4, text_threshold=0.3,
            target_sizes=[image.size[::-1]],
        )[0]
        boxes = result["boxes"].tolist()
        labels = result["text_labels"]
        if len(boxes) != len(labels) or len(boxes) > 900:
            raise ValueError("Grounding DINO output count is invalid")
        locations = []
        for box, label in zip(boxes, labels):
            if len(box) != 4 or not all(isinstance(value, float) and math.isfinite(value) for value in box):
                raise ValueError("Grounding DINO output box is invalid")
            x1, y1, x2, y2 = box
            if not (0 <= x1 < x2 <= image.width and 0 <= y1 < y2 <= image.height):
                raise ValueError("Grounding DINO output box is outside the canonical image")
            location: dict[str, Any] = {
                "box": [x1 / image.width, y1 / image.height, x2 / image.width, y2 / image.height]
            }
            if isinstance(label, str) and label.strip():
                location["label"] = label
            locations.append(location)
        return locations

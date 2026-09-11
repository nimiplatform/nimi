from __future__ import annotations

# @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-image-job

import io
import os
from pathlib import Path

PROTOCOL = "nimi-image-face-swap/1"
MAX_IMAGE_BYTES = 32 * 1024 * 1024
MAX_IMAGE_DIMENSION = 4096


class FaceSwapError(ValueError):
    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason


def decode_image(body: bytes):
    import numpy as np
    from PIL import Image, ImageOps

    try:
        if not body or len(body) > MAX_IMAGE_BYTES:
            raise FaceSwapError("AI_INPUT_INVALID", "Image is empty or exceeds 32 MiB")
        image = Image.open(io.BytesIO(body))
        if image.format not in ("JPEG", "PNG") or getattr(image, "n_frames", 1) != 1:
            raise FaceSwapError("AI_INPUT_INVALID", "Face replacement requires a static JPEG or PNG")
        if image.width > MAX_IMAGE_DIMENSION or image.height > MAX_IMAGE_DIMENSION:
            raise FaceSwapError("AI_MEDIA_OPTION_UNSUPPORTED", "Image dimensions exceed the admitted 4096-pixel bound")
        image.load()
        image = ImageOps.exif_transpose(image)
        alpha = image.convert("RGBA").getchannel("A") if "A" in image.getbands() or "transparency" in image.info else None
        return np.asarray(image.convert("RGB"))[:, :, ::-1].copy(), alpha
    except FaceSwapError:
        raise
    except Exception as error:
        raise FaceSwapError("AI_INPUT_INVALID", "Image cannot be decoded") from error


def one_face(detector, image, role: str):
    import numpy as np
    from insightface.app.common import Face

    boxes, landmarks = detector.detect(image, max_num=0)
    if len(boxes) == 0:
        raise FaceSwapError("AI_FACE_" + role + "_MISSING", "No " + role.lower() + " face was detected")
    if len(boxes) != 1:
        raise FaceSwapError("AI_FACE_" + role + "_AMBIGUOUS", "Exactly one " + role.lower() + " face is required")
    if landmarks is None or landmarks.shape != (1, 5, 2) or not np.isfinite(boxes).all() or not np.isfinite(landmarks).all():
        raise FaceSwapError("AI_OUTPUT_INVALID", "Face detector returned invalid geometry")
    return Face(bbox=boxes[0, :4], det_score=boxes[0, 4], kps=landmarks[0])


class FaceSwapWorker:
    """One serial Host owns this worker; only model sessions may remain resident."""

    def __init__(self):
        self._identity = None
        self._models = None

    def _load(self, bindings: dict[str, str]):
        if set(bindings) != {"detector.onnx", "recognizer.onnx", "swapper.onnx"}:
            raise FaceSwapError("AI_LOCAL_EXECUTION_LOAD_FAILED", "The captured model slots are incomplete")
        paths = tuple(bindings[slot] for slot in ("detector.onnx", "recognizer.onnx", "swapper.onnx"))
        if self._identity == paths and self._models is not None:
            return self._models
        self._identity, self._models = None, None
        try:
            os.environ["NO_ALBUMENTATIONS_UPDATE"] = "1"
            import numpy as np
            import onnx
            import onnxruntime as ort
            from insightface.model_zoo.arcface_onnx import ArcFaceONNX
            from insightface.model_zoo.inswapper import INSwapper
            from insightface.model_zoo.retinaface import RetinaFace

            ort.preload_dlls(directory="")

            class CheckedSession(ort.InferenceSession):
                def run(self, output_names, input_feed, run_options=None):
                    if self.graph_enabled:
                        if self.graph_binding is None:
                            self.graph_binding = self.io_binding()
                            self.graph_inputs = {}
                            for name, value in input_feed.items():
                                tensor = ort.OrtValue.ortvalue_from_numpy(np.ascontiguousarray(value), "cuda", 0)
                                self.graph_inputs[name] = tensor
                                self.graph_binding.bind_ortvalue_input(name, tensor)
                            for output in self.get_outputs():
                                self.graph_binding.bind_output(output.name, "cuda")
                        else:
                            for name, value in input_feed.items():
                                tensor = self.graph_inputs[name]
                                if list(value.shape) != tensor.shape() or value.dtype != np.float32:
                                    raise FaceSwapError("AI_INPUT_INVALID", "Face model tensor shape changed")
                                tensor.update_inplace(np.ascontiguousarray(value))
                        self.run_with_iobinding(self.graph_binding, run_options)
                        results = [value.numpy() for value in self.graph_binding.get_outputs()]
                    else:
                        results = super().run(output_names, input_feed, run_options)
                    if not results or any(not np.isfinite(result).all() for result in results):
                        raise FaceSwapError("AI_OUTPUT_INVALID", "Face model returned non-finite output")
                    return results

                def clear_media(self):
                    if self.graph_binding is not None:
                        for value in [*self.graph_inputs.values(), *self.graph_binding.get_outputs()]:
                            value.update_inplace(np.zeros(value.shape(), np.float32))

            sessions = []
            for index, path in enumerate(paths):
                if not Path(path).is_absolute() or not Path(path).is_file():
                    raise FaceSwapError("AI_LOCAL_EXECUTION_LOAD_FAILED", "A captured model file is unavailable")
                model = onnx.load(path, load_external_data=False)
                if any(t.external_data or t.data_location != 0 for t in model.graph.initializer):
                    raise FaceSwapError("AI_LOCAL_EXECUTION_LOAD_FAILED", "External ONNX tensor files are not admitted")
                del model
                options = ort.SessionOptions()
                options.log_severity_level = 3
                graph_enabled = index in (0, 2)
                session = CheckedSession(path, sess_options=options, providers=[("CUDAExecutionProvider", {"enable_cuda_graph": "1"} if graph_enabled else {})])
                session.graph_enabled = graph_enabled
                session.graph_binding = None
                session.disable_fallback()
                if "CUDAExecutionProvider" not in session.get_providers():
                    raise FaceSwapError("AI_LOCAL_EXECUTION_LOAD_FAILED", "The selected CUDA execution provider is unavailable")
                sessions.append(session)
            detector = RetinaFace(model_file=paths[0], session=sessions[0])
            detector.prepare(ctx_id=0, input_size=(640, 640), det_thresh=0.5)
            recognizer = ArcFaceONNX(model_file=paths[1], session=sessions[1])
            swapper = INSwapper(model_file=paths[2], session=sessions[2])
            self._identity, self._models = paths, (detector, recognizer, swapper)
            return self._models
        except FaceSwapError:
            raise
        except Exception as error:
            raise FaceSwapError("AI_LOCAL_EXECUTION_LOAD_FAILED", "The selected face models could not be loaded") from error

    def replace(self, reference_bytes: bytes, target_bytes: bytes, bindings: dict[str, str]):
        from PIL import Image

        target, target_alpha = decode_image(target_bytes)
        try:
            prepared = self.prepare_reference(reference_bytes, bindings)
            output = self.replace_frame(target, prepared)
        finally:
            self.clear_request_state()
        encoded = io.BytesIO()
        output_image = Image.fromarray(output[:, :, ::-1])
        if target_alpha is not None:
            output_image.putalpha(target_alpha)
        output_image.save(encoded, format="PNG")
        return encoded.getvalue(), output.shape[1], output.shape[0]

    def clear_request_state(self):
        if self._models is not None:
            for model in self._models:
                model.session.clear_media()

    def prepare_reference(self, reference_bytes: bytes, bindings: dict[str, str]):
        import numpy as np

        reference, _ = decode_image(reference_bytes)
        detector, recognizer, swapper = self._load(bindings)
        try:
            source = one_face(detector, reference, "REFERENCE")
            embedding = recognizer.get(reference, source)
            if embedding.shape != (512,) or not np.isfinite(embedding).all() or np.linalg.norm(embedding) == 0:
                raise FaceSwapError("AI_OUTPUT_INVALID", "Reference identity encoding is invalid")
            return detector, swapper, source
        except FaceSwapError:
            raise
        except Exception as error:
            raise FaceSwapError("AI_LOCAL_EXECUTION_INFERENCE_FAILED", "Reference analysis failed") from error

    def replace_frame(self, target, prepared):
        import cv2
        import numpy as np

        detector, swapper, source = prepared
        try:
            if target.ndim != 3 or target.shape[2] != 3 or target.dtype != np.uint8:
                raise FaceSwapError("AI_INPUT_INVALID", "Target frame must contain packed color pixels")
            destination = one_face(detector, target, "TARGET")
            # Bound blending to the actual aligned face footprint, including
            # the upstream mask's erosion and blur halo. The full target is
            # still detected on every frame; no old geometry is reused.
            tile, matrix = swapper.get(target, destination, source, paste_back=False)
            if tile.shape != (128, 128, 3) or tile.dtype != np.uint8 or not np.isfinite(matrix).all():
                raise FaceSwapError("AI_OUTPUT_INVALID", "Face replacement tile or alignment is invalid")
            inverse = cv2.invertAffineTransform(matrix)
            size = tile.shape[0]
            corners = cv2.transform(np.array([[[0, 0], [size, 0], [size, size], [0, size]]], np.float32), inverse)[0]
            lower, upper = np.floor(corners.min(axis=0)), np.ceil(corners.max(axis=0))
            margin = max(16, int(max(upper - lower) * 0.15) + 4)
            x0, y0 = np.maximum(lower - margin, 0).astype(int)
            x1, y1 = np.minimum(upper + margin, [target.shape[1], target.shape[0]]).astype(int)
            if x0 >= x1 or y0 >= y1:
                raise FaceSwapError("AI_OUTPUT_INVALID", "Face alignment lies outside the target frame")
            inverse[:, 2] -= [x0, y0]
            shape = (x1 - x0, y1 - y0)
            pixels = cv2.warpAffine(tile, inverse, shape, borderValue=0.0)
            # Preserve INSwapper's eroded and feathered white-mask blend.
            # Its separate difference mask is unused in the final blend.
            mask = cv2.warpAffine(np.full(tile.shape[:2], 255, np.float32), inverse, shape, borderValue=0.0)
            mask[mask > 20] = 255
            rows, columns = np.where(mask == 255)
            if not len(rows):
                raise FaceSwapError("AI_OUTPUT_INVALID", "Face blend mask does not intersect the target")
            mask_size = int(np.sqrt((rows.max() - rows.min()) * (columns.max() - columns.min())))
            erosion = max(mask_size // 10, 10)
            mask = cv2.erode(mask, np.ones((erosion, erosion), np.uint8))
            blur = max(mask_size // 20, 5)
            mask = cv2.GaussianBlur(mask, (2 * blur + 1, 2 * blur + 1), 0)[:, :, None] / 255
            region = (mask * pixels + (1 - mask) * target[y0:y1, x0:x1].astype(np.float32)).astype(np.uint8)
            output = target.copy()
            output[y0:y1, x0:x1] = region
            if not isinstance(output, np.ndarray) or output.shape != target.shape or output.dtype != np.uint8:
                raise FaceSwapError("AI_OUTPUT_INVALID", "Face replacement returned an invalid image")
            return output
        except FaceSwapError:
            raise
        except Exception as error:
            raise FaceSwapError("AI_LOCAL_EXECUTION_INFERENCE_FAILED", "Face replacement inference failed") from error


def probe_environment():
    """Execute a real CUDA operation for managed dependency activation."""
    import importlib.metadata as metadata
    import json
    import platform
    import struct
    import sys
    import sysconfig

    import numpy as np
    import onnx
    import onnxruntime as ort

    ort.preload_dlls(directory="")
    value_info = lambda name: onnx.helper.make_tensor_value_info(name, onnx.TensorProto.FLOAT, [1, 1])
    graph = onnx.helper.make_graph([onnx.helper.make_node("MatMul", ["a", "b"], ["out"])], "cuda-activation", [value_info("a"), value_info("b")], [value_info("out")])
    model = onnx.helper.make_model(graph, opset_imports=[onnx.helper.make_opsetid("", 17)], ir_version=10)
    options = ort.SessionOptions()
    options.add_session_config_entry("session.disable_cpu_ep_fallback", "1")
    session = ort.InferenceSession(model.SerializeToString(), sess_options=options, providers=["CUDAExecutionProvider"])
    session.disable_fallback()
    if "CUDAExecutionProvider" not in session.get_providers():
        raise RuntimeError("CUDA execution is unavailable")
    result = session.run(None, {"a": np.ones((1, 1), np.float32), "b": np.ones((1, 1), np.float32)})[0]
    print(json.dumps({
        "python_version": platform.python_version(), "python_cache_tag": sys.implementation.cache_tag,
        "python_soabi": sysconfig.get_config_var("SOABI") or "", "python_platform": sys.platform,
        "python_machine": platform.machine(), "python_pointer_bits": struct.calcsize("P") * 8,
        "onnxruntime_version": ort.__version__, "cuda_abi": "13", "device": "cuda",
        "allocation": float(result[0, 0]), "installed_distributions": sorted({f"{d.metadata['Name']}=={d.version}" for d in metadata.distributions() if d.metadata.get("Name")}),
    }))

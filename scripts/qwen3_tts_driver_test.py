from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import tempfile
import types
import unittest
from unittest import mock


def load_module():
    module_path = pathlib.Path(__file__).with_name("qwen3-tts-driver.py")
    spec = importlib.util.spec_from_file_location("qwen3_tts_driver_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


QWEN3_TTS_DRIVER = load_module()


class FakeTTSModel:
    def __init__(self) -> None:
        self.custom_voice_calls = []

    def get_supported_speakers(self):
        return ["Ryan", "Serena"]

    def generate_custom_voice(self, **kwargs):
        self.custom_voice_calls.append(kwargs)
        return [[0.1, 0.2]], 24000

    def generate_voice_design(self, **kwargs):
        return [[0.1, 0.2]], 24000

    def generate_voice_clone(self, **kwargs):
        return [[0.1, 0.2]], 24000


class Qwen3TTSDriverTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_modules = dict(sys.modules)
        sys.modules["qwen_tts"] = types.ModuleType("qwen_tts")
        sys.modules["soundfile"] = types.ModuleType("soundfile")
        huggingface_hub = types.ModuleType("huggingface_hub")
        huggingface_hub.snapshot_download = lambda *args, **kwargs: "/tmp/mock-qwen3-tts-model"
        sys.modules["huggingface_hub"] = huggingface_hub

    def tearDown(self) -> None:
        sys.modules.clear()
        sys.modules.update(self._old_modules)
        QWEN3_TTS_DRIVER._MODEL_CACHE.clear()
        QWEN3_TTS_DRIVER._MODEL_PATH_CACHE.clear()

    def test_voice_design_handle_roundtrip(self) -> None:
        response = QWEN3_TTS_DRIVER.build_design_handle(
            {
                "operation": "voice.design",
                "target_model_id": "speech/qwen3tts-design",
                "input": {"instruction_text": "Bright and cheerful", "preferred_name": "qwen-design"},
            }
        )
        kind, payload = QWEN3_TTS_DRIVER.decode_voice_handle(response["voice_id"])
        self.assertEqual(kind, "design")
        self.assertEqual(payload["backend"], "qwen_tts")
        self.assertEqual(payload["instruction_text"], "Bright and cheerful")

    def test_driver_preflight_reports_support(self) -> None:
        with mock.patch.object(QWEN3_TTS_DRIVER, "ensure_qwen_tts_importable", return_value=None):
            response = QWEN3_TTS_DRIVER.handle_request(
                {"operation": "driver.preflight"},
                "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
            )
        self.assertEqual(response["driver_family"], "qwen3_tts")
        self.assertEqual(response["driver_backend"], "qwen_tts")
        self.assertEqual(response["model_ref"], "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice")
        self.assertIn("audio.synthesize", response["supports"])

    def test_audio_synthesize_uses_custom_voice_path(self) -> None:
        model = FakeTTSModel()
        with mock.patch.object(QWEN3_TTS_DRIVER, "load_qwen_tts_model", return_value=model), \
            mock.patch.object(QWEN3_TTS_DRIVER, "write_audio_artifact", return_value=("/tmp/out.wav", "audio/wav")):
            response = QWEN3_TTS_DRIVER.handle_request(
                {"operation": "audio.synthesize", "input": "hello", "voice": "Ryan"},
                "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
            )
        self.assertEqual(response["audio_path"], "/tmp/out.wav")
        self.assertEqual(response["content_type"], "audio/wav")
        self.assertEqual(model.custom_voice_calls[0]["speaker"], "ryan")

    def test_audio_synthesize_maps_user_custom_voice_to_default_speaker(self) -> None:
        model = FakeTTSModel()
        with mock.patch.object(QWEN3_TTS_DRIVER, "load_qwen_tts_model", return_value=model), \
            mock.patch.object(QWEN3_TTS_DRIVER, "write_audio_artifact", return_value=("/tmp/out.wav", "audio/wav")):
            response = QWEN3_TTS_DRIVER.handle_request(
                {"operation": "audio.synthesize", "input": "hello", "voice": "user-custom"},
                "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
            )
        self.assertEqual(response["audio_path"], "/tmp/out.wav")
        self.assertEqual(response["content_type"], "audio/wav")
        self.assertEqual(model.custom_voice_calls[0]["speaker"], "ryan")

    def test_materialize_model_ref_downloads_remote_snapshot(self) -> None:
        with mock.patch.object(QWEN3_TTS_DRIVER, "resolve_hf_cache_dir", return_value="/tmp/hf"), \
            mock.patch.object(sys.modules["huggingface_hub"], "snapshot_download", return_value="/tmp/qwen3-tts-model") as snapshot_download:
            resolved = QWEN3_TTS_DRIVER.materialize_model_ref("Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice")
        self.assertEqual(resolved, "/tmp/qwen3-tts-model")
        snapshot_download.assert_called_once_with("Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", cache_dir="/tmp/hf")

    def test_qwen3_tts_device_map_prefers_mps_when_available(self) -> None:
        fake_torch = types.SimpleNamespace(
            cuda=types.SimpleNamespace(is_available=lambda: False),
            backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: True)),
        )
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            self.assertEqual(QWEN3_TTS_DRIVER.qwen3_tts_device_map(), "mps")

    def test_qwen3_tts_dtype_uses_float32_on_mps(self) -> None:
        fake_torch = types.SimpleNamespace(
            cuda=types.SimpleNamespace(is_available=lambda: False),
            backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: True)),
            float16="float16",
            bfloat16="bfloat16",
            float32="float32",
        )
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            self.assertEqual(QWEN3_TTS_DRIVER.qwen3_tts_dtype(), "float32")

    def test_main_synthesize_writes_response_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            request_path = pathlib.Path(temp_dir) / "request.json"
            response_path = pathlib.Path(temp_dir) / "response.json"
            request_path.write_text(
                json.dumps({"operation": "audio.synthesize", "input": "Hello from Qwen3", "voice": "Ryan"}),
                encoding="utf-8",
            )

            previous_argv = sys.argv
            try:
                sys.argv = [
                    "qwen3-tts-driver.py",
                    "--request",
                    str(request_path),
                    "--response",
                    str(response_path),
                ]
                with mock.patch.object(QWEN3_TTS_DRIVER, "load_qwen_tts_model", return_value=FakeTTSModel()), \
                    mock.patch.object(QWEN3_TTS_DRIVER, "write_audio_artifact", return_value=("/tmp/out.wav", "audio/wav")):
                    code = QWEN3_TTS_DRIVER.main()
            finally:
                sys.argv = previous_argv

            self.assertEqual(code, 0)
            payload = json.loads(response_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["audio_path"], "/tmp/out.wav")


if __name__ == "__main__":
    unittest.main()

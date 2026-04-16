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
    module_path = pathlib.Path(__file__).with_name("qwen3-asr-driver.py")
    spec = importlib.util.spec_from_file_location("qwen3_asr_driver_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


QWEN3_ASR_DRIVER = load_module()


class FakeASRResult:
    def __init__(self) -> None:
        self.text = "hello world"
        self.language = "English"
        self.time_stamps = [{"start": 0.0, "end": 0.5, "text": "hello"}]


class FakeASRModel:
    def transcribe(self, **kwargs):
        return [FakeASRResult()]


class Qwen3ASRDriverTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_modules = dict(sys.modules)
        sys.modules["qwen_asr"] = types.ModuleType("qwen_asr")

    def tearDown(self) -> None:
        sys.modules.clear()
        sys.modules.update(self._old_modules)
        QWEN3_ASR_DRIVER._MODEL_CACHE.clear()

    def test_driver_preflight_reports_support(self) -> None:
        with mock.patch.object(QWEN3_ASR_DRIVER, "ensure_qwen_asr_importable", return_value=None):
            response = QWEN3_ASR_DRIVER.handle_request(
                {"operation": "driver.preflight"},
                "Qwen/Qwen3-ASR-0.6B",
            )
        self.assertEqual(response["driver_family"], "qwen3_asr")
        self.assertEqual(response["driver_backend"], "qwen_asr")
        self.assertEqual(response["model_ref"], "Qwen/Qwen3-ASR-0.6B")
        self.assertIn("audio.transcribe", response["supports"])

    def test_audio_transcribe_returns_text(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = pathlib.Path(temp_dir) / "audio.wav"
            audio_path.write_bytes(b"RIFFdemo")
            with mock.patch.object(QWEN3_ASR_DRIVER, "load_qwen3_asr_model", return_value=FakeASRModel()):
                response = QWEN3_ASR_DRIVER.handle_request(
                    {"operation": "audio.transcribe", "audio_path": str(audio_path), "timestamps": True},
                    "Qwen/Qwen3-ASR-0.6B",
                )
        self.assertEqual(response["text"], "hello world")
        self.assertEqual(response["language"], "English")
        self.assertEqual(len(response["time_stamps"]), 1)

    def test_qwen3_asr_device_map_prefers_mps_when_available(self) -> None:
        fake_torch = types.SimpleNamespace(
            cuda=types.SimpleNamespace(is_available=lambda: False),
            backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: True)),
        )
        with mock.patch.dict(sys.modules, {"torch": fake_torch}):
            self.assertEqual(QWEN3_ASR_DRIVER.qwen3_asr_device_map(), "mps")


if __name__ == "__main__":
    unittest.main()

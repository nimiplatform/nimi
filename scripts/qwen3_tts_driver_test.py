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
    def get_supported_speakers(self):
        return ["Ryan", "Serena"]

    def generate_custom_voice(self, **kwargs):
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

    def tearDown(self) -> None:
        sys.modules.clear()
        sys.modules.update(self._old_modules)
        QWEN3_TTS_DRIVER._MODEL_CACHE.clear()

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
        with mock.patch.object(QWEN3_TTS_DRIVER, "load_qwen_tts_model", return_value=FakeTTSModel()), \
            mock.patch.object(QWEN3_TTS_DRIVER, "write_audio_artifact", return_value=("/tmp/out.wav", "audio/wav")):
            response = QWEN3_TTS_DRIVER.handle_request(
                {"operation": "audio.synthesize", "input": "hello", "voice": "Ryan"},
                "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
            )
        self.assertEqual(response["audio_path"], "/tmp/out.wav")
        self.assertEqual(response["content_type"], "audio/wav")

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

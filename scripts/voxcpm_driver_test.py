from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import tempfile
import unittest


def load_module():
    module_path = pathlib.Path(__file__).with_name("voxcpm-driver.py")
    spec = importlib.util.spec_from_file_location("voxcpm_driver_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


VOXCPM_DRIVER = load_module()


class VoxCPMDriverTests(unittest.TestCase):
    def test_voice_design_handle_roundtrip(self) -> None:
        response = VOXCPM_DRIVER.build_design_handle(
            {
                "operation": "voice.design",
                "target_model_id": "speech/voxcpm2",
                "input": {
                    "instruction_text": "Warm, calm narrator",
                    "preview_text": "hello world",
                    "language": "en",
                    "preferred_name": "demo-design",
                },
            }
        )
        voice_id = response["voice_id"]
        kind, payload = VOXCPM_DRIVER.decode_voice_handle(voice_id)
        self.assertEqual(kind, "design")
        self.assertEqual(payload["instruction_text"], "Warm, calm narrator")
        self.assertEqual(payload["target_model_id"], "speech/voxcpm2")

    def test_voice_clone_handle_roundtrip(self) -> None:
        response = VOXCPM_DRIVER.build_clone_handle(
            {
                "operation": "voice.clone",
                "target_model_id": "speech/voxcpm2",
                "input": {
                    "reference_audio_base64": "AQI=",
                    "reference_audio_mime": "audio/wav",
                    "preferred_name": "demo-clone",
                    "text": "reference transcript",
                    "language_hints": ["en"],
                },
            }
        )
        voice_id = response["voice_id"]
        kind, payload = VOXCPM_DRIVER.decode_voice_handle(voice_id)
        self.assertEqual(kind, "clone")
        self.assertEqual(payload["reference_audio_base64"], "AQI=")
        self.assertEqual(payload["text"], "reference transcript")

    def test_main_voice_design_writes_response_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            request_path = pathlib.Path(temp_dir) / "request.json"
            response_path = pathlib.Path(temp_dir) / "response.json"
            request_path.write_text(
                json.dumps(
                    {
                        "operation": "voice.design",
                        "target_model_id": "speech/voxcpm2",
                        "input": {"instruction_text": "Soft voice"},
                    }
                ),
                encoding="utf-8",
            )
            previous_argv = sys.argv
            try:
                sys.argv = [
                    "voxcpm-driver.py",
                    "--request",
                    str(request_path),
                    "--response",
                    str(response_path),
                ]
                code = VOXCPM_DRIVER.main()
            finally:
                sys.argv = previous_argv
            self.assertEqual(code, 0)
            payload = json.loads(response_path.read_text(encoding="utf-8"))
            self.assertTrue(payload["voice_id"].startswith("voxcpm:design:"))


if __name__ == "__main__":
    unittest.main()

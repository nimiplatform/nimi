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
    module_path = pathlib.Path(__file__).with_name("voxcpm-mlx-driver.py")
    spec = importlib.util.spec_from_file_location("voxcpm_mlx_driver_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


VOXCPM_MLX_DRIVER = load_module()


class VoxCPMMLXDriverTests(unittest.TestCase):
    def setUp(self) -> None:
        self._old_modules = dict(sys.modules)
        sys.modules["mlx_audio"] = types.ModuleType("mlx_audio")

    def tearDown(self) -> None:
        sys.modules.clear()
        sys.modules.update(self._old_modules)

    def test_voice_design_handle_roundtrip(self) -> None:
        response = VOXCPM_MLX_DRIVER.build_design_handle(
            {
                "operation": "voice.design",
                "target_model_id": "speech/voxcpm2",
                "input": {"instruction_text": "Bright and cheerful", "preferred_name": "mlx-design"},
            }
        )
        kind, payload = VOXCPM_MLX_DRIVER.decode_voice_handle(response["voice_id"])
        self.assertEqual(kind, "design")
        self.assertEqual(payload["backend"], "mlx")
        self.assertEqual(payload["instruction_text"], "Bright and cheerful")

    def test_build_mlx_generate_command_for_clone(self) -> None:
        output_dir = tempfile.mkdtemp(prefix="nimi-mlx-test-")
        command, temp_dirs = VOXCPM_MLX_DRIVER.build_mlx_generate_command(
            "mlx-community/VoxCPM2-4bit",
            "hello world",
            VOXCPM_MLX_DRIVER.encode_voice_handle(
                VOXCPM_MLX_DRIVER.VOICE_CLONE_PREFIX,
                {
                    "reference_audio_base64": "AQI=",
                    "text": "reference transcript",
                },
            ),
            output_dir,
        )
        try:
            self.assertIn("-m", command)
            self.assertIn("mlx_audio.tts.generate", command)
            self.assertIn("--ref_audio", command)
            self.assertIn("--ref_text", command)
        finally:
            for temp_dir in temp_dirs:
                temp_dir.cleanup()

    def test_driver_preflight_reports_support(self) -> None:
        with mock.patch.object(VOXCPM_MLX_DRIVER, "load_mlx_tts_model", return_value=None):
            response = VOXCPM_MLX_DRIVER.handle_request(
                {"operation": "driver.preflight"},
                "mlx-community/VoxCPM2-4bit",
            )
        self.assertEqual(response["driver_family"], "voxcpm")
        self.assertEqual(response["driver_backend"], "mlx")
        self.assertEqual(response["model_ref"], "mlx-community/VoxCPM2-4bit")
        self.assertIn("audio.synthesize", response["supports"])

    def test_main_synthesize_writes_response_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            request_path = pathlib.Path(temp_dir) / "request.json"
            response_path = pathlib.Path(temp_dir) / "response.json"
            request_path.write_text(
                json.dumps({"operation": "audio.synthesize", "input": "Hello from MLX", "voice": ""}),
                encoding="utf-8",
            )

            def fake_run(command, **kwargs):
                output_dir = pathlib.Path(command[command.index("--output_path") + 1])
                output_dir.mkdir(parents=True, exist_ok=True)
                (output_dir / "out.wav").write_bytes(b"RIFFdemo")
                return types.SimpleNamespace(returncode=0, stdout="", stderr="")

            previous_argv = sys.argv
            try:
                sys.argv = [
                    "voxcpm-mlx-driver.py",
                    "--request",
                    str(request_path),
                    "--response",
                    str(response_path),
                ]
                with mock.patch.object(VOXCPM_MLX_DRIVER.subprocess, "run", side_effect=fake_run):
                    code = VOXCPM_MLX_DRIVER.main()
            finally:
                sys.argv = previous_argv

            self.assertEqual(code, 0)
            payload = json.loads(response_path.read_text(encoding="utf-8"))
            self.assertTrue(str(payload["audio_path"]).endswith(".wav"))


if __name__ == "__main__":
    unittest.main()

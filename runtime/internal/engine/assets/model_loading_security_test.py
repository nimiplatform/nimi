import json
import pathlib
import tempfile
import unittest

from model_loading_security import validate_model_directory


class ManagedModelCodeTests(unittest.TestCase):
    def test_speech_loaders_reject_code_before_optional_package_loading(self):
        from qwen3_tts_driver import load_qwen_tts_model
        from qwen3_asr_driver import load_qwen3_asr_model

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "custom_generate").mkdir()
            for load in (lambda: load_qwen_tts_model(str(root)),
                         lambda: load_qwen3_asr_model(str(root), False)):
                with self.subTest(loader=load), self.assertRaisesRegex(ValueError, "custom generation code"):
                    load()

    def test_local_generation_code_is_rejected_without_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            marker = root / "executed.txt"
            code = root / "speech_tokenizer" / "custom_generate" / "generate.py"
            code.parent.mkdir(parents=True)
            code.write_text(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "custom generation code"):
                validate_model_directory(root)
            self.assertFalse(marker.exists())

    def test_nested_serialized_kernel_selectors_are_rejected(self):
        for selector in ("attacker/kernel", "kernels-community/flash-attn", {"decoder": "attacker/kernel"}):
            with self.subTest(selector=selector), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                (root / "config.json").write_text(json.dumps({
                    "text_config": {"_attn_implementation_internal": selector},
                }), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "external attention code"):
                    validate_model_directory(root)

    def test_expert_and_generation_hooks_are_rejected(self):
        for key in ("_experts_implementation_internal", "experts_implementation", "custom_generate", "trust_remote_code"):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                (root / "config.json").write_text(json.dumps({key: "attacker/kernel"}), encoding="utf-8")
                with self.assertRaises(ValueError):
                    validate_model_directory(root)

    def test_windows_case_variant_cannot_hide_configuration_hooks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "CONFIG.JSON").write_text(json.dumps({
                "_attn_implementation_internal": "attacker/kernel",
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "external attention code"):
                validate_model_directory(root)

    def test_builtin_attention_is_preserved_without_rewriting_model_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            path = root / "config.json"
            original = json.dumps({
                "_attn_implementation": "magi",
                "text_config": {"_attn_implementation_internal": {"decoder": "sdpa"}},
            }).encode()
            path.write_bytes(original)
            validate_model_directory(root)
            self.assertEqual(path.read_bytes(), original)


if __name__ == "__main__":
    unittest.main()

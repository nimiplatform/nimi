import pathlib
import sys
import tempfile
import types
import unittest
from unittest import mock

import faster_whisper_driver as driver


class FasterWhisperDriverTests(unittest.TestCase):
    def test_vad_miss_does_not_discard_recognizable_audio(self):
        audio = [0.1] * 16000
        speech = []
        segment = types.SimpleNamespace(text="Quiet robot speech.", words=[
            types.SimpleNamespace(word="Quiet", start=0.1, end=0.4),
            types.SimpleNamespace(word=" robot", start=0.4, end=0.7),
            types.SimpleNamespace(word=" speech.", start=0.7, end=0.9),
        ])
        decoded = [segment]
        calls = []
        def transcribe(received, **options):
            self.assertIs(received, audio)
            self.assertNotIn("clip_timestamps", options)
            self.assertFalse(options["vad_filter"])
            calls.append(received)
            return iter(decoded), types.SimpleNamespace(language="en")
        modules = {
            "numpy": types.SimpleNamespace(isfinite=lambda _: types.SimpleNamespace(all=lambda: True)),
            "torch": types.SimpleNamespace(from_numpy=lambda value: value),
            "faster_whisper": types.ModuleType("faster_whisper"),
            "faster_whisper.audio": types.SimpleNamespace(decode_audio=lambda *_args, **_kwargs: audio),
            "faster_whisper.tokenizer": types.SimpleNamespace(_LANGUAGE_CODES=("en",)),
            "silero_vad": types.SimpleNamespace(get_speech_timestamps=lambda *_args, **_kwargs: speech),
        }
        with tempfile.TemporaryDirectory() as directory, mock.patch.dict(sys.modules, modules), mock.patch.object(driver, "load_models", return_value=(types.SimpleNamespace(transcribe=transcribe), None, None)):
            root = pathlib.Path(directory)
            names = ["model.bin", "config.json", "tokenizer.json", "preprocessor_config.json"]
            for name in [*names, "vad.onnx", "audio.wav"]:
                (root / name).write_bytes(b"boundary fixture, not model inference")
            request = {"operation": "audio.transcribe", "bundle_dir": str(root), "entry_path": str(root / "model.bin"), "declared_files": names,
                       "vad": {"bundle_dir": str(root), "entry_path": str(root / "vad.onnx"), "declared_files": ["vad.onnx"]},
                       "audio_path": str(root / "audio.wav"), "language": "en", "timestamps": True}
            result = driver.handle_request(request)
            self.assertEqual(result["text"], "Quiet robot speech.")
            self.assertEqual(result["language"], "")
            self.assertEqual(len(calls), 1)
            decoded.clear()
            self.assertEqual(driver.handle_request(request), {"text": "", "no_speech": True})
            speech.append({"start": 0, "end": 16000})
            with self.assertRaisesRegex(RuntimeError, "empty text after detected speech"):
                driver.handle_request(request)

    def test_word_output_preserves_real_zero_times_and_punctuation(self):
        segment = types.SimpleNamespace(text="Of course!", words=[
            types.SimpleNamespace(word="Of", start=0.2, end=0.4),
            types.SimpleNamespace(word=" course!", start=0.4, end=0.4),
        ])
        text, words = driver.transcription_words([segment], 1)
        self.assertEqual(text, "Of course!")
        self.assertEqual(words[-1], {"text": "course!", "start_seconds": 0.4, "end_seconds": 0.4})
        for start, end in [(0.4, 0.3), (0.1, 0.3), (0.4, 1.1), (float("nan"), 0.5)]:
            segment.words[-1].start, segment.words[-1].end = start, end
            with self.subTest(start=start, end=end), self.assertRaisesRegex(RuntimeError, "invalid source word"):
                driver.transcription_words([segment], 1)

    def test_detected_speech_with_empty_recognition_is_not_no_speech(self):
        with self.assertRaisesRegex(RuntimeError, "empty text after detected speech"):
            driver.transcription_words([], 1)
        with self.assertRaisesRegex(RuntimeError, "without word alignment"):
            driver.transcription_words([types.SimpleNamespace(text="hello", words=[])], 1)

    def test_model_entry_must_belong_to_the_captured_declaration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "model.bin").write_bytes(b"file fixture, no inference")
            request = {"bundle_dir": str(root), "entry_path": str(root / "model.bin"), "declared_files": ["model.bin"]}
            self.assertEqual(driver.captured_bundle(request), (str(root), str(root / "model.bin")))
            (root / "other.bin").write_bytes(b"unbound")
            request["entry_path"] = str(root / "other.bin")
            with self.assertRaisesRegex(RuntimeError, "entry is not declared"):
                driver.captured_bundle(request)


if __name__ == "__main__":
    unittest.main()

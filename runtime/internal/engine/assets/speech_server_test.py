from __future__ import annotations

import asyncio
import importlib.util
import base64
import json
import os
import pathlib
import sys
import tempfile
import textwrap
import threading
import time
import types
import unittest
from unittest import mock


def install_fastapi_stubs() -> None:
    fastapi = types.ModuleType("fastapi")
    responses = types.ModuleType("fastapi.responses")
    starlette = types.ModuleType("starlette")
    starlette_background = types.ModuleType("starlette.background")
    starlette_concurrency = types.ModuleType("starlette.concurrency")
    uvicorn = types.ModuleType("uvicorn")

    class FastAPI:
        def __init__(self) -> None:
            self.routes = []

        def get(self, path: str):
            def decorator(fn):
                self.routes.append(("GET", path, fn))
                return fn

            return decorator

        def post(self, path: str):
            def decorator(fn):
                self.routes.append(("POST", path, fn))
                return fn

            return decorator

    class HTTPException(Exception):
        def __init__(self, status_code: int, detail):
            super().__init__(str(detail))
            self.status_code = status_code
            self.detail = detail

    class UploadFile:
        pass

    class Request:
        pass

    class JSONResponse:
        def __init__(self, status_code: int = 200, content=None):
            self.status_code = status_code
            self.content = content

    class StreamingResponse:
        def __init__(self, content, media_type: str | None = None, headers=None, background=None):
            self.body_iterator = content
            self.media_type = media_type
            self.headers = headers or {}
            self.background = background

    class BackgroundTask:
        def __init__(self, fn, *args, **kwargs):
            self.fn = fn
            self.args = args
            self.kwargs = kwargs

    def File(default=None):
        return default

    def Form(default=None):
        return default

    def run(*_args, **_kwargs):
        return None

    async def run_in_threadpool(fn, *args, **kwargs):
        return await asyncio.to_thread(fn, *args, **kwargs)

    fastapi.FastAPI = FastAPI
    fastapi.File = File
    fastapi.Form = Form
    fastapi.HTTPException = HTTPException
    fastapi.Request = Request
    fastapi.UploadFile = UploadFile
    responses.JSONResponse = JSONResponse
    responses.StreamingResponse = StreamingResponse
    starlette_background.BackgroundTask = BackgroundTask
    starlette_concurrency.run_in_threadpool = run_in_threadpool
    uvicorn.run = run

    sys.modules["fastapi"] = fastapi
    sys.modules["fastapi.responses"] = responses
    sys.modules["starlette"] = starlette
    sys.modules["starlette.background"] = starlette_background
    sys.modules["starlette.concurrency"] = starlette_concurrency
    sys.modules["uvicorn"] = uvicorn


def load_speech_server_module():
    install_fastapi_stubs()
    module_path = pathlib.Path(__file__).with_name("speech_server.py")
    assets_dir = str(module_path.parent)
    if assets_dir not in sys.path:
        sys.path.insert(0, assets_dir)
    spec = importlib.util.spec_from_file_location("speech_server_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


SPEECH_SERVER = load_speech_server_module()


def load_qwen3_tts_driver_module():
    module_path = pathlib.Path(__file__).with_name("qwen3_tts_driver.py")
    spec = importlib.util.spec_from_file_location("qwen3_tts_driver_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


QWEN3_TTS_DRIVER = load_qwen3_tts_driver_module()


def load_qwen3_asr_transformers_driver_module():
    module_path = pathlib.Path(__file__).with_name("qwen3_asr_transformers_driver.py")
    spec = importlib.util.spec_from_file_location("qwen3_asr_transformers_driver_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


QWEN3_ASR_TRANSFORMERS_DRIVER = load_qwen3_asr_transformers_driver_module()


class FakeSequenceTensor:
    def __init__(self, rows) -> None:
        self.rows = rows

    def detach(self):
        return self

    def cpu(self):
        return self

    def tolist(self):
        return self.rows


class FakeQwen3TTSTalker:
    def __init__(self, owner) -> None:
        self.owner = owner

    def generate(self, **kwargs):
        generation_kind = self.owner.active_talker_generation_kind
        if generation_kind == "custom":
            self.owner.custom_talker_calls.append(kwargs)
            generation_error = self.owner.custom_talker_error
            hits_ceiling = self.owner.custom_hits_ceiling
            ceiling_row = self.owner.custom_ceiling_row
            eos_at_limit = self.owner.custom_eos_at_limit
        else:
            self.owner.design_talker_calls.append(kwargs)
            generation_error = self.owner.design_talker_error
            hits_ceiling = self.owner.design_hits_ceiling
            ceiling_row = self.owner.design_ceiling_row
            eos_at_limit = self.owner.design_eos_at_limit
        if generation_error is not None:
            raise generation_error
        token_limit = int(kwargs["max_new_tokens"])
        eos_token_id = int(kwargs["eos_token_id"])
        rows = []
        for index in range(int(kwargs["batch_size"])):
            if hits_ceiling or ceiling_row == index:
                rows.append([7] * token_limit)
            elif eos_at_limit:
                rows.append(([7] * (token_limit - 1)) + [eos_token_id])
            else:
                rows.append([7, eos_token_id])
        return types.SimpleNamespace(sequences=FakeSequenceTensor(rows))


class FakeQwen3TTSModel:
    def __init__(self) -> None:
        self.custom_voice_calls = []
        self.custom_talker_calls = []
        self.custom_hits_ceiling = False
        self.custom_ceiling_row = None
        self.custom_eos_at_limit = False
        self.custom_talker_error = None
        self.custom_exposes_talker_completion = True
        self.design_voice_calls = []
        self.clone_voice_calls = []
        self.design_talker_calls = []
        self.design_hits_ceiling = False
        self.design_ceiling_row = None
        self.design_eos_at_limit = False
        self.design_talker_error = None
        self.design_eos_token_id = 99
        self.active_talker_generation_kind = ""
        self.model = types.SimpleNamespace(
            config=types.SimpleNamespace(
                talker_config=types.SimpleNamespace(codec_eos_token_id=self.design_eos_token_id),
            ),
        )
        self.model.talker = FakeQwen3TTSTalker(self)

    def get_supported_speakers(self):
        return ["Serena", "Ryan"]

    def generate_custom_voice(self, **kwargs):
        self.custom_voice_calls.append(kwargs)
        texts = kwargs["text"] if isinstance(kwargs["text"], list) else [kwargs["text"]]
        if self.custom_exposes_talker_completion:
            self.active_talker_generation_kind = "custom"
            try:
                self.model.talker.generate(
                    batch_size=len(texts),
                    eos_token_id=self.design_eos_token_id,
                    max_new_tokens=kwargs["max_new_tokens"],
                )
            finally:
                self.active_talker_generation_kind = ""
        return [[0.1, 0.2] for _ in texts], 24000

    def generate_voice_design(self, **kwargs):
        self.design_voice_calls.append(kwargs)
        texts = kwargs["text"] if isinstance(kwargs["text"], list) else [kwargs["text"]]
        self.active_talker_generation_kind = "design"
        try:
            self.model.talker.generate(
                batch_size=len(texts),
                eos_token_id=self.design_eos_token_id,
                max_new_tokens=kwargs["max_new_tokens"],
            )
        finally:
            self.active_talker_generation_kind = ""
        return [[0.3, 0.4] for _ in texts], 24000

    def generate_voice_clone(self, **kwargs):
        self.clone_voice_calls.append(kwargs)
        texts = kwargs["text"] if isinstance(kwargs["text"], list) else [kwargs["text"]]
        self.active_talker_generation_kind = "design"
        try:
            self.model.talker.generate(
                batch_size=len(texts),
                eos_token_id=self.design_eos_token_id,
                max_new_tokens=kwargs["max_new_tokens"],
            )
        finally:
            self.active_talker_generation_kind = ""
        return [[0.5, 0.6] for _ in texts], 24000


def write_manifest(
    models_root: pathlib.Path,
    logical_model_id: str,
    asset_id: str,
    capabilities: list[str],
    files: list[str],
    payloads: dict[str, bytes],
    entry: str,
    extras: dict[str, object] | None = None,
) -> pathlib.Path:
    manifest_dir = models_root / "resolved" / pathlib.Path(logical_model_id)
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = manifest_dir / "asset.manifest.json"
    manifest_payload = {
        "asset_id": asset_id,
        "engine": "speech",
        "entry": entry,
        "files": files,
        "capabilities": capabilities,
    }
    if extras:
        manifest_payload.update(extras)
    manifest_path.write_text(json.dumps(manifest_payload), encoding="utf-8")
    for name, content in payloads.items():
        target = manifest_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return manifest_path


def write_driver_script(path: pathlib.Path, body: str) -> str:
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)
    return f"{sys.executable} {path}"


def restore_env(name: str, old_value: str | None) -> None:
    if old_value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = old_value
class SpeechServerTests(unittest.TestCase):
    def setUp(self) -> None:
        speech_server_runtime = sys.modules["speech_server_runtime"]
        self._old_driver_work_root = os.environ.get(speech_server_runtime.DRIVER_WORK_ROOT_ENV)
        self._driver_work_root = tempfile.TemporaryDirectory(prefix="nimi-speech-test-work-")
        os.environ[speech_server_runtime.DRIVER_WORK_ROOT_ENV] = self._driver_work_root.name

    def tearDown(self) -> None:
        speech_server_runtime = sys.modules["speech_server_runtime"]
        restore_env(speech_server_runtime.DRIVER_WORK_ROOT_ENV, self._old_driver_work_root)
        self._driver_work_root.cleanup()
        QWEN3_TTS_DRIVER._MODEL_CACHE.clear()
        QWEN3_TTS_DRIVER._MODEL_PATH_CACHE.clear()
        QWEN3_ASR_TRANSFORMERS_DRIVER._MODEL_CACHE.clear()

    def test_transformers_native_driver_uses_official_transcription_api(self) -> None:
        class FakeTensor:
            shape = (1, 3)

            def __getitem__(self, _key):
                return self

        class FakeInputs(dict):
            def to(self, device, dtype):
                self["moved_to"] = (device, dtype)
                return self

        class FakeProcessor:
            def __init__(self) -> None:
                self.calls = []

            def apply_transcription_request(self, **kwargs):
                self.calls.append(kwargs)
                return FakeInputs(input_ids=FakeTensor())

            def decode(self, _value, return_format):
                self.return_format = return_format
                return ["hello from transformers"]

        class FakeModel:
            device = "cpu"
            dtype = "float32"

            def generate(self, **kwargs):
                self.kwargs = kwargs
                return FakeTensor()

        processor = FakeProcessor()
        model = FakeModel()
        original_load_model = QWEN3_ASR_TRANSFORMERS_DRIVER.load_model
        QWEN3_ASR_TRANSFORMERS_DRIVER.load_model = lambda _model_ref: (processor, model)
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                audio_path = pathlib.Path(temp_dir) / "speech.wav"
                audio_path.write_bytes(b"RIFFdemo")
                result = QWEN3_ASR_TRANSFORMERS_DRIVER.handle_transcribe(
                    {
                        "audio_path": str(audio_path),
                        "model_ref": "Qwen/Qwen3-ASR-0.6B-hf",
                        "language": "en",
                    },
                    QWEN3_ASR_TRANSFORMERS_DRIVER.DEFAULT_ASR_MODEL,
                )
        finally:
            QWEN3_ASR_TRANSFORMERS_DRIVER.load_model = original_load_model

        self.assertEqual(result, {"text": "hello from transformers"})
        self.assertEqual(processor.calls, [{"audio": str(audio_path), "language": "English"}])
        self.assertEqual(processor.return_format, "transcription_only")
        self.assertEqual(model.kwargs["max_new_tokens"], 256)

    def test_driver_work_root_is_required_and_request_exchange_is_cleaned(self) -> None:
        speech_server_runtime = sys.modules["speech_server_runtime"]
        work_root = pathlib.Path(self._driver_work_root.name)
        driver_path = work_root / "echo_driver.py"
        write_driver_script(
            driver_path,
            textwrap.dedent(
                """\
                import argparse, json, pathlib
                parser = argparse.ArgumentParser()
                parser.add_argument("--request", required=True)
                parser.add_argument("--response", required=True)
                args = parser.parse_args()
                request = json.loads(pathlib.Path(args.request).read_text(encoding="utf-8"))
                pathlib.Path(args.response).write_text(json.dumps({"echo": request["value"]}), encoding="utf-8")
                """
            ),
        )
        response = speech_server_runtime.run_driver_command(
            [sys.executable, str(driver_path)],
            {"value": "ok"},
        )
        self.assertEqual(response, {"echo": "ok"})
        self.assertEqual(sorted(path.name for path in work_root.iterdir()), ["echo_driver.py"])

        old = os.environ.pop(speech_server_runtime.DRIVER_WORK_ROOT_ENV)
        try:
            with self.assertRaisesRegex(RuntimeError, "work root is not configured"):
                speech_server_runtime.driver_work_root()
        finally:
            os.environ[speech_server_runtime.DRIVER_WORK_ROOT_ENV] = old

    def test_configured_driver_command_preserves_windows_paths(self) -> None:
        speech_server_runtime = sys.modules["speech_server_runtime"]
        old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
        try:
            os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = r'"C:\Program Files\Python\python.exe" "C:\Temp\qwen3_tts_driver.py"'
            self.assertEqual(
                speech_server_runtime.configured_driver_command(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV),
                [r"C:\Program Files\Python\python.exe", r"C:\Temp\qwen3_tts_driver.py"],
            )
        finally:
            restore_env(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, old_tts)

    def test_driver_timeout_cannot_preempt_admitted_local_speech_job(self) -> None:
        runtime = sys.modules["speech_server_runtime"]
        old = os.environ.get(runtime.DRIVER_TIMEOUT_MS_ENV)
        try:
            os.environ.pop(runtime.DRIVER_TIMEOUT_MS_ENV, None)
            self.assertEqual(runtime.driver_timeout_seconds(), 30 * 60)
            os.environ[runtime.DRIVER_TIMEOUT_MS_ENV] = str(45 * 60_000)
            self.assertEqual(runtime.driver_timeout_seconds(), 30 * 60)
            os.environ[runtime.DRIVER_TIMEOUT_MS_ENV] = str(20 * 60_000)
            self.assertEqual(runtime.driver_timeout_seconds(), 20 * 60)
        finally:
            restore_env(runtime.DRIVER_TIMEOUT_MS_ENV, old)

    def test_qwen3_tts_empty_voice_still_fails_without_first_run_probe(self) -> None:
        model = FakeQwen3TTSModel()
        with mock.patch.object(QWEN3_TTS_DRIVER, "load_qwen_tts_model", return_value=model):
            with self.assertRaisesRegex(RuntimeError, "requires an explicit admitted voice_ref"):
                QWEN3_TTS_DRIVER.handle_request(
                    {"operation": "audio.synthesize", "input": "hello"},
                    "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
                )

    def test_qwen3_tts_first_run_probe_uses_model_supported_speaker(self) -> None:
        model = FakeQwen3TTSModel()
        with mock.patch.object(QWEN3_TTS_DRIVER, "load_qwen_tts_model", return_value=model), \
            mock.patch.object(QWEN3_TTS_DRIVER, "write_audio_artifact", return_value=("/tmp/out.wav", "audio/wav")):
            response = QWEN3_TTS_DRIVER.handle_request(
                {
                    "operation": "audio.synthesize",
                    "input": "hello",
                    "extensions": {"nimi_first_run_baseline_probe": True},
                },
                "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
            )
        self.assertEqual(response["audio_path"], "/tmp/out.wav")
        self.assertEqual(model.custom_voice_calls[0]["speaker"], "serena")

    def test_qwen3_tts_default_generation_ceiling_matches_driver_default(self) -> None:
        with mock.patch.dict(os.environ, {"NIMI_RUNTIME_SPEECH_QWEN3_TTS_MAX_NEW_TOKENS": ""}):
            self.assertEqual(QWEN3_TTS_DRIVER.max_new_tokens(), 2048)

    def test_qwen3_tts_reference_audio_uses_runtime_owned_work_root(self) -> None:
        work_root = pathlib.Path(self._driver_work_root.name).resolve()
        self.assertEqual(QWEN3_TTS_DRIVER.driver_work_root(), work_root)

        old = os.environ.pop(QWEN3_TTS_DRIVER.DRIVER_WORK_ROOT_ENV)
        try:
            with self.assertRaisesRegex(RuntimeError, "work root is unavailable"):
                QWEN3_TTS_DRIVER.driver_work_root()
        finally:
            os.environ[QWEN3_TTS_DRIVER.DRIVER_WORK_ROOT_ENV] = old

    def test_qwen3_tts_reference_audio_uses_the_upstream_clone_streaming_mode(self) -> None:
        model = FakeQwen3TTSModel()
        handle_payload = {
            "reference_audio_base64": base64.b64encode(b"RIFFvoice").decode("ascii"),
            "reference_audio_mime": "audio/wav",
            "language_hints": ["en"],
        }
        with mock.patch.object(
            QWEN3_TTS_DRIVER,
            "write_audio_artifact",
            return_value=("/tmp/clone.wav", "audio/wav"),
        ):
            result = QWEN3_TTS_DRIVER.synthesize_with_reference_audio_handle(
                model,
                {"input": "Hello.", "language": "en"},
                handle_payload,
            )
        self.assertEqual(result, ("/tmp/clone.wav", "audio/wav"))
        self.assertFalse(model.clone_voice_calls[0]["non_streaming_mode"])

    def test_qwen3_tts_long_synthesis_uses_bounded_real_audio_batches(self) -> None:
        model = FakeQwen3TTSModel()
        long_text = "A bounded sentence preserves the complete admitted request. " * 80
        first_segments = []
        appended_segments = []

        def capture_audio(wav, _sample_rate):
            first_segments.append(wav)
            return "/tmp/out.wav", "audio/wav"

        def append_audio(path_value, wav, _sample_rate):
            self.assertEqual(path_value, "/tmp/out.wav")
            appended_segments.append(wav)

        with mock.patch.object(QWEN3_TTS_DRIVER, "load_qwen_tts_model", return_value=model), \
            mock.patch.object(QWEN3_TTS_DRIVER, "write_audio_artifact", side_effect=capture_audio), \
            mock.patch.object(QWEN3_TTS_DRIVER, "append_audio_artifact", side_effect=append_audio):
            response = QWEN3_TTS_DRIVER.handle_request(
                {
                    "operation": "audio.synthesize",
                    "input": long_text,
                    "voice": "serena",
                },
                "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
            )

        self.assertEqual(response["audio_path"], "/tmp/out.wav")
        self.assertGreater(len(model.custom_voice_calls), 1)
        chunks = [chunk for call in model.custom_voice_calls for chunk in call["text"]]
        self.assertTrue(all(0 < len(chunk) <= QWEN3_TTS_DRIVER.SYNTHESIS_CHUNK_CHARACTERS for chunk in chunks))
        self.assertTrue(all(len(call["text"]) <= QWEN3_TTS_DRIVER.SYNTHESIS_BATCH_SIZE for call in model.custom_voice_calls))
        self.assertEqual(" ".join(chunks).split(), long_text.split())
        self.assertEqual(len(first_segments), 1)
        self.assertEqual(len(appended_segments), len(chunks) - 1)
        self.assertTrue(all(len(segment) == 2 for segment in first_segments + appended_segments))
        self.assertNotIn("generate", vars(model.model.talker))

    def test_qwen3_tts_custom_voice_fails_when_a_chunk_reaches_generation_ceiling(self) -> None:
        model = FakeQwen3TTSModel()
        model.custom_hits_ceiling = True
        with mock.patch.object(QWEN3_TTS_DRIVER, "write_audio_artifact") as write_audio:
            with self.assertRaisesRegex(RuntimeError, "reached generation ceiling"):
                QWEN3_TTS_DRIVER.synthesize_with_custom_voice(
                    model,
                    {"input": "This custom voice chunk must not be accepted without EOS.", "voice": "serena"},
                )
        write_audio.assert_not_called()
        self.assertNotIn("generate", vars(model.model.talker))

    def test_qwen3_tts_custom_voice_accepts_eos_immediately_before_generation_ceiling(self) -> None:
        model = FakeQwen3TTSModel()
        model.custom_eos_at_limit = True
        with mock.patch.object(
            QWEN3_TTS_DRIVER,
            "write_audio_artifact",
            return_value=("/tmp/out.wav", "audio/wav"),
        ):
            result = QWEN3_TTS_DRIVER.synthesize_with_custom_voice(
                model,
                {"input": "This custom voice chunk completes at its generation limit.", "voice": "serena"},
            )
        self.assertEqual(result, ("/tmp/out.wav", "audio/wav"))
        self.assertNotIn("generate", vars(model.model.talker))

    def test_qwen3_tts_custom_voice_rejects_a_mixed_batch_with_one_ceiling_hit(self) -> None:
        model = FakeQwen3TTSModel()
        model.custom_ceiling_row = 1
        with self.assertRaisesRegex(RuntimeError, "reached generation ceiling"):
            QWEN3_TTS_DRIVER.generate_custom_voice_batch(
                model,
                ["The first chunk reaches EOS.", "The second chunk does not."],
                "English",
                "serena",
                "",
                QWEN3_TTS_DRIVER.max_new_tokens(),
            )
        self.assertNotIn("generate", vars(model.model.talker))

    def test_qwen3_tts_custom_voice_fails_closed_without_talker_completion_state(self) -> None:
        model = FakeQwen3TTSModel()
        model.custom_exposes_talker_completion = False
        with self.assertRaisesRegex(RuntimeError, "did not expose one talker completion state"):
            QWEN3_TTS_DRIVER.generate_custom_voice_batch(
                model,
                ["Completion state is required."],
                "English",
                "serena",
                "",
                QWEN3_TTS_DRIVER.max_new_tokens(),
            )
        self.assertNotIn("generate", vars(model.model.talker))

    def test_qwen3_tts_long_voice_design_reuses_instruction_across_bounded_batches(self) -> None:
        model = FakeQwen3TTSModel()
        long_text = "A designed voice must preserve every bounded sentence. " * 80
        instruction = "Warm, measured, and reassuring."
        first_segments = []
        appended_segments = []

        def capture_audio(wav, _sample_rate):
            first_segments.append(wav)
            return "/tmp/design.wav", "audio/wav"

        def append_audio(path_value, wav, _sample_rate):
            self.assertEqual(path_value, "/tmp/design.wav")
            appended_segments.append(wav)

        with mock.patch.object(QWEN3_TTS_DRIVER, "write_audio_artifact", side_effect=capture_audio), \
            mock.patch.object(QWEN3_TTS_DRIVER, "append_audio_artifact", side_effect=append_audio):
            audio_path, content_type = QWEN3_TTS_DRIVER.synthesize_with_design_handle(
                model,
                {"input": long_text, "language": "en"},
                {"instruction_text": instruction},
            )

        self.assertEqual((audio_path, content_type), ("/tmp/design.wav", "audio/wav"))
        self.assertGreater(len(model.design_voice_calls), 1)
        self.assertTrue(all(isinstance(call["text"], list) for call in model.design_voice_calls))
        chunks = [chunk for call in model.design_voice_calls for chunk in call["text"]]
        self.assertTrue(all(0 < len(chunk) <= QWEN3_TTS_DRIVER.SYNTHESIS_CHUNK_CHARACTERS for chunk in chunks))
        self.assertTrue(all(len(call["text"]) <= QWEN3_TTS_DRIVER.SYNTHESIS_BATCH_SIZE for call in model.design_voice_calls))
        self.assertTrue(all(call["instruct"] == instruction for call in model.design_voice_calls))
        self.assertEqual(" ".join(chunks).split(), long_text.split())
        self.assertEqual(len(first_segments), 1)
        self.assertEqual(len(appended_segments), len(chunks) - 1)
        self.assertNotIn("generate", vars(model.model.talker))

    def test_qwen3_tts_voice_design_fails_when_a_chunk_reaches_generation_ceiling(self) -> None:
        model = FakeQwen3TTSModel()
        model.design_hits_ceiling = True
        with mock.patch.object(QWEN3_TTS_DRIVER, "write_audio_artifact") as write_audio:
            with self.assertRaisesRegex(RuntimeError, "reached generation ceiling"):
                QWEN3_TTS_DRIVER.synthesize_with_design_handle(
                    model,
                    {"input": "This chunk must not be accepted when generation has no EOS."},
                    {"instruction_text": "Calm and clear."},
                )
        write_audio.assert_not_called()
        self.assertNotIn("generate", vars(model.model.talker))

    def test_qwen3_tts_voice_design_accepts_eos_immediately_before_generation_ceiling(self) -> None:
        model = FakeQwen3TTSModel()
        model.design_eos_at_limit = True
        with mock.patch.object(
            QWEN3_TTS_DRIVER,
            "write_audio_artifact",
            return_value=("/tmp/design.wav", "audio/wav"),
        ):
            result = QWEN3_TTS_DRIVER.synthesize_with_design_handle(
                model,
                {"input": "This chunk reaches EOS immediately before its generation limit."},
                {"instruction_text": "Calm and clear."},
            )
        self.assertEqual(result, ("/tmp/design.wav", "audio/wav"))
        self.assertNotIn("generate", vars(model.model.talker))

    def test_qwen3_tts_voice_design_rejects_a_mixed_batch_with_one_ceiling_hit(self) -> None:
        model = FakeQwen3TTSModel()
        model.design_ceiling_row = 1
        with self.assertRaisesRegex(RuntimeError, "reached generation ceiling"):
            QWEN3_TTS_DRIVER.generate_voice_design_batch(
                model,
                ["The first chunk reaches EOS.", "The second chunk does not."],
                "English",
                "Calm and clear.",
                QWEN3_TTS_DRIVER.max_new_tokens(),
            )
        self.assertNotIn("generate", vars(model.model.talker))

    def test_qwen3_tts_voice_design_restores_talker_after_generation_error(self) -> None:
        model = FakeQwen3TTSModel()
        model.design_talker_error = RuntimeError("synthetic talker failure")
        with self.assertRaisesRegex(RuntimeError, "synthetic talker failure"):
            QWEN3_TTS_DRIVER.generate_voice_design_batch(
                model,
                ["This chunk cannot complete."],
                "English",
                "Calm and clear.",
                QWEN3_TTS_DRIVER.max_new_tokens(),
            )
        self.assertNotIn("generate", vars(model.model.talker))

    def test_safe_uploaded_audio_path_uses_generated_basename_for_path_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = SPEECH_SERVER.safe_uploaded_audio_path(temp_dir, "../../secret/input.wav", "audio/wav")
            self.assertEqual(audio_path.parent, pathlib.Path(temp_dir))
            self.assertTrue(audio_path.name.startswith("upload-"))
            self.assertEqual(audio_path.suffix, ".wav")
            self.assertNotIn("secret", audio_path.name)
            self.assertNotIn("..", audio_path.parts)

    def test_safe_uploaded_audio_path_uses_mime_suffix_for_invalid_filename(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            audio_path = SPEECH_SERVER.safe_uploaded_audio_path(temp_dir, "/tmp/audio.bad-extension-name", "audio/mpeg")
            self.assertEqual(audio_path.parent, pathlib.Path(temp_dir))
            self.assertTrue(audio_path.name.startswith("upload-"))
            self.assertEqual(audio_path.suffix, ".mp3")

    def test_driver_command_state_rejects_unresolvable_executable(self) -> None:
        old = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
        try:
            os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = "totally_missing_qwen3_tts_driver --serve"
            command, ready, detail = SPEECH_SERVER.driver_command_state(
                SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV,
                "qwen3_tts",
            )
        finally:
            if old is None:
                os.environ.pop(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, None)
            else:
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = old

        self.assertEqual(command, ["totally_missing_qwen3_tts_driver", "--serve"])
        self.assertFalse(ready)
        self.assertEqual(detail, "qwen3_tts driver executable unresolved")

    def test_build_host_state_discovers_ready_speech_models(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-qwen3",
                "speech/qwen3tts",
                ["audio.synthesize"],
                ["model.safetensors"],
                {
                    "model.safetensors": b"fake-qwen3-tts",
                },
                "model.safetensors",
            )
            asr_files = [
                "model.safetensors",
                "config.json",
                "generation_config.json",
                "preprocessor_config.json",
                "chat_template.json",
                "tokenizer_config.json",
                "vocab.json",
                "merges.txt",
            ]
            write_manifest(
                root,
                "nimi/stt-qwen3-asr",
                "speech/qwen3asr",
                ["audio.transcribe"],
                asr_files,
                {name: f"fake-{name}".encode("utf-8") for name in asr_files},
                "model.safetensors",
                {"artifact_roles": ["stt_model", "tokenizer"]},
            )
            synth_driver = write_driver_script(
                root / "qwen3_tts_driver.py",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import argparse, json, pathlib
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    args = parser.parse_args()
                    request = json.loads(pathlib.Path(args.request).read_text())
                    assert request["driver"] == "qwen3_tts"
                    output = pathlib.Path(args.response).with_name("tts.wav")
                    output.write_bytes(b"RIFFdemo")
                    pathlib.Path(args.response).write_text(json.dumps({"audio_path": str(output), "content_type": "audio/wav"}))
                    """
                ),
            )
            stt_driver = write_driver_script(
                root / "qwen3_asr_driver.py",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import argparse, json, pathlib
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    args = parser.parse_args()
                    request = json.loads(pathlib.Path(args.request).read_text())
                    assert request["driver"] == "qwen3_asr"
                    pathlib.Path(args.response).write_text(json.dumps({"text": "transcribed"}))
                    """
                ),
            )
            old_models_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
            old_stt = os.environ.get(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = synth_driver
                os.environ[SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV] = stt_driver
                state = SPEECH_SERVER.build_host_state()
            finally:
                restore_env(SPEECH_SERVER.MODELS_ROOT_ENV, old_models_root)
                restore_env(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, old_tts)
                if old_stt is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV] = old_stt

            self.assertTrue(state.ready)
            self.assertEqual(len(state.models), 2)
            self.assertEqual(
                {model.model_id for model in state.models},
                {"speech/qwen3tts", "speech/qwen3asr"},
            )
            self.assertTrue(state.qwen3_tts_ready)
            self.assertTrue(state.qwen3_asr_ready)
            drivers = {model.model_id: model.capability_drivers for model in state.models}
            self.assertEqual(drivers["speech/qwen3tts"]["audio.synthesize"], "qwen3_tts")
            self.assertEqual(drivers["speech/qwen3asr"]["audio.transcribe"], "qwen3_asr")

    def test_build_host_state_rejects_incomplete_qwen3_asr_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/stt-qwen3-asr-incomplete",
                "local-import/Qwen3-ASR-1.7B-hf",
                ["audio.transcribe"],
                ["Qwen3-ASR-1.7B-hf.safetensors"],
                {"Qwen3-ASR-1.7B-hf.safetensors": b"incomplete-qwen3-asr"},
                "Qwen3-ASR-1.7B-hf.safetensors",
                {"artifact_roles": ["stt_model"]},
            )
            old_models_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_stt = os.environ.get(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV] = f"{sys.executable} -c pass"
                state = SPEECH_SERVER.build_host_state()
            finally:
                restore_env(SPEECH_SERVER.MODELS_ROOT_ENV, old_models_root)
                restore_env(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV, old_stt)

            self.assertFalse(state.ready)
            self.assertEqual(len(state.models), 1)
            self.assertFalse(state.models[0].ready)
            self.assertIn("qwen3_asr bundle entry must be model.safetensors", state.models[0].detail)
            self.assertIn('managed bundle file "config.json" missing', state.models[0].detail)

    def test_build_host_state_selects_transformers_native_asr_driver_by_role(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            files = [
                "model.safetensors",
                "config.json",
                "generation_config.json",
                "processor_config.json",
                "chat_template.jinja",
                "tokenizer_config.json",
                "tokenizer.json",
            ]
            write_manifest(
                root,
                "nimi/stt-qwen3-asr-transformers",
                "local-import/Qwen3-ASR-0.6B-hf",
                ["audio.transcribe"],
                files,
                {name: f"fake-{name}".encode("utf-8") for name in files},
                "model.safetensors",
                {"artifact_roles": ["stt_transformers_model", "tokenizer"]},
            )
            driver = write_driver_script(root / "qwen3_asr_transformers_driver.py", "print('unused')\n")
            old_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_driver = os.environ.get(SPEECH_SERVER.QWEN3_ASR_TRANSFORMERS_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_ASR_TRANSFORMERS_DRIVER_ENV] = driver
                state = SPEECH_SERVER.build_host_state()
            finally:
                restore_env(SPEECH_SERVER.MODELS_ROOT_ENV, old_root)
                restore_env(SPEECH_SERVER.QWEN3_ASR_TRANSFORMERS_DRIVER_ENV, old_driver)

            self.assertTrue(state.ready)
            self.assertTrue(state.qwen3_asr_transformers_ready)
            self.assertEqual(
                state.models[0].capability_drivers["audio.transcribe"],
                "qwen3_asr_transformers",
            )

    def test_build_host_state_rejects_unresolved_driver_family(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-unsupported-local",
                "speech/unsupported-local-synth",
                ["audio.synthesize"],
                ["model.onnx"],
                {
                    "model.onnx": b"fake-onnx",
                },
                "model.onnx",
            )
            old_models_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
            old_stt = os.environ.get(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = f"{sys.executable} -c pass"
                os.environ[SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV] = f"{sys.executable} -c pass"
                state = SPEECH_SERVER.build_host_state()
            finally:
                restore_env(SPEECH_SERVER.MODELS_ROOT_ENV, old_models_root)
                restore_env(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, old_tts)
                if old_stt is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV] = old_stt

            self.assertFalse(state.ready)
            self.assertEqual(len(state.models), 1)
            self.assertIn("runtime-native driver unresolved", state.models[0].detail)

    def test_build_host_state_rejects_unresolvable_driver_command(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-qwen3",
                "speech/qwen3tts-ready",
                ["audio.synthesize"],
                ["model.safetensors"],
                {
                    "model.safetensors": b"fake-qwen3-tts",
                },
                "model.safetensors",
            )
            old_models_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
            old_stt = os.environ.get(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = "totally_missing_qwen3_tts_driver --serve"
                os.environ[SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV] = f"{sys.executable} -c pass"
                state = SPEECH_SERVER.build_host_state()
            finally:
                if old_models_root is None:
                    os.environ.pop(SPEECH_SERVER.MODELS_ROOT_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = old_models_root
                if old_tts is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = old_tts
                if old_stt is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV] = old_stt

            self.assertFalse(state.ready)
            self.assertFalse(state.qwen3_tts_ready)
            self.assertEqual(state.qwen3_tts_detail, "qwen3_tts driver executable unresolved")
            self.assertIn("qwen3_tts driver executable unresolved", state.models[0].detail)

    def test_build_host_state_requires_explicit_qwen3_tts_workflow_binding(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-qwen3-base",
                "speech/qwen3tts-base",
                ["audio.synthesize", "voice.create"],
                ["model.safetensors"],
                {"model.safetensors": b"fake-qwen3-tts-base"},
                "model.safetensors",
                {
                    "voice_workflow_models": [
                        {
                            "workflow_model_id": "qwen3-local-voice-clone",
                            "workflow_type": "reference_audio",
                            "workflow_family": "qwen3_tts",
                            "target_model_refs": ["speech/qwen3tts-base"],
                        }
                    ],
                    "model_workflow_bindings": [
                        {
                            "workflow_model_id": "qwen3-local-voice-clone",
                            "workflow_family": "qwen3_tts",
                            "target_model_ref": "speech/qwen3tts-base",
                        }
                    ],
                },
            )
            qwen3_tts_driver = write_driver_script(
                root / "qwen3_tts_driver.py",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import argparse, json, pathlib
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    args = parser.parse_args()
                    request = json.loads(pathlib.Path(args.request).read_text())
                    if request["operation"] == "driver.preflight":
                        pathlib.Path(args.response).write_text(json.dumps({"driver_family": "qwen3_tts"}))
                    else:
                        pathlib.Path(args.response).write_text(json.dumps({"voice_id": "voice-local-001"}))
                    """
                ),
            )
            old_models_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = qwen3_tts_driver
                state = SPEECH_SERVER.build_host_state()
            finally:
                if old_models_root is None:
                    os.environ.pop(SPEECH_SERVER.MODELS_ROOT_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = old_models_root
                if old_tts is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = old_tts

            self.assertEqual(len(state.models), 1)
            self.assertEqual(state.models[0].capability_drivers["audio.synthesize"], "qwen3_tts")
            self.assertEqual(state.models[0].capability_drivers["voice.create"], "qwen3_tts")
            self.assertTrue(state.models[0].ready)
            self.assertIn("voice.create", state.models[0].ready_capabilities)

    def test_build_host_state_rejects_qwen3_tts_workflow_without_source_asset_role(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-qwen3-base",
                "speech/qwen3tts-base",
                ["audio.synthesize", "voice.create"],
                ["model.safetensors"],
                {"model.safetensors": b"fake-qwen3-tts-base"},
                "model.safetensors",
            )
            qwen3_tts_driver = write_driver_script(
                root / "qwen3_tts_driver.py",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import argparse, json, pathlib
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    args = parser.parse_args()
                    request = json.loads(pathlib.Path(args.request).read_text())
                    if request["operation"] == "driver.preflight":
                        pathlib.Path(args.response).write_text(json.dumps({"driver_family": "qwen3_tts"}))
                    else:
                        pathlib.Path(args.response).write_text(json.dumps({"voice_id": "voice-local-001"}))
                    """
                ),
            )
            old_models_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = qwen3_tts_driver
                state = SPEECH_SERVER.build_host_state()
            finally:
                if old_models_root is None:
                    os.environ.pop(SPEECH_SERVER.MODELS_ROOT_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = old_models_root
                if old_tts is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = old_tts

            self.assertEqual(len(state.models), 1)
            self.assertFalse(state.models[0].ready)
            self.assertNotIn("voice.create", state.models[0].ready_capabilities)
            self.assertIn("voice.create requires an explicit creation-source asset role", state.models[0].detail)

    def test_build_host_state_admits_voice_create_from_exact_source_asset_role(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-qwen3-base",
                "speech/qwen3tts-base",
                ["audio.synthesize", "voice.create"],
                ["model.safetensors"],
                {"model.safetensors": b"fake-qwen3-tts-base"},
                "model.safetensors",
                {"artifact_roles": ["tts_model", "tts_voice_clone_model"]},
            )
            qwen3_tts_driver = write_driver_script(
                root / "qwen3_tts_driver.py",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import argparse, json, pathlib
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    args = parser.parse_args()
                    request = json.loads(pathlib.Path(args.request).read_text())
                    if request["operation"] == "driver.preflight":
                        pathlib.Path(args.response).write_text(json.dumps({"driver_family": "qwen3_tts"}))
                    else:
                        pathlib.Path(args.response).write_text(json.dumps({"voice_id": "voice-local-001"}))
                    """
                ),
            )
            old_models_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = qwen3_tts_driver
                state = SPEECH_SERVER.build_host_state()
            finally:
                restore_env(SPEECH_SERVER.MODELS_ROOT_ENV, old_models_root)
                restore_env(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, old_tts)

            self.assertTrue(state.models[0].ready)
            self.assertEqual(state.models[0].voice_creation_sources, ["reference_audio"])
            self.assertIn("voice.create", state.models[0].ready_capabilities)

    def test_build_host_state_rejects_qwen3_tts_model_when_preflight_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-qwen3",
                "speech/qwen3tts",
                ["audio.synthesize"],
                ["model.safetensors"],
                {"model.safetensors": b"fake-qwen3-tts"},
                "model.safetensors",
            )
            qwen3_tts_driver = write_driver_script(
                root / "qwen3_tts_driver.py",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import argparse, json, pathlib, sys
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    args = parser.parse_args()
                    request = json.loads(pathlib.Path(args.request).read_text())
                    if request["operation"] == "driver.preflight":
                        sys.stderr.write("model type qwen3-tts not supported\\n")
                        raise SystemExit(1)
                    pathlib.Path(args.response).write_text(json.dumps({"voice_id": "voice-local-001"}))
                    """
                ),
            )
            old_models_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = qwen3_tts_driver
                SPEECH_SERVER.QWEN3_TTS_PREFLIGHT_CACHE.clear()
                state = SPEECH_SERVER.build_host_state()
            finally:
                if old_models_root is None:
                    os.environ.pop(SPEECH_SERVER.MODELS_ROOT_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = old_models_root
                if old_tts is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = old_tts
                SPEECH_SERVER.QWEN3_TTS_PREFLIGHT_CACHE.clear()

            self.assertFalse(state.ready)
            self.assertFalse(state.qwen3_tts_ready)
            self.assertIn("qwen3_tts driver preflight failed", state.qwen3_tts_detail)
            self.assertFalse(state.models[0].ready)
            self.assertIn("qwen3_tts driver preflight failed", state.models[0].detail)

    def test_qwen3_tts_voice_create_routes_by_typed_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-qwen3",
                "speech/qwen3tts",
                ["audio.synthesize", "voice.create"],
                ["model.safetensors"],
                {"model.safetensors": b"fake-qwen3-tts"},
                "model.safetensors",
                {
                    "voice_workflow_models": [
                        {
                            "workflow_model_id": "qwen3-local-voice-clone",
                            "workflow_type": "reference_audio",
                            "workflow_family": "qwen3_tts",
                            "target_model_refs": ["speech/qwen3tts"],
                        },
                        {
                            "workflow_model_id": "qwen3-local-voice-design",
                            "workflow_type": "text_description",
                            "workflow_family": "qwen3_tts",
                            "target_model_refs": ["speech/qwen3tts"],
                        },
                    ],
                    "model_workflow_bindings": [
                        {
                            "workflow_model_id": "qwen3-local-voice-clone",
                            "workflow_family": "qwen3_tts",
                            "target_model_ref": "speech/qwen3tts",
                        },
                        {
                            "workflow_model_id": "qwen3-local-voice-design",
                            "workflow_family": "qwen3_tts",
                            "target_model_ref": "speech/qwen3tts",
                        },
                    ],
                },
            )
            driver = write_driver_script(
                root / "qwen3_tts_driver.py",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import argparse, json, pathlib
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    args = parser.parse_args()
                    request = json.loads(pathlib.Path(args.request).read_text())
                    op = request["operation"]
                    if op == "driver.preflight":
                        pathlib.Path(args.response).write_text(json.dumps({"driver_family": "qwen3_tts"}))
                    elif op == "voice.create" and request["creation_source"] == "reference_audio":
                        assert request["input"]["preferred_name"] == "clone-voice"
                        assert request["input"]["reference_audio_base64"]
                        pathlib.Path(args.response).write_text(json.dumps({"voice_id": "clone-voice-001", "job_id": "job-clone-001"}))
                    elif op == "voice.create" and request["creation_source"] == "text_description":
                        assert request["input"]["instruction_text"] == "warm narrator"
                        pathlib.Path(args.response).write_text(json.dumps({"voice_id": "design-voice-001"}))
                    else:
                        raise SystemExit("unexpected operation")
                    """
                ),
            )
            old_models_root = os.environ.get(SPEECH_SERVER.MODELS_ROOT_ENV)
            old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = str(root)
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = driver
                app = SPEECH_SERVER.create_app()
                create_handler = next(fn for method, path, fn in app.routes if method == "POST" and path == "/v1/voice/create")

                reference_result = create_handler(
                    {
                        "creation_source": "reference_audio",
                        "workflow_model_id": "qwen3-local-voice-clone",
                        "target_model_id": "speech/qwen3tts",
                        "input": {
                            "preferred_name": "clone-voice",
                            "reference_audio_base64": base64.b64encode(b"voice-audio").decode("ascii"),
                        },
                    }
                )
                text_result = create_handler(
                    {
                        "creation_source": "text_description",
                        "workflow_model_id": "qwen3-local-voice-design",
                        "target_model_id": "speech/qwen3tts",
                        "input": {
                            "instruction_text": "warm narrator",
                            "preferred_name": "design-voice",
                        },
                    }
                )
            finally:
                if old_models_root is None:
                    os.environ.pop(SPEECH_SERVER.MODELS_ROOT_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.MODELS_ROOT_ENV] = old_models_root
                if old_tts is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = old_tts

            self.assertEqual(reference_result["voice_id"], "clone-voice-001")
            self.assertEqual(reference_result["job_id"], "job-clone-001")
            self.assertEqual(text_result["voice_id"], "design-voice-001")

    def test_driver_cancellation_terminates_process_and_cleans_exchange(self) -> None:
        runtime = sys.modules["speech_server_runtime"]
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            completed_marker = root / "completed.txt"
            driver = write_driver_script(
                root / "blocking_driver.py",
                textwrap.dedent(
                    f"""\
                    #!/usr/bin/env python3
                    import argparse, os, pathlib, time
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    parser.parse_args()
                    pathlib.Path(os.environ["NIMI_RUNTIME_SPEECH_DRIVER_OUTPUT_PATH"]).write_bytes(b"partial")
                    time.sleep(3)
                    pathlib.Path({str(completed_marker)!r}).write_text("completed")
                    """
                ),
            )
            command = [sys.executable, str(root / "blocking_driver.py")]
            cancel_event = threading.Event()
            timer = threading.Timer(0.1, cancel_event.set)
            started = time.monotonic()
            timer.start()
            try:
                with self.assertRaisesRegex(RuntimeError, "speech driver cancelled"):
                    runtime.run_driver_command(command, {"operation": "audio.synthesize"}, cancel_event)
            finally:
                timer.cancel()
            self.assertLess(time.monotonic() - started, 2)
            time.sleep(0.2)
            self.assertFalse(completed_marker.exists())
            work_root = pathlib.Path(self._driver_work_root.name)
            self.assertEqual(list(work_root.glob("request-*.json")), [])
            self.assertEqual(list(work_root.glob("response-*.json")), [])
            self.assertEqual(list(work_root.glob("audio-*.wav")), [])

    def test_transcription_forwards_cancellation_to_driver_process(self) -> None:
        runtime = sys.modules["speech_server_runtime"]
        model = runtime.SpeechModelState(
            model_id="speech/qwen3asr-ready",
            declared_capabilities=["audio.transcribe"],
            ready_capabilities=["audio.transcribe"],
            capability_drivers={"audio.transcribe": "qwen3_asr"},
            ready=True,
            detail="ready",
            manifest_path="asset.manifest.json",
            bundle_dir="bundle",
            entry_path="model.safetensors",
            declared_files=["model.safetensors"],
        )
        request_payload = {"operation": "audio.transcribe"}
        cancel_event = threading.Event()
        with mock.patch.object(
            runtime,
            "driver_command_state",
            return_value=(["python", "qwen3_asr_driver.py"], True, "ready"),
        ), mock.patch.object(
            runtime,
            "run_driver_command",
            return_value={"text": "transcript"},
        ) as run_driver:
            text = runtime.transcribe_with_driver(model, request_payload, cancel_event)
        self.assertEqual(text, "transcript")
        run_driver.assert_called_once_with(
            ["python", "qwen3_asr_driver.py"],
            request_payload,
            cancel_event,
        )

    def test_request_disconnect_propagates_to_speech_driver(self) -> None:
        class DisconnectingRequest:
            def __init__(self) -> None:
                self.polls = 0

            async def is_disconnected(self) -> bool:
                self.polls += 1
                return self.polls > 1

        cancel_observed = threading.Event()

        def blocked_synthesis(_model, _payload, cancel_event):
            while not cancel_event.is_set():
                time.sleep(0.01)
            cancel_observed.set()
            raise RuntimeError("speech driver cancelled")

        model = SPEECH_SERVER.SpeechModelState(
            model_id="speech/qwen3tts-ready",
            declared_capabilities=["audio.synthesize"],
            ready_capabilities=["audio.synthesize"],
            capability_drivers={"audio.synthesize": "qwen3_tts"},
            ready=True,
            detail="ready",
            manifest_path="asset.manifest.json",
            bundle_dir="bundle",
            entry_path="model.safetensors",
            declared_files=["model.safetensors"],
        )
        with mock.patch.object(SPEECH_SERVER, "synthesize_with_driver", side_effect=blocked_synthesis):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(SPEECH_SERVER.run_synthesis_for_request(DisconnectingRequest(), model, {}))
        self.assertTrue(cancel_observed.is_set())

    def test_transcription_disconnect_propagates_to_speech_driver(self) -> None:
        class DisconnectingRequest:
            def __init__(self) -> None:
                self.polls = 0

            async def is_disconnected(self) -> bool:
                self.polls += 1
                return self.polls > 1

        cancel_observed = threading.Event()

        def blocked_transcription(_model, _payload, cancel_event):
            while not cancel_event.is_set():
                time.sleep(0.01)
            cancel_observed.set()
            raise RuntimeError("speech driver cancelled")

        model = SPEECH_SERVER.SpeechModelState(
            model_id="speech/qwen3asr-ready",
            declared_capabilities=["audio.transcribe"],
            ready_capabilities=["audio.transcribe"],
            capability_drivers={"audio.transcribe": "qwen3_asr"},
            ready=True,
            detail="ready",
            manifest_path="asset.manifest.json",
            bundle_dir="bundle",
            entry_path="model.safetensors",
            declared_files=["model.safetensors"],
        )
        with mock.patch.object(SPEECH_SERVER, "transcribe_with_driver", side_effect=blocked_transcription):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(SPEECH_SERVER.run_transcription_for_request(DisconnectingRequest(), model, {}))
        self.assertTrue(cancel_observed.is_set())

    def test_driver_audio_artifact_streams_in_bounded_chunks_and_cleans_up(self) -> None:
        runtime = sys.modules["speech_server_runtime"]
        audio_path = pathlib.Path(self._driver_work_root.name) / "stream.wav"
        payload = b"R" * (SPEECH_SERVER.SPEECH_RESPONSE_CHUNK_BYTES * 2 + 17)
        audio_path.write_bytes(payload)
        artifact = runtime.DriverAudioArtifact(audio_path, "audio/wav", len(payload))

        async def collect() -> list[bytes]:
            chunks = []
            async for chunk in SPEECH_SERVER.stream_driver_audio_artifact(artifact):
                chunks.append(chunk)
            return chunks

        chunks = asyncio.run(collect())
        self.assertEqual(b"".join(chunks), payload)
        self.assertTrue(all(len(chunk) <= SPEECH_SERVER.SPEECH_RESPONSE_CHUNK_BYTES for chunk in chunks))
        self.assertFalse(audio_path.exists())

    def test_synthesize_with_driver_returns_runtime_owned_audio_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            driver = write_driver_script(
                root / "qwen3_tts_driver.py",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import argparse, json, os, pathlib
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    args = parser.parse_args()
                    request = json.loads(pathlib.Path(args.request).read_text())
                    assert request["driver"] == "qwen3_tts"
                    assert request["voice"] == "af"
                    audio_path = pathlib.Path(os.environ["NIMI_RUNTIME_SPEECH_DRIVER_OUTPUT_PATH"])
                    audio_path.write_bytes(b"RIFFaudio")
                    pathlib.Path(args.response).write_text(json.dumps({"audio_path": str(audio_path), "content_type": "audio/wav"}))
                    """
                ),
            )
            model = SPEECH_SERVER.SpeechModelState(
                model_id="speech/qwen3tts-ready",
                declared_capabilities=["audio.synthesize"],
                ready_capabilities=["audio.synthesize"],
                capability_drivers={"audio.synthesize": "qwen3_tts"},
                ready=True,
                detail="ready",
                manifest_path=str(root / "asset.manifest.json"),
                bundle_dir=str(root),
                entry_path=str(root / "model.safetensors"),
                declared_files=["model.safetensors"],
            )
            old_tts = os.environ.get(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = driver
                artifact = SPEECH_SERVER.synthesize_with_driver(
                    model,
                    {
                        "driver": "qwen3_tts",
                        "operation": "audio.synthesize",
                        "model": model.model_id,
                        "voice": "af",
                    },
                )
            finally:
                if old_tts is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV] = old_tts
            self.assertEqual(artifact.path.parent, pathlib.Path(self._driver_work_root.name).resolve())
            self.assertEqual(artifact.size_bytes, len(b"RIFFaudio"))
            self.assertEqual(artifact.content_type, "audio/wav")
            self.assertEqual(artifact.path.read_bytes(), b"RIFFaudio")
            artifact.cleanup()
            self.assertFalse(artifact.path.exists())

    def test_transcribe_with_driver_returns_text(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            audio_path = root / "audio.wav"
            audio_path.write_bytes(b"fake-wav")
            driver = write_driver_script(
                root / "qwen3_asr_driver.py",
                textwrap.dedent(
                    """\
                    #!/usr/bin/env python3
                    import argparse, json, pathlib
                    parser = argparse.ArgumentParser()
                    parser.add_argument("--request", required=True)
                    parser.add_argument("--response", required=True)
                    args = parser.parse_args()
                    request = json.loads(pathlib.Path(args.request).read_text())
                    assert request["driver"] == "qwen3_asr"
                    assert request["language"] == "en"
                    assert request["response_format"] == "json"
                    assert request["timestamps"] is True
                    assert request["diarization"] is True
                    assert request["speaker_count"] == 2
                    assert pathlib.Path(request["audio_path"]).read_bytes() == b"fake-wav"
                    pathlib.Path(args.response).write_text(json.dumps({"text": "hello world"}))
                    """
                ),
            )
            model = SPEECH_SERVER.SpeechModelState(
                model_id="speech/qwen3asr-ready",
                declared_capabilities=["audio.transcribe"],
                ready_capabilities=["audio.transcribe"],
                capability_drivers={"audio.transcribe": "qwen3_asr"},
                ready=True,
                detail="ready",
                manifest_path=str(root / "asset.manifest.json"),
                bundle_dir=str(root),
                entry_path=str(root / "model.bin"),
                declared_files=["model.bin"],
            )
            old_stt = os.environ.get(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV)
            try:
                os.environ[SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV] = driver
                text = SPEECH_SERVER.transcribe_with_driver(
                    model,
                    {
                        "driver": "qwen3_asr",
                        "operation": "audio.transcribe",
                        "model": model.model_id,
                        "audio_path": str(audio_path),
                        "language": "en",
                        "response_format": "json",
                        "timestamps": True,
                        "diarization": True,
                        "speaker_count": 2,
                    },
                )
            finally:
                if old_stt is None:
                    os.environ.pop(SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV, None)
                else:
                    os.environ[SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV] = old_stt
            self.assertEqual(text, "hello world")

    def test_find_ready_model_accepts_bare_and_prefixed_aliases(self) -> None:
        original_build_host_state = SPEECH_SERVER.build_host_state

        def fake_build_host_state():
            return SPEECH_SERVER.HostState(
                status="ok",
                ready=True,
                detail="ready",
                models=[
                    SPEECH_SERVER.SpeechModelState(
                        model_id="speech/qwen3asr",
                        declared_capabilities=["audio.transcribe"],
                        ready_capabilities=["audio.transcribe"],
                        capability_drivers={"audio.transcribe": "qwen3_asr"},
                        ready=True,
                        detail="ready",
                        manifest_path="manifest.json",
                        bundle_dir="bundle",
                        entry_path="entry.json",
                        declared_files=["entry.json"],
                    ),
                    SPEECH_SERVER.SpeechModelState(
                        model_id="speech/qwen3tts",
                        declared_capabilities=["audio.synthesize"],
                        ready_capabilities=["audio.synthesize"],
                        capability_drivers={"audio.synthesize": "qwen3_tts"},
                        ready=True,
                        detail="ready",
                        manifest_path="manifest.json",
                        bundle_dir="bundle",
                        entry_path="entry.json",
                        declared_files=["entry.json"],
                    ),
                ],
                qwen3_tts_configured=True,
                qwen3_tts_ready=True,
                qwen3_tts_detail="ready",
                qwen3_asr_configured=True,
                qwen3_asr_ready=True,
                qwen3_asr_detail="ready",
                qwen3_asr_transformers_configured=False,
                qwen3_asr_transformers_ready=False,
                qwen3_asr_transformers_detail="not configured",
            )

        SPEECH_SERVER.build_host_state = fake_build_host_state
        try:
            self.assertEqual(
                SPEECH_SERVER.find_ready_model("speech/qwen3asr", "audio.transcribe").model_id,
                "speech/qwen3asr",
            )
            self.assertEqual(
                SPEECH_SERVER.find_ready_model("qwen3asr", "audio.transcribe").model_id,
                "speech/qwen3asr",
            )
            self.assertEqual(
                SPEECH_SERVER.find_ready_model("speech/qwen3tts", "audio.synthesize").model_id,
                "speech/qwen3tts",
            )
            self.assertEqual(
                SPEECH_SERVER.find_ready_model("qwen3tts", "audio.synthesize").model_id,
                "speech/qwen3tts",
            )
        finally:
            SPEECH_SERVER.build_host_state = original_build_host_state

if __name__ == "__main__":
    unittest.main()

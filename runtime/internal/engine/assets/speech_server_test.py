from __future__ import annotations

import ast
import asyncio
import importlib
import importlib.metadata
import importlib.util
import base64
import hashlib
import json
import os
import pathlib
import string
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


def load_voxcpm_driver_module():
    module_path = pathlib.Path(__file__).with_name("voxcpm_driver.py")
    spec = importlib.util.spec_from_file_location("voxcpm_driver_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


VOXCPM_DRIVER = load_voxcpm_driver_module()


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


def write_driver_script(path: pathlib.Path, body: str) -> str:
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)
    return f"{sys.executable} {path}"


def restore_env(name: str, old_value: str | None) -> None:
    if old_value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = old_value


class RegistrationRequest:
    def __init__(self, token: str = "") -> None:
        self.headers = {}
        if token:
            self.headers[SPEECH_SERVER.ADMISSION_TOKEN_HEADER] = token


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
        loaded_model_refs = []
        original_load_model = QWEN3_ASR_TRANSFORMERS_DRIVER.load_model
        QWEN3_ASR_TRANSFORMERS_DRIVER.load_model = lambda model_ref: (loaded_model_refs.append(model_ref) or (processor, model))
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                bundle_path = pathlib.Path(temp_dir) / "bundle"
                bundle_path.mkdir()
                (bundle_path / "model.safetensors").write_bytes(b"model")
                audio_path = pathlib.Path(temp_dir) / "speech.wav"
                audio_path.write_bytes(b"RIFFdemoWAVE")
                result = QWEN3_ASR_TRANSFORMERS_DRIVER.handle_transcribe(
                    {
                        "audio_path": str(audio_path),
                        "bundle_dir": str(bundle_path),
                        "declared_files": ["model.safetensors"],
                        "language": "en",
                    },
                )
        finally:
            QWEN3_ASR_TRANSFORMERS_DRIVER.load_model = original_load_model

        self.assertEqual(result, {"text": "hello from transformers"})
        self.assertEqual(processor.calls, [{"audio": str(audio_path), "language": "English"}])
        self.assertEqual(processor.return_format, "transcription_only")
        self.assertEqual(model.kwargs["max_new_tokens"], 256)
        self.assertEqual(loaded_model_refs, [str(bundle_path)])

    def test_transformers_native_driver_rejects_remote_model_fallback(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "managed Transformers ASR bundle_dir is required"):
            QWEN3_ASR_TRANSFORMERS_DRIVER.resolve_model_ref(
                {"model_ref": "Qwen/Qwen3-ASR-0.6B-hf"},
            )

    def test_transformers_native_driver_normalizes_webm_with_managed_ffmpeg(self) -> None:
        calls = []
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            ffmpeg = root / "managed-ffmpeg.exe"
            ffmpeg.write_bytes(b"managed")
            audio_path = root / "speech.webm"
            audio_path.write_bytes(b"webm-audio")

            def fake_run(args, **kwargs):
                calls.append((args, kwargs))
                pathlib.Path(args[-1]).write_bytes(b"RIFFdemoWAVE")
                return types.SimpleNamespace(returncode=0, stdout=b"", stderr=b"")

            fake_imageio_ffmpeg = types.SimpleNamespace(get_ffmpeg_exe=lambda: str(ffmpeg))
            with mock.patch.dict(sys.modules, {"imageio_ffmpeg": fake_imageio_ffmpeg}), mock.patch.object(
                QWEN3_ASR_TRANSFORMERS_DRIVER.subprocess,
                "run",
                side_effect=fake_run,
            ):
                with QWEN3_ASR_TRANSFORMERS_DRIVER.transformers_audio_source(str(audio_path)) as normalized:
                    normalized_path = pathlib.Path(normalized)
                    self.assertTrue(normalized_path.is_file())
                    self.assertTrue(QWEN3_ASR_TRANSFORMERS_DRIVER.is_wave_audio(normalized_path))

        self.assertEqual(calls[0][0][0], str(ffmpeg))
        self.assertIn("-nostdin", calls[0][0])
        self.assertIn("pcm_s16le", calls[0][0])
        self.assertEqual(calls[0][1]["timeout"], 120)

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

    def test_voxcpm_standard_driver_accepts_only_managed_default_synthesis(self) -> None:
        test_case = self

        class FakeSoundFile:
            @staticmethod
            def write(path, _wav, sample_rate):
                test_case.assertEqual(sample_rate, 24000)
                pathlib.Path(path).write_bytes(b"RIFFvoxcpm")

        class FakeModel:
            class TTSModel:
                sample_rate = 24000

            tts_model = TTSModel()

            def generate(self, **kwargs):
                test_case.assertEqual(kwargs, {"text": "hello", "cfg_value": 2.0, "inference_timesteps": 10})
                return [0.0, 0.1]

        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            bundle = root / "bundle"
            work = root / "work"
            bundle.mkdir()
            work.mkdir()
            (bundle / "model.safetensors").write_bytes(b"weights")
            output = work / "speech.wav"
            request = {
                "driver": "voxcpm",
                "input": "hello",
                "voice": "default",
                "audio_format": "wav",
                "bundle_dir": str(bundle),
                "declared_files": ["model.safetensors"],
            }
            old_work = os.environ.get(VOXCPM_DRIVER.DRIVER_WORK_ROOT_ENV)
            old_output = os.environ.get(VOXCPM_DRIVER.DRIVER_OUTPUT_PATH_ENV)
            try:
                os.environ[VOXCPM_DRIVER.DRIVER_WORK_ROOT_ENV] = str(work)
                os.environ[VOXCPM_DRIVER.DRIVER_OUTPUT_PATH_ENV] = str(output)
                with mock.patch.object(VOXCPM_DRIVER, "load_model", return_value=FakeModel()), mock.patch.object(
                    VOXCPM_DRIVER, "ensure_dependencies_importable", return_value=(object(), FakeSoundFile)
                ):
                    result = VOXCPM_DRIVER.handle_synthesize(request)
            finally:
                restore_env(VOXCPM_DRIVER.DRIVER_WORK_ROOT_ENV, old_work)
                restore_env(VOXCPM_DRIVER.DRIVER_OUTPUT_PATH_ENV, old_output)
            self.assertEqual(result["audio_path"], str(output))
            self.assertEqual(result["content_type"], "audio/wav")
            self.assertEqual(output.read_bytes(), b"RIFFvoxcpm")

            for key, value in (("voice", "clone"), ("audio_format", "mp3"), ("language", "en"), ("extensions", {"style": "clone"})):
                rejected = dict(request)
                rejected[key] = value
                with self.assertRaises(RuntimeError):
                    VOXCPM_DRIVER.validate_synthesis_request(rejected)

    def test_voxcpm_bundle_python_is_not_executed_by_managed_driver_path(self) -> None:
        test_case = self

        class FakeSoundFile:
            @staticmethod
            def write(path, _wav, sample_rate):
                test_case.assertEqual(sample_rate, 24000)
                pathlib.Path(path).write_bytes(b"RIFFvoxcpm-custody")

        class FakeModel:
            class TTSModel:
                sample_rate = 24000

            tts_model = TTSModel()

            def generate(self, **kwargs):
                test_case.assertEqual(kwargs["text"], "custody proof")
                return [0.0]

        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            bundle = root / "bundle"
            work = root / "work"
            bundle.mkdir()
            work.mkdir()
            marker = bundle / "payload-executed"
            tokenizer_files = {
                "tokenizer.json": {
                    "version": "1.0",
                    "truncation": None,
                    "padding": None,
                    "added_tokens": [
                        {"id": 0, "content": "<unk>", "single_word": False, "lstrip": False, "rstrip": False, "normalized": False, "special": True},
                        {"id": 1, "content": "<s>", "single_word": False, "lstrip": False, "rstrip": False, "normalized": False, "special": True},
                        {"id": 2, "content": "</s>", "single_word": False, "lstrip": False, "rstrip": False, "normalized": False, "special": True},
                    ],
                    "normalizer": None,
                    "pre_tokenizer": {"type": "Whitespace"},
                    "post_processor": None,
                    "decoder": None,
                    "model": {"type": "WordLevel", "vocab": {"<unk>": 0, "<s>": 1, "</s>": 2, "custody": 3}, "unk_token": "<unk>"},
                },
                "tokenizer_config.json": {
                    "tokenizer_class": "LlamaTokenizerFast",
                    "unk_token": "<unk>",
                    "bos_token": "<s>",
                    "eos_token": "</s>",
                    "model_max_length": 128,
                },
                "special_tokens_map.json": {"unk_token": "<unk>", "bos_token": "<s>", "eos_token": "</s>"},
            }
            (bundle / "model.safetensors").write_bytes(b"weights")
            (bundle / "config.json").write_text('{"architecture":"voxcpm2"}', encoding="utf-8")
            for name, payload in tokenizer_files.items():
                (bundle / name).write_text(json.dumps(payload), encoding="utf-8")
            (bundle / "tokenization_voxcpm2.py").write_text(
                "import pathlib\npathlib.Path(__file__).with_name('payload-executed').write_text('executed')\n",
                encoding="utf-8",
            )
            output = work / "speech.wav"
            declared_files = ["model.safetensors", "config.json", *tokenizer_files, "tokenization_voxcpm2.py"]
            request = {
                "driver": "voxcpm",
                "input": "custody proof",
                "bundle_dir": str(bundle),
                "declared_files": declared_files,
            }

            runtime_driver_path = pathlib.Path(__file__).with_name("voxcpm_driver.py").resolve()
            profile_root = pathlib.Path(sys.prefix).resolve()
            profile_inputs = profile_root / "_profile-input"
            promoted_driver_path = profile_root / "voxcpm_driver.py"
            managed_voxcpm_profile = profile_inputs.is_dir() and promoted_driver_path.is_file()
            if not managed_voxcpm_profile:
                reason = "managed profile unavailable; managed VoxCPM ownership assertions not exercised"
                if os.environ.get("NIMI_REQUIRE_MANAGED_VOXCPM_TEST") == "1":
                    self.fail(f"{reason}; managed VoxCPM integration test requires a promoted profile")
                print(reason, file=sys.stderr, flush=True)
                self.skipTest(reason)

            self.assertEqual(promoted_driver_path.read_bytes(), runtime_driver_path.read_bytes())
            self.assertEqual(len(profile_root.name), 64)
            self.assertTrue(all(character in string.hexdigits for character in profile_root.name))
            project_input = (profile_inputs / "pyproject.toml").read_text(encoding="utf-8")
            exact_lock = (profile_inputs / "uv.lock").read_text(encoding="utf-8")
            self.assertIn('"voxcpm==2.0.3"', project_input)
            self.assertIn('name = "voxcpm"', exact_lock)
            self.assertIn('version = "2.0.3"', exact_lock)
            self.assertIn("sha256:24da58a30d094a9e9a7ead450ae9cffda0d31eaeba620b61ad99179dd87e486b", exact_lock)
            spec = importlib.util.spec_from_file_location("voxcpm_driver_promoted_profile_under_test", promoted_driver_path)
            self.assertIsNotNone(spec)
            self.assertIsNotNone(spec.loader)
            driver = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = driver
            spec.loader.exec_module(driver)
            self.assertEqual(pathlib.Path(driver.__file__).resolve(), promoted_driver_path)

            driver_source = pathlib.Path(driver.__file__).read_text(encoding="utf-8")
            self.assertNotIn("trust_remote_code", driver_source)
            self.assertNotIn("AutoTokenizer", driver_source)
            self.assertNotIn("sys.path", driver_source)
            driver_loader_calls = [
                node
                for node in ast.walk(ast.parse(driver_source))
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "from_pretrained"
            ]
            self.assertEqual(len(driver_loader_calls), 1)
            self.assertEqual(ast.unparse(driver_loader_calls[0].func.value), "VoxCPM")
            self.assertEqual([keyword.arg for keyword in driver_loader_calls[0].keywords], ["load_denoiser"])

            before_sys_path = list(sys.path)
            old_work = os.environ.get(driver.DRIVER_WORK_ROOT_ENV)
            old_output = os.environ.get(driver.DRIVER_OUTPUT_PATH_ENV)
            try:
                os.environ[driver.DRIVER_WORK_ROOT_ENV] = str(work)
                os.environ[driver.DRIVER_OUTPUT_PATH_ENV] = str(output)
                VoxCPM, _ = driver.ensure_dependencies_importable()
                voxcpm_module = importlib.import_module("voxcpm")
                from transformers import LlamaTokenizerFast  # type: ignore

                self.assertEqual(importlib.metadata.version("voxcpm"), "2.0.3")

                def assert_managed_site_package(module) -> pathlib.Path:
                    module_file = pathlib.Path(module.__file__).resolve()
                    module_file.relative_to(profile_root)
                    self.assertIn("site-packages", {part.lower() for part in module_file.parts})
                    self.assertFalse(module_file.is_relative_to(bundle.resolve()))
                    return module_file

                assert_managed_site_package(voxcpm_module)
                tokenizer_module = importlib.import_module(LlamaTokenizerFast.__module__)
                assert_managed_site_package(tokenizer_module)
                core_module = importlib.import_module("voxcpm.core")
                voxcpm2_model_module = importlib.import_module("voxcpm.model.voxcpm2")
                legacy_model_module = importlib.import_module("voxcpm.model.voxcpm")
                for module in (core_module, voxcpm2_model_module, legacy_model_module):
                    assert_managed_site_package(module)
                    source = pathlib.Path(module.__file__).read_text(encoding="utf-8")
                    self.assertNotIn("trust_remote_code", source)
                    self.assertNotIn("sys.path", source)
                self.assertIn("VoxCPM2Model.from_local", pathlib.Path(core_module.__file__).read_text(encoding="utf-8"))
                self.assertIn(
                    "LlamaTokenizerFast.from_pretrained(path)",
                    pathlib.Path(voxcpm2_model_module.__file__).read_text(encoding="utf-8"),
                )
                self.assertIn(
                    "LlamaTokenizerFast.from_pretrained(path)",
                    pathlib.Path(legacy_model_module.__file__).read_text(encoding="utf-8"),
                )

                dynamic_module_utils = importlib.import_module("transformers.dynamic_module_utils")
                with mock.patch.object(
                    dynamic_module_utils,
                    "get_class_from_dynamic_module",
                    side_effect=AssertionError("transformers dynamic module loading must not run"),
                ):
                    tokenizer = LlamaTokenizerFast.from_pretrained(str(bundle))
                self.assertIsNotNone(tokenizer)
                self.assertEqual(sys.path, before_sys_path)
                self.assertFalse(marker.exists())

                driver._MODEL_CACHE.clear()
                with mock.patch.object(VoxCPM, "from_pretrained", return_value=FakeModel()) as loader, mock.patch.object(
                    driver, "ensure_dependencies_importable", return_value=(VoxCPM, FakeSoundFile)
                ):
                    driver.handle_synthesize(request)
                loader.assert_called_once_with(str(bundle), load_denoiser=False)
                driver._MODEL_CACHE.clear()
            finally:
                restore_env(driver.DRIVER_WORK_ROOT_ENV, old_work)
                restore_env(driver.DRIVER_OUTPUT_PATH_ENV, old_output)
            self.assertEqual(sys.path, before_sys_path)
            self.assertNotIn(str(bundle), sys.path)
            self.assertFalse(marker.exists())
            self.assertEqual(output.read_bytes()[:4], b"RIFF")

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

    def test_build_host_state_reports_ready_voxcpm_driver_without_registration(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.dict(
            os.environ,
            {
                SPEECH_SERVER.MODELS_ROOT_ENV: temp_dir,
                SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV: "",
                SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV: "",
                SPEECH_SERVER.QWEN3_ASR_TRANSFORMERS_DRIVER_ENV: "",
                SPEECH_SERVER.VOXCPM_DRIVER_ENV: f'"{sys.executable}"',
                SPEECH_SERVER.VOXCPM_BACKEND_ENV: "standard",
            },
        ):
            state = SPEECH_SERVER.build_host_state()
            app = SPEECH_SERVER.create_app()
            healthz = next(handler for method, path, handler in app.routes if method == "GET" and path == "/healthz")
            health = healthz()

        self.assertFalse(state.ready)
        self.assertEqual(state.status, "not_ready")
        self.assertTrue(state.voxcpm_ready)
        self.assertEqual(state.models, [])
        self.assertFalse(health["ready"])
        self.assertTrue(health["checks"]["voxcpm_driver_ready"])
        self.assertEqual(health["checks"]["models_ready"], 0)

    def test_registered_loadout_model_resolves_for_synthesis_with_stub_driver(self) -> None:
        class ConnectedRequest:
            async def is_disconnected(self) -> bool:
                return False

        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            bundle_dir = root / "loadout-voxcpm"
            bundle_dir.mkdir()
            entry_path = bundle_dir / "model.safetensors"
            entry_path.write_bytes(b"weights")
            (bundle_dir / "config.json").write_text("{}", encoding="utf-8")
            model_digest = hashlib.sha256(b"weights").hexdigest()
            config_digest = hashlib.sha256(b"{}").hexdigest()
            verified_content_id = "modelasset-content:opaque-loadout-voxcpm"
            with mock.patch.dict(
                os.environ,
                {
                    SPEECH_SERVER.MODELS_ROOT_ENV: temp_dir,
                    SPEECH_SERVER.ADMISSION_TOKEN_ENV: "test-admission-token",
                    SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV: "",
                    SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV: "",
                    SPEECH_SERVER.QWEN3_ASR_TRANSFORMERS_DRIVER_ENV: "",
                    SPEECH_SERVER.VOXCPM_DRIVER_ENV: sys.executable,
                    SPEECH_SERVER.VOXCPM_BACKEND_ENV: "standard",
                },
            ):
                app = SPEECH_SERVER.create_app()
                register = next(handler for method, path, handler in app.routes if method == "POST" and path == "/v1/models/register")
                synthesize = next(handler for method, path, handler in app.routes if method == "POST" and path == "/v1/audio/speech")
                registration = register(
                    {
                        "model": "model-asset/loadout-voxcpm",
                        "capability": "audio.synthesize",
                        "driver_id": "nimi.runtime.driver.voxcpm",
                        "driver": "voxcpm",
                        "family": "voxcpm",
                        "backend": "standard",
                        "bundle_dir": str(bundle_dir),
                        "entry_path": str(entry_path),
                        "declared_files": ["model.safetensors", "config.json"],
                        "declared_file_sha256": {"model.safetensors": model_digest, "config.json": config_digest},
                        "verified_content_id": verified_content_id,
                        "entry_sha256": model_digest,
                    },
                    RegistrationRequest("test-admission-token"),
                )
                audio_path = pathlib.Path(self._driver_work_root.name) / "registered.wav"
                audio_path.write_bytes(b"RIFFregistered")
                artifact = SPEECH_SERVER.DriverAudioArtifact(audio_path, "audio/wav", len(b"RIFFregistered"))
                observed: dict[str, object] = {}

                async def stub_synthesis(_request, model, request_payload):
                    observed["model"] = model
                    observed["request"] = request_payload
                    return artifact

                with mock.patch.object(SPEECH_SERVER, "run_synthesis_for_request", new=stub_synthesis):
                    response = asyncio.run(
                        synthesize(
                            {"model": "model-asset/loadout-voxcpm", "input": "hello", "voice": "default"},
                            ConnectedRequest(),
                        )
                    )

            self.assertEqual(registration["status"], "registered")
            self.assertEqual(response.headers["x-local-model-id"], "model-asset/loadout-voxcpm")
            self.assertEqual(observed["model"].verified_content_id, verified_content_id)
            self.assertEqual(observed["request"]["bundle_dir"], str(bundle_dir))
            self.assertEqual(observed["request"]["declared_files"], ["model.safetensors", "config.json"])
            artifact.cleanup()

    def test_registered_model_rejects_declared_byte_drift_before_driver_load(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            bundle_dir = pathlib.Path(temp_dir) / "loadout-voxcpm"
            bundle_dir.mkdir()
            entry_path = bundle_dir / "model.safetensors"
            entry_path.write_bytes(b"captured-weights")
            tokenizer_path = bundle_dir / "tokenizer.json"
            tokenizer_path.write_bytes(b"captured-tokenizer")
            model_digest = hashlib.sha256(entry_path.read_bytes()).hexdigest()
            tokenizer_digest = hashlib.sha256(tokenizer_path.read_bytes()).hexdigest()
            with mock.patch.dict(
                os.environ,
                {
                    SPEECH_SERVER.MODELS_ROOT_ENV: temp_dir,
                    SPEECH_SERVER.VOXCPM_DRIVER_ENV: sys.executable,
                    SPEECH_SERVER.VOXCPM_BACKEND_ENV: "standard",
                },
            ):
                model = SPEECH_SERVER.registered_speech_model_state(
                    {
                        "model": "model-asset/loadout-voxcpm",
                        "capability": "audio.synthesize",
                        "driver_id": "nimi.runtime.driver.voxcpm",
                        "driver": "voxcpm",
                        "family": "voxcpm",
                        "backend": "standard",
                        "bundle_dir": str(bundle_dir),
                        "entry_path": str(entry_path),
                        "declared_files": ["model.safetensors", "tokenizer.json"],
                        "declared_file_sha256": {"model.safetensors": model_digest, "tokenizer.json": tokenizer_digest},
                        "verified_content_id": "modelasset-content:opaque-drift-test",
                        "entry_sha256": model_digest,
                    }
                )
                tokenizer_path.write_bytes(b"mutated-tokenizer")
                runtime = sys.modules["speech_server_runtime"]
                with mock.patch.object(runtime, "run_driver_command") as driver_call:
                    with self.assertRaisesRegex(RuntimeError, "bytes changed before Driver load"):
                        runtime.synthesize_with_driver(model, {"input": "hello"})
                driver_call.assert_not_called()

    def test_model_registration_rejects_missing_or_wrong_admission_token(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.dict(
            os.environ,
            {
                SPEECH_SERVER.MODELS_ROOT_ENV: temp_dir,
                SPEECH_SERVER.ADMISSION_TOKEN_ENV: "expected-admission-token",
            },
        ):
            app = SPEECH_SERVER.create_app()
            register = next(handler for method, path, handler in app.routes if method == "POST" and path == "/v1/models/register")
            for request in (RegistrationRequest(), RegistrationRequest("wrong-admission-token")):
                with self.assertRaises(SPEECH_SERVER.HTTPException) as raised:
                    register({}, request)
                self.assertEqual(raised.exception.status_code, 401)
                self.assertEqual(raised.exception.detail["reason"], "speech_model_registration_unauthorized")

    def test_model_registration_rejects_bundle_outside_managed_models_root(self) -> None:
        with tempfile.TemporaryDirectory() as models_root, tempfile.TemporaryDirectory() as outside_root:
            bundle_dir = pathlib.Path(outside_root) / "outside-model"
            bundle_dir.mkdir()
            entry_path = bundle_dir / "model.safetensors"
            entry_path.write_bytes(b"weights")
            digest = "a" * 64
            with mock.patch.dict(
                os.environ,
                {
                    SPEECH_SERVER.MODELS_ROOT_ENV: models_root,
                    SPEECH_SERVER.ADMISSION_TOKEN_ENV: "test-admission-token",
                    SPEECH_SERVER.VOXCPM_DRIVER_ENV: sys.executable,
                    SPEECH_SERVER.VOXCPM_BACKEND_ENV: "standard",
                },
            ):
                app = SPEECH_SERVER.create_app()
                register = next(handler for method, path, handler in app.routes if method == "POST" and path == "/v1/models/register")
                with self.assertRaises(SPEECH_SERVER.HTTPException) as raised:
                    register(
                        {
                            "model": "model-asset/outside",
                            "capability": "audio.synthesize",
                            "driver_id": "nimi.runtime.driver.voxcpm",
                            "driver": "voxcpm",
                            "family": "voxcpm",
                            "backend": "standard",
                            "bundle_dir": str(bundle_dir),
                            "entry_path": str(entry_path),
                            "declared_files": ["model.safetensors"],
                            "verified_content_id": "sha256:" + digest,
                            "entry_sha256": digest,
                        },
                        RegistrationRequest("test-admission-token"),
                    )
                self.assertEqual(raised.exception.status_code, 400)
                self.assertIn("outside the managed models root", raised.exception.detail["message"])

    def test_model_registration_rejects_missing_declared_file(self) -> None:
        with tempfile.TemporaryDirectory() as models_root:
            bundle_dir = pathlib.Path(models_root) / "missing-file-model"
            bundle_dir.mkdir()
            entry_path = bundle_dir / "model.safetensors"
            entry_path.write_bytes(b"weights")
            digest = "a" * 64
            with mock.patch.dict(
                os.environ,
                {
                    SPEECH_SERVER.MODELS_ROOT_ENV: models_root,
                    SPEECH_SERVER.ADMISSION_TOKEN_ENV: "test-admission-token",
                    SPEECH_SERVER.VOXCPM_DRIVER_ENV: sys.executable,
                    SPEECH_SERVER.VOXCPM_BACKEND_ENV: "standard",
                },
            ):
                app = SPEECH_SERVER.create_app()
                register = next(handler for method, path, handler in app.routes if method == "POST" and path == "/v1/models/register")
                with self.assertRaises(SPEECH_SERVER.HTTPException) as raised:
                    register(
                        {
                            "model": "model-asset/missing-file",
                            "capability": "audio.synthesize",
                            "driver_id": "nimi.runtime.driver.voxcpm",
                            "driver": "voxcpm",
                            "family": "voxcpm",
                            "backend": "standard",
                            "bundle_dir": str(bundle_dir),
                            "entry_path": str(entry_path),
                            "declared_files": ["model.safetensors", "config.json"],
                            "verified_content_id": "sha256:" + digest,
                            "entry_sha256": digest,
                        },
                        RegistrationRequest("test-admission-token"),
                    )
                self.assertEqual(raised.exception.status_code, 400)
                self.assertIn("declared file is unavailable", raised.exception.detail["message"])

    def test_unregistered_model_remains_not_ready(self) -> None:
        app = SPEECH_SERVER.create_app()
        synthesize = next(handler for method, path, handler in app.routes if method == "POST" and path == "/v1/audio/speech")
        with self.assertRaises(SPEECH_SERVER.HTTPException) as raised:
            asyncio.run(synthesize({"model": "model-asset/not-registered", "input": "hello"}, object()))
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail["reason"], "speech_model_not_ready")

    def test_build_host_state_is_not_ready_when_all_drivers_are_unconfigured(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, mock.patch.dict(
            os.environ,
            {
                SPEECH_SERVER.MODELS_ROOT_ENV: temp_dir,
                SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV: "",
                SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV: "",
                SPEECH_SERVER.QWEN3_ASR_TRANSFORMERS_DRIVER_ENV: "",
                SPEECH_SERVER.VOXCPM_DRIVER_ENV: "",
                SPEECH_SERVER.VOXCPM_BACKEND_ENV: "",
            },
        ):
            state = SPEECH_SERVER.build_host_state()

        self.assertFalse(state.ready)
        self.assertEqual(state.status, "not_ready")
        self.assertEqual(state.detail, "no runtime-native speech drivers configured")

    def test_voice_create_registration_admits_only_captured_source_and_workflow(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            bundle_dir = root / "loadout-qwen3-voice"
            bundle_dir.mkdir()
            entry_path = bundle_dir / "model.safetensors"
            entry_path.write_bytes(b"captured-qwen3-voice")
            digest = hashlib.sha256(entry_path.read_bytes()).hexdigest()
            payload = {
                "model": "model-asset/loadout-qwen3-voice",
                "capability": "voice.create",
                "driver_id": "nimi.runtime.driver.qwen3-tts",
                "driver": "qwen3_tts",
                "family": "qwen3_tts",
                "backend": "qwen_tts",
                "creation_source": "reference_audio",
                "workflow_model_id": "qwen3-local-voice-clone",
                "bundle_dir": str(bundle_dir),
                "entry_path": str(entry_path),
                "declared_files": ["model.safetensors"],
                "declared_file_sha256": {"model.safetensors": digest},
                "verified_content_id": "sha256:" + digest,
                "entry_sha256": digest,
            }
            with mock.patch.dict(
                os.environ,
                {
                    SPEECH_SERVER.MODELS_ROOT_ENV: str(root),
                    SPEECH_SERVER.QWEN3_TTS_DRIVER_ENV: sys.executable,
                    SPEECH_SERVER.QWEN3_ASR_DRIVER_ENV: "",
                    SPEECH_SERVER.QWEN3_ASR_TRANSFORMERS_DRIVER_ENV: "",
                    SPEECH_SERVER.VOXCPM_DRIVER_ENV: "",
                },
            ):
                model = SPEECH_SERVER.registered_speech_model_state(payload)
                registered = {model.model_id: model}
                admitted = SPEECH_SERVER.find_ready_voice_creation_model(
                    model.model_id,
                    "reference_audio",
                    "qwen3-local-voice-clone",
                    registered,
                )
                self.assertIs(admitted, model)
                self.assertEqual(model.voice_creation_sources, ["reference_audio"])
                self.assertEqual(
                    model.workflow_model_bindings,
                    {"reference_audio": ["qwen3-local-voice-clone"]},
                )

                for source, workflow in (
                    ("text_description", "qwen3-local-voice-design"),
                    ("reference_audio", "qwen3-local-voice-design"),
                ):
                    with self.assertRaises(SPEECH_SERVER.HTTPException) as raised:
                        SPEECH_SERVER.find_ready_voice_creation_model(
                            model.model_id,
                            source,
                            workflow,
                            registered,
                        )
                    self.assertEqual(
                        raised.exception.detail["reason"],
                        "speech_workflow_binding_not_ready",
                    )

                missing_source = dict(payload)
                missing_source.pop("creation_source")
                with self.assertRaisesRegex(ValueError, "requires one source"):
                    SPEECH_SERVER.registered_speech_model_state(missing_source)

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

    def test_find_ready_model_requires_exact_registered_identity(self) -> None:
        model = SPEECH_SERVER.SpeechModelState(
            model_id="model-asset/Qwen3-ASR",
            declared_capabilities=["audio.transcribe"],
            ready_capabilities=["audio.transcribe"],
            capability_drivers={"audio.transcribe": "qwen3_asr"},
            ready=True,
            detail="ready",
            bundle_dir="bundle",
            entry_path="entry.json",
            declared_files=["entry.json"],
        )
        registered = {model.model_id: model}

        self.assertIs(
            SPEECH_SERVER.find_ready_model(
                "model-asset/Qwen3-ASR",
                "audio.transcribe",
                registered,
            ),
            model,
        )
        for alias in ("Qwen3-ASR", "model-asset/qwen3-asr"):
            with self.assertRaises(SPEECH_SERVER.HTTPException) as raised:
                SPEECH_SERVER.find_ready_model(
                    alias,
                    "audio.transcribe",
                    registered,
                )
            self.assertEqual(raised.exception.detail["reason"], "speech_model_not_ready")


if __name__ == "__main__":
    unittest.main()

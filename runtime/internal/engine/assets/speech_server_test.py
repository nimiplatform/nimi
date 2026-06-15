from __future__ import annotations

import importlib.util
import base64
import json
import os
import pathlib
import sys
import tempfile
import textwrap
import types
import unittest
from unittest import mock


def install_fastapi_stubs() -> None:
    fastapi = types.ModuleType("fastapi")
    responses = types.ModuleType("fastapi.responses")
    starlette = types.ModuleType("starlette")
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

    class JSONResponse:
        def __init__(self, status_code: int = 200, content=None):
            self.status_code = status_code
            self.content = content

    class Response:
        def __init__(self, content=b"", media_type: str | None = None, headers=None):
            self.content = content
            self.media_type = media_type
            self.headers = headers or {}

    def File(default=None):
        return default

    def Form(default=None):
        return default

    def run(*_args, **_kwargs):
        return None

    async def run_in_threadpool(fn, *args, **kwargs):
        return fn(*args, **kwargs)

    fastapi.FastAPI = FastAPI
    fastapi.File = File
    fastapi.Form = Form
    fastapi.HTTPException = HTTPException
    fastapi.UploadFile = UploadFile
    responses.JSONResponse = JSONResponse
    responses.Response = Response
    starlette_concurrency.run_in_threadpool = run_in_threadpool
    uvicorn.run = run

    sys.modules["fastapi"] = fastapi
    sys.modules["fastapi.responses"] = responses
    sys.modules["starlette"] = starlette
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


class FakeQwen3TTSModel:
    def __init__(self) -> None:
        self.custom_voice_calls = []

    def get_supported_speakers(self):
        return ["Serena", "Ryan"]

    def generate_custom_voice(self, **kwargs):
        self.custom_voice_calls.append(kwargs)
        return [[0.1, 0.2]], 24000


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
    def tearDown(self) -> None:
        QWEN3_TTS_DRIVER._MODEL_CACHE.clear()
        QWEN3_TTS_DRIVER._MODEL_PATH_CACHE.clear()

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
            write_manifest(
                root,
                "nimi/stt-qwen3-asr",
                "speech/qwen3asr",
                ["audio.transcribe"],
                ["model.bin"],
                {
                    "model.bin": b"fake-qwen3-asr",
                },
                "model.bin",
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
                ["audio.synthesize", "voice_workflow.voice_clone"],
                ["model.safetensors"],
                {"model.safetensors": b"fake-qwen3-tts-base"},
                "model.safetensors",
                {
                    "voice_workflow_models": [
                        {
                            "workflow_model_id": "qwen3-local-voice-clone",
                            "workflow_type": "voice_clone",
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
            self.assertEqual(state.models[0].capability_drivers["voice_workflow.voice_clone"], "qwen3_tts")
            self.assertTrue(state.models[0].ready)
            self.assertIn("voice_workflow.voice_clone", state.models[0].ready_capabilities)

    def test_build_host_state_rejects_qwen3_tts_workflow_without_binding(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-qwen3-base",
                "speech/qwen3tts-base",
                ["audio.synthesize", "voice_workflow.voice_clone"],
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
            self.assertNotIn("voice_workflow.voice_clone", state.models[0].ready_capabilities)
            self.assertIn("voice_workflow.voice_clone requires explicit qwen3_tts workflow binding", state.models[0].detail)

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

    def test_qwen3_tts_workflow_routes_execute_clone_and_design(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
            write_manifest(
                root,
                "nimi/tts-qwen3",
                "speech/qwen3tts",
                ["audio.synthesize", "voice_workflow.voice_clone", "voice_workflow.voice_design"],
                ["model.safetensors"],
                {"model.safetensors": b"fake-qwen3-tts"},
                "model.safetensors",
                {
                    "voice_workflow_models": [
                        {
                            "workflow_model_id": "qwen3-local-voice-clone",
                            "workflow_type": "voice_clone",
                            "workflow_family": "qwen3_tts",
                            "target_model_refs": ["speech/qwen3tts"],
                        },
                        {
                            "workflow_model_id": "qwen3-local-voice-design",
                            "workflow_type": "voice_design",
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
                    elif op == "voice_workflow.voice_clone":
                        assert request["input"]["preferred_name"] == "clone-voice"
                        assert request["input"]["reference_audio_base64"]
                        pathlib.Path(args.response).write_text(json.dumps({"voice_id": "clone-voice-001", "job_id": "job-clone-001"}))
                    elif op == "voice_workflow.voice_design":
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
                clone_handler = next(fn for method, path, fn in app.routes if method == "POST" and path == "/v1/voice/clone")
                design_handler = next(fn for method, path, fn in app.routes if method == "POST" and path == "/v1/voice/design")

                clone_result = clone_handler(
                    {
                        "workflow_model_id": "qwen3-local-voice-clone",
                        "target_model_id": "speech/qwen3tts",
                        "input": {
                            "preferred_name": "clone-voice",
                            "reference_audio_base64": base64.b64encode(b"voice-audio").decode("ascii"),
                        },
                    }
                )
                design_result = design_handler(
                    {
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

            self.assertEqual(clone_result["voice_id"], "clone-voice-001")
            self.assertEqual(clone_result["job_id"], "job-clone-001")
            self.assertEqual(design_result["voice_id"], "design-voice-001")

    def test_synthesize_with_driver_returns_audio_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = pathlib.Path(temp_dir)
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
                    assert request["driver"] == "qwen3_tts"
                    assert request["voice"] == "af"
                    pathlib.Path(args.response).write_text(json.dumps({"audio_base64": "UklGRmF1ZGlv", "content_type": "audio/wav"}))
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
                payload, mime = SPEECH_SERVER.synthesize_with_driver(
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
            self.assertEqual(payload, base64.b64decode("UklGRmF1ZGlv"))
            self.assertEqual(mime, "audio/wav")

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

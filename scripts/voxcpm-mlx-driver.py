#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import importlib.metadata
import json
import mimetypes
import pathlib
import subprocess
import sys
import tempfile
from typing import Any


VOICE_DESIGN_PREFIX = "voxcpm:design:"
VOICE_CLONE_PREFIX = "voxcpm:clone:"
AUDIO_SUFFIXES = {".wav", ".mp3", ".m4a", ".flac", ".ogg"}


def fail(message: str) -> None:
    raise RuntimeError(message)


def read_json(path: str) -> dict[str, Any]:
    payload = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        fail("request payload must be an object")
    return payload


def write_json(path: str, payload: dict[str, Any]) -> None:
    pathlib.Path(path).write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")


def encode_voice_handle(prefix: str, payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    token = base64.urlsafe_b64encode(blob).decode("ascii").rstrip("=")
    return prefix + token


def decode_handle_payload(token: str) -> dict[str, Any]:
    padded = token + ("=" * ((4 - len(token) % 4) % 4))
    try:
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(raw.decode("utf-8"))
    except Exception as error:
        fail(f"voice handle invalid: {error}")
    if not isinstance(payload, dict):
        fail("voice handle payload must be an object")
    return payload


def decode_voice_handle(value: str) -> tuple[str, dict[str, Any] | None]:
    if value.startswith(VOICE_DESIGN_PREFIX):
        return "design", decode_handle_payload(value[len(VOICE_DESIGN_PREFIX) :])
    if value.startswith(VOICE_CLONE_PREFIX):
        return "clone", decode_handle_payload(value[len(VOICE_CLONE_PREFIX) :])
    return "", None


def require_string(payload: dict[str, Any], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        fail(f"missing required field: {key}")
    return value


def optional_string(payload: dict[str, Any], key: str) -> str:
    return str(payload.get(key) or "").strip()


def ensure_mlx_audio_importable() -> None:
    try:
        __import__("mlx_audio")
    except Exception as error:
        fail(f"mlx_audio import failed: {error}")


def load_mlx_tts_model(model_ref: str) -> None:
    ensure_mlx_audio_importable()
    try:
        from mlx_audio.tts import load_model
    except Exception as error:
        fail(f"mlx_audio.tts import failed: {error}")
    try:
        load_model(model_ref, lazy=True)
    except Exception as error:
        fail(f"mlx_audio model load failed: {error}")


def handle_preflight(model_ref: str) -> dict[str, Any]:
    load_mlx_tts_model(model_ref)
    try:
        version = importlib.metadata.version("mlx-audio")
    except Exception:
        version = ""
    response: dict[str, Any] = {
        "driver_family": "voxcpm",
        "driver_backend": "mlx",
        "model_ref": model_ref,
        "supports": ["audio.synthesize", "voice.design", "voice.clone"],
    }
    if version:
        response["mlx_audio_version"] = version
    return response


def build_mlx_generate_command(
    model_ref: str,
    text: str,
    voice: str,
    output_dir: str,
) -> tuple[list[str], list[tempfile.TemporaryDirectory[str]]]:
    ensure_mlx_audio_importable()
    command = [
        sys.executable,
        "-m",
        "mlx_audio.tts.generate",
        "--model",
        model_ref,
        "--text",
        text,
        "--output_path",
        output_dir,
    ]
    temp_dirs: list[tempfile.TemporaryDirectory[str]] = []
    handle_kind, handle_payload = decode_voice_handle(voice.strip()) if voice.strip() else ("", None)
    if handle_kind == "design" and handle_payload is not None:
        instruction = optional_string(handle_payload, "instruction_text")
        if instruction:
            command.extend(["--instruct", instruction])
        return command, temp_dirs
    if handle_kind == "clone" and handle_payload is not None:
        audio_b64 = optional_string(handle_payload, "reference_audio_base64")
        if not audio_b64:
            fail("clone voice handle missing reference_audio_base64")
        try:
            audio_bytes = base64.b64decode(audio_b64.encode("ascii"))
        except Exception as error:
            fail(f"clone voice handle audio invalid: {error}")
        if not audio_bytes:
            fail("clone voice handle reference audio is empty")
        temp_dir = tempfile.TemporaryDirectory(prefix="nimi-voxcpm-mlx-clone-")
        temp_dirs.append(temp_dir)
        audio_path = pathlib.Path(temp_dir.name) / "reference.wav"
        audio_path.write_bytes(audio_bytes)
        command.extend(["--ref_audio", str(audio_path)])
        prompt_text = optional_string(handle_payload, "text")
        if prompt_text:
            command.extend(["--ref_text", prompt_text])
    return command, temp_dirs


def discover_audio_output(output_dir: str) -> pathlib.Path:
    root = pathlib.Path(output_dir)
    candidates = [item for item in root.rglob("*") if item.is_file() and item.suffix.lower() in AUDIO_SUFFIXES]
    if not candidates:
        fail("mlx_audio did not produce an audio file")
    candidates.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    return candidates[0]


def handle_synthesize(request: dict[str, Any], model_ref: str) -> dict[str, Any]:
    text = require_string(request, "input")
    voice = optional_string(request, "voice")
    with tempfile.TemporaryDirectory(prefix="nimi-voxcpm-mlx-out-") as output_dir:
        command, temp_dirs = build_mlx_generate_command(model_ref, text, voice, output_dir)
        try:
            proc = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=180,
                check=False,
            )
        finally:
            for temp_dir in temp_dirs:
                temp_dir.cleanup()
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip() or "mlx_audio exited non-zero"
            fail(f"mlx_audio generation failed: {detail}")
        audio_path = discover_audio_output(output_dir)
        final_dir = pathlib.Path(tempfile.mkdtemp(prefix="nimi-voxcpm-mlx-artifact-"))
        final_path = final_dir / audio_path.name
        final_path.write_bytes(audio_path.read_bytes())
        return {
            "audio_path": str(final_path),
            "content_type": mimetypes.guess_type(str(final_path))[0] or "audio/wav",
        }


def build_design_handle(request: dict[str, Any]) -> dict[str, Any]:
    input_payload = request.get("input")
    if not isinstance(input_payload, dict):
        fail("voice.design requires input object")
    instruction_text = require_string(input_payload, "instruction_text")
    preferred_name = optional_string(input_payload, "preferred_name")
    handle = encode_voice_handle(
        VOICE_DESIGN_PREFIX,
        {
            "instruction_text": instruction_text,
            "preferred_name": preferred_name,
            "language": optional_string(input_payload, "language"),
            "preview_text": optional_string(input_payload, "preview_text"),
            "target_model_id": optional_string(request, "target_model_id"),
            "backend": "mlx",
        },
    )
    return {
        "voice_id": handle,
        "metadata": {
            "driver_family": "voxcpm",
            "driver_backend": "mlx",
            "handle_kind": "design",
            "preferred_name": preferred_name,
        },
    }


def build_clone_handle(request: dict[str, Any]) -> dict[str, Any]:
    input_payload = request.get("input")
    if not isinstance(input_payload, dict):
        fail("voice.clone requires input object")
    reference_audio_base64 = require_string(input_payload, "reference_audio_base64")
    handle = encode_voice_handle(
        VOICE_CLONE_PREFIX,
        {
            "reference_audio_base64": reference_audio_base64,
            "reference_audio_mime": optional_string(input_payload, "reference_audio_mime"),
            "language_hints": input_payload.get("language_hints") if isinstance(input_payload.get("language_hints"), list) else [],
            "preferred_name": optional_string(input_payload, "preferred_name"),
            "text": optional_string(input_payload, "text"),
            "target_model_id": optional_string(request, "target_model_id"),
            "backend": "mlx",
        },
    )
    return {
        "voice_id": handle,
        "metadata": {
            "driver_family": "voxcpm",
            "driver_backend": "mlx",
            "handle_kind": "clone",
            "preferred_name": optional_string(input_payload, "preferred_name"),
        },
    }


def handle_request(request: dict[str, Any], model_ref: str) -> dict[str, Any]:
    operation = require_string(request, "operation")
    if operation == "driver.preflight":
        return handle_preflight(model_ref)
    if operation == "audio.synthesize":
        return handle_synthesize(request, model_ref)
    if operation == "voice.design":
        return build_design_handle(request)
    if operation == "voice.clone":
        return build_clone_handle(request)
    fail(f"unsupported voxcpm mlx operation: {operation}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    parser.add_argument("--model", default="mlx-community/VoxCPM2-4bit")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        request = read_json(args.request)
        response = handle_request(request, str(args.model).strip() or "mlx-community/VoxCPM2-4bit")
        write_json(args.response, response)
        return 0
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

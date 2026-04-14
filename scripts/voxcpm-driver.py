#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import pathlib
import sys
import tempfile
from typing import Any


VOICE_DESIGN_PREFIX = "voxcpm:design:"
VOICE_CLONE_PREFIX = "voxcpm:clone:"


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


def decode_voice_handle(value: str) -> tuple[str, dict[str, Any] | None]:
    if value.startswith(VOICE_DESIGN_PREFIX):
        token = value[len(VOICE_DESIGN_PREFIX) :]
        return "design", decode_handle_payload(token)
    if value.startswith(VOICE_CLONE_PREFIX):
        token = value[len(VOICE_CLONE_PREFIX) :]
        return "clone", decode_handle_payload(token)
    return "", None


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


def require_string(payload: dict[str, Any], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        fail(f"missing required field: {key}")
    return value


def optional_string(payload: dict[str, Any], key: str) -> str:
    return str(payload.get(key) or "").strip()


def import_voxcpm_dependencies() -> tuple[Any, Any]:
    try:
        from voxcpm import VoxCPM  # type: ignore
    except Exception as error:
        fail(f"voxcpm import failed: {error}")
    try:
        import soundfile as sf  # type: ignore
    except Exception as error:
        fail(f"soundfile import failed: {error}")
    return VoxCPM, sf


def load_model(model_ref: str) -> Any:
    VoxCPM, _ = import_voxcpm_dependencies()
    try:
        return VoxCPM.from_pretrained(model_ref, load_denoiser=False)
    except Exception as error:
        fail(f"VoxCPM model load failed: {error}")


def generate_audio(model_ref: str, text: str, voice: str) -> tuple[bytes, int]:
    _, sf = import_voxcpm_dependencies()
    effective_text = text
    clone_temp_path: pathlib.Path | None = None
    handle_kind, handle_payload = decode_voice_handle(voice.strip()) if voice.strip() else ("", None)
    kwargs: dict[str, Any] = {
        "text": text,
        "cfg_value": 2.0,
        "inference_timesteps": 10,
    }
    if handle_kind == "design" and handle_payload is not None:
        instruction = optional_string(handle_payload, "instruction_text")
        if instruction:
            effective_text = f"({instruction}){text}"
        kwargs["text"] = effective_text
    elif handle_kind == "clone" and handle_payload is not None:
        audio_b64 = optional_string(handle_payload, "reference_audio_base64")
        if not audio_b64:
            fail("clone voice handle missing reference_audio_base64")
        try:
            audio_bytes = base64.b64decode(audio_b64.encode("ascii"))
        except Exception as error:
            fail(f"clone voice handle audio invalid: {error}")
        if not audio_bytes:
            fail("clone voice handle reference audio is empty")
        temp_dir = tempfile.TemporaryDirectory(prefix="nimi-voxcpm-clone-")
        clone_temp_path = pathlib.Path(temp_dir.name) / "reference.wav"
        clone_temp_path.write_bytes(audio_bytes)
        kwargs["reference_wav_path"] = str(clone_temp_path)
        prompt_text = optional_string(handle_payload, "text")
        if prompt_text:
            kwargs["prompt_wav_path"] = str(clone_temp_path)
            kwargs["prompt_text"] = prompt_text
        style_text = optional_string(handle_payload, "style_instruction")
        if style_text:
            kwargs["text"] = f"({style_text}){text}"

    model = load_model(model_ref)
    try:
        wav = model.generate(**kwargs)
    except Exception as error:
        fail(f"VoxCPM generation failed: {error}")
    output_path = pathlib.Path(tempfile.mkdtemp(prefix="nimi-voxcpm-audio-")) / "output.wav"
    try:
        sample_rate = int(model.tts_model.sample_rate)
        sf.write(str(output_path), wav, sample_rate)
        payload = output_path.read_bytes()
    except Exception as error:
        fail(f"VoxCPM audio write failed: {error}")
    if clone_temp_path is not None:
        try:
            clone_temp_path.unlink(missing_ok=True)
            clone_temp_path.parent.rmdir()
        except Exception:
            pass
    return payload, sample_rate


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
        },
    )
    return {
        "voice_id": handle,
        "metadata": {
            "driver_family": "voxcpm",
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
        },
    )
    return {
        "voice_id": handle,
        "metadata": {
            "driver_family": "voxcpm",
            "handle_kind": "clone",
            "preferred_name": optional_string(input_payload, "preferred_name"),
        },
    }


def handle_synthesize(request: dict[str, Any], model_ref: str) -> dict[str, Any]:
    text = require_string(request, "input")
    voice = optional_string(request, "voice")
    audio, _sample_rate = generate_audio(model_ref, text, voice)
    output_path = pathlib.Path(tempfile.mkdtemp(prefix="nimi-voxcpm-out-")) / "speech.wav"
    output_path.write_bytes(audio)
    return {
        "audio_path": str(output_path),
        "content_type": "audio/wav",
    }


def handle_request(request: dict[str, Any], model_ref: str) -> dict[str, Any]:
    operation = require_string(request, "operation")
    if operation == "audio.synthesize":
        return handle_synthesize(request, model_ref)
    if operation == "voice.design":
        return build_design_handle(request)
    if operation == "voice.clone":
        return build_clone_handle(request)
    fail(f"unsupported voxcpm operation: {operation}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    parser.add_argument("--model", default="openbmb/VoxCPM2")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        request = read_json(args.request)
        response = handle_request(request, str(args.model).strip() or "openbmb/VoxCPM2")
        write_json(args.response, response)
        return 0
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

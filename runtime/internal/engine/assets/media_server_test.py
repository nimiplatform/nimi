from __future__ import annotations

import importlib.util
import os
import pathlib
import sys
import unittest


def load_media_server_module():
    old_mode = os.environ.get("NIMI_MEDIA_MODE")
    os.environ["NIMI_MEDIA_MODE"] = "pipeline_supervised"
    module_path = pathlib.Path(__file__).with_name("media_server.py")
    spec = importlib.util.spec_from_file_location("media_server_under_test", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        if old_mode is None:
            os.environ.pop("NIMI_MEDIA_MODE", None)
        else:
            os.environ["NIMI_MEDIA_MODE"] = old_mode
    return module


MEDIA_SERVER = load_media_server_module()


class MediaServerLocalFileBoundaryTests(unittest.TestCase):
    def test_image_pipeline_rejects_remote_model_identifier(self) -> None:
        with self.assertRaisesRegex(ValueError, "managed image model must be a local directory"):
            MEDIA_SERVER._flux_pipeline("black-forest-labs/FLUX.1-schnell")

    def test_video_pipeline_rejects_remote_model_identifier(self) -> None:
        with self.assertRaisesRegex(ValueError, "managed video model must be a local directory"):
            MEDIA_SERVER._wan_pipeline("Wan-AI/Wan2.1-T2V-1.3B-Diffusers", False)

    def test_load_image_rejects_file_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "file URLs are not admitted media inputs"):
            MEDIA_SERVER._load_image_from_uri("file:///tmp/secret.png")

    def test_load_image_rejects_bare_local_path(self) -> None:
        with self.assertRaisesRegex(ValueError, "bare local paths are not admitted media inputs"):
            MEDIA_SERVER._load_image_from_uri("../../secret.png")

    def test_load_image_rejects_unsupported_local_like_scheme(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported media input URL scheme"):
            MEDIA_SERVER._load_image_from_uri("c:/Users/example/secret.png")

    def test_generate_image_requires_configured_default_when_model_omitted(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "NIMI_MEDIA_DEFAULT_IMAGE_MODEL is required"):
            MEDIA_SERVER._generate_image("", {"prompt": "a lantern"})

    def test_generate_video_requires_configured_default_when_model_omitted(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "NIMI_MEDIA_DEFAULT_VIDEO_MODEL is required"):
            MEDIA_SERVER._generate_video("", {"prompt": "a lantern"})


if __name__ == "__main__":
    unittest.main()

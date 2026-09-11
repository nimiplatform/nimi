import importlib.util
import io
from fractions import Fraction
from pathlib import Path
import tempfile
import unittest

from face_swap import FaceSwapError
from face_swap_video import inspect_video, replace_video


class NoFaceModel:
    """Isolate the model boundary; these tests verify real codec output only."""

    def prepare_reference(self, *_args):
        return None

    def replace_frame(self, *_args):
        raise FaceSwapError("AI_FACE_TARGET_MISSING", "No target in the codec fixture")

    def clear_request_state(self):
        pass


@unittest.skipUnless(importlib.util.find_spec("av") and importlib.util.find_spec("numpy"), "PyAV codec dependencies are required")
class FaceSwapVideoAspectTests(unittest.TestCase):
    def video_input(self, ratio, rotation):
        import av
        import numpy as np

        body = io.BytesIO()
        with av.open(body, "w", format="mp4") as container:
            stream = container.add_stream("libx264", rate=25)
            stream.width, stream.height, stream.pix_fmt = 720, 576, "yuv420p"
            if ratio is not None:
                stream.codec_context.sample_aspect_ratio = ratio
            stream.set_display_rotation(rotation)
            stream.options = {"bf": "0", "preset": "ultrafast"}
            pixels = np.zeros((576, 720, 3), dtype=np.uint8)
            pixels[:, :240, 0] = 180
            pixels[:192, :, 1] = 90
            for index in range(25):
                frame = av.VideoFrame.from_ndarray(pixels, format="rgb24")
                frame.pts, frame.time_base = index, Fraction(1, 25)
                container.mux(stream.encode(frame))
            container.mux(stream.encode())
        return body.getvalue()

    def test_encoded_display_geometry_survives_pixel_rotation(self):
        import av

        for ratio, rotation in [(None, 0), (Fraction(16, 15), 0), (Fraction(16, 15), 90), (Fraction(16, 15), 270)]:
            with self.subTest(ratio=ratio, rotation=rotation), tempfile.TemporaryDirectory() as directory:
                original = ratio or Fraction(1, 1)
                expected_ratio = 1 / original if rotation in (90, 270) else original
                expected_size = (576, 720) if rotation in (90, 270) else (720, 576)
                source, target = Path(directory) / "input.mp4", Path(directory) / "output.mp4"
                source.write_bytes(self.video_input(ratio, rotation))
                info = inspect_video(source.read_bytes())
                self.assertEqual(info["rotation"], rotation)
                summary = replace_video(NoFaceModel(), b"", str(source), str(target), {}, "preserve_frame", lambda *_: None)
                self.assertEqual((summary["frames_total"], summary["frames_transformed"], summary["frames_preserved"]), (25, 0, 25))
                with av.open(str(target)) as output:
                    stream = output.streams.video[0]
                    self.assertEqual((stream.width, stream.height), expected_size)
                    self.assertEqual(stream.sample_aspect_ratio or Fraction(1, 1), expected_ratio)
                    self.assertEqual(Fraction(stream.width, stream.height) * (stream.sample_aspect_ratio or 1), Fraction(*expected_size) * expected_ratio)
                    frames = list(output.decode(stream))
                    self.assertEqual(len(frames), 25)
                    self.assertTrue(all(frame.rotation == 0 for frame in frames))
                    self.assertEqual([frame.pts * frame.time_base for frame in frames], [Fraction(index, 25) for index in range(25)])


if __name__ == "__main__":
    unittest.main()

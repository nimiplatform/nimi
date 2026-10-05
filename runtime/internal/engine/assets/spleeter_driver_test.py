import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location('spleeter_driver', Path(__file__).with_name('spleeter_driver.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

class SpleeterCanonicalWavTest(unittest.TestCase):
    def test_complete_float_wav_fact_and_sample_identity(self):
        samples = np.array([[.1, -.2], [.3, .4]], dtype=np.float32)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'stem.wav'
            adapter.write_float_wav(path, samples)
            data = path.read_bytes()
            self.assertEqual(len(data), 58 + samples.nbytes)
            self.assertEqual(struct.unpack_from('<I', data, 4)[0] + 8, len(data))
            self.assertEqual(data[38:42], b'fact')
            self.assertEqual(struct.unpack_from('<I', data, 46)[0], len(samples))
            self.assertEqual(data[50:54], b'data')
            self.assertEqual(data[58:], samples.astype('<f4').tobytes())
    def test_nonfinite_and_wrong_channel_stems_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'stem.wav'
            for samples in [np.array([[np.nan, 0]], dtype=np.float32), np.zeros((2, 1), dtype=np.float32)]:
                with self.assertRaises(ValueError): adapter.write_float_wav(path, samples)
                self.assertFalse(path.exists())

if __name__ == '__main__': unittest.main()

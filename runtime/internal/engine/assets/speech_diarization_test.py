import unittest
import speech_diarization as driver


class SourceTimeTests(unittest.TestCase):
    metadata = {"sample_rate": "16000", "window_size": "160000",
                "receptive_field_size": "991", "receptive_field_shift": "270"}

    def test_actual_eight_second_source_intersection_preserves_other_raw_endpoints(self):
        # Recorded actual pinned model output from the retained source fixture.
        raw = [{"start": 0.6215937733650208, "end": 6.814718723297119, "speaker": 1},
               {"start": 7.017219066619873, "end": 8.029719352722168, "speaker": 2}]
        result = driver.normalize_intervals(raw, 128000, self.metadata)
        self.assertEqual(result["duration_seconds"], 8)
        self.assertEqual(result["intervals"][0]["end_seconds"], raw[0]["end"])
        self.assertEqual(result["intervals"][1]["start_seconds"], raw[1]["start"])
        self.assertEqual(result["intervals"][1]["end_seconds"], 8)
        self.assertEqual(raw[1]["end"], 8.029719352722168)

    def test_only_known_padding_is_omitted_and_bad_output_never_clamps_into_success(self):
        self.assertEqual(driver.normalize_intervals([{"start": 9, "end": 9.5, "speaker": 1}], 128000, self.metadata)["intervals"], [])
        for start, end, speaker in [(-1, 1, 0), (1, 999999, 0), (1, 1, 0), (float("nan"), 2, 0), (1, float("inf"), 0), (1, 2, -1)]:
            with self.subTest(start=start, end=end, speaker=speaker), self.assertRaises(RuntimeError):
                driver.normalize_intervals([{"start": start, "end": end, "speaker": speaker}], 128000, self.metadata)
        with self.assertRaises(RuntimeError):
            driver.normalize_intervals([{"start": 2, "end": 3, "speaker": 0}, {"start": 1, "end": 2, "speaker": 1}], 128000, self.metadata)

    def test_actual_overlapping_source_intervals_remain_overlapping(self):
        raw = [{"start": 1, "end": 3, "speaker": 0}, {"start": 2, "end": 4, "speaker": 1}]
        result = driver.normalize_intervals(raw, 160000, self.metadata)
        self.assertEqual(result["intervals"][0]["end_seconds"], 3)
        self.assertEqual(result["intervals"][1]["start_seconds"], 2)


if __name__ == "__main__":
    unittest.main()

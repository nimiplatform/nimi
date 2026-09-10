import importlib.util
import json
import pathlib
import tempfile
import unittest

from vision_locate import LocateError, MLXLocator, MAX_WIRE_RESPONSE_BYTES, locate_prompt, parse_locations


class LocateOutputTests(unittest.TestCase):
    def test_dense_shared_label_output_is_not_limited_by_json_at_proto_size(self):
        label = "target" * 42 + "name"
        text = "<ref>" + label + "</ref>" + "".join(
            f"<box><{x}><234><999><678></box>" for x in range(100, 954)
        ) + "<|im_end|>"
        locations = parse_locations(text, "BOX", complete=True)
        self.assertEqual(len(locations), 854)
        self.assertEqual(locations[-1], {"box": [0.953, 0.234, 0.999, 0.678], "label": label})
        # The Go Host owns the actual protobuf-size check. The parser must not
        # mistake this wire representation for that public encoding.
        self.assertGreater(len(json.dumps(locations).encode()), 256 * 1024)
        self.assertLess(len(json.dumps(locations).encode()), MAX_WIRE_RESPONSE_BYTES)

    def test_mlx_checkpoint_cannot_select_code_even_before_loader_import(self):
        with tempfile.TemporaryDirectory() as directory:
            model_dir = pathlib.Path(directory)
            (model_dir / "checkpoint.py").write_text("raise AssertionError('must not execute')", encoding="utf-8")
            for value in ("checkpoint.py", "", None):
                with self.subTest(model_file=value):
                    (model_dir / "config.json").write_text(json.dumps({"model_type": "locateanything", "model_file": value}), encoding="utf-8")
                    with self.assertRaises(LocateError) as caught:
                        MLXLocator(model_dir)
                    self.assertEqual(caught.exception.reason, "AI_LOCAL_EXECUTION_LOAD_FAILED")
                    self.assertIn("model_file", str(caught.exception))

    def test_box_point_and_explicit_negative(self):
        self.assertEqual(
            parse_locations("<ref>cat</ref><box><10><20><300><400></box><|im_end|>", "BOX", complete=True),
            [{"label": "cat", "box": [0.01, 0.02, 0.3, 0.4]}],
        )
        self.assertEqual(parse_locations("<box><250><750></box>", "POINT", complete=True), [{"point": [0.25, 0.75]}])
        self.assertEqual(parse_locations("<ref>cat</ref><box>None</box><null><|im_end|>", "BOX", complete=True), [])

    def test_complete_box_at_budget_limit_is_not_success(self):
        with self.assertRaises(LocateError):
            parse_locations("<box><1><2><3><4></box>", "BOX", complete=False)

    def test_invalid_tail_refusal_and_empty_are_not_negative(self):
        for text in ("", "I cannot comply.", "<ref>cat</ref>", "<box><1><2><3><4></box>broken",
                     "<box>None</box><|im_end|><box>None</box>"):
            with self.subTest(text=text), self.assertRaises(LocateError):
                parse_locations(text, "BOX", complete=True)

    def test_reversed_degenerate_wrong_geometry_and_out_of_range(self):
        for text, geometry in (
            ("<box><800><800><200><200></box>", "BOX"),
            ("<box><100><100><100><200></box>", "BOX"),
            ("<box><10><20></box>", "BOX"),
            ("<box><10><20><30><40></box>", "POINT"),
            ("<box><1001><20></box>", "POINT"),
        ):
            with self.subTest(text=text), self.assertRaises(LocateError):
                parse_locations(text, geometry, complete=True)

    def test_labels_carry_only_the_model_label(self):
        self.assertEqual(
            parse_locations("<box><1><2></box><box><3><4></box>", "POINT", complete=True),
            [{"point": [0.001, 0.002]}, {"point": [0.003, 0.004]}],
        )

    def test_query_mapping_is_geometry_specific(self):
        self.assertEqual(locate_prompt("the green button", "POINT"), "Point to: the green button.")
        with self.assertRaises(LocateError):
            locate_prompt(" ", "BOX")


@unittest.skipUnless(importlib.util.find_spec("torch") and importlib.util.find_spec("transformers"),
                     "requires the installed Locate dependency profile")
class LocateAttentionTests(unittest.TestCase):
    def test_fused_input_shape_preserves_single_and_packed_image_attention(self):
        import torch
        import torch.nn.functional as functional
        from locateanything_loader.modeling_vit import sdpa_attention

        generator = torch.Generator().manual_seed(17)
        q, k, v = [torch.randn(12, 2, 8, generator=generator, dtype=torch.float64) for _ in range(3)]
        for boundaries in ([0, 12], [0, 5, 12]):
            with self.subTest(boundaries=boundaries):
                mask = torch.zeros(1, 12, 12, dtype=torch.bool)
                for start, end in zip(boundaries, boundaries[1:]):
                    mask[:, start:end, start:end] = True
                expected = functional.scaled_dot_product_attention(
                    q.transpose(0, 1), k.transpose(0, 1), v.transpose(0, 1), mask,
                ).transpose(0, 1).reshape(12, -1)
                actual = sdpa_attention(q, k, v, torch.tensor(boundaries), torch.tensor(boundaries))
                torch.testing.assert_close(actual, expected, rtol=1e-10, atol=1e-10)


if __name__ == "__main__":
    unittest.main()

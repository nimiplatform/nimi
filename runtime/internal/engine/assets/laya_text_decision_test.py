import importlib.util
import json
import math
import os
import unittest
from pathlib import Path

from laya_text_decision import (
    DecisionError,
    DecisionWorker,
    TokenizerView,
    answer,
    decode_content,
    decode_request,
    encode_question,
    softmax,
    upstream_questions,
)


class FakeTokenizer:
    """Whitespace tokenizer with a closed vocabulary, standing in for the HF tokenizer."""

    cls_token_id, sep_token_id, mask_token_id, pad_token_id = 1, 2, 3, 0

    def __init__(self):
        self.vocab = {}
        self.calls = []

    def __call__(self, text, **kwargs):
        self.calls.append((text, kwargs))
        return {"input_ids": [self.vocab.setdefault(word, 100 + len(self.vocab)) for word in text.split()]}


def question(qid, instructions, **kind):
    return {"id": qid, "instructions": instructions, **kind}


class ContentMappingTests(unittest.TestCase):
    def test_text_passes_through_and_json_keeps_submitted_member_order(self):
        self.assertEqual(decode_content({"text": " keep <mask> as is "}, required=True), " keep <mask> as is ")
        parsed = decode_content({"json": '{"zeta": 1, "alpha": [true, null, "ü"]}'}, required=True)
        self.assertEqual(list(parsed), ["zeta", "alpha"])
        self.assertIsNone(decode_content(None, required=False))

    def test_invalid_content_is_rejected(self):
        for content in ({"json": '{"a": 1, "a": 2}'}, {"json": "[NaN]"}, {"json": "1"}, {"json": '"text"'},
                        {"text": "  "}, {"text": "a", "json": "[]"}, {}, {"json": "{"}):
            with self.subTest(content=content):
                with self.assertRaises(DecisionError) as raised:
                    decode_content(content, required=True)
                self.assertEqual(raised.exception.reason, "AI_INPUT_INVALID")
        with self.assertRaises(DecisionError):
            decode_content(None, required=True)

    def test_questions_map_to_upstream_internal_form_in_submitted_order(self):
        mapped = upstream_questions([
            question("pick", {"json": '{"goal": "Größe", "n": 2}'}, choice={"candidates": [
                {"id": "b", "description": {"text": "second"}}, {"id": "a"}, {"id": "c", "description": {"json": '{"k": [1, 2]}'}},
            ]}),
            question("holds", {"text": "Is it relevant?"}, boolean={"true_criterion": {"text": "yes it is"}}),
            question("plain", {"text": "Default wording?"}, boolean={}),
        ])
        self.assertEqual([qid for qid, _ in mapped], ["pick", "holds", "plain"])
        choice = mapped[0][1]
        self.assertEqual(choice["t"], "choice")
        # Non-string instructions use the upstream Unicode JSON rendering.
        self.assertEqual(choice["ins"], '{"goal": "Größe", "n": 2}')
        self.assertEqual(list(choice["crit"]), ["b", "a", "c"])
        self.assertEqual(choice["crit"], {"b": "second", "a": None, "c": {"k": [1, 2]}})
        self.assertEqual(mapped[1][1], {"t": "noul", "ins": "Is it relevant?", "crit": {"true": "yes it is"}})
        self.assertEqual(mapped[2][1]["crit"], {})

    def test_malformed_questions_are_rejected(self):
        good = {"candidates": [{"id": "a"}, {"id": "b"}]}
        cases = [
            [],
            [question("q", {"text": "x"}, choice=good)] * 2,
            [question("q", {"text": "x"}, choice={"candidates": [{"id": "a"}]})],
            [question("q", {"text": "x"}, choice={"candidates": [{"id": "a"}, {"id": "a"}]})],
            [question("q", {"text": "x"})],
            [question("q", {"text": "x"}, choice=good, boolean={})],
            [question("q", {"text": "x"}, boolean={"maybe": {"text": "no"}})],
            [{"id": "q", "instructions": {"text": "x"}, "choice": good, "extra": 1}],
        ]
        for questions in cases:
            with self.subTest(questions=questions):
                with self.assertRaises(DecisionError) as raised:
                    upstream_questions(questions)
                self.assertEqual(raised.exception.reason, "AI_INPUT_INVALID")


class EncodingTests(unittest.TestCase):
    def setUp(self):
        self.tokenizer = FakeTokenizer()
        self.tokens = TokenizerView(self.tokenizer)

    def test_sequence_matches_upstream_layout_without_truncation(self):
        state_ids = self.tokens.ids("s1 s2 s3")
        long_option = " ".join(f"w{i}" for i in range(300))
        long_instructions = " ".join(f"i{i}" for i in range(500))
        item = encode_question(self.tokens, 0, "choice", long_instructions, ["a: short", long_option], state_ids, 8192)
        ids = item["ids"]
        head = self.tokens.ids("choice question: " + long_instructions)
        self.assertEqual(ids[: len(head) + 2], [1] + head + [2])
        first = item["markers"][0]
        self.assertEqual(first, len(head) + 2)
        self.assertEqual(ids[first], 3)
        second = item["markers"][1]
        self.assertEqual(ids[second], 3)
        # No upstream 48-token option cap or head_max_len cropping.
        self.assertEqual(ids[second + 1: second + 1 + 300], self.tokens.ids(" " + long_option))
        self.assertEqual(ids[second + 301:], [2] + state_ids + [2])
        self.assertEqual(item["qtype"], 0)

    def test_content_is_tokenized_with_special_token_text_as_ordinary_text(self):
        self.tokens.ids("[MASK] <mask>")
        text, kwargs = self.tokenizer.calls[-1]
        self.assertEqual(text, "[MASK] <mask>")
        self.assertEqual(kwargs, {"add_special_tokens": False, "split_special_tokens": True})

    def test_complete_sequence_over_encoder_positions_is_a_typed_limit(self):
        state_ids = self.tokens.ids(" ".join(f"s{i}" for i in range(20)))
        encode_question(self.tokens, 0, "noul", "q", ["false: no", "true: yes"], state_ids, 33)
        with self.assertRaises(DecisionError) as raised:
            encode_question(self.tokens, 4, "noul", "q", ["false: no", "true: yes"], state_ids, 32)
        self.assertEqual(raised.exception.reason, "AI_INPUT_LIMIT_EXCEEDED")
        self.assertEqual(raised.exception.facts, {"question_index": 4, "required_positions": 33, "max_positions": 32})

    def test_lone_surrogates_are_invalid_content(self):
        with self.assertRaises(DecisionError) as raised:
            encode_question(self.tokens, 0, "noul", json.loads('"\\ud800"'), ["false: a", "true: b"], [], 100)
        self.assertEqual(raised.exception.reason, "AI_INPUT_INVALID")


class ProbabilityTests(unittest.TestCase):
    def test_softmax_is_unrounded_float64_after_temperature(self):
        probabilities = softmax([1.0, 2.0, 0.5], 2.0)
        expected = [math.exp(v / 2.0) for v in (1.0, 2.0, 0.5)]
        total = math.fsum(expected)
        for got, want in zip(probabilities, expected):
            self.assertAlmostEqual(got, want / total, places=15)
        self.assertNotEqual(round(probabilities[0], 4), probabilities[0])

    def test_choice_selects_first_maximum_and_keeps_submitted_order(self):
        mapped = upstream_questions([question("q", {"text": "x"}, choice={"candidates": [{"id": "z"}, {"id": "y"}, {"id": "x"}]})])
        result = answer("q", mapped[0][1], [0.25, 0.375, 0.375])
        self.assertEqual(result, {"question_id": "q", "choice": {"selected_candidate_id": "y", "probabilities": [0.25, 0.375, 0.375]}})

    def test_boolean_returns_true_option_probability(self):
        mapped = upstream_questions([question("q", {"text": "x"}, boolean={})])
        self.assertEqual(answer("q", mapped[0][1], [0.3, 0.7]), {"question_id": "q", "boolean": {"true_probability": 0.7}})

    def test_non_finite_logits_are_output_errors(self):
        with self.assertRaises(DecisionError) as raised:
            softmax([float("nan"), 1.0], 1.0)
        self.assertEqual(raised.exception.reason, "AI_OUTPUT_INVALID")


class FakeCheckpoint:
    def __init__(self, model_dir, device):
        self.model_dir, self.device = model_dir, device

    def decide(self, state, questions):
        answers = []
        for qid, q in questions:
            probabilities = [1.0 / len(q["crit"])] * len(q["crit"]) if q["t"] == "choice" else [0.4, 0.6]
            answers.append(answer(qid, q, probabilities))
        return answers, 7


class WorkerTests(unittest.TestCase):
    def request(self, model_dir, content_id="sha256:abc", device="cpu"):
        return {
            "model_dir": model_dir, "model_content_id": content_id, "profile_digest": "p" * 64, "device": device,
            "request": {"state": {"text": "state"}, "questions": [question("q", {"text": "x"}, boolean={})]},
        }

    def test_same_identity_reuses_loaded_checkpoint_and_changed_identity_is_refused(self):
        loads = []

        def loader(model_dir, device):
            loads.append((model_dir, device))
            return FakeCheckpoint(model_dir, device)

        worker = DecisionWorker(loader)
        root = str(Path.cwd().resolve())
        first = worker.run(self.request(root))
        worker.run(self.request(root))
        self.assertEqual(len(loads), 1)
        self.assertEqual(first["result"], {"answers": [{"question_id": "q", "boolean": {"true_probability": 0.6}}]})
        self.assertEqual(first["usage"]["input_tokens"], 7)
        with self.assertRaises(DecisionError) as raised:
            worker.run(self.request(root, content_id="sha256:changed"))
        self.assertEqual(raised.exception.reason, "AI_LOCAL_EXECUTION_LOAD_FAILED")

    def test_invalid_input_fails_before_checkpoint_loading(self):
        worker = DecisionWorker(lambda *_: self.fail("loaded"))
        request = self.request(str(Path.cwd().resolve()))
        request["request"]["questions"] = []
        with self.assertRaises(DecisionError) as raised:
            worker.run(request)
        self.assertEqual(raised.exception.reason, "AI_INPUT_INVALID")
        for bad in ({**self.request("relative")}, {**self.request(str(Path.cwd().resolve()), device="mps")}):
            with self.assertRaises(DecisionError) as raised:
                worker.run(bad)
            self.assertEqual(raised.exception.reason, "AI_LOCAL_EXECUTION_LOAD_FAILED")

    def test_request_transport_is_strict_utf8_json(self):
        self.assertEqual(decode_request('{"a":"ü"}'.encode("utf-8")), {"a": "ü"})
        for body in (b"\xff\xfe", b'{"a":1,"a":2}', b"[Infinity]"):
            with self.assertRaises(DecisionError):
                decode_request(body)


@unittest.skipUnless(importlib.util.find_spec("laya") and importlib.util.find_spec("transformers") and os.environ.get("NIMI_LAYA_TEST_MODEL"),
                     "requires the managed Laya profile and NIMI_LAYA_TEST_MODEL checkpoint directory")
class UpstreamParityTests(unittest.TestCase):
    def test_untruncated_encoding_equals_upstream_build_sequence(self):
        from laya.common import build_sequence, render_options, serialize_state
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(str(Path(os.environ["NIMI_LAYA_TEST_MODEL"]) / "tokenizer"), local_files_only=True)
        tokens = TokenizerView(tokenizer)
        state = {"request": "latest rust async runtime news", "now": "2026-09-24", "ünï": ["cödé", 1.5]}
        for mapped in upstream_questions([
            question("w", {"text": "Which window?"}, choice={"candidates": [
                {"id": "any", "description": {"text": "any time"}}, {"id": "day"}, {"id": "week", "description": {"json": '{"days": 7}'}},
            ]}),
            question("r", {"json": '{"ask": "relevant?"}'}, boolean={"false_criterion": {"text": "off topic"}}),
        ]):
            _qid, q = mapped
            ids, markers = build_sequence(tokenizer, state, q, max_len=8192, head_max_len=4096)
            item = encode_question(tokens, 0, q["t"], q["ins"], render_options(q), tokens.ids(serialize_state(state)), 8192)
            self.assertEqual(item["ids"], ids)
            self.assertEqual(item["markers"], markers)


if __name__ == "__main__":
    unittest.main()

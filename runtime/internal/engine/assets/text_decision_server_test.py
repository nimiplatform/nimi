import importlib.util
import json
import sys
import unittest
from pathlib import Path

from laya_text_decision import DecisionError, DecisionWorker, answer


def installed(name: str) -> bool:
    # Other suites may leave spec-less stand-ins for web modules in sys.modules.
    module = sys.modules.get(name)
    if module is not None:
        return getattr(module, "__spec__", None) is not None and getattr(module, "__file__", None) is not None
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


@unittest.skipUnless(installed("fastapi") and installed("starlette") and installed("httpx"), "requires the managed Laya profile web stack")
class DecisionServerTests(unittest.TestCase):
    def setUp(self):
        from fastapi.testclient import TestClient
        from text_decision_server import create_app

        self.loads = []

        class Checkpoint:
            def __init__(inner, model_dir, device):
                self.loads.append((model_dir, device))

            def decide(inner, state, questions):
                if isinstance(state, str) and state == "too long":
                    raise DecisionError("AI_INPUT_LIMIT_EXCEEDED", "limit", question_index=0, required_positions=9, max_positions=8)
                return [answer(qid, q, [0.25, 0.75]) for qid, q in questions], 5

        self.client = TestClient(create_app("secret", DecisionWorker(Checkpoint)))

    def body(self, state="ü state"):
        return json.dumps({
            "model_dir": str(Path(__file__).resolve().parent), "model_content_id": "sha256:x",
            "profile_digest": "p" * 64, "device": "cpu",
            "request": {"state": {"text": state}, "questions": [{"id": "q", "instructions": {"text": "x"}, "boolean": {}}]},
        }, ensure_ascii=False).encode("utf-8")

    def test_health_names_the_protocol(self):
        response = self.client.get("/health")
        self.assertEqual(response.json()["protocol"], "nimi-text-decide/1")

    def test_admission_token_is_required(self):
        response = self.client.post("/v1/text/decide", content=self.body())
        self.assertEqual(response.status_code, 403)

    def test_success_and_typed_failures_are_utf8_json(self):
        headers = {"x-nimi-decision-token": "secret", "content-type": "application/json; charset=utf-8"}
        ok = self.client.post("/v1/text/decide", content=self.body(), headers=headers)
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.headers["content-type"], "application/json; charset=utf-8")
        self.assertEqual(ok.json()["result"]["answers"][0]["boolean"]["true_probability"], 0.75)
        limit = self.client.post("/v1/text/decide", content=self.body("too long"), headers=headers)
        self.assertEqual(limit.status_code, 422)
        self.assertEqual(limit.json(), {"reason_code": "AI_INPUT_LIMIT_EXCEEDED", "detail": "limit", "question_index": 0, "required_positions": 9, "max_positions": 8})
        invalid = self.client.post("/v1/text/decide", content=b"\xff", headers=headers)
        self.assertEqual((invalid.status_code, invalid.json()["reason_code"]), (422, "AI_INPUT_INVALID"))
        self.assertEqual(len(self.loads), 1)


if __name__ == "__main__":
    unittest.main()

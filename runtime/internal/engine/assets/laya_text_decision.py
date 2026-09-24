from __future__ import annotations

# @nimi-authority: rule.nimi.runtime.ai-provider.laya-local-decision

import json
import math
import os
import sys
import time
from pathlib import Path
from typing import Any

# The Worker loads only captured files. These are also set by the Host.
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("USE_TF", "0")

PROTOCOL = "nimi-text-decide/1"
MAX_QUESTIONS = 64
MIN_CANDIDATES = 2
MAX_CANDIDATES = 255
# Private JSON transport bounds. Runtime alone owns the public request limits.
MAX_REQUEST_BYTES = 8 * 1024 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DEVICES = ("cuda", "cpu")
# Upstream Laya question type indices (laya.common.QTYPES); text.decide
# exposes only choice and the boolean "noul" type.
QUESTION_TYPES = {"choice": 0, "noul": 2}

_REQUEST_FIELDS = {"model_dir", "model_content_id", "profile_digest", "device", "request"}
_SPEC_FIELDS = {"state", "questions"}
_QUESTION_FIELDS = {"id", "instructions", "choice", "boolean"}
_CANDIDATE_FIELDS = {"id", "description"}
_BOOLEAN_FIELDS = {"true_criterion", "false_criterion"}


class DecisionError(ValueError):
    """Typed Worker failure; reason is a Runtime ReasonCode name."""

    def __init__(self, reason: str, detail: str, **facts: Any):
        super().__init__(detail)
        self.reason = reason
        self.facts = facts

    def payload(self) -> dict[str, Any]:
        return {"reason_code": self.reason, "detail": str(self), **self.facts}


def _invalid(detail: str) -> DecisionError:
    return DecisionError("AI_INPUT_INVALID", detail)


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _reject_constant(value: str) -> Any:
    raise ValueError(f"non-standard JSON constant {value}")


def strict_json_loads(text: str) -> Any:
    """Parse strict JSON, preserving object member order and rejecting duplicate keys."""
    return json.loads(text, object_pairs_hook=_unique_object, parse_constant=_reject_constant)


def decode_content(content: Any, *, required: bool) -> str | dict | list | None:
    """Return App content as upstream Laya consumes it: text as the string, JSON as its parsed value."""
    if content is None:
        if required:
            raise _invalid("Decision content is required")
        return None
    if not isinstance(content, dict) or len(content) != 1:
        raise _invalid("Decision content must be exactly one text or JSON value")
    if "text" in content:
        value = content["text"]
        if not isinstance(value, str) or not value.strip():
            raise _invalid("Decision text content must be nonblank")
        return value
    if "json" in content:
        raw = content["json"]
        if not isinstance(raw, str):
            raise _invalid("Decision JSON content must be serialized JSON")
        try:
            value = strict_json_loads(raw)
        except (ValueError, RecursionError) as error:
            raise _invalid("Decision JSON content is not strict JSON") from error
        if not isinstance(value, (dict, list)):
            raise _invalid("Decision JSON content must be an object or array")
        return value
    raise _invalid("Decision content must be exactly one text or JSON value")


def upstream_questions(questions: Any) -> list[tuple[str, dict[str, Any]]]:
    """Map submitted questions, in order, to upstream Laya internal question dicts."""
    if not isinstance(questions, list) or not 1 <= len(questions) <= MAX_QUESTIONS:
        raise _invalid("Decision requires 1 to 64 questions")
    result: list[tuple[str, dict[str, Any]]] = []
    seen: set[str] = set()
    for question in questions:
        if not isinstance(question, dict) or not set(question) <= _QUESTION_FIELDS:
            raise _invalid("Decision question has an unsupported shape")
        question_id = question.get("id")
        if not isinstance(question_id, str) or not question_id or question_id in seen:
            raise _invalid("Decision question IDs must be unique and nonempty")
        seen.add(question_id)
        instructions = decode_content(question.get("instructions"), required=True)
        # Upstream Agent._to_internal: non-string instructions become Unicode JSON.
        ins = instructions if isinstance(instructions, str) else json.dumps(instructions, ensure_ascii=False)
        choice, boolean = question.get("choice"), question.get("boolean")
        if (choice is None) == (boolean is None):
            raise _invalid("Decision question must be exactly one choice or boolean")
        if choice is not None:
            if not isinstance(choice, dict) or set(choice) != {"candidates"}:
                raise _invalid("Decision choice has an unsupported shape")
            candidates = choice["candidates"]
            if not isinstance(candidates, list) or not MIN_CANDIDATES <= len(candidates) <= MAX_CANDIDATES:
                raise _invalid("Decision choice requires 2 to 255 candidates")
            criteria: dict[str, Any] = {}
            for candidate in candidates:
                if not isinstance(candidate, dict) or not set(candidate) <= _CANDIDATE_FIELDS:
                    raise _invalid("Decision candidate has an unsupported shape")
                candidate_id = candidate.get("id")
                if not isinstance(candidate_id, str) or not candidate_id or candidate_id in criteria:
                    raise _invalid("Decision candidate IDs must be unique and nonempty")
                criteria[candidate_id] = decode_content(candidate.get("description"), required=False)
            result.append((question_id, {"t": "choice", "ins": ins, "crit": criteria}))
            continue
        if not isinstance(boolean, dict) or not set(boolean) <= _BOOLEAN_FIELDS:
            raise _invalid("Decision boolean has an unsupported shape")
        criteria = {}
        for key, field in (("true", "true_criterion"), ("false", "false_criterion")):
            value = decode_content(boolean.get(field), required=False)
            if value is not None:
                criteria[key] = value
        result.append((question_id, {"t": "noul", "ins": ins, "crit": criteria}))
    return result


def utf8_text(text: str) -> str:
    try:
        text.encode("utf-8")
    except UnicodeEncodeError as error:
        raise _invalid("Decision content contains invalid Unicode") from error
    return text


class TokenizerView:
    """Tokenizes content pieces exactly, treating literal special-token text as ordinary text."""

    def __init__(self, tokenizer: Any):
        self._tokenizer = tokenizer
        ids = (tokenizer.cls_token_id, tokenizer.sep_token_id, tokenizer.mask_token_id, tokenizer.pad_token_id)
        if any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in ids):
            raise DecisionError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Captured tokenizer has no complete special-token vocabulary")
        self.cls_id, self.sep_id, self.mask_id, self.pad_id = ids

    def ids(self, text: str) -> list[int]:
        encoded = self._tokenizer(text, add_special_tokens=False, split_special_tokens=True)
        return list(encoded["input_ids"])


def encode_question(tokens: Any, index: int, question_type: str, instructions: str, options: list[str],
                    state_ids: list[int], max_positions: int) -> dict[str, Any]:
    """Encode the upstream Laya sequence without any truncation.

    [CLS] "<type> question: <instructions>" [SEP] ([MASK] " <option>")* [SEP] <state> [SEP]
    """
    head = tokens.ids(utf8_text("%s question: %s" % (question_type, instructions)))
    ids = [tokens.cls_id] + head + [tokens.sep_id]
    markers = []
    for option in options:
        markers.append(len(ids))
        ids.append(tokens.mask_id)
        ids.extend(tokens.ids(utf8_text(" " + option)))
    ids.append(tokens.sep_id)
    ids.extend(state_ids)
    ids.append(tokens.sep_id)
    if len(ids) > max_positions:
        raise DecisionError(
            "AI_INPUT_LIMIT_EXCEEDED",
            "Decision question %d requires %d encoder positions; the captured encoder admits %d" % (index, len(ids), max_positions),
            question_index=index, required_positions=len(ids), max_positions=max_positions,
        )
    return {"ids": ids, "markers": markers, "qtype": QUESTION_TYPES[question_type]}


def softmax(logits: list[float], temperature: float) -> list[float]:
    """Unrounded float64 softmax of temperature-scaled option logits."""
    scaled = [float(value) / float(temperature) for value in logits]
    if not scaled or not all(math.isfinite(value) for value in scaled):
        raise DecisionError("AI_OUTPUT_INVALID", "Decision model returned non-finite option logits")
    peak = max(scaled)
    weights = [math.exp(value - peak) for value in scaled]
    total = math.fsum(weights)
    probabilities = [weight / total for weight in weights]
    if not all(math.isfinite(value) and 0.0 <= value <= 1.0 for value in probabilities):
        raise DecisionError("AI_OUTPUT_INVALID", "Decision probabilities are not finite")
    return probabilities


def answer(question_id: str, question: dict[str, Any], probabilities: list[float]) -> dict[str, Any]:
    if question["t"] == "choice":
        candidates = list(question["crit"].keys())
        if len(probabilities) != len(candidates):
            raise DecisionError("AI_OUTPUT_INVALID", "Decision model returned an incomplete choice distribution")
        best = 0
        for position in range(1, len(probabilities)):
            if probabilities[position] > probabilities[best]:
                best = position
        return {"question_id": question_id, "choice": {"selected_candidate_id": candidates[best], "probabilities": probabilities}}
    if len(probabilities) != 2:
        raise DecisionError("AI_OUTPUT_INVALID", "Decision model returned an incomplete boolean distribution")
    # Upstream noul option order is [false, true].
    return {"question_id": question_id, "boolean": {"true_probability": probabilities[1]}}


class LayaCheckpoint:
    """One loaded Laya checkpoint on one fixed device. No download, rewrite or fallback."""

    def __init__(self, model_dir: Path, device_name: str):
        import torch
        from laya import common
        from safetensors.torch import load_file
        from transformers import AutoTokenizer
        from transformers.utils import logging as transformers_logging

        # Complete untruncated sequences are checked against the encoder below;
        # the tokenizer's advisory length warning is not a Worker diagnostic.
        transformers_logging.set_verbosity_error()
        try:
            from transformers.initialization import no_init_weights
        except ImportError:  # Transformers 4.x
            from transformers.modeling_utils import no_init_weights

        if any(common.QTYPES.get(name) != index for name, index in QUESTION_TYPES.items()):
            raise DecisionError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Upstream Laya question types do not match this Driver")
        if device_name == "cuda":
            if not torch.cuda.is_available():
                raise DecisionError("AI_LOCAL_EXECUTION_LOAD_FAILED", "The captured CUDA profile has no available CUDA device")
            device = torch.device("cuda")
        elif device_name == "cpu":
            device = torch.device("cpu")
        else:
            raise DecisionError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Decision device is not admitted")
        try:
            config = strict_json_loads((model_dir / "rl_agent_config.json").read_text(encoding="utf-8"))
            if not isinstance(config, dict):
                raise ValueError("agent configuration is not an object")
            temperature = config.get("temperature", [1.0, 1.0, 1.0])
            by_options = config.get("temperature_by_options", {})
            if not isinstance(temperature, list) or len(temperature) != 3 or not isinstance(by_options, dict):
                raise ValueError("agent temperatures are malformed")
            tokenizer = AutoTokenizer.from_pretrained(str(model_dir / "tokenizer"), local_files_only=True, trust_remote_code=False)
            with no_init_weights():
                model = common.build_model(config, encoder_dir=str(model_dir / "encoder"), pretrained=False)
            model.load_state_dict(load_file(str(model_dir / "model.safetensors")), strict=True)
            model.encoder.config.reference_compile = False
            model.to(device).eval()
            max_positions = int(model.encoder.config.max_position_embeddings)
            if max_positions <= 0:
                raise ValueError("encoder has no maximum positions")
        except DecisionError:
            raise
        except torch.cuda.OutOfMemoryError as error:
            raise DecisionError("AI_LOCAL_EXECUTION_OUT_OF_MEMORY", "The decision checkpoint does not fit the captured device") from error
        except Exception as error:
            raise DecisionError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Could not load the captured decision checkpoint") from error
        self._torch = torch
        self._common = common
        self.device = device
        self.model = model
        self.tokens = TokenizerView(tokenizer)
        self.max_positions = max_positions
        # Upstream Agent semantics: only clamped checkpoint temperatures apply.
        self.temperature = [common.clamp_temperature(value) for value in temperature]
        self.temperature_by_options = {key: common.clamp_temperature(value) for key, value in by_options.items()}

    def _forward(self, items: list[dict[str, Any]]) -> tuple[list[list[float]], int]:
        torch = self._torch
        batch = self._common.collate_items([items], self.tokens.pad_id)
        inputs = [batch[name].to(self.device) for name in ("input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype")]
        with torch.no_grad():
            if self.device.type == "cuda":
                with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                    logits, _act = self.model(*inputs)
            else:
                logits, _act = self.model(*inputs)
        return logits.float().cpu().tolist(), int(batch["attention_mask"].sum())

    def decide(self, state: str | dict | list, questions: list[tuple[str, dict[str, Any]]]) -> tuple[list[dict[str, Any]], int]:
        common = self._common
        state_ids = self.tokens.ids(utf8_text(common.serialize_state(state)))
        items = []
        for index, (_question_id, question) in enumerate(questions):
            options = common.render_options(question)
            items.append(encode_question(self.tokens, index, question["t"], str(question["ins"]), options, state_ids, self.max_positions))
        try:
            rows, input_tokens = self._forward(items)
        except self._torch.cuda.OutOfMemoryError as error:
            raise DecisionError("AI_LOCAL_EXECUTION_OUT_OF_MEMORY", "Decision inference exceeded the device memory") from error
        except Exception as error:
            raise DecisionError("AI_LOCAL_EXECUTION_INFERENCE_FAILED", "Decision inference failed") from error
        answers = []
        for (question_id, question), item, row in zip(questions, items, rows):
            count = len(item["markers"])
            qtype = QUESTION_TYPES[question["t"]]
            temperature = self.temperature_by_options.get(common.temp_bucket(qtype, count), self.temperature[qtype])
            answers.append(answer(question_id, question, softmax(row[:count], temperature)))
        return answers, input_tokens


class DecisionWorker:
    """Resident checkpoint state; the supervising Host owns admission, leases and replacement."""

    def __init__(self, loader: Any = None):
        self._loader = loader or LayaCheckpoint
        self._identity: tuple[str, ...] | None = None
        self._checkpoint: Any = None

    def run(self, request: Any) -> dict[str, Any]:
        started = time.perf_counter()
        if not isinstance(request, dict) or set(request) != _REQUEST_FIELDS:
            raise _invalid("Decision request has an unsupported shape")
        spec = request["request"]
        if not isinstance(spec, dict) or set(spec) != _SPEC_FIELDS:
            raise _invalid("Decision request must carry one state and its questions")
        state = decode_content(spec["state"], required=True)
        questions = upstream_questions(spec["questions"])
        model_dir = Path(request["model_dir"]) if isinstance(request["model_dir"], str) else None
        content_id, profile_digest, device = request["model_content_id"], request["profile_digest"], request["device"]
        if model_dir is None or not model_dir.is_absolute() or not isinstance(content_id, str) or not content_id or \
                not isinstance(profile_digest, str) or not profile_digest or device not in DEVICES:
            raise DecisionError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Captured decision checkpoint identity is required")
        identity = (str(model_dir), content_id, profile_digest, device, PROTOCOL)
        if self._identity != identity:
            # The Host replaces the Worker for a changed loading identity; never
            # load a second checkpoint into this process.
            if self._identity is not None:
                raise DecisionError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Decision Worker loading identity changed")
            loaded_at = time.perf_counter()
            self._checkpoint = self._loader(model_dir, device)
            self._identity = identity
            print(f"[decision] loaded device={device} seconds={time.perf_counter() - loaded_at:.3f}", file=sys.stderr, flush=True)
        answers, input_tokens = self._checkpoint.decide(state, questions)
        if len(answers) != len(questions):
            raise DecisionError("AI_OUTPUT_INVALID", "Decision model did not answer every question")
        return {
            "result": {"answers": answers},
            "usage": {"input_tokens": int(input_tokens), "compute_ms": int((time.perf_counter() - started) * 1000)},
        }


def encode_response(payload: dict[str, Any]) -> bytes:
    body = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_RESPONSE_BYTES:
        raise DecisionError("AI_OUTPUT_INVALID", "Decision result exceeds the private transport bound")
    return body


def decode_request(body: bytes) -> Any:
    if len(body) > MAX_REQUEST_BYTES:
        raise _invalid("Decision request exceeds the private transport bound")
    try:
        return strict_json_loads(body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError) as error:
        raise _invalid("Decision request is not strict UTF-8 JSON") from error

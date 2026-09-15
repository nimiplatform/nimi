from __future__ import annotations

import hashlib
import json
from pathlib import Path

# @nimi-authority: rule.nimi.runtime.ai-provider.spacy-local-annotation

PROTOCOL = "nimi-text-annotate/1"
MAX_DOCUMENTS = 64
MAX_INPUT_BYTES = 512 * 1024
MAX_TOKENS = 65536
MAX_RESULT_BYTES = 16 * 1024 * 1024

# Runtime-admitted spaCy 3.8 model configurations. Model packages are loaded
# as data directories; their Python package entry points are never imported.
MODEL_CONFIGS: dict[str, tuple[str, str]] = {
    'de': ('core_news_md', 'f9429742959c513a99a35e9607d2c2eebdf4a15a8fc6a6c97cd6a3aaab874d04'),
    'en': ('core_web_md', '24b1b17065a74a6a3f999dd9c722f5532dc6bb5994b6a7ba5aa4f2ce09d434cc'),
    'es': ('core_news_md', '0287eff7a5b4e86c91d59629a3e039a159bf232c03352ebd56579af59aa3d5e9'),
    'fr': ('core_news_md', '64a5ed369a003285fc526180d901aacc628db7295f81a93d4c23ef60aad790aa'),
    'it': ('core_news_md', 'f27f6fe74a49b625079cb176f1ea226a712781b6b2ee02301303088c1c67c75f'),
    'ja': ('core_news_md', 'c64179403c2f1b0a679c70da7a33f6c29dc98397b4730fa4bf8f2a62e42b895b'),
    'ru': ('core_news_md', '83e10820566c18ec311f3c5e8d0465a22a791f443aa33cb31e788458d94bf779'),
    'zh': ('core_web_md', '93bd171ad59dba9100f085ef5855c1069e0d09c042b01f52cf748cc5f9e4a5c5'),
}


class AnnotationError(ValueError):
    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason


def validate_input(language: str, texts: list[str]) -> None:
    if language not in MODEL_CONFIGS:
        raise AnnotationError("AI_INPUT_INVALID", "Unsupported annotation language")
    if not isinstance(texts, list) or not 1 <= len(texts) <= MAX_DOCUMENTS:
        raise AnnotationError("AI_INPUT_INVALID", "Annotation requires 1 to 64 documents")
    try:
        if any(not isinstance(text, str) for text in texts):
            raise ValueError("Documents must be strings")
        size = sum(len(text.encode("utf-8")) for text in texts)
    except (ValueError, UnicodeError) as error:
        raise AnnotationError("AI_INPUT_INVALID", "Documents must contain valid Unicode") from error
    if size > MAX_INPUT_BYTES:
        raise AnnotationError("AI_INPUT_INVALID", "Annotation input exceeds 512 KiB")


def load_pipeline(model_dir: Path, language: str):
    if language not in MODEL_CONFIGS:
        raise AnnotationError("AI_INPUT_INVALID", "Unsupported annotation language")
    name, config_hash = MODEL_CONFIGS[language]
    try:
        config = (model_dir / "config.cfg").read_bytes()
        meta = json.loads((model_dir / "meta.json").read_text(encoding="utf-8"))
        if hashlib.sha256(config).hexdigest() != config_hash:
            raise ValueError("Model configuration is not admitted by this Driver")
        if meta.get("lang") != language or meta.get("name") != name or meta.get("version") != "3.8.0":
            raise ValueError("Model metadata does not match its language pipeline")
        import spacy

        spacy.require_cpu()
        pipeline = spacy.load(model_dir)
        if pipeline.lang != language or not pipeline.has_pipe("parser"):
            raise ValueError("Model has no admitted dependency parser")
        return pipeline
    except Exception as error:
        raise AnnotationError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Could not load the captured annotation pipeline") from error


# Offsets count Unicode scalar values, matching Python string indexing.
# Token and sentence end positions are exclusive. Array order is identity.
def project_document(doc) -> dict:
    if len(doc) and not all(doc.has_annotation(name, require_complete=True) for name in ("POS", "DEP", "SENT_START")):
        raise AnnotationError("AI_OUTPUT_INVALID", "Language pipeline returned incomplete syntax annotations")
    tokens = [{
        "text": token.text,
        "start": token.idx,
        "end": token.idx + len(token.text),
        "head_index": token.head.i,
        "part_of_speech": token.pos_,
        "dependency": token.dep_,
        "is_punctuation": token.is_punct,
    } for token in doc]
    sentences = [{"start_token": sent.start, "end_token": sent.end} for sent in doc.sents] if len(doc) else []
    return {"text": doc.text, "language": doc.lang_, "tokens": tokens, "sentences": sentences}


class AnnotationWorker:
    """Resident model state; the supervising Host owns admission and leases."""

    def __init__(self):
        self._identity = None
        self._pipeline = None

    def run(self, model_dir: str, model_content_id: str, language: str, texts: list[str]) -> dict:
        validate_input(language, texts)
        root = Path(model_dir)
        if not root.is_absolute() or not model_content_id:
            raise AnnotationError("AI_LOCAL_EXECUTION_LOAD_FAILED", "Captured model identity is required")
        identity = (str(root), model_content_id, language)
        if identity != self._identity:
            self._pipeline = None
            self._identity = None
            pipeline = load_pipeline(root, language)
            self._pipeline = pipeline
            self._identity = identity
        results = []
        count = 0
        try:
            for doc in self._pipeline.pipe(texts, batch_size=8):
                count += len(doc)
                if count > MAX_TOKENS:
                    raise AnnotationError("AI_OUTPUT_INVALID", "Annotation result exceeds 65536 tokens")
                results.append(project_document(doc))
        except AnnotationError:
            raise
        except Exception as error:
            raise AnnotationError("AI_LOCAL_EXECUTION_INFERENCE_FAILED", "Language analysis failed") from error
        result = {"documents": results}
        if len(json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > MAX_RESULT_BYTES:
            raise AnnotationError("AI_OUTPUT_INVALID", "Annotation result exceeds 16 MiB")
        return result


def probe_environment() -> None:
    import importlib.metadata
    import platform
    import struct
    import sys
    import sysconfig
    import numpy as np
    import spacy

    spacy.require_cpu()
    print(json.dumps({
        "python_version": platform.python_version(),
        "python_implementation": platform.python_implementation(),
        "python_cache_tag": sys.implementation.cache_tag,
        "python_soabi": sysconfig.get_config_var("SOABI") or "",
        "python_platform": sys.platform,
        "python_machine": platform.machine(),
        "python_pointer_bits": struct.calcsize("P") * 8,
        "torch_version": "",
        "cuda_abi": "",
        "device": "cpu",
        "device_name": "cpu",
        "allocation": float(np.ones(1, dtype=np.float32).sum()),
        "installed_distributions": sorted(
            f"{item.metadata['Name']}=={item.version}" for item in importlib.metadata.distributions()
        ),
    }))

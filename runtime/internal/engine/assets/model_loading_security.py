from __future__ import annotations

# @nimi-authority: rule.nimi.runtime.local-compute.r074
# @nimi-authority: rule.nimi.runtime.local-compute.r117

import json
import os
from pathlib import Path
from typing import Any


_CONFIG_FILES = frozenset({
    "config.json", "configuration.json", "generation_config.json",
    "tokenizer_config.json", "processor_config.json", "preprocessor_config.json",
})
_ATTENTION_KEYS = frozenset({
    "_attn_implementation_internal", "_attn_implementation", "attn_implementation",
})
_BUILTIN_ATTENTION = frozenset({
    "eager", "sdpa", "flash_attention_2", "flash_attention_3", "flex_attention", "magi",
})


def _builtin_attention(value: Any) -> bool:
    if value is None or isinstance(value, str) and value in _BUILTIN_ATTENTION:
        return True
    return isinstance(value, dict) and all(_builtin_attention(item) for item in value.values())


def _validate_config(value: Any, name: str) -> None:
    pending = [value]
    while pending:
        node = pending.pop()
        if isinstance(node, list):
            pending.extend(node)
        elif isinstance(node, dict):
            for key, item in node.items():
                if key in _ATTENTION_KEYS and not _builtin_attention(item):
                    raise ValueError(f"managed model configuration {name!r} selects external attention code")
                if key in {"_experts_implementation_internal", "experts_implementation"} and item not in (None, "eager"):
                    raise ValueError(f"managed model configuration {name!r} selects external expert code")
                if key == "custom_generate" and item is not None:
                    raise ValueError(f"managed model configuration {name!r} selects custom generation code")
                if key == "trust_remote_code" and item not in (None, False):
                    raise ValueError(f"managed model configuration {name!r} requests code execution")
                pending.append(item)


def validate_model_directory(directory: str | Path) -> None:
    """Keep model data from selecting code outside the captured Driver/profile.

    Transformers can execute a local custom_generate/generate.py even in offline
    mode. Older versions also deserialize internal attention kernel selectors.
    Validate before model construction; do not rewrite the captured model files.
    """
    root = Path(directory)
    if not root.is_absolute() or not root.is_dir() or root.is_symlink() or root.is_junction():
        raise ValueError("managed model directory is unavailable")
    for current, directories, files in os.walk(root, followlinks=False):
        for name in directories:
            child = Path(current) / name
            if child.is_symlink() or child.is_junction():
                raise ValueError("managed model directory contains a linked directory")
            if name.casefold() == "custom_generate":
                raise ValueError("managed model contains custom generation code")
        for name in files:
            if name.casefold() not in _CONFIG_FILES:
                continue
            path = Path(current) / name
            if path.is_symlink():
                raise ValueError("managed model configuration is a linked file")
            with path.open(encoding="utf-8") as stream:
                configuration = json.load(stream)
            if not isinstance(configuration, dict):
                raise ValueError("managed model configuration must be an object")
            _validate_config(configuration, path.relative_to(root).as_posix())

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from typing import Any, Literal

CoreMethodKind = Literal["unary", "server_stream", "client_stream", "bidi_stream"]
CoreMetadata = Mapping[str, str]


@dataclass(frozen=True)
class CoreUnaryRequest:
    method_id: str
    body: Any
    metadata: CoreMetadata | None = None
    timeout_ms: int | None = None


@dataclass(frozen=True)
class CoreStreamRequest:
    method_id: str
    body: Any
    metadata: CoreMetadata | None = None
    timeout_ms: int | None = None


@dataclass(frozen=True)
class CoreErrorShape:
    code: str
    message: str
    details: Any | None = None


CoreStream = AsyncIterator[Any]


from dataclasses import dataclass
from typing import Any

from sdks.python.core_client import CoreClient
from sdks.python.types import CoreMetadata, CoreUnaryRequest


@dataclass(frozen=True)
class RealmOperationRequest:
    operation_id: str
    body: Any
    metadata: CoreMetadata | None = None
    timeout_ms: int | None = None


class RealmCore:
    def __init__(self, client: CoreClient) -> None:
        self._client = client

    async def operation(self, request: RealmOperationRequest) -> Any:
        return await self._client.unary(CoreUnaryRequest(
            method_id=request.operation_id,
            body=request.body,
            metadata=request.metadata,
            timeout_ms=request.timeout_ms,
        ))


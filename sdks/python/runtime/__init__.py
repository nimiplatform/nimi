from collections.abc import AsyncIterator
from typing import Any

from sdks.python.core_client import CoreClient
from sdks.python.types import CoreStreamRequest, CoreUnaryRequest


class RuntimeCore:
    def __init__(self, client: CoreClient) -> None:
        self._client = client

    async def unary(self, request: CoreUnaryRequest) -> Any:
        return await self._client.unary(request)

    def server_stream(self, request: CoreStreamRequest) -> AsyncIterator[Any]:
        return self._client.server_stream(request)


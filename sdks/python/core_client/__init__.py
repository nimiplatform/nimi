from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Any, Protocol

from sdks.python.types import CoreStreamRequest, CoreUnaryRequest

CoreMetadataInput = Mapping[str, str]
AuthMetadataProvider = Callable[[], CoreMetadataInput | Awaitable[CoreMetadataInput]]


class CoreTransport(Protocol):
    async def unary(self, request: CoreUnaryRequest) -> Any: ...

    def server_stream(self, request: CoreStreamRequest) -> AsyncIterator[Any]: ...


class CoreClient:
    def __init__(
        self,
        transport: CoreTransport,
        auth_metadata: AuthMetadataProvider | None = None,
    ) -> None:
        self._transport = transport
        self._auth_metadata = auth_metadata

    async def unary(self, request: CoreUnaryRequest) -> Any:
        return await self._transport.unary(request.__class__(
            method_id=request.method_id,
            body=request.body,
            metadata=await self._metadata(request.metadata),
            timeout_ms=request.timeout_ms,
        ))

    async def server_stream(self, request: CoreStreamRequest) -> AsyncIterator[Any]:
        stream = self._transport.server_stream(request.__class__(
            method_id=request.method_id,
            body=request.body,
            metadata=await self._metadata(request.metadata),
            timeout_ms=request.timeout_ms,
        ))
        async for event in stream:
            yield event

    def unsafe_raw(self) -> CoreTransport:
        return self._transport

    async def _metadata(self, metadata: CoreMetadataInput | None) -> dict[str, str]:
        auth_metadata: CoreMetadataInput = {}
        if self._auth_metadata is not None:
            provided = self._auth_metadata()
            if hasattr(provided, "__await__"):
                auth_metadata = await provided  # type: ignore[assignment]
            else:
                auth_metadata = provided  # type: ignore[assignment]
        return {**dict(auth_metadata), **dict(metadata or {})}


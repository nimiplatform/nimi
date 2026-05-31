import asyncio
from pathlib import Path
import json

from sdks.python.core_client import CoreClient
from sdks.python.core_generated.realm_client import RealmGeneratedClient
from sdks.python.core_generated.runtime_client import RuntimeGeneratedClient

FIXTURES = json.loads(Path("sdks/conformance/fixtures/behavior-fixtures.json").read_text())


class FakeTransport:
    def __init__(self):
        self.unary_calls = []
        self.stream_calls = []

    async def unary(self, request):
        self.unary_calls.append(request)
        if request.method_id == FIXTURES["cases"]["runtime_unary"]["method_id"]:
            return FIXTURES["cases"]["runtime_unary"]["response_body"]
        if request.method_id == FIXTURES["cases"]["realm_operation"]["operation_id"]:
            return FIXTURES["cases"]["realm_operation"]["response_body"]
        error = RuntimeError(f"unexpected unary {request.method_id}")
        setattr(error, "code", "SDK_RUNTIME_METHOD_UNAVAILABLE")
        raise error

    async def server_stream(self, request):
        self.stream_calls.append(request)
        assert request.method_id == FIXTURES["cases"]["runtime_stream"]["method_id"]
        for event in FIXTURES["cases"]["runtime_stream"]["events"]:
            yield event


async def main():
    transport = FakeTransport()
    core = CoreClient(transport, auth_metadata=lambda: FIXTURES["cases"]["metadata"]["auth"])
    runtime = RuntimeGeneratedClient(core)
    realm = RealmGeneratedClient(core)

    response = await runtime.call(
        FIXTURES["cases"]["runtime_unary"]["method_id"],
        FIXTURES["cases"]["runtime_unary"]["request_body"],
        metadata=FIXTURES["cases"]["metadata"]["caller"],
        timeout_ms=FIXTURES["cases"]["timeout_ms"],
    )
    assert response == FIXTURES["cases"]["runtime_unary"]["response_body"]
    assert transport.unary_calls[0].body == FIXTURES["cases"]["runtime_unary"]["request_body"]
    assert transport.unary_calls[0].timeout_ms == FIXTURES["cases"]["timeout_ms"]
    assert transport.unary_calls[0].metadata["authorization"] == FIXTURES["cases"]["metadata"]["auth"]["authorization"]
    assert transport.unary_calls[0].metadata["x-nimi-caller"] == FIXTURES["cases"]["metadata"]["caller"]["x-nimi-caller"]

    events = []
    async for event in runtime.stream(
        FIXTURES["cases"]["runtime_stream"]["method_id"],
        FIXTURES["cases"]["runtime_stream"]["request_body"],
    ):
        events.append(event)
    assert events == FIXTURES["cases"]["runtime_stream"]["events"]

    realm_response = await realm.operation(
        FIXTURES["cases"]["realm_operation"]["operation_id"],
        FIXTURES["cases"]["realm_operation"]["request_body"],
    )
    assert realm_response == FIXTURES["cases"]["realm_operation"]["response_body"]
    assert runtime.unsafe_raw() is transport
    assert realm.unsafe_raw() is transport
    print("sdks behavior conformance: OK (python)")


asyncio.run(main())


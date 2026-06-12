import asyncio
import os
from pathlib import Path
import json

from sdks.python.core_client import CoreClient
from sdks.python.core_generated.realm_client import RealmGeneratedClient
from sdks.python.core_generated.runtime_client import RuntimeGeneratedClient
import sdks.python.core_generated.realm_typed_client as realm_typed
import sdks.python.core_generated.runtime_typed_client as runtime_typed

FIXTURES = json.loads(Path("sdks/conformance/fixtures/behavior-fixtures.json").read_text())


class FakeTransport:
    def __init__(self):
        self.unary_calls = []
        self.stream_calls = []

    async def unary(self, request):
        self.unary_calls.append(request)
        if isinstance(request.body, dict) and request.body.get("redirect_uri") == "force-error":
            error = RuntimeError(FIXTURES["cases"]["structured_error"]["message"])
            setattr(error, "code", FIXTURES["cases"]["structured_error"]["reason_code"])
            setattr(error, "details", FIXTURES["cases"]["structured_error"]["details"])
            raise error
        if request.method_id == FIXTURES["cases"]["runtime_unary"]["method_id"]:
            if os.environ.get("SDKS_CONFORMANCE_PROFILE") == "typed-core":
                return {
                    "accepted": True,
                    "login_attempt_id": "login-conformance",
                    "callback_origin": "https://app.example",
                }
            return FIXTURES["cases"]["runtime_unary"]["response_body"]
        if request.method_id == FIXTURES["cases"]["realm_operation"]["operation_id"]:
            if os.environ.get("SDKS_CONFORMANCE_PROFILE") == "typed-core":
                return {
                    "id": "intent-conformance",
                    "status": "ACKED",
                    "localAgentRef": "local-agent",
                    "ownerUserId": "owner",
                    "realmAgentId": "realm-agent",
                    "attempts": 1,
                    "availableAt": "2026-01-01T00:00:00Z",
                    "createdAt": "2026-01-01T00:00:00Z",
                }
            return FIXTURES["cases"]["realm_operation"]["response_body"]
        error = RuntimeError(f"unexpected unary {request.method_id}")
        setattr(error, "code", "SDK_RUNTIME_METHOD_UNAVAILABLE")
        raise error

    async def server_stream(self, request):
        self.stream_calls.append(request)
        assert request.method_id == FIXTURES["cases"]["runtime_stream"]["method_id"]
        if os.environ.get("SDKS_CONFORMANCE_PROFILE") == "typed-core":
            yield {"event_id": "event-1", "sequence": 1, "event_type": "ACCOUNT_EVENT_TYPE_LOGIN_STARTED"}
            yield {"event_id": "event-2", "sequence": 2, "event_type": "ACCOUNT_EVENT_TYPE_LOGIN_COMPLETED"}
            return
        for event in FIXTURES["cases"]["runtime_stream"]["events"]:
            yield event


async def main():
    profile = os.environ.get("SDKS_CONFORMANCE_PROFILE", "descriptor-foundation")
    transport = FakeTransport()
    core = CoreClient(transport, auth_metadata=lambda: FIXTURES["cases"]["metadata"]["auth"])
    runtime = RuntimeGeneratedClient(core)
    realm = RealmGeneratedClient(core)

    if profile == "typed-core":
        typed_runtime = runtime_typed.RuntimeTypedClient(core)
        typed_realm = realm_typed.RealmTypedClient(core)

        runtime_request = runtime_typed.BeginLoginRequest(
            caller=runtime_typed.AccountCaller(
                app_id="app-conformance",
                mode="ACCOUNT_CALLER_MODE_DESKTOP_SHELL",
                scopes=("account.login",),
            ),
            redirect_uri="https://app.example/callback",
            callback_origin="https://app.example",
            requested_scopes=("openid", "profile"),
            ttl_seconds=60,
        )
        runtime_response = await typed_runtime.begin_login(
            runtime_request,
            metadata=FIXTURES["cases"]["metadata"]["caller"],
            timeout_ms=FIXTURES["cases"]["timeout_ms"],
        )
        assert runtime_response.accepted is True
        assert runtime_response.login_attempt_id == "login-conformance"

        stream_request = runtime_typed.SubscribeAccountSessionEventsRequest(
            caller=runtime_request.caller,
            after_sequence=0,
        )
        events = []
        async for event in typed_runtime.subscribe_account_session_events(stream_request):
            events.append(event)
        assert events[0].event_type == "ACCOUNT_EVENT_TYPE_LOGIN_STARTED"
        assert events[1].event_type == "ACCOUNT_EVENT_TYPE_LOGIN_COMPLETED"

        realm_request = realm_typed.RealmAckMyLocalAgentProvisionIntentOperationRequest(
            path=realm_typed.RealmAckMyLocalAgentProvisionIntentOperationPath(intentId="intent-conformance"),
            body=realm_typed.LocalAgentProvisionIntentAckDto(outcome="established", detail="ok"),
        )
        realm_response = await typed_realm.ack_my_local_agent_provision_intent(realm_request)
        assert realm_response.id == "intent-conformance"
        assert transport.unary_calls[0].method_id == FIXTURES["cases"]["runtime_unary"]["method_id"]
        assert transport.unary_calls[0].body["redirect_uri"] == "https://app.example/callback"
        assert transport.unary_calls[1].method_id == FIXTURES["cases"]["realm_operation"]["operation_id"]
        assert transport.unary_calls[1].body["path"]["intentId"] == "intent-conformance"
        assert transport.unary_calls[1].body["body"]["outcome"] == "established"
        error_request = runtime_typed.BeginLoginRequest(**{**runtime_request.__dict__, "redirect_uri": "force-error"})
        try:
            await typed_runtime.begin_login(error_request)
        except RuntimeError as error:
            assert getattr(error, "code") == FIXTURES["cases"]["structured_error"]["reason_code"]
            assert str(error) == FIXTURES["cases"]["structured_error"]["message"]
            assert getattr(error, "details") == FIXTURES["cases"]["structured_error"]["details"]
        else:
            raise AssertionError("typed structured error did not raise")
        print("sdks behavior conformance: OK (python typed-core)")
        return

    response = await runtime.call(
        FIXTURES["cases"]["runtime_unary"]["method_id"],
        FIXTURES["cases"]["runtime_unary"]["request_body"],
        metadata=FIXTURES["cases"]["metadata"]["caller"],
        timeout_ms=FIXTURES["cases"]["timeout_ms"],
    )
    assert response == FIXTURES["cases"]["runtime_unary"]["response_body"]
    assert transport.unary_calls[0].body == FIXTURES["cases"]["runtime_unary"]["request_body"]
    assert transport.unary_calls[0].timeout_ms == FIXTURES["cases"]["timeout_ms"]
    assert transport.unary_calls[0].metadata["x-nimi-access-token-id"] == FIXTURES["cases"]["metadata"]["auth"]["x-nimi-access-token-id"]
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
    print("sdks behavior conformance: OK (python)")


asyncio.run(main())

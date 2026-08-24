import asyncio
import json
from pathlib import Path

from sdks.python.core_client import CoreClient
import sdks.python.core_generated.realm_typed_client as realm_typed
import sdks.python.core_generated.runtime_typed_client as runtime_typed

FIXTURES = json.loads(Path("sdks/conformance/fixtures/behavior-fixtures.json").read_text())


class FakeTransport:
    def __init__(self):
        self.unary_calls = []
        self.stream_calls = []
        self.cancellation_started = asyncio.Event()
        self.tier_response = {
            "assetTier": 1.0,
            "influenceTier": 2.0,
            "interactionTier": 3.0,
            "lastUpdatedAt": None,
            "userId": "user-nullable",
            "vitalityScore": 4.0,
        }

    async def unary(self, request):
        self.unary_calls.append(request)
        if isinstance(request.body, dict) and request.body.get("redirect_uri") == "cancel":
            self.cancellation_started.set()
            await asyncio.Future()
        if isinstance(request.body, dict) and request.body.get("redirect_uri") == "force-error":
            error = RuntimeError("transport failure")
            setattr(error, "code", FIXTURES["cases"]["structured_error"]["reason_code"])
            setattr(error, "details", FIXTURES["cases"]["structured_error"]["details"])
            raise error
        if request.method_id == FIXTURES["cases"]["runtime_unary"]["method_id"]:
            return {
                "accepted": True,
                "login_attempt_id": "login-conformance",
                "callback_origin": "https://app.example",
            }
        if request.method_id == FIXTURES["cases"]["realm_unary"]["operation_id"]:
            if request.body.get("query", {}).get("handle") == "realm-malformed":
                return {}
            return FIXTURES["cases"]["realm_unary"]["response"]
        if request.method_id == "getMyTiers":
            return self.tier_response
        error = RuntimeError(f"unexpected unary {request.method_id}")
        setattr(error, "code", "SDK_RUNTIME_METHOD_UNAVAILABLE")
        raise error

    async def server_stream(self, request):
        self.stream_calls.append(request)
        assert request.method_id == FIXTURES["cases"]["runtime_stream"]["method_id"]
        yield {"event_id": "event-1", "sequence": 1, "event_type": "ACCOUNT_EVENT_TYPE_LOGIN_STARTED"}
        yield {"event_id": "event-2", "sequence": 2, "event_type": "ACCOUNT_EVENT_TYPE_LOGIN_COMPLETED"}


async def main():
    transport = FakeTransport()
    core = CoreClient(transport, auth_metadata=lambda: FIXTURES["cases"]["metadata"]["auth"])
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

    realm_response = await typed_realm.check_handle(
        realm_typed.RealmCheckHandleOperationRequest(
            path=realm_typed.RealmCheckHandleOperationPath(),
            query=realm_typed.RealmCheckHandleOperationQuery(
                handle=FIXTURES["cases"]["realm_unary"]["query"]["handle"],
            ),
        ),
        metadata=FIXTURES["cases"]["metadata"]["caller"],
        timeout_ms=FIXTURES["cases"]["timeout_ms"],
    )
    assert realm_response.available is FIXTURES["cases"]["realm_unary"]["response"]["available"]
    assert realm_response.message == FIXTURES["cases"]["realm_unary"]["response"]["message"]
    realm_call = transport.unary_calls[-1]
    assert realm_call.method_id == FIXTURES["cases"]["realm_unary"]["operation_id"]
    assert realm_call.body["query"] == FIXTURES["cases"]["realm_unary"]["query"]
    assert realm_call.timeout_ms == FIXTURES["cases"]["timeout_ms"]
    assert realm_call.metadata["x-nimi-access-token-id"] == FIXTURES["cases"]["metadata"]["auth"]["x-nimi-access-token-id"]
    assert realm_call.metadata["x-nimi-caller"] == FIXTURES["cases"]["metadata"]["caller"]["x-nimi-caller"]

    tiers_request = realm_typed.RealmGetMyTiersOperationRequest(
        path=realm_typed.RealmGetMyTiersOperationPath(),
    )
    tiers = await typed_realm.get_my_tiers(tiers_request)
    assert tiers.lastUpdatedAt is None

    transport.tier_response = {
        key: value for key, value in transport.tier_response.items() if key != "lastUpdatedAt"
    }
    try:
        await typed_realm.get_my_tiers(tiers_request)
    except RuntimeError as error:
        assert getattr(error, "code") == "SDK_REALM_RESPONSE_DECODE_FAILED"
    else:
        raise AssertionError("missing required nullable Realm field was accepted")

    transport.tier_response = {
        "assetTier": "not-a-number",
        "influenceTier": 2.0,
        "interactionTier": 3.0,
        "lastUpdatedAt": None,
        "userId": "user-nullable",
        "vitalityScore": 4.0,
    }
    try:
        await typed_realm.get_my_tiers(tiers_request)
    except RuntimeError as error:
        assert getattr(error, "code") == "SDK_REALM_RESPONSE_DECODE_FAILED"
    else:
        raise AssertionError("wrong Realm scalar was accepted")

    try:
        await typed_realm.check_handle(
            realm_typed.RealmCheckHandleOperationRequest(
                path=realm_typed.RealmCheckHandleOperationPath(),
                query=realm_typed.RealmCheckHandleOperationQuery(handle="realm-malformed"),
            )
        )
    except RuntimeError as error:
        assert getattr(error, "code") == "SDK_REALM_RESPONSE_DECODE_FAILED"
    else:
        raise AssertionError("malformed Realm success was accepted")

    first_call = transport.unary_calls[0]
    assert first_call.method_id == FIXTURES["cases"]["runtime_unary"]["method_id"]
    assert first_call.body["caller"]["app_id"] == "app-conformance"
    assert first_call.body["redirect_uri"] == "https://app.example/callback"
    assert first_call.timeout_ms == FIXTURES["cases"]["timeout_ms"]
    assert first_call.metadata["x-nimi-access-token-id"] == FIXTURES["cases"]["metadata"]["auth"]["x-nimi-access-token-id"]
    assert first_call.metadata["x-nimi-caller"] == FIXTURES["cases"]["metadata"]["caller"]["x-nimi-caller"]

    cancel_request = runtime_typed.BeginLoginRequest(
        **{**runtime_request.__dict__, "redirect_uri": "cancel"}
    )
    cancel_task = asyncio.create_task(typed_runtime.begin_login(cancel_request))
    await transport.cancellation_started.wait()
    cancel_task.cancel()
    try:
        await cancel_task
    except asyncio.CancelledError:
        pass
    else:
        raise AssertionError("typed Runtime cancellation did not propagate")

    error_request = runtime_typed.BeginLoginRequest(
        **{**runtime_request.__dict__, "redirect_uri": "force-error"}
    )
    try:
        await typed_runtime.begin_login(error_request)
    except RuntimeError as error:
        assert getattr(error, "code") == FIXTURES["cases"]["structured_error"]["reason_code"]
        assert getattr(error, "details") == FIXTURES["cases"]["structured_error"]["details"]
    else:
        raise AssertionError("typed structured error did not raise")

    print("sdks behavior conformance: OK (python)")


asyncio.run(main())

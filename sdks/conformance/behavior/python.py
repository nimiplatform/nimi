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
        if request.method_id == "WorldCoreController_createSourceMaterializationPacket":
            if os.environ.get("SDKS_CONFORMANCE_PROFILE") == "typed-core":
                return {
                    "packetSchemaVersion": "realm.source-materialization-packet/v2",
                    "packetId": "packet-conformance",
                    "issuer": "https://realm.conformance",
                    "keyId": "materialization-rs256-conformance",
                    "algorithm": "RS256",
                    "keyUse": "sig",
                    "issuedAt": "2026-01-01T00:00:00Z",
                    "expiresAt": "2026-01-01T00:05:00Z",
                    "nonce": "nonce-conformance",
                    "intendedRuntimeAudience": "sdk.conformance",
                    "challengeId": "challenge_conformance_0001",
                    "challengeDigest": "a" * 64,
                    "challengeLimits": {
                        "maxBundleBytes": 1048576,
                        "maxComponentCount": 128,
                        "maxChunkBytes": 65536,
                        "maxChunks": 512,
                    },
                    "materializerAccountId": "account-conformance",
                    "sourceRef": {
                        "kind": "realmPersona",
                        "worldId": "oasis",
                        "sourceId": "persona-conformance",
                        "sourceContentHash": "e" * 64,
                    },
                    "payloadHash": "b" * 64,
                    "bundleManifestHash": "c" * 64,
                    "packetHash": "d" * 64,
                    "packetProof": "eyJhbGciOiJSUzI1NiJ9..conformance-signature",
                    "semanticPayload": {"source": {"kind": "realmPersona"}},
                    "bundleTransportManifest": {
                        "manifestSchemaVersion": "realm.materialization-bundle-manifest/v1"
                    },
                    "orderedComponentChunks": [],
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

        realm_request = realm_typed.RealmWorldCoreControllerCreateSourceMaterializationPacketOperationRequest(
            path=realm_typed.RealmWorldCoreControllerCreateSourceMaterializationPacketOperationPath(),
            body=realm_typed.CreateSourceMaterializationPacketDto(
                intendedRuntimeAudience="sdk.conformance",
                materializerAccountId="account-conformance",
                challengeId="challenge_conformance_0001",
                challengeDigest="a" * 64,
                challengeExpiresAt="2026-01-01T00:05:00.000Z",
                challengeLimits=realm_typed.SourceMaterializationChallengeLimitsDto(
                    maxBundleBytes=1048576,
                    maxComponentCount=128,
                    maxChunkBytes=65536,
                    maxChunks=512,
                ),
                sourceRef=realm_typed.TypedSourceRefDto(
                    kind="realmPersona",
                    sourceId="persona-conformance",
                    sourceContentHash="e" * 64,
                    worldId="oasis",
                ),
            ),
        )
        realm_response = await typed_realm.world_core_controller_create_source_materialization_packet(realm_request)
        assert realm_response.packetSchemaVersion == "realm.source-materialization-packet/v2"
        assert realm_response.algorithm == "RS256"
        assert transport.unary_calls[0].method_id == FIXTURES["cases"]["runtime_unary"]["method_id"]
        assert transport.unary_calls[0].body["redirect_uri"] == "https://app.example/callback"
        assert transport.unary_calls[1].method_id == "WorldCoreController_createSourceMaterializationPacket"
        assert transport.unary_calls[1].body["body"]["sourceRef"]["sourceId"] == "persona-conformance"
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

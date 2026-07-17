package coregenerated

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/sdks/go/coreclient"
	sdkstypes "github.com/nimiplatform/nimi/sdks/go/types"
)

type behaviorFixtures struct {
	Cases struct {
		RuntimeUnary struct {
			MethodID     string         `json:"method_id"`
			RequestBody  map[string]any `json:"request_body"`
			ResponseBody map[string]any `json:"response_body"`
		} `json:"runtime_unary"`
		RuntimeStream struct {
			MethodID    string           `json:"method_id"`
			RequestBody map[string]any   `json:"request_body"`
			Events      []map[string]any `json:"events"`
		} `json:"runtime_stream"`
		RealmOperation struct {
			OperationID  string         `json:"operation_id"`
			RequestBody  map[string]any `json:"request_body"`
			ResponseBody map[string]any `json:"response_body"`
		} `json:"realm_operation"`
		Metadata struct {
			Auth   map[string]string `json:"auth"`
			Caller map[string]string `json:"caller"`
		} `json:"metadata"`
		TimeoutMS int64 `json:"timeout_ms"`
	} `json:"cases"`
}

type fakeTransport struct {
	fixtures    behaviorFixtures
	unaryCalls  []sdkstypes.CoreUnaryRequest
	streamCalls []sdkstypes.CoreStreamRequest
}

type structuredCoreError struct {
	Code    string
	Message string
	Details map[string]any
}

func (e structuredCoreError) Error() string {
	return e.Code + ": " + e.Message
}

type fakeStream struct {
	events [][]byte
	index  int
}

func (s *fakeStream) Recv(context.Context) ([]byte, error) {
	if s.index >= len(s.events) {
		return nil, io.EOF
	}
	event := s.events[s.index]
	s.index++
	return event, nil
}

func (s *fakeStream) Close() error { return nil }

func (t *fakeTransport) Unary(ctx context.Context, req sdkstypes.CoreUnaryRequest) ([]byte, error) {
	t.unaryCalls = append(t.unaryCalls, req)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	var body map[string]any
	if err := json.Unmarshal(req.Body, &body); err == nil && body["redirect_uri"] == "force-error" {
		return nil, structuredCoreError{
			Code:    "SDK_RUNTIME_METHOD_UNAVAILABLE",
			Message: "typed conformance error",
			Details: map[string]any{"fixture": "typed-core"},
		}
	}
	switch req.MethodID {
	case t.fixtures.Cases.RuntimeUnary.MethodID:
		if os.Getenv("SDKS_CONFORMANCE_PROFILE") == "typed-core" {
			return json.Marshal(BeginLoginResponse{
				Accepted:       true,
				LoginAttemptId: "login-conformance",
				CallbackOrigin: "https://app.example",
			})
		}
		return json.Marshal(t.fixtures.Cases.RuntimeUnary.ResponseBody)
	case t.fixtures.Cases.RealmOperation.OperationID:
		return json.Marshal(t.fixtures.Cases.RealmOperation.ResponseBody)
	case "WorldCoreController_createSourceMaterializationPacket":
		if os.Getenv("SDKS_CONFORMANCE_PROFILE") == "typed-core" {
			return json.Marshal(SourceMaterializationPacketV3Dto{
				PacketSchemaVersion:     "realm.source-materialization-packet/v3",
				PacketId:                "packet-conformance",
				Issuer:                  "https://realm.conformance",
				KeyId:                   "materialization-rs256-conformance",
				Algorithm:               "RS256",
				KeyUse:                  "sig",
				IssuedAt:                "2026-01-01T00:00:00Z",
				ExpiresAt:               "2026-01-01T00:05:00Z",
				Nonce:                   "nonce-conformance",
				IntendedRuntimeAudience: "sdk.conformance",
				ChallengeId:             "challenge_conformance_0001",
				ChallengeDigest:         strings.Repeat("a", 64),
				PublishedLimits: &SourceMaterializationPublishedLimitsDto{
					MaxSegmentBytes: 8388608, MaxSegmentComponentCount: 256, MaxSegmentChunks: 4096,
					MaxChunkBytes: 262144, MaxSetSegments: 64, MaxSetBytes: 134217728,
					MaxSetComponentCount: 16384, MaxSetChunks: 65536,
				},
				MaterializerAccountId: "account-conformance",
				SourceRef: &CharacterSourceRefV3Dto{PersonaCharacter: &PersonaCharacterSourceRefV3Dto{
					Kind: "personaCharacter", WorldId: "oasis", Id: "persona-conformance",
					OwnerAccountId: "account-conformance", SourceHash: strings.Repeat("e", 64),
				}},
				AuthorizationDecisionDigest: strings.Repeat("f", 64),
				AccessPolicyVersionDigest:   "34f338ae76cbd85de58054cd6fc4d0ee18500030a0bc12f091e88d46f2fc572f",
				MaterializationContextHash:  strings.Repeat("1", 64),
				PayloadHash:                 strings.Repeat("b", 64),
				ClosureSetManifestHash:      strings.Repeat("c", 64),
				PacketHash:                  strings.Repeat("d", 64),
				PacketProof: &SourceMaterializationPacketProofV3Dto{
					CompactJws:    "eyJhbGciOiJSUzI1NiJ9..conformance-signature",
					SignedPayload: "conformance-signed-payload",
				},
				SemanticPayload: &SourceMaterializationPacketV3DtoSemanticPayload{
					PersonaCharacter: &PersonaCharacterMaterializationPayloadV3Dto{
						SourceRef: &PersonaCharacterSourceRefV3Dto{
							Kind: "personaCharacter", WorldId: "oasis", Id: "persona-conformance",
							OwnerAccountId: "account-conformance", SourceHash: strings.Repeat("e", 64),
						},
					},
				},
				OrderedSegments: []SourceMaterializationSegmentV3Dto{},
			})
		}
		return json.Marshal(t.fixtures.Cases.RealmOperation.ResponseBody)
	default:
		return nil, errors.New("unexpected unary")
	}
}

func (t *fakeTransport) ServerStream(ctx context.Context, req sdkstypes.CoreStreamRequest) (coreclient.StreamReader, error) {
	t.streamCalls = append(t.streamCalls, req)
	if req.MethodID != t.fixtures.Cases.RuntimeStream.MethodID {
		return nil, errors.New("unexpected stream")
	}
	events := make([][]byte, 0, len(t.fixtures.Cases.RuntimeStream.Events))
	for _, event := range t.fixtures.Cases.RuntimeStream.Events {
		value := any(event)
		if os.Getenv("SDKS_CONFORMANCE_PROFILE") == "typed-core" {
			value = AccountSessionEvent{
				EventId:   "event-1",
				Sequence:  uint64(len(events) + 1),
				EventType: "ACCOUNT_EVENT_TYPE_LOGIN_STARTED",
			}
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		events = append(events, encoded)
	}
	return &fakeStream{events: events}, nil
}

func loadBehaviorFixtures(t *testing.T) behaviorFixtures {
	t.Helper()
	var data []byte
	var err error
	for _, path := range []string{
		"../../conformance/fixtures/behavior-fixtures.json",
		"../conformance/fixtures/behavior-fixtures.json",
	} {
		data, err = os.ReadFile(path)
		if err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	var fixtures behaviorFixtures
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatalf("parse fixtures: %v", err)
	}
	return fixtures
}

func TestGeneratedRuntimeOptionalScalarAndEnumPresence(t *testing.T) {
	falseValue := false
	emptyValue := ""
	zeroRevision := uint64(0)
	unspecifiedBackend := AgentPresentationBackendKind("AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED")
	patch := AgentPresentationProfilePatch{
		BackendKind:           &unspecifiedBackend,
		AvatarAssetRef:        &emptyValue,
		DefaultVoiceReference: &emptyValue,
		AvatarAutoplay:        &falseValue,
	}
	request := SetAgentPresentationProfileRequest{
		ExpectedRevision: &zeroRevision,
	}

	encodedPatch, err := json.Marshal(patch)
	if err != nil {
		t.Fatalf("marshal patch: %v", err)
	}
	encodedRequest, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}

	for _, expected := range []string{
		`"backend_kind":"AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED"`,
		`"avatar_asset_ref":""`,
		`"default_voice_reference":""`,
		`"avatar_autoplay":false`,
	} {
		if !strings.Contains(string(encodedPatch), expected) {
			t.Fatalf("optional patch presence lost: expected %s in %s", expected, encodedPatch)
		}
	}
	if !strings.Contains(string(encodedRequest), `"expected_revision":0`) {
		t.Fatalf("optional expected_revision presence lost: %s", encodedRequest)
	}

	omittedPatch, err := json.Marshal(AgentPresentationProfilePatch{})
	if err != nil {
		t.Fatalf("marshal omitted patch: %v", err)
	}
	if string(omittedPatch) != "{}" {
		t.Fatalf("omitted optional patch fields must stay absent: %s", omittedPatch)
	}
}

func TestGeneratedClientsWithFakeTransport(t *testing.T) {
	fixtures := loadBehaviorFixtures(t)
	transport := &fakeTransport{fixtures: fixtures}
	core := coreclient.New(transport, func(context.Context) (sdkstypes.CoreMetadata, error) {
		return fixtures.Cases.Metadata.Auth, nil
	})
	runtimeClient := NewRuntimeGeneratedClient(core)
	realmClient := NewRealmGeneratedClient(core)

	if os.Getenv("SDKS_CONFORMANCE_PROFILE") == "typed-core" {
		typedRuntime := NewRuntimeTypedClient(core)
		typedRealm := NewRealmTypedClient(core)
		response, err := typedRuntime.BeginLogin(
			context.Background(),
			BeginLoginRequest{
				Caller: &AccountCaller{
					AppId:  "app-conformance",
					Mode:   "ACCOUNT_CALLER_MODE_DESKTOP_SHELL",
					Scopes: []string{"account.login"},
				},
				RedirectUri:     "https://app.example/callback",
				CallbackOrigin:  "https://app.example",
				RequestedScopes: []string{"openid", "profile"},
				TtlSeconds:      60,
			},
			fixtures.Cases.Metadata.Caller,
			fixtures.Cases.TimeoutMS,
		)
		if err != nil {
			t.Fatalf("typed runtime call: %v", err)
		}
		if !response.Accepted || response.LoginAttemptId != "login-conformance" {
			t.Fatalf("typed runtime response mismatch: %#v", response)
		}
		if transport.unaryCalls[0].MethodID != fixtures.Cases.RuntimeUnary.MethodID {
			t.Fatalf("typed runtime method mismatch: %s", transport.unaryCalls[0].MethodID)
		}
		if transport.unaryCalls[0].TimeoutMS != fixtures.Cases.TimeoutMS {
			t.Fatalf("typed timeout not propagated")
		}
		if transport.unaryCalls[0].Metadata["x-nimi-access-token-id"] != fixtures.Cases.Metadata.Auth["x-nimi-access-token-id"] {
			t.Fatalf("typed auth metadata not propagated")
		}
		if transport.unaryCalls[0].Metadata["x-nimi-caller"] != fixtures.Cases.Metadata.Caller["x-nimi-caller"] {
			t.Fatalf("typed caller metadata not propagated")
		}

		stream, err := typedRuntime.SubscribeAccountSessionEvents(
			context.Background(),
			SubscribeAccountSessionEventsRequest{Caller: &AccountCaller{AppId: "app-conformance"}, AfterSequence: 0},
			nil,
			0,
		)
		if err != nil {
			t.Fatalf("typed runtime stream: %v", err)
		}
		for range fixtures.Cases.RuntimeStream.Events {
			event, err := stream.Recv(context.Background())
			if err != nil {
				t.Fatalf("typed stream recv: %v", err)
			}
			if event.EventType == "" {
				t.Fatalf("typed stream event mismatch: %#v", event)
			}
		}
		if _, err := stream.Recv(context.Background()); !errors.Is(err, io.EOF) {
			t.Fatalf("expected typed EOF, got %v", err)
		}

		realmResponse, err := typedRealm.WorldCoreControllerCreateSourceMaterializationPacket(
			context.Background(),
			RealmWorldCoreControllerCreateSourceMaterializationPacketOperationRequest{
				Path: RealmWorldCoreControllerCreateSourceMaterializationPacketOperationPath{},
				Body: CreateSourceMaterializationPacketV3Dto{
					IntendedRuntimeAudience: "sdk.conformance",
					MaterializerAccountId:   "account-conformance",
					ChallengeId:             "challenge_conformance_0001",
					ChallengeDigest:         strings.Repeat("a", 64),
					ChallengeExpiresAt:      "2026-01-01T00:05:00.000Z",
					AccessGrantId:           "grant-conformance",
					PublishedLimits: &SourceMaterializationPublishedLimitsDto{
						MaxSegmentBytes: 8388608, MaxSegmentComponentCount: 256, MaxSegmentChunks: 4096,
						MaxChunkBytes: 262144, MaxSetSegments: 64, MaxSetBytes: 134217728,
						MaxSetComponentCount: 16384, MaxSetChunks: 65536,
					},
					SourceRef: &CharacterSourceRefV3Dto{PersonaCharacter: &PersonaCharacterSourceRefV3Dto{
						Kind: "personaCharacter", Id: "persona-conformance", OwnerAccountId: "account-conformance",
						SourceHash: strings.Repeat("e", 64), WorldId: "oasis",
					}},
				},
			},
			nil,
			0,
		)
		if err != nil {
			t.Fatalf("typed realm operation: %v", err)
		}
		if realmResponse.PacketSchemaVersion != "realm.source-materialization-packet/v3" || realmResponse.Algorithm != "RS256" {
			t.Fatalf("typed realm response mismatch: %#v", realmResponse)
		}
		if realmResponse.SemanticPayload == nil || realmResponse.SemanticPayload.PersonaCharacter == nil {
			t.Fatalf("typed realm discriminated payload mismatch: %#v", realmResponse.SemanticPayload)
		}
		if transport.unaryCalls[1].MethodID != "WorldCoreController_createSourceMaterializationPacket" {
			t.Fatalf("typed realm operation mismatch: %s", transport.unaryCalls[1].MethodID)
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := typedRuntime.BeginLogin(ctx, BeginLoginRequest{}, nil, 0); !errors.Is(err, context.Canceled) {
			t.Fatalf("expected typed context cancellation, got %v", err)
		}
		_, err = typedRuntime.BeginLogin(context.Background(), BeginLoginRequest{RedirectUri: "force-error"}, nil, 0)
		var shaped structuredCoreError
		if !errors.As(err, &shaped) {
			t.Fatalf("expected typed structured error, got %v", err)
		}
		if shaped.Code != "SDK_RUNTIME_METHOD_UNAVAILABLE" || shaped.Message != "typed conformance error" || shaped.Details["fixture"] != "typed-core" {
			t.Fatalf("typed structured error mismatch: %#v", shaped)
		}
		return
	}

	requestBody, _ := json.Marshal(fixtures.Cases.RuntimeUnary.RequestBody)
	response, err := runtimeClient.Call(context.Background(), fixtures.Cases.RuntimeUnary.MethodID, requestBody, fixtures.Cases.Metadata.Caller, fixtures.Cases.TimeoutMS)
	if err != nil {
		t.Fatalf("runtime call: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(response, &decoded); err != nil {
		t.Fatalf("decode runtime response: %v", err)
	}
	if decoded["source"] != fixtures.Cases.RuntimeUnary.ResponseBody["source"] {
		t.Fatalf("runtime response mismatch: %#v", decoded)
	}
	if transport.unaryCalls[0].TimeoutMS != fixtures.Cases.TimeoutMS {
		t.Fatalf("timeout not propagated")
	}
	if transport.unaryCalls[0].Metadata["x-nimi-access-token-id"] != fixtures.Cases.Metadata.Auth["x-nimi-access-token-id"] {
		t.Fatalf("auth metadata not propagated")
	}
	if transport.unaryCalls[0].Metadata["x-nimi-caller"] != fixtures.Cases.Metadata.Caller["x-nimi-caller"] {
		t.Fatalf("caller metadata not propagated")
	}

	stream, err := runtimeClient.Stream(context.Background(), fixtures.Cases.RuntimeStream.MethodID, nil, nil, 0)
	if err != nil {
		t.Fatalf("runtime stream: %v", err)
	}
	for range fixtures.Cases.RuntimeStream.Events {
		if _, err := stream.Recv(context.Background()); err != nil {
			t.Fatalf("stream recv: %v", err)
		}
	}
	if _, err := stream.Recv(context.Background()); !errors.Is(err, io.EOF) {
		t.Fatalf("expected EOF, got %v", err)
	}

	realmBody, _ := json.Marshal(fixtures.Cases.RealmOperation.RequestBody)
	realmResponse, err := realmClient.Operation(context.Background(), fixtures.Cases.RealmOperation.OperationID, realmBody, nil, 0)
	if err != nil {
		t.Fatalf("realm operation: %v", err)
	}
	if len(realmResponse) == 0 {
		t.Fatalf("empty realm response")
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := runtimeClient.Call(ctx, fixtures.Cases.RuntimeUnary.MethodID, nil, nil, 0); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
}

func TestSourceMaterializationPacketV3SemanticPayloadDiscriminatorFailsClosed(t *testing.T) {
	for _, fixture := range []struct {
		kind        string
		wantPersona bool
	}{
		{kind: "personaCharacter", wantPersona: true},
		{kind: "worldCharacter", wantPersona: false},
	} {
		var decoded SourceMaterializationPacketV3DtoSemanticPayload
		payload := []byte(`{"sourceRef":{"kind":"` + fixture.kind + `"}}`)
		if err := json.Unmarshal(payload, &decoded); err != nil {
			t.Fatalf("decode admitted %s payload: %v", fixture.kind, err)
		}
		if fixture.wantPersona != (decoded.PersonaCharacter != nil) {
			t.Fatalf("wrong typed variant for %s: %#v", fixture.kind, decoded)
		}
	}
	for _, kind := range []string{"", "profile", "realmPersona"} {
		var decoded SourceMaterializationPacketV3DtoSemanticPayload
		if err := json.Unmarshal([]byte(`{"sourceRef":{"kind":"`+kind+`"}}`), &decoded); err == nil {
			t.Fatalf("unknown/legacy discriminator %q must fail closed", kind)
		}
	}
}

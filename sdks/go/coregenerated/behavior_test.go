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
			MethodID string `json:"method_id"`
		} `json:"runtime_unary"`
		RuntimeStream struct {
			MethodID string `json:"method_id"`
		} `json:"runtime_stream"`
		RealmUnary struct {
			OperationID string `json:"operation_id"`
			Query       struct {
				Handle string `json:"handle"`
			} `json:"query"`
			Response struct {
				Available bool   `json:"available"`
				Message   string `json:"message"`
			} `json:"response"`
		} `json:"realm_unary"`
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
		return json.Marshal(BeginLoginResponse{
			Accepted:       true,
			LoginAttemptId: "login-conformance",
			CallbackOrigin: "https://app.example",
		})
	case t.fixtures.Cases.RealmUnary.OperationID:
		return json.Marshal(t.fixtures.Cases.RealmUnary.Response)
	default:
		return nil, errors.New("unexpected unary")
	}
}

func (t *fakeTransport) ServerStream(ctx context.Context, req sdkstypes.CoreStreamRequest) (coreclient.StreamReader, error) {
	t.streamCalls = append(t.streamCalls, req)
	if req.MethodID != t.fixtures.Cases.RuntimeStream.MethodID {
		return nil, errors.New("unexpected stream")
	}
	events := make([][]byte, 0, 2)
	for index, eventID := range []string{"event-1", "event-2"} {
		encoded, err := json.Marshal(AccountSessionEvent{
			EventId:   eventID,
			Sequence:  uint64(index + 1),
			EventType: "ACCOUNT_EVENT_TYPE_LOGIN_STARTED",
		})
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

func TestTypedRuntimeClientsPreserveRequestsAndTransportBehavior(t *testing.T) {
	fixtures := loadBehaviorFixtures(t)
	transport := &fakeTransport{fixtures: fixtures}
	core := coreclient.New(transport, func(context.Context) (sdkstypes.CoreMetadata, error) {
		return fixtures.Cases.Metadata.Auth, nil
	})
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
	var encodedRequest BeginLoginRequest
	if err := json.Unmarshal(transport.unaryCalls[0].Body, &encodedRequest); err != nil {
		t.Fatalf("decode typed request: %v", err)
	}
	if encodedRequest.Caller == nil || encodedRequest.Caller.AppId != "app-conformance" {
		t.Fatalf("typed caller was not preserved: %#v", encodedRequest.Caller)
	}

	stream, err := typedRuntime.SubscribeAccountSessionEvents(
		context.Background(),
		SubscribeAccountSessionEventsRequest{
			Caller:        &AccountCaller{AppId: "app-conformance"},
			AfterSequence: 0,
		},
		nil,
		0,
	)
	if err != nil {
		t.Fatalf("typed runtime stream: %v", err)
	}
	for range 2 {
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

	realmResponse, err := typedRealm.CheckHandle(
		context.Background(),
		RealmCheckHandleOperationRequest{
			Query: RealmCheckHandleOperationQuery{
				Handle: fixtures.Cases.RealmUnary.Query.Handle,
			},
		},
		fixtures.Cases.Metadata.Caller,
		fixtures.Cases.TimeoutMS,
	)
	if err != nil {
		t.Fatalf("typed Realm call: %v", err)
	}
	if realmResponse.Available != fixtures.Cases.RealmUnary.Response.Available ||
		realmResponse.Message != fixtures.Cases.RealmUnary.Response.Message {
		t.Fatalf("typed Realm response mismatch: %#v", realmResponse)
	}
	realmCall := transport.unaryCalls[len(transport.unaryCalls)-1]
	if realmCall.MethodID != fixtures.Cases.RealmUnary.OperationID {
		t.Fatalf("typed Realm operation mismatch: %s", realmCall.MethodID)
	}
	var realmBody struct {
		Query struct {
			Handle string `json:"handle"`
		} `json:"query"`
	}
	if err := json.Unmarshal(realmCall.Body, &realmBody); err != nil {
		t.Fatalf("decode typed Realm request: %v", err)
	}
	if realmBody.Query.Handle != fixtures.Cases.RealmUnary.Query.Handle {
		t.Fatalf("typed Realm query was not preserved: %#v", realmBody.Query)
	}
	if realmCall.TimeoutMS != fixtures.Cases.TimeoutMS {
		t.Fatalf("typed Realm timeout not propagated")
	}
	if realmCall.Metadata["x-nimi-access-token-id"] != fixtures.Cases.Metadata.Auth["x-nimi-access-token-id"] {
		t.Fatalf("typed Realm auth metadata not propagated")
	}
	if realmCall.Metadata["x-nimi-caller"] != fixtures.Cases.Metadata.Caller["x-nimi-caller"] {
		t.Fatalf("typed Realm caller metadata not propagated")
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

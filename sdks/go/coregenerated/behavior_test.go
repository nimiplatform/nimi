package coregenerated

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
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
		if os.Getenv("SDKS_CONFORMANCE_PROFILE") == "typed-core" {
			status := LocalAgentProvisionIntentStatus("ACKED")
			return json.Marshal(LocalAgentProvisionIntentDto{
				Id:            "intent-conformance",
				Status:        &status,
				LocalAgentRef: "local-agent",
				OwnerUserId:   "owner",
				RealmAgentId:  "realm-agent",
				Attempts:      1,
				AvailableAt:   "2026-01-01T00:00:00Z",
				CreatedAt:     "2026-01-01T00:00:00Z",
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
	data, err := os.ReadFile("../conformance/fixtures/behavior-fixtures.json")
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	var fixtures behaviorFixtures
	if err := json.Unmarshal(data, &fixtures); err != nil {
		t.Fatalf("parse fixtures: %v", err)
	}
	return fixtures
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

		outcome := LocalAgentProvisionIntentAckOutcome("established")
		realmResponse, err := typedRealm.AckMyLocalAgentProvisionIntent(
			context.Background(),
			RealmAckMyLocalAgentProvisionIntentOperationRequest{
				Path: RealmAckMyLocalAgentProvisionIntentOperationPath{IntentId: "intent-conformance"},
				Body: LocalAgentProvisionIntentAckDto{
					Outcome: &outcome,
					Detail:  "ok",
				},
			},
			nil,
			0,
		)
		if err != nil {
			t.Fatalf("typed realm operation: %v", err)
		}
		if realmResponse.Id != "intent-conformance" {
			t.Fatalf("typed realm response mismatch: %#v", realmResponse)
		}
		if transport.unaryCalls[1].MethodID != fixtures.Cases.RealmOperation.OperationID {
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

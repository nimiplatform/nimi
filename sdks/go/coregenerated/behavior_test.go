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
	switch req.MethodID {
	case t.fixtures.Cases.RuntimeUnary.MethodID:
		return json.Marshal(t.fixtures.Cases.RuntimeUnary.ResponseBody)
	case t.fixtures.Cases.RealmOperation.OperationID:
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
		encoded, err := json.Marshal(event)
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
	if transport.unaryCalls[0].Metadata["authorization"] != fixtures.Cases.Metadata.Auth["authorization"] {
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
	if runtimeClient.UnsafeRaw() != transport || realmClient.UnsafeRaw() != transport {
		t.Fatalf("unsafe raw transport mismatch")
	}
}

package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestExecuteScenarioTextGenerateSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hello from scenario"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}`))
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})

	resp, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen2.5",
			TargetRef:     setExactLocalScenarioTargetForTest(t, svc, "local/qwen2.5", "text.generate"),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello runtime"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario text generate: %v", err)
	}
	if resp.GetTraceId() == "" {
		t.Fatalf("trace id must be set")
	}
	if resp.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		t.Fatalf("unexpected route decision: %v", resp.GetRouteDecision())
	}
	text := outputText(resp.GetOutput())
	if text == "" {
		t.Fatalf("output text must be non-empty")
	}
}

func TestExecuteScenarioTextGenerateHydratesLocalEndpointFromActiveModel(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ready"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	localLister := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "local_qwen3",
				AssetId:      "qwen3-4b-q4_k_m",
				Engine:       "llama",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Endpoint:     server.URL + "/v1",
			}},
		}},
	}
	svc.localModel = localLister

	resp, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen3-4b-q4_k_m",
			TargetRef:     setExactLocalScenarioTargetForTest(t, svc, "local/qwen3-4b-q4_k_m", "text.generate", localLister.responses[0].Assets[0]),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello runtime"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario with hydrated local endpoint: %v", err)
	}
	if text := outputText(resp.GetOutput()); text != "ready" {
		t.Fatalf("unexpected hydrated local output: %q", text)
	}
	if localLister.calls != 0 {
		t.Fatalf("exact target execution must not search local model inventory, got %d calls", localLister.calls)
	}
	if len(localLister.leaseCalls) == 0 || localLister.leaseCalls[0] != "acquire:local_qwen3:text_generate_request" {
		t.Fatalf("expected sync lease to acquire selected plan asset, got %#v", localLister.leaseCalls)
	}
}

func TestExecuteScenarioTextGenerateUsesSelectedLocalProviderModelID(t *testing.T) {
	var providerModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		providerModel = body.Model
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ready"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	localLister := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "01KTEX08DS2GR9HJ1X3R459P1B",
				AssetId:      "local-import/gemma-4-26B-A4B-it-Q8_0",
				Engine:       "llama",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Endpoint:     server.URL + "/v1",
				Capabilities: []string{"text.generate"},
			}},
		}},
		managedNames: map[string]string{
			"01KTEX08DS2GR9HJ1X3R459P1B": "local-import/gemma-4-26B-A4B-it-Q8_0",
		},
	}
	svc.localModel = localLister

	resp, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "01KTEX08DS2GR9HJ1X3R459P1B",
			TargetRef:     setExactLocalScenarioTargetForTest(t, svc, "01KTEX08DS2GR9HJ1X3R459P1B", "text.generate", localLister.responses[0].Assets[0]),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello runtime"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario with local asset id: %v", err)
	}
	if text := outputText(resp.GetOutput()); text != "ready" {
		t.Fatalf("unexpected local asset id output: %q", text)
	}
	if providerModel != "local-import/gemma-4-26B-A4B-it-Q8_0" {
		t.Fatalf("provider request model = %q, want selected local provider model id", providerModel)
	}
	if providerModel == "01KTEX08DS2GR9HJ1X3R459P1B" {
		t.Fatalf("provider request must not use Runtime local_asset_id as model")
	}
}

func TestExecuteScenarioTextGenerateConsumesLocalRuntimeProfileBindingRef(t *testing.T) {
	var providerModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		providerModel = body.Model
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ready"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	localLister := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "01KTEX08DS2GR9HJ1X3R459P1B",
				AssetId:      "local-import/gemma-4-26B-A4B-it-Q8_0",
				Engine:       "llama",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Endpoint:     server.URL + "/v1",
				Capabilities: []string{"text.generate"},
			}},
		}},
		managedNames: map[string]string{
			"01KTEX08DS2GR9HJ1X3R459P1B": "local-import/gemma-4-26B-A4B-it-Q8_0",
		},
	}
	svc.localModel = localLister

	resp, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.tester",
			SubjectUserId: "user-001",
			ModelId:       "local-runtime:01KTEX08DS2GR9HJ1X3R459P1B",
			TargetRef:     setExactLocalScenarioTargetForTest(t, svc, "local-runtime:01KTEX08DS2GR9HJ1X3R459P1B", "text.generate", localLister.responses[0].Assets[0]),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello runtime"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario with local-runtime profile binding: %v", err)
	}
	if text := outputText(resp.GetOutput()); text != "ready" {
		t.Fatalf("unexpected local-runtime output: %q", text)
	}
	if providerModel != "local-import/gemma-4-26B-A4B-it-Q8_0" {
		t.Fatalf("provider request model = %q, want selected local provider model id", providerModel)
	}
	if providerModel == "local-runtime:01KTEX08DS2GR9HJ1X3R459P1B" {
		t.Fatalf("provider request must not use Runtime local-runtime target ref as model")
	}
}

func TestExecuteScenarioTextGenerateCloudAliasUsesAPIModelID(t *testing.T) {
	var providerModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode provider request: %v", err)
		}
		providerModel = body.Model
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ready"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}`))
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "volcengine", "doubao-seed-2.0-pro", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{"volcengine": {BaseURL: server.URL, APIKey: "unused"}},
		AllowLoopbackEndpoint: true,
	})

	resp, err := fixture.service.ExecuteScenario(fixture.context, &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.tester",
			SubjectUserId: "user-001",
			ModelId:       "doubao-seed-2.0-pro",
			TargetRef: cloudScenarioTargetRef(
				fixture.connectorID,
				fixture.descriptor.GetRemoteModelCatalogId(),
				"doubao-seed-2.0-pro",
				fixture.descriptor.GetProvider(),
			),
			RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:   30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello runtime"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario with cloud alias: %v", err)
	}
	if text := outputText(resp.GetOutput()); text != "ready" {
		t.Fatalf("unexpected cloud alias output: %q", text)
	}
	if providerModel != "doubao-seed-2-0-pro-260215" {
		t.Fatalf("provider request model = %q, want canonical API model id", providerModel)
	}
	if resp.GetResolvedExecutionBinding().GetCloud().GetProviderModelId() != "doubao-seed-2-0-pro-260215" {
		t.Fatalf("resolved binding provider_model_id = %q want canonical API model id", resp.GetResolvedExecutionBinding().GetCloud().GetProviderModelId())
	}
}

func TestExecuteScenarioTextGenerateDoesNotSynthesizeSentinelUsage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hello without usage"},"finish_reason":"stop"}]}`))
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})

	resp, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen2.5",
			TargetRef:     setExactLocalScenarioTargetForTest(t, svc, "local/qwen2.5", "text.generate"),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello runtime"},
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("execute scenario text generate without explicit upstream usage: %v", err)
	}
	if outputText(resp.GetOutput()) == "" {
		t.Fatalf("output text must be non-empty")
	}
	if resp.GetUsage() == nil {
		t.Fatal("expected backend-estimated usage")
	}
	if resp.GetUsage().GetInputTokens() < 0 || resp.GetUsage().GetOutputTokens() < 0 || resp.GetUsage().GetComputeMs() < 0 {
		t.Fatalf("expected usage without sentinel values, got=%#v", resp.GetUsage())
	}
}

func TestStreamScenarioTextGenerateSequence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"stream from scenario"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3}}`))
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}

	err := svc.StreamScenario(&runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen2.5",
			TargetRef:     setExactLocalScenarioTargetForTest(t, svc, "local/qwen2.5", "text.generate"),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     120_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "stream please"},
					},
				},
			},
		},
	}, stream)
	if err != nil {
		t.Fatalf("stream scenario text generate: %v", err)
	}
	if len(stream.events) < 2 {
		t.Fatalf("expected at least started and completed events, got %d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_STARTED {
		t.Fatalf("first event should be started, got=%v", stream.events[0].GetEventType())
	}
	hasDelta := false
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_DELTA {
			hasDelta = true
			break
		}
	}
	if !hasDelta {
		t.Fatalf("expected at least one delta event")
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
		t.Fatalf("last event should be completed, got=%v", last.GetEventType())
	}
}

func TestExecuteScenarioTextGenerateFallbackDenied(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "cloud/gpt-4",
			TargetRef:     setExactLocalScenarioTargetForTest(t, svc, "cloud/gpt-4", "text.generate"),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "hello"},
					},
				},
			},
		},
	})
	if err == nil {
		t.Fatalf("execute scenario should fail when fallback is denied")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ROUTE_FALLBACK_DENIED {
		t.Fatalf("unexpected reason: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_ROUTE_FALLBACK_DENIED)
	}
}

func TestStreamScenarioTextGenerateTimeoutEmitsFailedEvent(t *testing.T) {
	streamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		time.Sleep(80 * time.Millisecond)
	}))
	defer func() { streamServer.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: streamServer.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}

	err := svc.StreamScenario(&runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen2.5",
			TargetRef:     setExactLocalScenarioTargetForTest(t, svc, "local/qwen2.5", "text.generate"),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     10,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{
						{Role: "user", Content: "stream please"},
					},
				},
			},
		},
	}, stream)
	if err != nil {
		t.Fatalf("stream scenario should end with failed event instead of rpc error: %v", err)
	}
	if len(stream.events) < 2 {
		t.Fatalf("expected at least started + failed events, got %d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_STARTED {
		t.Fatalf("first event must be started")
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_FAILED {
		t.Fatalf("last event must be failed, got %v", last.GetEventType())
	}
	if last.GetFailed().GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("unexpected failed reason: %v", last.GetFailed().GetReasonCode())
	}
}

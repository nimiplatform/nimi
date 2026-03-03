package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGenerateSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hello from provider"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}`))
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
	})

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello runtime"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   30_000,
	})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if resp.GetTraceId() == "" {
		t.Fatalf("trace id must be set")
	}
	if resp.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME {
		t.Fatalf("unexpected route decision: %v", resp.GetRouteDecision())
	}
	text := resp.GetOutput().GetFields()["text"].GetStringValue()
	if text == "" {
		t.Fatalf("output text must be non-empty")
	}
}

func TestGenerateFallbackDenied(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "cloud/gpt-4",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	})
	if err == nil {
		t.Fatalf("generate must fail when fallback is denied")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_ROUTE_FALLBACK_DENIED.String() {
		t.Fatalf("unexpected reason: %s", st.Message())
	}
}

func TestGenerateMissingAppIDUsesAIAppIDRequired(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	})
	if err == nil {
		t.Fatalf("expected error for missing app_id")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status")
	}
	if st.Code() != codes.InvalidArgument || st.Message() != runtimev1.ReasonCode_AI_APP_ID_REQUIRED.String() {
		t.Fatalf("unexpected error: code=%v msg=%s", st.Code(), st.Message())
	}
}

func TestGenerateLocalModelExplicitEngineMismatchUsesProviderMismatch(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalModelLister(&staticLocalModelLister{
		models: []*runtimev1.LocalModelRecord{
			{
				LocalModelId: "01J00000000000000000000001",
				ModelId:      "qwen2.5",
				Engine:       "nexa",
				Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
			},
		},
	})

	_, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "localai/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello runtime"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   30_000,
	})
	if err == nil {
		t.Fatalf("expected explicit local engine mismatch error")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status")
	}
	if st.Code() != codes.FailedPrecondition || st.Message() != runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH.String() {
		t.Fatalf("unexpected error: code=%v msg=%s", st.Code(), st.Message())
	}
}

func TestGenerateLocalCustomModelMissingProfileUsesProfileMissing(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalModelLister(&staticLocalModelLister{
		models: []*runtimev1.LocalModelRecord{
			{
				LocalModelId: "01J00000000000000000000002",
				ModelId:      "custom-model",
				Engine:       "localai",
				Status:       runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE,
				Capabilities: []string{"custom"},
			},
		},
	})

	_, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/custom-model",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello runtime"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   30_000,
	})
	if err == nil {
		t.Fatalf("expected profile missing error")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status")
	}
	if st.Code() != codes.FailedPrecondition || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING.String() {
		t.Fatalf("unexpected error: code=%v msg=%s", st.Code(), st.Message())
	}
}

func TestStreamGenerateLocalModelUnavailableUsesLocalModelUnavailable(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalModelLister(&staticLocalModelLister{models: []*runtimev1.LocalModelRecord{}})
	stream := &streamGenerateCollector{ctx: context.Background()}

	err := svc.StreamGenerate(&runtimev1.StreamGenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "stream please"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   120_000,
	}, stream)
	if err == nil {
		t.Fatalf("expected local model unavailable error")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status")
	}
	if st.Code() != codes.FailedPrecondition || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("unexpected error: code=%v msg=%s", st.Code(), st.Message())
	}
}

func TestGenerateHonorsRequestTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		time.Sleep(80 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"late response"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`))
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
	})

	_, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello runtime"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   10,
	})
	if err == nil {
		t.Fatalf("generate should fail on request timeout")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.DeadlineExceeded {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String() {
		t.Fatalf("unexpected reason: %s", st.Message())
	}
}

func TestStreamGenerateSequence(t *testing.T) {
	streamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hello \"}}]}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"world\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		fmt.Fprintf(w, "data: [DONE]\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer streamServer.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: streamServer.URL}},
	})
	stream := &streamGenerateCollector{ctx: context.Background()}

	err := svc.StreamGenerate(&runtimev1.StreamGenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "tell me a joke"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   120_000,
	}, stream)
	if err != nil {
		t.Fatalf("stream generate: %v", err)
	}

	if len(stream.events) < 3 {
		t.Fatalf("expected >= 3 events (STARTED + DELTA(s) + COMPLETED), got %d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_STARTED {
		t.Fatalf("first event must be started, got %v", stream.events[0].GetEventType())
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
		t.Fatalf("last event must be completed, got %v", last.GetEventType())
	}
	for idx, event := range stream.events {
		expected := uint64(idx + 1)
		if event.GetSequence() != expected {
			t.Fatalf("sequence must be contiguous: got=%d expected=%d", event.GetSequence(), expected)
		}
	}
	// K-STREAM-003: usage is carried in the COMPLETED termframe, not a separate USAGE event.
	if last.GetCompleted().GetUsage() == nil {
		t.Fatalf("completed event must carry usage stats")
	}
}

func TestStreamGenerateUsesProviderNativeStream(t *testing.T) {
	streamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"Hello \"}}]}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"stream\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":7,\"completion_tokens\":2}}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		fmt.Fprintf(w, "data: [DONE]\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer streamServer.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: streamServer.URL}},
	})
	stream := &streamGenerateCollector{ctx: context.Background()}

	err := svc.StreamGenerate(&runtimev1.StreamGenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "stream please"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   120_000,
	}, stream)
	if err != nil {
		t.Fatalf("stream generate: %v", err)
	}

	joined := ""
	var completedEvent *runtimev1.StreamGenerateEvent
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_DELTA {
			joined += event.GetDelta().GetText()
		}
		if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
			completedEvent = event
		}
	}
	if strings.TrimSpace(joined) != "Hello stream" {
		t.Fatalf("joined delta mismatch: %q", joined)
	}
	// K-STREAM-003: usage is in the COMPLETED termframe.
	usage := completedEvent.GetCompleted().GetUsage()
	if usage == nil || usage.GetInputTokens() != 7 || usage.GetOutputTokens() != 2 {
		t.Fatalf("usage mismatch: %#v", usage)
	}
}

func TestStreamGenerateTimeoutEmitsFailedEvent(t *testing.T) {
	streamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		time.Sleep(80 * time.Millisecond)
	}))
	defer streamServer.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: streamServer.URL}},
	})
	stream := &streamGenerateCollector{ctx: context.Background()}

	err := svc.StreamGenerate(&runtimev1.StreamGenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "stream please"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   10,
	}, stream)
	if err != nil {
		t.Fatalf("stream generate should end with failed event instead of rpc error: %v", err)
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

func TestStreamGenerateFirstPacketTimeoutEmitsFailedEvent(t *testing.T) {
	streamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		time.Sleep(90 * time.Millisecond)
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer streamServer.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: streamServer.URL}},
	})
	svc.streamFirstPacketTimeout = 20 * time.Millisecond
	stream := &streamGenerateCollector{ctx: context.Background()}

	err := svc.StreamGenerate(&runtimev1.StreamGenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "stream please"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   3000,
	}, stream)
	if err != nil {
		t.Fatalf("stream generate should end with failed event instead of rpc error: %v", err)
	}
	if len(stream.events) < 2 {
		t.Fatalf("expected at least started + failed events, got %d", len(stream.events))
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_FAILED {
		t.Fatalf("last event must be failed, got %v", last.GetEventType())
	}
	if last.GetFailed().GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("unexpected failed reason: %v", last.GetFailed().GetReasonCode())
	}
}

func TestStreamGenerateBrokenStreamEmitsFailedEvent(t *testing.T) {
	streamServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		fmt.Fprintf(w, "data: {invalid-json}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer streamServer.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: streamServer.URL}},
	})
	stream := &streamGenerateCollector{ctx: context.Background()}

	err := svc.StreamGenerate(&runtimev1.StreamGenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "stream please"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   120000,
	}, stream)
	if err != nil {
		t.Fatalf("stream generate should end with failed event instead of rpc error: %v", err)
	}
	if len(stream.events) < 2 {
		t.Fatalf("expected at least started + failed events, got %d", len(stream.events))
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_FAILED {
		t.Fatalf("last event must be failed, got %v", last.GetEventType())
	}
	if last.GetFailed().GetReasonCode() != runtimev1.ReasonCode_AI_STREAM_BROKEN {
		t.Fatalf("unexpected failed reason: %v", last.GetFailed().GetReasonCode())
	}
}

func TestStreamGenerateFallbackSetsStreamSimulatedAndAudits(t *testing.T) {
	audit := auditlog.New(128, 128)
	svc := newFromProviderConfig(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		nil,
		audit,
		nil,
		Config{}.normalized(),
		8, 2,
	)
	svc.selector.local = &nonStreamingProvider{}
	stream := &streamGenerateCollector{ctx: context.Background()}

	err := svc.StreamGenerate(&runtimev1.StreamGenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/qwen2.5",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "fallback please"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   120_000,
	}, stream)
	if err != nil {
		t.Fatalf("stream generate fallback: %v", err)
	}

	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
		t.Fatalf("last event must be completed, got %v", last.GetEventType())
	}
	if !last.GetCompleted().GetStreamSimulated() {
		t.Fatalf("expected completed.stream_simulated=true for fallback stream path")
	}

	events := audit.ListEvents(&runtimev1.ListAuditEventsRequest{
		Domain: "runtime.ai",
	})
	found := false
	for _, event := range events.GetEvents() {
		if event.GetOperation() == "stream_fallback_simulated" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected stream_fallback_simulated audit event")
	}
}

// TestGenerateRejectsUnhealthyHintedProvider verifies that when a model's
// registry-hinted provider is unhealthy, the request fails with UNAVAILABLE
// instead of falling back to another provider (NIMI-032).
func TestGenerateRejectsUnhealthyHintedProvider(t *testing.T) {
	nimiServer := newChatServer(t, "from-nimillm", new(int32))
	defer nimiServer.Close()

	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID:      "qwen-max",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate"},
		ProviderHint: modelregistry.ProviderHintDashScope,
	})

	healthTracker := providerhealth.New()
	healthTracker.Mark("cloud-nimillm", true, "")
	healthTracker.Mark("cloud-dashscope", false, "timeout")

	svc := newFromProviderConfig(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		registry,
		healthTracker,
		auditlog.New(128, 128),
		nil,
		Config{
			CloudProviders: map[string]nimillm.ProviderCredentials{"nimillm": {BaseURL: nimiServer.URL}},
		}.normalized(),
		8, 2,
	)

	_, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "cloud/qwen-max",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello runtime"},
		},
		RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:    runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:   30_000,
	})
	if err == nil {
		t.Fatalf("expected UNAVAILABLE error when hinted provider is unhealthy")
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("expected Unavailable, got=%v", status.Code(err))
	}
}

type streamGenerateCollector struct {
	ctx    context.Context
	events []*runtimev1.StreamGenerateEvent
}

type staticLocalModelLister struct {
	models []*runtimev1.LocalModelRecord
}

func (s *staticLocalModelLister) ListLocalModels(_ context.Context, req *runtimev1.ListLocalModelsRequest) (*runtimev1.ListLocalModelsResponse, error) {
	filter := req.GetStatusFilter()
	out := make([]*runtimev1.LocalModelRecord, 0, len(s.models))
	for _, model := range s.models {
		if filter != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_UNSPECIFIED && model.GetStatus() != filter {
			continue
		}
		out = append(out, model)
	}
	return &runtimev1.ListLocalModelsResponse{
		Models: out,
	}, nil
}

type nonStreamingProvider struct{}

func (p *nonStreamingProvider) Route() runtimev1.RoutePolicy {
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
}

func (p *nonStreamingProvider) ResolveModelID(raw string) string {
	return strings.TrimSpace(strings.TrimPrefix(raw, "local/"))
}

func (p *nonStreamingProvider) CheckModelAvailability(modelID string) error {
	if strings.TrimSpace(modelID) == "" {
		return status.Error(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND.String())
	}
	return nil
}

func (p *nonStreamingProvider) GenerateText(_ context.Context, _ string, _ *runtimev1.GenerateRequest, _ string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	return "simulated fallback output", &runtimev1.UsageStats{InputTokens: 2, OutputTokens: 3, ComputeMs: 1}, runtimev1.FinishReason_FINISH_REASON_STOP, nil
}

func (p *nonStreamingProvider) Embed(_ context.Context, _ string, _ []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	return nil, nil, nil
}

func (s *streamGenerateCollector) Send(event *runtimev1.StreamGenerateEvent) error {
	cloned := proto.Clone(event)
	copy, ok := cloned.(*runtimev1.StreamGenerateEvent)
	if !ok {
		copy = &runtimev1.StreamGenerateEvent{}
	}
	s.events = append(s.events, copy)
	return nil
}

func (s *streamGenerateCollector) SetHeader(metadata.MD) error  { return nil }
func (s *streamGenerateCollector) SendHeader(metadata.MD) error { return nil }
func (s *streamGenerateCollector) SetTrailer(metadata.MD)       {}
func (s *streamGenerateCollector) Context() context.Context     { return s.ctx }
func (s *streamGenerateCollector) SendMsg(any) error            { return nil }
func (s *streamGenerateCollector) RecvMsg(any) error            { return nil }

package ai

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
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

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: server.URL,
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
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

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

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: server.URL,
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

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: streamServer.URL,
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

	if len(stream.events) < 4 {
		t.Fatalf("expected >= 4 events, got %d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_STARTED {
		t.Fatalf("first event must be started, got %v", stream.events[0].GetEventType())
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
		t.Fatalf("last event must be completed, got %v", last.GetEventType())
	}
	foundUsage := false
	for idx, event := range stream.events {
		expected := uint64(idx + 1)
		if event.GetSequence() != expected {
			t.Fatalf("sequence must be contiguous: got=%d expected=%d", event.GetSequence(), expected)
		}
		if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_USAGE {
			foundUsage = true
		}
	}
	if !foundUsage {
		t.Fatalf("usage event must exist")
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

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: streamServer.URL,
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
	var usage *runtimev1.UsageStats
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_DELTA {
			joined += event.GetDelta().GetText()
		}
		if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_USAGE {
			usage = event.GetUsage()
		}
	}
	if strings.TrimSpace(joined) != "Hello stream" {
		t.Fatalf("joined delta mismatch: %q", joined)
	}
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

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: streamServer.URL,
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
	original := streamFirstPacketTimeout
	streamFirstPacketTimeout = 20 * time.Millisecond
	t.Cleanup(func() {
		streamFirstPacketTimeout = original
	})

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

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: streamServer.URL,
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

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: streamServer.URL,
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

func TestGenerateRecordsRouteAutoSwitchAudit(t *testing.T) {
	liteCalls := int32(0)
	liteServer := newChatServer(t, "from-litellm", &liteCalls)
	defer liteServer.Close()

	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID:      "qwen-max",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate"},
		ProviderHint: modelregistry.ProviderHintAlibaba,
	})

	healthTracker := providerhealth.New()
	healthTracker.Mark("cloud-litellm", true, "")
	healthTracker.Mark("cloud-alibaba", false, "timeout")

	auditStore := auditlog.New(128, 128)
	svc := NewWithDependencies(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		registry,
		healthTracker,
		auditStore,
		Config{
			CloudLiteLLMBaseURL: liteServer.URL,
		},
	)
	registryPath := filepath.Join(t.TempDir(), "model-registry.json")
	svc.SetModelRegistryPersistencePath(registryPath)

	resp, err := svc.Generate(context.Background(), &runtimev1.GenerateRequest{
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
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if resp.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API {
		t.Fatalf("unexpected route decision: %v", resp.GetRouteDecision())
	}
	if got := atomic.LoadInt32(&liteCalls); got != 1 {
		t.Fatalf("litellm calls mismatch: got=%d want=1", got)
	}

	updated, exists := registry.Get("qwen-max")
	if !exists {
		t.Fatalf("registry entry qwen-max must exist")
	}
	if updated.ProviderHint != modelregistry.ProviderHintLiteLLM {
		t.Fatalf("provider hint should auto-switch to litellm, got=%s", updated.ProviderHint)
	}
	reloaded, err := modelregistry.NewFromFile(registryPath)
	if err != nil {
		t.Fatalf("reload registry from file: %v", err)
	}
	reloadedEntry, ok := reloaded.Get("qwen-max")
	if !ok {
		t.Fatalf("reloaded registry entry qwen-max must exist")
	}
	if reloadedEntry.ProviderHint != modelregistry.ProviderHintLiteLLM {
		t.Fatalf("reloaded provider hint mismatch: %s", reloadedEntry.ProviderHint)
	}

	events := auditStore.ListEvents(&runtimev1.ListAuditEventsRequest{
		AppId:  "nimi.desktop",
		Domain: "runtime.ai",
	})
	found := false
	for _, event := range events.GetEvents() {
		if event.GetOperation() != "route.auto_switch" {
			continue
		}
		found = true
		if event.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
			t.Fatalf("unexpected reason code: %v", event.GetReasonCode())
		}
		if event.GetPayload() == nil {
			t.Fatalf("route auto-switch event payload must exist")
		}
		if got := event.GetPayload().GetFields()["hintFrom"].GetStringValue(); got != string(modelregistry.ProviderHintAlibaba) {
			t.Fatalf("hintFrom mismatch: got=%s", got)
		}
		if got := event.GetPayload().GetFields()["hintTo"].GetStringValue(); got != string(modelregistry.ProviderHintLiteLLM) {
			t.Fatalf("hintTo mismatch: got=%s", got)
		}
	}
	if !found {
		t.Fatalf("route.auto_switch audit event must exist")
	}
}

type streamGenerateCollector struct {
	ctx    context.Context
	events []*runtimev1.StreamGenerateEvent
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

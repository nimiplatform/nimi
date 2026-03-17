package ai

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestStreamScenarioSpeechSynthesizeSuccess(t *testing.T) {
	payload := []byte("speech-audio-payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "hello world",
				},
			},
		},
	}

	if err := svc.StreamScenario(req, stream); err != nil {
		t.Fatalf("stream scenario speech synthesize: %v", err)
	}
	if len(stream.events) < 4 {
		t.Fatalf("expected at least 4 events, got=%d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_STARTED {
		t.Fatalf("first event should be started, got=%v", stream.events[0].GetEventType())
	}

	var sawDelta bool
	var sawUsage bool
	var completed *runtimev1.ScenarioStreamCompleted
	for _, event := range stream.events {
		switch event.GetEventType() {
		case runtimev1.StreamEventType_STREAM_EVENT_DELTA:
			if len(event.GetDelta().GetChunk()) == 0 {
				t.Fatalf("delta chunk should not be empty")
			}
			if event.GetDelta().GetMimeType() == "" {
				t.Fatalf("delta mime type should be set")
			}
			sawDelta = true
		case runtimev1.StreamEventType_STREAM_EVENT_USAGE:
			sawUsage = true
		case runtimev1.StreamEventType_STREAM_EVENT_COMPLETED:
			completed = event.GetCompleted()
		}
	}
	if !sawDelta {
		t.Fatalf("expected delta event")
	}
	if !sawUsage {
		t.Fatalf("expected usage event")
	}
	if completed == nil {
		t.Fatalf("expected completed event")
	}
	if completed.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", completed.GetFinishReason())
	}
	if completed.GetUsage() == nil {
		t.Fatalf("expected usage in completed event")
	}
}

func TestStreamScenarioSpeechSynthesizeValidation(t *testing.T) {
	// K-STREAM-002: pre-stream validation failures return a gRPC error without emitting stream events.
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/tts",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{},
			},
		},
	}

	err := svc.StreamScenario(req, stream)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got=%v err=%v", status.Code(err), err)
	}
	if len(stream.events) != 0 {
		t.Fatalf("expected no stream events before validation passes, got=%d", len(stream.events))
	}
}

func TestStreamScenarioSpeechSynthesizeProviderErrorSendsFailedEvent(t *testing.T) {
	// K-STREAM-004: failed speech terminal event must carry a reason code.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "provider failure", http.StatusInternalServerError)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "hello world",
				},
			},
		},
	}

	if err := svc.StreamScenario(req, stream); err != nil {
		t.Fatalf("stream scenario should return nil and emit failed event, err=%v", err)
	}
	if len(stream.events) < 2 {
		t.Fatalf("expected started + failed events, got=%d", len(stream.events))
	}
	if stream.events[0].GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_STARTED {
		t.Fatalf("first event should be started, got=%v", stream.events[0].GetEventType())
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_FAILED {
		t.Fatalf("expected failed event, got=%v", last.GetEventType())
	}
	if last.GetFailed().GetReasonCode() == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		t.Fatalf("failed event reason_code should be set")
	}
}

func TestStreamSpeechDoneFrameConstraints(t *testing.T) {
	// K-STREAM-004: success terminal event closes the stream; audio chunks are only sent on DELTA events.
	payload := []byte("speech-audio-payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello world"},
			},
		},
	}

	if err := svc.StreamScenario(req, stream); err != nil {
		t.Fatalf("stream scenario: %v", err)
	}
	if len(stream.events) == 0 {
		t.Fatal("expected stream events")
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
		t.Fatalf("expected completed terminal event, got %v", last.GetEventType())
	}
	for _, event := range stream.events {
		if event.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_DELTA {
			continue
		}
		if len(event.GetDelta().GetChunk()) == 0 {
			t.Fatal("speech delta events must carry non-empty audio chunks")
		}
	}
}

func TestStreamFirstPacketTimeout(t *testing.T) {
	// K-STREAM-007: speech stream first-packet timeout is independent and returns AI_PROVIDER_TIMEOUT.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(100 * time.Millisecond)
		if r.Context().Err() != nil {
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("late-payload"))
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL}},
	})
	svc.streamFirstPacketTimeout = 20 * time.Millisecond

	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     500,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello world"},
			},
		},
	}

	if err := svc.StreamScenario(req, stream); err != nil {
		t.Fatalf("expected terminal failed event instead of direct error, got %v", err)
	}
	if len(stream.events) < 2 {
		t.Fatalf("expected started + failed events, got=%d", len(stream.events))
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_FAILED {
		t.Fatalf("expected failed terminal event, got %v", last.GetEventType())
	}
	if last.GetFailed().GetReasonCode() != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("expected AI_PROVIDER_TIMEOUT, got %v", last.GetFailed().GetReasonCode())
	}
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_DELTA {
			t.Fatalf("expected no speech deltas before first packet timeout, got %#v", event.GetDelta())
		}
	}
}

func TestStreamScenarioSpeechSynthesizeLargePayloadChunking(t *testing.T) {
	largePayload := make([]byte, 100*1024)
	for i := range largePayload {
		largePayload[i] = byte(i % 256)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(largePayload)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "hello world",
				},
			},
		},
	}

	if err := svc.StreamScenario(req, stream); err != nil {
		t.Fatalf("stream scenario speech synthesize: %v", err)
	}

	chunkCount := 0
	totalBytes := 0
	for _, event := range stream.events {
		if event.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_DELTA {
			continue
		}
		chunkCount++
		totalBytes += len(event.GetDelta().GetChunk())
	}
	expectedChunks := (len(largePayload) + defaultSpeechStreamChunkSize - 1) / defaultSpeechStreamChunkSize
	if chunkCount != expectedChunks {
		t.Fatalf("chunk count mismatch: got=%d want=%d", chunkCount, expectedChunks)
	}
	if totalBytes != len(largePayload) {
		t.Fatalf("payload bytes mismatch: got=%d want=%d", totalBytes, len(largePayload))
	}
}

func TestStreamScenarioSpeechSynthesizeForwardsScenarioExtensions(t *testing.T) {
	var capturedExtensions map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		defer r.Body.Close()

		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode speech request: %v", err)
		}
		ext, ok := payload["extensions"].(map[string]any)
		if !ok {
			t.Fatalf("expected extensions map in request, got=%T", payload["extensions"])
		}
		capturedExtensions = ext

		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("speech-audio-payload"))
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{"openai": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/tts-1",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Extensions: []*runtimev1.ScenarioExtension{
			{
				Namespace: "nimi.scenario.speech_synthesize.request",
				Payload: mustStructPB(t, map[string]any{
					"voice_style": "warm",
					"latency":     "low",
				}),
			},
		},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "hello world",
				},
			},
		},
	}

	if err := svc.StreamScenario(req, stream); err != nil {
		t.Fatalf("stream scenario speech synthesize: %v", err)
	}
	if got := strings.TrimSpace(nimillm.ValueAsString(capturedExtensions["voice_style"])); got != "warm" {
		t.Fatalf("expected stream extension to reach backend, got=%q", got)
	}
}

func TestStreamCloseModeDoneTrueCarriesUsage(t *testing.T) {
	// K-STREAM-001 mode 1: done=true close carries final usage.
	// K-STREAM-003: text stream completed event includes usage stats.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		// Simulate a normal SSE completion with a finish_reason
		chunks := []string{
			`data: {"choices":[{"delta":{"content":"Hello world response text here!"},"finish_reason":null}]}` + "\n\n",
			`data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":8}}` + "\n\n",
			"data: [DONE]\n\n",
		}
		for _, chunk := range chunks {
			_, _ = w.Write([]byte(chunk))
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}},
				},
			},
		},
	}
	if err := svc.StreamScenario(req, stream); err != nil {
		t.Fatalf("stream scenario: %v", err)
	}

	// Verify event sequence ends with COMPLETED carrying usage
	var completed *runtimev1.ScenarioStreamCompleted
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
			completed = event.GetCompleted()
		}
	}
	if completed == nil {
		t.Fatal("expected COMPLETED event (done=true close mode)")
	}
	if completed.GetUsage() == nil {
		t.Fatal("COMPLETED event must carry usage stats (K-STREAM-003)")
	}
}

func TestStreamCloseModeTerminalEventOnError(t *testing.T) {
	// K-STREAM-001 mode 2: terminal FAILED event closes stream.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}},
				},
			},
		},
	}
	if err := svc.StreamScenario(req, stream); err != nil {
		t.Fatalf("expected nil error (terminal event emitted instead), got %v", err)
	}

	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_FAILED {
		t.Fatalf("last event should be FAILED terminal event, got %v", last.GetEventType())
	}
	if last.GetFailed().GetReasonCode() == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		t.Fatal("FAILED event must carry a reason code")
	}
}

func TestStreamChunkMinBytes(t *testing.T) {
	// K-STREAM-006: minimum 32 bytes before flushing a text delta.
	if minStreamChunkBytes != 32 {
		t.Fatalf("minStreamChunkBytes = %d, spec requires 32 (K-STREAM-006)", minStreamChunkBytes)
	}
}

type mockScenarioEventStream struct {
	ctx    context.Context
	events []*runtimev1.StreamScenarioEvent
}

func (m *mockScenarioEventStream) Send(event *runtimev1.StreamScenarioEvent) error {
	m.events = append(m.events, event)
	return nil
}

func (m *mockScenarioEventStream) Context() context.Context {
	return m.ctx
}

func (m *mockScenarioEventStream) SendHeader(_ metadata.MD) error { return nil }
func (m *mockScenarioEventStream) SetHeader(_ metadata.MD) error  { return nil }
func (m *mockScenarioEventStream) SetTrailer(_ metadata.MD)       {}
func (m *mockScenarioEventStream) RecvMsg(any) error              { return nil }
func (m *mockScenarioEventStream) SendMsg(any) error              { return nil }

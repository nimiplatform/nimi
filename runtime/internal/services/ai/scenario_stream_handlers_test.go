package ai

import (
	"bytes"
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
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestStreamScenarioSpeechSynthesizeSuccess(t *testing.T) {
	payload := []byte("speech-audio-payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(payload)
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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
	var completed *runtimev1.ScenarioStreamCompleted
	for _, event := range stream.events {
		switch event.GetEventType() {
		case runtimev1.StreamEventType_STREAM_EVENT_DELTA:
			if len(deltaArtifactChunk(event.GetDelta())) == 0 {
				t.Fatalf("delta chunk should not be empty")
			}
			if deltaArtifactMimeType(event.GetDelta()) == "" {
				t.Fatalf("delta mime type should be set")
			}
			sawDelta = true
		case runtimev1.StreamEventType_STREAM_EVENT_COMPLETED:
			completed = event.GetCompleted()
		}
	}
	if !sawDelta {
		t.Fatalf("expected delta event")
	}
	if completed == nil {
		t.Fatalf("expected completed event")
	}
	if completed.GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("unexpected finish reason: %v", completed.GetFinishReason())
	}
	if completed.GetUsage() == nil {
		t.Fatal("expected backend-estimated usage in completed event")
	}
	if completed.GetUsage().GetInputTokens() < 0 || completed.GetUsage().GetOutputTokens() < 0 || completed.GetUsage().GetComputeMs() < 0 {
		t.Fatalf("expected non-negative usage without sentinel values, got=%#v", completed.GetUsage())
	}
}

func TestStreamScenarioSpeechSynthesizeLocalRouteUsesAssetLease(t *testing.T) {
	payload := []byte("speech-audio-payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(payload)
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalProviderEndpoint("speech", server.URL+"/v1", "")
	localModels := &fakeLocalModelLister{
		responses: repeatedLocalAssetResponses(4, &runtimev1.LocalAssetRecord{
			LocalAssetId: "local-speech-tts",
			AssetId:      "speech/qwen3tts",
			Engine:       "speech",
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Capabilities: []string{"audio.synthesize"},
		}),
	}
	svc.localModel = localModels
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "speech/qwen3tts",
			TargetRef:     localScenarioTargetRefForModel("speech/qwen3tts"),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
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
	wantAcquire := "acquire:local-speech-tts:stream_speech_synthesize_request"
	wantRelease := "release:local-speech-tts:stream_speech_synthesize_request_cleanup"
	if !testStringSliceContains(localModels.leaseCalls, wantAcquire) || !testStringSliceContains(localModels.leaseCalls, wantRelease) {
		t.Fatalf("expected local speech lease acquire/release, got %#v", localModels.leaseCalls)
	}
}

func testStringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
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
			TargetRef:     localScenarioTargetRefForModel("local/tts"),
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

func TestStreamScenarioSpeechSynthesizeCapabilityGuardFailsClosed(t *testing.T) {
	fixture := newManagedCloudScenarioTestFixture(t, "anthropic", "claude-sonnet-4-6", "https://example.com", Config{})
	svc := fixture.service
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "anthropic/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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

	err := svc.StreamScenario(req, stream)
	if err == nil {
		t.Fatalf("expected speech stream capability guard error")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
	if len(stream.events) != 0 {
		t.Fatalf("capability guard must fail before stream events, got=%d", len(stream.events))
	}
}

func TestStreamScenarioSpeechSynthesizeProviderErrorSendsFailedEvent(t *testing.T) {
	// K-STREAM-004: failed speech terminal event must carry a reason code.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		http.Error(w, "provider failure", http.StatusInternalServerError)
	}))
	defer func() { server.Close() }()

	var logs bytes.Buffer
	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	svc.logger = slog.New(slog.NewTextHandler(&logs, nil))
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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
	if !strings.Contains(logs.String(), "scenario stream failed") {
		t.Fatalf("expected failure cause to be logged, got logs=%q", logs.String())
	}
}

func TestStreamSpeechDoneFrameConstraints(t *testing.T) {
	// K-STREAM-004: success terminal event closes the stream; audio chunks are only sent on DELTA events.
	payload := []byte("speech-audio-payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(payload)
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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
		if len(deltaArtifactChunk(event.GetDelta())) == 0 {
			t.Fatal("speech delta events must carry non-empty audio chunks")
		}
	}
}

func TestStreamFirstPacketTimeout(t *testing.T) {
	// K-STREAM-007: speech stream first-packet timeout is independent and returns AI_PROVIDER_TIMEOUT.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		time.Sleep(100 * time.Millisecond)
		if r.Context().Err() != nil {
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("late-payload"))
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	svc.streamFirstPacketTimeout = 20 * time.Millisecond

	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(largePayload)
	}))
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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
		totalBytes += len(deltaArtifactChunk(event.GetDelta()))
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
		if writeOpenAITTSModelsIfRequested(w, r) {
			return
		}
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		defer func() { _ = r.Body.Close() }()

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
	defer func() { server.Close() }()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "tts-1", server.URL, Config{AllowLoopbackEndpoint: true})
	svc := fixture.service
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "openai/" + fixture.descriptor.GetProviderModelId(),
			ConnectorId:   fixture.connectorID,
			TargetRef:     fixture.targetRef,
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
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen",
			TargetRef:     localScenarioTargetRefForModel("local/qwen"),
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

	// Verify event sequence ends with COMPLETED carrying backend-estimated usage, not sentinel values.
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
		t.Fatal("expected completed usage")
	}
	if completed.GetUsage().GetInputTokens() < 0 || completed.GetUsage().GetOutputTokens() < 0 || completed.GetUsage().GetComputeMs() < 0 {
		t.Fatalf("expected completed usage without sentinel values, got=%#v", completed.GetUsage())
	}
}

func TestStreamScenarioTextGenerateStartedCarriesResolvedCloudBinding(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
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

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	connectorSvc := connector.New(logger, store, nil)
	ctx := userCtx("user-001")
	created, err := connectorSvc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "openai",
		Endpoint: server.URL,
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	descriptor := connectorModelDescriptorForAITest(t, connectorSvc, ctx, connectorID, "gpt-4o-mini")

	svc, err := newFromProviderConfig(logger, nil, nil, nil, store, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{"openai": {BaseURL: "https://api.openai.com/v1", APIKey: "unused"}},
		AllowLoopbackEndpoint: true,
	}, 8, 2)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	streamCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-key-source", "managed"))
	stream := &mockScenarioEventStream{ctx: streamCtx}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
					Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
						Version:              "v2",
						ConnectorId:          connectorID,
						RemoteModelCatalogId: descriptor.GetRemoteModelCatalogId(),
						ProviderModelId:      descriptor.GetProviderModelId(),
						Provider:             descriptor.GetProvider(),
					},
				},
			},
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
	if len(stream.events) == 0 || stream.events[0].GetStarted() == nil {
		t.Fatalf("expected first started event, got %#v", stream.events)
	}
	binding := stream.events[0].GetStarted().GetResolvedExecutionBinding()
	if binding == nil {
		t.Fatalf("started resolved_execution_binding missing")
	}
	cloud := binding.GetCloud()
	if cloud == nil {
		t.Fatalf("started cloud binding missing: %#v", binding)
	}
	if cloud.GetRemoteModelCatalogId() != descriptor.GetRemoteModelCatalogId() {
		t.Fatalf("remote_model_catalog_id = %q want %q", cloud.GetRemoteModelCatalogId(), descriptor.GetRemoteModelCatalogId())
	}
	if binding.GetRouteMetadataRef() == "" {
		t.Fatalf("route_metadata_ref missing")
	}
}

func TestStreamScenarioTextGenerateCloudAliasUsesAPIModelID(t *testing.T) {
	var capturedModel string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request body: %v", err)
			http.Error(w, "bad body", http.StatusBadRequest)
			return
		}
		capturedModel, _ = body["model"].(string)
		w.Header().Set("Content-Type", "text/event-stream")
		chunks := []string{
			`data: {"choices":[{"delta":{"content":"canonical model accepted response text"},"finish_reason":null}]}` + "\n\n",
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

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := connector.NewConnectorStoreWithMemorySecrets(t.TempDir())
	connectorSvc := connector.New(logger, store, nil)
	ctx := userCtx("user-001")
	created, err := connectorSvc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{
		Provider: "volcengine",
		Endpoint: server.URL,
		ApiKey:   "managed-key",
	})
	if err != nil {
		t.Fatalf("CreateConnector: %v", err)
	}
	connectorID := created.GetConnector().GetConnectorId()
	descriptor := connectorModelDescriptorForAITest(t, connectorSvc, ctx, connectorID, "doubao-seed-2.0-pro")

	svc, err := newFromProviderConfig(logger, nil, nil, nil, store, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{"volcengine": {BaseURL: server.URL, APIKey: "unused"}},
		AllowLoopbackEndpoint: true,
	}, 8, 2)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	streamCtx := metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-key-source", "managed"))
	stream := &mockScenarioEventStream{ctx: streamCtx}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
			TargetRef: &runtimev1.RuntimeDurableTargetRef{
				Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
					Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
						Version:              "v2",
						ConnectorId:          connectorID,
						RemoteModelCatalogId: descriptor.GetRemoteModelCatalogId(),
						ProviderModelId:      descriptor.GetProviderModelId(),
						Provider:             descriptor.GetProvider(),
					},
				},
			},
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
	if capturedModel != "doubao-seed-2-0-pro-260215" {
		t.Fatalf("provider request model = %q, want canonical API model id", capturedModel)
	}
	if len(stream.events) == 0 || stream.events[len(stream.events)-1].GetCompleted() == nil {
		t.Fatalf("expected stream completion, got %#v", stream.events)
	}
}

func TestStreamCloseModeTerminalEventOnError(t *testing.T) {
	// K-STREAM-001 mode 2: terminal FAILED event closes stream.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})
	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen",
			TargetRef:     localScenarioTargetRefForModel("local/qwen"),
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

func TestStreamTextFirstPacketTimeoutStartsAfterStreamEstablished(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
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
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})
	svc.streamFirstPacketTimeout = 20 * time.Millisecond
	localLister := &fakeLocalModelLister{
		acquireDelay: 40 * time.Millisecond,
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "local_qwen",
				AssetId:      "qwen",
				Engine:       "llama",
				Capabilities: []string{"chat"},
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			}},
		}},
	}
	svc.SetLocalModelLister(localLister)

	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen",
			TargetRef:     localScenarioTargetRefForModel("local/qwen"),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     500,
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
	if len(stream.events) < 2 {
		t.Fatalf("expected started + terminal events, got=%d", len(stream.events))
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
		t.Fatalf("expected completed terminal event, got %v", last.GetEventType())
	}
	if localLister.calls != 1 {
		t.Fatalf("expected stream text validation and lease to share one local model list, got %d", localLister.calls)
	}
	if len(localLister.leaseCalls) == 0 || localLister.leaseCalls[0] != "acquire:local_qwen:stream_text_generate_request" {
		t.Fatalf("expected lease to acquire selected plan asset, got %#v", localLister.leaseCalls)
	}
}

func TestStreamTextFirstPacketTimeoutTreatsToolCallChunksAsActivity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}` + "\n\n"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		time.Sleep(40 * time.Millisecond)
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":0,"total_tokens":5}}` + "\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}))
	defer func() { server.Close() }()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"llama": {BaseURL: server.URL}},
	})
	svc.streamFirstPacketTimeout = 20 * time.Millisecond

	stream := &mockScenarioEventStream{ctx: context.Background()}
	req := &runtimev1.StreamScenarioRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/qwen2.5",
			TargetRef:     localScenarioTargetRefForModel("local/qwen2.5"),
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     500,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_TextGenerate{
				TextGenerate: &runtimev1.TextGenerateScenarioSpec{
					Input: []*runtimev1.ChatMessage{{Role: "user", Content: "call tool"}},
				},
			},
		},
	}

	if err := svc.StreamScenario(req, stream); err != nil {
		t.Fatalf("stream scenario: %v", err)
	}
	if len(stream.events) < 2 {
		t.Fatalf("expected started + completed events, got=%d", len(stream.events))
	}
	last := stream.events[len(stream.events)-1]
	if last.GetEventType() != runtimev1.StreamEventType_STREAM_EVENT_COMPLETED {
		t.Fatalf("expected completed terminal event, got %v", last.GetEventType())
	}
	if last.GetCompleted().GetFinishReason() != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("unexpected finish reason: %v", last.GetCompleted().GetFinishReason())
	}
	for _, event := range stream.events {
		if event.GetEventType() == runtimev1.StreamEventType_STREAM_EVENT_FAILED {
			t.Fatalf("unexpected failed terminal event: %#v", event.GetFailed())
		}
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

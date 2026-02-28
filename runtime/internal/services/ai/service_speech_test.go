package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestGetSpeechVoicesReturnsPresets(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudNimiLLMBaseURL: "http://example.com",
		CloudNimiLLMAPIKey:  "test-key",
	})

	resp, err := svc.GetSpeechVoices(context.Background(), &runtimev1.GetSpeechVoicesRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "nimillm/qwen3-tts-instruct-flash",
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	})
	if err != nil {
		t.Fatalf("getSpeechVoices: %v", err)
	}
	if len(resp.GetVoices()) == 0 {
		t.Fatalf("expected non-empty voices list")
	}
	if resp.GetTraceId() == "" {
		t.Fatalf("trace id must be set")
	}
	if resp.GetModelResolved() == "" {
		t.Fatalf("model_resolved must be set")
	}
}

func TestGetSpeechVoicesDashScopePresets(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudAlibabaBaseURL: "http://example.com",
		CloudAlibabaAPIKey:  "test-key",
	})

	resp, err := svc.GetSpeechVoices(context.Background(), &runtimev1.GetSpeechVoicesRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "aliyun/qwen3-tts-instruct-flash",
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	})
	if err != nil {
		t.Fatalf("getSpeechVoices: %v", err)
	}
	if len(resp.GetVoices()) != 10 {
		t.Fatalf("expected 10 DashScope voices, got=%d", len(resp.GetVoices()))
	}
	firstVoice := resp.GetVoices()[0]
	if firstVoice.GetVoiceId() != "Cherry" {
		t.Fatalf("first voice should be Cherry, got=%s", firstVoice.GetVoiceId())
	}
}

func TestGetSpeechVoicesValidation(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

	_, err := svc.GetSpeechVoices(context.Background(), &runtimev1.GetSpeechVoicesRequest{
		AppId:         "",
		SubjectUserId: "",
		ModelId:       "",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got=%v", status.Code(err))
	}
}

func TestStreamSpeechSynthesisSuccess(t *testing.T) {
	speechBytes := []byte("audio-payload-for-stream")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: server.URL,
	})

	collected := make([][]byte, 0)
	var lastChunk *runtimev1.ArtifactChunk
	mockStream := &mockArtifactChunkStream{
		ctx: context.Background(),
		sendFn: func(chunk *runtimev1.ArtifactChunk) error {
			collected = append(collected, chunk.GetChunk())
			lastChunk = chunk
			return nil
		},
	}

	err := svc.StreamSpeechSynthesis(&runtimev1.StreamSpeechSynthesisRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/tts",
		SpeechSpec:    &runtimev1.SpeechSynthesisSpec{Text: "hello world"},
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
	}, mockStream)
	if err != nil {
		t.Fatalf("streamSpeechSynthesis: %v", err)
	}
	if len(collected) == 0 {
		t.Fatalf("expected at least one chunk")
	}
	if lastChunk == nil || !lastChunk.GetEof() {
		t.Fatalf("last chunk must have eof=true")
	}
	if lastChunk.GetTraceId() == "" {
		t.Fatalf("trace id must be set")
	}
	if lastChunk.GetMimeType() == "" {
		t.Fatalf("mime type must be set")
	}

	var totalBytes int
	for _, chunk := range collected {
		totalBytes += len(chunk)
	}
	if totalBytes != len(speechBytes) {
		t.Fatalf("total bytes mismatch: got=%d want=%d", totalBytes, len(speechBytes))
	}
}

func TestStreamSpeechSynthesisValidation(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

	mockStream := &mockArtifactChunkStream{ctx: context.Background()}

	err := svc.StreamSpeechSynthesis(&runtimev1.StreamSpeechSynthesisRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/tts",
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
	}, mockStream)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for missing spec, got=%v", status.Code(err))
	}
}

func TestStreamSpeechSynthesisLargePayloadChunking(t *testing.T) {
	largePayload := make([]byte, 100*1024) // 100KB
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

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: server.URL,
	})

	chunkCount := 0
	var lastChunk *runtimev1.ArtifactChunk
	var totalBytes int
	mockStream := &mockArtifactChunkStream{
		ctx: context.Background(),
		sendFn: func(chunk *runtimev1.ArtifactChunk) error {
			chunkCount++
			totalBytes += len(chunk.GetChunk())
			lastChunk = chunk
			return nil
		},
	}

	err := svc.StreamSpeechSynthesis(&runtimev1.StreamSpeechSynthesisRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/tts",
		SpeechSpec:    &runtimev1.SpeechSynthesisSpec{Text: "hello"},
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		TimeoutMs:     30_000,
	}, mockStream)
	if err != nil {
		t.Fatalf("stream: %v", err)
	}
	expectedChunks := (len(largePayload) + defaultSpeechStreamChunkSize - 1) / defaultSpeechStreamChunkSize
	if chunkCount != expectedChunks {
		t.Fatalf("chunk count mismatch: got=%d want=%d", chunkCount, expectedChunks)
	}
	if totalBytes != len(largePayload) {
		t.Fatalf("total bytes mismatch: got=%d want=%d", totalBytes, len(largePayload))
	}
	if lastChunk == nil || !lastChunk.GetEof() {
		t.Fatalf("last chunk must have eof=true")
	}
	if lastChunk.GetUsage() == nil {
		t.Fatalf("last chunk should carry usage stats")
	}
}

func TestGetSpeechVoicesVolcenginePresets(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudBytedanceBaseURL: "http://example.com",
		CloudBytedanceAPIKey:  "test-key",
	})

	resp, err := svc.GetSpeechVoices(context.Background(), &runtimev1.GetSpeechVoicesRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "bytedance/tts-model",
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	})
	if err != nil {
		t.Fatalf("getSpeechVoices: %v", err)
	}
	if len(resp.GetVoices()) != 2 {
		t.Fatalf("expected 2 Volcengine voices, got=%d", len(resp.GetVoices()))
	}
}

// mockArtifactChunkStream implements grpc.ServerStreamingServer[runtimev1.ArtifactChunk]
// for testing StreamSpeechSynthesis.
type mockArtifactChunkStream struct {
	ctx    context.Context
	sendFn func(*runtimev1.ArtifactChunk) error
}

func (m *mockArtifactChunkStream) Send(chunk *runtimev1.ArtifactChunk) error {
	if m.sendFn != nil {
		return m.sendFn(chunk)
	}
	return nil
}

func (m *mockArtifactChunkStream) Context() context.Context {
	return m.ctx
}

func (m *mockArtifactChunkStream) SendHeader(_ metadata.MD) error { return nil }
func (m *mockArtifactChunkStream) SetHeader(_ metadata.MD) error  { return nil }
func (m *mockArtifactChunkStream) SetTrailer(_ metadata.MD)       {}
func (m *mockArtifactChunkStream) RecvMsg(any) error              { return nil }
func (m *mockArtifactChunkStream) SendMsg(any) error              { return nil }

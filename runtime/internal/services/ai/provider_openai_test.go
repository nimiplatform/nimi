package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestOpenAIBackendImageAndSpeech(t *testing.T) {
	imageBytes := []byte("image-bytes")
	speechBytes := []byte("speech-bytes")
	imageB64 := base64.StdEncoding.EncodeToString(imageBytes)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/images/generations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_json": imageB64},
				},
			})
			return
		case "/v1/audio/speech":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(speechBytes)
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	backend := newOpenAIBackend("test", server.URL, "", 3*time.Second)
	if backend == nil {
		t.Fatalf("backend must not be nil")
	}

	gotImage, usage, err := backend.generateImage(context.Background(), "img-model", &runtimev1.ImageGenerationSpec{
		Prompt: "draw a cat",
	})
	if err != nil {
		t.Fatalf("generate image: %v", err)
	}
	if string(gotImage) != string(imageBytes) {
		t.Fatalf("image bytes mismatch")
	}
	if usage == nil || usage.GetComputeMs() == 0 {
		t.Fatalf("image usage must be set")
	}

	gotSpeech, speechUsage, err := backend.synthesizeSpeech(context.Background(), "tts-model", &runtimev1.SpeechSynthesisSpec{
		Text: "hello world",
	})
	if err != nil {
		t.Fatalf("synthesize speech: %v", err)
	}
	if string(gotSpeech) != string(speechBytes) {
		t.Fatalf("speech bytes mismatch")
	}
	if speechUsage == nil || speechUsage.GetComputeMs() == 0 {
		t.Fatalf("speech usage must be set")
	}
}

func TestOpenAIBackendVideoFallbackPath(t *testing.T) {
	videoBytes := []byte("video-bytes")
	videoB64 := base64.StdEncoding.EncodeToString(videoBytes)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/video/generations":
			http.NotFound(w, r)
			return
		case "/v1/videos/generations":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_mp4": videoB64},
				},
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	backend := newOpenAIBackend("test", server.URL, "", 3*time.Second)
	if backend == nil {
		t.Fatalf("backend must not be nil")
	}

	gotVideo, usage, err := backend.generateVideo(context.Background(), "vid-model", &runtimev1.VideoGenerationSpec{
		Prompt: "drive on mars",
	})
	if err != nil {
		t.Fatalf("generate video: %v", err)
	}
	if string(gotVideo) != string(videoBytes) {
		t.Fatalf("video bytes mismatch")
	}
	if usage == nil || usage.GetComputeMs() == 0 {
		t.Fatalf("video usage must be set")
	}
}

func TestOpenAIBackendVideoUnsupported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	backend := newOpenAIBackend("test", server.URL, "", 3*time.Second)
	if backend == nil {
		t.Fatalf("backend must not be nil")
	}

	_, _, err := backend.generateVideo(context.Background(), "vid-model", &runtimev1.VideoGenerationSpec{
		Prompt: "prompt",
	})
	if err == nil {
		t.Fatalf("expected error for unsupported video endpoint")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.FailedPrecondition || st.Message() != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String() {
		t.Fatalf("unexpected error: code=%v message=%s", st.Code(), st.Message())
	}
}

func TestDecodeMediaViaURL(t *testing.T) {
	artifactBytes := []byte("artifact")
	assetServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, string(artifactBytes))
	}))
	defer assetServer.Close()

	backend := newOpenAIBackend("test", "http://example.com", "", 3*time.Second)
	if backend == nil {
		t.Fatalf("backend must not be nil")
	}

	got, err := backend.decodeMedia("", assetServer.URL)
	if err != nil {
		t.Fatalf("decode media by url: %v", err)
	}
	if string(got) != string(artifactBytes) {
		t.Fatalf("artifact bytes mismatch")
	}
}

func TestOpenAIBackendStreamGenerateText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
		fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":\"world\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2}}\n\n")
		if flusher != nil {
			flusher.Flush()
		}
		fmt.Fprintf(w, "data: [DONE]\n\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer server.Close()

	backend := newOpenAIBackend("test", server.URL, "", 3*time.Second)
	if backend == nil {
		t.Fatalf("backend must not be nil")
	}

	deltas := make([]string, 0, 2)
	usage, finish, err := backend.streamGenerateText(context.Background(), "gpt-4o", []*runtimev1.ChatMessage{
		{Role: "user", Content: "say hello"},
	}, "", 0, 0, 0, func(chunk string) error {
		deltas = append(deltas, chunk)
		return nil
	})
	if err != nil {
		t.Fatalf("stream generate text: %v", err)
	}
	if len(deltas) != 2 {
		t.Fatalf("delta count mismatch: got=%d want=2", len(deltas))
	}
	if deltas[0] != "Hello " || deltas[1] != "world" {
		t.Fatalf("delta content mismatch: %#v", deltas)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("finish reason mismatch: %v", finish)
	}
	if usage == nil || usage.GetInputTokens() != 5 || usage.GetOutputTokens() != 2 {
		t.Fatalf("usage mismatch: %#v", usage)
	}
}

func TestOpenAIBackendStreamGenerateFallsBackWhenUnsupported(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		stream, _ := payload["stream"].(bool)
		if stream {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error": map[string]any{
					"message": "stream not supported by upstream adapter",
				},
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"finish_reason": "stop",
					"message": map[string]any{
						"content": "fallback text",
					},
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     9,
				"completion_tokens": 3,
			},
		})
	}))
	defer server.Close()

	backend := newOpenAIBackend("test", server.URL, "", 3*time.Second)
	if backend == nil {
		t.Fatalf("backend must not be nil")
	}

	deltas := make([]string, 0, 2)
	usage, finish, err := backend.streamGenerateText(context.Background(), "gpt-4o", []*runtimev1.ChatMessage{
		{Role: "user", Content: "hello"},
	}, "", 0, 0, 0, func(chunk string) error {
		deltas = append(deltas, chunk)
		return nil
	})
	if err != nil {
		t.Fatalf("stream generate fallback: %v", err)
	}
	if strings.TrimSpace(strings.Join(deltas, "")) != "fallback text" {
		t.Fatalf("fallback delta mismatch: %#v", deltas)
	}
	if finish != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("finish reason mismatch: %v", finish)
	}
	if usage == nil || usage.GetInputTokens() != 9 || usage.GetOutputTokens() != 3 {
		t.Fatalf("usage mismatch: %#v", usage)
	}
}

func TestMapProviderHTTPErrorContentFilter(t *testing.T) {
	err := mapProviderHTTPError(http.StatusBadRequest, map[string]any{
		"error": map[string]any{
			"message": "request blocked by content policy",
		},
	})
	if err == nil {
		t.Fatalf("expected mapped error")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.PermissionDenied {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED.String() {
		t.Fatalf("unexpected reason: %s", st.Message())
	}
}

func TestMapProviderHTTPErrorBadRequest(t *testing.T) {
	err := mapProviderHTTPError(http.StatusBadRequest, map[string]any{
		"error": map[string]any{
			"message": "invalid request body",
		},
	})
	if err == nil {
		t.Fatalf("expected mapped error")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_INPUT_INVALID.String() {
		t.Fatalf("unexpected reason: %s", st.Message())
	}
}

func TestOpenAIBackendStreamGenerateBrokenChunk(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	defer server.Close()

	backend := newOpenAIBackend("test", server.URL, "", 3*time.Second)
	if backend == nil {
		t.Fatalf("backend must not be nil")
	}

	_, _, err := backend.streamGenerateText(context.Background(), "gpt-4o", []*runtimev1.ChatMessage{
		{Role: "user", Content: "hello"},
	}, "", 0, 0, 0, nil)
	if err == nil {
		t.Fatalf("expected stream broken error")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.Internal {
		t.Fatalf("unexpected code: %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_STREAM_BROKEN.String() {
		t.Fatalf("unexpected reason: %s", st.Message())
	}
}

package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalProviderNexaModalitiesAndFailCloseVideo(t *testing.T) {
	imageBytes := []byte("nexa-image-bytes")
	imageBase64 := base64.StdEncoding.EncodeToString(imageBytes)
	audioBytes := []byte("nexa-audio-bytes")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/chat/completions":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{
						"finish_reason": "stop",
						"message": map[string]any{
							"content": "nexa text",
						},
					},
				},
				"usage": map[string]any{
					"prompt_tokens":     6,
					"completion_tokens": 3,
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/embeddings":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"embedding": []float64{0.11, 0.22}},
				},
				"usage": map[string]any{
					"prompt_tokens": 3,
					"total_tokens":  5,
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": []map[string]any{
					{"b64_json": imageBase64},
				},
			})
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/speech":
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write(audioBytes)
			return
		case r.Method == http.MethodPost && r.URL.Path == "/v1/audio/transcriptions":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "nexa stt text",
			})
			return
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	p := &localProvider{
		nexa: nimillm.NewBackend("nexa", server.URL, "", 3*time.Second),
	}

	text, _, finishReason, err := p.GenerateText(context.Background(), "nexa/qwen", &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, "hello")
	if err != nil {
		t.Fatalf("nexa generate text: %v", err)
	}
	if text != "nexa text" || finishReason != runtimev1.FinishReason_FINISH_REASON_STOP {
		t.Fatalf("nexa text mismatch: text=%s finish=%v", text, finishReason)
	}

	vectors, _, err := p.Embed(context.Background(), "nexa/embed", []string{"embed me"})
	if err != nil {
		t.Fatalf("nexa embed: %v", err)
	}
	if len(vectors) != 1 || len(vectors[0].GetValues()) != 2 {
		t.Fatalf("nexa embed mismatch")
	}

	imagePayload, _, err := p.GenerateImage(context.Background(), "nexa/image", &runtimev1.ImageGenerationSpec{
		Prompt: "draw mountain",
	})
	if err != nil {
		t.Fatalf("nexa generateImage: %v", err)
	}
	if string(imagePayload) != string(imageBytes) {
		t.Fatalf("nexa image payload mismatch")
	}

	speechPayload, _, err := p.SynthesizeSpeech(context.Background(), "nexa/tts", &runtimev1.SpeechSynthesisSpec{
		Text: "hello",
	})
	if err != nil {
		t.Fatalf("nexa synthesizeSpeech: %v", err)
	}
	if string(speechPayload) != string(audioBytes) {
		t.Fatalf("nexa speech payload mismatch")
	}

	transcribedText, _, err := p.Transcribe(context.Background(), "nexa/stt", &runtimev1.SpeechTranscriptionSpec{
		MimeType: "audio/wav",
	}, []byte("audio"), "audio/wav")
	if err != nil {
		t.Fatalf("nexa transcribe: %v", err)
	}
	if transcribedText != "nexa stt text" {
		t.Fatalf("nexa transcribe mismatch: %s", transcribedText)
	}

	_, _, err = p.GenerateVideo(context.Background(), "nexa/video", &runtimev1.VideoGenerationSpec{
		Prompt: "unsupported",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("nexa video should fail-close with failed-precondition, got=%v", status.Code(err))
	}
}

func TestLocalProviderFailCloseWithoutBackend(t *testing.T) {
	p := &localProvider{}

	if _, _, _, err := p.GenerateText(context.Background(), "local/qwen2.5", &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, "hello"); status.Code(err) != codes.Unavailable {
		t.Fatalf("generateText should fail-close: %v", status.Code(err))
	}

	_, finishReason, err := p.StreamGenerateText(context.Background(), "local/qwen2.5", &runtimev1.StreamGenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, nil)
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("streamGenerateText should fail-close: %v", status.Code(err))
	}
	if finishReason != runtimev1.FinishReason_FINISH_REASON_ERROR {
		t.Fatalf("stream finish reason mismatch: %v", finishReason)
	}
}

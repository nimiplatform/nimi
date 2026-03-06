package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestExecuteGeminiTranscribeUsesChatCompletions(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/chat/completions" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"content": "hello from gemini",
					},
				},
			},
		})
	}))
	defer server.Close()

	artifacts, _, _, err := ExecuteGeminiTranscribe(
		context.Background(),
		MediaAdapterConfig{
			BaseURL: server.URL,
			APIKey:  "gemini-key",
		},
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
					SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
						Language: "en",
						Prompt:   "Interview audio",
						AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
							Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
								AudioBytes: []byte("RIFF...."),
							},
						},
						MimeType: "audio/wav",
					},
				},
			},
		},
		"gemini-2.5-flash",
	)
	if err != nil {
		t.Fatalf("ExecuteGeminiTranscribe failed: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got=%d", len(artifacts))
	}
	if got := string(artifacts[0].GetBytes()); got != "hello from gemini" {
		t.Fatalf("unexpected artifact text: %q", got)
	}
	if got := strings.TrimSpace(ValueAsString(captured["model"])); got != "gemini-2.5-flash" {
		t.Fatalf("unexpected model=%q", got)
	}
	messages, ok := captured["messages"].([]any)
	if !ok || len(messages) != 1 {
		t.Fatalf("expected single user message, got=%T len=%d", captured["messages"], len(messages))
	}
	message, ok := messages[0].(map[string]any)
	if !ok {
		t.Fatalf("expected message map, got=%T", messages[0])
	}
	content, ok := message["content"].([]any)
	if !ok || len(content) != 2 {
		t.Fatalf("expected multimodal content, got=%T len=%d", message["content"], len(content))
	}
	audioItem, ok := content[1].(map[string]any)
	if !ok {
		t.Fatalf("expected audio content item, got=%T", content[1])
	}
	inputAudio, ok := audioItem["input_audio"].(map[string]any)
	if !ok {
		t.Fatalf("expected input_audio payload, got=%T", audioItem["input_audio"])
	}
	if got := strings.TrimSpace(ValueAsString(inputAudio["format"])); got != "wav" {
		t.Fatalf("expected wav format, got=%q", got)
	}
	if strings.TrimSpace(ValueAsString(inputAudio["data"])) == "" {
		t.Fatal("expected base64 audio payload")
	}
}

func TestExecuteGeminiTranscribeRejectsUnsupportedAdvancedOptions(t *testing.T) {
	_, _, _, err := ExecuteGeminiTranscribe(
		context.Background(),
		MediaAdapterConfig{BaseURL: "https://gemini.example"},
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
					SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
						Timestamps: true,
						AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
							Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
								AudioBytes: []byte("audio"),
							},
						},
					},
				},
			},
		},
		"gemini-2.5-flash",
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got err=%v reason=%v ok=%v", err, reason, ok)
	}
}

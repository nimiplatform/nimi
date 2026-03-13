package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type noopGeminiJobUpdater struct{}

func (noopGeminiJobUpdater) UpdatePollState(_ string, _ string, _ int32, _ *timestamppb.Timestamp, _ string) {
}

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

func TestExecuteGeminiImageGenerateContentUsesNativeEndpoint(t *testing.T) {
	imageBytes := []byte("gemini-image")
	referenceBytes := []byte("reference-image")
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/models/gemini-3.1-flash-image-preview:generateContent" {
			http.NotFound(w, r)
			return
		}
		if got := strings.TrimSpace(r.Header.Get("x-goog-api-key")); got != "gemini-key" {
			t.Fatalf("unexpected x-goog-api-key header=%q", got)
		}
		if got := strings.TrimSpace(r.Header.Get("Authorization")); got != "" {
			t.Fatalf("expected no Authorization header, got=%q", got)
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"candidates": []map[string]any{
				{
					"content": map[string]any{
						"parts": []map[string]any{
							{
								"text": "Here you go!",
							},
							{
								"inline_data": map[string]any{
									"mime_type": "image/png",
									"data":      base64.StdEncoding.EncodeToString(imageBytes),
								},
							},
						},
					},
				},
			},
		})
	}))
	defer server.Close()

	artifacts, usage, providerJobID, err := ExecuteGeminiOperation(
		context.Background(),
		MediaAdapterConfig{
			BaseURL: server.URL + "/v1beta/openai",
			APIKey:  "gemini-key",
		},
		noopGeminiJobUpdater{},
		"job-gemini-image",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_ImageGenerate{
					ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
						Prompt:          "A moon over the ocean.",
						Size:            "1024x1024",
						ReferenceImages: []string{"data:image/png;base64," + base64.StdEncoding.EncodeToString(referenceBytes)},
					},
				},
			},
		},
		"gemini-3.1-flash-image-preview",
		func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct { return nil },
	)
	if err != nil {
		t.Fatalf("ExecuteGeminiOperation image failed: %v", err)
	}
	if providerJobID != "" {
		t.Fatalf("expected sync image path to return empty provider job id, got=%q", providerJobID)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got=%d", len(artifacts))
	}
	if got := string(artifacts[0].GetBytes()); got != string(imageBytes) {
		t.Fatalf("unexpected artifact bytes=%q", got)
	}
	if got := strings.TrimSpace(artifacts[0].GetMimeType()); got != "image/png" {
		t.Fatalf("unexpected artifact mime=%q", got)
	}
	if usage == nil || usage.GetInputTokens() <= 0 {
		t.Fatalf("expected usage stats, got=%v", usage)
	}

	contents, ok := captured["contents"].([]any)
	if !ok || len(contents) != 1 {
		t.Fatalf("expected single content entry, got=%T len=%d", captured["contents"], len(contents))
	}
	content, ok := contents[0].(map[string]any)
	if !ok {
		t.Fatalf("expected content map, got=%T", contents[0])
	}
	parts, ok := content["parts"].([]any)
	if !ok || len(parts) != 2 {
		t.Fatalf("expected prompt + reference image parts, got=%T len=%d", content["parts"], len(parts))
	}
	part, ok := parts[0].(map[string]any)
	if !ok {
		t.Fatalf("expected prompt part map, got=%T", parts[0])
	}
	if got := strings.TrimSpace(ValueAsString(part["text"])); got != "A moon over the ocean." {
		t.Fatalf("unexpected prompt=%q", got)
	}
	imagePart, ok := parts[1].(map[string]any)
	if !ok {
		t.Fatalf("expected image part map, got=%T", parts[1])
	}
	inlineData, ok := imagePart["inline_data"].(map[string]any)
	if !ok {
		t.Fatalf("expected inline_data payload, got=%T", imagePart["inline_data"])
	}
	if got := strings.TrimSpace(ValueAsString(inlineData["mime_type"])); got != "image/png" {
		t.Fatalf("unexpected inline_data mime_type=%q", got)
	}
	if got := strings.TrimSpace(ValueAsString(inlineData["data"])); got != base64.StdEncoding.EncodeToString(referenceBytes) {
		t.Fatalf("unexpected inline_data data=%q", got)
	}

	generationConfig, ok := captured["generationConfig"].(map[string]any)
	if !ok {
		t.Fatalf("expected generationConfig, got=%T", captured["generationConfig"])
	}
	modalities, ok := generationConfig["responseModalities"].([]any)
	if !ok || len(modalities) != 1 || strings.TrimSpace(ValueAsString(modalities[0])) != "IMAGE" {
		t.Fatalf("unexpected responseModalities=%v", generationConfig["responseModalities"])
	}
	imageConfig, ok := generationConfig["imageConfig"].(map[string]any)
	if !ok {
		t.Fatalf("expected imageConfig, got=%T", generationConfig["imageConfig"])
	}
	if got := strings.TrimSpace(ValueAsString(imageConfig["aspectRatio"])); got != "1:1" {
		t.Fatalf("unexpected aspect ratio=%q", got)
	}
}

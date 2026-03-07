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

func TestNativeOriginURL(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "strip compatible-mode path",
			input: "https://dashscope.aliyuncs.com/compatible-mode/v1",
			want:  "https://dashscope.aliyuncs.com",
		},
		{
			name:  "already origin only",
			input: "https://dashscope.aliyuncs.com",
			want:  "https://dashscope.aliyuncs.com",
		},
		{
			name:  "custom host with port and path",
			input: "https://custom.host:8080/some/path",
			want:  "https://custom.host:8080",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := nativeOriginURL(tc.input)
			if got != tc.want {
				t.Fatalf("nativeOriginURL(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestExecuteAlibabaNativeTTSPreservesRequestedVoice(t *testing.T) {
	var capturedVoice string
	var capturedInstructions string
	var capturedOptimizeInstructions bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/aigc/multimodal-generation/generation" {
			http.NotFound(w, r)
			return
		}
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		input, _ := payload["input"].(map[string]any)
		capturedVoice = strings.TrimSpace(toString(input["voice"]))
		parameters, _ := payload["parameters"].(map[string]any)
		capturedInstructions = strings.TrimSpace(toString(parameters["instructions"]))
		capturedOptimizeInstructions = ValueAsBool(parameters["optimize_instructions"])
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("dashscope-tts-bytes"))
	}))
	defer server.Close()

	artifacts, _, _, err := ExecuteAlibabaNative(
		context.Background(),
		MediaAdapterConfig{
			BaseURL: server.URL,
			APIKey:  "test-api-key",
		},
		nil,
		"job-test",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			Extensions: []*runtimev1.ScenarioExtension{
				{
					Namespace: "nimi.scenario.speech_synthesize.request",
					Payload: mustStructPBForNimillmTest(t, map[string]any{
						"instruct":              "Speak as a calm fantasy storyteller.",
						"optimize_instructions": true,
					}),
				},
			},
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
					SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
						Text: "hello",
						VoiceRef: &runtimev1.VoiceReference{
							Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
							Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
								ProviderVoiceRef: "alloy",
							},
						},
					},
				},
			},
		},
		"qwen3-tts-instruct-flash-2026-01-26",
	)
	if err != nil {
		t.Fatalf("ExecuteAlibabaNative tts failed: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got=%d", len(artifacts))
	}
	if capturedVoice != "alloy" {
		t.Fatalf("expected requested voice alloy, got=%q", capturedVoice)
	}
	if capturedInstructions != "Speak as a calm fantasy storyteller." {
		t.Fatalf("expected instruct extension to map to parameters.instructions, got=%q", capturedInstructions)
	}
	if !capturedOptimizeInstructions {
		t.Fatal("expected optimize_instructions extension to map to parameters.optimize_instructions")
	}
}

func TestExecuteDashScopeTranscribeUsesCompatibleChatPath(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/compatible-mode/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		captured = decodeJSONBodyForBackendMediaTest(t, r)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]any{
						"content": "dashscope transcript",
					},
				},
			},
		})
	}))
	defer server.Close()

	artifacts, _, _, err := ExecuteDashScopeTranscribe(
		context.Background(),
		MediaAdapterConfig{
			BaseURL: server.URL + "/compatible-mode/v1",
			APIKey:  "test-api-key",
		},
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
					SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
						Language: "en",
						Prompt:   "Domain terms: Nimi Realm",
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
		"qwen3-asr-flash",
	)
	if err != nil {
		t.Fatalf("ExecuteDashScopeTranscribe failed: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got=%d", len(artifacts))
	}
	if got := string(artifacts[0].GetBytes()); got != "dashscope transcript" {
		t.Fatalf("unexpected artifact text: %q", got)
	}
	messages, ok := captured["messages"].([]any)
	if !ok || len(messages) != 2 {
		t.Fatalf("expected system+user messages, got=%T len=%d", captured["messages"], len(messages))
	}
	userMessage, ok := messages[1].(map[string]any)
	if !ok {
		t.Fatalf("expected user message map, got=%T", messages[1])
	}
	content, ok := userMessage["content"].([]any)
	if !ok || len(content) != 1 {
		t.Fatalf("expected audio-only content, got=%T len=%d", userMessage["content"], len(content))
	}
	audioItem, ok := content[0].(map[string]any)
	if !ok {
		t.Fatalf("expected audio item map, got=%T", content[0])
	}
	inputAudio, ok := audioItem["input_audio"].(map[string]any)
	if !ok {
		t.Fatalf("expected input_audio payload, got=%T", audioItem["input_audio"])
	}
	if got := strings.TrimSpace(ValueAsString(inputAudio["format"])); got != "wav" {
		t.Fatalf("expected wav format, got=%q", got)
	}
	if got := strings.TrimSpace(ValueAsString(inputAudio["data"])); !strings.HasPrefix(got, "data:audio/wav;base64,") {
		t.Fatalf("expected inline audio data url, got=%q", got)
	}
	extraBody, ok := captured["extra_body"].(map[string]any)
	if !ok {
		t.Fatalf("expected extra_body payload, got=%T", captured["extra_body"])
	}
	asrOptions, ok := extraBody["asr_options"].(map[string]any)
	if !ok {
		t.Fatalf("expected asr_options payload, got=%T", extraBody["asr_options"])
	}
	if got := strings.TrimSpace(ValueAsString(asrOptions["language"])); got != "en" {
		t.Fatalf("expected language hint, got=%q", got)
	}
}

func TestExecuteDashScopeTranscribeRejectsUnsupportedAdvancedOptions(t *testing.T) {
	_, _, _, err := ExecuteDashScopeTranscribe(
		context.Background(),
		MediaAdapterConfig{BaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"},
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
					SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
						Diarization: true,
						AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
							Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
								AudioBytes: []byte("audio"),
							},
						},
					},
				},
			},
		},
		"qwen3-asr-flash",
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got err=%v reason=%v ok=%v", err, reason, ok)
	}
}

func TestExecuteAlibabaNativeImageWan26UsesAsyncImageGenerationContract(t *testing.T) {
	var capturedPayload map[string]any
	var capturedAsyncHeader string
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/services/aigc/image-generation/generation":
			capturedAsyncHeader = strings.TrimSpace(r.Header.Get("X-DashScope-Async"))
			_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"output": map[string]any{
					"task_id":     "wan-image-task-1",
					"task_status": "PENDING",
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/tasks/wan-image-task-1":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"output": map[string]any{
					"task_id":     "wan-image-task-1",
					"task_status": "SUCCEEDED",
					"choices": []map[string]any{
						{
							"message": map[string]any{
								"content": []map[string]any{
									{"type": "image", "image": server.URL + "/artifact.png"},
								},
							},
						},
					},
				},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/artifact.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("wan-image-bytes"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	artifacts, _, providerJobID, err := ExecuteAlibabaNative(
		context.Background(),
		MediaAdapterConfig{
			BaseURL: server.URL + "/compatible-mode/v1",
			APIKey:  "test-api-key",
		},
		noopGeminiJobUpdater{},
		"job-image-test",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_ImageGenerate{
					ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
						Prompt: "A tiny cinematic island floating above a calm sea.",
					},
				},
			},
		},
		"wan2.6-t2i",
	)
	if err != nil {
		t.Fatalf("ExecuteAlibabaNative image failed: %v", err)
	}
	if providerJobID != "wan-image-task-1" {
		t.Fatalf("unexpected providerJobID: %q", providerJobID)
	}
	if capturedAsyncHeader != "enable" {
		t.Fatalf("expected X-DashScope-Async enable, got=%q", capturedAsyncHeader)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "wan2.6-t2i" {
		t.Fatalf("expected wan2.6-t2i model, got=%q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input payload, got=%T", capturedPayload["input"])
	}
	messages, ok := input["messages"].([]any)
	if !ok || len(messages) != 1 {
		t.Fatalf("expected one input message, got=%T len=%d", input["messages"], len(messages))
	}
	message, ok := messages[0].(map[string]any)
	if !ok {
		t.Fatalf("expected message map, got=%T", messages[0])
	}
	content, ok := message["content"].([]any)
	if !ok || len(content) == 0 {
		t.Fatalf("expected non-empty content, got=%T len=%d", message["content"], len(content))
	}
	firstContent, ok := content[0].(map[string]any)
	if !ok {
		t.Fatalf("expected first content map, got=%T", content[0])
	}
	if got := strings.TrimSpace(toString(firstContent["text"])); got != "A tiny cinematic island floating above a calm sea." {
		t.Fatalf("unexpected prompt text: %q", got)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected one image artifact, got=%d", len(artifacts))
	}
	if got := string(artifacts[0].GetBytes()); got != "wan-image-bytes" {
		t.Fatalf("unexpected image bytes: %q", got)
	}
}

func TestExecuteDashScopeVoiceWorkflowUsesCustomizationContractForClone(t *testing.T) {
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/audio/tts/customization" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"output": map[string]any{
				"voice": "dashscope-clone-voice",
			},
		})
	}))
	defer server.Close()

	result, err := executeDashScopeVoiceWorkflow(context.Background(), VoiceWorkflowRequest{
		Provider:        "dashscope",
		WorkflowType:    "tts_v2v",
		WorkflowModelID: "qwen-voice-enrollment",
		ModelID:         "qwen3-tts-vc-2026-01-22",
		Payload: map[string]any{
			"target_model_id":     "qwen3-tts-vc-2026-01-22",
			"reference_audio_uri": "https://example.com/reference.wav",
			"preferred_name":      "nimi-clone-voice",
		},
	}, MediaAdapterConfig{
		BaseURL: server.URL + "/compatible-mode/v1",
		APIKey:  "test-api-key",
	})
	if err != nil {
		t.Fatalf("executeDashScopeVoiceWorkflow clone failed: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "dashscope-clone-voice" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "qwen-voice-enrollment" {
		t.Fatalf("unexpected workflow model: %q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input map, got=%T", capturedPayload["input"])
	}
	if got := strings.TrimSpace(toString(input["action"])); got != "create" {
		t.Fatalf("unexpected action: %q", got)
	}
	if got := strings.TrimSpace(toString(input["target_model"])); got != "qwen3-tts-vc-2026-01-22" {
		t.Fatalf("unexpected target model: %q", got)
	}
	audio, ok := input["audio"].(map[string]any)
	if !ok {
		t.Fatalf("expected audio map, got=%T", input["audio"])
	}
	if got := strings.TrimSpace(toString(audio["data"])); got != "https://example.com/reference.wav" {
		t.Fatalf("unexpected reference audio data: %q", got)
	}
	if got := strings.TrimSpace(toString(input["prefix"])); got != "nimi_clone_voice" {
		t.Fatalf("unexpected prefix: %q", got)
	}
	if got := strings.TrimSpace(toString(input["preferred_name"])); got != "nimi_clone_voice" {
		t.Fatalf("unexpected preferred_name: %q", got)
	}
}

func TestExecuteDashScopeVoiceWorkflowUsesCustomizationContractForDesign(t *testing.T) {
	var capturedPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/audio/tts/customization" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&capturedPayload)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"output": map[string]any{
				"voice": "dashscope-design-voice",
			},
		})
	}))
	defer server.Close()

	result, err := executeDashScopeVoiceWorkflow(context.Background(), VoiceWorkflowRequest{
		Provider:        "dashscope",
		WorkflowType:    "tts_t2v",
		WorkflowModelID: "qwen-voice-design",
		ModelID:         "qwen3-tts-vd-2026-01-26",
		Payload: map[string]any{
			"target_model_id":  "qwen3-tts-vd-2026-01-26",
			"instruction_text": "Warm, calm and natural documentary narrator voice.",
			"preview_text":     "Hello from Nimi voice design gold path.",
			"language":         "en",
			"preferred_name":   "nimi_voice",
		},
	}, MediaAdapterConfig{
		BaseURL: server.URL + "/compatible-mode/v1",
		APIKey:  "test-api-key",
	})
	if err != nil {
		t.Fatalf("executeDashScopeVoiceWorkflow design failed: %v", err)
	}
	if got := strings.TrimSpace(result.ProviderVoiceRef); got != "dashscope-design-voice" {
		t.Fatalf("unexpected provider voice ref: %q", got)
	}
	if got := strings.TrimSpace(toString(capturedPayload["model"])); got != "qwen-voice-design" {
		t.Fatalf("unexpected workflow model: %q", got)
	}
	input, ok := capturedPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input map, got=%T", capturedPayload["input"])
	}
	if got := strings.TrimSpace(toString(input["action"])); got != "create" {
		t.Fatalf("unexpected action: %q", got)
	}
	if got := strings.TrimSpace(toString(input["target_model"])); got != "qwen3-tts-vd-2026-01-26" {
		t.Fatalf("unexpected target model: %q", got)
	}
	if got := strings.TrimSpace(toString(input["voice_prompt"])); got != "Warm, calm and natural documentary narrator voice." {
		t.Fatalf("unexpected voice prompt: %q", got)
	}
	if got := strings.TrimSpace(toString(input["preview_text"])); got != "Hello from Nimi voice design gold path." {
		t.Fatalf("unexpected preview text: %q", got)
	}
	if got := strings.TrimSpace(toString(input["preferred_name"])); got != "nimi_voice" {
		t.Fatalf("unexpected preferred_name: %q", got)
	}
}

func TestNormalizeDashScopePreferredName(t *testing.T) {
	if got := normalizeDashScopePreferredName("nimi-voice-01ABCD"); got != "nimi_voice_01abcd" {
		t.Fatalf("unexpected normalized name: %q", got)
	}
	if got := normalizeDashScopePreferredName(""); got != "nimi_voice" {
		t.Fatalf("unexpected empty fallback name: %q", got)
	}
}

func toString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

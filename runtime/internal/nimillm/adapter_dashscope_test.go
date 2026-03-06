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
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/services/aigc/multimodal-generation/generation" {
			http.NotFound(w, r)
			return
		}
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		input, _ := payload["input"].(map[string]any)
		capturedVoice = strings.TrimSpace(toString(input["voice"]))
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

func toString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

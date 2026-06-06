package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestMimoGenerateTextUsesMaxCompletionTokens(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer mimo-key" {
			t.Fatalf("unexpected authorization header: %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{"finish_reason":"stop","message":{"content":"mimo text ok"}}],
			"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}
		}`))
	}))
	defer server.Close()

	backend := NewBackend("cloud-mimo", server.URL+"/v1", "mimo-key", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}
	text, usage, _, err := backend.GenerateText(
		context.Background(),
		"mimo-v2.5-pro",
		[]*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
		"",
		0,
		0,
		64,
	)
	if err != nil {
		t.Fatalf("GenerateText failed: %v", err)
	}
	if text != "mimo text ok" {
		t.Fatalf("unexpected text: %q", text)
	}
	if usage == nil || usage.GetInputTokens() != 3 || usage.GetOutputTokens() != 4 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if got := ValueAsInt64(captured["max_completion_tokens"]); got != 64 {
		t.Fatalf("expected max_completion_tokens=64, got=%v", captured["max_completion_tokens"])
	}
	if _, ok := captured["max_tokens"]; ok {
		t.Fatalf("mimo request must not send max_tokens: %#v", captured)
	}
}

func TestMimoTranscribeUsesChatInputAudio(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices":[{"finish_reason":"stop","message":{"content":"hello transcript"}}],
			"usage":{"prompt_tokens":8,"completion_tokens":2,"total_tokens":10}
		}`))
	}))
	defer server.Close()

	backend := NewBackend("cloud-mimo", server.URL, "mimo-key", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}
	text, usage, err := backend.Transcribe(
		context.Background(),
		"mimo-v2.5-asr",
		&runtimev1.SpeechTranscribeScenarioSpec{Language: "zh"},
		[]byte("RIFF....WAVEfmt "),
		"audio/wav",
		nil,
	)
	if err != nil {
		t.Fatalf("Transcribe failed: %v", err)
	}
	if text != "hello transcript" {
		t.Fatalf("unexpected transcript: %q", text)
	}
	if usage == nil || usage.GetInputTokens() != 8 || usage.GetOutputTokens() != 2 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	if got := strings.TrimSpace(ValueAsString(captured["model"])); got != "mimo-v2.5-asr" {
		t.Fatalf("model mismatch: %q", got)
	}
	asrOptions, _ := captured["asr_options"].(map[string]any)
	if got := strings.TrimSpace(ValueAsString(asrOptions["language"])); got != "zh" {
		t.Fatalf("language mismatch: %q", got)
	}
	messages, _ := captured["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("expected one message, got %#v", captured["messages"])
	}
	message, _ := messages[0].(map[string]any)
	content, _ := message["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("expected one content part, got %#v", message["content"])
	}
	part, _ := content[0].(map[string]any)
	if got := ValueAsString(part["type"]); got != "input_audio" {
		t.Fatalf("content type mismatch: %q", got)
	}
	inputAudio, _ := part["input_audio"].(map[string]any)
	dataURI := ValueAsString(inputAudio["data"])
	if !strings.HasPrefix(dataURI, "data:audio/wav;base64,") {
		t.Fatalf("input audio must be data URI, got %q", dataURI)
	}
}

func TestMimoSynthesizeUsesChatAudioAndDecodesMessageAudio(t *testing.T) {
	audioBytes := []byte("RIFF....WAVEfmt mimo")
	audioB64 := base64.StdEncoding.EncodeToString(audioBytes)
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"finish_reason": "stop",
					"message": map[string]any{
						"role": "assistant",
						"audio": map[string]any{
							"data": audioB64,
						},
					},
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     5,
				"completion_tokens": 6,
				"total_tokens":      11,
			},
		})
	}))
	defer server.Close()

	backend := NewBackend("cloud-mimo", server.URL+"/v1", "mimo-key", 5*time.Second)
	if backend == nil {
		t.Fatal("expected backend")
	}
	payload, usage, err := backend.SynthesizeSpeech(
		context.Background(),
		"mimo-v2.5-tts",
		&runtimev1.SpeechSynthesizeScenarioSpec{
			Text:        "Hello from Nimi.",
			AudioFormat: "wav",
			VoiceRef: &runtimev1.VoiceReference{
				Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
				Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
					ProviderVoiceRef: "Chloe",
				},
			},
		},
		nil,
	)
	if err != nil {
		t.Fatalf("SynthesizeSpeech failed: %v", err)
	}
	if string(payload) != string(audioBytes) {
		t.Fatalf("decoded audio mismatch: got %q want %q", string(payload), string(audioBytes))
	}
	if usage == nil || usage.GetInputTokens() != 5 || usage.GetOutputTokens() != 6 {
		t.Fatalf("unexpected usage: %+v", usage)
	}
	audio, _ := captured["audio"].(map[string]any)
	if got := ValueAsString(audio["format"]); got != "wav" {
		t.Fatalf("audio format mismatch: %q", got)
	}
	if got := ValueAsString(audio["voice"]); got != "Chloe" {
		t.Fatalf("voice mismatch: %q", got)
	}
	messages, _ := captured["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("expected style and synthesis messages, got %#v", captured["messages"])
	}
	assistant, _ := messages[1].(map[string]any)
	if got := ValueAsString(assistant["role"]); got != "assistant" {
		t.Fatalf("second message role mismatch: %q", got)
	}
	if got := ValueAsString(assistant["content"]); got != "Hello from Nimi." {
		t.Fatalf("synthesis text mismatch: %q", got)
	}
}

func TestMimoVoiceCloneWorkflowProducesSessionProviderRef(t *testing.T) {
	referenceBytes := []byte("RIFF....WAVEfmt reference")
	result, err := executeMimoVoiceWorkflow(context.Background(), VoiceWorkflowRequest{
		Provider:        "mimo",
		WorkflowType:    "voice_clone",
		WorkflowModelID: "mimo-v2.5-tts-voiceclone",
		Payload: map[string]any{
			"reference_audio_base64": base64.StdEncoding.EncodeToString(referenceBytes),
			"reference_audio_mime":   "audio/wav",
		},
	}, MediaAdapterConfig{})
	if err != nil {
		t.Fatalf("executeMimoVoiceWorkflow voice_clone failed: %v", err)
	}
	workflow, payload, ok := decodeMimoProviderVoiceRef(result.ProviderVoiceRef)
	if !ok {
		t.Fatalf("provider voice ref must be decodable, got %q", result.ProviderVoiceRef)
	}
	if workflow != "voice_clone" {
		t.Fatalf("workflow=%q, want voice_clone", workflow)
	}
	if !strings.HasPrefix(payload, "data:audio/wav;base64,") {
		t.Fatalf("clone payload must be audio data URI, got %q", payload)
	}
	if got := strings.TrimSpace(ValueAsString(result.Metadata["persistence"])); got != "session_ephemeral" {
		t.Fatalf("persistence=%q, want session_ephemeral", got)
	}
}

func TestMimoSynthesizeVoiceCloneUsesReferenceAudioDataURI(t *testing.T) {
	audioBytes := []byte("RIFF....WAVEfmt clone output")
	audioB64 := base64.StdEncoding.EncodeToString(audioBytes)
	referenceDataURI := "data:audio/wav;base64," + base64.StdEncoding.EncodeToString([]byte("RIFF....WAVEfmt reference"))
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{
				"message": map[string]any{
					"audio": map[string]any{"data": audioB64},
				},
			}},
		})
	}))
	defer server.Close()

	backend := NewBackend("cloud-mimo", server.URL+"/v1", "mimo-key", 5*time.Second)
	payload, _, err := backend.SynthesizeSpeech(
		context.Background(),
		"mimo-v2.5-tts-voiceclone",
		&runtimev1.SpeechSynthesizeScenarioSpec{
			Text: "Hello from cloned MiMo voice.",
			VoiceRef: &runtimev1.VoiceReference{
				Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
				Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
					ProviderVoiceRef: encodeMimoProviderVoiceRef("voice_clone", referenceDataURI),
				},
			},
		},
		nil,
	)
	if err != nil {
		t.Fatalf("SynthesizeSpeech voice clone failed: %v", err)
	}
	if string(payload) != string(audioBytes) {
		t.Fatalf("decoded audio mismatch: got %q want %q", string(payload), string(audioBytes))
	}
	audio, _ := captured["audio"].(map[string]any)
	if got := ValueAsString(audio["voice"]); got != referenceDataURI {
		t.Fatalf("voice clone must pass reference audio data URI, got %q", got)
	}
	messages, _ := captured["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("expected two messages, got %#v", captured["messages"])
	}
	assistant, _ := messages[1].(map[string]any)
	if got := ValueAsString(assistant["content"]); got != "Hello from cloned MiMo voice." {
		t.Fatalf("synthesis text mismatch: %q", got)
	}
}

func TestMimoSynthesizeVoiceDesignUsesPromptWithoutPresetVoice(t *testing.T) {
	audioBytes := []byte("RIFF....WAVEfmt design output")
	audioB64 := base64.StdEncoding.EncodeToString(audioBytes)
	designPrompt := "Warm calm studio narrator with clear diction."
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{{
				"message": map[string]any{
					"audio": map[string]any{"data": audioB64},
				},
			}},
		})
	}))
	defer server.Close()

	backend := NewBackend("cloud-mimo", server.URL+"/v1", "mimo-key", 5*time.Second)
	payload, _, err := backend.SynthesizeSpeech(
		context.Background(),
		"mimo-v2.5-tts-voicedesign",
		&runtimev1.SpeechSynthesizeScenarioSpec{
			Text: "Hello from designed MiMo voice.",
			VoiceRef: &runtimev1.VoiceReference{
				Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
				Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
					ProviderVoiceRef: encodeMimoProviderVoiceRef("voice_design", designPrompt),
				},
			},
		},
		map[string]any{"optimize_text_preview": true},
	)
	if err != nil {
		t.Fatalf("SynthesizeSpeech voice design failed: %v", err)
	}
	if string(payload) != string(audioBytes) {
		t.Fatalf("decoded audio mismatch: got %q want %q", string(payload), string(audioBytes))
	}
	audio, _ := captured["audio"].(map[string]any)
	if _, exists := audio["voice"]; exists {
		t.Fatalf("voice design must not send preset voice: %#v", audio)
	}
	if got := ValueAsString(audio["format"]); got != "wav" {
		t.Fatalf("audio format mismatch: %q", got)
	}
	if !ValueAsBool(audio["optimize_text_preview"]) {
		t.Fatalf("optimize_text_preview must be forwarded when requested: %#v", audio)
	}
	messages, _ := captured["messages"].([]any)
	if len(messages) != 2 {
		t.Fatalf("expected two messages, got %#v", captured["messages"])
	}
	user, _ := messages[0].(map[string]any)
	if got := ValueAsString(user["content"]); got != designPrompt {
		t.Fatalf("design prompt mismatch: %q", got)
	}
}

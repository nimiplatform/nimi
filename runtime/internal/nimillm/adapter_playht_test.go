package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestExecutePlayHTTTSUsesScenarioNamespaceExtensions(t *testing.T) {
	var capturedUserID string
	var capturedExtensions map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/tts-custom" {
			http.NotFound(w, r)
			return
		}
		if got := strings.TrimSpace(r.Header.Get("Authorization")); got != "Bearer playht-key" {
			t.Fatalf("unexpected authorization header: %q", got)
		}
		capturedUserID = strings.TrimSpace(r.Header.Get("X-USER-ID"))

		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request payload: %v", err)
		}
		if ext, ok := payload["extensions"].(map[string]any); ok {
			capturedExtensions = ext
		}

		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("playht-audio"))
	}))
	defer server.Close()

	artifacts, _, _, err := ExecutePlayHTTTS(
		context.Background(),
		MediaAdapterConfig{
			BaseURL: server.URL,
			APIKey:  "playht-key",
		},
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			Extensions: []*runtimev1.ScenarioExtension{
				{
					Namespace: "nimi.scenario.speech_synthesize.request",
					Payload: mustStructPBForNimillmTest(t, map[string]any{
						"user_id":  "playht-user",
						"tts_path": "/tts-custom",
					}),
				},
			},
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
					SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
						Text: "hello from playht",
						VoiceRef: &runtimev1.VoiceReference{
							Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
							Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
								ProviderVoiceRef: "voice-123",
							},
						},
					},
				},
			},
		},
		"playht/playht-voice-model",
	)
	if err != nil {
		t.Fatalf("ExecutePlayHTTTS failed: %v", err)
	}
	if len(artifacts) != 1 {
		t.Fatalf("expected 1 artifact, got=%d", len(artifacts))
	}
	if capturedUserID != "playht-user" {
		t.Fatalf("expected X-USER-ID from scenario extension, got=%q", capturedUserID)
	}
	if got := strings.TrimSpace(ValueAsString(capturedExtensions["tts_path"])); got != "/tts-custom" {
		t.Fatalf("expected extension payload to be forwarded, got=%q", got)
	}
}

func mustStructPBForNimillmTest(t *testing.T, values map[string]any) *structpb.Struct {
	t.Helper()
	out, err := structpb.NewStruct(values)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return out
}

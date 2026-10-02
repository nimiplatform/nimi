package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestGeminiStoredVoiceSynthesisUsesUnaryUnstoredInteraction(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/interactions" || r.Header.Get("Authorization") != "" || r.Header.Get("x-goog-api-key") != "key" {
			t.Error("incorrect synthesis protocol")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		format, ok := body["response_format"].(map[string]any)
		if !ok || len(format) != 1 || format["type"] != "audio" {
			t.Error("unadmitted output control inserted")
		}
		voices, ok := MapField(body["generation_config"], "speech_config").([]any)
		if body["store"] != false || body["model"] != geminiVoiceDesignModel || !ok || len(voices) != 1 || MapField(voices[0], "voice") != "voice_created" {
			t.Errorf("voice binding or retention changed: %+v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "completed", "steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "audio", "mime_type": "audio/wav", "data": base64.StdEncoding.EncodeToString(testGeminiTTSWAV())}}}}, "usage": map[string]any{"total_input_tokens": 6, "total_output_tokens": 20}})
	}))
	defer server.Close()
	req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello from the designed voice", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF, Reference: &runtimev1.VoiceReference_ProviderVoiceRef{ProviderVoiceRef: "voice_created"}}}}}}
	artifacts, usage, providerID, err := ExecuteGeminiTTSInteractions(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "key", AllowLoopbackEndpoint: true}, req, geminiVoiceDesignModel)
	if err != nil || len(artifacts) != 1 || artifacts[0].GetMimeType() != "audio/wav" || artifacts[0].GetSampleRateHz() != 24000 || artifacts[0].GetDurationMs() != 100 || usage == nil || usage.InputTokens != 6 || usage.OutputTokens != 20 || providerID != "" {
		t.Fatalf("invalid output facts: artifacts=%+v usage=%+v err=%v", artifacts, usage, err)
	}
}

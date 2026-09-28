package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestGeminiLyriaClipUsesNativeTextAndInlineMP3(t *testing.T) {
	providerAudio := []byte("ID3-real-provider-test-body")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/models/lyria-3-clip-preview:generateContent" ||
			r.Header.Get("x-goog-api-key") != "gemini-key" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected Lyria native call: %s %s", r.Method, r.URL.Path)
			http.Error(w, "invalid call", http.StatusBadRequest)
			return
		}
		body := map[string]any{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		contents, _ := body["contents"].([]any)
		parts, _ := MapField(contents[0], "parts").([]any)
		if len(contents) != 1 || len(parts) != 1 || ValueAsString(MapField(parts[0], "text")) != "A short melodic loop." || body["generationConfig"] != nil {
			t.Errorf("Lyria prompt or request shape changed: %+v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{
			map[string]any{"text": "Generated lyrics"},
			map[string]any{"inlineData": map[string]any{"mimeType": "audio/mpeg", "data": base64.StdEncoding.EncodeToString(providerAudio)}},
		}}}}})
	}))
	defer server.Close()
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "A short melodic loop.", DurationSeconds: 35}}}}
	artifacts, usage, providerJobID, err := ExecuteGeminiLyriaClipGenerateContent(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "gemini-key", AllowLoopbackEndpoint: true}, req, geminiLyriaClipModel)
	if err != nil || usage != nil || providerJobID != "" || len(artifacts) != 1 || string(artifacts[0].GetBytes()) != string(providerAudio) || artifacts[0].GetMimeType() != "audio/mpeg" {
		t.Fatalf("native Lyria result artifacts=%+v usage=%+v providerJob=%q err=%v", artifacts, usage, providerJobID, err)
	}
}

func TestGeminiLyriaClipRejectsMultipleAudioParts(t *testing.T) {
	part := map[string]any{"inlineData": map[string]any{"mimeType": "audio/mpeg", "data": base64.StdEncoding.EncodeToString([]byte("audio"))}}
	_, err := geminiLyriaClipMP3(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{part, part}}}}})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("ambiguous Lyria output reason=%v present=%v err=%v", reason, ok, err)
	}
}

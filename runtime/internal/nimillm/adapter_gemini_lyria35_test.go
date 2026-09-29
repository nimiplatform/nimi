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

func TestGeminiLyria35UsesNativeStatelessPromptAndInlineMP3(t *testing.T) {
	providerAudio := []byte("ID3-lyria35-test-body")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/models/lyria-3.5:generateContent" ||
			r.Header.Get("x-goog-api-key") != "gemini-key" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected Lyria 3.5 native call: %s %s", r.Method, r.URL.Path)
			http.Error(w, "invalid call", http.StatusBadRequest)
			return
		}
		body := map[string]any{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		contents, _ := body["contents"].([]any)
		parts, _ := MapField(contents[0], "parts").([]any)
		if len(contents) != 1 || len(parts) != 1 || ValueAsString(MapField(parts[0], "text")) != "A piano song." || body["generationConfig"] != nil || body["durationSeconds"] != nil {
			t.Errorf("Lyria 3.5 invented provider duration control: %+v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{
			map[string]any{"text": "Generated lyrics"},
			map[string]any{"inlineData": map[string]any{"mimeType": "audio/mpeg", "data": base64.StdEncoding.EncodeToString(providerAudio)}},
		}}}}})
	}))
	defer server.Close()
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: &runtimev1.MusicGenerateScenarioSpec{Prompt: "A piano song.", DurationSeconds: 300}}}}
	artifacts, usage, providerJobID, err := ExecuteGeminiLyria35GenerateContent(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "gemini-key", AllowLoopbackEndpoint: true}, req, geminiLyria35Model)
	if err != nil || usage != nil || providerJobID != "" || len(artifacts) != 1 || string(artifacts[0].GetBytes()) != string(providerAudio) || artifacts[0].GetMimeType() != "audio/mpeg" {
		t.Fatalf("Lyria 3.5 native result artifacts=%+v usage=%+v providerJob=%q err=%v", artifacts, usage, providerJobID, err)
	}
}

package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func testGeminiStoredVoice() map[string]any {
	return map[string]any{"id": "voice_created", "type": "prompted", "model": "models/" + geminiVoiceDesignModel,
		"expire_time":  time.Now().UTC().Add(365 * 24 * time.Hour).Format(time.RFC3339Nano),
		"sample_audio": map[string]any{"mime_type": "audio/wav", "data": base64.StdEncoding.EncodeToString(testGeminiTTSWAV())},
		"usage":        map[string]any{"total_input_tokens": float64(0), "total_output_tokens": float64(14)},
	}
}

func TestGeminiStoredVoiceWireAndProviderFacts(t *testing.T) {
	response := testGeminiStoredVoice()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/voices" || r.Method != http.MethodPost || r.Header.Get("x-goog-api-key") != "key" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected native request: %s %s", r.Method, r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		voice, _ := body["voice"].(map[string]any)
		if body["store"] != true || voice["model"] != geminiVoiceDesignModel || voice["type"] != "prompted" || voice["language_code"] != "en-US" || MapField(voice["prompted"], "input") != "A warm fictional narrator" {
			t.Errorf("incorrect creation payload: %#v", body)
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	result, err := ExecuteVoiceWorkflowAdapter(context.Background(), "gemini_voice_workflow_adapter", VoiceWorkflowRequest{
		Provider: "gemini", WorkflowType: "text_description", WorkflowModelID: geminiVoiceDesignModel, ModelID: geminiVoiceDesignModel,
		Payload: map[string]any{"input": map[string]any{"instruction_text": "A warm fictional narrator", "language": "en-US"}},
	}, MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "key", AllowLoopbackEndpoint: true})
	if err != nil || result.ProviderVoiceRef != "voice_created" || result.ExpiresAt.IsZero() || len(result.PreviewAudio) == 0 || result.PreviewMime != "audio/wav" || result.Usage == nil || result.Usage.InputTokens != 0 || result.Usage.OutputTokens != 14 {
		t.Fatalf("facts were lost: result=%+v err=%v", result, err)
	}
}

func TestGeminiStoredVoiceInvalidFactsRetainKnownCleanupIdentity(t *testing.T) {
	for _, mutate := range []func(map[string]any){
		func(r map[string]any) { r["model"] = geminiVoiceDesignModel },
		func(r map[string]any) { r["model"] = "models/gemini-3.8-flash-lite-tts" },
		func(r map[string]any) { r["expire_time"] = "invented" },
		func(r map[string]any) {
			r["sample_audio"] = map[string]any{"mime_type": "audio/wav", "data": "bad"}
		},
		func(r map[string]any) { r["usage"] = map[string]any{"total_input_tokens": "4"} },
	} {
		r := testGeminiStoredVoice()
		mutate(r)
		result, err := parseGeminiStoredVoice(r, "", true)
		if err == nil || result.ProviderVoiceRef != "voice_created" {
			t.Fatalf("lost failed creation identity: %+v %v", result, err)
		}
	}
	r := testGeminiStoredVoice()
	delete(r, "usage")
	result, err := parseGeminiStoredVoice(r, "", true)
	if err != nil || result.Usage != nil {
		t.Fatalf("missing usage must stay absent: %+v %v", result, err)
	}
}

func TestGeminiStoredVoiceMissingAndUnavailableAreDistinct(t *testing.T) {
	code := http.StatusNotFound
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/voices/voice_created" || r.Header.Get("Authorization") != "" {
			t.Errorf("wrong resource request: %s", r.URL.Path)
		}
		w.WriteHeader(code)
		_, _ = w.Write([]byte(`{"error":{"message":"provider failure"}}`))
	}))
	defer server.Close()
	cfg := MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "key", AllowLoopbackEndpoint: true}
	_, found, err := inspectGeminiStoredVoice(context.Background(), "voice_created", cfg)
	if found || err != nil {
		t.Fatalf("404 must be confirmed absence: found=%v err=%v", found, err)
	}
	if err := deleteGeminiStoredVoice(context.Background(), "voice_created", cfg); err != nil {
		t.Fatal(err)
	}
	code = http.StatusServiceUnavailable
	_, found, err = inspectGeminiStoredVoice(context.Background(), "voice_created", cfg)
	if found || err == nil {
		t.Fatalf("503 must remain unknown: found=%v err=%v", found, err)
	}
}

func TestGeminiInteractionUsageRequiresBothReportedCounts(t *testing.T) {
	for _, raw := range []any{nil, map[string]any{}, map[string]any{"total_input_tokens": float64(5)}, map[string]any{"total_output_tokens": float64(0)}} {
		usage, err := geminiInteractionUsage(raw)
		if err != nil || usage != nil {
			t.Fatalf("incomplete usage became complete: %+v %v", usage, err)
		}
	}
	usage, err := geminiInteractionUsage(map[string]any{"total_input_tokens": float64(0), "total_output_tokens": float64(0)})
	if err != nil || usage == nil || usage.InputTokens != 0 || usage.OutputTokens != 0 {
		t.Fatalf("reported zero was lost: %+v %v", usage, err)
	}
}

func TestGeminiStoredVoiceOptionalEchoAndKeyDoNotInventProviderFacts(t *testing.T) {
	for _, value := range []any{nil, ""} {
		r := testGeminiStoredVoice()
		r["model"], r["key"] = value, value
		if _, err := parseGeminiStoredVoice(r, "", true); err != nil {
			t.Fatalf("optional empty fact rejected: %v", err)
		}
	}
	r := testGeminiStoredVoice()
	delete(r, "model")
	if _, err := parseGeminiStoredVoice(r, "", true); err != nil {
		t.Fatal(err)
	}
	r["key"] = "voicekey_unadmitted"
	result, err := parseGeminiStoredVoice(r, "", true)
	if err == nil || result.ProviderVoiceRef != "voice_created" {
		t.Fatal("stateless key became a stored asset or lost cleanup identity")
	}
}

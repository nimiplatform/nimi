package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestGeminiInteractionsTranscribeUsesInlineStatelessAudio(t *testing.T) {
	wav := testGeminiTTSWAV()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1beta/interactions" ||
			r.Header.Get("x-goog-api-key") != "gemini-key" || r.Header.Get("Authorization") != "" {
			t.Errorf("wrong native Gemini transcription call: %s %s", r.Method, r.URL.Path)
			http.Error(w, "invalid call", http.StatusBadRequest)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		input, _ := body["input"].([]any)
		if body["store"] != false || body["background"] != nil || len(input) != 1 ||
			ValueAsString(MapField(input[0], "mime_type")) != "audio/wav" ||
			ValueAsString(MapField(input[0], "data")) != base64.StdEncoding.EncodeToString(wav) {
			t.Errorf("transcription request lost inline bytes or stateless boundary")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "completed", "steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "text", "text": "Hello from Nimi."}}}}})
	}))
	defer server.Close()
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: wav}}}}}}
	artifacts, usage, providerJobID, err := ExecuteGeminiInteractionsTranscribe(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "gemini-key", AllowLoopbackEndpoint: true}, req, geminiInlineTranscribeModel)
	if err != nil || usage != nil || providerJobID != "" || len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "Hello from Nimi." {
		t.Fatalf("native inline ASR artifacts=%+v usage=%+v job=%q err=%v", artifacts, usage, providerJobID, err)
	}
}

func TestGeminiInteractionsTranscribeRejectsMissingTerminalText(t *testing.T) {
	_, err := geminiInteractionsTranscript(map[string]any{"status": "completed", "steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "text", "text": ""}}}}})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("missing transcript reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestGeminiInteractionsTranscriptPreservesProviderText(t *testing.T) {
	text, err := geminiInteractionsTranscript(map[string]any{"status": "completed", "steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "text", "text": "  Hello from Nimi.\n"}}}}})
	if err != nil || text != "  Hello from Nimi.\n" {
		t.Fatalf("transcript=%q err=%v", text, err)
	}
}

func TestGeminiInteractionsTranscribeCancelsInFlightRequest(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
	}))
	defer server.Close()
	defer close(release)
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: testGeminiTTSWAV()}}}}}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, _, _, err := ExecuteGeminiInteractionsTranscribe(ctx, MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "gemini-key", AllowLoopbackEndpoint: true}, req, geminiInlineTranscribeModel)
		result <- err
	}()
	select {
	case <-entered:
	case err := <-result:
		t.Fatalf("interaction failed before dispatch: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatal("interaction never reached provider")
	}
	cancel()
	select {
	case err := <-result:
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_ACTION_EXECUTED {
			t.Fatalf("in-flight cancel reason=%v ok=%v err=%v", reason, ok, err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("canceled interaction did not stop")
	}
}

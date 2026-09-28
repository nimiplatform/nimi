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

func TestDashscopeQwenAudio31UsesNativeStatelessInlineWAV(t *testing.T) {
	wav := testGeminiTTSWAV()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != dashscopeQwenAudio31ASRPath ||
			r.Header.Get("Authorization") != "Bearer fixture" || r.Header.Get("X-DashScope-SSE") != "disable" {
			t.Errorf("wrong Qwen-Audio native request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "invalid", http.StatusBadRequest)
			return
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode Qwen-Audio request: %v", err)
		}
		messages := MapField(payload["input"], "messages").([]any)
		content := MapField(messages[0], "content").([]any)
		audio := MapField(content[0], "input_audio")
		if payload["model"] != dashscopeQwenAudio31ASRModel || len(messages) != 1 || len(content) != 1 ||
			ValueAsString(MapField(content[0], "type")) != "input_audio" ||
			!strings.HasPrefix(ValueAsString(MapField(audio, "data")), "data:audio/wav;base64,") ||
			MapField(payload["parameters"], "format") != "wav" || MapField(payload["parameters"], "sample_rate") != "24000" {
			t.Errorf("Qwen-Audio request did not use exact inline subset")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"output": map[string]any{"text": "  Hello from Nimi.\n"}, "request_id": "provider-trace"})
	}))
	defer server.Close()
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
			MimeType: "audio/wav", AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: wav}},
		}}}}
	artifacts, usage, providerJobID, err := ExecuteDashscopeQwenAudio31InlineTranscribe(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL + "/compatible-mode/v1", APIKey: "fixture", AllowLoopbackEndpoint: true,
	}, req.GetSpec().GetSpeechTranscribe())
	if err != nil || usage != nil || providerJobID != "" || len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "  Hello from Nimi.\n" {
		t.Fatalf("native Qwen-Audio inline ASR artifacts=%+v usage=%+v job=%q err=%v", artifacts, usage, providerJobID, err)
	}
}

func TestDashscopeQwenAudio31RejectsEmptyTranscript(t *testing.T) {
	response := map[string]any{"output": map[string]any{"text": " "}}
	if _, err := dashscopeQwenAudio31Transcript(response); err == nil {
		t.Fatal("empty Qwen-Audio transcript accepted")
	} else if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("empty transcript reason=%v present=%v err=%v", reason, ok, err)
	}
}

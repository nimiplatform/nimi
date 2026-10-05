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
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/protobuf/encoding/protojson"
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
	if err != nil || usage != nil || providerJobID != "" || len(artifacts) != 1 || artifacts[0].GetMimeType() != localexecution.SpeechTranscriptMIME {
		t.Fatalf("native inline ASR artifacts=%+v usage=%+v job=%q err=%v", artifacts, usage, providerJobID, err)
	}
	transcript := &runtimev1.SpeechTranscript{}
	if err := protojson.Unmarshal(artifacts[0].GetBytes(), transcript); err != nil || transcript.GetText() != "Hello from Nimi." || transcript.GetLanguage() != "" || len(transcript.GetWords()) != 0 {
		t.Fatalf("typed transcript=%+v err=%v", transcript, err)
	}
}

func TestGeminiInteractionsTranscribeRejectsMissingTerminalText(t *testing.T) {
	_, err := geminiInteractionsTranscript(map[string]any{"status": "completed", "steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "text", "text": ""}}}}}, false)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("missing transcript reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestGeminiInteractionsTranscriptPreservesProviderText(t *testing.T) {
	transcript, err := geminiInteractionsTranscript(map[string]any{"status": "completed", "steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "text", "text": "  Hello  from Nimi.\nWelcome!\n"}}}}}, false)
	if err != nil || transcript.GetText() != "Hello  from Nimi.\nWelcome!" {
		t.Fatalf("transcript=%+v err=%v", transcript, err)
	}
}

func TestGeminiInteractionsTranscribeRequestsAndCapturesActualWordTimes(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		mode := MapField(MapField(body["generation_config"], "transcription_config"), "mode")
		granularities, _ := MapField(mode, "timestamp_granularities").([]any)
		if MapField(mode, "type") != "verbatim" || len(granularities) != 1 || granularities[0] != "word" || body["store"] != false {
			t.Errorf("actual word timing request=%+v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "completed", "steps": []any{map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "text", "text": "Hello,  world!", "annotations": []any{
			map[string]any{"type": "word_info", "text": "Hello", "start_offset": "0.100s", "end_offset": "0.450s"},
			map[string]any{"type": "word_info", "text": "world", "start_offset": "0.500s", "end_offset": "0.850s"},
		}}}}}, "usage": map[string]any{"total_input_tokens": 3, "total_output_tokens": 7}})
	}))
	defer server.Close()
	timestamps := true
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", Timestamps: &timestamps, AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: testGeminiTTSWAV()}}}}}}
	artifacts, usage, _, err := ExecuteGeminiInteractionsTranscribe(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "key", AllowLoopbackEndpoint: true}, req, geminiInlineTranscribeModel)
	if err != nil || len(artifacts) != 1 || usage == nil || usage.GetInputTokens() != 3 || usage.GetOutputTokens() != 7 {
		t.Fatalf("actual result/usage artifacts=%+v usage=%+v err=%v", artifacts, usage, err)
	}
	transcript := &runtimev1.SpeechTranscript{}
	if err := protojson.Unmarshal(artifacts[0].GetBytes(), transcript); err != nil || transcript.GetText() != "Hello,  world!" || transcript.GetLanguage() != "" || len(transcript.GetWords()) != 2 || transcript.Words[0].GetStartSeconds() != 0.1 || transcript.Words[1].GetEndSeconds() != 0.85 {
		t.Fatalf("actual words lost or estimated: %+v err=%v", transcript, err)
	}
}

func TestGeminiInteractionsTranscriptRejectsMissingOrInvalidRequestedTiming(t *testing.T) {
	for _, annotation := range []any{
		nil,
		map[string]any{"type": "word_info", "text": "Hello", "end_offset": "0.450s"},
		map[string]any{"type": "word_info", "text": "Hello", "start_offset": "0.100s"},
		map[string]any{"type": "word_info", "text": "Hello", "start_offset": 0.1, "end_offset": "0.450s"},
		map[string]any{"type": "word_info", "text": "Hello", "start_offset": "0.100", "end_offset": "0.450s"},
		map[string]any{"type": "word_info", "text": "Hello", "start_offset": "-0.100s", "end_offset": "0.450s"},
		map[string]any{"type": "word_info", "text": "Hello", "start_offset": "0.500s", "end_offset": "0.450s"},
	} {
		content := map[string]any{"type": "text", "text": "Hello"}
		if annotation != nil {
			content["annotations"] = []any{annotation}
		}
		payload := map[string]any{"status": "completed", "steps": []any{map[string]any{"type": "model_output", "content": []any{content}}}}
		if _, err := geminiInteractionsTranscript(payload, true); err == nil {
			t.Fatalf("missing/invalid real timing admitted: %+v", annotation)
		}
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

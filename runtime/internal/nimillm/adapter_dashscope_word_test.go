package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func cosyWordEvents() []map[string]any {
	event := func(kind string, index int, words any, data string) map[string]any {
		return map[string]any{"request_id": "word-request", "output": map[string]any{"type": kind, "sentence": map[string]any{"index": index, "words": words}, "audio": map[string]any{"data": data}}}
	}
	return []map[string]any{
		event("sentence-begin", 0, []any{}, ""),
		event("sentence-synthesis", 0, nil, base64.StdEncoding.EncodeToString([]byte("first"))),
		event("sentence-end", 0, []any{map[string]any{"text": "Hello", "begin_time": 0, "end_time": 400}}, ""),
		event("sentence-begin", 1, []any{}, ""),
		event("sentence-synthesis", 1, nil, base64.StdEncoding.EncodeToString([]byte("second"))),
		event("sentence-end", 1, []any{map[string]any{"text": "Nimi", "begin_time": 650, "end_time": 1050}}, ""),
		{"request_id": "word-request", "output": map[string]any{"finish_reason": "stop", "audio": map[string]any{"data": ""}}},
	}
}

func encodeCosyWordEvents(events []map[string]any) string {
	var out strings.Builder
	for _, event := range events {
		body, _ := json.Marshal(event)
		fmt.Fprintf(&out, "data: %s\n\n", body)
	}
	return out.String()
}

func TestCosyVoiceWordStreamPreservesGlobalTimeAndAudioOrder(t *testing.T) {
	audio, alignment, _, requestID, err := readCosyVoiceWordStream(context.Background(), strings.NewReader(encodeCosyWordEvents(cosyWordEvents())))
	if err != nil || !bytes.Equal(audio, []byte("firstsecond")) || requestID != "word-request" || alignment.GetUnit() != runtimev1.SpeechAlignmentUnit_SPEECH_ALIGNMENT_UNIT_WORD || len(alignment.Tokens) != 2 {
		t.Fatalf("stream = %q %v %s %v", audio, alignment, requestID, err)
	}
	if alignment.Tokens[0].StartMs != 0 || alignment.Tokens[1].StartMs != 650 || alignment.Tokens[1].EndMs != 1050 {
		t.Fatalf("actual time changed: %v", alignment)
	}
}

func TestCosyVoiceWordStreamRejectsIncompleteAndMalformedTiming(t *testing.T) {
	for _, name := range []string{"missing-end", "missing-time", "negative", "reverse", "reset-second-sentence", "no-words", "no-stop", "wrong-order", "bad-base64", "wrong-request"} {
		t.Run(name, func(t *testing.T) {
			events := cosyWordEvents()
			word := events[2]["output"].(map[string]any)["sentence"].(map[string]any)["words"].([]any)[0].(map[string]any)
			switch name {
			case "missing-end":
				delete(word, "end_time")
			case "missing-time":
				delete(word, "begin_time")
			case "negative":
				word["begin_time"] = -1
			case "reverse":
				word["begin_time"] = 500
			case "reset-second-sentence":
				events[5]["output"].(map[string]any)["sentence"].(map[string]any)["words"].([]any)[0].(map[string]any)["begin_time"] = 0
			case "no-words":
				events[2]["output"].(map[string]any)["sentence"].(map[string]any)["words"] = []any{}
			case "no-stop":
				events = events[:6]
			case "wrong-order":
				events[0], events[1] = events[1], events[0]
			case "bad-base64":
				events[1]["output"].(map[string]any)["audio"].(map[string]any)["data"] = "!invalid"
			case "wrong-request":
				events[3]["request_id"] = "another-request"
			}
			if _, _, _, _, err := readCosyVoiceWordStream(context.Background(), strings.NewReader(encodeCosyWordEvents(events))); err == nil {
				t.Fatal("invalid timing succeeded")
			}
		})
	}
}

func TestCosyVoiceWordRequestUsesSSEAndRequiresAlignment(t *testing.T) {
	for _, model := range []string{"cosyvoice-v3-plus", "cosyvoice-v3-flash"} {
		t.Run(model, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("X-DashScope-SSE") != "enable" {
					t.Error("SSE was not requested")
				}
				var payload map[string]any
				_ = json.NewDecoder(r.Body).Decode(&payload)
				if payload["input"].(map[string]any)["word_timestamp_enabled"] != true {
					t.Error("word timing was not requested")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				events := cosyWordEvents()
				// The provider may additionally offer an HTTP URL. Complete
				// ordered SSE bytes need no second endpoint or security relaxation.
				events[len(events)-1]["output"].(map[string]any)["audio"].(map[string]any)["url"] = "http://192.0.2.1/not-fetchable.mp3"
				_, _ = fmt.Fprint(w, encodeCosyWordEvents(events))
			}))
			defer server.Close()
			spec := &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello. Nimi.", AudioFormat: "mp3", TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "longanyang"}}}
			request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}}}
			artifacts, _, providerJobID, err := ExecuteAlibabaNative(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, nil, "word-job", request, model)
			if err != nil || len(artifacts) != 1 || artifacts[0].SpeechAlignment == nil || providerJobID != "" {
				t.Fatalf("adapter: %v %v %s", artifacts, err, providerJobID)
			}
		})
	}
}

func TestCosyVoiceWordCanceledStreamNeverReturnsLateAlignment(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if audio, alignment, _, _, err := readCosyVoiceWordStream(ctx, strings.NewReader(encodeCosyWordEvents(cosyWordEvents()))); err == nil || audio != nil || alignment != nil {
		t.Fatalf("canceled late result = %q %v %v", audio, alignment, err)
	}
}

func TestCosyVoiceWordDoesNotAcceptJSONAudioWithoutTiming(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"output":{"finish_reason":"stop","audio":{"data":"YXVkaW8="}}}`)
	}))
	defer server.Close()
	spec := &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello", TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "longanyang"}}}
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: spec}}}
	_, _, _, err := ExecuteAlibabaNative(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, nil, "word-job", request, "cosyvoice-v3-plus")
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("missing timing = %v", err)
	}
}

func TestCosyVoiceWordHTTPStopsOnCancelAndDiscardsLateTerminal(t *testing.T) {
	started := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w, encodeCosyWordEvents(cosyWordEvents()[:2]))
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		// A producer writing a late valid terminal cannot reverse cancellation.
		_, _ = fmt.Fprint(w, encodeCosyWordEvents(cosyWordEvents()[2:]))
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello Nimi.", TimingMode: runtimev1.SpeechTimingMode_SPEECH_TIMING_MODE_WORD, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "longanyang"}}}}}}
	done := make(chan error, 1)
	go func() {
		artifacts, _, _, err := ExecuteAlibabaNative(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, nil, "word-job", request, "cosyvoice-v3-plus")
		if len(artifacts) > 0 {
			done <- fmt.Errorf("canceled request published artifacts")
			return
		}
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("SSE did not start")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("late terminal succeeded")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("SSE did not stop")
	}
}

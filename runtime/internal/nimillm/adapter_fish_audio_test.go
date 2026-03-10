package nimillm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestExecuteFishAudioTTS_UsesModelHeaderAndReferenceID(t *testing.T) {
	var (
		gotMethod        string
		gotPath          string
		gotAuthorization string
		gotModelHeader   string
		gotPayload       map[string]any
	)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotMethod = request.Method
		gotPath = request.URL.Path
		gotAuthorization = request.Header.Get("Authorization")
		gotModelHeader = request.Header.Get("model")
		rawBody, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("ReadAll(body): %v", err)
		}
		if err := json.Unmarshal(rawBody, &gotPayload); err != nil {
			t.Fatalf("Unmarshal(body): %v", err)
		}
		writer.Header().Set("Content-Type", "audio/mpeg")
		_, _ = writer.Write([]byte("audio-bytes"))
	}))
	defer server.Close()

	req := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "Fish Audio live test",
					VoiceRef: &runtimev1.VoiceReference{
						Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
						Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
							ProviderVoiceRef: "custom-model-123",
						},
					},
				},
			},
		},
	}

	artifacts, usage, _, err := ExecuteFishAudioTTS(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "fish-key",
	}, req, "fish_audio/s1")
	if err != nil {
		t.Fatalf("ExecuteFishAudioTTS: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Fatalf("unexpected method: %q", gotMethod)
	}
	if gotPath != "/v1/tts" {
		t.Fatalf("unexpected path: %q", gotPath)
	}
	if gotAuthorization != "Bearer fish-key" {
		t.Fatalf("unexpected Authorization header: %q", gotAuthorization)
	}
	if gotModelHeader != "s1" {
		t.Fatalf("unexpected model header: %q", gotModelHeader)
	}
	if got := strings.TrimSpace(ValueAsString(gotPayload["reference_id"])); got != "custom-model-123" {
		t.Fatalf("unexpected reference_id: %q", got)
	}
	if _, ok := gotPayload["model"]; ok {
		t.Fatalf("Fish Audio request must not send model in JSON body")
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "audio-bytes" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
	if usage == nil || usage.GetComputeMs() <= 0 {
		t.Fatalf("expected usage stats, got %#v", usage)
	}
}

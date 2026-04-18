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
	"google.golang.org/protobuf/types/known/structpb"
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
	if _, ok := gotPayload["extensions"]; ok {
		t.Fatalf("Fish Audio request must not send raw extensions in JSON body")
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "audio-bytes" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
	if usage == nil || usage.GetComputeMs() <= 0 {
		t.Fatalf("expected usage stats, got %#v", usage)
	}
}

func TestExecuteFishAudioTTS_MapsProsodyAndProviderOptions(t *testing.T) {
	var gotPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
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
					Text:         "Fish Audio options",
					AudioFormat:  "opus",
					SampleRateHz: 48000,
					Speed:        1.15,
					Language:     "ja",
					VoiceRef: &runtimev1.VoiceReference{
						Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
						Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
							ProviderVoiceRef: "speaker-123",
						},
					},
				},
			},
		},
		Extensions: []*runtimev1.ScenarioExtension{
			{
				Namespace: "nimi.scenario.speech_synthesize.request",
				Payload: mustStructPBForFishAudioTest(t, map[string]any{
					"temperature":  0.6,
					"top_p":        0.8,
					"chunk_length": 200,
					"normalize":    true,
					"latency":      "balanced",
					"prosody": map[string]any{
						"volume":             2,
						"normalize_loudness": true,
					},
				}),
			},
		},
	}

	if _, _, _, err := ExecuteFishAudioTTS(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "fish-key",
	}, req, "fish_audio/s2-pro"); err != nil {
		t.Fatalf("ExecuteFishAudioTTS: %v", err)
	}

	if got := strings.TrimSpace(ValueAsString(gotPayload["format"])); got != "opus" {
		t.Fatalf("unexpected format: %q", got)
	}
	if got := ValueAsInt64(gotPayload["sample_rate"]); got != 48000 {
		t.Fatalf("unexpected sample_rate: %d", got)
	}
	if got := ValueAsFloat64(gotPayload["temperature"]); got != 0.6 {
		t.Fatalf("unexpected temperature: %v", got)
	}
	if got := ValueAsFloat64(gotPayload["top_p"]); got != 0.8 {
		t.Fatalf("unexpected top_p: %v", got)
	}
	if got := ValueAsInt64(gotPayload["chunk_length"]); got != 200 {
		t.Fatalf("unexpected chunk_length: %d", got)
	}
	if got := ValueAsString(gotPayload["latency"]); got != "balanced" {
		t.Fatalf("unexpected latency: %q", got)
	}
	if _, ok := gotPayload["language"]; ok {
		t.Fatalf("Fish Audio request must not send undocumented language field")
	}
	if _, ok := gotPayload["extensions"]; ok {
		t.Fatalf("Fish Audio request must not send raw extensions in JSON body")
	}
	prosody, ok := gotPayload["prosody"].(map[string]any)
	if !ok {
		t.Fatalf("expected prosody map, got %#v", gotPayload["prosody"])
	}
	if got := ValueAsFloat64(prosody["speed"]); got != 1.15 {
		t.Fatalf("unexpected prosody.speed: %v", got)
	}
	if got := ValueAsInt64(prosody["volume"]); got != 2 {
		t.Fatalf("unexpected prosody.volume: %d", got)
	}
	if !ValueAsBool(prosody["normalize_loudness"]) {
		t.Fatalf("expected prosody.normalize_loudness to be true")
	}
}

func mustStructPBForFishAudioTest(t *testing.T, values map[string]any) *structpb.Struct {
	t.Helper()
	out, err := structpb.NewStruct(values)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return out
}

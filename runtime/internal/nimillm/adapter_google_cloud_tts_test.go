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

func TestExecuteGoogleCloudTTS_ChirpRequestUsesVoiceNameWithoutModelName(t *testing.T) {
	var (
		gotMethod  string
		gotPath    string
		gotPayload map[string]any
	)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		gotMethod = request.Method
		gotPath = request.URL.Path
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
					Text:        "Hello from Chirp",
					Language:    "en-US",
					AudioFormat: "mp3",
					VoiceRef: &runtimev1.VoiceReference{
						Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
						Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
							ProviderVoiceRef: "en-US-Chirp3-HD-Charon",
						},
					},
				},
			},
		},
	}

	artifacts, usage, _, err := ExecuteGoogleCloudTTS(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "google-token",
	}, req, "google_cloud_tts/chirp-3-hd")
	if err != nil {
		t.Fatalf("ExecuteGoogleCloudTTS: %v", err)
	}
	if gotMethod != http.MethodPost {
		t.Fatalf("unexpected method: %q", gotMethod)
	}
	if gotPath != "/v1/text:synthesize" {
		t.Fatalf("unexpected path: %q", gotPath)
	}
	voice, ok := gotPayload["voice"].(map[string]any)
	if !ok {
		t.Fatalf("expected voice object, got=%T payload=%s", gotPayload["voice"], debugGoogleCloudTTSPayload(gotPayload))
	}
	if got := strings.TrimSpace(ValueAsString(voice["name"])); got != "en-US-Chirp3-HD-Charon" {
		t.Fatalf("unexpected voice.name: %q", got)
	}
	if got := strings.TrimSpace(ValueAsString(voice["modelName"])); got != "" {
		t.Fatalf("chirp request must not set voice.modelName, got=%q", got)
	}
	input, ok := gotPayload["input"].(map[string]any)
	if !ok || strings.TrimSpace(ValueAsString(input["text"])) != "Hello from Chirp" {
		t.Fatalf("unexpected input payload: %#v", gotPayload["input"])
	}
	if _, ok := gotPayload["extensions"]; ok {
		t.Fatalf("google cloud tts request must not send raw extensions field")
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "audio-bytes" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
	if usage == nil || usage.GetComputeMs() <= 0 {
		t.Fatalf("expected usage stats, got %#v", usage)
	}
}

func TestExecuteGoogleCloudTTS_GeminiRequestAddsModelPromptAndProviderOverrides(t *testing.T) {
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
		_, _ = writer.Write([]byte("gemini-audio"))
	}))
	defer server.Close()

	req := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		Extensions: []*runtimev1.ScenarioExtension{
			{
				Namespace: "nimi.scenario.speech_synthesize.request",
				Payload: mustStructPBForGoogleCloudTTSTest(t, map[string]any{
					"parent": "projects/test/locations/us",
					"prompt": "Say this like a natural podcast conversation.",
					"voice": map[string]any{
						"multi_speaker_voice_config": map[string]any{
							"speaker_voice_configs": []any{
								map[string]any{
									"speaker_alias": "Host",
									"speaker_id":    "Kore",
								},
								map[string]any{
									"speaker_alias": "Guest",
									"speaker_id":    "Charon",
								},
							},
						},
					},
					"audio_config": map[string]any{
						"sample_rate_hz": 24000,
					},
				}),
			},
		},
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text:         "Host: Hi there.\nGuest: Hello.",
					Language:     "en-US",
					AudioFormat:  "wav",
					SampleRateHz: 22050,
				},
			},
		},
	}

	artifacts, _, _, err := ExecuteGoogleCloudTTS(context.Background(), MediaAdapterConfig{
		BaseURL: server.URL,
		APIKey:  "google-token",
	}, req, "google_cloud_tts/gemini-2.5-pro-tts")
	if err != nil {
		t.Fatalf("ExecuteGoogleCloudTTS: %v", err)
	}
	input, ok := gotPayload["input"].(map[string]any)
	if !ok {
		t.Fatalf("expected input object, got=%T payload=%s", gotPayload["input"], debugGoogleCloudTTSPayload(gotPayload))
	}
	if got := strings.TrimSpace(ValueAsString(input["prompt"])); got != "Say this like a natural podcast conversation." {
		t.Fatalf("unexpected input.prompt: %q", got)
	}
	voice, ok := gotPayload["voice"].(map[string]any)
	if !ok {
		t.Fatalf("expected voice object, got=%T", gotPayload["voice"])
	}
	if got := strings.TrimSpace(ValueAsString(voice["modelName"])); got != "gemini-2.5-pro-tts" {
		t.Fatalf("unexpected voice.modelName: %q", got)
	}
	msvc, ok := voice["multiSpeakerVoiceConfig"].(map[string]any)
	if !ok {
		t.Fatalf("expected multiSpeakerVoiceConfig, got=%T", voice["multiSpeakerVoiceConfig"])
	}
	configs, ok := msvc["speakerVoiceConfigs"].([]any)
	if !ok || len(configs) != 2 {
		t.Fatalf("unexpected speakerVoiceConfigs: %#v", msvc["speakerVoiceConfigs"])
	}
	audioConfig, ok := gotPayload["audioConfig"].(map[string]any)
	if !ok {
		t.Fatalf("expected audioConfig object, got=%T", gotPayload["audioConfig"])
	}
	if got := ValueAsInt64(audioConfig["sampleRateHertz"]); got != 24000 {
		t.Fatalf("expected extension override sampleRateHertz=24000, got=%d", got)
	}
	if got := strings.TrimSpace(ValueAsString(gotPayload["parent"])); got != "projects/test/locations/us" {
		t.Fatalf("unexpected parent: %q", got)
	}
	if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "gemini-audio" {
		t.Fatalf("unexpected artifacts: %#v", artifacts)
	}
}

func mustStructPBForGoogleCloudTTSTest(t *testing.T, values map[string]any) *structpb.Struct {
	t.Helper()
	out, err := structpb.NewStruct(values)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return out
}

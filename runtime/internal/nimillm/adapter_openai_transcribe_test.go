package nimillm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func openAITranscriptionTestRequest(spec *runtimev1.SpeechTranscribeScenarioSpec) *runtimev1.SubmitScenarioJobRequest {
	if spec.GetAudioSource() == nil {
		spec.AudioSource = &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("RIFF-audio")}}
	}
	if spec.GetMimeType() == "" {
		spec.MimeType = "audio/wav"
	}
	return &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Spec:         &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: spec}},
	}
}

func openAITranscriptionTestTarget(serverURL string, model string) (*CloudProvider, *RemoteTarget) {
	return NewCloudProvider(CloudConfig{}), &RemoteTarget{
		ProviderType:    "openai",
		Endpoint:        serverURL + "/v1",
		APIKey:          "test-key",
		ProviderModelID: model,
		AllowLoopback:   true,
	}
}

func TestOpenAITranscriptionsSendsOnlyEndpointFields(t *testing.T) {
	for _, tc := range []struct {
		name       string
		model      string
		spec       *runtimev1.SpeechTranscribeScenarioSpec
		response   string
		wantFields map[string][]string
		wantUsage  *runtimev1.UsageStats
		wantBilled any
	}{
		{
			name:       "gpt-transcribe expected language",
			model:      "gpt-transcribe",
			spec:       &runtimev1.SpeechTranscribeScenarioSpec{Language: "zh"},
			response:   `{"text":" 你好，欢迎。 ","usage":{"type":"duration","seconds":3}}`,
			wantFields: map[string][]string{"model": {"gpt-transcribe"}, "response_format": {"json"}, "languages[]": {"zh"}},
			wantBilled: float64(3),
		},
		{
			name:       "gpt-4o language and hint",
			model:      "gpt-4o-transcribe",
			spec:       &runtimev1.SpeechTranscribeScenarioSpec{Language: "en", Prompt: "Nimi", ResponseFormat: "text"},
			response:   `{"text":"Hello Nimi.","usage":{"type":"tokens","input_tokens":12,"output_tokens":4,"total_tokens":16}}`,
			wantFields: map[string][]string{"model": {"gpt-4o-transcribe"}, "response_format": {"json"}, "language": {"en"}, "prompt": {"Nimi"}},
			wantUsage:  &runtimev1.UsageStats{InputTokens: 12, OutputTokens: 4},
		},
		{
			name:       "gpt-4o mini plain",
			model:      "gpt-4o-mini-transcribe",
			spec:       &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/webm"},
			response:   `{"text":"plain"}`,
			wantFields: map[string][]string{"model": {"gpt-4o-mini-transcribe"}, "response_format": {"json"}},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fields := map[string][]string{}
			var fileName string
			var fileBytes []byte
			var authorization string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/transcriptions" {
					http.NotFound(w, r)
					return
				}
				authorization = r.Header.Get("Authorization")
				reader, err := r.MultipartReader()
				if err != nil {
					t.Errorf("MultipartReader: %v", err)
					return
				}
				for {
					part, err := reader.NextPart()
					if err == io.EOF {
						break
					}
					if err != nil {
						t.Errorf("NextPart: %v", err)
						return
					}
					payload, _ := io.ReadAll(part)
					if part.FormName() == "file" {
						fileName, fileBytes = part.FileName(), payload
						continue
					}
					fields[part.FormName()] = append(fields[part.FormName()], string(payload))
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, tc.response)
			}))
			defer server.Close()

			provider, target := openAITranscriptionTestTarget(server.URL, tc.model)
			artifacts, usage, _, err := provider.executeOpenAITranscriptions(context.Background(), openAITranscriptionTestRequest(tc.spec), tc.model, target)
			if err != nil {
				t.Fatalf("executeOpenAITranscriptions: %v", err)
			}
			if !reflect.DeepEqual(fields, tc.wantFields) {
				t.Fatalf("fields = %v, want %v", fields, tc.wantFields)
			}
			wantName := "audio.wav"
			if tc.spec.GetMimeType() == "audio/webm" {
				wantName = "audio.webm"
			}
			if fileName != wantName || string(fileBytes) != "RIFF-audio" || authorization != "Bearer test-key" {
				t.Fatalf("file=%q bytes=%q authorization present=%t", fileName, fileBytes, authorization != "")
			}
			if len(artifacts) != 1 || artifacts[0].GetMimeType() != "text/plain" {
				t.Fatalf("artifacts = %+v", artifacts)
			}
			var parsed struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal([]byte(tc.response), &parsed)
			if got := string(artifacts[0].GetBytes()); got == "" || got != strings.TrimSpace(parsed.Text) {
				t.Fatalf("transcript = %q", got)
			}
			if (usage == nil) != (tc.wantUsage == nil) || usage.GetInputTokens() != tc.wantUsage.GetInputTokens() ||
				usage.GetOutputTokens() != tc.wantUsage.GetOutputTokens() || usage.GetComputeMs() != 0 {
				t.Fatalf("usage = %+v, want %+v", usage, tc.wantUsage)
			}
			billed, present := artifacts[0].GetMetadata().AsMap()["provider_usage_seconds"]
			if present != (tc.wantBilled != nil) || (present && billed != tc.wantBilled) {
				t.Fatalf("provider_usage_seconds = %v (present=%t), want %v", billed, present, tc.wantBilled)
			}
		})
	}
}

func TestOpenAITranscriptionsFailsTypedWithoutGuessing(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"text":"  "}`)
	}))
	defer server.Close()

	provider, target := openAITranscriptionTestTarget(server.URL, "gpt-transcribe")
	_, _, _, err := provider.executeOpenAITranscriptions(context.Background(), openAITranscriptionTestRequest(&runtimev1.SpeechTranscribeScenarioSpec{}), "gpt-transcribe", target)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("an empty transcript is not a no_speech result: reason=%v present=%v err=%v", reason, ok, err)
	}

	hits.Store(0)
	for name, spec := range map[string]*runtimev1.SpeechTranscribeScenarioSpec{
		"timestamps":             {Timestamps: testBool(true)},
		"diarization":            {Diarization: testBool(true)},
		"hint on gpt-transcribe": {Prompt: "Nimi"},
		"json result":            {ResponseFormat: "json"},
		"unsupported file":       {MimeType: "audio/ogg"},
		"remote URL": {AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
			Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{AudioUri: "https://example.com/audio.wav"},
		}},
	} {
		_, _, _, err := provider.executeOpenAITranscriptions(context.Background(), openAITranscriptionTestRequest(spec), "gpt-transcribe", target)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("%s: reason=%v present=%v err=%v", name, reason, ok, err)
		}
	}
	if got := hits.Load(); got != 0 {
		t.Fatalf("unsupported requests reached the provider %d times", got)
	}
}

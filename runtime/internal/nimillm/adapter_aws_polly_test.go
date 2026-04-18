package nimillm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestExecuteAWSPollyTTS_MapsCatalogModelToEngine(t *testing.T) {
	tests := []struct {
		name          string
		modelResolved string
		wantEngine    string
	}{
		{name: "standard", modelResolved: "aws_polly/polly-standard-tts", wantEngine: "standard"},
		{name: "neural", modelResolved: "aws_polly/polly-neural-tts", wantEngine: "neural"},
		{name: "long-form", modelResolved: "aws_polly/polly-long-form-tts", wantEngine: "long-form"},
		{name: "generative", modelResolved: "aws_polly/polly-generative-tts", wantEngine: "generative"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
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
							Text:        "Hello from Polly",
							Language:    "en-US",
							AudioFormat: "mp3",
							VoiceRef: &runtimev1.VoiceReference{
								Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
								Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
									ProviderVoiceRef: "Joanna",
								},
							},
						},
					},
				},
			}

			artifacts, _, _, err := ExecuteAWSPollyTTS(context.Background(), MediaAdapterConfig{
				BaseURL: server.URL,
				APIKey:  "aws-token",
			}, req, tc.modelResolved)
			if err != nil {
				t.Fatalf("ExecuteAWSPollyTTS: %v", err)
			}
			if got := ValueAsString(gotPayload["Engine"]); got != tc.wantEngine {
				t.Fatalf("unexpected Engine: got=%q want=%q payload=%#v", got, tc.wantEngine, gotPayload)
			}
			if _, ok := gotPayload["extensions"]; ok {
				t.Fatalf("aws polly request must not send raw extensions field")
			}
			if len(artifacts) != 1 || string(artifacts[0].GetBytes()) != "audio-bytes" {
				t.Fatalf("unexpected artifacts: %#v", artifacts)
			}
		})
	}
}

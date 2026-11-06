package ai

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestAzureAndPollySpeechJobsKeepNativeModelVoiceAndAudio(t *testing.T) {
	audio, err := os.ReadFile("../../nimillm/testdata/tone-24k.mp3")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ provider, model, voice, engine, style string }{
		{"aws_polly", "polly-standard-tts", "Joanna", "standard", ""}, {"aws_polly", "polly-neural-tts", "Joanna", "neural", ""}, {"aws_polly", "polly-long-form-tts", "Danielle", "long-form", ""}, {"aws_polly", "polly-generative-tts", "Tiffany", "generative", ""},
		{"azure_speech", "azure-neural-tts", "en-US-JennyNeural", "", ""}, {"azure_speech", "azure-hd-tts", "en-US-Ava:DragonHDLatestNeural", "", ""}, {"azure_speech", "azure-openai-tts-preview", "en-US-NovaMultilingualNeuralHD", "", ""},
		{"azure_speech", "azure-hd-flash-tts", "zh-CN-Xiaoxiao:DragonHDFlashLatestNeural", "", "cheerful"}, {"azure_speech", "azure-mai-voice-2.1", "en-US-Harper:MAI-Voice-2.1", "", "happy"}, {"azure_speech", "azure-mai-voice-2.1-flash", "zh-CN-Mei:MAI-Voice-2.1-Flash", "", "whispering"},
	} {
		t.Run(tc.model, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if tc.provider == "aws_polly" {
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if r.URL.Path != "/v1/speech" || body["Engine"] != tc.engine || body["VoiceId"] != tc.voice || body["SampleRate"] != "24000" {
						t.Errorf("native Polly fields: %v", body)
					}
				} else {
					raw, _ := io.ReadAll(r.Body)
					if r.URL.Path != "/cognitiveservices/v1" || !strings.Contains(string(raw), "name='"+tc.voice+"'") || r.Header.Get("X-Microsoft-OutputFormat") != "audio-24khz-160kbitrate-mono-mp3" {
						t.Errorf("native Azure fields: %s", raw)
					}
					if tc.style != "" && !strings.Contains(string(raw), "style='"+tc.style+"'") {
						t.Error("style missing")
					}
				}
				w.Header().Set("Content-Type", "audio/mpeg")
				_, _ = w.Write(audio)
			}))
			defer server.Close()
			fixture := newManagedCloudScenarioTestFixture(t, tc.provider, tc.model, server.URL, Config{AllowLoopbackEndpoint: true})
			ctx := withCloudScenarioTestIntent(scenarioJobUserContext("app-1", "user-001"), "audio.synthesize", fixture.targetRef)
			request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello, Nimi.", AudioFormat: "mp3", SampleRateHz: proto.Int32(24000), Emotion: tc.style, VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: tc.voice}}}}}}
			submitted, err := fixture.service.SubmitScenarioJob(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			job := waitVoiceWorkflowExecutionForTest(t, fixture.service, submitted.GetJob().GetJobId())
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 || calls.Load() != 1 {
				t.Fatalf("native speech Job: %v", job)
			}
			a := job.GetArtifacts()[0]
			if a.GetSampleRateHz() != 24000 || a.GetDurationMs() <= 0 || a.GetMimeType() != "audio/mpeg" {
				t.Fatal(a)
			}
			request.GetSpec().GetSpeechSynthesize().Speed = proto.Float32(1.5)
			if _, err := fixture.service.SubmitScenarioJob(ctx, request); err == nil || calls.Load() != 1 {
				t.Fatal("ignored control reached provider")
			}
		})
	}
}

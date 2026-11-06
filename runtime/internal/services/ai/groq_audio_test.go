package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestGroqFiniteSpeechJobsUseExactNativePathsAndTypedResults(t *testing.T) {
	for _, model := range []string{"whisper-large-v3", "whisper-large-v3-turbo", "canopylabs/orpheus-v1-english", "canopylabs/orpheus-arabic-saudi"} {
		t.Run(model, func(t *testing.T) {
			asr := strings.HasPrefix(model, "whisper")
			var calls atomic.Int32
			voice := "hannah"
			if strings.HasSuffix(model, "saudi") {
				voice = "noura"
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if asr {
					if r.URL.Path != "/openai/v1/audio/transcriptions" {
						t.Error(r.URL.Path)
					}
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Error(err)
					}
					if r.FormValue("model") != model || r.FormValue("timestamp_granularities[]") != "word" {
						t.Error(r.Form)
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"text": "Hello.", "language": "english", "duration": .1, "words": []any{map[string]any{"word": "Hello.", "start": .01, "end": .08}}})
				} else {
					if r.URL.Path != "/openai/v1/audio/speech" {
						t.Error(r.URL.Path)
					}
					var body map[string]any
					_ = json.NewDecoder(r.Body).Decode(&body)
					if body["model"] != model || body["voice"] != voice || body["response_format"] != "wav" {
						t.Error(body)
					}
					w.Header().Set("Content-Type", "audio/wav")
					_, _ = w.Write(mistralVoiceServiceWAV())
				}
			}))
			defer server.Close()
			fixture := newManagedCloudScenarioTestFixture(t, "groq", model, server.URL+"/openai/v1", Config{AllowLoopbackEndpoint: true})
			owner := scenarioJobUserContext("app-1", "user-001")
			capability := "audio.synthesize"
			request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello, Nimi.", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: voice}}}}}}
			if asr {
				capability = "audio.transcribe"
				request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE
				request.Spec = &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", Timestamps: proto.Bool(true), AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: mistralVoiceServiceWAV()}}}}}
			}
			submitted, err := fixture.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, capability, fixture.targetRef), request)
			if err != nil {
				t.Fatal(err)
			}
			job := waitVoiceWorkflowExecutionForTest(t, fixture.service, submitted.GetJob().GetJobId())
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || calls.Load() != 1 {
				t.Fatal(job)
			}
			result, err := fixture.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
			if err != nil {
				t.Fatal(err)
			}
			if asr {
				tr := result.GetJob().GetTranscription()
				if tr.GetText() != "Hello." || tr.GetLanguage() != "en" || len(tr.GetWords()) != 1 || tr.GetWords()[0].GetEndSeconds() != .08 {
					t.Fatal(tr)
				}
			} else {
				a := result.GetJob().GetArtifacts()
				if len(a) != 1 || a[0].GetMimeType() != "audio/wav" || a[0].GetSampleRateHz() != 24000 || a[0].GetDurationMs() != 100 {
					t.Fatal(a)
				}
			}
		})
	}
}

package ai

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGoogleCloudTTSJobUsesCatalogPresetAndNativeAudioContent(t *testing.T) {
	for _, model := range []string{"chirp-3-hd", "gemini-2.5-flash-tts", "gemini-2.5-pro-tts", "gemini-2.5-flash-lite-preview-tts", "gemini-3.1-flash-tts-preview"} {
		t.Run(model, func(t *testing.T) {
			var calls atomic.Int32
			voice := "Kore"
			if model == "chirp-3-hd" {
				voice = "en-US-Chirp3-HD-Kore"
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != "POST" || r.URL.Path != "/v1/text:synthesize" {
					t.Error("wrong native endpoint")
				}
				var payload map[string]any
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				v := payload["voice"].(map[string]any)
				c := payload["audioConfig"].(map[string]any)
				if v["name"] != voice || v["languageCode"] != "en-US" || c["sampleRateHertz"] != float64(24000) || c["audioEncoding"] != "LINEAR16" {
					t.Errorf("captured catalog defaults lost: %v", payload)
				}
				if model != "chirp-3-hd" && v["modelName"] != model {
					t.Error("model lost")
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]string{"audioContent": base64.StdEncoding.EncodeToString(mistralVoiceServiceWAV())})
			}))
			defer server.Close()
			fixture := newManagedCloudScenarioTestFixture(t, "google_cloud_tts", model, server.URL, Config{AllowLoopbackEndpoint: true})
			owner := scenarioJobUserContext("app-1", "user-001")
			ctx := withCloudScenarioTestIntent(owner, "audio.synthesize", fixture.targetRef)
			request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello, Nimi.", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: voice}}}}}}
			submitted, err := fixture.service.SubmitScenarioJob(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			job := waitVoiceWorkflowExecutionForTest(t, fixture.service, submitted.GetJob().GetJobId())
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 1 || calls.Load() != 1 {
				t.Fatalf("Job: %v", job)
			}
			a := job.GetArtifacts()[0]
			if a.GetMimeType() != "audio/wav" || a.GetSampleRateHz() != 24000 || a.GetChannels() != 1 || a.GetDurationMs() != 100 {
				t.Fatalf("actual output facts: %v", a)
			}
			request.Extensions = []*runtimev1.ScenarioExtension{{Namespace: "nimi.scenario.speech_synthesize.request", Payload: &structpb.Struct{}}}
			if _, err := fixture.service.SubmitScenarioJob(ctx, request); err == nil || calls.Load() != 1 {
				t.Fatal("native override reached provider")
			}
		})
	}
}

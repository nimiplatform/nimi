package ai

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestCloudCaptureStorageFailureRejectsBeforeSealingCredential(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "openai", "gpt-transcribe", server.URL, Config{AllowLoopbackEndpoint: true})
	secrets := installCustodyTrackingConnectorStore(t, &f)
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	f.service.scenarioJobs = store
	owner := scenarioJobUserContext("nimi.desktop", "user-001")
	head := &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}
	var custodyBegins atomic.Int32
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Operation == scenarioJobPersistCustodyBegin {
			custodyBegins.Add(1)
		}
		if attempt.Operation == scenarioJobPersistMaintenance {
			return errors.New("capture baseline cannot be persisted")
		}
		return nil
	}
	response, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "audio.transcribe", f.targetRef), &runtimev1.SubmitScenarioJobRequest{
		Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: []byte("recording")}}, MimeType: "audio/wav"}}},
	})
	if err == nil || response != nil || custodyBegins.Load() != 0 || calls.Load() != 0 {
		t.Fatalf("failed capture write allowed custody/dispatch: response=%v err=%v custody=%d calls=%d", response, err, custodyBegins.Load(), calls.Load())
	}
	assertOnlyLiveConnectorCredential(t, secrets, f.connectorID)
}

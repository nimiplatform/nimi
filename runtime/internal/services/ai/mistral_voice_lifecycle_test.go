package ai

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func mistralVoiceScenarioRequest() *runtimev1.SubmitScenarioJobRequest {
	r := voiceReferenceAudioRequest()
	r.Head.SubjectUserId = "user-001"
	s := r.GetSpec().GetVoiceCreate()
	s.TargetModelId = capabilitydriver.MistralVoxtralTTS3
	source := s.GetReferenceAudio()
	source.ReferenceAudioUri = ""
	source.ReferenceAudioBytes = mediaBudgetTestWAV()
	return r
}

func mistralVoiceServiceWAV() []byte {
	data := append(mediaBudgetTestWAV()[:44], make([]byte, 4800)...)
	binary.LittleEndian.PutUint32(data[4:], uint32(len(data)-8))
	binary.LittleEndian.PutUint32(data[24:], 24000)
	binary.LittleEndian.PutUint32(data[28:], 48000)
	binary.LittleEndian.PutUint32(data[40:], 4800)
	return data
}
func TestMistralSavedVoiceCreationInspectionSynthesisAndDeletionUseCapturedBinding(t *testing.T) {
	const id = "e3382729-55e6-409e-aa7f-a3fc3974f4d3"
	var creates, inspects, syntheses, deletes atomic.Int32
	var absent atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/audio/speech" {
			syntheses.Add(1)
			var payload map[string]any
			json.NewDecoder(r.Body).Decode(&payload)
			if payload["voice_id"] != id || payload["model"] != capabilitydriver.MistralVoxtralTTS3 {
				t.Error("VoiceAsset native handle or model lost")
			}
			json.NewEncoder(w).Encode(map[string]any{"audio_data": base64.StdEncoding.EncodeToString(mistralVoiceServiceWAV())})
			return
		}
		if r.URL.Path == "/v1/audio/voices" && r.Method == "POST" {
			creates.Add(1)
		} else if r.URL.Path == "/v1/audio/voices/"+id {
			if r.Method == "GET" {
				inspects.Add(1)
				if absent.Load() {
					w.WriteHeader(404)
					return
				}
			} else if r.Method == "DELETE" {
				deletes.Add(1)
			} else {
				t.Error("unexpected resource method")
			}
		} else {
			t.Errorf("unexpected native voice endpoint %s", r.URL.Path)
			w.WriteHeader(400)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"id": id, "type": "custom", "name": "fixture", "created_at": "2026-11-06T00:00:00Z", "user_id": "workspace", "retention_notice": 30})
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "mistral", capabilitydriver.MistralVoxtralTTS3, server.URL+"/v1", Config{AllowLoopbackEndpoint: true})
	owner := scenarioJobUserContext("app-1", "user-001")
	created, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "voice.create", f.targetRef), mistralVoiceScenarioRequest())
	if err != nil {
		t.Fatal(err)
	}
	job := waitVoiceWorkflowExecutionForTest(t, f.service, created.GetJob().GetJobId())
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("voice Job %+v", job)
	}
	got, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
	if err != nil {
		t.Fatal(err)
	}
	asset := got.GetAsset()
	if asset == nil || asset.GetProviderVoiceRef() != id || asset.GetExpiresAt() != nil || asset.GetPersistence() != runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT || !providerVoiceNeedsInspection(asset) {
		t.Fatalf("persistent voice facts: %+v", asset)
	}
	before := inspects.Load()
	if _, err := f.service.GetVoiceAsset(scenarioJobUserContext("another-app", "user-001"), &runtimev1.GetVoiceAssetRequest{VoiceAssetId: asset.GetVoiceAssetId()}); err == nil || inspects.Load() != before {
		t.Fatal("foreign app reached provider or obtained voice")
	}
	inspected, err := f.service.GetVoiceAsset(owner, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: asset.GetVoiceAssetId()})
	if err != nil || inspected.GetAsset().GetExpiresAt() != nil || inspects.Load() <= before {
		t.Fatalf("non-expiring inspection %v %v", inspected, err)
	}
	request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "你好", AudioFormat: "wav", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET, Reference: &runtimev1.VoiceReference_VoiceAssetId{VoiceAssetId: asset.GetVoiceAssetId()}}}}}}
	speech, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "audio.synthesize", f.targetRef), request)
	if err != nil {
		t.Fatal(err)
	}
	spoken := waitVoiceWorkflowExecutionForTest(t, f.service, speech.GetJob().GetJobId())
	if spoken.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || syntheses.Load() != 1 {
		t.Fatalf("owned voice synthesis %+v", spoken)
	}
	absent.Store(true)
	missing, err := f.service.GetVoiceAsset(owner, &runtimev1.GetVoiceAssetRequest{VoiceAssetId: asset.GetVoiceAssetId()})
	if err != nil || missing.GetAsset().GetStatus() != runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_EXPIRED || missing.GetAsset().GetExpiresAt() != nil {
		t.Fatalf("confirmed missing voice %v %v", missing, err)
	}
	absent.Store(false)
	if _, err := f.service.DeleteVoiceAsset(owner, &runtimev1.DeleteVoiceAssetRequest{VoiceAssetId: asset.GetVoiceAssetId()}); err != nil {
		t.Fatal(err)
	}
	if creates.Load() != 1 || deletes.Load() != 1 {
		t.Fatal("native create repeated or delete omitted")
	}
}
func TestMistralTranscriptionJobPublishesNativeSpeakerIntervals(t *testing.T) {
	for _, model := range []string{"voxtral-mini-transcribe-3-0", "voxtral-small-transcribe-3-0"} {
		t.Run(model, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				if r.URL.Path != "/v1/audio/transcriptions" {
					t.Errorf("unexpected ASR endpoint %s", r.URL.Path)
				}
				if err := r.ParseMultipartForm(1 << 20); err != nil {
					t.Error(err)
					return
				}
				defer r.MultipartForm.RemoveAll()
				if r.FormValue("model") != model || r.FormValue("diarize") != "true" || r.FormValue("timestamp_granularities") != "segment" {
					t.Error("native ASR options lost")
				}
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(map[string]any{"model": model, "text": "你好，Nimi。", "language": "zh", "usage": map[string]any{"prompt_tokens": 1, "completion_tokens": 3, "total_tokens": 4, "prompt_audio_seconds": 1}, "segments": []any{map[string]any{"type": "transcription_segment", "text": "你好，Nimi。", "start": 0, "end": 0.08, "speaker_id": "speaker_0"}}})
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "mistral", model, server.URL+"/v1", Config{AllowLoopbackEndpoint: true})
			owner := scenarioJobUserContext("app-1", "user-001")
			diarization := true
			request := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{MimeType: "audio/wav", Diarization: &diarization, AudioSource: &runtimev1.SpeechTranscriptionAudioSource{Source: &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{AudioBytes: mistralVoiceServiceWAV()}}}}}}
			submitted, err := f.service.SubmitScenarioJob(withCloudScenarioTestIntent(owner, "audio.transcribe", f.targetRef), request)
			if err != nil {
				t.Fatal(err)
			}
			job := waitVoiceWorkflowExecutionForTest(t, f.service, submitted.GetJob().GetJobId())
			if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
				t.Fatalf("ASR job %+v", job)
			}
			result, err := f.service.GetScenarioJob(owner, &runtimev1.GetScenarioJobRequest{JobId: job.GetJobId()})
			if err != nil {
				t.Fatal(err)
			}
			transcript := result.GetJob().GetTranscription()
			if transcript.GetText() != "你好，Nimi。" || transcript.GetLanguage() != "zh" || len(transcript.GetWords()) != 0 || transcript.GetDiarization().GetDurationSeconds() != .1 || len(transcript.GetDiarization().GetIntervals()) != 1 || requests.Load() != 1 {
				t.Fatalf("native transcript lost: %v", transcript)
			}
		})
	}
}

func TestMistralCanceledKnownVoiceIsDeletedWithoutPublishingAsset(t *testing.T) {
	var deletes atomic.Int32
	const id = "e3382729-55e6-409e-aa7f-a3fc3974f4d3"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "DELETE" {
			deletes.Add(1)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"id": id, "type": "custom", "created_at": "2026-11-06T00:00:00Z"})
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "mistral", capabilitydriver.MistralVoxtralTTS3, server.URL+"/v1", Config{AllowLoopbackEndpoint: true})
	host := &heldKnownVoiceHost{MediaHost: f.service.remoteMediaHost, known: make(chan struct{}), resume: make(chan struct{})}
	f.service.remoteMediaHost = host
	ctx := withCloudScenarioTestIntent(scenarioJobUserContext("app-1", "user-001"), "voice.create", f.targetRef)
	response, err := f.service.SubmitScenarioJob(ctx, mistralVoiceScenarioRequest())
	if err != nil {
		t.Fatal(err)
	}
	<-host.known
	if _, err := f.service.CancelScenarioJob(ctx, &runtimev1.CancelScenarioJobRequest{JobId: response.GetJob().GetJobId()}); err != nil {
		t.Fatal(err)
	}
	close(host.resume)
	job := waitVoiceWorkflowExecutionForTest(t, f.service, response.GetJob().GetJobId())
	if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || len(job.GetArtifacts()) != 0 || deletes.Load() != 1 {
		t.Fatalf("unpublished native voice leaked: %v deletes=%d", job, deletes.Load())
	}
	if _, found := f.service.voiceAssets.getAsset(job.GetJobId()); found {
		t.Fatal("canceled voice became selectable")
	}
}

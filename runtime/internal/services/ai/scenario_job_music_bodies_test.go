package ai

import (
	"context"
	"errors"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeartifact"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

type captureReadCountingStore struct {
	*runtimeartifact.DiskStore
	seeks atomic.Int32
}
type captureReadCountingBody struct {
	io.ReadSeekCloser
	seeks *atomic.Int32
}

func (b *captureReadCountingBody) Seek(offset int64, whence int) (int64, error) {
	b.seeks.Add(1)
	return b.ReadSeekCloser.Seek(offset, whence)
}
func (s *captureReadCountingStore) Open(ctx context.Context, id string) (*runtimeartifact.ArtifactSource, bool) {
	source, ok := s.DiskStore.Open(ctx, id)
	if ok && id == "source-owned" {
		source.Body = &captureReadCountingBody{ReadSeekCloser: source.Body, seeks: &s.seeks}
	}
	return source, ok
}

type typedMusicBodyTestHost struct{ calls atomic.Int32 }

func (h *typedMusicBodyTestHost) ExecuteMusic(ctx context.Context, plan *capabilitydriver.MusicInvocationPlan, onStart localexecution.MusicExecutionStartFunc) (localexecution.MusicResult, error) {
	if err := onStart(); err != nil {
		return localexecution.MusicResult{}, err
	}
	h.calls.Add(1)
	return localexecution.MusicResult{Transcription: &capabilitydriver.MusicTranscriptionOutput{Completeness: runtimev1.MusicTranscriptionCompleteness_MUSIC_TRANSCRIPTION_COMPLETENESS_COMPLETE, Scores: []capabilitydriver.MusicTranscriptionScoreOutput{{Format: runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC, Part: runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_LEAD_SHEET, Bytes: []byte("X:1\nK:C\nC D E F|\n")}}}}, nil
}

func TestLocalMusicTranscriptionReadyResultKeepsOwnedScoreAndTypedFacts(t *testing.T) {
	svc := newTestService(nil)
	svc.localMusicStagingRoot = t.TempDir()
	selected := selectedMusicExecutionForTest(t)
	selected.CapabilityContract = capabilitydriver.MusicTranscribeCapabilityContract
	selected.RecipeID = capabilitydriver.SheetSage2RecipeID
	selected.DriverIdentity = (&capabilitydriver.Identity{ImplementationID: capabilitydriver.SheetSage2ImplementationID, DriverID: capabilitydriver.SheetSage2DriverID, DriverDialect: capabilitydriver.SheetSage2DriverDialect}).Proto()
	selected.Requirements, _ = (capabilitydriver.SheetSage2AudioCppDriver{}).ProjectRecipe(selected.RecipeID, nil, nil)
	binding := selected.ExactBindings[0]
	binding.RequirementID = capabilitydriver.SheetSage2RequirementID
	binding.VerifiedContentID = capabilitydriver.SheetSage2VerifiedContentID
	binding.DeclaredFiles = []string{"model.gguf"}
	binding.AbsolutePath = filepath.Join(binding.BundleDir, "model.gguf")
	selected.ExactBindings = []localexecution.ExactBinding{binding}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selected})
	host := &typedMusicBodyTestHost{}
	svc.SetLocalMusicExecutionHost(host)
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	svc.scenarioJobs = store
	bodies, err := runtimeartifact.NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	countingBodies := &captureReadCountingStore{DiskStore: bodies}
	svc.SetRuntimeArtifactStore(countingBodies)
	sourcePath := filepath.Join(t.TempDir(), "source.wav")
	if err := writeCanonicalMusicTestWAV(sourcePath, 48000, 2, 3); err != nil {
		t.Fatal(err)
	}
	facts, err := audiomedia.InspectCanonical(context.Background(), sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	head := &runtimev1.ScenarioRequestHead{AppId: "app-1", SubjectUserId: "user-1"}
	if err := bodies.PutStream(context.Background(), "source-owned", runtimeartifact.ArtifactRecord{MimeType: "audio/wav", Owner: runtimeArtifactOwner(head), CanonicalAudio: &runtimeartifact.CanonicalAudioInfo{SampleRateHz: facts.SampleRateHz, Channels: facts.Channels, FrameCount: facts.FrameCount, DataOffset: facts.DataOffset}}, source); err != nil {
		t.Fatal(err)
	}
	store.persistenceFailure = func(attempt scenarioJobPersistenceAttempt) error {
		if attempt.Status == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			return errors.New("final write unavailable")
		}
		return nil
	}
	request := musicTranscriptionSpecForTest()
	request.RequestedFormats = []runtimev1.MusicTranscriptionFormat{runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_ABC}
	ctx := executionintent.WithIntent(scenarioJobUserContext("app-1", "user-1"), executionintent.Intent{CapabilityContract: capabilitydriver.MusicTranscribeCapabilityContract, LocalLoadoutRef: "test-transcription", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
	submitted, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicTranscribe{MusicTranscribe: request}}})
	if err != nil {
		t.Fatal(err)
	}
	id := submitted.GetJob().GetJobId()
	deadline := time.Now().Add(5 * time.Second)
	for !store.hasResultCandidate(id) {
		if time.Now().After(deadline) {
			job, _ := store.get(id)
			t.Fatalf("ready result was lost: %v", job)
		}
		time.Sleep(time.Millisecond)
	}
	waitScenarioJobWorkExit(t, store, id)
	if _, visible := bodies.Stat(id + "-music-1"); visible {
		t.Fatal("score escaped before Job commit")
	}
	store.persistenceFailure = nil
	completed, err := svc.GetScenarioJob(scenarioJobUserContext("app-1", "user-1"), &runtimev1.GetScenarioJobRequest{JobId: id})
	if err != nil || completed.GetJob().GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || completed.GetJob().GetMusicTranscription().GetScores()[0].GetArtifactId() != id+"-music-1" || host.calls.Load() != 1 {
		t.Fatalf("typed result recovery lost identity or repeated inference: %v %v", completed, err)
	}
	if _, visible := bodies.Stat(id + "-music-1"); !visible {
		t.Fatal("complete Job did not publish score")
	}
	waitCompletedScenarioJobCleanup(t, svc, id)
	before := countingBodies.seeks.Load()
	second, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_MUSIC_TRANSCRIBE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicTranscribe{MusicTranscribe: request}}})
	if err != nil || second.GetJob().GetJobId() == id || countingBodies.seeks.Load() <= before {
		t.Fatalf("retained current result blocked independent capture: %v", err)
	}
	secondID := second.GetJob().GetJobId()
	if got := waitForMusicJobTerminal(t, svc, secondID); got.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || host.calls.Load() != 2 {
		t.Fatalf("second current Job did not complete: %v", got)
	}
	waitCompletedScenarioJobCleanup(t, svc, secondID)
	store.mu.RLock()
	pending := len(store.captureRows)
	store.mu.RUnlock()
	if pending != 0 {
		t.Fatal("finished capture retained a transient row")
	}

}

type voiceConversionCaptureTestHost struct{ calls atomic.Int32 }

func (h *voiceConversionCaptureTestHost) ExecuteMusic(ctx context.Context, plan *capabilitydriver.MusicInvocationPlan, onStart localexecution.MusicExecutionStartFunc) (localexecution.MusicResult, error) {
	if err := onStart(); err != nil {
		return localexecution.MusicResult{}, err
	}
	source, err := audiomedia.InspectCanonical(ctx, plan.VoiceConvertSourcePath())
	if err != nil {
		return localexecution.MusicResult{}, err
	}
	target, err := audiomedia.InspectCanonical(ctx, plan.VoiceConvertTargetPath())
	if err != nil {
		return localexecution.MusicResult{}, err
	}
	if source.FrameCount != 96000 || source.Channels != 2 || target.FrameCount != 48000 || target.Channels != 1 {
		return localexecution.MusicResult{}, fmt.Errorf("captured ranges changed")
	}
	left, _ := os.Stat(plan.VoiceConvertSourcePath())
	right, _ := os.Stat(plan.VoiceConvertTargetPath())
	if os.SameFile(left, right) {
		return localexecution.MusicResult{}, fmt.Errorf("distinct capture roles share an unintended body")
	}
	h.calls.Add(1)
	if err := writeCanonicalMusicTestWAV(plan.StagingWAVPath(), 24000, 1, 2); err != nil {
		return localexecution.MusicResult{}, err
	}
	info, err := os.Stat(plan.StagingWAVPath())
	if err != nil {
		return localexecution.MusicResult{}, err
	}
	return localexecution.MusicResult{StagingWAVPath: plan.StagingWAVPath(), SizeBytes: info.Size(), SampleRate: 24000, Channels: 1, BitsPerSample: 32, DurationMS: 2000, ComputeMS: 1}, nil
}

func TestVoiceConversionCapturesWholeSourceTargetSetInBodyCustody(t *testing.T) {
	svc := newTestService(nil)
	svc.localMusicStagingRoot = t.TempDir()
	selected := selectedMusicExecutionForTest(t)
	selected.LoadoutID = "loadout-vevo2"
	selected.DisplayName = "VeVo2"
	selected.CapabilityContract = capabilitydriver.VoiceConvertCapabilityContract
	selected.RecipeID = capabilitydriver.VeVo2RecipeID
	selected.DriverIdentity = (&capabilitydriver.Identity{ImplementationID: capabilitydriver.VeVo2ImplementationID, DriverID: capabilitydriver.VeVo2DriverID, DriverDialect: capabilitydriver.VeVo2DriverDialect}).Proto()
	selected.Requirements, _ = (capabilitydriver.VeVo2AudioCppDriver{}).ProjectRecipe(selected.RecipeID, nil, nil)
	binding := selected.ExactBindings[0]
	binding.RequirementID = capabilitydriver.VeVo2RequirementID
	binding.VerifiedContentID = capabilitydriver.VeVo2VerifiedContentID
	binding.DeclaredFiles = []string{"vevo2-q8_0.gguf"}
	binding.AbsolutePath = filepath.Join(binding.BundleDir, "vevo2-q8_0.gguf")
	selected.ExactBindings = []localexecution.ExactBinding{binding}
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selected})
	host := &voiceConversionCaptureTestHost{}
	svc.SetLocalMusicExecutionHost(host)
	store, _ := newDurableScenarioJobStoreForFailureTest(t)
	svc.scenarioJobs = store
	bodies, err := runtimeartifact.NewDiskStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc.SetRuntimeArtifactStore(bodies)
	head := &runtimev1.ScenarioRequestHead{AppId: "nimi.desktop", SubjectUserId: "user-001"}
	for _, item := range []struct {
		id                string
		channels, seconds int
	}{{"source", 2, 3}, {"target", 1, 1}} {
		path := filepath.Join(t.TempDir(), item.id+".wav")
		if err := writeCanonicalMusicTestWAV(path, 48000, item.channels, item.seconds); err != nil {
			t.Fatal(err)
		}
		facts, err := audiomedia.InspectCanonical(context.Background(), path)
		if err != nil {
			t.Fatal(err)
		}
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := bodies.PutStream(context.Background(), item.id, runtimeartifact.ArtifactRecord{MimeType: "audio/wav", Owner: runtimeArtifactOwner(head), CanonicalAudio: &runtimeartifact.CanonicalAudioInfo{SampleRateHz: facts.SampleRateHz, Channels: facts.Channels, FrameCount: facts.FrameCount, DataOffset: facts.DataOffset}}, file); err != nil {
			t.Fatal(err)
		}
	}
	ctx := executionintent.WithIntent(scenarioJobUserContext(head.AppId, head.SubjectUserId), executionintent.Intent{CapabilityContract: capabilitydriver.VoiceConvertCapabilityContract, LocalLoadoutRef: "voice-convert-test", Route: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL})
	response, err := svc.SubmitScenarioJob(ctx, &runtimev1.SubmitScenarioJobRequest{Head: head, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_VOICE_CONVERT, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_AudioVoiceConvert{AudioVoiceConvert: &runtimev1.AudioVoiceConvertScenarioSpec{SourceVocal: &runtimev1.MusicAudioInput{ArtifactId: "source", Range: &runtimev1.AudioFrameRange{StartFrame: 48000, EndFrame: 144000}}, SourceKind: runtimev1.VoiceConvertSourceKind_VOICE_CONVERT_SOURCE_KIND_SINGING, TargetVoice: &runtimev1.VoiceConvertTargetVoice{Target: &runtimev1.VoiceConvertTargetVoice_ReferenceAudio{ReferenceAudio: &runtimev1.MusicAudioInput{ArtifactId: "target"}}}}}}})
	if err != nil {
		t.Fatal(err)
	}
	id := response.GetJob().GetJobId()
	terminal := waitScenarioJobTerminal(t, svc, id, 5*time.Second)
	waitCompletedScenarioJobCleanup(t, svc, id)
	if terminal.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || host.calls.Load() != 1 || terminal.GetVoiceConversion().GetVocalArtifactId() != id+"-music-1" {
		t.Fatalf("owned capture result: %v calls=%d", terminal, host.calls.Load())
	}
	waitCompletedScenarioJobCleanup(t, svc, id)
	for _, role := range []string{"source", "target"} {
		if _, complete := bodies.JobBodyStat(id, id+"-capture-"+role); complete {
			t.Fatal("capture purpose was not disposed after Host exit")
		}
	}
	if _, visible := bodies.Stat(id + "-music-1"); !visible {
		t.Fatal("formal vocal body was removed with capture scratch")
	}
}
